import { ENGINE_VERSION, generateQueries, normalizeMark } from '../_lib/marcas-analysis.js';
import { verifyBriefingToken } from '../_lib/marcas-auth.js';
import { analysisBusinessDayConfig, nextBusinessDay } from '../_lib/business-days.js';
import { JsonBodyError, readBoundedJson } from '../_lib/bounded-json.js';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
const allowedPresentation = new Set(['nominativa', 'mista', 'figurativa', 'indefinida']);
const allowedScope = new Set(['local', 'regional', 'brasil', 'internet']);
const allowedOwner = new Set(['pessoa_fisica', 'pessoa_juridica', 'indefinido']);
const MAX_REQUEST_BYTES = 64 * 1024;

class InputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function textField(body, name, maximumLength, required = false) {
  const raw = body[name];
  if (raw == null || raw === '') {
    if (required) throw new InputError('Revise os campos obrigatórios.');
    return null;
  }
  if (typeof raw !== 'string') throw new InputError('Revise os campos obrigatórios.');
  const value = raw.trim();
  if (!value) {
    if (required) throw new InputError('Revise os campos obrigatórios.');
    return null;
  }
  if (value.length > maximumLength) throw new InputError('Um ou mais campos excedem o tamanho permitido.');
  return value;
}

function optionalBoolean(body, name) {
  if (body[name] == null) return false;
  if (typeof body[name] !== 'boolean') throw new InputError('Revise os campos obrigatórios.');
  return body[name];
}

function validCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function requestBody(request) {
  try {
    return await readBoundedJson(request, MAX_REQUEST_BYTES);
  } catch (error) {
    if (!(error instanceof JsonBodyError)) throw error;
    throw new InputError(
      error.code === 'BODY_TOO_LARGE'
        ? 'O briefing excede o tamanho permitido.'
        : 'O briefing enviado é inválido.',
      error.status
    );
  }
}

function validLogoUrl(value) {
  if (!value || value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:';
  } catch { return false; }
}

async function authorized(context) {
  if (!context.env.ACEITES_DB || !context.env.BRIEFING_SIGNING_SECRET) return { error: json({ error: 'Serviço ainda não configurado.' }, 503) };
  const token = context.request.headers.get('x-briefing-token');
  const claim = await verifyBriefingToken(token, context.env.BRIEFING_SIGNING_SECRET);
  if (!claim) return { error: json({ error: 'Link inválido ou expirado.' }, 401) };
  const aceite = await context.env.ACEITES_DB.prepare(`SELECT id, nome, marca, payment_status, briefing_status FROM aceites WHERE id = ? LIMIT 1`).bind(claim.id).first();
  if (!aceite) return { error: json({ error: 'Contratação não encontrada.' }, 404) };
  if (aceite.payment_status !== 'PAID') return { error: json({ error: 'O briefing será liberado após a confirmação do pagamento.' }, 409) };
  return { aceite };
}

export async function onRequestGet(context) {
  try {
    const auth = await authorized(context); if (auth.error) return auth.error;
    if (auth.aceite.briefing_status === 'concluido') {
      return json({ ok: true, case: { briefing_status: 'concluido' } });
    }
    const briefing = await context.env.ACEITES_DB.prepare(`SELECT exact_mark FROM marca_briefings WHERE aceite_id = ? LIMIT 1`).bind(auth.aceite.id).first();
    return json({
      ok: true,
      case: {
        nome: auth.aceite.nome,
        marca: auth.aceite.marca,
        briefing_status: auth.aceite.briefing_status
      },
      briefing: briefing?.exact_mark ? { exact_mark: briefing.exact_mark } : null
    });
  } catch (error) { console.error('briefing_get_error', error); return json({ error: 'Não foi possível carregar o briefing.' }, 500); }
}

export async function onRequestPost(context) {
  try {
    const auth = await authorized(context); if (auth.error) return auth.error;
    if (auth.aceite.briefing_status === 'concluido') return json({ error: 'Este briefing já foi concluído. Solicite ao advogado qualquer correção necessária.' }, 409);
    const body = await requestBody(context.request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Revise os campos obrigatórios.' }, 400);
    const exactMark = textField(body, 'exact_mark', 180, true);
    const current = textField(body, 'current_goods_services', 4000, true);
    if (!exactMark || !current || !allowedPresentation.has(body.presentation_type) || !allowedScope.has(body.market_scope) || !allowedOwner.has(body.intended_owner_type)) return json({ error: 'Revise os campos obrigatórios.' }, 400);
    if (body.information_confirmed !== true || body.temporal_search_ack !== true || body.data_use_authorized !== true) return json({ error: 'As três declarações são necessárias.' }, 400);
    const pronunciation = textField(body, 'pronunciation', 240);
    const planned = textField(body, 'planned_goods_services', 4000);
    const intendedOwnerDocument = textField(body, 'intended_owner_document', 32);
    const companyMainActivity = textField(body, 'company_main_activity', 500);
    const websiteSocials = textField(body, 'website_socials', 2000);
    const knownConflicts = textField(body, 'known_conflicts', 4000);
    const logoUrl = textField(body, 'logo_url', 2048);
    const firstUseDate = textField(body, 'first_use_date', 10);
    if (firstUseDate && !validCalendarDate(firstUseDate)) return json({ error: 'Informe uma data válida para o início do uso.' }, 400);
    const markConfirmed = optionalBoolean(body, 'mark_confirmed');
    const inUse = optionalBoolean(body, 'in_use');
    const companyExists = optionalBoolean(body, 'company_exists');
    const logoRequired = ['mista', 'figurativa'].includes(body.presentation_type);
    if (logoUrl && !validLogoUrl(logoUrl)) return json({ error: 'Informe um link válido para o logotipo.' }, 400);
    if (logoRequired && !logoUrl) return json({ error: 'Envie o link do logotipo para concluir o briefing e permitir a conferência do material.' }, 400);
    const now = new Date().toISOString(), briefingId = crypto.randomUUID(), planId = crypto.randomUUID();
    const startsAutomatically = body.presentation_type === 'nominativa';
    const analysisStatus = startsAutomatically
      ? 'pesquisando'
      : body.presentation_type === 'indefinida'
        ? 'aguardando_definicao'
        : 'aguardando_material';
    // Para marcas com elemento visual, o prazo só nasce depois que o advogado
    // conferir o arquivo. Uma apresentação ainda indefinida também não inicia SLA.
    const analysisDueAt = startsAutomatically
      ? nextBusinessDay(now, analysisBusinessDayConfig(context.env))
      : null;
    const queries = generateQueries(exactMark);
    const results = await context.env.ACEITES_DB.batch([
      context.env.ACEITES_DB.prepare(`INSERT INTO marca_briefings (id, aceite_id, created_at, updated_at, completed_at, status, mark_confirmed, exact_mark, pronunciation, presentation_type, in_use, first_use_date, current_goods_services, planned_goods_services, market_scope, intended_owner_type, intended_owner_document, company_exists, company_main_activity, website_socials, known_conflicts, logo_url, information_confirmed, temporal_search_ack, data_use_authorized) VALUES (?, ?, ?, ?, ?, 'concluido', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1) ON CONFLICT(aceite_id) DO NOTHING`).bind(briefingId, auth.aceite.id, now, now, now, markConfirmed ? 1 : 0, exactMark, pronunciation, body.presentation_type, inUse ? 1 : 0, firstUseDate, current, planned, body.market_scope, body.intended_owner_type, intendedOwnerDocument, companyExists ? 1 : 0, companyMainActivity, websiteSocials, knownConflicts, logoUrl),
      context.env.ACEITES_DB.prepare(`INSERT INTO marca_search_plans (id, aceite_id, created_at, updated_at, engine_version, normalized_mark, queries_json, needs_vienna, status) SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'gerado' WHERE EXISTS (SELECT 1 FROM marca_briefings WHERE id = ? AND aceite_id = ?) ON CONFLICT(aceite_id) DO UPDATE SET updated_at=excluded.updated_at, engine_version=excluded.engine_version, normalized_mark=excluded.normalized_mark, queries_json=excluded.queries_json, needs_vienna=excluded.needs_vienna, status='gerado'`).bind(planId, auth.aceite.id, now, now, ENGINE_VERSION, normalizeMark(exactMark), JSON.stringify(queries), logoRequired ? 1 : 0, briefingId, auth.aceite.id),
      context.env.ACEITES_DB.prepare(`UPDATE aceites SET marca=?, briefing_status='concluido', briefing_completed_at=?, analysis_status=?, analysis_due_at=? WHERE id=? AND EXISTS (SELECT 1 FROM marca_briefings WHERE id = ? AND aceite_id = ?)`).bind(exactMark, now, analysisStatus, analysisDueAt, auth.aceite.id, briefingId, auth.aceite.id)
    ]);
    if (Number(results[0]?.meta?.changes || 0) !== 1) return json({ error: 'Este briefing já foi concluído. Solicite ao advogado qualquer correção necessária.' }, 409);
    if (Number(results[2]?.meta?.changes || 0) !== 1) throw new Error('briefing_state_update_failed');
    const message = analysisStatus === 'aguardando_material'
      ? 'Briefing recebido. O prazo começará após a conferência do logotipo pelo advogado.'
      : analysisStatus === 'aguardando_definicao'
        ? 'Briefing recebido. A forma de apresentação precisa ser definida antes do início da análise.'
        : 'Briefing recebido. A análise seguirá para revisão jurídica.';
    return json({ ok: true, queries, analysis_status: analysisStatus, analysis_due_at: analysisDueAt, message }, 201);
  } catch (error) {
    if (error instanceof InputError) return json({ error: error.message }, error.status);
    console.error('briefing_post_error', error);
    return json({ error: 'Não foi possível salvar o briefing.' }, 500);
  }
}

