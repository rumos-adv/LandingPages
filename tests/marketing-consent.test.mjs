import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { onRequestPost as adminPost } from '../rumosadv-site/functions/api/admin/analises.js';

const helperPath = new URL('../rumosadv-site/assets/js/marketing-consent.v1.js', import.meta.url);
const marcasPath = new URL('../rumosadv-site/marcas/index.html', import.meta.url);
const aceitePath = new URL('../rumosadv-site/marcas/aceite/index.html', import.meta.url);
const retornoPath = new URL('../rumosadv-site/marcas/aceite/pagamento/index.html', import.meta.url);
const briefingPath = new URL('../rumosadv-site/marcas/briefing/index.html', import.meta.url);
const headersPath = new URL('../rumosadv-site/_headers', import.meta.url);

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); }
  };
}

class FakeElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.handlers = {};
    this.hidden = false;
    this.textContent = '';
  }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  appendChild(child) { this.children.push(child); return child; }
  append(...children) { this.children.push(...children); }
  addEventListener(type, handler) { this.handlers[type] = handler; }
  focus() { this.focused = true; }
  click() { this.handlers.click?.(); }
}

async function consentHarness(storedPreference) {
  const source = await readFile(helperPath, 'utf8');
  const head = new FakeElement('head');
  const body = new FakeElement('body');
  const events = [];
  let reloads = 0;
  const document = {
    readyState: 'complete',
    head,
    body,
    createElement(tag) { return new FakeElement(tag); },
    createTextNode(text) { return { nodeType: 3, textContent: String(text) }; },
    querySelector(selector) {
      if (selector !== 'script[data-rumos-gtm]') return null;
      return head.children.find(child => child.tagName === 'SCRIPT' && child.dataset.rumosGtm) || null;
    }
  };
  const localStorage = memoryStorage(storedPreference == null ? {} : {
    rumos_marketing_consent_v1: storedPreference
  });
  const window = {
    localStorage,
    location: { reload() { reloads += 1; } },
    dispatchEvent(event) { events.push(event); }
  };
  class CustomEvent {
    constructor(type, init) { this.type = type; this.detail = init?.detail; }
  }
  vm.runInNewContext(source, {
    window,
    document,
    CustomEvent,
    Date,
    Object,
    Array,
    String,
    Boolean,
    encodeURIComponent
  }, { filename: 'assets/js/marketing-consent.v1.js' });
  return {
    window,
    head,
    body,
    events,
    reloads: () => reloads,
    scripts: () => head.children.filter(child => child.tagName === 'SCRIPT' && child.dataset.rumosGtm)
  };
}

test('por padrão e após recusa não cria dataLayer nem requisição ao GTM', async () => {
  const page = await consentHarness();
  assert.equal(page.window.dataLayer, undefined);
  assert.equal(page.scripts().length, 0);
  assert.equal(page.window.RumosMarketing.track({ event: 'evento_previo' }), false);

  page.window.RumosMarketing.deny();

  assert.equal(page.window.dataLayer, undefined);
  assert.equal(page.scripts().length, 0);
  assert.equal(page.window.RumosMarketing.preference(), 'denied');
});

test('aceite explícito cria exatamente uma requisição GTM e não reproduz evento anterior', async () => {
  const page = await consentHarness();
  page.window.RumosMarketing.track({ event: 'nao_enfileirar' });
  page.window.RumosMarketing.grant();
  page.window.RumosMarketing.grant();

  assert.equal(page.scripts().length, 1);
  assert.equal(page.scripts()[0].src, 'https://www.googletagmanager.com/gtm.js?id=GTM-NQTH2XWD');
  assert.equal(page.window.dataLayer.some(item => item.event === 'nao_enfileirar'), false);
  assert.equal(page.window.dataLayer.filter(item => item.event === 'gtm.js').length, 1);

  assert.equal(page.window.RumosMarketing.track({ event: 'evento_permitido' }), true);
  assert.equal(page.window.dataLayer.filter(item => item.event === 'evento_permitido').length, 1);
});

test('preferência de recusa persistida não carrega o GTM e continua revisável', async () => {
  const page = await consentHarness('denied');
  assert.equal(page.scripts().length, 0);
  assert.equal(page.window.dataLayer, undefined);
  assert.equal(page.window.RumosMarketing.preference(), 'denied');
  assert.ok(page.body.children.some(child => child.attributes['aria-label'] === 'Rever preferências de privacidade'));
});

test('helper oferece escolhas acessíveis e link para a política existente', async () => {
  const source = await readFile(helperPath, 'utf8');
  assert.match(source, /role:\s*'dialog'/);
  assert.match(source, /aria-labelledby/);
  assert.match(source, /Permitir medição/);
  assert.match(source, /Continuar sem cookies/);
  assert.match(source, /\/politica-de-privacidade\//);
  assert.match(source, /Rever preferências de privacidade/);
});

test('páginas públicas não contêm carregador imediato nem fallback noscript do GTM', async () => {
  for (const path of [marcasPath, aceitePath]) {
    const html = await readFile(path, 'utf8');
    assert.match(html, /<script src="\/assets\/js\/marketing-consent\.v1\.js"><\/script>/);
    assert.doesNotMatch(html, /www\.googletagmanager\.com|GTM-NQTH2XWD|window\.dataLayer|dataLayer\.push/);
    assert.match(html, /RumosMarketing\.track/);
    assert.match(html, /typeof window\.RumosMarketing\.track==='function'/);
    assert.match(html, /track:function\(\)\{return false;\}/);
    assert.doesNotMatch(html, /window\.RumosMarketing\.track\s*\(/);
  }
});

test('helper de consentimento usa URL versionada compatível com cache imutável', async () => {
  const headers = await readFile(headersPath, 'utf8');
  assert.match(headers, /\/assets\/\*\s+Cache-Control: public, max-age=31536000, immutable/);
  for (const path of [marcasPath, aceitePath]) {
    const html = await readFile(path, 'utf8');
    assert.match(html, /\/assets\/js\/marketing-consent\.v1\.js/);
    assert.doesNotMatch(html, /\/assets\/js\/marketing-consent\.js/);
  }
});

test('retorno de pagamento e briefing não carregam rastreadores nem fontes de terceiros', async () => {
  for (const path of [retornoPath, briefingPath]) {
    const html = await readFile(path, 'utf8');
    assert.doesNotMatch(html, /googletagmanager|connect\.facebook\.net|dataLayer|fonts\.googleapis|fonts\.gstatic/i);
  }
});

test('retorno de pagamento remove identificadores da barra após ler o status', async () => {
  const html = await readFile(retornoPath, 'utf8');
  assert.match(html, /const p=new URLSearchParams\(location\.search\),s=p\.get\('status'\);/);
  assert.match(html, /history\.replaceState\(null,'',location\.pathname\);/);
});

test('lead do Tally só é medido quando origem e janela correspondem ao iframe atual', async () => {
  const html = await readFile(marcasPath, 'utf8');
  const source = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .find(script => script.includes('__tallyListenerInstalled'));
  assert.ok(source);
  const tallySource = html.match(/data-tally-src="([^"]+)"/)?.[1].replaceAll('&amp;', '&');
  assert.equal(new URL(tallySource).origin, 'https://tally.so');
  assert.equal(new URL(tallySource).pathname, '/embed/BzRag7');

  const contentWindow = {};
  const iframe = { contentWindow };
  const handlers = {};
  const tracked = [];
  const window = {
    RumosMarketing: { track(event) { tracked.push(event); } },
    addEventListener(type, handler) { handlers[type] = handler; }
  };
  const document = {
    querySelector(selector) {
      assert.equal(selector, 'iframe[data-tally-src]');
      return iframe;
    },
    querySelectorAll() { return []; }
  };
  vm.runInNewContext(source, { window, document, JSON }, { filename: 'marcas/index.html' });
  tracked.length = 0;
  const payload = JSON.stringify({ event: 'Tally.FormSubmitted', payload: { formId: 'BzRag7' } });

  handlers.message({ origin: 'https://evil.example', source: contentWindow, data: payload });
  handlers.message({ origin: 'https://tally.so', source: {}, data: payload });
  assert.equal(tracked.length, 0);

  handlers.message({ origin: 'https://tally.so', source: contentWindow, data: payload });
  assert.equal(tracked.length, 1);
  assert.equal(tracked[0].event, 'lead_submit');
  assert.equal(tracked[0].form_id, 'BzRag7');
});

test('admin gera link de briefing com token no fragmento, nunca na query', async () => {
  const db = {
    prepare() {
      return {
        bind() {
          return {
            async first() {
              return {
                id: 'case-1',
                marca: 'Montanha Cafés',
                nome: 'Cliente Teste',
                payment_status: 'PAID',
                delivered_at: null,
                credit_expires_at: null,
                registration_converted_at: null,
                report_file: null
              };
            }
          };
        }
      };
    }
  };
  const response = await adminPost({
    request: new Request('https://rumos.example/api/admin/analises', {
      method: 'POST',
      headers: {
        authorization: 'Bearer admin-test',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ action: 'create_briefing_link', aceite_id: 'case-1' })
    }),
    env: {
      ACEITES_DB: db,
      ANALYSIS_ADMIN_TOKEN: 'admin-test',
      BRIEFING_SIGNING_SECRET: 'segredo-de-teste-com-tamanho-adequado'
    }
  });
  const body = await response.json();
  const generated = new URL(body.url);

  assert.equal(response.status, 200);
  assert.equal(generated.search, '');
  assert.match(generated.hash, /^#token=.+\..+$/);
  assert.equal(body.url.includes('?token='), false);
});
