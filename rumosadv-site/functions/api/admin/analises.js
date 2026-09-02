import { buildConversionRecord, buildDeliveryRecord, buildOperationalMessages, buildReportDraft, scoreResult } from '../../_lib/marcas-analysis.js';
import { createBriefingToken, isAdmin } from '../../_lib/marcas-auth.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const riskLevels = new Set(['favoravel', 'favoravel_com_ressalvas', 'risco_elevado', 'desaconselhado']);

function requireAdmin(context) {
  if (!context.env.ACEITES_DB || !context.env.ANALYSIS_ADMIN_TOKEN || !context.env.BRIEFING_SIGNING_SECRET) return json({ error: 'Administração ainda não configurada.' }, 503);
  if (!isAdmin(context.request, context.env.ANALYSIS_ADMIN_TOKEN)) return json({ error: 'Não autorizado.' }, 401);
  return null;
}

export async function onRequestGet(context) {
  try {
    const denied = requireAdmin(context); if (denied) return denied;
    const id = new URL(context.request.url).searchParams.get('id');
    if (!id) {
      const list = await context.env.ACEITES_DB.prepare(`SELECT id, created_at, nome, email, whatsapp, marca, payment_status, paid_at, briefing_status, analysis_status, analysis_due_at, risk_level, delivered_at FROM aceites WHERE payment_status='PAID' ORDER BY paid_at DESC LIMIT 100`).all();
      return json({ ok: true, cases: list.results || [] });
    }
    const [aceite, briefing, plan, results, review] = await Promise.all([
      context.env.ACEITES_DB.prepare(`SELECT * FROM aceites WHERE id=? LIMIT 1`).bind(id).first(),
      context.env.ACEITES_DB.prepare(`SELECT * FROM marca_briefings WHERE aceite_id=? LIMIT 1`).bind(id).first(),
      context.env.ACEITES_DB.prepare(`SELECT * FROM marca_search_plans WHERE aceite_id=? LIMIT 1`).bind(id).first(),
      context.env.ACEITES_DB.prepare(`SELECT * FROM marca_search_results WHERE aceite_id=? ORDER BY relevance_score DESC, imported_at DESC`).bind(id).all(),
      context.env.ACEITES_DB.prepare(`SELECT * FROM marca_reviews WHERE aceite_id=? LIMIT 1`).bind(id).first()
    ]);
    if (!aceite) return json({ error: 'Caso não encontrado.' }, 404);
    return json({ ok: true, aceite, briefing, plan: plan ? { ...plan, queries: JSON.parse(plan.queries_json || '[]'), suggested_classes: JSON.parse(plan.suggested_classes_json || '[]'), related_classes: JSON.parse(plan.related_classes_json || '[]') } : null, results: results.results || [], review, messages: buildOperationalMessages({ client: aceite.nome, mark: aceite.marca }) });
  } catch (error) { console.error('analysis_admin_get_error', error); return json({ error: 'Não foi possível carregar os casos.' }, 500); }
}

export async function onRequestPost(context) {
  try {
    const denied = requireAdmin(context); if (denied) return denied;
    const body = await context.request.json(), action = String(body.action || ''), id = String(body.aceite_id || '');
    if (!id) return json({ error: 'Caso não informado.' }, 400);
    const aceite = await context.env.ACEITES_DB.prepare(`SELECT id, marca, nome, payment_status, delivered_at, credit_expires_at, registration_converted_at, report_file FROM aceites WHERE id=? LIMIT 1`).bind(id).first();
    if (!aceite) return json({ error: 'Caso não encontrado.' }, 404);

    if (action === 'create_briefing_link') {
      if (aceite.payment_status !== 'PAID') return json({ error: 'O pagamento ainda não foi confirmado.' }, 409);
      const token = await createBriefingToken(id, context.env.BRIEFING_SIGNING_SECRET);
      const origin = new URL(context.request.url).origin;
      return json({ ok: true, url: `${origin}/marcas/briefing/?token=${encodeURIComponent(token)}`, expires_in_days: 7 });
    }

    if (action === 'update_plan') {
      const principal = Array.isArray(body.suggested_classes) ? body.suggested_classes : [];
      const related = Array.isArray(body.related_classes) ? body.related_classes : [];
      await context.env.ACEITES_DB.prepare(`UPDATE marca_search_plans SET updated_at=?, suggested_classes_json=?, related_classes_json=?, lawyer_notes=?, status='revisado' WHERE aceite_id=?`).bind(new Date().toISOString(), JSON.stringify(principal), JSON.stringify(related), body.lawyer_notes || null, id).run();
      return json({ ok: true });
    }

    if (action === 'import_results') {
      if (!Array.isArray(body.results) || !body.results.length || body.results.length > 250) return json({ error: 'Envie entre 1 e 250 resultados.' }, 400);
      if (body.results.some(item => !String(item?.mark_name || '').trim())) return json({ error: 'Todo resultado precisa informar mark_name.' }, 400);
      const cutoff = String(body.cutoff_at || new Date().toISOString()), imported = new Date().toISOString();
      const statements = body.results.map(item => {
        const score = scoreResult(aceite.marca, item.mark_name, item.class_affinity);
        return context.env.ACEITES_DB.prepare(`INSERT INTO marca_search_results (id, aceite_id, imported_at, source, cutoff_at, query_term, query_type, process_number, mark_name, owner_name, filing_date, status, presentation, nice_classes, specification, source_url, text_similarity, phonetic_similarity, class_affinity, relevance_score, relevance_level, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), id, imported, item.source || 'INPI', cutoff, item.query_term || null, item.query_type || null, item.process_number || null, String(item.mark_name || '').trim(), item.owner_name || null, item.filing_date || null, item.status || null, item.presentation || null, item.nice_classes || null, item.specification || null, item.source_url || null, score.text_similarity, score.phonetic_similarity, score.class_affinity, score.relevance_score, score.relevance_level, JSON.stringify(item));
      });
      await context.env.ACEITES_DB.batch(statements);
      return json({ ok: true, imported: statements.length });
    }

    if (action === 'save_review') {
      if (!riskLevels.has(body.risk_level)) return json({ error: 'Faixa de conclusão inválida.' }, 400);
      const results = await context.env.ACEITES_DB.prepare(`SELECT * FROM marca_search_results WHERE aceite_id=? ORDER BY relevance_score DESC`).bind(id).all();
      const report = buildReportDraft({ aceite_id: id, client: aceite.nome, mark: aceite.marca, cutoff_at: body.cutoff_at || null }, results.results || [], body);
      const now = new Date().toISOString();
      await context.env.ACEITES_DB.batch([
        context.env.ACEITES_DB.prepare(`INSERT INTO marca_reviews (id, aceite_id, created_at, updated_at, cutoff_at, risk_level, executive_summary, recommendation, caveats, report_json, approved, reviewed_by, reviewed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(aceite_id) DO UPDATE SET updated_at=excluded.updated_at, cutoff_at=excluded.cutoff_at, risk_level=excluded.risk_level, executive_summary=excluded.executive_summary, recommendation=excluded.recommendation, caveats=excluded.caveats, report_json=excluded.report_json, approved=excluded.approved, reviewed_by=excluded.reviewed_by, reviewed_at=excluded.reviewed_at`).bind(crypto.randomUUID(), id, now, now, body.cutoff_at || null, body.risk_level, body.executive_summary || '', body.recommendation || '', body.caveats || '', JSON.stringify(report), body.approved ? 1 : 0, body.reviewed_by || null, body.approved ? now : null),
        context.env.ACEITES_DB.prepare(`UPDATE aceites SET risk_level=?, analysis_status=? WHERE id=?`).bind(body.risk_level, body.approved ? 'em_revisao' : 'pesquisando', id)
      ]);
      return json({ ok: true, report });
    }
    if (action === 'mark_delivered') {
      if (aceite.delivered_at) return json({ ok: true, ...buildDeliveryRecord(aceite) });
      const review = await context.env.ACEITES_DB.prepare(`SELECT approved FROM marca_reviews WHERE aceite_id=? LIMIT 1`).bind(id).first();
      if (!review?.approved) return json({ error: 'A minuta precisa ser revisada e aprovada antes da entrega.' }, 409);
      let delivery;
      try { delivery = buildDeliveryRecord(aceite, body.report_file); }
      catch (error) { return json({ error: error.message }, 400); }
      await context.env.ACEITES_DB.prepare(`UPDATE aceites SET analysis_status='entregue', delivered_at=?, credit_expires_at=?, report_file=? WHERE id=?`).bind(delivery.delivered_at, delivery.credit_expires_at, delivery.report_file, id).run();
      return json({ ok: true, ...delivery });
    }
    if (action === 'mark_converted') {
      let conversion;
      try { conversion = buildConversionRecord(aceite); }
      catch (error) { return json({ error: error.message }, 409); }
      if (!conversion.already_converted) {
        await context.env.ACEITES_DB.prepare(`UPDATE aceites SET registration_converted_at=? WHERE id=?`).bind(conversion.registration_converted_at, id).run();
      }
      return json({ ok: true, ...conversion });
    }
    return json({ error: 'Ação inválida.' }, 400);
  } catch (error) { console.error('analysis_admin_post_error', error); return json({ error: 'Não foi possível executar a ação.' }, 500); }
}
