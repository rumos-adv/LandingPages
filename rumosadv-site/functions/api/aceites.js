import {
  ACCEPTANCE_TERM_SHA256,
  ACCEPTANCE_TERM_VERSION
} from '../_lib/acceptance-terms.js';
import { JsonBodyError, readBoundedJson } from '../_lib/bounded-json.js';
import { isValidCpfCnpj, normalizeCpfCnpj } from '../_lib/tax-id.js';
import { validateSameOriginJson } from '../_lib/request-security.js';
import { verifyTurnstile } from '../_lib/turnstile.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  }
});

const MAX_REQUEST_BYTES = 32 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function requiredText(body, field, maximumLength) {
  const raw = body[field];
  if (typeof raw !== 'string') throw new InputError('Preencha todos os campos obrigatórios.');
  const value = raw.trim();
  if (!value) throw new InputError('Preencha todos os campos obrigatórios.');
  if (value.length > maximumLength) throw new InputError('Um ou mais campos excedem o tamanho permitido.');
  return value;
}

async function readBody(request) {
  try {
    return await readBoundedJson(request, MAX_REQUEST_BYTES);
  } catch (error) {
    if (!(error instanceof JsonBodyError)) throw error;
    throw new InputError(
      error.code === 'BODY_TOO_LARGE'
        ? 'Os dados enviados excedem o tamanho permitido.'
        : 'Os dados enviados são inválidos.',
      error.status
    );
  }
}

function sameAcceptance(existing, values) {
  return existing
    && existing.nome === values.nome
    && existing.cpf_cnpj === values.cpfCnpj
    && existing.email === values.email
    && existing.whatsapp === values.whatsapp
    && existing.marca === values.marca
    && existing.term_version === values.termVersion
    && existing.term_hash === values.termHash;
}

async function findAcceptance(db, id) {
  return db.prepare(`
    SELECT id, created_at, nome, cpf_cnpj, email, whatsapp, marca, term_version, term_hash
    FROM aceites WHERE id = ? LIMIT 1
  `).bind(id).first();
}

function reusedOrConflict(existing, values) {
  if (!existing) return null;
  if (!sameAcceptance(existing, values)) {
    console.error(JSON.stringify({ event: 'aceite_idempotency_conflict', aceite_id: existing.id }));
    return json({
      error: 'Não foi possível confirmar esta solicitação. Inicie uma nova contratação.',
      code: 'IDEMPOTENCY_CONFLICT'
    }, 409);
  }
  return json({ ok: true, id: existing.id, created_at: existing.created_at, reused: true }, 200);
}

export async function onRequestPost(context) {
  try {
    if (!context.env.ACEITES_DB) return json({ error: 'Banco de aceites não configurado.' }, 503);
    const unsafeRequest = validateSameOriginJson(context.request);
    if (unsafeRequest) return json({ error: unsafeRequest.error }, unsafeRequest.status);
    const body = await readBody(context.request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new InputError('Os dados enviados são inválidos.');
    if (body.consent !== true) return json({ error: 'É necessário concordar com o termo.' }, 400);

    const nome = requiredText(body, 'nome', 200);
    const cpfCnpj = normalizeCpfCnpj(requiredText(body, 'cpf_cnpj', 32));
    const email = requiredText(body, 'email', 254).toLowerCase();
    const whatsapp = requiredText(body, 'whatsapp', 32).replace(/\D/g, '');
    const marca = requiredText(body, 'marca', 180);
    const submittedTermVersion = requiredText(body, 'term_version', 32);
    const submittedTermHash = requiredText(body, 'term_hash', 64).toLowerCase();
    if (!isValidCpfCnpj(cpfCnpj)) return json({ error: 'Informe um CPF ou CNPJ válido.' }, 400);
    if (whatsapp.length < 10 || whatsapp.length > 13) return json({ error: 'Informe um WhatsApp válido, com DDD.' }, 400);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Informe um e-mail válido.' }, 400);
    if (!/^[a-f0-9]{64}$/.test(submittedTermHash)) return json({ error: 'Versão do termo inválida.' }, 400);
    if (submittedTermVersion !== ACCEPTANCE_TERM_VERSION || submittedTermHash !== ACCEPTANCE_TERM_SHA256) {
      return json({
        error: 'O termo de contratação foi atualizado. Recarregue a página para continuar.',
        code: 'TERM_UPDATED'
      }, 409);
    }

    const termVersion = ACCEPTANCE_TERM_VERSION;
    const termHash = ACCEPTANCE_TERM_SHA256;

    const requestedId = body.idempotency_key == null ? '' : body.idempotency_key;
    if (typeof requestedId !== 'string' || (requestedId && !UUID_PATTERN.test(requestedId.trim()))) {
      return json({ error: 'Identificador da solicitação inválido.' }, 400);
    }

    const id = requestedId.trim().toLowerCase() || crypto.randomUUID();
    const values = { nome, cpfCnpj, email, whatsapp, marca, termVersion, termHash };

    // A consulta vem antes do Turnstile para que uma resposta perdida possa ser
    // retomada com a mesma chave sem tentar reutilizar um token de uso único.
    const existingBeforeChallenge = await findAcceptance(context.env.ACEITES_DB, id);
    const existingResponse = reusedOrConflict(existingBeforeChallenge, values);
    if (existingResponse) return existingResponse;

    const challenge = await verifyTurnstile({
      env: context.env,
      token: body.turnstile_token,
      remoteIp: context.request.headers.get('CF-Connecting-IP') || '',
      fetchImpl: context.data?.turnstileFetch
    });
    if (!challenge.ok) {
      // Uma requisição concorrente pode ter concluído entre a pré-consulta e
      // a validação. Nesse caso, a linha gravada continua sendo a verdade.
      const existingAfterChallenge = await findAcceptance(context.env.ACEITES_DB, id);
      const recoveredResponse = reusedOrConflict(existingAfterChallenge, values);
      if (recoveredResponse) return recoveredResponse;
      if (challenge.unavailable) {
        const warning = {
          event: 'turnstile_validation_unavailable',
          reason: challenge.reason,
          attempts: challenge.attempts,
          duration_ms: challenge.duration_ms
        };
        if (Number.isInteger(challenge.http_status)) warning.http_status = challenge.http_status;
        if (typeof challenge.error_name === 'string') warning.error_name = challenge.error_name;
        if (typeof challenge.error_message === 'string') warning.error_message = challenge.error_message;
        console.warn(JSON.stringify(warning));
        const responseBody = {
          error: 'A verificação de segurança está temporariamente indisponível. Tente novamente.',
          code: 'TURNSTILE_UNAVAILABLE'
        };
        if (String(context.env.ASAAS_ENV || '').trim().toLowerCase() === 'sandbox') {
          responseBody.diagnostic = {
            reason: challenge.reason,
            attempts: challenge.attempts
          };
          if (Number.isInteger(challenge.http_status)) {
            responseBody.diagnostic.http_status = challenge.http_status;
          }
          if (typeof challenge.error_name === 'string') {
            responseBody.diagnostic.error_name = challenge.error_name;
          }
          if (typeof challenge.error_message === 'string') {
            responseBody.diagnostic.error_message = challenge.error_message;
          }
        }
        return json(responseBody, 503);
      }
      return json({
        error: 'Não foi possível confirmar a verificação de segurança. Faça uma nova verificação.',
        code: 'TURNSTILE_INVALID'
      }, 400);
    }

    const createdAt = new Date().toISOString();
    const ip = (context.request.headers.get('CF-Connecting-IP') || '').slice(0, 64) || null;
    const userAgent = (context.request.headers.get('User-Agent') || '').slice(0, 500) || null;

    const result = await context.env.ACEITES_DB.prepare(`
      INSERT OR IGNORE INTO aceites
      (id, created_at, nome, cpf_cnpj, email, whatsapp, marca, term_version, term_hash, ip, user_agent, consent, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'aceito')
    `).bind(
      id, createdAt, nome, cpfCnpj, email, whatsapp, marca,
      termVersion, termHash, ip, userAgent
    ).run();

    if (Number(result.meta?.changes || 0) !== 1) {
      const existing = await findAcceptance(context.env.ACEITES_DB, id);
      return reusedOrConflict(existing, values) || json({ error: 'Não foi possível registrar o aceite.' }, 500);
    }

    return json({ ok: true, id, created_at: createdAt }, 201);
  } catch (error) {
    if (error instanceof InputError) return json({ error: error.message }, error.status);
    console.error('aceites_error', error);
    return json({ error: 'Não foi possível registrar o aceite.' }, 500);
  }
}

export function onRequestGet() {
  return json({ error: 'Método não permitido.' }, 405);
}
