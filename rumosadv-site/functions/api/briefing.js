import { ENGINE_VERSION, generateQueries, normalizeMark } from '../_lib/marcas-analysis.js';
import { verifyBriefingToken } from '../_lib/marcas-auth.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const allowedPresentation = new Set(['nominativa', 'mista', 'figurativa', 'indefinida']);
const allowedScope = new Set(['local', 'regional', 'brasil', 'internet']);
const allowedOwner = new Set(['pessoa_fisica', 'pessoa_juridica', 'indefinido']);

function nextBusinessDay(iso) {
  const date = new Date(iso);
  do date.setUTCDate(date.getUTCDate() + 1); while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
  return date.toISOString();
}

async function authorized(context) {
  if (!context.env.ACEITES_DB || !context.env.BRIEFING_SIGNING_SECRET) return { error: json({ error: 'Serviço ainda não configurado.' }, 503) };
  const url = new URL(context.request.url);
  const token = url.searchParams.get('token') || context.request.headers.get('x-briefing-token');
  const claim = await verifyBriefingToken(token, context.env.BRIEFING_SIGNING_SECRET);
  if (!claim) return { error: json({ error: 'Link inválido ou expirado.' }, 401) };
  const aceite = await context.env.ACEITES_DB.prepare(`SELECT id, nome, email, marca, payment_status, briefing_status FROM aceites WHERE id = ? LIMIT 1`).bind(claim.id).first();
  if (!aceite) return { error: json({ error: 'Contratação não encontrada.' }, 404) };
  if (aceite.payment_status !== 'PAID') return { error: json({ error: 'O briefing será liberado após a confirmação do pagamento.' }, 409) };
  return { aceite };
}

export async function onRequestGet(context) {
  try {
    const auth = await authorized(context); if (auth.error) return auth.error;
    const briefing = await context.env.ACEITES_DB.prepare(`SELECT * FROM marca_briefings WHERE aceite_id = ? LIMIT 1`).bind(auth.aceite.id).first();
    return json({ ok: true, case: auth.aceite, briefing });
  } catch (error) { console.error('briefing_get_error', error); return json({ error: 'Não foi possível carregar o briefing.' }, 500); }
}

export async function onRequestPost(context) {
  try {
    const auth = await authorized(context); if (auth.error) return auth.error;
    const body = await context.request.json();
    const exactMark = String(body.exact_mark || '').trim();
    const current = String(body.current_goods_services || '').trim();
    if (!exactMark || !current || !allowedPresentation.has(body.presentation_type) || !allowedScope.has(body.market_scope) || !allowedOwner.has(body.intended_owner_type)) return json({ error: 'Revise os campos obrigatórios.' }, 400);
    if (body.information_confirmed !== true || body.temporal_search_ack !== true || body.data_use_authorized !== true) return json({ error: 'As três declarações são necessárias.' }, 400);
    const now = new Date().toISOString(), briefingId = crypto.randomUUID(), planId = crypto.randomUUID();
    const queries = generateQueries(exactMark);
    await context.env.ACEITES_DB.batch([
      context.env.ACEITES_DB.prepare(`INSERT INTO marca_briefings (id, aceite_id, created_at, updated_at, completed_at, status, mark_confirmed, exact_mark, pronunciation, presentation_type, in_use, first_use_date, current_goods_services, planned_goods_services, market_scope, intended_owner_type, intended_owner_document, company_exists, company_main_activity, website_socials, known_conflicts, logo_url, information_confirmed, temporal_search_ack, data_use_authorized) VALUES (?, ?, ?, ?, ?, 'concluido', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1) ON CONFLICT(aceite_id) DO UPDATE SET updated_at=excluded.updated_at, completed_at=excluded.completed_at, status='concluido', mark_confirmed=excluded.mark_confirmed, exact_mark=excluded.exact_mark, pronunciation=excluded.pronunciation, presentation_type=excluded.presentation_type, in_use=excluded.in_use, first_use_date=excluded.first_use_date, current_goods_services=excluded.current_goods_services, planned_goods_services=excluded.planned_goods_services, market_scope=excluded.market_scope, intended_owner_type=excluded.intended_owner_type, intended_owner_document=excluded.intended_owner_document, company_exists=excluded.company_exists, company_main_activity=excluded.company_main_activity, website_socials=excluded.website_socials, known_conflicts=excluded.known_conflicts, logo_url=excluded.logo_url, information_confirmed=1, temporal_search_ack=1, data_use_authorized=1`).bind(briefingId, auth.aceite.id, now, now, now, body.mark_confirmed ? 1 : 0, exactMark, body.pronunciation || null, body.presentation_type, body.in_use ? 1 : 0, body.first_use_date || null, current, body.planned_goods_services || null, body.market_scope, body.intended_owner_type, body.intended_owner_document || null, body.company_exists ? 1 : 0, body.company_main_activity || null, body.website_socials || null, body.known_conflicts || null, body.logo_url || null),
      context.env.ACEITES_DB.prepare(`INSERT INTO marca_search_plans (id, aceite_id, created_at, updated_at, engine_version, normalized_mark, queries_json, needs_vienna, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'gerado') ON CONFLICT(aceite_id) DO UPDATE SET updated_at=excluded.updated_at, engine_version=excluded.engine_version, normalized_mark=excluded.normalized_mark, queries_json=excluded.queries_json, needs_vienna=excluded.needs_vienna, status='gerado'`).bind(planId, auth.aceite.id, now, now, ENGINE_VERSION, normalizeMark(exactMark), JSON.stringify(queries), ['mista','figurativa'].includes(body.presentation_type) ? 1 : 0),
      context.env.ACEITES_DB.prepare(`UPDATE aceites SET marca=?, briefing_status='concluido', briefing_completed_at=?, analysis_status='pesquisando', analysis_due_at=? WHERE id=?`).bind(exactMark, now, nextBusinessDay(now), auth.aceite.id)
    ]);
    return json({ ok: true, queries, message: 'Briefing recebido. A análise seguirá para revisão jurídica.' }, 201);
  } catch (error) { console.error('briefing_post_error', error); return json({ error: 'Não foi possível salvar o briefing.' }, 500); }
}

