import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../marcas/index.html', import.meta.url), 'utf8');
const tracking = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)[1];

function harness(href) {
  const listeners = {};
  const frame = { contentWindow: {} };
  const el = {
    getAttribute: name => name === 'href' ? href : 'hero',
    addEventListener: (event, callback) => { listeners.click = callback; },
  };
  const form = { getAttribute: () => 'hero', addEventListener: (_, callback) => { listeners.form = callback; } };
  const window = { location: { href: 'https://rumosadv.com.br/marcas/' }, dataLayer: [], addEventListener: (event, callback) => { listeners[event] = callback; } };
  const document = {
    querySelectorAll: selector => selector === '[data-wa-source]' ? [el] : [form],
    querySelector: () => frame,
  };
  vm.runInNewContext(tracking, { window, document, URL });
  return { events: window.dataLayer, listeners, frame };
}

test('hero opens office WhatsApp and preserves form as an alternative', () => {
  assert.match(html, /<a href="https:\/\/wa\.me\/5519989119770\?[^\"]+" class="hero__visual"[^>]+target="_blank"/);
  assert.match(html, /href="#consulta"[^>]+data-form-source="hero"/);
});

test('WhatsApp event only fires for the office WhatsApp destination', () => {
  for (const href of ['https://wa.me/5519989119770?text=Ola', 'https://api.whatsapp.com/send/?phone=5519989119770']) {
    const h = harness(href); h.listeners.click();
    assert.equal(h.events.filter(e => e.event === 'whatsapp_click').length, 1);
  }
  for (const href of ['#consulta', '/marcas/', 'https://wa.me.evil.example/5519989119770', 'https://wa.me/5511000000000']) {
    const h = harness(href); h.listeners.click();
    assert.equal(h.events.filter(e => e.event === 'whatsapp_click').length, 0, href);
  }
});

test('form navigation is separate from WhatsApp and a submitted lead', () => {
  const h = harness('#consulta'); h.listeners.form();
  assert.equal(h.events.at(-1).event, 'form_open');
  assert.equal(h.events.filter(e => e.event === 'lead_submit' || e.event === 'whatsapp_click').length, 0);
});

test('only a submitted event from the embedded Tally form counts as a lead', () => {
  const h = harness('#consulta');
  const valid = { origin: 'https://tally.so', source: h.frame.contentWindow, data: JSON.stringify({ event: 'Tally.FormSubmitted', payload: { formId: 'BzRag7' } }) };
  h.listeners.message({ ...valid, origin: 'https://untrusted.example' });
  h.listeners.message({ ...valid, source: {} });
  h.listeners.message({ ...valid, data: JSON.stringify({ event: 'Tally.FormSubmitted', payload: { formId: 'other' } }) });
  assert.equal(h.events.filter(e => e.event === 'lead_submit').length, 0);
  h.listeners.message(valid);
  assert.equal(h.events.filter(e => e.event === 'lead_submit').length, 1);
});
