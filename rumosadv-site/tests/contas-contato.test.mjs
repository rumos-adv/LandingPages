import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { parseContato, onRequestPost } from '../functions/api/contas/contato.js';
import { parseLeadOrigin } from '../functions/api/lead-origin.js';

function d1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0007_contas_contatos.sql', import.meta.url), 'utf8'));
  const wrap = (sql) => { let args = []; const api = { bind: (...a) => { args = a; return api; }, first: async () => db.prepare(sql).get(...args) ?? null, all: async () => ({ results: db.prepare(sql).all(...args) }), run: async () => ({ meta: { changes: db.prepare(sql).run(...args).changes } }) }; return api; };
  return { prepare: wrap, raw: db };
}
const req = (body, origin = 'https://rumosadv.com.br') => new Request('https://rumosadv.com.br/api/contas/contato', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ok = { page: 'whatsapp-banido', lead_ref: 'wab12c', nome: ' Maria  Souza ', telefone: '+55 (19) 99999-0000', preferencia: 'ligacao', numero_banido: '19 98888-7777', relato: 'Fui banida ontem.' };

test('valida e normaliza o contato', () => {
  const c = parseContato(ok).contato;
  assert.equal(c.nome, 'Maria Souza'); assert.equal(c.telefone, '19999990000'); assert.equal(c.ref, 'WAB12C'); assert.equal(c.numero_banido, '19988887777');
  assert.match(parseContato({ ...ok, telefone: '9999' }).error, /telefone/);
  assert.match(parseContato({ ...ok, nome: '' }).error, /nome/);
  assert.match(parseContato({ ...ok, preferencia: 'email' }).error, /e-mail/);
  assert.match(parseContato({ ...ok, email: 'x@' }).error, /e-mail/);
  assert.match(parseContato({ ...ok, page: 'outra' }).error, /Página/);
  assert.equal(parseContato({ ...ok, site: 'http://spam' }).spam, true);
  assert.equal(parseContato({ ...ok, lead_ref: '<script>' }).contato.ref, null);
  assert.equal(parseContato({ ...ok, relato: 'a'.repeat(2000) }).contato.relato.length, 800);
});

test('grava, não duplica reenvio e recusa origem estranha', async () => {
  const env = { ACEITES_DB: d1() };
  assert.equal((await onRequestPost({ request: req(ok), env })).status, 201);
  assert.equal((await onRequestPost({ request: req({ ...ok, relato: 'Complemento.' }), env })).status, 201);
  const rows = env.ACEITES_DB.raw.prepare('SELECT * FROM contas_contatos').all();
  assert.equal(rows.length, 1); assert.equal(rows[0].relato, 'Complemento.'); assert.equal(rows[0].status, 'novo');
  assert.equal((await onRequestPost({ request: req(ok, 'https://evil.example'), env })).status, 403);
  assert.equal((await onRequestPost({ request: req({ ...ok, site: 'x' }), env })).status, 200);
  assert.equal(env.ACEITES_DB.raw.prepare('SELECT COUNT(*) n FROM contas_contatos').get().n, 1);
});

test('a origem do formulário é aceita no registro de origem', () => {
  assert.equal(parseLeadOrigin(JSON.stringify({ lead_ref: 'WAB12C', page: 'whatsapp-banido', source: 'form' })).source, 'form');
});

test('dinheiro retido grava os detalhes e não sobrescreve pedido de outro serviço', async () => {
  const env = { ACEITES_DB: d1() };
  await onRequestPost({ request: req(ok), env });
  const novo = { ...ok, page: 'dinheiro-retido', lead_ref: 'CA1B2C3D4', numero_banido: '', relato: 'Plataforma: Mercado Livre\nValor retido informado: R$ 12.000', preferencia: 'whatsapp_outro' };
  assert.equal((await onRequestPost({ request: req(novo), env })).status, 201);
  await onRequestPost({ request: req({ ...novo, relato: 'Complemento sobre o saldo.' }), env });
  const rows = env.ACEITES_DB.raw.prepare('SELECT * FROM contas_contatos ORDER BY page').all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].page, 'dinheiro-retido');
  assert.equal(rows[0].ref, 'CA1B2C3D4');
  assert.equal(rows[0].relato, 'Complemento sobre o saldo.');
  assert.equal(rows[0].numero_banido, null);
  assert.equal(rows[1].relato, ok.relato);
  assert.equal(parseLeadOrigin(JSON.stringify({ page: novo.page, lead_ref: novo.lead_ref, source: 'form' })).page, novo.page);
});


test('aviso ao Rod: texto sem dados pessoais e chamada só com URL e token configurados', async () => {
  const { alertText } = await import('../functions/api/contas/contato.js');
  const t = alertText({ page: 'whatsapp-banido', preferencia: 'ligacao', ref: 'W489KM', nome: 'Fulano', telefone: '19999990000' });
  assert.match(t, /WhatsApp banido, prefere ligação \(Ref\. W489KM\)/);
  assert.doesNotMatch(t, /Fulano|19999990000/);
});

test('pedido novo dispara um aviso; reenvio em 10 minutos não repete o aviso', async () => {
  const calls = [], realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response('{}', { status: 200 }); };
  try {
    const env = { ACEITES_DB: d1(), OWNER_ALERT_URL: 'https://alerta.example/interno', OWNER_ALERT_TOKEN: 'tok' };
    const pend = [];
    assert.equal((await onRequestPost({ request: req(ok), env, waitUntil: (p) => pend.push(p) })).status, 201);
    assert.equal((await onRequestPost({ request: req({ ...ok, relato: 'Mais.' }), env, waitUntil: (p) => pend.push(p) })).status, 201);
    await Promise.all(pend);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.headers.authorization, 'Bearer tok');
    assert.doesNotMatch(calls[0].init.body, /Maria|99999/);
  } finally { globalThis.fetch = realFetch; }
});
