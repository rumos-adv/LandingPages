import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequestGet as getConfig, onRequestPost as rejectConfigMethod } from '../rumosadv-site/functions/api/turnstile/config.js';
import {
  TURNSTILE_ACTION,
  allowedTurnstileHostnames,
  verifyTurnstile
} from '../rumosadv-site/functions/_lib/turnstile.js';

const env = {
  TURNSTILE_SITE_KEY: 'public-site-key',
  TURNSTILE_SECRET_KEY: 'private-secret-key',
  TURNSTILE_ALLOWED_HOSTNAMES: 'rumosadv.com.br, www.rumosadv.com.br,FEAT-MARCAS.pages.dev'
};

function siteverifyResponse(overrides = {}, status = 200) {
  return new Response(JSON.stringify({
    success: true,
    action: TURNSTILE_ACTION,
    hostname: 'rumosadv.com.br',
    'error-codes': [],
    ...overrides
  }), { status, headers: { 'content-type': 'application/json' } });
}

test('configuração pública expõe apenas sitekey e action e nunca é cacheada', async () => {
  const response = getConfig({ env });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, { sitekey: 'public-site-key', action: TURNSTILE_ACTION });
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(JSON.stringify(body).includes(env.TURNSTILE_SECRET_KEY), false);
  assert.equal(JSON.stringify(body).includes('rumosadv.com.br'), false);
});

test('configuração pública falha fechado se qualquer binding obrigatório faltar', async () => {
  for (const missing of ['TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY', 'TURNSTILE_ALLOWED_HOSTNAMES']) {
    const incomplete = { ...env };
    delete incomplete[missing];
    const response = getConfig({ env: incomplete });
    assert.equal(response.status, 503);
    assert.match(response.headers.get('cache-control'), /no-store/);
  }
  assert.equal(rejectConfigMethod().status, 405);
});

test('normaliza e deduplica somente hostnames válidos configurados', () => {
  assert.deepEqual(
    allowedTurnstileHostnames(' EXAMPLE.COM.,example.com, sub.example.com, https://evil.test, '),
    ['example.com', 'sub.example.com']
  );
});

test('Siteverify recebe token, IP e UUID próprio sem expor segredo na URL', async () => {
  let captured;
  const result = await verifyTurnstile({
    env,
    token: 'token-efemero',
    remoteIp: '192.0.2.9',
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return siteverifyResponse();
    }
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(captured.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.redirect, 'error');
  assert.equal(captured.url.includes(env.TURNSTILE_SECRET_KEY), false);
  assert.equal(captured.options.body.get('secret'), env.TURNSTILE_SECRET_KEY);
  assert.equal(captured.options.body.get('response'), 'token-efemero');
  assert.equal(captured.options.body.get('remoteip'), '192.0.2.9');
  assert.match(captured.options.body.get('idempotency_key'), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
});

test('tokens distintos nunca reutilizam a chave idempotente do Siteverify', async () => {
  const verificationKeys = [];
  for (const token of ['token-um', 'token-dois']) {
    const result = await verifyTurnstile({
      env,
      token,
      fetchImpl: async (_url, options) => {
        verificationKeys.push(options.body.get('idempotency_key'));
        return siteverifyResponse();
      }
    });
    assert.equal(result.ok, true);
  }
  assert.equal(verificationKeys.length, 2);
  assert.notEqual(verificationKeys[0], verificationKeys[1]);
});

test('recusa token ausente ou acima de 2048 caracteres antes de chamar a rede', async () => {
  for (const token of ['', 'x'.repeat(2049)]) {
    let calls = 0;
    const result = await verifyTurnstile({
      env,
      token,
      fetchImpl: async () => { calls += 1; return siteverifyResponse(); }
    });
    assert.equal(result.ok, false);
    assert.equal(result.unavailable, false);
    assert.equal(calls, 0);
  }
});

test('recusa sucesso criptográfico com action ou hostname divergentes', async () => {
  for (const response of [
    siteverifyResponse({ action: 'outra_acao' }),
    siteverifyResponse({ hostname: 'rumosadv.com.br.evil.test' })
  ]) {
    const result = await verifyTurnstile({
      env,
      token: 'token-valido',
      fetchImpl: async () => response
    });
    assert.equal(result.ok, false);
    assert.equal(result.unavailable, false);
  }
});

test('falha fechado em rejeição, resposta inválida, erro HTTP e timeout', async () => {
  const cases = [
    async () => siteverifyResponse({ success: false, 'error-codes': ['invalid-input-response'] }),
    async () => new Response('{', { status: 200 }),
    async () => siteverifyResponse({}, 502),
    async (_url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('abortado')), { once: true });
    })
  ];

  for (let index = 0; index < cases.length; index += 1) {
    const result = await verifyTurnstile({
      env,
      token: 'token-valido',
      fetchImpl: cases[index],
      timeoutMs: index === cases.length - 1 ? 5 : 100
    });
    assert.equal(result.ok, false);
    if (index > 0) assert.equal(result.unavailable, true);
  }
});
