import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequestPost } from '../rumosadv-site/functions/api/webhooks/asaas.js';

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  // Older local Node releases still run the deterministic mock suite.
}

const TOKEN = 'segredo-de-teste-comprido';
const ATTEMPT_A = '11111111-1111-4111-8111-111111111111';
const ATTEMPT_B = '22222222-2222-4222-8222-222222222222';
const CREATED_AT = '2026-09-01T12:00:00.000Z';

const cloneMap = map => new Map([...map].map(([key, value]) => [key, { ...value }]));
const changes = count => ({ meta: { changes: count }, results: [] });

class MockStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    const db = this.database;
    if (this.sql.includes('FROM asaas_webhook_events WHERE id = ?')) {
      return db.events.get(this.values[0]) || null;
    }
    if (this.sql.includes("SELECT COUNT(*) AS count FROM asaas_checkout_attempts")) {
      return { count: [...db.attempts.values()].filter(row => (
        row.aceite_id === this.values[0] && row.state === 'PAID'
      )).length };
    }
    if (this.sql.includes('FROM asaas_checkout_attempts')) {
      if (this.sql.includes('WHERE checkout_id = ?')) {
        return [...db.attempts.values()].find(row => row.checkout_id === this.values[0]) || null;
      }
      if (this.sql.includes('WHERE external_reference = ?')) {
        return [...db.attempts.values()].find(row => row.external_reference === this.values[0]) || null;
      }
      if (this.sql.includes('WHERE id = ?')) return db.attempts.get(this.values[0]) || null;
      if (this.sql.includes('WHERE aceite_id = ? AND is_current = 1')) {
        return [...db.attempts.values()].find(row => (
          row.aceite_id === this.values[0] && Number(row.is_current) === 1
        )) || null;
      }
    }
    if (this.sql.includes('FROM aceites WHERE asaas_checkout_id = ?')) {
      return [...db.aceites.values()].find(row => row.asaas_checkout_id === this.values[0]) || null;
    }
    if (this.sql.includes('FROM aceites WHERE id = ?')) return db.aceites.get(this.values[0]) || null;
    throw new Error(`Consulta não implementada no mock: ${this.sql}`);
  }

  async run() {
    if (this.sql.includes('/* audit_collision */')) {
      const [now, id] = this.values;
      const row = this.database.events.get(id);
      if (!row) return changes(0);
      row.processing_status = 'QUARANTINED';
      row.quarantine_reason = 'EVENT_ID_COLLISION';
      row.processed_at ||= now;
      return changes(1);
    }
    if (this.sql.includes('/* audit_legacy_adopt */')) {
      const [payload, hash, id] = this.values;
      const row = this.database.events.get(id);
      if (!row || row.payload_sha256) return changes(0);
      Object.assign(row, {
        payload,
        payload_sha256: hash,
        processing_status: 'RECEIVED',
        quarantine_reason: null,
        processed_at: null
      });
      return changes(1);
    }
    throw new Error(`Run não implementado no mock: ${this.sql}`);
  }
}

class MockD1 {
  constructor({ aceites = [], attempts = [], events = [] } = {}) {
    this.aceites = new Map(aceites.map(row => [row.id, acceptance(row)]));
    this.attempts = new Map(attempts.map(row => [row.id, attempt(row)]));
    this.events = new Map(events.map(row => [row.id, { ...row }]));
    this.batchSizes = [];
    this.failNextBatch = false;
    this.beforeNextBatch = null;
  }

  prepare(sql) {
    return new MockStatement(this, sql);
  }

  async batch(statements) {
    this.batchSizes.push(statements.length);
    if (this.beforeNextBatch) {
      const hook = this.beforeNextBatch;
      this.beforeNextBatch = null;
      hook(this);
    }
    if (this.failNextBatch) {
      this.failNextBatch = false;
      throw new Error('falha transacional simulada');
    }
    const aceites = cloneMap(this.aceites);
    const attempts = cloneMap(this.attempts);
    const events = cloneMap(this.events);

    const guardOk = (eventId, hash) => {
      const row = events.get(eventId);
      return row?.payload_sha256 === hash
        && ['RECEIVED', 'LEGACY_UNKNOWN'].includes(row.processing_status);
    };
    const paidCount = aceiteId => [...attempts.values()].filter(row => (
      row.aceite_id === aceiteId && row.state === 'PAID'
    )).length;

    const results = statements.map(statement => {
      const value = statement.values;
      const sql = statement.sql;
      if (sql.includes('/* audit_insert */')) {
        const [id, event, checkoutId, receivedAt, payload, hash] = value;
        if (events.has(id)) return changes(0);
        events.set(id, {
          id, event, checkout_id: checkoutId, received_at: receivedAt, payload,
          processing_status: 'RECEIVED', quarantine_reason: null,
          aceite_id: null, attempt_id: null, processed_at: null, payload_sha256: hash
        });
        return changes(1);
      }
      if (sql.includes('/* audit_finalize */')) {
        const [status, reason, aceiteId, attemptId, processedAt, eventId, hash,
          requireAttempt, requiredAttempt, requiredAceite, requiredCheckout, requiredEvent] = value;
        const row = events.get(eventId);
        const requiredRow = attempts.get(requiredAttempt);
        const requirementMet = !requireAttempt || (requiredRow?.aceite_id === requiredAceite
          && requiredRow.checkout_id === requiredCheckout && requiredRow.last_event === requiredEvent);
        if (!row || !guardOk(eventId, hash) || !requirementMet) return changes(0);
        Object.assign(row, {
          processing_status: status,
          quarantine_reason: reason,
          aceite_id: aceiteId,
          attempt_id: attemptId,
          processed_at: processedAt
        });
        return changes(1);
      }
      if (sql.includes('/* attempt_insert */')) {
        const [id, aceiteId, reference, checkoutUrl, isCurrent, createdAt, updatedAt,
          failureReason, eventId, hash] = value;
        if (!guardOk(eventId, hash) || attempts.has(id)) return changes(0);
        const uniqueConflict = [...attempts.values()].some(row => (
          row.external_reference === reference || (isCurrent && row.aceite_id === aceiteId && row.is_current === 1)
        ));
        if (uniqueConflict) return changes(0);
        attempts.set(id, attempt({
          id, aceite_id: aceiteId, external_reference: reference,
          checkout_id: null, checkout_url: checkoutUrl, state: 'CREATING',
          is_current: isCurrent, created_at: createdAt, updated_at: updatedAt,
          failure_reason: failureReason
        }));
        return changes(1);
      }
      if (sql.includes('/* attempt_adopt_checkout */')) {
        const [checkoutId, updatedAt, id, aceiteId, expectedCheckoutId, eventId, hash] = value;
        const row = attempts.get(id);
        if (!guardOk(eventId, hash) || !row || row.aceite_id !== aceiteId
          || (row.checkout_id && row.checkout_id !== expectedCheckoutId)) return changes(0);
        if ([...attempts.values()].some(other => other.id !== id && other.checkout_id === checkoutId)) {
          throw new Error('UNIQUE checkout_id');
        }
        row.checkout_id ||= checkoutId;
        row.updated_at = updatedAt;
        return changes(1);
      }
      if (sql.includes('/* attempt_state */')) {
        const [desired, , , , , , paidAt, eventName, lastEventAt, updatedAt,
          id, aceiteId, checkoutId, eventId, hash] = value;
        const row = attempts.get(id);
        if (!guardOk(eventId, hash) || !row || row.aceite_id !== aceiteId || row.checkout_id !== checkoutId) {
          return changes(0);
        }
        const blocked = row.state === 'PAID'
          || (desired === 'AWAITING_PAYMENT' && ['CANCELED', 'EXPIRED', 'SUPERSEDED', 'REQUIRES_REVIEW'].includes(row.state))
          || (desired === 'CANCELED' && row.state === 'EXPIRED')
          || (desired === 'EXPIRED' && row.state === 'CANCELED');
        if (desired === 'PAID') row.state = 'PAID';
        else if (!blocked) row.state = desired;
        if (desired === 'PAID') row.paid_at ||= paidAt;
        Object.assign(row, { last_event: eventName, last_event_at: lastEventAt, updated_at: updatedAt });
        return changes(1);
      }
      if (sql.includes('/* paid_canonical_clear */')) {
        const [eventAt, updatedAt, aceiteId, keepId, countAceiteId, eventId, hash] = value;
        if (!guardOk(eventId, hash) || paidCount(countAceiteId) !== 1) return changes(0);
        let count = 0;
        for (const row of attempts.values()) {
          if (row.aceite_id === aceiteId && row.id !== keepId && row.is_current === 1) {
            row.is_current = 0;
            if (row.state !== 'PAID') row.state = 'SUPERSEDED';
            row.superseded_at ||= eventAt;
            row.updated_at = updatedAt;
            count += 1;
          }
        }
        return changes(count);
      }
      if (sql.includes('/* paid_canonical_set */')) {
        const [updatedAt, id, aceiteId, countAceiteId, eventId, hash] = value;
        const row = attempts.get(id);
        if (!guardOk(eventId, hash) || paidCount(countAceiteId) !== 1
          || !row || row.aceite_id !== aceiteId || row.state !== 'PAID') return changes(0);
        row.is_current = 1;
        row.updated_at = updatedAt;
        return changes(1);
      }
      if (sql.includes('/* double_payment_mark */')) {
        const [updatedAt, aceiteId, countAceiteId, eventId, hash] = value;
        if (!guardOk(eventId, hash) || paidCount(countAceiteId) <= 1) return changes(0);
        let count = 0;
        for (const row of attempts.values()) {
          if (row.aceite_id === aceiteId && row.state === 'PAID') {
            row.failure_reason = 'DOUBLE_PAYMENT_REVIEW';
            row.updated_at = updatedAt;
            count += 1;
          }
        }
        return changes(count);
      }
      if (sql.includes('/* aceite_paid */')) {
        const [checkoutId, attemptId, eventAt, countAceiteId, aceiteId,
          requiredAttempt, requiredAceite, requiredCheckout, eventId, hash] = value;
        const row = aceites.get(aceiteId);
        const history = attempts.get(requiredAttempt);
        if (!guardOk(eventId, hash) || !row || !history || history.aceite_id !== requiredAceite
          || history.checkout_id !== requiredCheckout || history.state !== 'PAID') return changes(0);
        const alreadyPaid = String(row.payment_status || '').toUpperCase() === 'PAID' || Boolean(row.paid_at);
        if (!alreadyPaid) {
          row.asaas_checkout_id = checkoutId;
          row.asaas_checkout_url = attempts.get(attemptId)?.checkout_url || null;
        }
        row.payment_status = 'PAID';
        row.paid_at ||= eventAt;
        row.status = paidCount(countAceiteId) > 1 ? 'pago_revisao_pagamento_duplicado' : 'pago';
        return changes(1);
      }
      if (sql.includes('/* aceite_non_paid */')) {
        const [checkoutId, urlAttempt, stateAttempt, statusAttempt, aceiteId,
          requiredAttempt, requiredAceite, requiredCheckout, eventId, hash] = value;
        const row = aceites.get(aceiteId);
        const history = attempts.get(requiredAttempt);
        if (!guardOk(eventId, hash) || !row || row.paid_at
          || String(row.payment_status || '').toUpperCase() === 'PAID'
          || !history || history.aceite_id !== requiredAceite
          || history.checkout_id !== requiredCheckout || history.is_current !== 1
          || !['AWAITING_PAYMENT', 'CANCELED', 'EXPIRED'].includes(history.state)) return changes(0);
        row.asaas_checkout_id = checkoutId;
        row.asaas_checkout_url = attempts.get(urlAttempt)?.checkout_url || null;
        row.payment_status = attempts.get(stateAttempt).state;
        row.status = {
          AWAITING_PAYMENT: 'aguardando_pagamento',
          CANCELED: 'pagamento_cancelado',
          EXPIRED: 'pagamento_expirado'
        }[attempts.get(statusAttempt).state] || row.status;
        return changes(1);
      }
      throw new Error(`Comando não implementado no mock: ${sql}`);
    });

    this.aceites = aceites;
    this.attempts = attempts;
    this.events = events;
    return results;
  }
}

function acceptance(overrides = {}) {
  return {
    id: 'aceite-1',
    created_at: CREATED_AT,
    status: 'aceito',
    asaas_checkout_id: null,
    asaas_checkout_url: null,
    payment_status: null,
    paid_at: null,
    ...overrides
  };
}

function attempt(overrides = {}) {
  return {
    id: ATTEMPT_A,
    aceite_id: 'aceite-1',
    external_reference: `aceite-1:${ATTEMPT_A}`,
    checkout_id: 'chk-a',
    checkout_url: null,
    state: 'AWAITING_PAYMENT',
    is_current: 1,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    superseded_at: null,
    paid_at: null,
    last_event: null,
    last_event_at: null,
    failure_reason: null,
    ...overrides
  };
}

function context(database, event, token = TOKEN, env = {}) {
  return rawContext(database, JSON.stringify(event), token, env);
}

function rawContext(database, body, token = TOKEN, env = {}) {
  return {
    env: {
      ACEITES_DB: database,
      ASAAS_WEBHOOK_TOKEN: TOKEN,
      PUBLIC_BASE_URL: 'https://www.rumosadv.com.br',
      ...env
    },
    request: new Request('https://preview.example.test/api/webhooks/asaas', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'asaas-access-token': token,
        'cf-ray': 'trace-test'
      },
      body
    })
  };
}

function checkoutEvent(id, event, checkoutId, externalReference, extraCheckout = {}) {
  return {
    id,
    event,
    checkout: {
      id: checkoutId,
      ...(externalReference === undefined ? {} : { externalReference }),
      ...extraCheckout
    }
  };
}

function callbacks(aceiteId = 'aceite-1', attemptId = ATTEMPT_A, origin = 'https://www.rumosadv.com.br') {
  const suffix = attemptId ? `&attempt=${attemptId}` : '';
  return {
    successUrl: `${origin}/marcas/aceite/pagamento/?status=sucesso&aceite=${aceiteId}${suffix}`,
    cancelUrl: `${origin}/marcas/aceite/pagamento/?status=cancelado&aceite=${aceiteId}${suffix}`,
    expiredUrl: `${origin}/marcas/aceite/pagamento/?status=expirado&aceite=${aceiteId}${suffix}`
  };
}

test('recusa token incorreto antes de tocar no banco', async () => {
  const db = new MockD1();
  const response = await onRequestPost(context(db,
    checkoutEvent('evt-auth', 'CHECKOUT_PAID', 'chk-a', `aceite-1:${ATTEMPT_A}`),
    'token-incorreto'));
  assert.equal(response.status, 401);
  assert.equal(db.events.size, 0);
  assert.deepEqual(db.batchSizes, []);
});

test('PAID atualiza tentativa e aceite no mesmo batch auditável', async () => {
  const db = new MockD1({
    aceites: [acceptance({ asaas_checkout_id: 'chk-a', payment_status: 'AWAITING_PAYMENT' })],
    attempts: [attempt()]
  });
  const response = await onRequestPost(context(db,
    checkoutEvent('evt-paid', 'CHECKOUT_PAID', 'chk-a', `aceite-1:${ATTEMPT_A}`)));
  assert.equal(response.status, 200);
  assert.equal(db.batchSizes[0], 9);
  assert.equal(db.attempts.get(ATTEMPT_A).state, 'PAID');
  assert.equal(db.aceites.get('aceite-1').payment_status, 'PAID');
  assert.equal(db.events.get('evt-paid').processing_status, 'PROCESSED');
  assert.equal(db.events.get('evt-paid').attempt_id, ATTEMPT_A);
  assert.match(db.events.get('evt-paid').payload_sha256, /^[0-9a-f]{64}$/);
});

test('externalReference da tentativa adota checkout real após resposta perdida', async () => {
  const claim = `creating:1788451200000:${ATTEMPT_A}`;
  const db = new MockD1({
    aceites: [acceptance({ asaas_checkout_id: claim, payment_status: 'CREATING' })],
    attempts: [attempt({ checkout_id: null, state: 'CREATING' })]
  });
  const response = await onRequestPost(context(db,
    checkoutEvent('evt-created', 'CHECKOUT_CREATED', 'chk-recovered', `aceite-1:${ATTEMPT_A}`)));
  assert.equal(response.status, 200);
  assert.equal(db.attempts.get(ATTEMPT_A).checkout_id, 'chk-recovered');
  assert.equal(db.attempts.get(ATTEMPT_A).state, 'AWAITING_PAYMENT');
  assert.equal(db.aceites.get('aceite-1').asaas_checkout_id, 'chk-recovered');
});

test('PAID tardio da tentativa A vence a tentativa B vigente', async () => {
  const db = new MockD1({
    aceites: [acceptance({ asaas_checkout_id: 'chk-b', payment_status: 'AWAITING_PAYMENT' })],
    attempts: [
      attempt({ state: 'EXPIRED', is_current: 0 }),
      attempt({ id: ATTEMPT_B, external_reference: `aceite-1:${ATTEMPT_B}`,
        checkout_id: 'chk-b', is_current: 1 })
    ]
  });
  const response = await onRequestPost(context(db,
    checkoutEvent('evt-late-paid-a', 'CHECKOUT_PAID', 'chk-a', `aceite-1:${ATTEMPT_A}`)));
  assert.equal(response.status, 200);
  assert.equal(db.attempts.get(ATTEMPT_A).state, 'PAID');
  assert.equal(db.attempts.get(ATTEMPT_A).is_current, 1);
  assert.equal(db.attempts.get(ATTEMPT_B).state, 'SUPERSEDED');
  assert.equal(db.attempts.get(ATTEMPT_B).is_current, 0);
  assert.equal(db.aceites.get('aceite-1').asaas_checkout_id, 'chk-a');
  assert.equal(db.aceites.get('aceite-1').payment_status, 'PAID');
});

test('segundo PAID preserva pagamento canônico e marca revisão durável', async () => {
  const paidAt = '2026-09-03T10:00:00.000Z';
  const db = new MockD1({
    aceites: [acceptance({ asaas_checkout_id: 'chk-a', payment_status: 'PAID', paid_at: paidAt, status: 'pago' })],
    attempts: [
      attempt({ state: 'PAID', is_current: 1, paid_at: paidAt }),
      attempt({ id: ATTEMPT_B, external_reference: `aceite-1:${ATTEMPT_B}`,
        checkout_id: 'chk-b', state: 'SUPERSEDED', is_current: 0 })
    ]
  });
  const response = await onRequestPost(context(db,
    checkoutEvent('evt-paid-b', 'CHECKOUT_PAID', 'chk-b', `aceite-1:${ATTEMPT_B}`)));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.requires_review, true);
  assert.equal(db.aceites.get('aceite-1').asaas_checkout_id, 'chk-a');
  assert.equal(db.aceites.get('aceite-1').paid_at, paidAt);
  assert.equal(db.aceites.get('aceite-1').status, 'pago_revisao_pagamento_duplicado');
  assert.equal(db.attempts.get(ATTEMPT_A).failure_reason, 'DOUBLE_PAYMENT_REVIEW');
  assert.equal(db.attempts.get(ATTEMPT_B).failure_reason, 'DOUBLE_PAYMENT_REVIEW');
  assert.equal(db.attempts.get(ATTEMPT_B).state, 'PAID');
});

test('duplicata semântica com chaves reordenadas é idempotente', async () => {
  const db = new MockD1({ aceites: [acceptance({ asaas_checkout_id: 'chk-a' })], attempts: [attempt()] });
  const firstEvent = {
    id: 'evt-order', event: 'CHECKOUT_PAID',
    checkout: { id: 'chk-a', externalReference: `aceite-1:${ATTEMPT_A}` },
    metadata: { z: 2, a: ['x', { y: true, x: false }] }
  };
  const reordered = {
    metadata: { a: ['x', { x: false, y: true }], z: 2 },
    checkout: { externalReference: `aceite-1:${ATTEMPT_A}`, id: 'chk-a' },
    event: 'CHECKOUT_PAID', id: 'evt-order'
  };
  assert.equal((await onRequestPost(context(db, firstEvent))).status, 200);
  const paidAt = db.aceites.get('aceite-1').paid_at;
  const response = await onRequestPost(context(db, reordered));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).duplicate, true);
  assert.equal(db.aceites.get('aceite-1').paid_at, paidAt);
  assert.equal(db.events.size, 1);
});

test('colisão do mesmo event.id é quarentenada sem reaplicar mutação', async () => {
  const db = new MockD1({ aceites: [acceptance({ asaas_checkout_id: 'chk-a' })], attempts: [attempt()] });
  await onRequestPost(context(db,
    checkoutEvent('evt-collision', 'CHECKOUT_CREATED', 'chk-a', `aceite-1:${ATTEMPT_A}`)));
  const response = await onRequestPost(context(db,
    checkoutEvent('evt-collision', 'CHECKOUT_PAID', 'chk-a', `aceite-1:${ATTEMPT_A}`)));
  assert.equal(response.status, 200);
  assert.equal(db.events.get('evt-collision').processing_status, 'QUARANTINED');
  assert.equal(db.events.get('evt-collision').quarantine_reason, 'EVENT_ID_COLLISION');
  assert.notEqual(db.aceites.get('aceite-1').payment_status, 'PAID');
});

test('resolução obsoleta concorrente não finaliza evento do checkout perdedor', async () => {
  const claim = `creating:1788451200000:${ATTEMPT_A}`;
  const db = new MockD1({
    aceites: [acceptance({ asaas_checkout_id: claim, payment_status: 'CREATING' })],
    attempts: [attempt({ checkout_id: null, state: 'CREATING' })]
  });
  db.beforeNextBatch = live => {
    const row = live.attempts.get(ATTEMPT_A);
    row.checkout_id = 'chk-winner';
    row.state = 'AWAITING_PAYMENT';
    row.last_event = 'CHECKOUT_CREATED';
    live.aceites.get('aceite-1').asaas_checkout_id = 'chk-winner';
    live.aceites.get('aceite-1').payment_status = 'AWAITING_PAYMENT';
  };
  const response = await onRequestPost(context(db,
    checkoutEvent('evt-stale', 'CHECKOUT_PAID', 'chk-loser', `aceite-1:${ATTEMPT_A}`)));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).quarantined, true);
  assert.equal(db.events.get('evt-stale').processing_status, 'QUARANTINED');
  assert.equal(db.events.get('evt-stale').quarantine_reason, 'ATTEMPT_UPDATE_CONFLICT');
  assert.equal(db.attempts.get(ATTEMPT_A).checkout_id, 'chk-winner');
  assert.notEqual(db.aceites.get('aceite-1').payment_status, 'PAID');
});

test('fallback sem externalReference usa três callbacks HTTPS concordantes', async () => {
  const claim = `creating:1788451200000:${ATTEMPT_A}`;
  const db = new MockD1({ aceites: [acceptance({ asaas_checkout_id: claim, payment_status: 'CREATING' })] });
  const response = await onRequestPost(context(db,
    checkoutEvent('evt-callback', 'CHECKOUT_PAID', 'chk-callback', undefined,
      { callback: callbacks() })));
  assert.equal(response.status, 200);
  assert.equal(db.attempts.get(ATTEMPT_A).checkout_id, 'chk-callback');
  assert.equal(db.aceites.get('aceite-1').payment_status, 'PAID');
});

test('callbacks maliciosos, incompletos ou divergentes ficam em quarentena', async () => {
  const variants = [
    callbacks('aceite-1', ATTEMPT_A, 'https://www.rumosadv.com.br.evil.test'),
    callbacks('aceite-1', ATTEMPT_A, 'http://www.rumosadv.com.br'),
    { ...callbacks(), successUrl: `https://www.rumosadv.com.br${'/marcas/aceite/pagamento/extra'}?status=sucesso&aceite=aceite-1&attempt=${ATTEMPT_A}` },
    { ...callbacks(), cancelUrl: `https://www.rumosadv.com.br/marcas/aceite/pagamento/?status=cancelado&aceite=aceite-2&attempt=${ATTEMPT_A}` },
    { successUrl: callbacks().successUrl }
  ];
  for (const [index, callback] of variants.entries()) {
    const db = new MockD1({ aceites: [acceptance()] });
    const response = await onRequestPost(context(db,
      checkoutEvent(`evt-bad-callback-${index}`, 'CHECKOUT_PAID', 'chk-x', undefined, { callback })));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).quarantined, true);
    assert.equal(db.events.get(`evt-bad-callback-${index}`).processing_status, 'QUARANTINED');
    assert.equal(db.attempts.size, 0);
    assert.notEqual(db.aceites.get('aceite-1').payment_status, 'PAID');
  }
});

test('callback e externalReference divergentes não alteram estado financeiro', async () => {
  const db = new MockD1({ aceites: [acceptance()] });
  const response = await onRequestPost(context(db,
    checkoutEvent('evt-diverge', 'CHECKOUT_PAID', 'chk-x', `aceite-1:${ATTEMPT_A}`,
      { callback: callbacks('aceite-1', ATTEMPT_B) })));
  assert.equal(response.status, 200);
  assert.equal(db.attempts.size, 0);
  assert.equal(db.events.get('evt-diverge').processing_status, 'QUARANTINED');
});

test('eventos fora de ordem não regridem PAID, CANCELED ou EXPIRED', async () => {
  const cases = [
    ['PAID', 'CHECKOUT_CREATED'],
    ['PAID', 'CHECKOUT_CANCELED'],
    ['CANCELED', 'CHECKOUT_CREATED'],
    ['CANCELED', 'CHECKOUT_EXPIRED'],
    ['EXPIRED', 'CHECKOUT_CREATED'],
    ['EXPIRED', 'CHECKOUT_CANCELED']
  ];
  for (const [state, delayed] of cases) {
    const paid = state === 'PAID';
    const db = new MockD1({
      aceites: [acceptance({
        asaas_checkout_id: 'chk-a', payment_status: state,
        status: paid ? 'pago' : state === 'CANCELED' ? 'pagamento_cancelado' : 'pagamento_expirado',
        paid_at: paid ? CREATED_AT : null
      })],
      attempts: [attempt({ state, paid_at: paid ? CREATED_AT : null })]
    });
    const response = await onRequestPost(context(db,
      checkoutEvent(`evt-${state}-${delayed}`, delayed, 'chk-a', `aceite-1:${ATTEMPT_A}`)));
    assert.equal(response.status, 200);
    assert.equal(db.attempts.get(ATTEMPT_A).state, state);
    assert.equal(db.aceites.get('aceite-1').payment_status, state);
  }
});

test('checkout legado das colunas-resumo é materializado como tentativa', async () => {
  const db = new MockD1({
    aceites: [acceptance({ asaas_checkout_id: 'chk-legacy', payment_status: 'AWAITING_PAYMENT' })]
  });
  const response = await onRequestPost(context(db,
    checkoutEvent('evt-legacy-summary', 'CHECKOUT_PAID', 'chk-legacy', 'aceite-1')));
  assert.equal(response.status, 200);
  const history = [...db.attempts.values()][0];
  assert.equal(history.checkout_id, 'chk-legacy');
  assert.equal(history.state, 'PAID');
  assert.equal(db.aceites.get('aceite-1').payment_status, 'PAID');
});

test('PAID tardio de A legado continua reconhecido depois de B', async () => {
  const legacyId = 'legacy-aceite-1';
  const db = new MockD1({
    aceites: [acceptance({ asaas_checkout_id: 'chk-b', payment_status: 'AWAITING_PAYMENT' })],
    attempts: [
      attempt({ id: legacyId, external_reference: 'legacy:aceite-1:chk-a',
        checkout_id: 'chk-a', state: 'EXPIRED', is_current: 0 }),
      attempt({ id: ATTEMPT_B, external_reference: `aceite-1:${ATTEMPT_B}`,
        checkout_id: 'chk-b', is_current: 1 })
    ]
  });
  const response = await onRequestPost(context(db,
    checkoutEvent('evt-legacy-late-paid', 'CHECKOUT_PAID', 'chk-a', 'aceite-1')));
  assert.equal(response.status, 200);
  assert.equal(db.attempts.get(legacyId).state, 'PAID');
  assert.equal(db.aceites.get('aceite-1').asaas_checkout_id, 'chk-a');
  assert.equal(db.aceites.get('aceite-1').payment_status, 'PAID');
});

test('registro de auditoria anterior à 0004 é adotado e reconciliado', async () => {
  const event = checkoutEvent('evt-old-audit', 'CHECKOUT_PAID', 'chk-a', `aceite-1:${ATTEMPT_A}`);
  const db = new MockD1({
    aceites: [acceptance({ asaas_checkout_id: 'chk-a' })],
    attempts: [attempt()],
    events: [{ id: event.id, event: event.event, checkout_id: 'chk-a',
      received_at: CREATED_AT, payload: JSON.stringify(event) }]
  });
  const response = await onRequestPost(context(db, event));
  assert.equal(response.status, 200);
  assert.equal(db.events.get(event.id).processing_status, 'PROCESSED');
  assert.match(db.events.get(event.id).payload_sha256, /^[0-9a-f]{64}$/);
  assert.equal(db.aceites.get('aceite-1').payment_status, 'PAID');
});

test('payload legado saneado é adotado somente com evento e checkout coincidentes', async () => {
  const event = checkoutEvent('evt-sanitized-audit', 'CHECKOUT_PAID', 'chk-a', `aceite-1:${ATTEMPT_A}`);
  const db = new MockD1({
    aceites: [acceptance({ asaas_checkout_id: 'chk-a' })],
    attempts: [attempt()],
    events: [{ id: event.id, event: event.event, checkout_id: 'chk-a',
      received_at: CREATED_AT, payload: '{"legacy_redacted":true}',
      processing_status: 'LEGACY_UNKNOWN', quarantine_reason: 'LEGACY_PAYLOAD_REDACTED',
      payload_sha256: null }]
  });
  const response = await onRequestPost(context(db, event));
  assert.equal(response.status, 200);
  assert.equal(db.events.get(event.id).processing_status, 'PROCESSED');
  assert.match(db.events.get(event.id).payload_sha256, /^[0-9a-f]{64}$/);
  assert.equal(db.events.get(event.id).quarantine_reason, null);
  assert.equal(db.aceites.get('aceite-1').payment_status, 'PAID');
});

test('payload legado saneado com checkout divergente permanece em quarentena', async () => {
  const event = checkoutEvent('evt-sanitized-collision', 'CHECKOUT_PAID', 'chk-b', `aceite-1:${ATTEMPT_A}`);
  const db = new MockD1({
    aceites: [acceptance({ asaas_checkout_id: 'chk-a' })],
    attempts: [attempt()],
    events: [{ id: event.id, event: event.event, checkout_id: 'chk-a',
      received_at: CREATED_AT, payload: '{"legacy_redacted":true}',
      processing_status: 'LEGACY_UNKNOWN', quarantine_reason: 'LEGACY_PAYLOAD_REDACTED',
      payload_sha256: null }]
  });
  const response = await onRequestPost(context(db, event));
  assert.equal(response.status, 200);
  assert.equal(db.events.get(event.id).processing_status, 'QUARANTINED');
  assert.equal(db.events.get(event.id).quarantine_reason, 'EVENT_ID_COLLISION');
  assert.equal(db.events.get(event.id).payload_sha256, null);
});

test('migration 0007 remove PII do payload legado e preserva correlação', {
  skip: DatabaseSync ? false : 'node:sqlite indisponível neste runtime'
}, () => {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of [
    '../migrations/0001_aceites.sql',
    '../migrations/0002_asaas_checkout.sql',
    '../migrations/0003_analise_v1.sql',
    '../migrations/0004_asaas_checkout_history.sql'
  ]) {
    sqlite.exec(readFileSync(new URL(file, import.meta.url), 'utf8'));
  }
  sqlite.prepare(`INSERT INTO asaas_webhook_events (
    id, event, checkout_id, received_at, payload, processing_status
  ) VALUES (?, ?, ?, ?, ?, 'LEGACY_UNKNOWN')`).run(
    'evt-legacy-pii', 'CHECKOUT_PAID', 'chk-a', CREATED_AT,
    '{"customer":{"cpfCnpj":"00000000000","email":"sigilo@example.test"}}'
  );
  sqlite.exec(readFileSync(new URL('../migrations/0007_redact_legacy_webhook_payloads.sql', import.meta.url), 'utf8'));
  const row = sqlite.prepare(`SELECT event, checkout_id, payload, processing_status,
    quarantine_reason, payload_sha256 FROM asaas_webhook_events WHERE id = ?`).get('evt-legacy-pii');
  assert.equal(row.event, 'CHECKOUT_PAID');
  assert.equal(row.checkout_id, 'chk-a');
  assert.equal(row.payload, '{"legacy_redacted":true}');
  assert.equal(row.processing_status, 'LEGACY_UNKNOWN');
  assert.equal(row.quarantine_reason, 'LEGACY_PAYLOAD_REDACTED');
  assert.equal(row.payload_sha256, null);
  sqlite.close();
});

test('checkout desconhecido é auditado em quarentena e recebe 200 para encerrar a reentrega', async () => {
  const db = new MockD1();
  const response = await onRequestPost(context(db,
    checkoutEvent('evt-unmatched', 'CHECKOUT_PAID', 'chk-missing', 'aceite-inexistente')));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.processed, false);
  assert.equal(body.quarantined, true);
  assert.equal(db.events.get('evt-unmatched').processing_status, 'QUARANTINED');
});

test('reentrega de evento antigo já processado não bloqueia fila', async () => {
  const db = new MockD1({
    aceites: [acceptance({ asaas_checkout_id: 'chk-a' })], attempts: [attempt()]
  });
  const event = checkoutEvent('evt-old', 'CHECKOUT_EXPIRED', 'chk-a', `aceite-1:${ATTEMPT_A}`);
  assert.equal((await onRequestPost(context(db, event))).status, 200);
  Object.assign(db.aceites.get('aceite-1'), { asaas_checkout_id: 'chk-b', payment_status: 'AWAITING_PAYMENT' });
  db.attempts.get(ATTEMPT_A).is_current = 0;
  db.attempts.set(ATTEMPT_B, attempt({ id: ATTEMPT_B,
    external_reference: `aceite-1:${ATTEMPT_B}`, checkout_id: 'chk-b', is_current: 1 }));
  const duplicate = await onRequestPost(context(db, event));
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicate, true);
  assert.equal(db.aceites.get('aceite-1').asaas_checkout_id, 'chk-b');
});

test('payload auditado é minimizado, enquanto hash cobre o JSON integral', async () => {
  const db = new MockD1({ aceites: [acceptance({ asaas_checkout_id: 'chk-a' })], attempts: [attempt()] });
  const event = {
    ...checkoutEvent('evt-redacted', 'CHECKOUT_CREATED', 'chk-a', `aceite-1:${ATTEMPT_A}`),
    customer: { name: 'Pessoa Sigilosa', cpfCnpj: '00000000000', email: 'sigilo@example.test' }
  };
  const response = await onRequestPost(context(db, event));
  assert.equal(response.status, 200);
  const stored = db.events.get('evt-redacted');
  assert.doesNotMatch(stored.payload, /Pessoa Sigilosa|00000000000|sigilo@example/);
  assert.match(stored.payload_sha256, /^[0-9a-f]{64}$/);
});

test('corpo maior que 1 MB sem Content-Length é rejeitado antes da auditoria', async () => {
  const db = new MockD1();
  const body = JSON.stringify({ id: 'evt-large', event: 'CHECKOUT_PAID',
    checkout: { id: 'chk-a', externalReference: 'aceite-1' }, padding: 'x'.repeat(1_000_000) });
  const requestContext = rawContext(db, body);
  assert.equal(requestContext.request.headers.get('content-length'), null);
  const response = await onRequestPost(requestContext);
  assert.equal(response.status, 413);
  assert.equal(db.events.size, 0);
});

test('falha do batch reverte auditoria, tentativa e aceite para permitir retry', async () => {
  const db = new MockD1({
    aceites: [acceptance({ asaas_checkout_id: 'chk-a', payment_status: 'AWAITING_PAYMENT' })],
    attempts: [attempt()]
  });
  db.failNextBatch = true;
  const response = await onRequestPost(context(db,
    checkoutEvent('evt-rollback', 'CHECKOUT_PAID', 'chk-a', `aceite-1:${ATTEMPT_A}`)));
  assert.equal(response.status, 500);
  assert.equal(db.events.size, 0);
  assert.equal(db.attempts.get(ATTEMPT_A).state, 'AWAITING_PAYMENT');
  assert.equal(db.aceites.get('aceite-1').payment_status, 'AWAITING_PAYMENT');
});

test('SQL real das migrations e do batch processa PAID atomicamente', {
  skip: DatabaseSync ? false : 'node:sqlite indisponível neste runtime'
}, async () => {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of [
    '../migrations/0001_aceites.sql',
    '../migrations/0002_asaas_checkout.sql',
    '../migrations/0003_analise_v1.sql',
    '../migrations/0004_asaas_checkout_history.sql'
  ]) {
    sqlite.exec(readFileSync(new URL(file, import.meta.url), 'utf8'));
  }
  sqlite.prepare(`INSERT INTO aceites (
    id, created_at, nome, cpf_cnpj, email, whatsapp, marca,
    term_version, term_hash, status, asaas_checkout_id, payment_status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'aceite-1', CREATED_AT, 'Teste', '123', 'teste@example.test', '19999999999',
    'Marca', 'v1', 'hash', 'aguardando_pagamento', 'chk-a', 'AWAITING_PAYMENT'
  );
  sqlite.prepare(`INSERT INTO asaas_checkout_attempts (
    id, aceite_id, external_reference, checkout_id, state, is_current, created_at, updated_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    ATTEMPT_A, 'aceite-1', `aceite-1:${ATTEMPT_A}`, 'chk-a',
    'AWAITING_PAYMENT', 1, CREATED_AT, CREATED_AT
  );

  class SqliteStatement {
    constructor(sql) { this.sql = sql; this.values = []; }
    bind(...values) { this.values = values; return this; }
    async first() { return sqlite.prepare(this.sql).get(...this.values) || null; }
    async run() {
      const result = sqlite.prepare(this.sql).run(...this.values);
      return changes(Number(result.changes));
    }
  }
  const d1 = {
    prepare(sql) { return new SqliteStatement(sql); },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(statement => {
          const result = sqlite.prepare(statement.sql).run(...statement.values);
          return changes(Number(result.changes));
        });
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
  const response = await onRequestPost(context(d1,
    checkoutEvent('evt-real-sql', 'CHECKOUT_PAID', 'chk-a', `aceite-1:${ATTEMPT_A}`)));
  assert.equal(response.status, 200);
  assert.equal(sqlite.prepare('SELECT payment_status FROM aceites WHERE id = ?').get('aceite-1').payment_status, 'PAID');
  assert.equal(sqlite.prepare('SELECT state FROM asaas_checkout_attempts WHERE id = ?').get(ATTEMPT_A).state, 'PAID');
  assert.equal(sqlite.prepare('SELECT processing_status FROM asaas_webhook_events WHERE id = ?').get('evt-real-sql').processing_status, 'PROCESSED');
  sqlite.close();
});
