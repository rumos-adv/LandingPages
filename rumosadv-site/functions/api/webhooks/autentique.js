// Webhook da Autentique: marca a contratação como assinada quando o cliente assina.
import { json, verifyHmacHex, parseAutentiqueEvent, syncSignature } from '../../_lib/contas-contratacao.js';

export async function onRequestPost(context) {
  const env = context.env;
  if (!env.ACEITES_DB || !env.AUTENTIQUE_WEBHOOK_SECRET) return json({ error: 'Webhook não configurado.' }, 503);
  const raw = await context.request.text();
  const ok = await verifyHmacHex(raw, context.request.headers.get('x-autentique-signature'), env.AUTENTIQUE_WEBHOOK_SECRET);
  if (!ok) return json({ error: 'Não autorizado.' }, 401);
  let body; try { body = JSON.parse(raw); } catch { return json({ error: 'Evento inválido.' }, 400); }
  const ev = parseAutentiqueEvent(body);
  const now = new Date().toISOString();
  // Todo evento autenticado fica registrado, inclusive os de formato inesperado, para diagnóstico.
  const ins = await env.ACEITES_DB.prepare(`INSERT OR IGNORE INTO autentique_webhook_events (id, type, document_id, received_at) VALUES (?, ?, ?, ?)`).bind(ev.eventId || crypto.randomUUID(), ev.type || 'desconhecido', ev.documentId || shapeOf(body), now).run();
  if (!ins.meta?.changes) return json({ ok: true, duplicate: true });
  if (!ev.type) return json({ ok: true, ignored: true });
  if (!ev.documentId) {
    // Formato sem identificador de documento reconhecível: o evento serve de gatilho e o estado
    // real é conferido direto na Autentique, para as contratações que aguardam assinatura.
    if (!ev.type.startsWith('signature.') && !ev.type.startsWith('document.')) return json({ ok: true, ignored: true });
    const pend = await env.ACEITES_DB.prepare(`SELECT * FROM contas_contratacoes WHERE status='aguardando_assinatura' ORDER BY created_at DESC LIMIT 10`).all();
    let synced = 0;
    for (const r of pend.results || []) { const after = await syncSignature(r, env, env.ACEITES_DB); if (after.status !== r.status) synced++; }
    return json({ ok: true, synced });
  }
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
// Só nomes de campos (nunca valores), para ajustar o leitor do evento sem guardar dados pessoais.
function shapeOf(body) {
  try { const ev = body?.event && typeof body.event === 'object' ? body.event : body; const d = ev?.data?.object && typeof ev.data.object === 'object' ? ev.data.object : ev?.data;
    return ('campos:' + Object.keys(ev || {}).join(',') + '|data:' + Object.keys(d && typeof d === 'object' ? d : {}).join(',')).slice(0, 300); } catch { return null; }
}
export function onRequestGet() { return json({ error: 'Método não permitido.' }, 405); }
