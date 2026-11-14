// POST /api/contas/contato — formulário das páginas /whatsapp-banido/ e /whatsapp-business-banido/,
// para quem não consegue abrir o WhatsApp no próprio aparelho. Grava o pedido de retorno no D1;
// o advogado vê e responde pelo painel /contas/admin/.
const PAGES = new Set(['whatsapp-banido', 'whatsapp-business-banido']);
const PREFS = new Set(['ligacao', 'whatsapp_outro', 'email']);
const ORIGINS = new Set(['https://rumosadv.com.br', 'https://www.rumosadv.com.br']);
const LIMITE_HORA = 40; // teto global por hora, contra abuso do formulário

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const txt = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, max);
const digits = (v) => String(v || '').replace(/\D/g, '');

export function parseContato(body) {
  if (!body || typeof body !== 'object') return { error: 'Dados inválidos.' };
  if (txt(body.site, 50)) return { spam: true }; // campo invisível: só robôs preenchem
  const page = PAGES.has(body.page) ? body.page : null;
  if (!page) return { error: 'Página inválida.' };
  const nome = txt(body.nome, 120);
  if (nome.length < 2) return { error: 'Informe seu nome.' };
  let tel = digits(body.telefone).replace(/^55(?=\d{10,11}$)/, '');
  if (tel.length < 10 || tel.length > 11) return { error: 'Informe um telefone com DDD.' };
  const preferencia = PREFS.has(body.preferencia) ? body.preferencia : 'ligacao';
  const email = txt(body.email, 160).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { error: 'Confira o e-mail informado.' };
  if (preferencia === 'email' && !email) return { error: 'Informe o e-mail para o retorno.' };
  const ref = typeof body.lead_ref === 'string' && /^[CWB][A-Z0-9]{3,9}$/.test(body.lead_ref.trim().toUpperCase()) ? body.lead_ref.trim().toUpperCase() : null;
  const nb = digits(body.numero_banido).replace(/^55(?=\d{10,11}$)/, '');
  return { contato: { page, ref, nome, telefone: tel, email: email || null, preferencia, numero_banido: nb.length >= 10 && nb.length <= 11 ? nb : null, relato: txt(body.relato, 800) || null } };
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get('origin');
  if (origin && !ORIGINS.has(origin) && origin !== env.LEAD_ORIGIN_DEV) return json({ error: 'Origem não permitida.' }, 403);
  if (!env.ACEITES_DB) return json({ error: 'Formulário indisponível no momento. Fale pelo WhatsApp (19) 98911-9770.' }, 503);
  let body; try { body = JSON.parse((await request.text()).slice(0, 6000)); } catch { return json({ error: 'Dados inválidos.' }, 400); }
  const out = parseContato(body);
  if (out.spam) return json({ ok: true }); // não revela o filtro
  if (out.error) return json({ error: out.error }, 400);
  const c = out.contato, now = new Date().toISOString();
  try {
    const recent = await env.ACEITES_DB.prepare(`SELECT COUNT(*) n FROM contas_contatos WHERE created_at > ?`).bind(new Date(Date.now() - 3600e3).toISOString()).first();
    if ((recent?.n || 0) >= LIMITE_HORA) return json({ error: 'Muitos envios neste momento. Tente de novo em alguns minutos ou fale pelo WhatsApp (19) 98911-9770.' }, 429);
    // Reenvio do mesmo telefone em 10 minutos atualiza o pedido em vez de duplicar.
    const dup = await env.ACEITES_DB.prepare(`SELECT id FROM contas_contatos WHERE telefone=? AND status='novo' AND created_at > ? ORDER BY created_at DESC LIMIT 1`).bind(c.telefone, new Date(Date.now() - 600e3).toISOString()).first();
    if (dup) {
      await env.ACEITES_DB.prepare(`UPDATE contas_contatos SET nome=?, email=?, preferencia=?, numero_banido=?, relato=?, ref=COALESCE(ref, ?) WHERE id=?`).bind(c.nome, c.email, c.preferencia, c.numero_banido, c.relato, c.ref, dup.id).run();
    } else {
      await env.ACEITES_DB.prepare(`INSERT INTO contas_contatos (id, created_at, ref, page, nome, telefone, email, preferencia, numero_banido, relato) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), now, c.ref, c.page, c.nome, c.telefone, c.email, c.preferencia, c.numero_banido, c.relato).run();
    }
    return json({ ok: true, ref: c.ref }, 201);
  } catch (e) {
    console.error('contas_contato_error', e?.message);
    return json({ error: 'Não foi possível registrar agora. Tente de novo ou fale pelo WhatsApp (19) 98911-9770.' }, 500);
  }
}
