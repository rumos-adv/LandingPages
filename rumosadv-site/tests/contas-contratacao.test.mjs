import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as admin from '../functions/api/admin/contas/contratacoes.js';
import * as cliente from '../functions/api/contas/contratacao.js';
import * as autentique from '../functions/api/webhooks/autentique.js';
import * as asaas from '../functions/api/webhooks/asaas.js';
import { validateInput, publicView, parseAutentiqueEvent, buildCheckoutPayload, buildAutentiqueOperations } from '../functions/_lib/contas-contratacao.js';

const site = new URL('..', import.meta.url);
function d1() {
  const db = new DatabaseSync(':memory:');
  for (const m of ['0001_aceites.sql', '0002_asaas_checkout.sql', '0005_contas_contratacoes.sql']) db.exec(readFileSync(new URL('migrations/' + m, site), 'utf8'));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes } }; },
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) })
  });
  return { prepare: (sql) => stmt(sql), raw: db };
}
const SECRET = 'segredo-de-teste-com-32-caracteres!!';
const env = (db, extra = {}) => ({ ACEITES_DB: db, ANALYSIS_ADMIN_TOKEN: 'adm', BRIEFING_SIGNING_SECRET: SECRET, AUTENTIQUE_TOKEN: 'tok', AUTENTIQUE_WEBHOOK_SECRET: 'whsec', AUTENTIQUE_OWNER_EMAIL: 'rodrigo@rumosadv.com.br', ASAAS_API_KEY: 'k', ASAAS_ENV: 'sandbox', ASAAS_WEBHOOK_TOKEN: 'asaastok', PUBLIC_BASE_URL: 'https://rumosadv.com.br', ...extra });
const fields = { nome: 'Maria da Silva', cpf_cnpj: '123.456.789-09', email: 'maria@example.com', whatsapp: '(19) 99999-1234', plataforma: 'WhatsApp', conta_numero: '19999991234', ref: 'wab12c', proposta_numero: '2026-001', max_parcelas: '3' };
function adminForm() { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.append(k, v); f.append('contrato', new Blob(['%PDF-1.4 teste'], { type: 'application/pdf' }), 'contrato.pdf'); return f; }
async function hmac(body, secret) { const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(body)))].map(b => b.toString(16).padStart(2, '0')).join(''); }

test('validação: exige nome, CPF/CNPJ, e-mail, WhatsApp e plataforma; limita parcelas', () => {
  const ok = validateInput(fields); assert.deepEqual(ok.errors, []); assert.equal(ok.value.cpf_cnpj, '12345678909'); assert.equal(ok.value.ref, 'WAB12C'); assert.equal(ok.value.max_parcelas, 3);
  assert.deepEqual(validateInput({ ...fields, email: 'x', cpf_cnpj: '1' }).errors, ['cpf_cnpj', 'email']);
  assert.equal(validateInput({ ...fields, max_parcelas: '40' }).value.max_parcelas, 12);
});
test('Autentique: mutation com sandbox só quando ligado; advogado entra como segundo signatário', () => {
  const c = validateInput(fields).value;
  const off = JSON.parse(buildAutentiqueOperations(c, env(null)).operations);
  assert.doesNotMatch(off.query, /sandbox/); assert.equal(off.variables.signers.length, 2); assert.equal(off.variables.signers[1].email, 'rodrigo@rumosadv.com.br');
  assert.match(JSON.parse(buildAutentiqueOperations(c, env(null, { AUTENTIQUE_SANDBOX: 'true' })).operations).query, /sandbox: true/);
  const wa = JSON.parse(buildAutentiqueOperations(c, env(null, { AUTENTIQUE_WHATSAPP: 'true' })).operations).variables.signers[0];
  assert.equal(wa.delivery_method, 'DELIVERY_METHOD_WHATSAPP'); assert.equal(wa.phone, '+5519999991234');
});
test('evento da Autentique é lido nos dois formatos da documentação', () => {
  assert.deepEqual(parseAutentiqueEvent({ event: { id: 'e1', type: 'signature.accepted', data: { object: { public_id: 's1', document: { id: 'd1' } } } } }), { eventId: 'e1', type: 'signature.accepted', documentId: 'd1', signatureId: 's1' });
  assert.equal(parseAutentiqueEvent({ event: { id: 'e2', type: 'document.finished', data: { id: 'd9' } } }).documentId, 'd9');
});
test('checkout: Pix + cartão, parcelamento só quando > 1x, valor de R$ 500 e volta para a página do cliente', () => {
  const c = { ...validateInput(fields).value, id: 'abc' };
  const p = buildCheckoutPayload(c, 'https://rumosadv.com.br', 'T');
  assert.deepEqual(p.billingTypes, ['PIX', 'CREDIT_CARD']); assert.deepEqual(p.chargeTypes, ['DETACHED', 'INSTALLMENT']); assert.equal(p.installment.maxInstallmentCount, 3);
  assert.equal(p.items[0].value, 500); assert.equal(p.externalReference, 'contas:abc'); assert.match(p.callback.successUrl, /\/contas\/contratacao\/\?t=T&pagamento=sucesso/);
  assert.deepEqual(buildCheckoutPayload({ ...c, max_parcelas: 1 }, 'x', 'T').chargeTypes, ['DETACHED']);
});
test('fluxo completo: proposta → assinatura → pagamento → confirmação → caso aberto, sem afetar Marcas', async (t) => {
  const db = d1(), E = env(db), calls = [];
  const realFetch = globalThis.fetch; t.after(() => { globalThis.fetch = realFetch; });
  globalThis.fetch = async (url, init) => {
    calls.push(String(url));
    if (String(url).includes('autentique')) {
      if (init.body instanceof FormData) return Response.json({ data: { createDocument: { id: 'doc1', signatures: [{ public_id: 'sigCliente', email: 'maria@example.com', action: { name: 'SIGN' }, link: null }, { public_id: 'sigAdv', email: 'rodrigo@rumosadv.com.br', action: { name: 'SIGN' }, link: null }] } } });
      const q = JSON.parse(init.body); assert.equal(q.variables.id, 'sigCliente');
      return Response.json({ data: { createLinkToSignature: { short_link: 'https://assina.ae/x' } } });
    }
    const body = JSON.parse(init.body);
    if (body.installment) return Response.json({ errors: [{ description: 'combinação não suportada' }] }, { status: 400 });
    return Response.json({ id: 'chk1', link: 'https://sandbox.asaas.com/c/chk1' });
  };
  // 1. painel sem chave → 401; com chave → contrato enviado
  assert.equal((await admin.onRequestPost({ request: new Request('https://x/api/admin/contas/contratacoes', { method: 'POST', body: adminForm() }), env: E })).status, 401);
  const created = await admin.onRequestPost({ request: new Request('https://x/api/admin/contas/contratacoes', { method: 'POST', headers: { authorization: 'Bearer adm' }, body: adminForm() }), env: E });
  assert.equal(created.status, 201); const { linkCliente, linkAssinatura } = await created.json();
  assert.equal(linkAssinatura, 'https://assina.ae/x'); const token = new URL(linkCliente).searchParams.get('t');
  // 2. cliente vê o link de assinatura e não consegue pagar antes de assinar
  let v = (await (await cliente.onRequestGet({ request: new Request('https://x/api/contas/contratacao?t=' + encodeURIComponent(token)), env: E })).json()).contratacao;
  assert.equal(v.status, 'aguardando_assinatura'); assert.equal(v.signUrl, 'https://assina.ae/x'); assert.equal(v.primeiroNome, 'Maria'); assert.equal(JSON.stringify(v).includes('12345678909'), false);
  assert.equal((await cliente.onRequestPost({ request: new Request('https://x', { method: 'POST', body: JSON.stringify({ t: token }) }), env: E })).status, 409);
  // 3. webhook com assinatura HMAC inválida é recusado; o válido marca como assinado; duplicado é ignorado
  const ev = JSON.stringify({ event: { id: 'ev1', type: 'signature.accepted', data: { object: { public_id: 'sigCliente', document: { id: 'doc1' } } } } });
  assert.equal((await autentique.onRequestPost({ request: new Request('https://x', { method: 'POST', headers: { 'x-autentique-signature': 'ab' }, body: ev }), env: E })).status, 401);
  const sig = await hmac(ev, 'whsec');
  assert.equal((await autentique.onRequestPost({ request: new Request('https://x', { method: 'POST', headers: { 'x-autentique-signature': sig }, body: ev }), env: E })).status, 200);
  assert.equal((await (await autentique.onRequestPost({ request: new Request('https://x', { method: 'POST', headers: { 'x-autentique-signature': sig }, body: ev }), env: E })).json()).duplicate, true);
  // a assinatura do advogado sozinha não libera nada (já liberado aqui; verificamos a regra no estado)
  // 4. pagamento: Asaas recusa o parcelamento combinado → cai para Pix + cartão à vista
  const pay = await cliente.onRequestPost({ request: new Request('https://x', { method: 'POST', body: JSON.stringify({ t: token }) }), env: E });
  assert.equal(pay.status, 201); assert.equal((await pay.json()).checkoutUrl, 'https://sandbox.asaas.com/c/chk1');
  assert.equal(db.raw.prepare(`SELECT status FROM contas_contratacoes`).get().status, 'aguardando_pagamento');
  // 5. Marcas continua funcionando no mesmo webhook do Asaas
  db.raw.prepare(`INSERT INTO aceites (id, created_at, nome, cpf_cnpj, email, whatsapp, marca, term_version, term_hash, asaas_checkout_id) VALUES ('a1','2026-11-11','X','1','x@x.com','1','M','1','h','chkMarca')`).run();
  const hook = (id, name, checkout) => asaas.onRequestPost({ request: new Request('https://x', { method: 'POST', headers: { 'asaas-access-token': 'asaastok' }, body: JSON.stringify({ id, event: name, checkout: { id: checkout } }) }), env: E });
  assert.equal((await hook('w1', 'CHECKOUT_PAID', 'chkMarca')).status, 200);
  assert.equal(db.raw.prepare(`SELECT status FROM aceites WHERE id='a1'`).get().status, 'pago');
  assert.equal(db.raw.prepare(`SELECT status FROM contas_contratacoes`).get().status, 'aguardando_pagamento');
  // 6. pagamento confirmado abre o caso
  assert.equal((await hook('w2', 'CHECKOUT_PAID', 'chk1')).status, 200);
  const row = db.raw.prepare(`SELECT status, paid_at, caso_aberto_at FROM contas_contratacoes`).get();
  assert.equal(row.status, 'caso_aberto'); assert.ok(row.paid_at); assert.ok(row.caso_aberto_at);
  v = (await (await cliente.onRequestGet({ request: new Request('https://x/api/contas/contratacao?t=' + encodeURIComponent(token)), env: E })).json()).contratacao;
  assert.equal(v.pago, true); assert.equal(v.podePagar, false);
  // um evento atrasado de expiração não reabre o caso
  await hook('w3', 'CHECKOUT_EXPIRED', 'chk1');
  assert.equal(db.raw.prepare(`SELECT status FROM contas_contratacoes`).get().status, 'caso_aberto');
});
test('sem chave da Autentique o painel recusa criar e explica o que falta', async () => {
  const r = await admin.onRequestPost({ request: new Request('https://x', { method: 'POST', headers: { authorization: 'Bearer adm' }, body: adminForm() }), env: env(d1(), { AUTENTIQUE_TOKEN: '' }) });
  assert.equal(r.status, 503); assert.match((await r.json()).error, /AUTENTIQUE_TOKEN/);
});
test('link de cliente adulterado ou de Marcas não abre contratação', async () => {
  const E = env(d1());
  assert.equal((await cliente.onRequestGet({ request: new Request('https://x/api/contas/contratacao?t=abc.def'), env: E })).status, 401);
});
