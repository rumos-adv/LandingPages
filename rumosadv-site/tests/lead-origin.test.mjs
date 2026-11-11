import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseLeadOrigin, onRequestPost, onRequestGet } from '../functions/api/lead-origin.js';

const site = new URL('..', import.meta.url);
const ok = { event: 'whatsapp_click', source: 'hero', page: 'whatsapp-banido', lead_ref: 'WAB12C',
  gclid: 'Cj0KCQiA-teste_123', utm_source: 'google', utm_campaign: 'wa-recuperacao', utm_term: 'whatsapp banido' };

function fakeDb() {
  const rows = new Map();
  return { rows, prepare(sql) { return { bind(...v) { return { async run() {
    const [ref, created, seen, page, source, gclid, gbraid, wbraid, fbclid, us, uc, ut] = v;
    const prev = rows.get(ref);
    rows.set(ref, prev ? { ...prev, clicks: prev.clicks + 1, gclid: prev.gclid ?? gclid } :
      { ref, created, page, source, gclid, gbraid, wbraid, fbclid, utm_source: us, utm_campaign: uc, utm_term: ut, clicks: 1 });
    return { success: true, sql };
  } }; } }; } };
}
const req = (body, origin = 'https://rumosadv.com.br') => new Request('https://rumosadv.com.br/api/lead-origin',
  { method: 'POST', headers: origin ? { origin, 'content-type': 'application/json' } : {}, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('lead-origin: aceita clique válido e grava ref + gclid + campanha', async () => {
  const db = fakeDb();
  const r = await onRequestPost({ request: req(ok), env: { ACEITES_DB: db } });
  assert.equal(r.status, 204);
  const row = db.rows.get('WAB12C');
  assert.equal(row.gclid, 'Cj0KCQiA-teste_123');
  assert.equal(row.utm_campaign, 'wa-recuperacao');
  assert.equal(row.page, 'whatsapp-banido');
});
test('lead-origin: segundo clique não apaga o identificador do primeiro', async () => {
  const db = fakeDb(), env = { ACEITES_DB: db };
  await onRequestPost({ request: req(ok), env });
  await onRequestPost({ request: req({ ...ok, gclid: '' }), env });
  assert.equal(db.rows.get('WAB12C').gclid, 'Cj0KCQiA-teste_123');
  assert.equal(db.rows.get('WAB12C').clicks, 2);
});
test('lead-origin: recusa origem externa, página desconhecida, ref inválida e JSON quebrado', async () => {
  const env = { ACEITES_DB: fakeDb() };
  assert.equal((await onRequestPost({ request: req(ok, 'https://evil.example'), env })).status, 403);
  assert.equal((await onRequestPost({ request: req({ ...ok, page: 'divorcio' }), env })).status, 400);
  assert.equal((await onRequestPost({ request: req({ ...ok, lead_ref: 'x; drop' }), env })).status, 400);
  assert.equal((await onRequestPost({ request: req('{nope'), env })).status, 400);
  assert.equal(env.ACEITES_DB.rows.size, 0);
});
test('lead-origin: sem banco responde 503 e GET responde 405', async () => {
  assert.equal((await onRequestPost({ request: req(ok), env: {} })).status, 503);
  assert.equal(onRequestGet().status, 405);
});
test('lead-origin: descarta identificador malformado sem descartar o lead', () => {
  const p = parseLeadOrigin(JSON.stringify({ ...ok, gclid: '<script>', utm_term: 'a'.repeat(500) }));
  assert.equal(p.gclid, null); assert.equal(p.utm_term, null); assert.equal(p.ref, 'WAB12C');
});
for (const slug of ['whatsapp-banido', 'whatsapp-business-banido']) {
  test(`${slug}: mede pelo bootstrap do site (D-001), sem GTM direto, com endpoint e canônica no domínio principal`, () => {
    const html = readFileSync(new URL(`${slug}/index.html`, site), 'utf8');
    assert.equal((html.match(/src="\/assets\/rumos-site-consent\.v1\.2\.js\?v=\d+" data-measurement="gtm"/g) || []).length, 1);
    assert.doesNotMatch(html, /googletagmanager\.com\/(gtm\.js|ns\.html)|GTM-NQTH2XWD/);
    assert.match(html, /RUMOS_LEAD_ENDPOINT = '\/api\/lead-origin'/);
    assert.match(html, /rel="canonical" href="https:\/\/rumosadv\.com\.br\//);
    assert.match(html, /c\.marketing/);
    const consent = readFileSync(new URL('assets/rumos-site-consent.v1.2.js', site), 'utf8');
    assert.match(consent, new RegExp(`"/${slug}":"gtm"`));
  });
}
