// Webhook da Autentique: marca a contratação como assinada quando o cliente assina.
import { json, verifyHmacHex, parseAutentiqueEvent } from '../../_lib/contas-contratacao.js';

export async function onRequestPost(context) {
  const env = context.env;
  if (!env.ACEITES_DB || !env.AUTENTIQUE_WEBHOOK_SECRET) return json({ error: 'Webhook não configurado.' }, 503);
  const raw = await context.request.text();
  const ok = await verifyHmacHex(raw, context.request.headers.get('x-autentique-signature'), env.AUTENTIQUE_WEBHOOK_SECRET);
  if (!ok) return json({ error: 'Não autorizado.' }, 401);
  let body; try { body = JSON.parse(raw); } catch { return json({ error: 'Evento inválido.' }, 400); }
  const ev = parseAutentiqueEvent(body);
  if (!ev.type || !ev.documentId) return json({ ok: true, ignored: true });
  const now = new Date().toISOString();
  const ins = await env.ACEITES_DB.prepare(`INSERT OR IGNORE INTO autentique_webhook_events (id, type, document_id, received_at) VALUES (?, ?, ?, ?)`).bind(ev.eventId, ev.type, ev.documentId, now).run();
  if (!ins.meta?.changes) return json({ ok: true, duplicate: true });
  const row = await env.ACEITES_DB.prepare(`SELECT id, status, client_signature_id FROM contas_contratacoes WHERE autentique_document_id=?`).bind(ev.documentId).first();
  if (!row) return json({ ok: true, unknown: true });
  const clientSigned = (ev.type === 'signature.accepted' && (!row.client_signature_id || ev.signatureId === row.client_signature_id)) || ev.type === 'document.finished';
  if (clientSigned && row.status === 'aguardando_assinatura') {
    await env.ACEITES_DB.prepare(`UPDATE contas_contratacoes SET status='assinado', signed_at=?, updated_at=? WHERE id=?`).bind(now, now, row.id).run();
  } else if (ev.type === 'signature.rejected' && ev.signatureId === row.client_signature_id && row.status === 'aguardando_assinatura') {
    await env.ACEITES_DB.prepare(`UPDATE contas_contratacoes SET status='assinatura_recusada', updated_at=? WHERE id=?`).bind(now, row.id).run();
  }
  return json({ ok: true });
}
export function onRequestGet() { return json({ error: 'Método não permitido.' }, 405); }
