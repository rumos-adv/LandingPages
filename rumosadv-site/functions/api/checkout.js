import { JsonBodyError, readBoundedJson } from '../_lib/bounded-json.js';
import { validateSameOriginJson } from '../_lib/request-security.js';

const CLAIM_PREFIX = 'creating:';
// O checkout expira em 60 minutos. A recuperação só ocorre depois desse prazo,
// com uma margem adicional, para não criar dois checkouts simultaneamente caso
// a resposta do Asaas tenha se perdido depois da criação externa.
const CLAIM_TTL_MS = 65 * 60 * 1000;
const TERMINAL_RETRY_STATUSES = new Set(['CANCELED', 'EXPIRED']);
const AMBIGUOUS_PROVIDER_STATUSES = new Set([408, 409, 425, 429]);
const MAX_REQUEST_BYTES = 4 * 1024;

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

function log(level, event, fields = {}) {
  const entry = JSON.stringify({ event, ...fields });
  if (level === 'error') console.error(entry);
  else console.log(entry);
}

function errorFields(error) {
  return {
    error_name: error instanceof Error ? error.name : 'UnknownError',
    error_message: (error instanceof Error ? error.message : String(error)).slice(0, 500)
  };
}

function configuredEnvironment(env) {
  const value = String(env.ASAAS_ENV || '').trim().toLowerCase();
  return value === 'sandbox' || value === 'production' ? value : null;
}

function apiBase(environment) {
  return environment === 'production'
    ? 'https://api.asaas.com/v3'
    : 'https://api-sandbox.asaas.com/v3';
}

function checkoutUrl(environment, checkoutId) {
  const host = environment === 'production' ? 'https://asaas.com' : 'https://sandbox.asaas.com';
  return `${host}/checkoutSession/show/${encodeURIComponent(checkoutId)}`;
}

function trustedCheckoutUrl(environment, checkoutId, providerLink) {
  const fallback = checkoutUrl(environment, checkoutId);
  const allowedHosts = environment === 'production'
    ? new Set(['asaas.com', 'www.asaas.com'])
    : new Set(['sandbox.asaas.com']);

  try {
    const parsed = new URL(String(providerLink || ''));
    if (parsed.protocol === 'https:' && allowedHosts.has(parsed.hostname.toLowerCase())) {
      return { url: parsed.toString(), usedFallback: false };
    }
  } catch {
    // Link ausente ou inválido: o identificador permite montar a URL oficial.
  }

  return { url: fallback, usedFallback: true };
}

function publicBase(request, env) {
  try {
    const parsed = env.PUBLIC_BASE_URL
      ? new URL(String(env.PUBLIC_BASE_URL).trim())
      : new URL(new URL(request.url).origin);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password
      || parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function normalizedStatus(value) {
  return String(value || '').trim().toUpperCase();
}

function parseClaim(value) {
  const match = /^creating:(\d{13}):([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(String(value || ''));
  if (!match) return null;
  return { createdAt: Number(match[1]), id: match[2] };
}

function isClaimMarker(value) {
  return String(value || '').toLowerCase().startsWith(CLAIM_PREFIX);
}

function isPaid(aceite) {
  return normalizedStatus(aceite?.payment_status) === 'PAID'
    || Boolean(aceite?.paid_at)
    || String(aceite?.status || '').trim().toLowerCase() === 'pago';
}

function isRetryTerminal(aceite) {
  const paymentStatus = normalizedStatus(aceite?.payment_status);
  const status = String(aceite?.status || '').trim().toLowerCase();
  return TERMINAL_RETRY_STATUSES.has(paymentStatus)
    || status === 'pagamento_cancelado'
    || status === 'pagamento_expirado';
}

function isDeterministicProviderRejection(status) {
  return status >= 400
    && status < 500
    && !AMBIGUOUS_PROVIDER_STATUSES.has(status);
}

function attemptStateFromSummary(previous) {
  const paymentStatus = normalizedStatus(previous.paymentStatus);
  if (paymentStatus === 'PAID') return 'PAID';
  if (paymentStatus === 'CANCELED') return 'CANCELED';
  if (paymentStatus === 'EXPIRED') return 'EXPIRED';
  return 'AWAITING_PAYMENT';
}

function priorAttemptIdentity(aceiteId, previous) {
  if (!previous.checkoutId) return null;
  const claim = parseClaim(previous.checkoutId);
  if (claim) {
    return {
      id: claim.id,
      externalReference: `${aceiteId}:${claim.id}`,
      checkoutId: null,
      state: 'CREATING',
      createdAt: new Date(claim.createdAt).toISOString(),
      failureReason: 'SUPERSEDED_STALE_CLAIM'
    };
  }
  return {
    id: `legacy-${aceiteId}`,
    externalReference: `legacy:${aceiteId}:${previous.checkoutId}`,
    checkoutId: previous.checkoutId,
    state: attemptStateFromSummary(previous),
    createdAt: previous.createdAt,
    failureReason: 'MATERIALIZED_LEGACY_SUMMARY'
  };
}

async function acquireClaim(db, aceite, previous, claim, attemptId, attemptReference, recoverableClaim) {
  const now = new Date().toISOString();
  const statements = [db.prepare(`
    /* checkout_claim */
    UPDATE aceites
    SET asaas_checkout_id = ?, asaas_checkout_url = NULL,
        payment_status = 'CREATING', status = 'criando_pagamento'
    WHERE id = ?
      AND paid_at IS NULL
      AND UPPER(COALESCE(payment_status, '')) <> 'PAID'
      AND LOWER(COALESCE(status, '')) <> 'pago'
      AND (
        asaas_checkout_id IS NULL
        OR TRIM(asaas_checkout_id) = ''
        OR UPPER(COALESCE(payment_status, '')) IN ('CANCELED', 'EXPIRED')
        OR LOWER(COALESCE(status, '')) IN ('pagamento_cancelado', 'pagamento_expirado')
        OR (? IS NOT NULL AND asaas_checkout_id = ?)
      )
  `).bind(claim, aceite.id, recoverableClaim, recoverableClaim)];

  const prior = priorAttemptIdentity(aceite.id, previous);
  if (prior) {
    statements.push(db.prepare(`
      /* checkout_materialize_prior */
      INSERT OR IGNORE INTO asaas_checkout_attempts (
        id, aceite_id, external_reference, checkout_id, checkout_url, state,
        is_current, created_at, updated_at, paid_at, failure_reason
      )
      SELECT ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM aceites
        WHERE id = ? AND asaas_checkout_id = ? AND payment_status = 'CREATING'
      )
    `).bind(
      prior.id,
      aceite.id,
      prior.externalReference,
      prior.checkoutId,
      previous.checkoutUrl,
      prior.state,
      prior.createdAt || aceite.created_at || now,
      now,
      prior.state === 'PAID' ? previous.paidAt : null,
      prior.failureReason,
      aceite.id,
      claim
    ));
  }

  statements.push(db.prepare(`
    /* checkout_supersede_prior */
    UPDATE asaas_checkout_attempts
    SET is_current = 0,
        state = CASE
          WHEN state IN ('PAID', 'CANCELED', 'EXPIRED') THEN state
          ELSE 'SUPERSEDED'
        END,
        superseded_at = COALESCE(superseded_at, ?), updated_at = ?
    WHERE aceite_id = ? AND is_current = 1
      AND EXISTS (
        SELECT 1 FROM aceites
        WHERE id = ? AND asaas_checkout_id = ? AND payment_status = 'CREATING'
      )
  `).bind(now, now, aceite.id, aceite.id, claim));

  statements.push(db.prepare(`
    /* checkout_attempt_insert */
    INSERT INTO asaas_checkout_attempts (
      id, aceite_id, external_reference, checkout_id, checkout_url, state,
      is_current, created_at, updated_at, failure_reason
    )
    SELECT ?, ?, ?, NULL, NULL, 'CREATING', 1, ?, ?, NULL
    WHERE EXISTS (
      SELECT 1 FROM aceites
      WHERE id = ? AND asaas_checkout_id = ? AND payment_status = 'CREATING'
    )
  `).bind(attemptId, aceite.id, attemptReference, now, now, aceite.id, claim));

  const results = await db.batch(statements);
  return {
    acquired: Number(results[0]?.meta?.changes || 0) === 1
      && Number(results.at(-1)?.meta?.changes || 0) === 1,
    prior
  };
}

async function releaseKnownFailedClaim(db, claim, previous, aceiteId, attemptId, requestId, providerStatus) {
  try {
    const now = new Date().toISOString();
    const prior = priorAttemptIdentity(aceiteId, previous);
    const statements = [db.prepare(`
      /* checkout_attempt_failed */
      UPDATE asaas_checkout_attempts
      SET state = 'CREATE_FAILED', is_current = 0, updated_at = ?,
          failure_reason = ?
      WHERE id = ? AND aceite_id = ? AND state = 'CREATING' AND checkout_id IS NULL
        AND EXISTS (
          SELECT 1 FROM aceites
          WHERE id = ? AND asaas_checkout_id = ? AND payment_status = 'CREATING'
        )
    `).bind(now, `PROVIDER_REJECTED_${providerStatus}`, attemptId, aceiteId, aceiteId, claim), db.prepare(`
      /* checkout_claim_release */
      UPDATE aceites
      SET asaas_checkout_id = ?, asaas_checkout_url = ?, payment_status = ?, status = ?
      WHERE id = ? AND asaas_checkout_id = ? AND payment_status = 'CREATING'
    `).bind(
      previous.checkoutId,
      previous.checkoutUrl,
      previous.paymentStatus,
      previous.status,
      aceiteId,
      claim
    )];

    if (prior) {
      statements.push(db.prepare(`
        /* checkout_prior_restore */
        UPDATE asaas_checkout_attempts
        SET is_current = 1,
            state = CASE
              WHEN ? IS NOT NULL AND id = ? AND state = 'SUPERSEDED' THEN 'CREATING'
              ELSE state
            END,
            superseded_at = NULL, updated_at = ?
        WHERE aceite_id = ?
          AND ((? IS NOT NULL AND id = ?) OR (? IS NOT NULL AND checkout_id = ?))
          AND NOT EXISTS (
            SELECT 1 FROM asaas_checkout_attempts
            WHERE aceite_id = ? AND is_current = 1
          )
          AND EXISTS (
            SELECT 1 FROM aceites
            WHERE id = ? AND COALESCE(asaas_checkout_id, '') = COALESCE(?, '')
          )
      `).bind(
        parseClaim(previous.checkoutId)?.id || null,
        parseClaim(previous.checkoutId)?.id || null,
        now,
        aceiteId,
        parseClaim(previous.checkoutId)?.id || null,
        parseClaim(previous.checkoutId)?.id || null,
        parseClaim(previous.checkoutId) ? null : previous.checkoutId,
        parseClaim(previous.checkoutId) ? null : previous.checkoutId,
        aceiteId,
        aceiteId,
        previous.checkoutId
      ));
    }

    const results = await db.batch(statements);
    const released = Number(results[1]?.meta?.changes || 0) === 1;

    log('info', 'checkout_claim_released', {
      request_id: requestId,
      aceite_id: aceiteId,
      released
    });
  } catch (error) {
    log('error', 'checkout_claim_release_failed', {
      request_id: requestId,
      aceite_id: aceiteId,
      ...errorFields(error)
    });
  }
}

async function loadAceite(db, aceiteId) {
  return db.prepare(`
    SELECT id, created_at, nome, cpf_cnpj, email, whatsapp, marca, status,
           asaas_checkout_id, asaas_checkout_url, payment_status, paid_at
    FROM aceites WHERE id = ? LIMIT 1
  `).bind(aceiteId).first();
}

async function loadAttempt(db, attemptId) {
  return db.prepare(`
    SELECT id, aceite_id, checkout_id, checkout_url, state, is_current
    FROM asaas_checkout_attempts WHERE id = ? LIMIT 1
  `).bind(attemptId).first();
}

export async function onRequestPost(context) {
  const requestId = crypto.randomUUID();
  let aceiteId = null;

  try {
    if (!context.env.ACEITES_DB) {
      log('error', 'checkout_configuration_error', { request_id: requestId, binding: 'ACEITES_DB' });
      return json({ error: 'Banco de aceites não configurado.' }, 503);
    }

    const environment = configuredEnvironment(context.env);
    if (!environment) {
      log('error', 'checkout_configuration_error', { request_id: requestId, binding: 'ASAAS_ENV' });
      return json({ error: 'Ambiente de pagamento não configurado corretamente.' }, 503);
    }

    if (!context.env.ASAAS_API_KEY) {
      log('error', 'checkout_configuration_error', { request_id: requestId, binding: 'ASAAS_API_KEY' });
      return json({ error: 'Integração de pagamento ainda não configurada.' }, 503);
    }

    const base = publicBase(context.request, context.env);
    if (!base) {
      log('error', 'checkout_configuration_error', { request_id: requestId, binding: 'PUBLIC_BASE_URL' });
      return json({ error: 'Endereço público do pagamento não configurado corretamente.' }, 503);
    }

    const unsafeRequest = validateSameOriginJson(context.request);
    if (unsafeRequest) return json({ error: unsafeRequest.error }, unsafeRequest.status);

    let body;
    try {
      body = await readBoundedJson(context.request, MAX_REQUEST_BYTES);
    } catch (error) {
      if (!(error instanceof JsonBodyError)) throw error;
      return json({
        error: error.code === 'BODY_TOO_LARGE'
          ? 'Requisição excede o tamanho permitido.'
          : 'Requisição inválida.'
      }, error.status);
    }

    aceiteId = String(body?.aceite_id || '').trim();
    if (!aceiteId) return json({ error: 'Aceite não informado.' }, 400);

    const db = context.env.ACEITES_DB;
    const aceite = await loadAceite(db, aceiteId);

    if (!aceite) return json({ error: 'Aceite não encontrado.' }, 404);

    if (isPaid(aceite)) {
      log('info', 'checkout_already_paid', { request_id: requestId, aceite_id: aceite.id });
      return json({ error: 'O pagamento deste aceite já foi confirmado.', paid: true }, 409);
    }

    const currentCheckoutId = String(aceite.asaas_checkout_id || '').trim();
    const currentClaim = parseClaim(currentCheckoutId);
    let recoverableClaim = null;

    if (isClaimMarker(currentCheckoutId)) {
      if (!currentClaim) {
        log('error', 'checkout_claim_malformed', {
          request_id: requestId,
          aceite_id: aceite.id
        });
        return json({
          error: 'Identificamos uma inconsistência no estado do pagamento. Entre em contato com a Rumos antes de tentar novamente.',
          code: 'CHECKOUT_STATE_REQUIRES_REVIEW'
        }, 409);
      }

      const claimAge = Date.now() - currentClaim.createdAt;
      if (claimAge < CLAIM_TTL_MS) {
        log('info', 'checkout_creation_in_progress', {
          request_id: requestId,
          aceite_id: aceite.id,
          claim_age_ms: Math.max(0, claimAge)
        });
        return json({ error: 'A criação do pagamento já está em andamento ou aguardando reconciliação. Tente novamente mais tarde.' }, 409);
      }
      recoverableClaim = currentCheckoutId;
    } else if (currentCheckoutId && !isRetryTerminal(aceite)) {
      const existingLink = trustedCheckoutUrl(environment, currentCheckoutId, aceite.asaas_checkout_url);
      if (existingLink.usedFallback && aceite.asaas_checkout_url) {
        log('error', 'stored_checkout_untrusted_link_replaced', {
          request_id: requestId,
          aceite_id: aceite.id,
          checkout_id: currentCheckoutId
        });
      }
      log('info', 'checkout_reused', { request_id: requestId, aceite_id: aceite.id });
      return json({ ok: true, checkout_id: currentCheckoutId, checkout_url: existingLink.url, reused: true });
    }

    const previous = {
      checkoutId: aceite.asaas_checkout_id || null,
      checkoutUrl: aceite.asaas_checkout_url || null,
      paymentStatus: aceite.payment_status || null,
      status: aceite.status || 'aceito',
      paidAt: aceite.paid_at || null,
      createdAt: aceite.created_at || new Date().toISOString()
    };
    const attemptId = crypto.randomUUID();
    const claim = `${CLAIM_PREFIX}${Date.now()}:${attemptId}`;
    const attemptReference = `${aceite.id}:${attemptId}`;
    const claimResult = await acquireClaim(
      db, aceite, previous, claim, attemptId, attemptReference, recoverableClaim
    );

    if (!claimResult.acquired) {
      log('info', 'checkout_claim_conflict', { request_id: requestId, aceite_id: aceite.id });
      return json({ error: 'A criação do pagamento já foi iniciada em outra solicitação. Aguarde alguns instantes.' }, 409);
    }

    log('info', 'checkout_claim_acquired', {
      request_id: requestId,
      aceite_id: aceite.id,
      recovered: Boolean(recoverableClaim),
      replaced_terminal_checkout: isRetryTerminal(aceite)
    });

    const callbackBase = `${base}/marcas/aceite/pagamento/`;
    const callbackIdentity = `&attempt=${encodeURIComponent(attemptId)}`;
    const payload = {
      billingTypes: ['PIX', 'CREDIT_CARD'],
      chargeTypes: ['DETACHED'],
      minutesToExpire: 60,
      externalReference: attemptReference,
      callback: {
        successUrl: `${callbackBase}?status=sucesso&aceite=${encodeURIComponent(aceite.id)}${callbackIdentity}`,
        cancelUrl: `${callbackBase}?status=cancelado&aceite=${encodeURIComponent(aceite.id)}${callbackIdentity}`,
        expiredUrl: `${callbackBase}?status=expirado&aceite=${encodeURIComponent(aceite.id)}${callbackIdentity}`
      },
      items: [{
        externalReference: 'analise-viabilidade-rumos',
        name: 'Análise de Marca',
        // A identificação da marca não é necessária para cobrar nem reconciliar
        // o pagamento e pode ser confidencial nesta etapa preliminar.
        description: 'Análise de viabilidade jurídica de marca',
        quantity: 1,
        value: 390
      }]
    };

    let response;
    try {
      response = await fetch(`${apiBase(environment)}/checkouts`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'access_token': context.env.ASAAS_API_KEY,
          'user-agent': 'RumosAdvocacia-Checkout/1.0 (+https://rumosadv.com.br)'
        },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      // O resultado de uma falha de rede é ambíguo: o Asaas pode ter criado o
      // checkout. Mantemos o claim para o webhook reconciliar via externalReference.
      log('error', 'asaas_checkout_network_error', {
        request_id: requestId,
        aceite_id: aceite.id,
        ...errorFields(error)
      });
      return json({ error: 'Não foi possível confirmar a criação do pagamento. Aguarde alguns instantes antes de tentar novamente.' }, 502);
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const deterministicRejection = isDeterministicProviderRejection(response.status);
      log('error', 'asaas_checkout_rejected', {
        request_id: requestId,
        aceite_id: aceite.id,
        provider_status: response.status,
        claim_released: deterministicRejection
      });
      if (deterministicRejection) {
        await releaseKnownFailedClaim(
          db, claim, previous, aceite.id, attemptId, requestId, response.status
        );
      } else {
        log('info', 'checkout_claim_preserved', {
          request_id: requestId,
          aceite_id: aceite.id,
          provider_status: response.status,
          reason: 'provider_result_ambiguous'
        });
      }
      const detail = deterministicRejection
        ? data?.errors?.[0]?.description || 'Não foi possível iniciar o pagamento.'
        : 'Não foi possível confirmar a criação do pagamento. Aguarde a reconciliação antes de tentar novamente.';
      return json({ error: detail }, 502);
    }

    const createdCheckoutId = String(data.id || '').trim();
    if (!createdCheckoutId) {
      // Uma resposta 2xx sem identificador também é ambígua; não liberamos o claim.
      log('error', 'asaas_checkout_invalid_response', {
        request_id: requestId,
        aceite_id: aceite.id,
        provider_status: response.status
      });
      return json({ error: 'Resposta inválida do provedor de pagamento. Aguarde alguns instantes antes de tentar novamente.' }, 502);
    }
    const checkoutLink = trustedCheckoutUrl(environment, createdCheckoutId, data.link);
    const createdCheckoutUrl = checkoutLink.url;
    if (checkoutLink.usedFallback && data.link) {
      log('error', 'asaas_checkout_untrusted_link_replaced', {
        request_id: requestId,
        aceite_id: aceite.id,
        checkout_id: createdCheckoutId
      });
    }

    let persisted = false;
    try {
      const updates = await db.batch([db.prepare(`
        /* checkout_attempt_persist */
        UPDATE asaas_checkout_attempts
        SET checkout_id = COALESCE(checkout_id, ?), checkout_url = ?,
            state = CASE WHEN state = 'CREATING' THEN 'AWAITING_PAYMENT' ELSE state END,
            updated_at = ?
        WHERE id = ? AND aceite_id = ?
          AND (checkout_id IS NULL OR checkout_id = ?)
          AND EXISTS (
            SELECT 1 FROM aceites
            WHERE id = ? AND asaas_checkout_id IN (?, ?)
          )
      `).bind(
        createdCheckoutId,
        createdCheckoutUrl,
        new Date().toISOString(),
        attemptId,
        aceite.id,
        createdCheckoutId,
        aceite.id,
        claim,
        createdCheckoutId
      ), db.prepare(`
        /* checkout_summary_persist */
        UPDATE aceites
        SET asaas_checkout_id = ?, asaas_checkout_url = ?,
            payment_status = 'AWAITING_PAYMENT', status = 'aguardando_pagamento'
        WHERE id = ? AND asaas_checkout_id = ? AND payment_status = 'CREATING'
          AND EXISTS (
            SELECT 1 FROM asaas_checkout_attempts
            WHERE id = ? AND aceite_id = ? AND checkout_id = ?
              AND state = 'AWAITING_PAYMENT' AND is_current = 1
          )
      `).bind(
        createdCheckoutId,
        createdCheckoutUrl,
        aceite.id,
        claim,
        attemptId,
        aceite.id,
        createdCheckoutId
      )]);
      persisted = Number(updates[1]?.meta?.changes || 0) === 1;
    } catch (error) {
      log('error', 'checkout_persistence_error', {
        request_id: requestId,
        aceite_id: aceite.id,
        checkout_id: createdCheckoutId,
        ...errorFields(error)
      });
    }

    let current;
    let currentAttempt;
    try {
      [current, currentAttempt] = await Promise.all([
        loadAceite(db, aceite.id),
        loadAttempt(db, attemptId)
      ]);
    } catch (error) {
      log('error', 'checkout_reconciliation_read_failed', {
        request_id: requestId,
        aceite_id: aceite.id,
        checkout_id: createdCheckoutId,
        ...errorFields(error)
      });
      return json({ error: 'O pagamento foi encaminhado, mas o estado local não pôde ser confirmado. Não tente novamente por enquanto.' }, 503);
    }

    if (isPaid(current)) {
      log('info', 'checkout_paid_during_persistence', {
        request_id: requestId,
        aceite_id: aceite.id,
        checkout_id: createdCheckoutId
      });
      return json({ error: 'O pagamento deste aceite já foi confirmado.', paid: true }, 409);
    }

    if (isRetryTerminal(current)) {
      log('info', 'checkout_terminal_during_persistence', {
        request_id: requestId,
        aceite_id: aceite.id,
        checkout_id: createdCheckoutId,
        payment_status: normalizedStatus(current?.payment_status)
      });
      return json({ error: 'O estado do pagamento foi alterado durante a criação. Gere uma nova etapa de pagamento.' }, 409);
    }

    const currentCheckoutIdAfterWrite = String(current?.asaas_checkout_id || '').trim();
    const stillOwnsAttempt = currentCheckoutIdAfterWrite === claim;
    const sameCheckoutWasReconciled = currentCheckoutIdAfterWrite === createdCheckoutId;
    if (!stillOwnsAttempt && !sameCheckoutWasReconciled) {
      log('error', 'checkout_state_conflict', {
        request_id: requestId,
        aceite_id: aceite.id,
        checkout_id: createdCheckoutId,
        reason: current ? 'another_attempt_owns_aceite' : 'aceite_missing'
      });
      return json({
        error: 'O pagamento foi criado, mas outra tentativa assumiu este aceite. Não tente novamente e entre em contato com a Rumos.',
        code: 'CHECKOUT_STATE_REQUIRES_REVIEW'
      }, 409);
    }

    const attemptState = normalizedStatus(currentAttempt?.state);
    const attemptSafelyLinked = currentAttempt?.id === attemptId
      && currentAttempt?.aceite_id === aceite.id
      && currentAttempt?.checkout_id === createdCheckoutId
      && attemptState === 'AWAITING_PAYMENT'
      && Number(currentAttempt?.is_current) === 1;
    if (!attemptSafelyLinked) {
      log('error', 'checkout_attempt_link_conflict', {
        request_id: requestId,
        aceite_id: aceite.id,
        checkout_id: createdCheckoutId,
        attempt_id: attemptId,
        attempt_state: attemptState || null
      });
      return json({
        error: 'O pagamento foi criado, mas seu vínculo interno não pôde ser confirmado. Não tente novamente e entre em contato com a Rumos.',
        code: 'CHECKOUT_STATE_REQUIRES_REVIEW'
      }, 503);
    }

    if (persisted) {
      log('info', 'checkout_created', {
        request_id: requestId,
        aceite_id: aceite.id,
        checkout_id: createdCheckoutId
      });
      return json({
        ok: true,
        checkout_id: createdCheckoutId,
        checkout_url: trustedCheckoutUrl(
          environment,
          createdCheckoutId,
          current.asaas_checkout_url || createdCheckoutUrl
        ).url
      }, 201);
    }

    const safeCheckoutUrl = sameCheckoutWasReconciled
      ? trustedCheckoutUrl(environment, createdCheckoutId, current.asaas_checkout_url).url
      : createdCheckoutUrl;
    log(stillOwnsAttempt ? 'error' : 'info', stillOwnsAttempt
      ? 'checkout_reconciliation_pending'
      : 'checkout_reconciled_during_persistence', {
      request_id: requestId,
      aceite_id: aceite.id,
      checkout_id: createdCheckoutId
    });

    return json({
      ok: true,
      checkout_id: createdCheckoutId,
      checkout_url: safeCheckoutUrl,
      ...(stillOwnsAttempt ? { reconciliation_pending: true } : {})
    }, 201);
  } catch (error) {
    log('error', 'checkout_unhandled_error', {
      request_id: requestId,
      aceite_id: aceiteId,
      ...errorFields(error)
    });
    return json({ error: 'Não foi possível iniciar o pagamento.' }, 500);
  }
}

export function onRequestGet() {
  return json({ error: 'Método não permitido.' }, 405);
}
