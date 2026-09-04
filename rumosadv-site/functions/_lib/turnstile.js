import { JsonBodyError, readBoundedJson } from './bounded-json.js';

export const TURNSTILE_ACTION = 'marcas_aceite';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_TOKEN_LENGTH = 2048;
const MAX_SITEVERIFY_RESPONSE_BYTES = 16 * 1024;
const SITEVERIFY_TIMEOUT_MS = 5000;

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

function unavailable(reason) {
  return { ok: false, unavailable: true, reason };
}

function invalid(reason) {
  return { ok: false, unavailable: false, reason };
}

export async function verifyTurnstile({
  env,
  token,
  remoteIp,
  fetchImpl = fetch,
  timeoutMs = SITEVERIFY_TIMEOUT_MS
}) {
  const configuration = turnstileConfiguration(env);
  if (!configuration) return unavailable('not_configured');
  if (typeof token !== 'string' || !token.trim()) return invalid('missing_token');
  if (token.length > MAX_TOKEN_LENGTH) return invalid('token_too_long');

  const body = new FormData();
  body.set('secret', configuration.secret);
  body.set('response', token);
  // A chave do Siteverify pertence a esta validação deste token. Ela não pode
  // reutilizar a chave persistente do aceite quando o widget gerar outro token.
  body.set('idempotency_key', crypto.randomUUID());
  if (typeof remoteIp === 'string' && remoteIp.trim()) body.set('remoteip', remoteIp.trim().slice(0, 64));

  const controller = new AbortController();
  let timeoutId;
  try {
    const timeout = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort('Turnstile Siteverify timeout');
        reject(new Error('siteverify_timeout'));
      }, timeoutMs);
    });
    const response = await Promise.race([
      fetchImpl(SITEVERIFY_URL, {
        method: 'POST',
        body,
        signal: controller.signal,
        redirect: 'error'
      }),
      timeout
    ]);
    if (!response || !response.ok) return unavailable('siteverify_http_error');

    let result;
    try {
      result = await readBoundedJson(response, MAX_SITEVERIFY_RESPONSE_BYTES);
    } catch (error) {
      if (error instanceof JsonBodyError) return unavailable('siteverify_invalid_response');
      throw error;
    }

    if (!result || result.success !== true) {
      const codes = Array.isArray(result?.['error-codes']) ? result['error-codes'] : [];
      return codes.includes('internal-error')
        ? unavailable('siteverify_internal_error')
        : invalid('challenge_rejected');
    }

    if (result.action !== configuration.action) return invalid('action_mismatch');
    const hostname = typeof result.hostname === 'string'
      ? result.hostname.trim().toLowerCase().replace(/\.$/, '')
      : '';
    if (!configuration.allowedHostnames.includes(hostname)) return invalid('hostname_mismatch');

    return { ok: true };
  } catch {
    return unavailable('siteverify_network_error');
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
