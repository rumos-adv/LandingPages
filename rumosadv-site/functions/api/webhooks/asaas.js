const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

const EVENT_STATUS = {
  CHECKOUT_CREATED: ['aguardando_pagamento', 'AWAITING_PAYMENT'],
  CHECKOUT_CANCELED: ['pagamento_cancelado', 'CANCELED'],
  CHECKOUT_EXPIRED: ['pagamento_expirado', 'EXPIRED'],
  CHECKOUT_PAID: ['pago', 'PAID']
};

export async function onRequestPost(context) {
  try {
    if (!context.env.ACEITES_DB) return json({ error: 'Banco não configurado.' }, 503);
    if (!context.env.ASAAS_WEBHOOK_TOKEN) return json({ error: 'Webhook não configurado.' }, 503);

    const token = context.request.headers.get('asaas-access-token') || '';
    if (token !== context.env.ASAAS_WEBHOOK_TOKEN) return json({ error: 'Não autorizado.' }, 401);

    const event = await context.request.json();
    const eventId = String(event?.id || '').trim();
    const eventName = String(event?.event || '').trim();
    const checkoutId = String(event?.checkout?.id || '').trim() || null;

    if (!eventId || !eventName) return json({ error: 'Evento inválido.' }, 400);

    const insert = await context.env.ACEITES_DB.prepare(`
      INSERT OR IGNORE INTO asaas_webhook_events (id, event, checkout_id, received_at, payload)
      VALUES (?, ?, ?, ?, ?)
    `).bind(eventId, eventName, checkoutId, new Date().toISOString(), JSON.stringify(event)).run();

    if (!insert.meta?.changes) return json({ ok: true, duplicate: true });

    if (checkoutId && EVENT_STATUS[eventName]) {
      const [status, paymentStatus] = EVENT_STATUS[eventName];
      const paidAt = eventName === 'CHECKOUT_PAID' ? new Date().toISOString() : null;

      await context.env.ACEITES_DB.prepare(`
        UPDATE aceites
        SET status = ?, payment_status = ?, paid_at = COALESCE(?, paid_at)
        WHERE asaas_checkout_id = ?
      `).bind(status, paymentStatus, paidAt, checkoutId).run();
    }

    return json({ ok: true });
  } catch (error) {
    console.error('asaas_webhook_error', error);
    return json({ error: 'Erro ao processar webhook.' }, 500);
  }
}

export function onRequestGet() {
  return json({ error: 'Método não permitido.' }, 405);
}
