const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

function apiBase(env) {
  return env.ASAAS_ENV === 'production'
    ? 'https://api.asaas.com/v3'
    : 'https://api-sandbox.asaas.com/v3';
}

function publicBase(request, env) {
  if (env.PUBLIC_BASE_URL) return String(env.PUBLIC_BASE_URL).replace(/\/$/, '');
  const u = new URL(request.url);
  return `${u.protocol}//${u.host}`;
}

export async function onRequestPost(context) {
  try {
    if (!context.env.ACEITES_DB) return json({ error: 'Banco de aceites não configurado.' }, 503);
    if (!context.env.ASAAS_API_KEY) return json({ error: 'Integração de pagamento ainda não configurada.' }, 503);

    const body = await context.request.json();
    const aceiteId = String(body.aceite_id || '').trim();
    if (!aceiteId) return json({ error: 'Aceite não informado.' }, 400);

    const aceite = await context.env.ACEITES_DB.prepare(`
      SELECT id, nome, cpf_cnpj, email, whatsapp, marca, asaas_checkout_id, asaas_checkout_url
      FROM aceites WHERE id = ? LIMIT 1
    `).bind(aceiteId).first();

    if (!aceite) return json({ error: 'Aceite não encontrado.' }, 404);

    if (aceite.asaas_checkout_id && aceite.asaas_checkout_url) {
      return json({ ok: true, checkout_id: aceite.asaas_checkout_id, checkout_url: aceite.asaas_checkout_url, reused: true });
    }

    const base = publicBase(context.request, context.env);
    const callbackBase = `${base}/marcas/aceite/pagamento/`;
    const cpfCnpj = String(aceite.cpf_cnpj || '').replace(/\D/g, '');
    const phone = String(aceite.whatsapp || '').replace(/\D/g, '');

    const payload = {
      billingTypes: ['PIX', 'CREDIT_CARD'],
      chargeTypes: ['DETACHED'],
      minutesToExpire: 60,
      externalReference: aceite.id,
      callback: {
        successUrl: `${callbackBase}?status=sucesso&aceite=${encodeURIComponent(aceite.id)}`,
        cancelUrl: `${callbackBase}?status=cancelado&aceite=${encodeURIComponent(aceite.id)}`,
        expiredUrl: `${callbackBase}?status=expirado&aceite=${encodeURIComponent(aceite.id)}`
      },
      items: [{
        externalReference: 'analise-viabilidade-rumos',
        name: 'Análise de Marca',
        description: `Análise de viabilidade jurídica da marca ${aceite.marca}`,
        quantity: 1,
        value: 390
      }]
    };

    const response = await fetch(`${apiBase(context.env)}/checkouts`, {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'access_token': context.env.ASAAS_API_KEY,
        'user-agent': 'RumosAdvocacia-Checkout/1.0 (+https://rumosadv.com.br)'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('asaas_checkout_error', response.status, data);
      const detail = data?.errors?.[0]?.description || 'Não foi possível iniciar o pagamento.';
      return json({ error: detail }, 502);
    }

    const checkoutId = data.id;
    const checkoutUrl = data.link || `${context.env.ASAAS_ENV === 'production' ? 'https://asaas.com' : 'https://sandbox.asaas.com'}/checkoutSession/show/${checkoutId}`;
    if (!checkoutId || !checkoutUrl) return json({ error: 'Resposta inválida do provedor de pagamento.' }, 502);

    await context.env.ACEITES_DB.prepare(`
      UPDATE aceites
      SET asaas_checkout_id = ?, asaas_checkout_url = ?, payment_status = 'AWAITING_PAYMENT', status = 'aguardando_pagamento'
      WHERE id = ?
    `).bind(checkoutId, checkoutUrl, aceite.id).run();

    return json({ ok: true, checkout_id: checkoutId, checkout_url: checkoutUrl }, 201);
  } catch (error) {
    console.error('checkout_error', error);
    return json({ error: 'Não foi possível iniciar o pagamento.' }, 500);
  }
}

export function onRequestGet() {
  return json({ error: 'Método não permitido.' }, 405);
}
