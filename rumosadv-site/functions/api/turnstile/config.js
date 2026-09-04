import { turnstileConfiguration } from '../../_lib/turnstile.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, max-age=0',
    'x-content-type-options': 'nosniff'
  }
});

export function onRequestGet(context) {
  const configuration = turnstileConfiguration(context.env);
  if (!configuration) {
    return json({ error: 'A verificação de segurança está temporariamente indisponível.' }, 503);
  }
  return json({ sitekey: configuration.sitekey, action: configuration.action });
}

export function onRequestPost() {
  return json({ error: 'Método não permitido.' }, 405);
}
