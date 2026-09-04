const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  }
});

const EVENT_TRANSITIONS = {
  CHECKOUT_CREATED: 'AWAITING_PAYMENT',
  CHECKOUT_CANCELED: 'CANCELED',
  CHECKOUT_EXPIRED: 'EXPIRED',
  CHECKOUT_PAID: 'PAID'
};

const MAX_PAYLOAD_BYTES = 1_000_000;
const MAX_JSON_DEPTH = 32;
const CALLBACK_PATH = '/marcas/aceite/pagamento/';
const LEGACY_REDACTED_PAYLOAD = '{"legacy_redacted":true}';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACEITE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const encoder = new TextEncoder();

class PayloadTooLargeError extends Error {
  constructor() {
    super('Webhook payload exceeds the configured limit.');
    this.name = 'PayloadTooLargeError';
  }
}

async function constantTimeEqual(provided, expected) {
  const [providedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(provided)),
    crypto.subtle.digest('SHA-256', encoder.encode(expected))
  ]);
  const providedBytes = new Uint8Array(providedHash);
  const expectedBytes = new Uint8Array(expectedHash);
  if (typeof crypto.subtle.timingSafeEqual === 'function') {
    return crypto.subtle.timingSafeEqual(providedBytes, expectedBytes);
  }
  let mismatch = 0;
  for (let index = 0; index < providedBytes.length; index += 1) {
    mismatch |= providedBytes[index] ^ expectedBytes[index];
  }
  return mismatch === 0;
}

function log(level, code, request, details = {}) {
  const entry = {
    level,
    component: 'asaas_webhook',
    code,
    at: new Date().toISOString(),
    trace_id: request.headers.get('cf-ray') || null,
    ...details
  };
  const method = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log';
  console[method](JSON.stringify(entry));
}

function cleanField(value, maximumLength) {
  if (typeof value !== 'string') return null;
  const result = value.trim();
  if (!result || result.length > maximumLength || /[\u0000-\u001f\u007f]/.test(result)) return null;
  return result;
}

async function readJsonWithLimit(request) {
  if (!request.body) throw new SyntaxError('Missing JSON body.');
  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_PAYLOAD_BYTES) {
        try { await reader.cancel(); } catch { /* best effort */ }
        throw new PayloadTooLargeError();
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(body));
}

function canonicalJson(value, depth = 0) {
  if (depth > MAX_JSON_DEPTH) throw new RangeError('Webhook JSON is too deeply nested.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('Webhook JSON contains a non-finite number.');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item, depth + 1)).join(',')}]`;
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1)}`).join(',')}}`;
  }
  throw new TypeError('Webhook JSON contains an unsupported value.');
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function redactedPayload(event) {
  const result = { id: cleanField(event?.id, 200), event: cleanField(event?.event, 100) };
  const checkout = {};
  for (const [field, maximum] of [['id', 200], ['externalReference', 256], ['status', 100]]) {
    const value = cleanField(event?.checkout?.[field], maximum);
    if (value) checkout[field] = value;
  }
  const callback = event?.checkout?.callback;
  if (callback && typeof callback === 'object' && !Array.isArray(callback)) {
    const selected = {};
    for (const field of ['successUrl', 'cancelUrl', 'expiredUrl']) {
      const value = cleanField(callback[field], 2_048);
      if (value) selected[field] = value;
    }
    if (Object.keys(selected).length) checkout.callback = selected;
  }
  if (Object.keys(checkout).length) result.checkout = checkout;
  return canonicalJson(result);
}

function parseExternalReference(value) {
  const reference = cleanField(value, 256);
  if (!reference) return null;
  const separator = reference.lastIndexOf(':');
  if (separator > 0) {
    const aceiteId = reference.slice(0, separator);
    const attemptId = reference.slice(separator + 1);
    if (ACEITE_PATTERN.test(aceiteId) && UUID_PATTERN.test(attemptId)) {
      return { aceiteId, attemptId: attemptId.toLowerCase(), legacy: false, raw: reference };
    }
  }
  return ACEITE_PATTERN.test(reference)
    ? { aceiteId: reference, attemptId: null, legacy: true, raw: reference }
    : null;
}

function parseClaim(value) {
  const match = /^creating:(\d{13}):([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.exec(String(value || '').trim());
  return match ? { createdAt: Number(match[1]), attemptId: match[2].toLowerCase() } : null;
}

function trustedOrigins(request, env) {
  const origins = new Set();
  const add = value => {
    try {
      const parsed = new URL(String(value || ''));
      if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) origins.add(parsed.origin);
    } catch { /* invalid origins are not trusted */ }
  };
  add(request.url);
  if (env.PUBLIC_BASE_URL) add(env.PUBLIC_BASE_URL);
  return origins;
}

function callbackIdentity(checkout, request, env) {
  if (!Object.prototype.hasOwnProperty.call(checkout || {}, 'callback')) {
    return { present: false, valid: true, identity: null };
  }
  const callback = checkout?.callback;
  if (!callback || typeof callback !== 'object' || Array.isArray(callback)) {
    return { present: true, valid: false, reason: 'callback_invalid' };
  }
  const fields = [['successUrl', 'sucesso'], ['cancelUrl', 'cancelado'], ['expiredUrl', 'expirado']];
  const origins = trustedOrigins(request, env);
  if (!origins.size) return { present: true, valid: false, reason: 'callback_origin_unavailable' };
  const identities = [];
  for (const [field, expectedStatus] of fields) {
    const raw = cleanField(callback[field], 2_048);
    if (!raw) return { present: true, valid: false, reason: 'callback_incomplete' };
    let parsed;
    try { parsed = new URL(raw); } catch { return { present: true, valid: false, reason: 'callback_url_invalid' }; }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password
      || !origins.has(parsed.origin) || parsed.pathname !== CALLBACK_PATH || parsed.hash) {
      return { present: true, valid: false, reason: 'callback_url_untrusted' };
    }
    for (const key of parsed.searchParams.keys()) {
      if (!['status', 'aceite', 'attempt'].includes(key)) {
        return { present: true, valid: false, reason: 'callback_query_invalid' };
      }
    }
    const statuses = parsed.searchParams.getAll('status');
    const aceiteIds = parsed.searchParams.getAll('aceite');
    const attemptIds = parsed.searchParams.getAll('attempt');
    if (statuses.length !== 1 || statuses[0] !== expectedStatus
      || aceiteIds.length !== 1 || !ACEITE_PATTERN.test(aceiteIds[0])
      || attemptIds.length > 1 || (attemptIds.length === 1 && !UUID_PATTERN.test(attemptIds[0]))) {
      return { present: true, valid: false, reason: 'callback_query_invalid' };
    }
    identities.push({ aceiteId: aceiteIds[0], attemptId: attemptIds[0]?.toLowerCase() || null });
  }
  const first = identities[0];
  if (identities.some(identity => identity.aceiteId !== first.aceiteId
    || identity.attemptId !== first.attemptId)) {
    return { present: true, valid: false, reason: 'callbacks_diverge' };
  }
  return { present: true, valid: true, identity: first };
}

function eventOccurredAt(event, receivedAt) {
  const raw = cleanField(event?.dateCreated, 100);
  const timestamp = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : receivedAt;
}

const ATTEMPT_COLUMNS = `id, aceite_id, external_reference, checkout_id, checkout_url, state,
  is_current, created_at, updated_at, superseded_at, paid_at, last_event, last_event_at, failure_reason`;

async function findAttempt(db, column, value) {
  if (!value) return null;
  if (!new Set(['id', 'external_reference', 'checkout_id']).has(column)) throw new TypeError('Invalid lookup.');
  return db.prepare(`SELECT ${ATTEMPT_COLUMNS} FROM asaas_checkout_attempts WHERE ${column} = ? LIMIT 1`)
    .bind(value).first();
}

async function findCurrentAttempt(db, aceiteId) {
  return db.prepare(`SELECT ${ATTEMPT_COLUMNS} FROM asaas_checkout_attempts
    WHERE aceite_id = ? AND is_current = 1 LIMIT 1`).bind(aceiteId).first();
}

async function findAceiteById(db, aceiteId) {
  return db.prepare(`SELECT id, created_at, status, asaas_checkout_id, asaas_checkout_url,
    payment_status, paid_at FROM aceites WHERE id = ? LIMIT 1`).bind(aceiteId).first();
}

async function findAceiteByCheckout(db, checkoutId) {
  if (!checkoutId) return null;
  return db.prepare(`SELECT id, created_at, status, asaas_checkout_id, asaas_checkout_url,
    payment_status, paid_at FROM aceites WHERE asaas_checkout_id = ? LIMIT 1`).bind(checkoutId).first();
}

function uniqueRows(rows) {
  const result = [];
  const seen = new Set();
  for (const row of rows.filter(Boolean)) {
    if (!seen.has(row.id)) { seen.add(row.id); result.push(row); }
  }
  return result;
}

async function resolveAttempt(db, event, checkoutId, externalReference, callbackResult, now) {
  const rawReference = cleanField(event?.checkout?.externalReference, 256);
  if (event?.checkout && Object.prototype.hasOwnProperty.call(event.checkout, 'externalReference')
    && event.checkout.externalReference != null && !externalReference) {
    return { matched: false, reason: 'external_reference_invalid' };
  }
  if (!callbackResult.valid) return { matched: false, reason: callbackResult.reason };
  if (!checkoutId) return { matched: false, reason: 'checkout_id_missing' };
  const callback = callbackResult.identity;
  if (externalReference && callback && externalReference.aceiteId !== callback.aceiteId) {
    return { matched: false, reason: 'callback_external_reference_conflict' };
  }
  if (externalReference?.attemptId && callback?.attemptId
    && externalReference.attemptId !== callback.attemptId) {
    return { matched: false, reason: 'callback_external_reference_conflict' };
  }
  const exactIds = new Set([externalReference?.attemptId, callback?.attemptId].filter(Boolean));
  if (exactIds.size > 1) return { matched: false, reason: 'attempt_identity_conflict' };
  const exactId = [...exactIds][0] || null;
  const [byCheckout, byReference, byId, legacyByCheckout] = await Promise.all([
    findAttempt(db, 'checkout_id', checkoutId),
    rawReference ? findAttempt(db, 'external_reference', rawReference) : Promise.resolve(null),
    exactId ? findAttempt(db, 'id', exactId) : Promise.resolve(null),
    findAceiteByCheckout(db, checkoutId)
  ]);
  const attempts = uniqueRows([byCheckout, byReference, byId]);
  if (attempts.length > 1) return { matched: false, reason: 'attempt_sources_conflict' };
  const attempt = attempts[0] || null;
  const aceiteIds = new Set([
    externalReference?.aceiteId, callback?.aceiteId, legacyByCheckout?.id, attempt?.aceite_id
  ].filter(Boolean));
  if (aceiteIds.size !== 1) {
    return { matched: false, reason: aceiteIds.size ? 'aceite_sources_conflict' : 'aceite_not_found' };
  }
  const aceiteId = [...aceiteIds][0];
  const aceite = legacyByCheckout?.id === aceiteId ? legacyByCheckout : await findAceiteById(db, aceiteId);
  if (!aceite) return { matched: false, reason: 'aceite_not_found', aceiteId };
  if (attempt) {
    if (attempt.aceite_id !== aceiteId) return { matched: false, reason: 'attempt_ownership_conflict', aceiteId, attemptId: attempt.id };
    if (attempt.checkout_id && attempt.checkout_id !== checkoutId) return { matched: false, reason: 'attempt_checkout_conflict', aceiteId, attemptId: attempt.id };
    if (exactId && attempt.id.toLowerCase() !== exactId) return { matched: false, reason: 'attempt_identity_conflict', aceiteId, attemptId: attempt.id };
    if (externalReference?.attemptId && attempt.external_reference !== rawReference) {
      return { matched: false, reason: 'external_reference_attempt_conflict', aceiteId, attemptId: attempt.id };
    }
    return {
      matched: true, aceite, attempt, attemptId: attempt.id,
      isCurrent: Number(attempt.is_current) === 1, inferred: false,
      source: byCheckout ? 'attempt_checkout_id' : byReference ? 'attempt_external_reference' : 'attempt_id'
    };
  }
  const currentAttempt = await findCurrentAttempt(db, aceiteId);
  const currentCheckoutId = String(aceite.asaas_checkout_id || '').trim();
  const currentClaim = parseClaim(currentCheckoutId);
  let attemptId = exactId;
  if (!attemptId && currentClaim) return { matched: false, reason: 'legacy_identity_cannot_replace_claim', aceiteId };
  if (!attemptId && currentCheckoutId && currentCheckoutId !== checkoutId) {
    return { matched: false, reason: 'legacy_checkout_ownership_conflict', aceiteId };
  }
  if (!attemptId) attemptId = crypto.randomUUID();
  let isCurrent = currentClaim?.attemptId === attemptId || currentCheckoutId === checkoutId
    || (!currentCheckoutId && !currentAttempt) || currentAttempt?.id === attemptId;
  if (currentAttempt && currentAttempt.id !== attemptId && isCurrent) {
    return { matched: false, reason: 'current_attempt_conflict', aceiteId, attemptId };
  }
  const attemptReference = externalReference?.attemptId
    ? rawReference
    : callback?.attemptId ? `${aceiteId}:${attemptId}` : `legacy:${aceiteId}:${checkoutId}`;
  const inferred = {
    id: attemptId, aceite_id: aceiteId, external_reference: attemptReference,
    checkout_id: null,
    checkout_url: currentCheckoutId === checkoutId ? aceite.asaas_checkout_url || null : null,
    state: 'CREATING', is_current: isCurrent ? 1 : 0,
    created_at: aceite.created_at || now, updated_at: now,
    failure_reason: 'INFERRED_FROM_WEBHOOK'
  };
  return {
    matched: true, aceite, attempt: inferred, attemptId, isCurrent, inferred: true,
    source: currentCheckoutId === checkoutId ? 'legacy_checkout_summary' : 'trusted_event_identity'
  };
}

async function existingAudit(db, eventId) {
  return db.prepare(`SELECT id, event, checkout_id, received_at, payload, processing_status,
    quarantine_reason, aceite_id, attempt_id, processed_at, payload_sha256
    FROM asaas_webhook_events WHERE id = ? LIMIT 1`).bind(eventId).first();
}

function duplicateResponse(stored) {
  if (stored.processing_status === 'PROCESSED') return json({ ok: true, processed: true, duplicate: true });
  if (stored.processing_status === 'IGNORED') {
    return json({ received: true, processed: false, ignored: true, duplicate: true });
  }
  return json({ received: true, processed: false, quarantined: true,
    reason: 'manual_review_required', duplicate: true });
}

async function markCollision(db, eventId, now) {
  await db.prepare(`/* audit_collision */ UPDATE asaas_webhook_events
    SET processing_status = 'QUARANTINED', quarantine_reason = 'EVENT_ID_COLLISION',
        processed_at = COALESCE(processed_at, ?)
    WHERE id = ?`).bind(now, eventId).run();
}

async function inspectExistingAudit(db, stored, eventName, checkoutId, hash, redacted, now) {
  if (!stored) return { proceed: true, existing: false };
  let storedHash = cleanField(stored.payload_sha256, 64);
  const isRedactedLegacy = stored.processing_status === 'LEGACY_UNKNOWN'
    && stored.payload === LEGACY_REDACTED_PAYLOAD;
  if (!storedHash) {
    if (!isRedactedLegacy) {
      try { storedHash = await sha256Hex(canonicalJson(JSON.parse(stored.payload))); } catch { storedHash = null; }
    }
    if ((isRedactedLegacy || storedHash === hash) && stored.event === eventName
      && String(stored.checkout_id || '') === String(checkoutId || '')) {
      await db.prepare(`/* audit_legacy_adopt */ UPDATE asaas_webhook_events
        SET payload = ?, payload_sha256 = ?, processing_status = 'RECEIVED',
            quarantine_reason = NULL, processed_at = NULL
        WHERE id = ? AND payload_sha256 IS NULL`).bind(redacted, hash, stored.id).run();
      return { proceed: true, existing: true, legacy: true };
    }
  }
  if (storedHash !== hash || stored.event !== eventName
    || String(stored.checkout_id || '') !== String(checkoutId || '')) {
    await markCollision(db, stored.id, now);
    return { proceed: false, collision: true, response: duplicateResponse({ processing_status: 'QUARANTINED' }) };
  }
  if (['RECEIVED', 'LEGACY_UNKNOWN'].includes(stored.processing_status)) {
    return { proceed: true, existing: true };
  }
  return { proceed: false, duplicate: true, response: duplicateResponse(stored) };
}

function guard() {
  return `EXISTS (SELECT 1 FROM asaas_webhook_events
    WHERE id = ? AND payload_sha256 = ? AND processing_status IN ('RECEIVED', 'LEGACY_UNKNOWN'))`;
}

function auditInsert(db, base) {
  return db.prepare(`/* audit_insert */ INSERT OR IGNORE INTO asaas_webhook_events (
      id, event, checkout_id, received_at, payload, processing_status,
      quarantine_reason, aceite_id, attempt_id, processed_at, payload_sha256
    ) VALUES (?, ?, ?, ?, ?, 'RECEIVED', NULL, NULL, NULL, NULL, ?)`)
    .bind(base.eventId, base.eventName, base.checkoutId, base.receivedAt, base.redacted, base.payloadHash);
}

function auditFinalize(db, base, status, reason, aceiteId, attemptId, requireAttempt) {
  return db.prepare(`/* audit_finalize */ UPDATE asaas_webhook_events
    SET processing_status = ?, quarantine_reason = ?, aceite_id = ?, attempt_id = ?, processed_at = ?
    WHERE id = ? AND payload_sha256 = ? AND processing_status IN ('RECEIVED', 'LEGACY_UNKNOWN')
      AND (? = 0 OR EXISTS (SELECT 1 FROM asaas_checkout_attempts
        WHERE id = ? AND aceite_id = ? AND checkout_id = ? AND last_event = ?))`)
    .bind(status, reason || null, aceiteId || null, attemptId || null, base.receivedAt,
      base.eventId, base.payloadHash, requireAttempt ? 1 : 0, attemptId || '', aceiteId || '',
      requireAttempt ? base.checkoutId : '', requireAttempt ? base.eventName : '');
}

function attemptInsert(db, base, resolution) {
  const row = resolution.attempt;
  return db.prepare(`/* attempt_insert */ INSERT OR IGNORE INTO asaas_checkout_attempts (
      id, aceite_id, external_reference, checkout_id, checkout_url, state,
      is_current, created_at, updated_at, superseded_at, paid_at,
      last_event, last_event_at, failure_reason
    ) SELECT ?, ?, ?, NULL, ?, 'CREATING', ?, ?, ?, NULL, NULL, NULL, NULL, ?
      WHERE ${guard()}`).bind(
    row.id, row.aceite_id, row.external_reference, row.checkout_url || null,
    resolution.isCurrent ? 1 : 0, row.created_at || base.receivedAt,
    base.receivedAt, row.failure_reason || null, base.eventId, base.payloadHash
  );
}

function attemptAdopt(db, base, resolution, checkoutId) {
  return db.prepare(`/* attempt_adopt_checkout */ UPDATE asaas_checkout_attempts
    SET checkout_id = COALESCE(checkout_id, ?), updated_at = ?
    WHERE id = ? AND aceite_id = ? AND (checkout_id IS NULL OR checkout_id = ?)
      AND ${guard()}`).bind(checkoutId, base.receivedAt, resolution.attemptId,
    resolution.aceite.id, checkoutId, base.eventId, base.payloadHash);
}

function attemptState(db, base, resolution, checkoutId, eventAt) {
  const desired = EVENT_TRANSITIONS[base.eventName];
  return db.prepare(`/* attempt_state */ UPDATE asaas_checkout_attempts
    SET state = CASE
          WHEN ? = 'PAID' THEN 'PAID'
          WHEN state = 'PAID' THEN state
          WHEN ? = 'AWAITING_PAYMENT' AND state IN ('CANCELED','EXPIRED','SUPERSEDED','REQUIRES_REVIEW') THEN state
          WHEN ? = 'CANCELED' AND state = 'EXPIRED' THEN state
          WHEN ? = 'EXPIRED' AND state = 'CANCELED' THEN state
          ELSE ? END,
        paid_at = CASE WHEN ? = 'PAID' THEN COALESCE(paid_at, ?) ELSE paid_at END,
        last_event = ?, last_event_at = ?, updated_at = ?
    WHERE id = ? AND aceite_id = ? AND checkout_id = ? AND ${guard()}`).bind(
    desired, desired, desired, desired, desired, desired, eventAt,
    base.eventName, eventAt, eventAt, resolution.attemptId, resolution.aceite.id,
    checkoutId, base.eventId, base.payloadHash
  );
}

function paidCanonicalClear(db, base, resolution, eventAt) {
  return db.prepare(`/* paid_canonical_clear */ UPDATE asaas_checkout_attempts
    SET is_current = 0, state = CASE WHEN state = 'PAID' THEN state ELSE 'SUPERSEDED' END,
        superseded_at = COALESCE(superseded_at, ?), updated_at = ?
    WHERE aceite_id = ? AND id <> ? AND is_current = 1
      AND (SELECT COUNT(*) FROM asaas_checkout_attempts WHERE aceite_id = ? AND state = 'PAID') = 1
      AND ${guard()}`).bind(eventAt, eventAt, resolution.aceite.id, resolution.attemptId,
    resolution.aceite.id, base.eventId, base.payloadHash);
}

function paidCanonicalSet(db, base, resolution, eventAt) {
  return db.prepare(`/* paid_canonical_set */ UPDATE asaas_checkout_attempts
    SET is_current = 1, updated_at = ?
    WHERE id = ? AND aceite_id = ? AND state = 'PAID'
      AND (SELECT COUNT(*) FROM asaas_checkout_attempts WHERE aceite_id = ? AND state = 'PAID') = 1
      AND ${guard()}`).bind(eventAt, resolution.attemptId, resolution.aceite.id,
    resolution.aceite.id, base.eventId, base.payloadHash);
}

function doublePaymentMark(db, base, resolution, eventAt) {
  return db.prepare(`/* double_payment_mark */ UPDATE asaas_checkout_attempts
    SET failure_reason = 'DOUBLE_PAYMENT_REVIEW', updated_at = ?
    WHERE aceite_id = ? AND state = 'PAID'
      AND (SELECT COUNT(*) FROM asaas_checkout_attempts WHERE aceite_id = ? AND state = 'PAID') > 1
      AND ${guard()}`).bind(eventAt, resolution.aceite.id, resolution.aceite.id,
    base.eventId, base.payloadHash);
}

function paidAceite(db, base, resolution, checkoutId, eventAt) {
  return db.prepare(`/* aceite_paid */ UPDATE aceites
    SET asaas_checkout_id = CASE WHEN UPPER(COALESCE(payment_status,'')) = 'PAID' OR paid_at IS NOT NULL
          THEN asaas_checkout_id ELSE ? END,
        asaas_checkout_url = CASE WHEN UPPER(COALESCE(payment_status,'')) = 'PAID' OR paid_at IS NOT NULL
          THEN asaas_checkout_url ELSE (SELECT checkout_url FROM asaas_checkout_attempts WHERE id = ?) END,
        payment_status = 'PAID', paid_at = COALESCE(paid_at, ?),
        status = CASE WHEN (SELECT COUNT(*) FROM asaas_checkout_attempts
          WHERE aceite_id = ? AND state = 'PAID') > 1
          THEN 'pago_revisao_pagamento_duplicado' ELSE 'pago' END
    WHERE id = ? AND EXISTS (SELECT 1 FROM asaas_checkout_attempts
      WHERE id = ? AND aceite_id = ? AND checkout_id = ? AND state = 'PAID')
      AND ${guard()}`).bind(checkoutId, resolution.attemptId, eventAt,
    resolution.aceite.id, resolution.aceite.id, resolution.attemptId,
    resolution.aceite.id, checkoutId, base.eventId, base.payloadHash);
}

function nonPaidAceite(db, base, resolution, checkoutId) {
  return db.prepare(`/* aceite_non_paid */ UPDATE aceites
    SET asaas_checkout_id = ?,
        asaas_checkout_url = (SELECT checkout_url FROM asaas_checkout_attempts WHERE id = ?),
        payment_status = (SELECT state FROM asaas_checkout_attempts WHERE id = ?),
        status = CASE (SELECT state FROM asaas_checkout_attempts WHERE id = ?)
          WHEN 'AWAITING_PAYMENT' THEN 'aguardando_pagamento'
          WHEN 'CANCELED' THEN 'pagamento_cancelado'
          WHEN 'EXPIRED' THEN 'pagamento_expirado' ELSE status END
    WHERE id = ? AND UPPER(COALESCE(payment_status,'')) <> 'PAID' AND paid_at IS NULL
      AND EXISTS (SELECT 1 FROM asaas_checkout_attempts
        WHERE id = ? AND aceite_id = ? AND checkout_id = ? AND is_current = 1
          AND state IN ('AWAITING_PAYMENT','CANCELED','EXPIRED'))
      AND ${guard()}`).bind(checkoutId, resolution.attemptId, resolution.attemptId,
    resolution.attemptId, resolution.aceite.id, resolution.attemptId,
    resolution.aceite.id, checkoutId, base.eventId, base.payloadHash);
}

async function recordFinalAudit(db, base, status, reason, identity = {}) {
  await db.batch([
    auditInsert(db, base),
    auditFinalize(db, base, status, reason, identity.aceiteId, identity.attemptId, false)
  ]);
  const stored = await existingAudit(db, base.eventId);
  if (!stored) throw new Error('Webhook audit was not persisted.');
  if (stored.payload_sha256 !== base.payloadHash) {
    await markCollision(db, base.eventId, base.receivedAt);
    return { collision: true };
  }
  return { collision: false, stored };
}

async function quarantineEvent(db, base, reason, identity, request, duplicate = false) {
  const result = await recordFinalAudit(db, base, 'QUARANTINED', reason, identity);
  log('warn', result.collision ? 'event_id_collision' : 'event_quarantined', request, {
    event_id: base.eventId, event_name: base.eventName, checkout_id: base.checkoutId,
    reason: result.collision ? 'EVENT_ID_COLLISION' : reason, duplicate
  });
  return json({ received: true, processed: false, quarantined: true,
    reason: 'manual_review_required', duplicate });
}

async function paidAttemptCount(db, aceiteId) {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM asaas_checkout_attempts
    WHERE aceite_id = ? AND state = 'PAID'`).bind(aceiteId).first();
  return Number(row?.count || 0);
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.ACEITES_DB || !env.ASAAS_WEBHOOK_TOKEN) {
      log('error', 'configuration_missing', request);
      return json({ error: 'Integração temporariamente indisponível.' }, 503);
    }
    const providedToken = request.headers.get('asaas-access-token') || '';
    if (!await constantTimeEqual(providedToken, String(env.ASAAS_WEBHOOK_TOKEN))) {
      log('warn', 'authentication_failed', request);
      return json({ error: 'Não autorizado.' }, 401);
    }
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_PAYLOAD_BYTES) {
      log('warn', 'payload_too_large', request, { content_length: contentLength });
      return json({ error: 'Evento inválido.' }, 413);
    }
    let event;
    try { event = await readJsonWithLimit(request); } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        log('warn', 'payload_too_large', request);
        return json({ error: 'Evento inválido.' }, 413);
      }
      log('warn', 'invalid_json', request);
      return json({ error: 'Evento inválido.' }, 400);
    }
    const eventId = cleanField(event?.id, 200);
    const eventName = cleanField(event?.event, 100);
    const checkoutId = cleanField(event?.checkout?.id, 200);
    if (!eventId || !eventName || !/^[A-Z][A-Z0-9_]*$/.test(eventName)) {
      log('warn', 'invalid_event_identity', request);
      return json({ error: 'Evento inválido.' }, 400);
    }
    const receivedAt = new Date().toISOString();
    let fullCanonical;
    let redacted;
    try {
      fullCanonical = canonicalJson(event);
      redacted = redactedPayload(event);
    } catch {
      log('warn', 'invalid_json_shape', request);
      return json({ error: 'Evento inválido.' }, 400);
    }
    if (encoder.encode(fullCanonical).byteLength > MAX_PAYLOAD_BYTES) {
      return json({ error: 'Evento inválido.' }, 413);
    }
    const payloadHash = await sha256Hex(fullCanonical);
    const base = { eventId, eventName, checkoutId, receivedAt, redacted, payloadHash };
    const storedBefore = await existingAudit(env.ACEITES_DB, eventId);
    const auditState = await inspectExistingAudit(env.ACEITES_DB, storedBefore,
      eventName, checkoutId, payloadHash, redacted, receivedAt);
    if (!auditState.proceed) {
      log(auditState.collision ? 'error' : 'log', auditState.collision
        ? 'event_id_collision' : 'event_duplicate', request, { event_id: eventId, event_name: eventName });
      return auditState.response;
    }
    if (!EVENT_TRANSITIONS[eventName]) {
      const result = await recordFinalAudit(env.ACEITES_DB, base, 'IGNORED', 'EVENT_NOT_HANDLED');
      return result.collision
        ? duplicateResponse({ processing_status: 'QUARANTINED' })
        : json({ received: true, processed: false, ignored: true, duplicate: auditState.existing });
    }
    const externalReference = parseExternalReference(event?.checkout?.externalReference);
    const callbacks = callbackIdentity(event?.checkout || {}, request, env);
    const resolution = await resolveAttempt(env.ACEITES_DB, event, checkoutId,
      externalReference, callbacks, receivedAt);
    if (!resolution.matched) {
      return quarantineEvent(env.ACEITES_DB, base, resolution.reason, resolution, request, auditState.existing);
    }
    const eventAt = eventOccurredAt(event, receivedAt);
    const statements = [
      auditInsert(env.ACEITES_DB, base),
      attemptInsert(env.ACEITES_DB, base, resolution),
      attemptAdopt(env.ACEITES_DB, base, resolution, checkoutId),
      attemptState(env.ACEITES_DB, base, resolution, checkoutId, eventAt)
    ];
    if (eventName === 'CHECKOUT_PAID') {
      statements.push(
        paidCanonicalClear(env.ACEITES_DB, base, resolution, eventAt),
        paidCanonicalSet(env.ACEITES_DB, base, resolution, eventAt),
        doublePaymentMark(env.ACEITES_DB, base, resolution, eventAt),
        paidAceite(env.ACEITES_DB, base, resolution, checkoutId, eventAt)
      );
    } else {
      statements.push(nonPaidAceite(env.ACEITES_DB, base, resolution, checkoutId));
    }
    statements.push(auditFinalize(env.ACEITES_DB, base, 'PROCESSED', null,
      resolution.aceite.id, resolution.attemptId, true));
    const results = await env.ACEITES_DB.batch(statements);
    const finalized = Number(results.at(-1)?.meta?.changes || 0) > 0;
    if (!finalized) {
      const stored = await existingAudit(env.ACEITES_DB, eventId);
      if (stored?.payload_sha256 !== payloadHash) {
        await markCollision(env.ACEITES_DB, eventId, receivedAt);
        return duplicateResponse({ processing_status: 'QUARANTINED' });
      }
      if (stored && !['RECEIVED', 'LEGACY_UNKNOWN'].includes(stored.processing_status)) {
        return duplicateResponse(stored);
      }
      return quarantineEvent(env.ACEITES_DB, base, 'ATTEMPT_UPDATE_CONFLICT',
        { aceiteId: resolution.aceite.id, attemptId: resolution.attemptId },
        request, auditState.existing);
    }
    const doublePayment = eventName === 'CHECKOUT_PAID'
      && await paidAttemptCount(env.ACEITES_DB, resolution.aceite.id) > 1;
    log(doublePayment ? 'warn' : 'log', doublePayment ? 'double_payment_detected' : 'event_processed', request, {
      event_id: eventId, event_name: eventName, checkout_id: checkoutId,
      aceite_id: resolution.aceite.id, attempt_id: resolution.attemptId,
      match_source: resolution.source, duplicate: auditState.existing,
      requires_review: doublePayment
    });
    return json({ ok: true, processed: true, duplicate: auditState.existing,
      ...(doublePayment ? { requires_review: true } : {}) });
  } catch (error) {
    log('error', 'processing_failed', request, {
      error_name: error instanceof Error ? error.name : 'UnknownError',
      error_message: error instanceof Error ? error.message : 'Unknown error'
    });
    return json({ error: 'Erro ao processar webhook.' }, 500);
  }
}

export function onRequestGet() {
  return new Response(JSON.stringify({ error: 'Método não permitido.' }), {
    status: 405,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      allow: 'POST'
    }
  });
}
