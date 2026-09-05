import { JsonBodyError, readBoundedJson } from './bounded-json.js';

export const TURNSTILE_ACTION = 'marcas_aceite';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_TOKEN_LENGTH = 2048;
const MAX_SITEVERIFY_RESPONSE_BYTES = 16 * 1024;
const SITEVERIFY_TIMEOUT_MS = 10_000;
const SITEVERIFY_MAX_ATTEMPTS = 2;
const SITEVERIFY_RETRY_DELAY_MS = 150;

function configuredString(value, maximumLength) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized && normalized.length <= maximumLength ? normalized : '';
}

export function allowedTurnstileHostnames(value) {
  if (typeof value !== 'string') return [];
  return [...new Set(value
    .split(',')
    .map(hostname => hostname.trim().toLowerCase().replace(/\.$/, ''))
    .filter(hostname => hostname && hostname.length <= 253 && hostname.split('.').every(label => (
      label.length >= 1
      && label.length <= 63
      && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
    )))
  )];
}

export function turnstileConfiguration(env) {
  const sitekey = configuredString(env?.TURNSTILE_SITE_KEY, 128);
  const secret = configuredString(env?.TURNSTILE_SECRET_KEY, 256);
  const allowedHostnames = allowedTurnstileHostnames(env?.TURNSTILE_ALLOWED_HOSTNAMES);
  if (!sitekey || !secret || !allowedHostnames.length) return null;
  return { sitekey, secret, allowedHostnames, action: TURNSTILE_ACTION };
}

function safeResultMetadata(startedAt, attempts, httpStatus) {
  const metadata = {
    attempts,
    duration_ms: Math.max(0, Date.now() - startedAt)
  };
  if (Number.isInteger(httpStatus)) metadata.http_status = httpStatus;
  return metadata;
}

function unavailable(reason, startedAt, attempts, httpStatus) {
  return {
    ok: false,
    unavailable: true,
    reason,
    ...safeResultMetadata(startedAt, attempts, httpStatus)
  };
}

function invalid(reason, startedAt, attempts, httpStatus) {
  return {
    ok: false,
    unavailable: false,
    reason,
    ...safeResultMetadata(startedAt, attempts, httpStatus)
  };
}

function verified(startedAt, attempts, httpStatus) {
  return {
    ok: true,
    reason: 'verified',
    ...safeResultMetadata(startedAt, attempts, httpStatus)
  };
}

function siteverifyBody(configuration, token, remoteIp, idempotencyKey) {
  const body = {
    secret: configuration.secret,
    response: token,
    idempotency_key: idempotencyKey
  };
  if (typeof remoteIp === 'string' && remoteIp.trim()) body.remoteip = remoteIp.trim().slice(0, 64);
  return JSON.stringify(body);
}

function retryableHttpStatus(status) {
  return status === 408
    || status === 425
    || status === 429
    || (status >= 500 && status <= 599);
}

function wait(milliseconds) {
  if (!milliseconds) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function fetchSiteverify({ fetchImpl, body, timeoutMs }) {
  const controller = new AbortController();
  let timeoutId;
  let timedOut = false;
  try {
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort('Turnstile Siteverify timeout');
        reject(new Error('siteverify_timeout'));
      }, timeoutMs);
    });
    const response = await Promise.race([
      fetchImpl(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal
      }),
      timeout
    ]);
    return { response };
  } catch {
    return { error: timedOut ? 'siteverify_timeout' : 'siteverify_network_error' };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function verifyTurnstile({
  env,
  token,
  remoteIp,
  fetchImpl,
  timeoutMs = SITEVERIFY_TIMEOUT_MS,
  retryDelayMs = SITEVERIFY_RETRY_DELAY_MS
}) {
  const startedAt = Date.now();
  const configuration = turnstileConfiguration(env);
  if (!configuration) return unavailable('not_configured', startedAt, 0);
  if (typeof token !== 'string' || !token.trim()) return invalid('missing_token', startedAt, 0);
  if (token.length > MAX_TOKEN_LENGTH) return invalid('token_too_long', startedAt, 0);

  // Repetições da validação do mesmo token usam a mesma chave do Siteverify.
  // Outro token, inclusive após reset do widget, recebe uma chave nova.
  const siteverifyIdempotencyKey = crypto.randomUUID();
  // Mantém a chamada nativa vinculada ao contexto da requisição do Worker.
  // Os testes ainda podem injetar uma implementação controlada.
  const requestFetch = typeof fetchImpl === 'function'
    ? fetchImpl
    : (input, init) => fetch(input, init);

  for (let attempts = 1; attempts <= SITEVERIFY_MAX_ATTEMPTS; attempts += 1) {
    const body = siteverifyBody(configuration, token, remoteIp, siteverifyIdempotencyKey);
    const outcome = await fetchSiteverify({ fetchImpl: requestFetch, body, timeoutMs });

    if (outcome.error) {
      if (attempts < SITEVERIFY_MAX_ATTEMPTS) {
        await wait(retryDelayMs);
        continue;
      }
      return unavailable(outcome.error, startedAt, attempts);
    }

    const response = outcome.response;
    const httpStatus = Number.isInteger(response?.status) ? response.status : undefined;
    if (!response || !response.ok) {
      if (attempts < SITEVERIFY_MAX_ATTEMPTS && retryableHttpStatus(httpStatus)) {
        await wait(retryDelayMs);
        continue;
      }
      return unavailable('siteverify_http_error', startedAt, attempts, httpStatus);
    }

    let result;
    try {
      result = await readBoundedJson(response, MAX_SITEVERIFY_RESPONSE_BYTES);
    } catch (error) {
      if (error instanceof JsonBodyError) {
        return unavailable('siteverify_invalid_response', startedAt, attempts, httpStatus);
      }
      if (attempts < SITEVERIFY_MAX_ATTEMPTS) {
        await wait(retryDelayMs);
        continue;
      }
      return unavailable('siteverify_network_error', startedAt, attempts, httpStatus);
    }

    if (!result || result.success !== true) {
      const codes = Array.isArray(result?.['error-codes']) ? result['error-codes'] : [];
      if (codes.includes('internal-error')) {
        if (attempts < SITEVERIFY_MAX_ATTEMPTS) {
          await wait(retryDelayMs);
          continue;
        }
        return unavailable('siteverify_internal_error', startedAt, attempts, httpStatus);
      }
      return invalid('challenge_rejected', startedAt, attempts, httpStatus);
    }

    if (result.action !== configuration.action) {
      return invalid('action_mismatch', startedAt, attempts, httpStatus);
    }
    const hostname = typeof result.hostname === 'string'
      ? result.hostname.trim().toLowerCase().replace(/\.$/, '')
      : '';
    if (!configuration.allowedHostnames.includes(hostname)) {
      return invalid('hostname_mismatch', startedAt, attempts, httpStatus);
    }

    return verified(startedAt, attempts, httpStatus);
  }

  return unavailable('siteverify_network_error', startedAt, SITEVERIFY_MAX_ATTEMPTS);
}
