// Contratação da etapa administrativa de recuperação de contas.
// Reaproveita: banco ACEITES_DB, checkout Asaas (mesma conta e webhook de Marcas) e os tokens assinados de marcas-auth.
import { createBriefingToken, verifyBriefingToken } from './marcas-auth.js';

export const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
export const STATUS = ['aguardando_assinatura', 'assinatura_recusada', 'assinado', 'aguardando_pagamento', 'pagamento_cancelado', 'pagamento_expirado', 'caso_aberto', 'cancelado'];
const TOKEN_TTL = 30 * 24 * 3600;

export const clientToken = (id, env) => createBriefingToken('contas:' + id, env.BRIEFING_SIGNING_SECRET, TOKEN_TTL);
export async function readClientToken(token, env) {
  const parsed = await verifyBriefingToken(token, env.BRIEFING_SIGNING_SECRET);
  return parsed && String(parsed.id).startsWith('contas:') ? String(parsed.id).slice(7) : null;
}
export function publicBase(request, env) {
  if (env.PUBLIC_BASE_URL) return String(env.PUBLIC_BASE_URL).replace(/\/$/, '');
  const u = new URL(request.url); return `${u.protocol}//${u.host}`;
}
export const digits = (v) => String(v || '').replace(/\D/g, '');

export function validateInput(f) {
  const out = {
    ref: String(f.ref || '').trim().toUpperCase().slice(0, 12) || null,
    proposta_numero: String(f.proposta_numero || '').trim().slice(0, 40) || null,
    nome: String(f.nome || '').trim().slice(0, 160),
    cpf_cnpj: digits(f.cpf_cnpj),
    email: String(f.email || '').trim().toLowerCase().slice(0, 160),
    whatsapp: digits(f.whatsapp),
    plataforma: String(f.plataforma || '').trim().slice(0, 60),
    conta_numero: String(f.conta_numero || '').trim().slice(0, 40) || null,
    max_parcelas: Math.min(Math.max(parseInt(f.max_parcelas || '1', 10) || 1, 1), 12),
    valor_centavos: 50000
  };
  const errors = [];
  if (out.nome.length < 3) errors.push('nome');
  if (![11, 14].includes(out.cpf_cnpj.length)) errors.push('cpf_cnpj');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) errors.push('email');
  if (out.whatsapp.length < 10 || out.whatsapp.length > 13) errors.push('whatsapp');
  if (!out.plataforma) errors.push('plataforma');
  if (out.ref && !/^[CWB][A-Z0-9]{3,9}$/.test(out.ref)) errors.push('ref');
  return { value: out, errors };
}

// ---------- Autentique (GraphQL, multipart) ----------
const AUTENTIQUE_URL = 'https://api.autentique.com.br/v2/graphql';
export function buildAutentiqueOperations(c, env, fileName) {
  const sandbox = env.AUTENTIQUE_SANDBOX === 'true';
  const query = `mutation CreateDocumentMutation($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) { createDocument(${sandbox ? 'sandbox: true, ' : ''}document: $document, signers: $signers, file: $file) { id name signatures { public_id name email action { name } link { short_link } } } }`;
  const signers = [{ name: c.nome, email: c.email, action: 'SIGN' }];
  if (env.AUTENTIQUE_WHATSAPP === 'true') { signers[0].phone = '+55' + c.whatsapp.replace(/^55/, ''); signers[0].delivery_method = 'DELIVERY_METHOD_WHATSAPP'; delete signers[0].email; }
  if (env.AUTENTIQUE_OWNER_EMAIL) signers.push({ email: env.AUTENTIQUE_OWNER_EMAIL, action: 'SIGN' });
  const document = {
    name: `Contrato etapa administrativa${c.ref ? ' — Ref. ' + c.ref : ''} — ${c.nome}`.slice(0, 200),
    message: 'Contrato de prestação de serviços advocatícios — etapa administrativa (Rumos Advocacia). Após assinar, volte ao link de contratação para o pagamento.',
    refusable: true,
    new_signature_style: true
  };
  return { operations: JSON.stringify({ query, variables: { document, signers, file: null } }), map: JSON.stringify({ file: ['variables.file'] }), fileName: fileName || 'contrato.pdf' };
}
export async function createAutentiqueDocument(c, pdf, env, fetcher = fetch) {
  const ops = buildAutentiqueOperations(c, env, pdf.name);
  const form = new FormData();
  form.append('operations', ops.operations);
  form.append('map', ops.map);
  form.append('file', pdf, ops.fileName);
  const r = await fetcher(AUTENTIQUE_URL, { method: 'POST', headers: { authorization: 'Bearer ' + env.AUTENTIQUE_TOKEN }, body: form });
  const data = await r.json().catch(() => ({}));
  const doc = data?.data?.createDocument;
  if (!r.ok || !doc?.id) throw Object.assign(new Error('autentique_failed'), { detail: data?.errors?.[0]?.message || r.status });
  const sig0 = (doc.signatures || []).find(s => (s.email || '').toLowerCase() === c.email) || (doc.signatures || []).find(s => s.action?.name === 'SIGN' && (s.email || '').toLowerCase() !== String(env.AUTENTIQUE_OWNER_EMAIL || '').toLowerCase());
  const sig = sig0;
  let signUrl = sig?.link?.short_link || null;
  // A Autentique só devolve o link na criação em alguns envios; nos demais, ele é gerado à parte.
  if (!signUrl && sig?.public_id) signUrl = await createSignatureLink(sig.public_id, env, fetcher).catch(() => null);
  return { documentId: doc.id, signatureId: sig?.public_id || null, signUrl };
}

export async function createSignatureLink(publicId, env, fetcher = fetch) {
  const r = await fetcher(AUTENTIQUE_URL, { method: 'POST', headers: { authorization: 'Bearer ' + env.AUTENTIQUE_TOKEN, 'content-type': 'application/json' },
    // O tipo do argumento não é documentado; o valor vai literal (só hexadecimal), como no exemplo oficial.
    body: JSON.stringify({ query: `mutation { createLinkToSignature(public_id: "${String(publicId).replace(/[^A-Za-z0-9_-]/g, '')}") { short_link } }` }) });
  const data = await r.json().catch(() => ({}));
  const link = data?.data?.createLinkToSignature?.short_link;
  if (!r.ok || !link) throw Object.assign(new Error('autentique_link_failed'), { detail: data?.errors?.[0]?.message || r.status });
  return link;
}

// Consulta direta à Autentique: 'signed', 'rejected' ou null. Garante o fluxo mesmo se o webhook não chegar.
export async function fetchSignatureStatus(documentId, publicId, env, fetcher = fetch) {
  const id = String(documentId).replace(/[^A-Za-z0-9_-]/g, '');
  const r = await fetcher(AUTENTIQUE_URL, { method: 'POST', headers: { authorization: 'Bearer ' + env.AUTENTIQUE_TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify({ query: `query { document(id: "${id}") { signatures { public_id email signed { created_at } rejected { created_at } } } }` }) });
  const data = await r.json().catch(() => ({}));
  const sigs = data?.data?.document?.signatures;
  if (!r.ok || !Array.isArray(sigs)) throw Object.assign(new Error('autentique_query_failed'), { detail: data?.errors?.[0]?.message || r.status });
  const s = sigs.find(x => x.public_id === publicId);
  if (!s) return null;
  if (s.signed?.created_at) return 'signed';
  if (s.rejected?.created_at) return 'rejected';
  return null;
}

export async function syncSignature(row, env, db, fetcher = fetch) {
  if (row.status !== 'aguardando_assinatura' || !row.autentique_document_id || !row.client_signature_id || !env.AUTENTIQUE_TOKEN) return row;
  const st = await fetchSignatureStatus(row.autentique_document_id, row.client_signature_id, env, fetcher).catch(e => { console.error('contas_sign_status_error', e?.message, e?.detail); return null; });
  const now = new Date().toISOString();
  if (st === 'signed') { await db.prepare(`UPDATE contas_contratacoes SET status='assinado', signed_at=?, updated_at=? WHERE id=? AND status='aguardando_assinatura'`).bind(now, now, row.id).run(); return { ...row, status: 'assinado', signed_at: now }; }
  if (st === 'rejected') { await db.prepare(`UPDATE contas_contratacoes SET status='assinatura_recusada', updated_at=? WHERE id=? AND status='aguardando_assinatura'`).bind(now, row.id).run(); return { ...row, status: 'assinatura_recusada' }; }
  return row;
}

export async function verifyHmacHex(rawBody, received, secret) {
  if (!secret || !received) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)));
  const hex = [...mac].map(b => b.toString(16).padStart(2, '0')).join('');
  const got = String(received).trim().toLowerCase();
  if (got.length !== hex.length) return false;
  let diff = 0; for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}
// Os exemplos da Autentique ora trazem o recurso em data.object, ora direto em data.
export function parseAutentiqueEvent(body) {
  const ev = body?.event && typeof body.event === 'object' ? body.event : body;
  const obj = ev?.data?.object || ev?.data || {};
  const type = String(ev?.type || '');
  const eventId = String(ev?.id || '') || `${type}:${obj?.id || ''}`;
  const documentId = type.startsWith('document.') ? String(obj?.id || '') : String(obj?.document?.id || obj?.document || obj?.document_id || '');
  return { eventId, type, documentId: documentId || null, signatureId: type.startsWith('signature.') ? String(obj?.public_id || obj?.id || '') : null };
}

// ---------- Asaas ----------
export const asaasBase = (env) => env.ASAAS_ENV === 'production' ? 'https://api.asaas.com/v3' : 'https://api-sandbox.asaas.com/v3';
export function buildCheckoutPayload(c, base, token, { installments = true, customer = true } = {}) {
  const back = `${base}/contas/contratacao/?t=${encodeURIComponent(token)}`;
  const p = {
    billingTypes: ['PIX', 'CREDIT_CARD'],
    chargeTypes: installments && c.max_parcelas > 1 ? ['DETACHED', 'INSTALLMENT'] : ['DETACHED'],
    minutesToExpire: 1440,
    externalReference: 'contas:' + c.id,
    callback: { successUrl: back + '&pagamento=sucesso', cancelUrl: back + '&pagamento=cancelado', expiredUrl: back + '&pagamento=expirado' },
    items: [{ externalReference: 'contas-etapa-administrativa', name: 'Recuperação de conta — etapa administrativa', description: `Honorários fixos da etapa administrativa${c.ref ? ' (Ref. ' + c.ref + ')' : ''}`, quantity: 1, value: c.valor_centavos / 100 }]
  };
  if (installments && c.max_parcelas > 1) p.installment = { maxInstallmentCount: c.max_parcelas };
  if (customer) p.customerData = { name: c.nome, cpfCnpj: c.cpf_cnpj, email: c.email, phone: c.whatsapp.replace(/^55/, '') };
  return p;
}
export async function createAsaasCheckout(c, base, token, env, fetcher = fetch) {
  // Tenta com parcelamento e dados do cliente; se o Asaas recusar a combinação, cai para Pix + cartão à vista.
  const attempts = [{ installments: true, customer: true }, { installments: true, customer: false }, { installments: false, customer: false }];
  let last;
  for (const opt of attempts) {
    const r = await fetcher(`${asaasBase(env)}/checkouts`, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', access_token: env.ASAAS_API_KEY, 'user-agent': 'RumosAdvocacia-Contas/1.0 (+https://rumosadv.com.br)' }, body: JSON.stringify(buildCheckoutPayload(c, base, token, opt)) });
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.id) return { checkoutId: data.id, checkoutUrl: data.link || `${env.ASAAS_ENV === 'production' ? 'https://asaas.com' : 'https://sandbox.asaas.com'}/checkoutSession/show/${data.id}`, options: opt };
    last = data?.errors?.[0]?.description || r.status;
    if (r.status !== 400) break;
  }
  throw Object.assign(new Error('asaas_failed'), { detail: last });
}

// Estado mostrado ao cliente: sem CPF, e-mail ou telefone.
export function publicView(row) {
  return {
    primeiroNome: String(row.nome || '').split(/\s+/)[0],
    plataforma: row.plataforma, ref: row.ref, valor: row.valor_centavos / 100, maxParcelas: row.max_parcelas,
    status: row.status,
    signUrl: row.status === 'aguardando_assinatura' ? row.sign_url : null,
    podePagar: ['assinado', 'aguardando_pagamento', 'pagamento_cancelado', 'pagamento_expirado'].includes(row.status),
    pago: row.status === 'caso_aberto'
  };
}
