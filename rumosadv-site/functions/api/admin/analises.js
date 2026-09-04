import { buildConversionRecord, buildDeliveryRecord, buildOperationalMessages, buildReportDraft, scoreResult } from '../../_lib/marcas-analysis.js';
import { createBriefingToken, isAdmin } from '../../_lib/marcas-auth.js';
import { analysisBusinessDayConfig, nextBusinessDay } from '../../_lib/business-days.js';
import { JsonBodyError, readBoundedJson } from '../../_lib/bounded-json.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const riskLevels = new Set(['favoravel', 'favoravel_com_ressalvas', 'risco_elevado', 'desaconselhado']);
const visualPresentations = new Set(['mista', 'figurativa']);
const STALE_CREATING_MINUTES = 65;
const MAX_ADMIN_REQUEST_BYTES = 1024 * 1024;
const CUTOFF_FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

class AdminInputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

async function requestBody(request) {
  try {
    return await readBoundedJson(request, MAX_ADMIN_REQUEST_BYTES);
  } catch (error) {
    if (!(error instanceof JsonBodyError)) throw error;
    throw new AdminInputError(
      error.code === 'BODY_TOO_LARGE'
        ? 'A operação excede o tamanho permitido.'
        : 'A operação enviada é inválida.',
      error.status
    );
  }
}

function boundedText(value, maximumLength, label, required = false) {
  if (value == null || value === '') {
    if (required) throw new AdminInputError(`Informe ${label}.`);
    return null;
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new AdminInputError(`Revise ${label}.`);
  }
  const text = String(value).trim();
  if (!text) {
    if (required) throw new AdminInputError(`Informe ${label}.`);
    return null;
  }
  if (text.length > maximumLength || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    throw new AdminInputError(`${label} excede o tamanho permitido.`);
  }
  return text;
}

function boundedStringList(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 50) {
    throw new AdminInputError(`Revise ${label}.`);
  }
  return [...new Set(value.map(item => boundedText(item, 240, label, true)))];
}

function validDateTime(value) {
  if (!value || value.length > 40) return false;
  return !Number.isNaN(new Date(value).getTime());
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function parsedArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeQueryList(value) {
  if (!Array.isArray(value) || !value.length || value.length > 50) {
    throw new AdminInputError('Revise a cobertura das consultas realizadas.');
  }
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new AdminInputError('Revise a cobertura das consultas realizadas.');
    }
    return {
      type: boundedText(item.type, 80, 'o tipo da consulta', true),
      value: boundedText(item.value, 240, 'o termo consultado', true)
    };
  });
}

function sameQueries(left, right) {
  if (left.length !== right.length) return false;
  return left.every((query, index) => query.type === right[index]?.type
    && query.value === right[index]?.value);
}

function normalizeImportResult(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    throw new AdminInputError('Revise os resultados importados.');
  }
  const affinity = item.class_affinity == null ? 0 : Number(item.class_affinity);
  if (!Number.isFinite(affinity) || affinity < 0 || affinity > 1) {
    throw new AdminInputError('class_affinity precisa estar entre 0 e 1.');
  }
  return {
    source: boundedText(item.source, 80, 'a fonte') || 'INPI',
    query_term: boundedText(item.query_term, 240, 'o termo consultado'),
    query_type: boundedText(item.query_type, 80, 'o tipo de consulta'),
    process_number: boundedText(item.process_number, 80, 'o número do processo'),
    mark_name: boundedText(item.mark_name, 240, 'o nome da marca', true),
    owner_name: boundedText(item.owner_name, 500, 'o titular'),
    filing_date: boundedText(item.filing_date, 40, 'a data do depósito'),
    status: boundedText(item.status, 240, 'a situação do processo'),
    presentation: boundedText(item.presentation, 80, 'a apresentação'),
    nice_classes: boundedText(item.nice_classes, 500, 'as classes de Nice'),
    specification: boundedText(item.specification, 4000, 'a especificação'),
    source_url: boundedText(item.source_url, 2048, 'o link da fonte'),
    class_affinity: affinity
  };
}

async function stableImportId(aceiteId, item) {
  const canonical = JSON.stringify([aceiteId, item.source, item.query_term,
    item.query_type, item.process_number, item.mark_name, item.owner_name,
    item.filing_date, item.status, item.presentation, item.nice_classes,
    item.specification, item.source_url, item.class_affinity]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return `result:${[...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function normalPaymentState(aceite) {
  return aceite.payment_status === 'PAID'
    && String(aceite.status || '').trim().toLowerCase() === 'pago';
}

function validLogoUrl(value) {
  if (!value || String(value).length > 2048) return false;
  try {
    const parsed = new URL(String(value));
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

async function loadOperationalAlerts(db) {
  try {
    const [webhooks, attempts, payments] = await Promise.all([
      db.prepare(`SELECT id, event, checkout_id, received_at, quarantine_reason,
        aceite_id, attempt_id, processed_at
        FROM asaas_webhook_events
        WHERE processing_status = 'QUARANTINED'
        ORDER BY received_at DESC LIMIT 50`).all(),
      db.prepare(`SELECT id, aceite_id, checkout_id, state, is_current, created_at,
        updated_at, failure_reason
        FROM asaas_checkout_attempts
        WHERE state = 'REQUIRES_REVIEW'
          OR (is_current = 1 AND state = 'CREATING'
            AND julianday(updated_at) <= julianday('now', '-' || ? || ' minutes'))
        ORDER BY updated_at ASC LIMIT 50`).bind(STALE_CREATING_MINUTES).all(),
      db.prepare(`SELECT id, created_at, payment_status, paid_at, status
        FROM aceites
        WHERE UPPER(COALESCE(payment_status, '')) = 'REQUIRES_REVIEW'
          OR LOWER(COALESCE(status, '')) LIKE '%revisao%'
          OR (UPPER(COALESCE(payment_status, '')) = 'PAID' AND paid_at IS NULL)
          OR (paid_at IS NOT NULL AND UPPER(COALESCE(payment_status, '')) <> 'PAID')
        ORDER BY created_at DESC LIMIT 50`).all()
    ]);

    const webhookItems = rows(webhooks).map(item => ({
      category: 'webhook_quarantined',
      severity: 'high',
      id: item.id,
      event: item.event || null,
      checkout_id: item.checkout_id || null,
      aceite_id: item.aceite_id || null,
      attempt_id: item.attempt_id || null,
      occurred_at: item.received_at || null,
      reason: item.quarantine_reason || 'REVIEW_REQUIRED'
    }));
    const attemptItems = rows(attempts).map(item => ({
      category: item.state === 'CREATING' ? 'checkout_stale_creating' : 'checkout_requires_review',
      severity: 'high',
      id: item.id,
      aceite_id: item.aceite_id || null,
      checkout_id: item.checkout_id || null,
      state: item.state,
      is_current: Number(item.is_current) === 1,
      occurred_at: item.updated_at || item.created_at || null,
      reason: item.failure_reason || (item.state === 'CREATING' ? 'CREATING_OVER_65_MINUTES' : 'REVIEW_REQUIRED')
    }));
    const paymentItems = rows(payments).map(item => ({
      category: 'payment_requires_review',
      severity: 'high',
      id: item.id,
      aceite_id: item.id,
      payment_status: item.payment_status || null,
      case_status: item.status || null,
      paid_at: item.paid_at || null,
      occurred_at: item.paid_at || item.created_at || null,
      reason: String(item.status || '').toLowerCase().includes('revisao')
        ? 'CASE_MARKED_FOR_REVIEW'
        : 'PAYMENT_STATE_INCONSISTENT'
    }));
    const items = [...webhookItems, ...attemptItems, ...paymentItems];
    return {
      total: items.length,
      stale_creating_after_minutes: STALE_CREATING_MINUTES,
      monitoring_error: false,
      items
    };
  } catch (error) {
    console.error(JSON.stringify({
      event: 'analysis_operational_alerts_error',
      error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)
    }));
    return {
      total: 1,
      stale_creating_after_minutes: STALE_CREATING_MINUTES,
      monitoring_error: true,
      items: [{
        category: 'monitoring_unavailable',
        severity: 'high',
        reason: 'CHECK_FINANCIAL_MONITORING_CONFIGURATION'
      }]
    };
  }
}

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
      const [list, alerts] = await Promise.all([
        context.env.ACEITES_DB.prepare(`SELECT id, created_at, nome, marca, payment_status, paid_at, briefing_status, briefing_completed_at, analysis_status, analysis_due_at, risk_level, report_file, delivered_at, credit_expires_at, registration_converted_at FROM aceites WHERE payment_status='PAID' ORDER BY paid_at DESC LIMIT 100`).all(),
        loadOperationalAlerts(context.env.ACEITES_DB)
      ]);
      return json({ ok: true, cases: list.results || [], alerts });
    }
    const [aceite, briefing, plan, results, review, operationalEvents] = await Promise.all([
      context.env.ACEITES_DB.prepare(`SELECT * FROM aceites WHERE id=? LIMIT 1`).bind(id).first(),
      context.env.ACEITES_DB.prepare(`SELECT * FROM marca_briefings WHERE aceite_id=? LIMIT 1`).bind(id).first(),
      context.env.ACEITES_DB.prepare(`SELECT * FROM marca_search_plans WHERE aceite_id=? LIMIT 1`).bind(id).first(),
      context.env.ACEITES_DB.prepare(`SELECT * FROM marca_search_results WHERE aceite_id=? ORDER BY relevance_score DESC, imported_at DESC`).bind(id).all(),
      context.env.ACEITES_DB.prepare(`SELECT * FROM marca_reviews WHERE aceite_id=? LIMIT 1`).bind(id).first(),
      context.env.ACEITES_DB.prepare(`SELECT id, event_type, created_at, previous_analysis_status, new_analysis_status, previous_presentation_type, new_presentation_type, analysis_due_at FROM marca_operational_events WHERE aceite_id=? ORDER BY created_at DESC LIMIT 50`).bind(id).all()
    ]);
    if (!aceite) return json({ error: 'Caso não encontrado.' }, 404);
    return json({ ok: true, aceite, briefing, plan: plan ? { ...plan, queries: JSON.parse(plan.queries_json || '[]'), suggested_classes: JSON.parse(plan.suggested_classes_json || '[]'), related_classes: JSON.parse(plan.related_classes_json || '[]') } : null, results: results.results || [], review, operational_events: operationalEvents.results || [], messages: buildOperationalMessages({ client: aceite.nome, mark: aceite.marca, risk_level: review?.risk_level || aceite.risk_level, credit_expires_at: aceite.credit_expires_at }) });
  } catch (error) { console.error('analysis_admin_get_error', error); return json({ error: 'Não foi possível carregar os casos.' }, 500); }
}

export async function onRequestPost(context) {
  try {
    const denied = requireAdmin(context); if (denied) return denied;
    const body = await requestBody(context.request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new AdminInputError('A operação enviada é inválida.');
    }
    const action = boundedText(body.action, 80, 'a ação', true);
    const id = boundedText(body.aceite_id, 128, 'o caso', true);
    const aceite = await context.env.ACEITES_DB.prepare(`SELECT id, marca, nome, status, payment_status, briefing_status, analysis_status, analysis_due_at, delivered_at, credit_expires_at, registration_converted_at, report_file, delivered_report_sha256, delivered_review_updated_at FROM aceites WHERE id=? LIMIT 1`).bind(id).first();
    if (!aceite) return json({ error: 'Caso não encontrado.' }, 404);

    if (action === 'create_briefing_link') {
      if (aceite.payment_status !== 'PAID') return json({ error: 'O pagamento ainda não foi confirmado.' }, 409);
      const token = await createBriefingToken(id, context.env.BRIEFING_SIGNING_SECRET);
      const origin = new URL(context.request.url).origin;
      return json({ ok: true, url: `${origin}/marcas/briefing/#token=${encodeURIComponent(token)}`, expires_in_days: 7 });
    }

    if (action === 'confirm_material') {
      if (aceite.payment_status !== 'PAID') return json({ error: 'O pagamento ainda não foi confirmado.' }, 409);
      if (aceite.briefing_status !== 'concluido') return json({ error: 'O briefing precisa estar concluído antes da conferência do material.' }, 409);
      const briefing = await context.env.ACEITES_DB.prepare(`SELECT status, presentation_type, logo_url FROM marca_briefings WHERE aceite_id=? LIMIT 1`).bind(id).first();
      if (!briefing || briefing.status !== 'concluido') return json({ error: 'O briefing precisa estar concluído antes da conferência do material.' }, 409);
      if (!visualPresentations.has(briefing.presentation_type)) {
        const message = briefing.presentation_type === 'indefinida'
          ? 'Defina primeiro se a apresentação será nominativa, mista ou figurativa.'
          : 'A conferência manual de material só se aplica a marcas mistas ou figurativas.';
        return json({ error: message }, 409);
      }
      if (!validLogoUrl(briefing.logo_url)) return json({ error: 'O briefing não contém um link válido para o logotipo.' }, 409);

      if (aceite.analysis_due_at) {
        return json({
          ok: true,
          already_confirmed: true,
          analysis_status: aceite.analysis_status,
          analysis_due_at: aceite.analysis_due_at
        });
      }
      if (aceite.analysis_status !== 'aguardando_material') {
        return json({ error: 'O estado atual do caso precisa de revisão antes de iniciar o prazo.' }, 409);
      }

      const now = new Date().toISOString();
      const analysisDueAt = nextBusinessDay(now, analysisBusinessDayConfig(context.env));
      const eventId = crypto.randomUUID();
      const claim = `confirming-material:${eventId}`;
      const results = await context.env.ACEITES_DB.batch([
        context.env.ACEITES_DB.prepare(`UPDATE aceites
        SET analysis_status='confirmando_material', analysis_due_at=?
        WHERE id=? AND payment_status='PAID' AND briefing_status='concluido'
          AND analysis_status='aguardando_material' AND analysis_due_at IS NULL
          AND EXISTS (
            SELECT 1 FROM marca_briefings
            WHERE aceite_id=? AND status='concluido'
              AND presentation_type IN ('mista','figurativa') AND logo_url=?
          )`).bind(claim, id, id, briefing.logo_url),
        context.env.ACEITES_DB.prepare(`INSERT INTO marca_operational_events (
          id, aceite_id, event_type, created_at, previous_analysis_status,
          new_analysis_status, previous_presentation_type,
          new_presentation_type, analysis_due_at, details_json
        ) SELECT ?, ?, 'MATERIAL_CONFIRMED', ?, 'aguardando_material',
          'pesquisando', presentation_type, presentation_type, ?, '{"source":"admin_panel"}'
          FROM marca_briefings
          WHERE aceite_id=? AND status='concluido'
            AND presentation_type IN ('mista','figurativa') AND logo_url=?
            AND EXISTS (SELECT 1 FROM aceites WHERE id=?
              AND analysis_status='confirmando_material' AND analysis_due_at=?)`).bind(
          eventId, id, now, analysisDueAt, id, briefing.logo_url, id, claim
        ),
        context.env.ACEITES_DB.prepare(`UPDATE aceites
          SET analysis_status='pesquisando', analysis_due_at=?
          WHERE id=? AND analysis_status='confirmando_material'
            AND analysis_due_at=?
            AND EXISTS (SELECT 1 FROM marca_operational_events WHERE id=?)`).bind(
          analysisDueAt, id, claim, eventId
        )
      ]);
      if (Number(results[0]?.meta?.changes || 0) === 1 && Number(results[2]?.meta?.changes || 0) === 1) {
        return json({ ok: true, already_confirmed: false, analysis_status: 'pesquisando', analysis_due_at: analysisDueAt });
      }
      const current = await context.env.ACEITES_DB.prepare(`SELECT analysis_status, analysis_due_at FROM aceites WHERE id=? LIMIT 1`).bind(id).first();
      if (current?.analysis_due_at) {
        return json({ ok: true, already_confirmed: true, analysis_status: current.analysis_status, analysis_due_at: current.analysis_due_at });
      }
      return json({ error: 'Não foi possível confirmar o material porque o caso mudou. Recarregue o painel.' }, 409);
    }

    if (action === 'resolve_presentation') {
      if (aceite.payment_status !== 'PAID') return json({ error: 'O pagamento ainda não foi confirmado.' }, 409);
      if (aceite.briefing_status !== 'concluido') return json({ error: 'O briefing precisa estar concluído antes de definir a apresentação.' }, 409);
      const presentationType = String(body.presentation_type || '').trim();
      if (!new Set(['nominativa', 'mista', 'figurativa']).has(presentationType)) {
        return json({ error: 'Escolha apresentação nominativa, mista ou figurativa.' }, 400);
      }
      const briefing = await context.env.ACEITES_DB.prepare(`SELECT status, presentation_type, logo_url FROM marca_briefings WHERE aceite_id=? LIMIT 1`).bind(id).first();
      if (!briefing || briefing.status !== 'concluido') return json({ error: 'O briefing precisa estar concluído antes de definir a apresentação.' }, 409);

      const suppliedLogo = body.logo_url == null ? '' : String(body.logo_url).trim();
      const logoUrl = suppliedLogo || String(briefing.logo_url || '').trim() || null;
      if (visualPresentations.has(presentationType) && !validLogoUrl(logoUrl)) {
        return json({ error: 'Informe um link válido para o logotipo antes de escolher apresentação mista ou figurativa.' }, 400);
      }
      if (briefing.presentation_type !== 'indefinida') {
        const alreadyResolved = briefing.presentation_type === presentationType
          && (presentationType === 'nominativa'
            ? Boolean(aceite.analysis_due_at)
            : aceite.analysis_status === 'aguardando_material' && !aceite.analysis_due_at);
        if (alreadyResolved) {
          return json({
            ok: true,
            already_resolved: true,
            presentation_type: briefing.presentation_type,
            analysis_status: aceite.analysis_status,
            analysis_due_at: aceite.analysis_due_at || null
          });
        }
        return json({ error: 'A apresentação já foi definida e não pode ser substituída por esta ação.' }, 409);
      }
      if (aceite.analysis_status !== 'aguardando_definicao' || aceite.analysis_due_at) {
        return json({ error: 'O estado atual do caso precisa de revisão antes de definir a apresentação.' }, 409);
      }

      const now = new Date().toISOString();
      const startsAutomatically = presentationType === 'nominativa';
      const nextStatus = startsAutomatically ? 'pesquisando' : 'aguardando_material';
      const analysisDueAt = startsAutomatically
        ? nextBusinessDay(now, analysisBusinessDayConfig(context.env))
        : null;
      const eventId = crypto.randomUUID();
      const claim = `resolving-presentation:${eventId}`;
      const results = await context.env.ACEITES_DB.batch([
        context.env.ACEITES_DB.prepare(`UPDATE aceites
          SET analysis_status='resolvendo_apresentacao', analysis_due_at=?
          WHERE id=? AND payment_status='PAID' AND briefing_status='concluido'
            AND analysis_status='aguardando_definicao' AND analysis_due_at IS NULL
            AND EXISTS (SELECT 1 FROM marca_briefings WHERE aceite_id=?
              AND status='concluido' AND presentation_type='indefinida')`).bind(claim, id, id),
        context.env.ACEITES_DB.prepare(`UPDATE marca_briefings
          SET presentation_type=?, logo_url=?, updated_at=?
          WHERE aceite_id=? AND status='concluido' AND presentation_type='indefinida'
            AND EXISTS (SELECT 1 FROM aceites WHERE id=?
              AND analysis_status='resolvendo_apresentacao' AND analysis_due_at=?)`).bind(
          presentationType, startsAutomatically ? null : logoUrl, now, id, id, claim
        ),
        context.env.ACEITES_DB.prepare(`UPDATE marca_search_plans
          SET needs_vienna=?, updated_at=?
          WHERE aceite_id=? AND EXISTS (SELECT 1 FROM aceites WHERE id=?
            AND analysis_status='resolvendo_apresentacao' AND analysis_due_at=?)`).bind(
          startsAutomatically ? 0 : 1, now, id, id, claim
        ),
        context.env.ACEITES_DB.prepare(`INSERT INTO marca_operational_events (
          id, aceite_id, event_type, created_at, previous_analysis_status,
          new_analysis_status, previous_presentation_type,
          new_presentation_type, analysis_due_at, details_json
        ) SELECT ?, ?, 'PRESENTATION_RESOLVED', ?, 'aguardando_definicao',
          ?, 'indefinida', ?, ?, '{"source":"admin_panel"}'
          WHERE EXISTS (SELECT 1 FROM aceites WHERE id=?
            AND analysis_status='resolvendo_apresentacao' AND analysis_due_at=?)
            AND EXISTS (SELECT 1 FROM marca_briefings WHERE aceite_id=?
              AND status='concluido' AND presentation_type=?)`).bind(
          eventId, id, now, nextStatus, presentationType, analysisDueAt,
          id, claim, id, presentationType
        ),
        context.env.ACEITES_DB.prepare(`UPDATE aceites
          SET analysis_status=?, analysis_due_at=?
          WHERE id=? AND analysis_status='resolvendo_apresentacao'
            AND analysis_due_at=?
            AND EXISTS (SELECT 1 FROM marca_operational_events WHERE id=?)`).bind(
          nextStatus, analysisDueAt, id, claim, eventId
        )
      ]);
      if (Number(results[0]?.meta?.changes || 0) === 1 && Number(results[4]?.meta?.changes || 0) === 1) {
        return json({
          ok: true,
          already_resolved: false,
          presentation_type: presentationType,
          analysis_status: nextStatus,
          analysis_due_at: analysisDueAt
        });
      }
      const [current, currentBriefing] = await Promise.all([
        context.env.ACEITES_DB.prepare(`SELECT analysis_status, analysis_due_at FROM aceites WHERE id=? LIMIT 1`).bind(id).first(),
        context.env.ACEITES_DB.prepare(`SELECT presentation_type FROM marca_briefings WHERE aceite_id=? LIMIT 1`).bind(id).first()
      ]);
      if (currentBriefing?.presentation_type === presentationType
        && ((presentationType === 'nominativa' && current?.analysis_due_at)
          || (visualPresentations.has(presentationType) && current?.analysis_status === 'aguardando_material'))) {
        return json({ ok: true, already_resolved: true, presentation_type: presentationType, analysis_status: current.analysis_status, analysis_due_at: current.analysis_due_at || null });
      }
      return json({ error: 'Não foi possível definir a apresentação porque o caso mudou. Recarregue o painel.' }, 409);
    }

    if (action === 'update_plan') {
      if (aceite.delivered_at) return json({ error: 'O plano não pode ser alterado depois da entrega.' }, 409);
      if (!normalPaymentState(aceite) || aceite.briefing_status !== 'concluido'
        || !aceite.analysis_due_at || aceite.analysis_status !== 'pesquisando') {
        return json({ error: 'O caso ainda não está liberado para revisar o plano de pesquisa.' }, 409);
      }
      const principal = boundedStringList(body.suggested_classes, 'as classes principais');
      const related = boundedStringList(body.related_classes, 'as classes relacionadas');
      const lawyerNotes = boundedText(body.lawyer_notes, 4000, 'as observações jurídicas');
      const [existingPlan, countRow] = await Promise.all([
        context.env.ACEITES_DB.prepare(`SELECT updated_at FROM marca_search_plans WHERE aceite_id=? LIMIT 1`).bind(id).first(),
        context.env.ACEITES_DB.prepare(`SELECT COUNT(*) AS count FROM marca_search_results WHERE aceite_id=?`).bind(id).first()
      ]);
      if (!existingPlan) return json({ error: 'O plano de pesquisa não foi encontrado.' }, 409);
      const existingResults = Number(countRow?.count || 0);
      const discardResults = body.discard_results === true;
      if (existingResults > 0 && !discardResults) {
        return json({
          error: 'Salvar o plano invalidará os resultados já importados. Confirme o descarte para continuar.',
          confirmation_required: true,
          existing_results: existingResults
        }, 409);
      }
      let updatedAt = new Date().toISOString();
      if (updatedAt === existingPlan.updated_at) {
        updatedAt = new Date(new Date(updatedAt).getTime() + 1).toISOString();
      }
      const writes = await context.env.ACEITES_DB.batch([
        context.env.ACEITES_DB.prepare(`UPDATE marca_search_plans
        SET updated_at=?, suggested_classes_json=?, related_classes_json=?, lawyer_notes=?,
          status='revisado', search_completed_at=NULL, search_cutoff_at=NULL,
          search_completed_by=NULL, search_coverage_json=NULL
        WHERE aceite_id=? AND updated_at=?
          AND (?=1 OR NOT EXISTS (SELECT 1 FROM marca_search_results WHERE aceite_id=?))
          AND EXISTS (SELECT 1 FROM aceites WHERE id=?
          AND payment_status='PAID' AND LOWER(COALESCE(status,''))='pago'
          AND briefing_status='concluido' AND analysis_due_at IS NOT NULL
          AND analysis_status='pesquisando' AND delivered_at IS NULL)`)
          .bind(updatedAt, JSON.stringify(principal), JSON.stringify(related), lawyerNotes,
            id, existingPlan.updated_at, discardResults ? 1 : 0, id, id),
        context.env.ACEITES_DB.prepare(`DELETE FROM marca_search_results
          WHERE aceite_id=? AND EXISTS (SELECT 1 FROM marca_search_plans
            WHERE aceite_id=? AND updated_at=? AND status='revisado'
              AND search_completed_at IS NULL AND search_coverage_json IS NULL)`)
          .bind(id, id, updatedAt)
      ]);
      if (Number(writes[0]?.meta?.changes || 0) !== 1) {
        return json({ error: 'Não foi possível salvar o plano porque o caso mudou. Recarregue o painel.' }, 409);
      }
      return json({ ok: true, discarded_results: Number(writes[1]?.meta?.changes || 0) });
    }

    if (action === 'import_results') {
      if (aceite.delivered_at) return json({ error: 'Os resultados não podem ser alterados depois da entrega.' }, 409);
      if (!normalPaymentState(aceite) || aceite.briefing_status !== 'concluido'
        || !aceite.analysis_due_at || aceite.analysis_status !== 'pesquisando') {
        return json({ error: 'O caso ainda não está liberado para importar resultados.' }, 409);
      }
      if (!Array.isArray(body.results) || !body.results.length || body.results.length > 250) return json({ error: 'Envie entre 1 e 250 resultados.' }, 400);
      const plan = await context.env.ACEITES_DB.prepare(`SELECT status FROM marca_search_plans WHERE aceite_id=? LIMIT 1`).bind(id).first();
      if (plan?.status !== 'revisado') return json({ error: 'Revise e salve o plano de pesquisa antes de importar resultados.' }, 409);
      const normalizedResults = body.results.map(normalizeImportResult);
      const cutoff = boundedText(body.cutoff_at, 40, 'a data de corte') || new Date().toISOString();
      if (!validDateTime(cutoff)) return json({ error: 'Informe uma data de corte válida.' }, 400);
      const imported = new Date().toISOString();
      const resultIds = await Promise.all(normalizedResults.map(item => stableImportId(id, item)));
      const statements = normalizedResults.map((item, index) => {
        const score = scoreResult(aceite.marca, item.mark_name, item.class_affinity);
        return context.env.ACEITES_DB.prepare(`INSERT OR IGNORE INTO marca_search_results (id, aceite_id, imported_at, source, cutoff_at, query_term, query_type, process_number, mark_name, owner_name, filing_date, status, presentation, nice_classes, specification, source_url, text_similarity, phonetic_similarity, class_affinity, relevance_score, relevance_level, raw_json)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM marca_search_plans
            WHERE aceite_id=? AND status='revisado')
            AND EXISTS (SELECT 1 FROM aceites WHERE id=?
              AND payment_status='PAID' AND LOWER(COALESCE(status,''))='pago'
              AND briefing_status='concluido' AND analysis_due_at IS NOT NULL
              AND analysis_status='pesquisando' AND delivered_at IS NULL)`)
          .bind(resultIds[index], id, imported, item.source, cutoff, item.query_term,
            item.query_type, item.process_number, item.mark_name, item.owner_name,
            item.filing_date, item.status, item.presentation, item.nice_classes,
            item.specification, item.source_url, score.text_similarity,
            score.phonetic_similarity, score.class_affinity, score.relevance_score,
            score.relevance_level, JSON.stringify(item), id, id);
      });
      const results = await context.env.ACEITES_DB.batch(statements);
      const importedCount = results.reduce((total, result) => total + Number(result?.meta?.changes || 0), 0);
      return json({ ok: true, imported: importedCount, ignored: statements.length - importedCount });
    }

    if (action === 'complete_search') {
      if (aceite.delivered_at) return json({ error: 'A pesquisa não pode ser alterada depois da entrega.' }, 409);
      if (!normalPaymentState(aceite) || aceite.briefing_status !== 'concluido'
        || !aceite.analysis_due_at || aceite.analysis_status !== 'pesquisando') {
        return json({ error: 'O caso ainda não está liberado para concluir a pesquisa.' }, 409);
      }
      if (body.scope_confirmed !== true) {
        return json({ error: 'Confirme que todas as consultas do plano foram executadas.' }, 400);
      }
      const completedBy = boundedText(body.completed_by, 240, 'o responsável pela pesquisa', true);
      const requestedCutoff = boundedText(body.cutoff_at, 40, 'a data de corte', true);
      if (!validDateTime(requestedCutoff)) return json({ error: 'Informe uma data de corte válida.' }, 400);
      const cutoffDate = new Date(requestedCutoff);
      if (cutoffDate.getTime() > Date.now() + CUTOFF_FUTURE_TOLERANCE_MS) {
        return json({ error: 'A data de corte não pode estar no futuro.' }, 400);
      }
      const cutoffAt = cutoffDate.toISOString();
      const completedQueries = normalizeQueryList(body.completed_queries);
      const plan = await context.env.ACEITES_DB.prepare(`SELECT status, queries_json,
        search_completed_at, search_cutoff_at, search_completed_by, search_coverage_json
        FROM marca_search_plans WHERE aceite_id=? LIMIT 1`).bind(id).first();
      if (!plan) return json({ error: 'O plano de pesquisa não foi encontrado.' }, 409);
      const plannedQueries = normalizeQueryList(parsedArray(plan.queries_json));
      if (!sameQueries(plannedQueries, completedQueries)) {
        return json({ error: 'A cobertura informada não corresponde ao plano atual. Recarregue o painel.' }, 409);
      }
      if (plan.status === 'pesquisa_concluida') {
        return json({
          ok: true,
          already_completed: true,
          search_completed_at: plan.search_completed_at,
          search_cutoff_at: plan.search_cutoff_at,
          search_completed_by: plan.search_completed_by
        });
      }
      if (plan.status !== 'revisado') {
        return json({ error: 'Revise e salve o plano antes de concluir a pesquisa.' }, 409);
      }
      const countRow = await context.env.ACEITES_DB.prepare(`SELECT COUNT(*) AS count
        FROM marca_search_results WHERE aceite_id=?`).bind(id).first();
      const resultCount = Number(countRow?.count || 0);
      const completedAt = new Date().toISOString();
      const coverage = {
        source: 'INPI',
        queries: plannedQueries,
        result_count: resultCount,
        no_results_found: resultCount === 0
      };
      const result = await context.env.ACEITES_DB.prepare(`UPDATE marca_search_plans
        SET status='pesquisa_concluida', updated_at=?, search_completed_at=?,
          search_cutoff_at=?, search_completed_by=?, search_coverage_json=?
        WHERE aceite_id=? AND status='revisado' AND queries_json=?
          AND (SELECT COUNT(*) FROM marca_search_results WHERE aceite_id=?)=?
          AND EXISTS (SELECT 1 FROM aceites WHERE id=?
            AND payment_status='PAID' AND LOWER(COALESCE(status,''))='pago'
            AND briefing_status='concluido' AND analysis_due_at IS NOT NULL
            AND analysis_status='pesquisando' AND delivered_at IS NULL)`)
        .bind(completedAt, completedAt, cutoffAt, completedBy,
          JSON.stringify(coverage), id, plan.queries_json, id, resultCount, id).run();
      if (Number(result?.meta?.changes || 0) !== 1) {
        return json({ error: 'Não foi possível concluir a pesquisa porque o caso mudou. Recarregue o painel.' }, 409);
      }
      return json({
        ok: true,
        already_completed: false,
        search_completed_at: completedAt,
        search_cutoff_at: cutoffAt,
        search_completed_by: completedBy,
        result_count: resultCount
      });
    }

    if (action === 'save_review') {
      if (aceite.delivered_at) return json({ error: 'A revisão não pode ser alterada depois da entrega.' }, 409);
      if (!normalPaymentState(aceite) || aceite.briefing_status !== 'concluido'
        || !aceite.analysis_due_at || !['pesquisando', 'em_revisao'].includes(aceite.analysis_status)) {
        return json({ error: 'O caso ainda não está liberado para revisão jurídica.' }, 409);
      }
      const riskLevel = boundedText(body.risk_level, 40, 'a faixa de conclusão', true);
      if (!riskLevels.has(riskLevel)) return json({ error: 'Faixa de conclusão inválida.' }, 400);
      if (typeof body.approved !== 'boolean') return json({ error: 'Informe se a minuta foi aprovada.' }, 400);
      const approved = body.approved;
      const cutoffAt = boundedText(body.cutoff_at, 40, 'a data de corte');
      const executiveSummary = boundedText(body.executive_summary, 6000, 'o resumo executivo');
      const recommendation = boundedText(body.recommendation, 6000, 'a recomendação');
      const caveats = boundedText(body.caveats, 6000, 'as ressalvas');
      const reviewedBy = boundedText(body.reviewed_by, 240, 'o advogado revisor');
      const [results, briefing, plan] = await Promise.all([
        context.env.ACEITES_DB.prepare(`SELECT * FROM marca_search_results WHERE aceite_id=? ORDER BY relevance_score DESC`).bind(id).all(),
        context.env.ACEITES_DB.prepare(`SELECT status, presentation_type, current_goods_services, planned_goods_services, market_scope, intended_owner_type, in_use, first_use_date FROM marca_briefings WHERE aceite_id=? LIMIT 1`).bind(id).first(),
        context.env.ACEITES_DB.prepare(`SELECT status, queries_json, suggested_classes_json,
          related_classes_json, lawyer_notes, search_completed_at, search_cutoff_at,
          search_completed_by, search_coverage_json
          FROM marca_search_plans WHERE aceite_id=? LIMIT 1`).bind(id).first()
      ]);
      const queries = parsedArray(plan?.queries_json);
      const suggestedClasses = parsedArray(plan?.suggested_classes_json);
      const relatedClasses = parsedArray(plan?.related_classes_json);
      if (!briefing || briefing.status !== 'concluido' || !plan) {
        return json({ error: 'O briefing e o plano de pesquisa precisam estar íntegros antes da revisão.' }, 409);
      }
      if (approved && (plan.status !== 'pesquisa_concluida' || !plan.search_completed_at
        || !validDateTime(plan.search_cutoff_at) || !plan.search_completed_by
        || !queries.length || !suggestedClasses.length)) {
        return json({ error: 'Conclua a pesquisa, revise as consultas e ao menos uma classe principal antes de aprovar.' }, 409);
      }
      let coverage = null;
      if (approved) {
        coverage = (() => {
          try { return JSON.parse(plan.search_coverage_json || 'null'); }
          catch { return null; }
        })();
        const coveredQueries = coverage && normalizeQueryList(coverage.queries);
        if (!coverage || coverage.source !== 'INPI'
          || !sameQueries(queries, coveredQueries)
          || Number(coverage.result_count) !== (results.results || []).length
          || Boolean(coverage.no_results_found) !== ((results.results || []).length === 0)) {
          return json({ error: 'A evidência de cobertura da pesquisa está inconsistente. Refaça a confirmação.' }, 409);
        }
      }
      if (approved && (!executiveSummary || !recommendation || !reviewedBy)) {
        return json({ error: 'Preencha resumo, recomendação e advogado revisor antes de aprovar.' }, 400);
      }
      const report = buildReportDraft({
        aceite_id: id,
        client: aceite.nome,
        mark: aceite.marca,
        cutoff_at: approved ? plan.search_cutoff_at : cutoffAt,
        ...(briefing || {}),
        queries,
        suggested_classes: suggestedClasses,
        related_classes: relatedClasses,
        lawyer_notes: plan?.lawyer_notes || ''
      }, results.results || [], {
        risk_level: riskLevel,
        executive_summary: executiveSummary || '',
        recommendation: recommendation || '',
        caveats: caveats || ''
      });
      const reportJson = JSON.stringify(report);
      const reportSha256 = await sha256Hex(reportJson);
      const now = new Date().toISOString();
      const writes = await context.env.ACEITES_DB.batch([
        context.env.ACEITES_DB.prepare(`INSERT INTO marca_reviews (id, aceite_id, created_at, updated_at, cutoff_at, risk_level, executive_summary, recommendation, caveats, report_json, report_sha256, approved, reviewed_by, reviewed_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM aceites WHERE id=?
            AND payment_status='PAID' AND LOWER(COALESCE(status,''))='pago'
            AND briefing_status='concluido' AND analysis_due_at IS NOT NULL
            AND analysis_status IN ('pesquisando','em_revisao') AND delivered_at IS NULL)
            AND (?=0 OR EXISTS (SELECT 1 FROM marca_search_plans AS plan
              WHERE plan.aceite_id=? AND plan.status='pesquisa_concluida'
                AND plan.search_completed_at=? AND plan.search_cutoff_at=?
                AND plan.search_completed_by=? AND plan.search_coverage_json=?))
          ON CONFLICT(aceite_id) DO UPDATE SET updated_at=excluded.updated_at,
            cutoff_at=excluded.cutoff_at, risk_level=excluded.risk_level,
            executive_summary=excluded.executive_summary,
            recommendation=excluded.recommendation, caveats=excluded.caveats,
            report_json=excluded.report_json, report_sha256=excluded.report_sha256,
            approved=excluded.approved,
            reviewed_by=excluded.reviewed_by, reviewed_at=excluded.reviewed_at
          WHERE EXISTS (SELECT 1 FROM aceites WHERE id=excluded.aceite_id
            AND payment_status='PAID' AND LOWER(COALESCE(status,''))='pago'
            AND briefing_status='concluido' AND analysis_due_at IS NOT NULL
            AND analysis_status IN ('pesquisando','em_revisao') AND delivered_at IS NULL)
            AND (?=0 OR EXISTS (SELECT 1 FROM marca_search_plans AS plan
              WHERE plan.aceite_id=excluded.aceite_id AND plan.status='pesquisa_concluida'
                AND plan.search_completed_at=? AND plan.search_cutoff_at=?
                AND plan.search_completed_by=? AND plan.search_coverage_json=?))`)
          .bind(crypto.randomUUID(), id, now, now, approved ? plan.search_cutoff_at : cutoffAt, riskLevel,
            executiveSummary || '', recommendation || '', caveats || '', reportJson,
            reportSha256, approved ? 1 : 0, reviewedBy, approved ? now : null, id,
            approved ? 1 : 0, id, plan.search_completed_at,
            plan.search_cutoff_at, plan.search_completed_by, plan.search_coverage_json,
            approved ? 1 : 0, plan.search_completed_at,
            plan.search_cutoff_at, plan.search_completed_by, plan.search_coverage_json),
        context.env.ACEITES_DB.prepare(`UPDATE aceites SET risk_level=?, analysis_status=?
          WHERE id=? AND payment_status='PAID' AND LOWER(COALESCE(status,''))='pago'
            AND briefing_status='concluido' AND analysis_due_at IS NOT NULL
            AND analysis_status IN ('pesquisando','em_revisao') AND delivered_at IS NULL
            AND EXISTS (SELECT 1 FROM marca_reviews WHERE aceite_id=? AND updated_at=?)
            AND (?=0 OR EXISTS (SELECT 1 FROM marca_search_plans AS plan
              WHERE plan.aceite_id=? AND plan.status='pesquisa_concluida'
                AND plan.search_completed_at=? AND plan.search_cutoff_at=?
                AND plan.search_completed_by=? AND plan.search_coverage_json=?))`)
          .bind(riskLevel, approved ? 'em_revisao' : 'pesquisando', id, id, now,
            approved ? 1 : 0, id, plan.search_completed_at,
            plan.search_cutoff_at, plan.search_completed_by, plan.search_coverage_json)
      ]);
      if (Number(writes[0]?.meta?.changes || 0) !== 1 || Number(writes[1]?.meta?.changes || 0) !== 1) {
        return json({ error: 'Não foi possível salvar a revisão porque o caso mudou. Recarregue o painel.' }, 409);
      }
      return json({ ok: true, report, report_sha256: reportSha256, review_updated_at: now });
    }
    if (action === 'mark_delivered') {
      if (aceite.delivered_at) return json({
        ok: true,
        ...buildDeliveryRecord(aceite),
        report_sha256: aceite.delivered_report_sha256 || null,
        review_updated_at: aceite.delivered_review_updated_at || null
      });
      if (!normalPaymentState(aceite) || aceite.briefing_status !== 'concluido'
        || !aceite.analysis_due_at || aceite.analysis_status !== 'em_revisao') {
        return json({ error: 'O caso ainda não está liberado para entrega.' }, 409);
      }
      const review = await context.env.ACEITES_DB.prepare(`SELECT approved, cutoff_at, executive_summary,
        recommendation, reviewed_by, updated_at, report_json, report_sha256
        FROM marca_reviews WHERE aceite_id=? LIMIT 1`).bind(id).first();
      if (!review?.approved || !review.cutoff_at || !String(review.executive_summary || '').trim()
        || !String(review.recommendation || '').trim() || !String(review.reviewed_by || '').trim()) {
        return json({ error: 'A minuta precisa estar completa, revisada e aprovada antes da entrega.' }, 409);
      }
      const expectedHash = boundedText(body.report_sha256, 64, 'o hash do relatório', true)?.toLowerCase();
      const expectedReviewUpdatedAt = boundedText(body.review_updated_at, 40, 'a versão da revisão', true);
      if (!/^[0-9a-f]{64}$/.test(expectedHash || '') || !validDateTime(expectedReviewUpdatedAt)) {
        return json({ error: 'Abra novamente o relatório aprovado antes de registrar a entrega.' }, 400);
      }
      const computedHash = await sha256Hex(review.report_json || '');
      const storedHash = String(review.report_sha256 || '').trim().toLowerCase();
      if (!storedHash || storedHash !== computedHash) {
        return json({ error: 'A revisão ainda não possui uma versão íntegra. Salve-a novamente antes da entrega.' }, 409);
      }
      if (expectedHash !== storedHash || expectedReviewUpdatedAt !== review.updated_at) {
        return json({ error: 'A minuta mudou depois que o relatório foi aberto. Abra a versão atual antes de registrar a entrega.' }, 409);
      }
      let delivery;
      try { delivery = buildDeliveryRecord(aceite, body.report_file); }
      catch (error) { return json({ error: error.message }, 400); }
      const result = await context.env.ACEITES_DB.prepare(`UPDATE aceites
        SET analysis_status='entregue', delivered_at=?, credit_expires_at=?, report_file=?,
          delivered_report_sha256=?, delivered_review_updated_at=?
        WHERE id=? AND delivered_at IS NULL AND payment_status='PAID'
          AND LOWER(COALESCE(status,''))='pago' AND briefing_status='concluido'
          AND analysis_due_at IS NOT NULL AND analysis_status='em_revisao'
          AND EXISTS (SELECT 1 FROM marca_reviews AS review
            JOIN marca_search_plans AS plan ON plan.aceite_id=review.aceite_id
            WHERE review.aceite_id=? AND review.approved=1
              AND review.updated_at=? AND review.report_sha256=? AND review.report_json=?
              AND review.cutoff_at=plan.search_cutoff_at
              AND review.cutoff_at IS NOT NULL
              AND TRIM(COALESCE(review.executive_summary,''))<>''
              AND TRIM(COALESCE(review.recommendation,''))<>''
              AND TRIM(COALESCE(review.reviewed_by,''))<>''
              AND plan.status='pesquisa_concluida'
              AND plan.search_completed_at IS NOT NULL
              AND plan.search_coverage_json IS NOT NULL)`)
        .bind(delivery.delivered_at, delivery.credit_expires_at, delivery.report_file,
          storedHash, review.updated_at, id, id, review.updated_at, storedHash, review.report_json).run();
      if (Number(result?.meta?.changes || 0) === 1) return json({
        ok: true, ...delivery, report_sha256: storedHash, review_updated_at: review.updated_at
      });
      const current = await context.env.ACEITES_DB.prepare(`SELECT delivered_at, credit_expires_at,
        report_file, delivered_report_sha256, delivered_review_updated_at
        FROM aceites WHERE id=? LIMIT 1`).bind(id).first();
      if (current?.delivered_at) return json({
        ok: true,
        ...buildDeliveryRecord(current),
        report_sha256: current.delivered_report_sha256 || null,
        review_updated_at: current.delivered_review_updated_at || null
      });
      return json({ error: 'Não foi possível registrar a entrega porque o caso mudou. Recarregue o painel.' }, 409);
    }
    if (action === 'mark_converted') {
      let conversion;
      try { conversion = buildConversionRecord(aceite); }
      catch (error) { return json({ error: error.message }, 409); }
      if (!conversion.already_converted) {
        const result = await context.env.ACEITES_DB.prepare(`UPDATE aceites SET registration_converted_at=? WHERE id=? AND delivered_at IS NOT NULL AND registration_converted_at IS NULL`).bind(conversion.registration_converted_at, id).run();
        if (Number(result?.meta?.changes || 0) === 1) return json({ ok: true, ...conversion });
        const current = await context.env.ACEITES_DB.prepare(`SELECT delivered_at, registration_converted_at FROM aceites WHERE id=? LIMIT 1`).bind(id).first();
        try { return json({ ok: true, ...buildConversionRecord(current || {}) }); }
        catch (error) { return json({ error: error.message }, 409); }
      }
      return json({ ok: true, ...conversion });
    }
    return json({ error: 'Ação inválida.' }, 400);
  } catch (error) {
    if (error instanceof AdminInputError) return json({ error: error.message }, error.status);
    console.error('analysis_admin_post_error', error);
    return json({ error: 'Não foi possível executar a ação.' }, 500);
  }
}
