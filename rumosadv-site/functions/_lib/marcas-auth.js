const encoder = new TextEncoder();

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  return Uint8Array.from(atob(padded), c => c.charCodeAt(0));
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}

export async function createBriefingToken(aceiteId, secret, ttlSeconds = 604800) {
  const payload = toBase64Url(encoder.encode(JSON.stringify({ id: aceiteId, exp: Math.floor(Date.now() / 1000) + ttlSeconds })));
  return `${payload}.${await sign(payload, secret)}`;
}

export async function verifyBriefingToken(token, secret) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return null;
  const expected = await sign(payload, secret);
  const a = encoder.encode(signature), b = encoder.encode(expected);
  if (a.length !== b.length) return null;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  if (difference !== 0) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    if (!parsed.id || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch { return null; }
}

export function isAdmin(request, secret) {
  if (!secret) return false;
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') && header.slice(7) === secret;
}

