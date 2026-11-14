// Painel do advogado: pedidos de retorno deixados pelo formulário das páginas de WhatsApp banido.
import { isAdmin } from '../../../_lib/marcas-auth.js';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
function guard({ request, env }) {
  if (!env.ACEITES_DB || !env.ANALYSIS_ADMIN_TOKEN) return json({ error: 'Painel indisponível.' }, 503);
  if (!isAdmin(request, env.ANALYSIS_ADMIN_TOKEN)) return json({ error: 'Não autorizado.' }, 401);
  return null;
}
export async function onRequestGet(context) {
  const denied = guard(context); if (denied) return denied;
  const rows = await context.env.ACEITES_DB.prepare(`SELECT c.id, c.created_at, c.ref, c.page, c.nome, c.telefone, c.email, c.preferencia, c.numero_banido, c.relato, c.status, c.atendido_at,
    CASE WHEN o.gclid IS NOT NULL OR o.gbraid IS NOT NULL OR o.wbraid IS NOT NULL THEN 1 ELSE 0 END AS de_anuncio
    FROM contas_contatos c LEFT JOIN lead_origins o ON o.ref = c.ref ORDER BY (c.status='novo') DESC, c.created_at DESC LIMIT 200`).all();
  const list = rows.results || [];
  return json({ ok: true, novos: list.filter(r => r.status === 'novo').length, contatos: list });
}
export async function onRequestPatch(context) {
  const denied = guard(context); if (denied) return denied;
  const body = await context.request.json().catch(() => ({}));
  const status = body.acao === 'atender' ? 'atendido' : body.acao === 'reabrir' ? 'novo' : null;
  if (!status) return json({ error: 'Ação inválida.' }, 400);
  const r = await context.env.ACEITES_DB.prepare(`UPDATE contas_contatos SET status=?, atendido_at=? WHERE id=?`).bind(status, status === 'atendido' ? new Date().toISOString() : null, String(body.id || '')).run();
  if (!r.meta.changes) return json({ error: 'Contato não encontrado.' }, 404);
  return json({ ok: true });
}
