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
