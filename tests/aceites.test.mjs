import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  ACCEPTANCE_TERM_SHA256,
  ACCEPTANCE_TERM_TEXT,
  ACCEPTANCE_TERM_VERSION
} from '../rumosadv-site/functions/_lib/acceptance-terms.js';
import { onRequestPost } from '../rumosadv-site/functions/api/aceites.js';

class MockD1 {
  constructor() {
    this.rows = new Map();
    this.writeCalls = 0;
    this.prepareCalls = 0;
  }

  prepare(sql) {
    const db = this;
    db.prepareCalls += 1;
    return {
      bind(...values) {
        return {
          async run() {
            assert.match(sql, /INSERT OR IGNORE INTO aceites/);
            db.writeCalls += 1;
            const [id, createdAt, nome, cpfCnpj, email, whatsapp, marca, termVersion, termHash] = values;
            if (db.rows.has(id)) return { meta: { changes: 0 } };
            db.rows.set(id, {
              id,
              created_at: createdAt,
              nome,
              cpf_cnpj: cpfCnpj,
              email,
              whatsapp,
              marca,
              term_version: termVersion,
              term_hash: termHash
            });
            return { meta: { changes: 1 } };
          },
          async first() {
            assert.match(sql, /FROM aceites WHERE id = \?/);
            return db.rows.get(values[0]) || null;
          }
        };
      }
    };
  }
}

const IDEMPOTENCY_KEY = '123e4567-e89b-42d3-a456-426614174000';

function validAcceptance(overrides = {}) {
  return {
    idempotency_key: IDEMPOTENCY_KEY,
    turnstile_token: 'turnstile-token-valido',
    nome: ' Cliente Teste ',
    cpf_cnpj: '529.982.247-25',
    email: 'CLIENTE@example.com',
    whatsapp: '(19) 99999-9999',
    marca: 'Montanha Cafés',
    term_version: ACCEPTANCE_TERM_VERSION,
    term_hash: ACCEPTANCE_TERM_SHA256,
    consent: true,
    ...overrides
  };
}

function context(db, body, raw = false, extraHeaders = {}) {
  return {
    env: {
      ACEITES_DB: db,
      TURNSTILE_SITE_KEY: 'site-key-test',
      TURNSTILE_SECRET_KEY: 'secret-key-test',
      TURNSTILE_ALLOWED_HOSTNAMES: 'example.test'
    },
    data: {
      turnstileFetch: async () => new Response(JSON.stringify({
        success: true,
        action: 'marcas_aceite',
        hostname: 'example.test',
        'error-codes': []
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    },
    request: new Request('https://example.test/api/aceites', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': '192.0.2.1',
        'user-agent': 'Teste',
        ...extraHeaders
      },
      body: raw ? body : JSON.stringify(body)
    })
  };
}

test('registra aceite com chave idempotente e dados normalizados', async () => {
  const db = new MockD1();
  const response = await onRequestPost(context(db, validAcceptance()));
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.id, IDEMPOTENCY_KEY);
  assert.equal(db.rows.size, 1);
  assert.deepEqual(
    {
      nome: db.rows.get(IDEMPOTENCY_KEY).nome,
      cpf_cnpj: db.rows.get(IDEMPOTENCY_KEY).cpf_cnpj,
      email: db.rows.get(IDEMPOTENCY_KEY).email,
      whatsapp: db.rows.get(IDEMPOTENCY_KEY).whatsapp
    },
    {
      nome: 'Cliente Teste',
      cpf_cnpj: '52998224725',
      email: 'cliente@example.com',
      whatsapp: '19999999999'
    }
  );
});

test('retry com a mesma chave e os mesmos dados reutiliza o aceite original', async () => {
  const db = new MockD1();
  const first = await onRequestPost(context(db, validAcceptance()));
  const firstBody = await first.json();
  const second = await onRequestPost(context(db, validAcceptance()));
  const secondBody = await second.json();

  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(secondBody.reused, true);
  assert.equal(secondBody.id, firstBody.id);
  assert.equal(secondBody.created_at, firstBody.created_at);
  assert.equal(db.rows.size, 1);
});

test('pré-consulta idempotente recupera resposta perdida sem reutilizar token Turnstile', async () => {
  const db = new MockD1();
  let validations = 0;
  const firstContext = context(db, validAcceptance());
  firstContext.data.turnstileFetch = async () => {
    validations += 1;
    return new Response(JSON.stringify({ success: true, action: 'marcas_aceite', hostname: 'example.test' }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  assert.equal((await onRequestPost(firstContext)).status, 201);

  const retryBody = validAcceptance();
  delete retryBody.turnstile_token;
  const retryContext = context(db, retryBody);
  retryContext.data.turnstileFetch = async () => {
    throw new Error('Siteverify não deve ser chamado no retry já persistido');
  };
  const retry = await onRequestPost(retryContext);

  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).reused, true);
  assert.equal(validations, 1);
});

test('submissões concorrentes com a mesma chave criam uma única linha', async () => {
  const db = new MockD1();
  const responses = await Promise.all([
    onRequestPost(context(db, validAcceptance())),
    onRequestPost(context(db, validAcceptance()))
  ]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 201]);
  assert.equal(db.rows.size, 1);
});

test('mesma chave com dados diferentes é conflito e não altera o aceite', async () => {
  const db = new MockD1();
  await onRequestPost(context(db, validAcceptance()));
  const response = await onRequestPost(context(db, validAcceptance({ email: 'outro@example.com' })));

  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /nova contratação/i);
  assert.equal(db.rows.get(IDEMPOTENCY_KEY).email, 'cliente@example.com');
});

test('mantém compatibilidade com cliente legado sem chave', async () => {
  const db = new MockD1();
  const body = validAcceptance();
  delete body.idempotency_key;
  const response = await onRequestPost(context(db, body));
  const data = await response.json();

  assert.equal(response.status, 201);
  assert.match(data.id, /^[0-9a-f-]{36}$/);
  assert.equal(db.rows.size, 1);
});

test('exige Turnstile em aceite novo e falha fechado sem configuração', async () => {
  const missingTokenDb = new MockD1();
  const missingToken = validAcceptance();
  delete missingToken.turnstile_token;
  const missingResponse = await onRequestPost(context(missingTokenDb, missingToken));
  assert.equal(missingResponse.status, 400);
  assert.equal((await missingResponse.json()).code, 'TURNSTILE_INVALID');
  assert.equal(missingTokenDb.writeCalls, 0);

  const unconfiguredDb = new MockD1();
  const unconfiguredContext = context(unconfiguredDb, validAcceptance());
  delete unconfiguredContext.env.TURNSTILE_SECRET_KEY;
  const unavailable = await onRequestPost(unconfiguredContext);
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).code, 'TURNSTILE_UNAVAILABLE');
  assert.equal(unconfiguredDb.writeCalls, 0);
});

test('não persiste nem devolve o token Turnstile', async () => {
  const db = new MockD1();
  const token = 'segredo-efemero-do-desafio';
  const response = await onRequestPost(context(db, validAcceptance({ turnstile_token: token })));
  const responseText = await response.text();
  const persisted = JSON.stringify([...db.rows.values()]);

  assert.equal(response.status, 201);
  assert.equal(responseText.includes(token), false);
  assert.equal(persisted.includes(token), false);
  assert.equal('turnstile_token' in db.rows.get(IDEMPOTENCY_KEY), false);
});

test('recusa tipos, documentos, chave e JSON inválidos antes de gravar', async () => {
  const invalidBodies = [
    validAcceptance({ nome: { valor: 'Cliente' } }),
    validAcceptance({ cpf_cnpj: '123' }),
    validAcceptance({ cpf_cnpj: '000.000.000-00' }),
    validAcceptance({ cpf_cnpj: '529.982.247-24' }),
    validAcceptance({ cpf_cnpj: '00.000.000/0000-00' }),
    validAcceptance({ cpf_cnpj: '00.000.000/E08G-13' }),
    validAcceptance({ whatsapp: '999' }),
    validAcceptance({ email: 'sem-arroba' }),
    validAcceptance({ consent: 'true' }),
    validAcceptance({ term_hash: 'abc' }),
    validAcceptance({ idempotency_key: 'chave-previsivel' })
  ];

  for (const body of invalidBodies) {
    const db = new MockD1();
    const response = await onRequestPost(context(db, body));
    assert.equal(response.status, 400);
    assert.equal(db.writeCalls, 0);
  }

  const malformedDb = new MockD1();
  const malformed = await onRequestPost(context(malformedDb, '{"nome":', true));
  assert.equal(malformed.status, 400);
  assert.equal(malformedDb.writeCalls, 0);
});

test('aceita e preserva CNPJ alfanumérico oficial normalizado em maiúsculas', async () => {
  const db = new MockD1();
  const response = await onRequestPost(context(db, validAcceptance({
    cpf_cnpj: '00.000.000/e08g-12'
  })));

  assert.equal(response.status, 201);
  assert.equal(db.rows.get(IDEMPOTENCY_KEY).cpf_cnpj, '00000000E08G12');
});

test('continua aceitando CNPJ numérico legado com dígitos verificadores válidos', async () => {
  const db = new MockD1();
  const response = await onRequestPost(context(db, validAcceptance({
    cpf_cnpj: '04.252.011/0001-10'
  })));

  assert.equal(response.status, 201);
  assert.equal(db.rows.get(IDEMPOTENCY_KEY).cpf_cnpj, '04252011000110');
});

test('recusa corpo acima de 32 KB antes de gravar', async () => {
  const db = new MockD1();
  const response = await onRequestPost(context(db, validAcceptance({ marca: 'x'.repeat(40_000) })));
  assert.equal(response.status, 413);
  assert.equal(db.writeCalls, 0);
});

test('cancela stream sem Content-Length assim que ultrapassa 32 KB', async () => {
  const db = new MockD1();
  let cancelled = false;
  const request = new Request('https://example.test/api/aceites', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(8 * 1024)); },
      cancel() { cancelled = true; }
    }),
    duplex: 'half'
  });

  assert.equal(request.headers.has('content-length'), false);
  const response = await onRequestPost({ env: { ACEITES_DB: db }, request });
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
  assert.equal(db.writeCalls, 0);
});

test('termo canônico corresponde exatamente ao texto exibido e ao hash publicado', async () => {
  const html = await readFile(new URL('../rumosadv-site/marcas/aceite/index.html', import.meta.url), 'utf8');
  const term = html.match(/<div class="term" id="term-text"([^>]*)>([\s\S]*?)<\/div>/);
  assert.ok(term);
  const clauses = [...term[2].matchAll(/<h3>([^<]+)<\/h3>\s*<p>([^<]+)<\/p>/g)]
    .map(match => `${match[1]}\n${match[2]}`)
    .join('\n\n');
  const displayedVersion = term[1].match(/data-version="([^"]+)"/)?.[1];
  const displayedHash = term[1].match(/data-sha256="([^"]+)"/)?.[1];
  const recomputedHash = createHash('sha256').update(clauses, 'utf8').digest('hex');

  assert.equal(clauses, ACCEPTANCE_TERM_TEXT);
  assert.equal(displayedVersion, ACCEPTANCE_TERM_VERSION);
  assert.equal(displayedHash, ACCEPTANCE_TERM_SHA256);
  assert.equal(recomputedHash, ACCEPTANCE_TERM_SHA256);
});

test('rejeita versão ou hash divergente do termo canônico antes de gravar', async () => {
  for (const body of [
    validAcceptance({ term_version: '0.9' }),
    validAcceptance({ term_hash: 'b'.repeat(64) })
  ]) {
    const db = new MockD1();
    const response = await onRequestPost(context(db, body));
    assert.equal(response.status, 409);
    const data = await response.json();
    assert.equal(data.code, 'TERM_UPDATED');
    assert.match(data.error, /termo.*atualizado/i);
    assert.equal(db.writeCalls, 0);
  }
});

test('recusa content-type e origens inseguras antes de tocar no banco', async () => {
  for (const headers of [
    { 'content-type': 'text/plain' },
    { 'sec-fetch-site': 'cross-site' },
    { origin: 'https://malicioso.example' }
  ]) {
    const db = new MockD1();
    const response = await onRequestPost(context(db, validAcceptance(), false, headers));
    assert.ok([403, 415].includes(response.status));
    assert.equal(db.prepareCalls, 0);
    assert.equal(db.writeCalls, 0);
    assert.equal(db.rows.size, 0);
  }
});

test('falha fechado quando o binding D1 não existe', async () => {
  const response = await onRequestPost({
    env: {},
    request: context(new MockD1(), validAcceptance()).request
  });
  assert.equal(response.status, 503);
});
