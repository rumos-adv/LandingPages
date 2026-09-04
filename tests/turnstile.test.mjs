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

function assertSafeMetadata(result, { attempts, httpStatus }) {
  assert.equal(result.attempts, attempts);
  assert.equal(Number.isSafeInteger(result.duration_ms), true);
  assert.ok(result.duration_ms >= 0);
  if (httpStatus === undefined) assert.equal('http_status' in result, false);
  else assert.equal(result.http_status, httpStatus);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(env.TURNSTILE_SECRET_KEY), false);
  assert.equal(serialized.includes('token-efemero'), false);
  assert.equal(serialized.includes('192.0.2.9'), false);
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

  assert.equal(result.ok, true);
  assert.equal(result.reason, 'verified');
  assertSafeMetadata(result, { attempts: 1, httpStatus: 200 });
  assert.equal(captured.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.redirect, undefined);
  assert.equal(captured.options.headers['Content-Type'], 'application/x-www-form-urlencoded');
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
  for (const [token, reason] of [['', 'missing_token'], ['x'.repeat(2049), 'token_too_long']]) {
    let calls = 0;
    const result = await verifyTurnstile({
      env,
      token,
      fetchImpl: async () => { calls += 1; return siteverifyResponse(); }
    });
    assert.equal(result.ok, false);
    assert.equal(result.unavailable, false);
    assert.equal(result.reason, reason);
    assertSafeMetadata(result, { attempts: 0 });
    assert.equal(calls, 0);
  }
});

test('recusa sucesso criptográfico com action ou hostname divergentes', async () => {
  for (const [response, reason] of [
    [siteverifyResponse({ action: 'outra_acao' }), 'action_mismatch'],
    [siteverifyResponse({ hostname: 'rumosadv.com.br.evil.test' }), 'hostname_mismatch']
  ]) {
    const result = await verifyTurnstile({
      env,
      token: 'token-valido',
      fetchImpl: async () => response
    });
    assert.equal(result.ok, false);
    assert.equal(result.unavailable, false);
    assert.equal(result.reason, reason);
    assertSafeMetadata(result, { attempts: 1, httpStatus: 200 });
  }
});

test('não repete rejeições permanentes nem respostas malformadas', async () => {
  const cases = [
    {
      fetch: async () => siteverifyResponse({ success: false, 'error-codes': ['invalid-input-response'] }),
      unavailable: false,
      reason: 'challenge_rejected',
      httpStatus: 200
    },
    {
      fetch: async () => new Response('{', { status: 200 }),
      unavailable: true,
      reason: 'siteverify_invalid_response',
      httpStatus: 200
    },
    {
      fetch: async () => siteverifyResponse({}, 400),
      unavailable: true,
      reason: 'siteverify_http_error',
      httpStatus: 400
    }
  ];

  for (const scenario of cases) {
    let calls = 0;
    const result = await verifyTurnstile({
      env,
      token: 'token-valido',
      fetchImpl: async (...args) => {
        calls += 1;
        return scenario.fetch(...args);
      },
      retryDelayMs: 0
    });
    assert.equal(result.ok, false);
    assert.equal(result.unavailable, scenario.unavailable);
    assert.equal(result.reason, scenario.reason);
    assertSafeMetadata(result, { attempts: 1, httpStatus: scenario.httpStatus });
    assert.equal(calls, 1);
  }
});

test('repete uma única vez causas transitórias e reutiliza a idempotency_key do Siteverify', async t => {
  const scenarios = [
    {
      name: 'HTTP 502',
      first: async () => siteverifyResponse({}, 502),
      timeoutMs: 100
    },
    {
      name: 'internal-error',
      first: async () => siteverifyResponse({ success: false, 'error-codes': ['internal-error'] }),
      timeoutMs: 100
    },
    {
      name: 'erro de rede',
      first: async () => { throw new Error('rede indisponível'); },
      timeoutMs: 100
    },
    {
      name: 'timeout',
      first: async (_url, options) => new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('abortado')), { once: true });
      }),
      timeoutMs: 5
    }
  ];

  for (const scenario of scenarios) {
    await t.test(scenario.name, async () => {
      const verificationKeys = [];
      let calls = 0;
      const result = await verifyTurnstile({
        env,
        token: 'token-valido',
        fetchImpl: async (url, options) => {
          calls += 1;
          verificationKeys.push(options.body.get('idempotency_key'));
          if (calls === 1) return scenario.first(url, options);
          return siteverifyResponse();
        },
        timeoutMs: scenario.timeoutMs,
        retryDelayMs: 0
      });

      assert.equal(result.ok, true);
      assert.equal(result.reason, 'verified');
      assertSafeMetadata(result, { attempts: 2, httpStatus: 200 });
      assert.equal(calls, 2);
      assert.equal(verificationKeys.length, 2);
      assert.equal(verificationKeys[0], verificationKeys[1]);
    });
  }
});

test('encerra após uma única repetição transitória e expõe apenas metadados seguros', async () => {
  const verificationKeys = [];
  const result = await verifyTurnstile({
    env,
    token: 'token-efemero-que-nao-pode-vazar',
    remoteIp: '192.0.2.9',
    fetchImpl: async (_url, options) => {
      verificationKeys.push(options.body.get('idempotency_key'));
      return siteverifyResponse({}, 503);
    },
    retryDelayMs: 0
  });

  assert.equal(result.ok, false);
  assert.equal(result.unavailable, true);
  assert.equal(result.reason, 'siteverify_http_error');
  assertSafeMetadata(result, { attempts: 2, httpStatus: 503 });
  assert.equal(verificationKeys.length, 2);
  assert.equal(verificationKeys[0], verificationKeys[1]);
});
