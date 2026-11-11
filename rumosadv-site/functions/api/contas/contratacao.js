// Página do cliente: mostra o estado (assinar → pagar → confirmado) e cria o checkout só depois da assinatura.
import { json, readClientToken, publicView, createAsaasCheckout, publicBase, createSignatureLink } from '../../_lib/contas-contratacao.js';

async function load(context, token) {
  if (!context.env.ACEITES_DB || !context.env.BRIEFING_SIGNING_SECRET) return { error: json({ error: 'Contratação indisponível no momento.' }, 503) };
  const id = await readClientToken(token, context.env);
  if (!id) return { error: json({ error: 'Link inválido ou expirado. Peça um novo link pelo WhatsApp.' }, 401) };
  const row = await context.env.ACEITES_DB.prepare(`SELECT * FROM contas_contratacoes WHERE id=?`).bind(id).first();
  if (!row || row.status === 'cancelado') return { error: json({ error: 'Contratação não encontrada.' }, 404) };
  return { row };
}

export async function onRequestGet(context) {
  const { row, error } = await load(context, new URL(context.request.url).searchParams.get('t'));
  if (error) return error;
  // Link de assinatura ausente (não devolvido na criação): gera agora e guarda.
  if (row.status === 'aguardando_assinatura' && !row.sign_url && row.client_signature_id && context.env.AUTENTIQUE_TOKEN) {
    try {
      row.sign_url = await createSignatureLink(row.client_signature_id, context.env);
      await context.env.ACEITES_DB.prepare(`UPDATE contas_contratacoes SET sign_url=?, updated_at=? WHERE id=?`).bind(row.sign_url, new Date().toISOString(), row.id).run();
    } catch (e) { console.error('contas_sign_link_error', e?.message, e?.detail); }
  }
  return json({ ok: true, contratacao: publicView(row) });
}

export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => ({}));
  const { row, error } = await load(context, body.t);
  if (error) return error;
  if (!context.env.ASAAS_API_KEY) return json({ error: 'Pagamento ainda não configurado.' }, 503);
  const v = publicView(row);
  if (!v.podePagar) return json({ error: row.status === 'aguardando_assinatura' ? 'Assine o contrato antes do pagamento.' : 'Pagamento indisponível para esta contratação.' }, 409);
  if (row.checkout_url && row.status === 'aguardando_pagamento') return json({ ok: true, checkoutUrl: row.checkout_url, reused: true });
  try {
    const out = await createAsaasCheckout(row, publicBase(context.request, context.env), body.t, context.env);
    const now = new Date().toISOString();
    await context.env.ACEITES_DB.prepare(`UPDATE contas_contratacoes SET asaas_checkout_id=?, checkout_url=?, payment_status='AWAITING_PAYMENT', status='aguardando_pagamento', updated_at=? WHERE id=?`).bind(out.checkoutId, out.checkoutUrl, now, row.id).run();
    return json({ ok: true, checkoutUrl: out.checkoutUrl }, 201);
  } catch (e) {
    console.error('contas_checkout_error', e?.message, e?.detail);
    return json({ error: 'Não foi possível abrir o pagamento agora. Tente de novo em instantes ou avise pelo WhatsApp.' }, 502);
  }
}
