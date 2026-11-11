// POST /api/lead-origin — origem do lead nas páginas /whatsapp-banido/ e /whatsapp-business-banido/.
// Recebe o beacon do clique no WhatsApp e grava {ref, identificador do clique, campanha} no D1.
// Não grava telefone, nome nem texto da conversa. O vínculo com o contato é feito pelo código
// "(Ref. XXXXX)" que segue na mensagem do WhatsApp e fica registrado pelo Worker de atendimento.
const PAGES = new Set(['whatsapp-banido', 'whatsapp-business-banido']);
const SOURCES = new Set(['hero', 'header', 'sticky', 'float', 'footer', 'cta-final', 'faca-ja', 'quem-pf', 'quem-pj']);
const ORIGINS = new Set(['https://rumosadv.com.br', 'https://www.rumosadv.com.br']);
const ID = /^[A-Za-z0-9_\-.~]{10,200}$/;
const TEXT = /^[\p{L}\p{N} _\-.+{}]{1,120}$/u;

const reply = (status, body) => new Response(body ? JSON.stringify(body) : null, {
  status,
  headers: { 'cache-control': 'no-store', ...(body ? { 'content-type': 'application/json; charset=utf-8' } : {}) }
});
const clean = (value, re) => {
  const v = typeof value === 'string' ? value.trim() : '';
  return v && re.test(v) ? v : null;
};

export function parseLeadOrigin(raw) {
  let body;
  try { body = JSON.parse(String(raw).slice(0, 4000)); } catch { return null; }
  if (!body || typeof body !== 'object') return null;
  const ref = typeof body.lead_ref === 'string' ? body.lead_ref.trim().toUpperCase() : '';
  if (!/^[CWB][A-Z0-9]{3,9}$/.test(ref)) return null;
  if (!PAGES.has(body.page)) return null;
  const source = typeof body.source === 'string' && SOURCES.has(body.source) ? body.source : null;
  return {
    ref, page: body.page, source,
    gclid: clean(body.gclid, ID), gbraid: clean(body.gbraid, ID), wbraid: clean(body.wbraid, ID), fbclid: clean(body.fbclid, ID),
    utm_source: clean(body.utm_source, TEXT), utm_campaign: clean(body.utm_campaign, TEXT), utm_term: clean(body.utm_term, TEXT)
  };
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('origin');
  // LEAD_ORIGIN_DEV só existe em teste local (wrangler pages dev); em produção fica vazio.
  if (origin && !ORIGINS.has(origin) && origin !== env.LEAD_ORIGIN_DEV) return reply(403, { error: 'origin' });
  if (!env.ACEITES_DB) return reply(503, { error: 'db' });
  const lead = parseLeadOrigin(await request.text());
  if (!lead) return reply(400, { error: 'invalid' });
  const now = new Date().toISOString();
  try {
    // Primeiro clique define a origem; cliques seguintes só completam o que faltava.
    await env.ACEITES_DB.prepare(`
      INSERT INTO lead_origins (ref, created_at, last_seen_at, page, source, gclid, gbraid, wbraid, fbclid, utm_source, utm_campaign, utm_term)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(ref) DO UPDATE SET
        last_seen_at = excluded.last_seen_at,
        clicks = lead_origins.clicks + 1,
        gclid = COALESCE(lead_origins.gclid, excluded.gclid),
        gbraid = COALESCE(lead_origins.gbraid, excluded.gbraid),
        wbraid = COALESCE(lead_origins.wbraid, excluded.wbraid),
        fbclid = COALESCE(lead_origins.fbclid, excluded.fbclid),
        utm_source = COALESCE(lead_origins.utm_source, excluded.utm_source),
        utm_campaign = COALESCE(lead_origins.utm_campaign, excluded.utm_campaign),
        utm_term = COALESCE(lead_origins.utm_term, excluded.utm_term)
    `).bind(lead.ref, now, now, lead.page, lead.source, lead.gclid, lead.gbraid, lead.wbraid, lead.fbclid,
      lead.utm_source, lead.utm_campaign, lead.utm_term).run();
    return reply(204);
  } catch (error) {
    console.error('lead_origin_error', error && error.message);
    return reply(500, { error: 'store' });
  }
}

export function onRequestGet() { return reply(405, { error: 'method' }); }
