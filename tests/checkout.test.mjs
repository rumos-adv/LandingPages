import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequestPost } from '../rumosadv-site/functions/api/checkout.js';

const originalFetch = globalThis.fetch;

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  // Older local Node releases still run the deterministic mock suite.
}

function result(changes) {
  return { success: true, results: [], meta: { changes } };
}

class MockD1 {
  constructor(row, options = {}) {
    this.row = structuredClone(row);
    this.attempts = new Map((options.attempts || []).map(attempt => [attempt.id, structuredClone(attempt)]));
    this.prepareCalls = 0;
    this.persistThrows = Boolean(options.persistThrows);
    this.afterSelect = options.afterSelect || null;
    this.afterSelectRan = false;
    this.beforePersist = options.beforePersist || null;
    this.beforePersistRan = false;
    this.selectBarrierCount = options.selectBarrierCount || 0;
    this.selectCalls = 0;
    this.selectBarrier = this.selectBarrierCount
      ? new Promise(resolve => { this.releaseSelectBarrier = resolve; })
      : null;
  }

  prepare(sql) {
    const db = this;
    db.prepareCalls += 1;
    const statement = {
      sql,
      values: [],
      bind(...values) {
        statement.values = values;
        return statement;
      },
      async first() {
        const values = statement.values;
        if (sql.includes('FROM asaas_checkout_attempts WHERE id = ?')) {
          return db.attempts.has(values[0]) ? structuredClone(db.attempts.get(values[0])) : null;
        }
        const snapshot = db.row ? structuredClone(db.row) : null;
        if (db.afterSelect && !db.afterSelectRan) {
          db.afterSelectRan = true;
          db.afterSelect(db.row);
        }
        if (db.selectBarrier) {
          db.selectCalls += 1;
          if (db.selectCalls >= db.selectBarrierCount) db.releaseSelectBarrier();
          await db.selectBarrier;
        }
        return snapshot;
      },
      async run() {
        const values = statement.values;
        if (sql.includes("status = 'criando_pagamento'")) {
          const [claim, id, recoverableClaim] = values;
          if (!db.row || db.row.id !== id) return result(0);
          const status = String(db.row.payment_status || '').toUpperCase();
          const operationalStatus = String(db.row.status || '').toLowerCase();
          const claimable = !db.row.paid_at
            && status !== 'PAID'
            && operationalStatus !== 'pago'
            && (!db.row.asaas_checkout_id
              || status === 'CANCELED'
              || status === 'EXPIRED'
              || operationalStatus === 'pagamento_cancelado'
              || operationalStatus === 'pagamento_expirado'
              || (recoverableClaim !== null && db.row.asaas_checkout_id === recoverableClaim));
          if (!claimable) return result(0);
          db.row.asaas_checkout_id = claim;
          db.row.asaas_checkout_url = null;
          db.row.payment_status = 'CREATING';
          db.row.status = 'criando_pagamento';
          return result(1);
        }

        if (sql.includes("status = 'aguardando_pagamento'")) {
          const [checkoutId, url, id, claim] = values;
          if (db.beforePersist && !db.beforePersistRan) {
            db.beforePersistRan = true;
            db.beforePersist(db.row, { checkoutId, url, id, claim });
          }
          if (db.persistThrows) throw new Error('simulated D1 persistence failure');
          if (!db.row || db.row.id !== id || db.row.asaas_checkout_id !== claim || db.row.payment_status !== 'CREATING') {
            return result(0);
          }
          db.row.asaas_checkout_id = checkoutId;
          db.row.asaas_checkout_url = url;
          db.row.payment_status = 'AWAITING_PAYMENT';
          db.row.status = 'aguardando_pagamento';
          return result(1);
        }

        if (sql.includes('SET asaas_checkout_id = ?, asaas_checkout_url = ?, payment_status = ?, status = ?')) {
          const [checkoutId, url, paymentStatus, status, id, claim] = values;
          if (!db.row || db.row.id !== id || db.row.asaas_checkout_id !== claim || db.row.payment_status !== 'CREATING') {
            return result(0);
          }
          db.row.asaas_checkout_id = checkoutId;
          db.row.asaas_checkout_url = url;
          db.row.payment_status = paymentStatus;
          db.row.status = status;
          return result(1);
        }

        throw new Error(`SQL não tratado pelo mock: ${sql}`);
      }
    };
    return statement;
  }

  async batch(statements) {
    const isPersistence = statements.some(statement => statement.sql.includes('/* checkout_attempt_persist */'));
    if (isPersistence && this.beforePersist && !this.beforePersistRan) {
      this.beforePersistRan = true;
      const persist = statements.find(statement => statement.sql.includes('/* checkout_attempt_persist */'));
      const [checkoutId, url, , , id] = persist.values;
      const summary = statements.find(statement => statement.sql.includes('/* checkout_summary_persist */'));
      const claim = summary.values[3];
      this.beforePersist(this.row, { checkoutId, url, id, claim });
      if (this.row && String(this.row.payment_status || '').toUpperCase() !== 'CREATING') {
        const current = [...this.attempts.values()].find(attempt => attempt.is_current === 1);
        if (current) {
          current.checkout_id = this.row.asaas_checkout_id;
          current.checkout_url = this.row.asaas_checkout_url;
          current.state = String(this.row.payment_status || '').toUpperCase();
          current.paid_at = this.row.paid_at;
        }
      }
    }
    if (isPersistence && this.persistThrows) throw new Error('simulated D1 persistence failure');

    const row = this.row ? structuredClone(this.row) : null;
    const attempts = new Map([...this.attempts].map(([id, attempt]) => [id, structuredClone(attempt)]));
    const uniqueConflict = candidate => [...attempts.values()].some(existing => (
      existing.id !== candidate.id && (
        existing.external_reference === candidate.external_reference
        || (candidate.checkout_id && existing.checkout_id === candidate.checkout_id)
        || (candidate.is_current === 1 && existing.aceite_id === candidate.aceite_id && existing.is_current === 1)
      )
    ));

    const results = statements.map(statement => {
      const { sql, values } = statement;
      if (sql.includes('/* checkout_claim */')) {
        const [claim, id, recoverableClaim] = values;
        if (!row || row.id !== id) return result(0);
        const status = String(row.payment_status || '').toUpperCase();
        const operationalStatus = String(row.status || '').toLowerCase();
        const claimable = !row.paid_at && status !== 'PAID' && operationalStatus !== 'pago'
          && (!row.asaas_checkout_id || status === 'CANCELED' || status === 'EXPIRED'
            || operationalStatus === 'pagamento_cancelado' || operationalStatus === 'pagamento_expirado'
            || (recoverableClaim !== null && row.asaas_checkout_id === recoverableClaim));
        if (!claimable) return result(0);
        Object.assign(row, {
          asaas_checkout_id: claim,
          asaas_checkout_url: null,
          payment_status: 'CREATING',
          status: 'criando_pagamento'
        });
        return result(1);
      }
      if (sql.includes('/* checkout_materialize_prior */')) {
        const [id, aceiteId, externalReference, checkoutId, checkoutUrl, state,
          createdAt, updatedAt, paidAt, failureReason, guardAceite, claim] = values;
        if (!row || row.id !== guardAceite || row.asaas_checkout_id !== claim
          || row.payment_status !== 'CREATING') return result(0);
        const candidate = {
          id, aceite_id: aceiteId, external_reference: externalReference,
          checkout_id: checkoutId, checkout_url: checkoutUrl, state, is_current: 1,
          created_at: createdAt, updated_at: updatedAt, paid_at: paidAt,
          superseded_at: null, failure_reason: failureReason
        };
        if (attempts.has(id) || uniqueConflict(candidate)) return result(0);
        attempts.set(id, candidate);
        return result(1);
      }
      if (sql.includes('/* checkout_supersede_prior */')) {
        const [supersededAt, updatedAt, aceiteId, guardAceite, claim] = values;
        if (!row || row.id !== guardAceite || row.asaas_checkout_id !== claim
          || row.payment_status !== 'CREATING') return result(0);
        let changed = 0;
        for (const attempt of attempts.values()) {
          if (attempt.aceite_id === aceiteId && attempt.is_current === 1) {
            attempt.is_current = 0;
            if (!['PAID', 'CANCELED', 'EXPIRED'].includes(attempt.state)) attempt.state = 'SUPERSEDED';
            attempt.superseded_at ||= supersededAt;
            attempt.updated_at = updatedAt;
            changed += 1;
          }
        }
        return result(changed);
      }
      if (sql.includes('/* checkout_attempt_insert */')) {
        const [id, aceiteId, externalReference, createdAt, updatedAt, guardAceite, claim] = values;
        if (!row || row.id !== guardAceite || row.asaas_checkout_id !== claim
          || row.payment_status !== 'CREATING') return result(0);
        const candidate = {
          id, aceite_id: aceiteId, external_reference: externalReference,
          checkout_id: null, checkout_url: null, state: 'CREATING', is_current: 1,
          created_at: createdAt, updated_at: updatedAt, paid_at: null,
          superseded_at: null, failure_reason: null
        };
        if (attempts.has(id) || uniqueConflict(candidate)) throw new Error('attempt unique conflict');
        attempts.set(id, candidate);
        return result(1);
      }
      if (sql.includes('/* checkout_attempt_failed */')) {
        const [updatedAt, failureReason, id, aceiteId, guardAceite, claim] = values;
        const attempt = attempts.get(id);
        if (!row || row.id !== guardAceite || row.asaas_checkout_id !== claim
          || row.payment_status !== 'CREATING' || !attempt || attempt.aceite_id !== aceiteId
          || attempt.state !== 'CREATING' || attempt.checkout_id) return result(0);
        Object.assign(attempt, {
          state: 'CREATE_FAILED', is_current: 0, updated_at: updatedAt,
          failure_reason: failureReason
        });
        return result(1);
      }
      if (sql.includes('/* checkout_claim_release */')) {
        const [checkoutId, url, paymentStatus, status, id, claim] = values;
        if (!row || row.id !== id || row.asaas_checkout_id !== claim
          || row.payment_status !== 'CREATING') return result(0);
        Object.assign(row, {
          asaas_checkout_id: checkoutId,
          asaas_checkout_url: url,
          payment_status: paymentStatus,
          status
        });
        return result(1);
      }
      if (sql.includes('/* checkout_prior_restore */')) {
        const [restoreClaimId, , updatedAt, aceiteId, claimId, , checkoutId, , currentAceite,
          guardAceite, previousCheckout] = values;
        if (!row || row.id !== guardAceite
          || String(row.asaas_checkout_id || '') !== String(previousCheckout || '')
          || [...attempts.values()].some(attempt => attempt.aceite_id === currentAceite && attempt.is_current === 1)) {
          return result(0);
        }
        const prior = [...attempts.values()].find(attempt => attempt.aceite_id === aceiteId
          && ((claimId && attempt.id === claimId) || (checkoutId && attempt.checkout_id === checkoutId)));
        if (!prior) return result(0);
        prior.is_current = 1;
        if (restoreClaimId && prior.id === restoreClaimId && prior.state === 'SUPERSEDED') {
          prior.state = 'CREATING';
        }
        prior.superseded_at = null;
        prior.updated_at = updatedAt;
        return result(1);
      }
      if (sql.includes('/* checkout_attempt_persist */')) {
        const [checkoutId, checkoutUrl, updatedAt, id, aceiteId, expectedCheckout,
          guardAceite, claim, reconciledCheckout] = values;
        const attempt = attempts.get(id);
        if (!row || row.id !== guardAceite
          || ![claim, reconciledCheckout].includes(row.asaas_checkout_id)
          || !attempt || attempt.aceite_id !== aceiteId
          || (attempt.checkout_id && attempt.checkout_id !== expectedCheckout)) return result(0);
        if ([...attempts.values()].some(other => other.id !== id && other.checkout_id === checkoutId)) {
          throw new Error('checkout unique conflict');
        }
        attempt.checkout_id ||= checkoutId;
        attempt.checkout_url = checkoutUrl;
        if (attempt.state === 'CREATING') attempt.state = 'AWAITING_PAYMENT';
        attempt.updated_at = updatedAt;
        return result(1);
      }
      if (sql.includes('/* checkout_summary_persist */')) {
        const [checkoutId, checkoutUrl, id, claim, attemptId, aceiteId, expectedCheckout] = values;
        const attempt = attempts.get(attemptId);
        if (!row || row.id !== id || row.asaas_checkout_id !== claim
          || row.payment_status !== 'CREATING' || !attempt || attempt.aceite_id !== aceiteId
          || attempt.checkout_id !== expectedCheckout || attempt.state !== 'AWAITING_PAYMENT'
          || attempt.is_current !== 1) return result(0);
        Object.assign(row, {
          asaas_checkout_id: checkoutId,
          asaas_checkout_url: checkoutUrl,
          payment_status: 'AWAITING_PAYMENT',
          status: 'aguardando_pagamento'
        });
        return result(1);
      }
      throw new Error(`SQL de batch não tratado pelo mock: ${sql}`);
    });

    this.row = row;
    this.attempts = attempts;
    return results;
  }
}

function realSqliteD1() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of [
    '../migrations/0001_aceites.sql',
    '../migrations/0002_asaas_checkout.sql',
    '../migrations/0003_analise_v1.sql',
    '../migrations/0004_asaas_checkout_history.sql'
  ]) {
    sqlite.exec(readFileSync(new URL(file, import.meta.url), 'utf8'));
  }

  class SqliteStatement {
    constructor(sql) { this.sql = sql; this.values = []; }
    bind(...values) { this.values = values; return this; }
    async first() { return sqlite.prepare(this.sql).get(...this.values) || null; }
    async run() {
      const executed = sqlite.prepare(this.sql).run(...this.values);
      return result(Number(executed.changes));
    }
  }

  return {
    sqlite,
    d1: {
      prepare(sql) { return new SqliteStatement(sql); },
      async batch(statements) {
        sqlite.exec('BEGIN IMMEDIATE');
        try {
          const results = statements.map(statement => {
            const executed = sqlite.prepare(statement.sql).run(...statement.values);
            return result(Number(executed.changes));
          });
          sqlite.exec('COMMIT');
          return results;
        } catch (error) {
          sqlite.exec('ROLLBACK');
          throw error;
        }
      }
    }
  };
}

function acceptance(overrides = {}) {
  return {
    id: 'aceite-1',
    created_at: '2026-09-01T12:00:00.000Z',
    nome: 'Cliente Teste',
    cpf_cnpj: '12345678901',
    email: 'cliente@example.com',
    whatsapp: '19999999999',
    marca: 'Montanha Cafés',
    status: 'aceito',
    asaas_checkout_id: null,
    asaas_checkout_url: null,
    payment_status: null,
    paid_at: null,
    ...overrides
  };
}

function context(db, env = {}, extraHeaders = {}) {
  return {
    request: new Request('https://preview.example.com/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...extraHeaders },
      body: JSON.stringify({ aceite_id: 'aceite-1' })
    }),
    env: {
      ACEITES_DB: db,
      ASAAS_ENV: 'sandbox',
      ASAAS_API_KEY: 'test-secret-not-logged',
      ...env
    }
  };
}

function providerCheckout(id = 'chk-new', link) {
  const body = { id };
  if (link !== undefined) body.link = link;
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

async function responseBody(response) {
  return JSON.parse(await response.text());
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('falha fechado quando ASAAS_ENV é ausente ou inválido', async () => {
  for (const invalidEnvironment of [undefined, '', 'staging', 'prod']) {
    let fetchCalls = 0;
    globalThis.fetch = async () => { fetchCalls += 1; return providerCheckout(); };
    const response = await onRequestPost(context(new MockD1(acceptance()), { ASAAS_ENV: invalidEnvironment }));
    assert.equal(response.status, 503);
    assert.match((await responseBody(response)).error, /Ambiente de pagamento/);
    assert.equal(fetchCalls, 0);
  }
});

test('falha fechado quando PUBLIC_BASE_URL não é uma origem HTTPS pura', async () => {
  for (const invalidBase of [
    'http://rumosadv.com.br',
    'https://rumosadv.com.br/marcas',
    'https://rumosadv.com.br/?origem=teste',
    'not-a-url'
  ]) {
    let fetchCalls = 0;
    globalThis.fetch = async () => { fetchCalls += 1; return providerCheckout(); };
    const db = new MockD1(acceptance());
    const response = await onRequestPost(context(db, { PUBLIC_BASE_URL: invalidBase }));
    assert.equal(response.status, 503);
    assert.equal(fetchCalls, 0);
    assert.equal(db.row.asaas_checkout_id, null);
  }
});

test('cancela stream sem Content-Length assim que ultrapassa o limite do checkout', async () => {
  let fetchCalls = 0;
  let cancelled = false;
  globalThis.fetch = async () => { fetchCalls += 1; return providerCheckout(); };
  const db = new MockD1(acceptance());
  const request = new Request('https://preview.example.com/api/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(1024)); },
      cancel() { cancelled = true; }
    }),
    duplex: 'half'
  });

  assert.equal(request.headers.has('content-length'), false);
  const response = await onRequestPost({
    request,
    env: {
      ACEITES_DB: db,
      ASAAS_ENV: 'sandbox',
      ASAAS_API_KEY: 'test-secret-not-logged'
    }
  });

  assert.equal(response.status, 413);
  assert.match((await responseBody(response)).error, /tamanho permitido/i);
  assert.equal(cancelled, true);
  assert.equal(fetchCalls, 0);
  assert.equal(db.row.asaas_checkout_id, null);
});

test('recusa content-type e origens inseguras antes de tocar no D1 ou Asaas', async () => {
  for (const headers of [
    { 'content-type': 'text/plain' },
    { 'sec-fetch-site': 'cross-site' },
    { origin: 'https://malicioso.example' }
  ]) {
    let fetchCalls = 0;
    globalThis.fetch = async () => { fetchCalls += 1; return providerCheckout(); };
    const db = new MockD1(acceptance());
    const response = await onRequestPost(context(db, {}, headers));

    assert.ok([403, 415].includes(response.status));
    assert.equal(db.prepareCalls, 0);
    assert.equal(fetchCalls, 0);
    assert.equal(db.row.asaas_checkout_id, null);
  }
});

test('não cria outro checkout para aceite já pago', async () => {
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; return providerCheckout(); };
  const db = new MockD1(acceptance({
    asaas_checkout_id: 'chk-paid',
    asaas_checkout_url: 'https://asaas.example/paid',
    payment_status: 'PAID',
    paid_at: '2026-09-03T15:00:00.000Z'
  }));

  const response = await onRequestPost(context(db));
  const body = await responseBody(response);
  assert.equal(response.status, 409);
  assert.equal(body.paid, true);
  assert.equal(fetchCalls, 0);
  assert.equal(db.row.asaas_checkout_id, 'chk-paid');
});

test('claim atômico perde a disputa se o webhook confirmar PAID após a leitura', async () => {
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; return providerCheckout(); };
  const db = new MockD1(acceptance(), {
    afterSelect(row) {
      row.asaas_checkout_id = 'chk-paid-by-webhook';
      row.asaas_checkout_url = 'https://sandbox.asaas.com/c/paid';
      row.payment_status = 'PAID';
      row.paid_at = '2026-09-03T15:00:00.000Z';
      row.status = 'pago';
    }
  });

  const response = await onRequestPost(context(db));
  assert.equal(response.status, 409);
  assert.equal(fetchCalls, 0);
  assert.equal(db.row.payment_status, 'PAID');
  assert.equal(db.row.asaas_checkout_id, 'chk-paid-by-webhook');
});

test('não reutiliza checkout cancelado ou expirado', async () => {
  for (const terminalStatus of ['CANCELED', 'EXPIRED']) {
    let fetchCalls = 0;
    globalThis.fetch = async () => { fetchCalls += 1; return providerCheckout(`chk-${terminalStatus.toLowerCase()}`); };
    const db = new MockD1(acceptance({
      asaas_checkout_id: `chk-old-${terminalStatus.toLowerCase()}`,
      asaas_checkout_url: 'https://sandbox.asaas.com/c/old',
      payment_status: terminalStatus,
      status: terminalStatus === 'CANCELED' ? 'pagamento_cancelado' : 'pagamento_expirado'
    }));

    const response = await onRequestPost(context(db));
    const body = await responseBody(response);
    assert.equal(response.status, 201);
    assert.equal(body.reused, undefined);
    assert.equal(fetchCalls, 1);
    assert.equal(db.row.asaas_checkout_id, `chk-${terminalStatus.toLowerCase()}`);
    assert.equal(db.row.payment_status, 'AWAITING_PAYMENT');
  }
});

test('claim atômico permite somente uma criação sob concorrência', async () => {
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; return providerCheckout('chk-concurrent'); };
  const db = new MockD1(acceptance(), { selectBarrierCount: 2 });

  const [first, second] = await Promise.all([
    onRequestPost(context(db)),
    onRequestPost(context(db))
  ]);
  const statuses = [first.status, second.status].sort((a, b) => a - b);

  assert.deepEqual(statuses, [201, 409]);
  assert.equal(fetchCalls, 1);
  assert.equal(db.row.asaas_checkout_id, 'chk-concurrent');
  assert.equal(db.row.payment_status, 'AWAITING_PAYMENT');
});

test('externalReference identifica a tentativa pelo mesmo UUID do claim', async () => {
  let sentPayload;
  let claimDuringRequest;
  const db = new MockD1(acceptance());
  globalThis.fetch = async (_url, init) => {
    sentPayload = JSON.parse(init.body);
    claimDuringRequest = db.row.asaas_checkout_id;
    return providerCheckout('chk-attempt');
  };

  const response = await onRequestPost(context(db));
  const body = await responseBody(response);
  assert.equal(response.status, 201);
  assert.equal(body.checkout_url, 'https://sandbox.asaas.com/checkoutSession/show/chk-attempt');
  const match = /^creating:\d{13}:([0-9a-f-]{36})$/.exec(claimDuringRequest);
  assert.ok(match);
  assert.equal(sentPayload.externalReference, `aceite-1:${match[1]}`);
  assert.equal(sentPayload.externalReference.split(':').length, 2);
  const serializedPayload = JSON.stringify(sentPayload);
  for (const privateValue of ['Montanha Cafés', 'Cliente Teste', '12345678901', 'cliente@example.com', '19999999999']) {
    assert.equal(serializedPayload.includes(privateValue), false, `${privateValue} não deve seguir ao processador`);
  }
  assert.equal(sentPayload.items[0].description, 'Análise de viabilidade jurídica de marca');
  for (const [kind, callbackUrl] of Object.entries(sentPayload.callback)) {
    const parsed = new URL(callbackUrl);
    assert.equal(parsed.origin, 'https://preview.example.com', kind);
    assert.equal(parsed.pathname, '/marcas/aceite/pagamento/', kind);
    assert.equal(parsed.searchParams.get('aceite'), 'aceite-1', kind);
    assert.equal(parsed.searchParams.get('attempt'), match[1], kind);
  }
});

test('claim recente bloqueia nova criação e claim abandonado é recuperado', async () => {
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; return providerCheckout('chk-recovered'); };

  const recentClaim = `creating:${Date.now() - 61 * 60_000}:11111111-1111-4111-8111-111111111111`;
  const recentDb = new MockD1(acceptance({ asaas_checkout_id: recentClaim, payment_status: 'CREATING' }));
  const blocked = await onRequestPost(context(recentDb));
  assert.equal(blocked.status, 409);
  assert.equal(fetchCalls, 0);

  const staleClaim = `creating:${Date.now() - 66 * 60_000}:22222222-2222-4222-8222-222222222222`;
  const staleDb = new MockD1(acceptance({ asaas_checkout_id: staleClaim, payment_status: 'CREATING' }));
  const recovered = await onRequestPost(context(staleDb));
  assert.equal(recovered.status, 201);
  assert.equal(fetchCalls, 1);
  assert.equal(staleDb.row.asaas_checkout_id, 'chk-recovered');
});

test('claim malformado falha fechado e exige revisão operacional', async () => {
  let fetchCalls = 0;
  const entries = [];
  const originalError = console.error;
  console.error = value => entries.push(value);
  globalThis.fetch = async () => { fetchCalls += 1; return providerCheckout(); };
  try {
    const db = new MockD1(acceptance({
      asaas_checkout_id: 'creating:corrompido',
      payment_status: 'CREATING',
      status: 'criando_pagamento'
    }));
    const response = await onRequestPost(context(db));
    const body = await responseBody(response);
    assert.equal(response.status, 409);
    assert.equal(body.code, 'CHECKOUT_STATE_REQUIRES_REVIEW');
    assert.match(body.error, /Entre em contato com a Rumos/);
    assert.equal(fetchCalls, 0);
    assert.ok(entries.some(entry => JSON.parse(entry).event === 'checkout_claim_malformed'));
  } finally {
    console.error = originalError;
  }
});

test('checkout ativo é reutilizado sem chamar o Asaas e recompõe URL ausente', async () => {
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; return providerCheckout(); };
  const db = new MockD1(acceptance({
    asaas_checkout_id: 'chk-existing',
    asaas_checkout_url: null,
    payment_status: 'AWAITING_PAYMENT'
  }));

  const response = await onRequestPost(context(db));
  const body = await responseBody(response);
  assert.equal(response.status, 200);
  assert.equal(body.reused, true);
  assert.equal(body.checkout_url, 'https://sandbox.asaas.com/checkoutSession/show/chk-existing');
  assert.equal(fetchCalls, 0);
});

test('checkout ativo com URL armazenada insegura usa fallback oficial', async () => {
  let fetchCalls = 0;
  globalThis.fetch = async () => { fetchCalls += 1; return providerCheckout(); };
  const db = new MockD1(acceptance({
    asaas_checkout_id: 'chk-stored',
    asaas_checkout_url: 'https://evil.example/phishing',
    payment_status: 'AWAITING_PAYMENT'
  }));

  const response = await onRequestPost(context(db));
  const body = await responseBody(response);
  assert.equal(response.status, 200);
  assert.equal(body.checkout_url, 'https://sandbox.asaas.com/checkoutSession/show/chk-stored');
  assert.equal(fetchCalls, 0);
});

test('usa somente link HTTPS do host oficial e substitui links inseguros pelo fallback', async () => {
  for (const unsafeLink of [
    'javascript:alert(1)',
    'http://sandbox.asaas.com/checkoutSession/show/chk-safe',
    'https://evil.example/checkoutSession/show/chk-safe'
  ]) {
    globalThis.fetch = async () => providerCheckout('chk-safe', unsafeLink);
    const response = await onRequestPost(context(new MockD1(acceptance())));
    const body = await responseBody(response);
    assert.equal(response.status, 201);
    assert.equal(body.checkout_url, 'https://sandbox.asaas.com/checkoutSession/show/chk-safe');
  }

  const officialLink = 'https://sandbox.asaas.com/checkoutSession/show/chk-official?source=api';
  globalThis.fetch = async () => providerCheckout('chk-official', officialLink);
  const official = await onRequestPost(context(new MockD1(acceptance())));
  assert.equal((await responseBody(official)).checkout_url, officialLink);
});

test('4xx determinístico do Asaas libera o claim e restaura o estado anterior', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ errors: [{ description: 'Dados inválidos.' }] }), {
    status: 400,
    headers: { 'content-type': 'application/json' }
  });
  const db = new MockD1(acceptance({
    asaas_checkout_id: 'chk-expired',
    asaas_checkout_url: 'https://sandbox.asaas.com/c/expired',
    payment_status: 'EXPIRED',
    status: 'pagamento_expirado'
  }));

  const response = await onRequestPost(context(db));
  assert.equal(response.status, 502);
  assert.equal((await responseBody(response)).error, 'Dados inválidos.');
  assert.equal(db.row.asaas_checkout_id, 'chk-expired');
  assert.equal(db.row.asaas_checkout_url, 'https://sandbox.asaas.com/c/expired');
  assert.equal(db.row.payment_status, 'EXPIRED');
});

test('4xx ao substituir claim abandonado restaura a tentativa anterior como CREATING vigente', async () => {
  const attemptId = '44444444-4444-4444-8444-444444444444';
  const staleClaim = `creating:${Date.now() - 66 * 60_000}:${attemptId}`;
  globalThis.fetch = async () => new Response(JSON.stringify({
    errors: [{ description: 'Dados inválidos.' }]
  }), {
    status: 422,
    headers: { 'content-type': 'application/json' }
  });
  const db = new MockD1(acceptance({
    asaas_checkout_id: staleClaim,
    payment_status: 'CREATING',
    status: 'criando_pagamento'
  }), {
    attempts: [{
      id: attemptId,
      aceite_id: 'aceite-1',
      external_reference: `aceite-1:${attemptId}`,
      checkout_id: null,
      checkout_url: null,
      state: 'CREATING',
      is_current: 1,
      created_at: new Date(Date.now() - 66 * 60_000).toISOString(),
      updated_at: new Date(Date.now() - 66 * 60_000).toISOString(),
      paid_at: null,
      superseded_at: null,
      failure_reason: null
    }]
  });

  const response = await onRequestPost(context(db));
  assert.equal(response.status, 502);
  assert.equal(db.row.asaas_checkout_id, staleClaim);
  assert.equal(db.row.payment_status, 'CREATING');
  const restored = db.attempts.get(attemptId);
  assert.equal(restored.state, 'CREATING');
  assert.equal(restored.is_current, 1);
  assert.equal(restored.superseded_at, null);
  const failed = [...db.attempts.values()].find(entry => entry.id !== attemptId);
  assert.equal(failed.state, 'CREATE_FAILED');
  assert.equal(failed.is_current, 0);
});

test('408, 409, 425, 429 e 5xx preservam o claim porque o resultado é ambíguo', async () => {
  for (const providerStatus of [408, 409, 425, 429, 500, 503]) {
    globalThis.fetch = async () => new Response(JSON.stringify({
      errors: [{ description: 'Resposta temporária do provedor.' }]
    }), {
      status: providerStatus,
      headers: { 'content-type': 'application/json' }
    });
    const db = new MockD1(acceptance());

    const response = await onRequestPost(context(db));
    const body = await responseBody(response);
    assert.equal(response.status, 502);
    assert.match(body.error, /reconciliação/);
    assert.match(db.row.asaas_checkout_id, /^creating:/);
    assert.equal(db.row.payment_status, 'CREATING');
  }
});

test('falha ambígua de rede mantém o claim para reconciliação', async () => {
  globalThis.fetch = async () => { throw new TypeError('network unavailable'); };
  const db = new MockD1(acceptance());

  const response = await onRequestPost(context(db));
  assert.equal(response.status, 502);
  assert.match(db.row.asaas_checkout_id, /^creating:/);
  assert.equal(db.row.payment_status, 'CREATING');

  const retry = await onRequestPost(context(db));
  assert.equal(retry.status, 409);
});

test('não segue redirecionamento do Asaas com access_token e preserva o claim', async () => {
  let fetchCalls = 0;
  let receivedRedirectMode;
  globalThis.fetch = async (_url, init) => {
    fetchCalls += 1;
    receivedRedirectMode = init.redirect;
    throw new TypeError('redirect mode is set to error');
  };
  const db = new MockD1(acceptance());

  const response = await onRequestPost(context(db));

  assert.equal(response.status, 502);
  assert.equal(fetchCalls, 1);
  assert.equal(receivedRedirectMode, 'error');
  assert.match(db.row.asaas_checkout_id, /^creating:/);
  assert.equal(db.row.payment_status, 'CREATING');
});

test('falha transacional ao persistir criação não expõe URL sem vínculo confirmado', async () => {
  globalThis.fetch = async () => providerCheckout('chk-pending');
  const db = new MockD1(acceptance(), { persistThrows: true });

  const response = await onRequestPost(context(db));
  const body = await responseBody(response);
  assert.equal(response.status, 503);
  assert.equal(body.code, 'CHECKOUT_STATE_REQUIRES_REVIEW');
  assert.equal(body.checkout_id, undefined);
  assert.equal(body.checkout_url, undefined);
  assert.match(db.row.asaas_checkout_id, /^creating:/);
  const attempt = [...db.attempts.values()][0];
  assert.equal(attempt.state, 'CREATING');
  assert.equal(attempt.checkout_id, null);
});

test('UPDATE local zerado devolve URL quando o webhook reconciliou o mesmo checkout', async () => {
  globalThis.fetch = async () => providerCheckout('chk-reconciled');
  const db = new MockD1(acceptance(), {
    beforePersist(row, attempt) {
      row.asaas_checkout_id = attempt.checkoutId;
      row.asaas_checkout_url = 'https://sandbox.asaas.com/checkoutSession/show/chk-reconciled';
      row.payment_status = 'AWAITING_PAYMENT';
      row.status = 'aguardando_pagamento';
    }
  });

  const response = await onRequestPost(context(db));
  const body = await responseBody(response);
  assert.equal(response.status, 201);
  assert.equal(body.checkout_url, 'https://sandbox.asaas.com/checkoutSession/show/chk-reconciled');
  assert.equal(body.reconciliation_pending, undefined);
});

test('webhook PAID durante a persistência nunca devolve URL de checkout', async () => {
  globalThis.fetch = async () => providerCheckout('chk-paid-race');
  const db = new MockD1(acceptance(), {
    beforePersist(row, attempt) {
      row.asaas_checkout_id = attempt.checkoutId;
      row.asaas_checkout_url = attempt.url;
      row.payment_status = 'PAID';
      row.paid_at = '2026-09-03T18:00:00.000Z';
      row.status = 'pago';
    }
  });

  const response = await onRequestPost(context(db));
  const body = await responseBody(response);
  assert.equal(response.status, 409);
  assert.equal(body.paid, true);
  assert.equal(body.checkout_url, undefined);
  assert.equal(body.checkout_id, undefined);
});

test('evento terminal durante a persistência nunca devolve URL de checkout', async () => {
  globalThis.fetch = async () => providerCheckout('chk-expired-race');
  const db = new MockD1(acceptance(), {
    beforePersist(row, attempt) {
      row.asaas_checkout_id = attempt.checkoutId;
      row.asaas_checkout_url = attempt.url;
      row.payment_status = 'EXPIRED';
      row.status = 'pagamento_expirado';
    }
  });

  const response = await onRequestPost(context(db));
  const body = await responseBody(response);
  assert.equal(response.status, 409);
  assert.equal(body.checkout_url, undefined);
  assert.equal(body.checkout_id, undefined);
});

test('resposta atrasada de tentativa antiga não toma claim de tentativa nova', async () => {
  globalThis.fetch = async () => providerCheckout('chk-old-attempt');
  const newClaim = `creating:${Date.now()}:33333333-3333-4333-8333-333333333333`;
  const db = new MockD1(acceptance(), {
    beforePersist(row) {
      row.asaas_checkout_id = newClaim;
      row.asaas_checkout_url = null;
      row.payment_status = 'CREATING';
      row.status = 'criando_pagamento';
    }
  });

  const response = await onRequestPost(context(db));
  const body = await responseBody(response);
  assert.equal(response.status, 409);
  assert.equal(body.checkout_url, undefined);
  assert.equal(body.checkout_id, undefined);
  assert.equal(db.row.asaas_checkout_id, newClaim);
});

test('resposta do provedor divergente do checkout adotado pelo webhook falha fechado', async () => {
  globalThis.fetch = async () => providerCheckout('chk-provider');
  const db = new MockD1(acceptance(), {
    beforePersist(row) {
      row.asaas_checkout_id = 'chk-webhook';
      row.asaas_checkout_url = 'https://sandbox.asaas.com/checkoutSession/show/chk-webhook';
      row.payment_status = 'AWAITING_PAYMENT';
      row.status = 'aguardando_pagamento';
    }
  });

  const response = await onRequestPost(context(db));
  const body = await responseBody(response);
  assert.equal(response.status, 409);
  assert.equal(body.code, 'CHECKOUT_STATE_REQUIRES_REVIEW');
  assert.equal(body.checkout_id, undefined);
  assert.equal(body.checkout_url, undefined);
  assert.equal(db.row.asaas_checkout_id, 'chk-webhook');
  const attempt = [...db.attempts.values()][0];
  assert.equal(attempt.checkout_id, 'chk-webhook');
});

test('SQL real cria e confirma o vínculo da tentativa antes de devolver a URL', {
  skip: DatabaseSync ? false : 'node:sqlite indisponível neste runtime'
}, async () => {
  const { sqlite, d1 } = realSqliteD1();
  try {
    sqlite.prepare(`INSERT INTO aceites (
      id, created_at, nome, cpf_cnpj, email, whatsapp, marca,
      term_version, term_hash, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'aceite-1', '2026-09-01T12:00:00.000Z', 'Cliente Teste', '12345678901',
      'cliente@example.com', '19999999999', 'Montanha Cafés', 'v1', 'hash', 'aceito'
    );
    globalThis.fetch = async () => providerCheckout('chk-real');

    const response = await onRequestPost(context(d1));
    const body = await responseBody(response);
    assert.equal(response.status, 201);
    assert.equal(body.checkout_id, 'chk-real');
    const history = sqlite.prepare(`
      SELECT aceite_id, checkout_id, state, is_current
      FROM asaas_checkout_attempts
    `).get();
    assert.equal(history.aceite_id, 'aceite-1');
    assert.equal(history.checkout_id, 'chk-real');
    assert.equal(history.state, 'AWAITING_PAYMENT');
    assert.equal(history.is_current, 1);
    const summary = sqlite.prepare(`
      SELECT asaas_checkout_id, payment_status FROM aceites WHERE id = ?
    `).get('aceite-1');
    assert.equal(summary.asaas_checkout_id, 'chk-real');
    assert.equal(summary.payment_status, 'AWAITING_PAYMENT');
  } finally {
    sqlite.close();
  }
});

test('SQL real restaura claim A se a substituição B for rejeitada', {
  skip: DatabaseSync ? false : 'node:sqlite indisponível neste runtime'
}, async () => {
  const { sqlite, d1 } = realSqliteD1();
  const attemptA = '55555555-5555-4555-8555-555555555555';
  const claimA = `creating:${Date.now() - 66 * 60_000}:${attemptA}`;
  try {
    sqlite.prepare(`INSERT INTO aceites (
      id, created_at, nome, cpf_cnpj, email, whatsapp, marca,
      term_version, term_hash, status, asaas_checkout_id, payment_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      'aceite-1', '2026-09-01T12:00:00.000Z', 'Cliente Teste', '12345678901',
      'cliente@example.com', '19999999999', 'Montanha Cafés', 'v1', 'hash',
      'criando_pagamento', claimA, 'CREATING'
    );
    sqlite.prepare(`INSERT INTO asaas_checkout_attempts (
      id, aceite_id, external_reference, state, is_current, created_at, updated_at
    ) VALUES (?, ?, ?, 'CREATING', 1, ?, ?)`).run(
      attemptA, 'aceite-1', `aceite-1:${attemptA}`,
      '2026-09-01T12:00:00.000Z', '2026-09-01T12:00:00.000Z'
    );
    globalThis.fetch = async () => new Response(JSON.stringify({
      errors: [{ description: 'Dados inválidos.' }]
    }), { status: 422, headers: { 'content-type': 'application/json' } });

    const response = await onRequestPost(context(d1));
    assert.equal(response.status, 502);
    const restored = sqlite.prepare(`
      SELECT state, is_current, superseded_at
      FROM asaas_checkout_attempts WHERE id = ?
    `).get(attemptA);
    assert.equal(restored.state, 'CREATING');
    assert.equal(restored.is_current, 1);
    assert.equal(restored.superseded_at, null);
    const failed = sqlite.prepare(`
      SELECT state, is_current FROM asaas_checkout_attempts WHERE id <> ?
    `).get(attemptA);
    assert.equal(failed.state, 'CREATE_FAILED');
    assert.equal(failed.is_current, 0);
    const summary = sqlite.prepare(`
      SELECT asaas_checkout_id, payment_status FROM aceites WHERE id = ?
    `).get('aceite-1');
    assert.equal(summary.asaas_checkout_id, claimA);
    assert.equal(summary.payment_status, 'CREATING');
  } finally {
    sqlite.close();
  }
});

test('logs do fluxo não incluem a chave da API e são JSON estruturado', async () => {
  const entries = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = value => entries.push(value);
  console.error = value => entries.push(value);
  try {
    globalThis.fetch = async () => providerCheckout('chk-log');
    const response = await onRequestPost(context(new MockD1(acceptance())));
    assert.equal(response.status, 201);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }

  assert.ok(entries.length >= 2);
  for (const entry of entries) assert.doesNotThrow(() => JSON.parse(entry));
  assert.equal(entries.join('\n').includes('test-secret-not-logged'), false);
});
