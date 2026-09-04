import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const htmlPath = new URL('../rumosadv-site/marcas/briefing/index.html', import.meta.url);

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return structuredClone(body); }
  };
}

function control(properties = {}) {
  return {
    textContent: '',
    value: '',
    hidden: false,
    disabled: false,
    required: false,
    attributes: {},
    handlers: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    addEventListener(type, handler) { this.handlers[type] = handler; },
    ...properties
  };
}

async function flush() {
  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));
}

async function harness(fetch, options = {}) {
  const html = await readFile(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  const tokenBootstrap = scripts.find(source => source.includes('__rumosBriefingToken'));
  const pageScript = scripts.find(source => source.includes('esta página deliberadamente não carrega'));
  assert.ok(tokenBootstrap);
  assert.ok(pageScript);

  const presentation = control();
  const logo = control();
  const exactMark = control();
  const button = control({ textContent: 'Enviar briefing' });
  const status = control({ className: 'status' });
  const summary = control();
  const logoLabel = control();
  const form = control({
    hidden: true,
    exact_mark: exactMark,
    elements: { presentation_type: presentation, logo_url: logo },
    reportValidity() { return true; },
    querySelector(selector) {
      assert.equal(selector, 'button');
      return button;
    }
  });
  const elements = { form, status, 'case-summary': summary, logo_label: logoLabel };
  const document = { getElementById(id) { return elements[id] || null; } };
  const href = options.href || 'https://example.com/marcas/briefing/#token=token-seguro';
  const parsedLocation = new URL(href);
  const location = {
    href,
    hash: parsedLocation.hash,
    search: parsedLocation.search,
    pathname: parsedLocation.pathname
  };
  const replacements = [];
  const history = { replaceState(_state, _title, url) { replacements.push(url); } };

  class FakeFormData {
    constructor() {
      this.entries = [['exact_mark', exactMark.value || 'Montanha Cafés']];
    }
    *[Symbol.iterator]() { yield* this.entries; }
    has() { return false; }
  }

  const sandbox = {
    document,
    fetch,
    FormData: FakeFormData,
    history,
    location,
    URL,
    URLSearchParams,
    Object,
    String,
    Error
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(tokenBootstrap, sandbox, { filename: 'marcas/briefing/token-bootstrap.js' });
  vm.runInContext(pageScript, sandbox, { filename: 'marcas/briefing/index.html' });
  await flush();
  return { html, form, presentation, logo, logoLabel, exactMark, button, status, summary, replacements };
}

test('usa o fragmento, limpa a URL e envia o token somente no header', async () => {
  const calls = [];
  const page = await harness(async (url, init) => {
    calls.push({ url, init });
    return response({
      case: { nome: 'Cliente', marca: 'Montanha Cafés', briefing_status: 'pendente' },
      briefing: null
    });
  });

  assert.deepEqual(page.replacements, ['/marcas/briefing/']);
  assert.equal(calls[0].url, '/api/briefing');
  assert.equal(calls[0].url.includes('token'), false);
  assert.equal(calls[0].init.headers['x-briefing-token'], 'token-seguro');
  assert.equal(calls[0].init.referrerPolicy, 'no-referrer');
});

test('migra uma única vez o link legado por query e o limpa antes do fetch', async () => {
  const calls = [];
  const page = await harness(async (url, init) => {
    calls.push({ url, init });
    return response({
      case: { nome: 'Cliente', marca: 'Montanha Cafés', briefing_status: 'pendente' },
      briefing: null
    });
  }, { href: 'https://example.com/marcas/briefing/?token=token-legado' });

  assert.deepEqual(page.replacements, ['/marcas/briefing/']);
  assert.equal(calls[0].url, '/api/briefing');
  assert.equal(calls[0].init.headers['x-briefing-token'], 'token-legado');
});

test('exige o logotipo dinamicamente para marca mista ou figurativa', async () => {
  const page = await harness(async () => response({
    case: { nome: 'Cliente', marca: 'Montanha Cafés', briefing_status: 'pendente' },
    briefing: null
  }));
  page.presentation.value = 'mista';
  page.presentation.handlers.change();
  assert.equal(page.logo.required, true);
  assert.equal(page.logo.attributes['aria-required'], 'true');
  assert.match(page.logoLabel.textContent, /obrigatório/i);
});

test('falha de rede no envio reabilita o botão e exibe mensagem', async () => {
  let calls = 0;
  const page = await harness(async () => {
    calls += 1;
    if (calls === 1) return response({
      case: { nome: 'Cliente', marca: 'Montanha Cafés', briefing_status: 'pendente' },
      briefing: null
    });
    throw new TypeError('network unavailable');
  });

  await page.form.handlers.submit({ preventDefault() {} });
  assert.equal(page.button.disabled, false);
  assert.equal(page.button.textContent, 'Enviar briefing');
  assert.match(page.status.textContent, /Não foi possível enviar/i);
  assert.match(page.status.className, /error/);
});

test('briefing concluído não volta a exibir o formulário', async () => {
  const page = await harness(async () => response({
    case: { briefing_status: 'concluido' }
  }));
  assert.equal(page.form.hidden, true);
  assert.equal(page.summary.textContent, 'Briefing concluído.');
  assert.doesNotMatch(page.summary.textContent, /undefined/);
  assert.match(page.status.textContent, /já foi concluído/i);
});

test('página com token não carrega analytics de terceiros', async () => {
  const html = await readFile(htmlPath, 'utf8');
  assert.doesNotMatch(html, /googletagmanager|connect\.facebook\.net|dataLayer/i);
  assert.match(html, /não transmitir esse token a serviços de terceiros/i);
});
