// Painel do advogado: cria a contratação (envia o contrato à Autentique) e lista o andamento.
import { isAdmin } from '../../../_lib/marcas-auth.js';
import { json, validateInput, createAutentiqueDocument, clientToken, publicBase, createSignatureLink } from '../../../_lib/contas-contratacao.js';

function guard(context, { needSign = false } = {}) {
  const env = context.env;
  if (!env.ACEITES_DB || !env.ANALYSIS_ADMIN_TOKEN || !env.BRIEFING_SIGNING_SECRET) return json({ error: 'Administração ainda não configurada.' }, 503);
  if (!isAdmin(context.request, env.ANALYSIS_ADMIN_TOKEN)) return json({ error: 'Não autorizado.' }, 401);
  if (needSign && !env.AUTENTIQUE_TOKEN) return json({ error: 'Assinatura eletrônica ainda não configurada (AUTENTIQUE_TOKEN).' }, 503);
  return null;
}

export async function onRequestGet(context) {
  const denied = guard(context); if (denied) return denied;
  const rows = await context.env.ACEITES_DB.prepare(`SELECT id, created_at, updated_at, ref, proposta_numero, nome, plataforma, max_parcelas, status, signed_at, paid_at, caso_aberto_at, payment_status FROM contas_contratacoes ORDER BY created_at DESC LIMIT 200`).all();
  return json({ ok: true, contratacoes: rows.results || [] });
}

export async function onRequestPost(context) {
  const denied = guard(context, { needSign: true }); if (denied) return denied;
  try {
    const form = await context.request.formData();
    const pdf = form.get('contrato');
    if (!pdf || typeof pdf === 'string' || pdf.type !== 'application/pdf') return json({ error: 'Envie o contrato em PDF.' }, 400);
    if (pdf.size > 5 * 1024 * 1024) return json({ error: 'O PDF passa de 5 MB (limite do plano gratuito da Autentique).' }, 400);
    const { value: c, errors } = validateInput(Object.fromEntries(form));
    if (errors.length) return json({ error: 'Confira os campos: ' + errors.join(', ') }, 400);
    c.id = crypto.randomUUID();
    const sign = await createAutentiqueDocument(c, pdf, context.env);
    const now = new Date().toISOString();
    await context.env.ACEITES_DB.prepare(`INSERT INTO contas_contratacoes (id, created_at, updated_at, ref, proposta_numero, nome, cpf_cnpj, email, whatsapp, plataforma, conta_numero, valor_centavos, max_parcelas, status, autentique_document_id, client_signature_id, sign_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'aguardando_assinatura', ?, ?, ?)`)
      .bind(c.id, now, now, c.ref, c.proposta_numero, c.nome, c.cpf_cnpj, c.email, c.whatsapp, c.plataforma, c.conta_numero, c.valor_centavos, c.max_parcelas, sign.documentId, sign.signatureId, sign.signUrl).run();
    const token = await clientToken(c.id, context.env);
    return json({ ok: true, id: c.id, linkCliente: `${publicBase(context.request, context.env)}/contas/contratacao/?t=${encodeURIComponent(token)}`, linkAssinatura: sign.signUrl }, 201);
  } catch (error) {
    console.error('contas_contratacao_create_error', error?.message, error?.detail);
    return json({ error: error?.message === 'autentique_failed' ? 'A Autentique recusou o envio: ' + error.detail : 'Não foi possível criar a contratação.' }, 424);
  }
}

// Correções manuais do advogado: marcar assinatura recebida (se o webhook falhar), cancelar ou gerar de novo o link do cliente.
export async function onRequestPatch(context) {
  const denied = guard(context); if (denied) return denied;
  const body = await context.request.json().catch(() => ({}));
  const row = await context.env.ACEITES_DB.prepare(`SELECT id, status, client_signature_id FROM contas_contratacoes WHERE id=?`).bind(String(body.id || '')).first();
  if (!row) return json({ error: 'Contratação não encontrada.' }, 404);
  const now = new Date().toISOString();
  if (body.acao === 'link_assinatura') {
    // Diagnóstico para o advogado: gera o link de assinatura e mostra o erro da Autentique, se houver.
    try {
      const link = await createSignatureLink(row.client_signature_id, context.env);
      await context.env.ACEITES_DB.prepare(`UPDATE contas_contratacoes SET sign_url=?, updated_at=? WHERE id=?`).bind(link, now, row.id).run();
      return json({ ok: true, linkAssinatura: link });
    } catch (e) { return json({ error: 'Autentique: ' + (e.detail || e.message) }, 424); }
  }
  if (body.acao === 'marcar_assinado' && row.status === 'aguardando_assinatura') {
    await context.env.ACEITES_DB.prepare(`UPDATE contas_contratacoes SET status='assinado', signed_at=?, updated_at=? WHERE id=?`).bind(now, now, row.id).run();
  } else if (body.acao === 'cancelar' && row.status !== 'caso_aberto') {
    await context.env.ACEITES_DB.prepare(`UPDATE contas_contratacoes SET status='cancelado', updated_at=? WHERE id=?`).bind(now, row.id).run();
  } else if (body.acao !== 'link') return json({ error: 'Ação não permitida neste estado.' }, 409);
  const token = await clientToken(row.id, context.env);
  return json({ ok: true, linkCliente: `${publicBase(context.request, context.env)}/contas/contratacao/?t=${encodeURIComponent(token)}` });
}
