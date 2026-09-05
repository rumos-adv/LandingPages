import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const htmlPath = new URL('../rumosadv-site/marcas/aceite/index.html', import.meta.url);
const stateKey = 'rumos_marcas_contratacao_v2';
const acceptanceId = '123e4567-e89b-42d3-a456-426614174000';
const attemptId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function jsonResponse(body, status) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return structuredClone(body); }
  };
}

function savedState(id, state, createdAt = Date.now()) {
  return JSON.stringify({ id, createdAt, state });
}

function memoryStorage(initial = {}) {
  const entries = new Map(Object.entries(initial));
  return {
    getItem(key) { return entries.has(key) ? entries.get(key) : null; },
    setItem(key, value) { entries.set(key, String(value)); },
    removeItem(key) { entries.delete(key); }
  };
}

function control(properties = {}) {
  return {
    disabled: false,
    hidden: false,
    textContent: '',
    handlers: {},
    focused: false,
    addEventListener(type, handler) { this.handlers[type] = handler; },
    focus() { this.focused = true; },
    ...properties
  };
}

async function pageHarness({ fetch: applicationFetch, local = {}, session = {}, turnstile = 'auto', configStatus = 200 }) {
  const html = await readFile(htmlPath, 'utf8');
  const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  const script = scripts.find(source => source.includes("const STORAGE_KEY='rumos_marcas_contratacao_v2'"));
  assert.ok(script, 'script público de aceite e checkout deve existir');

  const submitButton = control({ textContent: 'Contratar análise — R$ 390' });
  const retryButton = control({ hidden: true, textContent: 'Verificar e retomar' });
  const newContractButton = control({ hidden: true, textContent: 'Iniciar nova contratação' });
  const fields = {
    nome: control({ value: 'Cliente Teste' }),
    cpf_cnpj: control({ value: '12345678901' }),
    email: control({ value: 'cliente@example.com' }),
    whatsapp: control({ value: '19999999999' }),
    marca: control({ value: 'Montanha Cafés' })
  };
  const consent = control({ checked: true });
  const status = control({ className: 'status' });
  const turnstileBox = control({ hidden: false });
  const turnstileStatus = control({ className: 'turnstile-note' });
  const term = control({ dataset: { version: '1.0', sha256: 'a'.repeat(64) } });
  const form = control({
    ...fields,
    resetCalled: false,
    querySelector(selector) {
      assert.equal(selector, 'button[type="submit"]');
      return submitButton;
    },
    querySelectorAll(selector) {
      assert.equal(selector, 'input,button[type="submit"]');
      return [...Object.values(fields), consent, submitButton];
    },
    reset() {
      this.resetCalled = true;
      Object.values(fields).forEach(field => { field.value = ''; });
      consent.checked = false;
    }
  });
  const elements = {
    'accept-form': form,
    'form-status': status,
    'turnstile-box': turnstileBox,
    'turnstile-widget': control(),
    'turnstile-status': turnstileStatus,
    'term-text': term,
    'retry-checkout': retryButton,
    'new-contract': newContractButton,
    consent
  };
  const localStorage = memoryStorage(local);
  const sessionStorage = memoryStorage(session);
  const assigned = [];
  const dataLayer = [];
  const turnstileRenders = [];
  let resetCount = 0;
  let appendedScripts = 0;
  let window;
  const turnstileApi = {
    render(selector, options) {
      assert.equal(selector, '#turnstile-widget');
      turnstileRenders.push(options);
      if (turnstile === 'auto') queueMicrotask(() => options.callback(`turnstile-token-${turnstileRenders.length}-${resetCount}`));
      return 'widget-1';
    },
    reset(widgetId) {
      assert.equal(widgetId, 'widget-1');
      resetCount += 1;
      if (turnstile === 'auto') queueMicrotask(() => turnstileRenders.at(-1).callback(`turnstile-token-reset-${resetCount}`));
    }
  };
  const document = {
    head: {
      appendChild(script) {
        appendedScripts += 1;
        if (turnstile === 'script-error') {
          queueMicrotask(() => script.onerror());
        } else {
          window.turnstile = turnstileApi;
          queueMicrotask(() => script.onload());
        }
      }
    },
    createElement(tag) {
      assert.equal(tag, 'script');
      return control({ src: '', async: false, defer: false, onload: null, onerror: null });
    },
    getElementById(id) { return elements[id] || null; }
  };
  window = {
    dataLayer,
    localStorage,
    sessionStorage,
    location: { assign(url) { assigned.push(url); } },
    addEventListener() {},
    RumosMarketing: { track(event) { dataLayer.push(event); return true; } }
  };

  const routedFetch = async (url, options = {}) => {
    if (url === '/api/turnstile/config') {
      if (configStatus !== 200) return jsonResponse({ error: 'indisponível' }, configStatus);
      return jsonResponse({ sitekey: 'site-key-publica', action: 'marcas_aceite' }, 200);
    }
    return applicationFetch(url, options);
  };

  vm.runInNewContext(script, {
    window,
    document,
    fetch: routedFetch,
    crypto: webcrypto,
    TextEncoder,
    Uint8Array,
    URL,
    JSON,
    String,
    Array,
    Error
  }, { filename: 'marcas/aceite/index.html' });

  await new Promise(resolve => setTimeout(resolve, 0));
  await new Promise(resolve => setTimeout(resolve, 0));

  return {
    html, form, fields, consent, status, submitButton, retryButton, newContractButton,
    turnstileBox, turnstileStatus, localStorage, sessionStorage, assigned, window,
    turnstileRenders, appendedScripts,
    get resetCount() { return resetCount; },
    solve(token = 'turnstile-token-manual') {
      assert.ok(turnstileRenders.length);
      turnstileRenders.at(-1).callback(token);
    },
    expire() {
      assert.ok(turnstileRenders.length);
      turnstileRenders.at(-1)['expired-callback']();
    }
  };
}

test('201 cria aceite e checkout em sequência com idempotência, estado mínimo e analytics sem IDs internos', async () => {
  const calls = [];
  const page = await pageHarness({
    async fetch(url, options) {
      const body = JSON.parse(options.body);
      calls.push({ url, body });
      if (url === '/api/aceites') return jsonResponse({ ok: true, id: acceptanceId }, 201);
      return jsonResponse({
        checkout_id: 'chk-new',
        checkout_url: 'https://sandbox.asaas.com/checkoutSession/show/chk-new'
      }, 201);
    }
  });

  await page.form.handlers.submit({ preventDefault() {} });

  assert.deepEqual(calls.map(call => call.url), ['/api/aceites', '/api/checkout']);
  assert.match(calls[0].body.idempotency_key, /^[0-9a-f-]{36}$/i);
  assert.match(calls[0].body.turnstile_token, /^turnstile-token-/);
  assert.deepEqual(calls[1].body, { aceite_id: acceptanceId });
  assert.equal('email' in calls[1].body, false);
  const stored = JSON.parse(page.localStorage.getItem(stateKey));
  assert.deepEqual(Object.keys(stored).sort(), ['createdAt', 'id', 'state']);
  assert.equal(stored.id, acceptanceId);
  assert.equal(stored.state, 'accepted');
  assert.equal(JSON.stringify(stored).includes('cliente@example.com'), false);
  assert.equal(JSON.stringify(stored).includes('turnstile-token'), false);
  assert.deepEqual(page.assigned, ['https://sandbox.asaas.com/checkoutSession/show/chk-new']);

  const acceptanceEvent = page.window.dataLayer.find(item => item.event === 'analise_viabilidade_aceite');
  const beginEvent = page.window.dataLayer.find(item => item.event === 'begin_checkout');
  assert.equal('event_id' in acceptanceEvent, false);
  assert.equal('aceite_id' in acceptanceEvent, false);
  assert.equal('event_id' in beginEvent, false);
  assert.equal('aceite_id' in beginEvent, false);
  assert.equal('checkout_id' in beginEvent, false);
  assert.equal(beginEvent.value, 390);
  assert.equal(beginEvent.currency, 'BRL');
});

test('respostas 200 reused usam eventos de retomada e nunca eventos de criação', async () => {
  const page = await pageHarness({
    async fetch(url) {
      if (url === '/api/aceites') return jsonResponse({ ok: true, reused: true, id: acceptanceId }, 200);
      return jsonResponse({
        reused: true,
        checkout_id: 'chk-existing',
        checkout_url: 'https://asaas.com/checkoutSession/show/chk-existing'
      }, 200);
    }
  });

  await page.form.handlers.submit({ preventDefault() {} });

  const events = page.window.dataLayer.map(item => item.event);
  assert.ok(events.includes('analise_viabilidade_aceite_retomado'));
  assert.ok(events.includes('analise_viabilidade_checkout_retomado'));
  assert.equal(events.includes('analise_viabilidade_aceite'), false);
  assert.equal(events.includes('begin_checkout'), false);
  assert.equal(events.includes('asaas_checkout_created'), false);
  for (const event of page.window.dataLayer.filter(item => item.event.includes('retomado'))) {
    assert.equal('event_id' in event, false);
    assert.equal('aceite_id' in event, false);
    assert.equal('checkout_id' in event, false);
  }
});

test('resposta ambígua preserva a tentativa e repete o POST com a mesma chave', async () => {
  const acceptanceBodies = [];
  let acceptanceAttempts = 0;
  const page = await pageHarness({
    async fetch(url, options) {
      const body = JSON.parse(options.body);
      if (url === '/api/checkout') {
        return jsonResponse({ reused: true, checkout_id: 'chk-recovered', checkout_url: 'https://www.asaas.com/checkoutSession/show/chk-recovered' }, 200);
      }
      acceptanceBodies.push(body);
      acceptanceAttempts += 1;
      if (acceptanceAttempts === 1) throw new TypeError('resposta perdida');
      return jsonResponse({ ok: true, reused: true, id: acceptanceId }, 200);
    }
  });

  await page.form.handlers.submit({ preventDefault() {} });
  const pending = JSON.parse(page.localStorage.getItem(stateKey));
  assert.equal(pending.state, 'attempt');
  assert.equal(page.retryButton.hidden, false);
  assert.equal(page.newContractButton.hidden, true);
  assert.equal(page.newContractButton.disabled, true);
  assert.ok(Object.values(page.fields).every(field => field.disabled));
  assert.match(page.status.textContent, /tentativa foi preservada/i);

  await page.retryButton.handlers.click();

  assert.equal(acceptanceBodies.length, 2);
  assert.equal(acceptanceBodies[0].idempotency_key, acceptanceBodies[1].idempotency_key);
  assert.equal(acceptanceBodies[1].email, 'cliente@example.com');
  assert.deepEqual(page.assigned, ['https://www.asaas.com/checkoutSession/show/chk-recovered']);
});

test('tentativa recente após recarga libera preenchimento e reutiliza a chave salva', async () => {
  const bodies = [];
  const page = await pageHarness({
    local: { [stateKey]: savedState(attemptId, 'attempt') },
    async fetch(url, options) {
      bodies.push({ url, body: JSON.parse(options.body) });
      if (url === '/api/aceites') return jsonResponse({ ok: true, reused: true, id: acceptanceId }, 200);
      return jsonResponse({ reused: true, checkout_id: 'chk-reload', checkout_url: 'https://sandbox.asaas.com/c/chk-reload' }, 200);
    }
  });

  assert.ok(Object.values(page.fields).every(field => !field.disabled));
  assert.equal(page.retryButton.hidden, true);
  assert.equal(page.newContractButton.hidden, true);
  assert.equal(page.newContractButton.disabled, true);
  assert.match(page.submitButton.textContent, /verificar e retomar/i);

  await page.form.handlers.submit({ preventDefault() {} });

  assert.equal(bodies[0].url, '/api/aceites');
  assert.equal(bodies[0].body.idempotency_key, attemptId);
  assert.equal(bodies.filter(call => call.url === '/api/aceites').length, 1);
});

test('estado expira após duas horas e não bloqueia uma nova contratação', async () => {
  const expiredAt = Date.now() - (2 * 60 * 60 * 1000) - 1;
  const page = await pageHarness({
    session: { [stateKey]: savedState(acceptanceId, 'accepted', expiredAt) },
    local: { [stateKey]: savedState(acceptanceId, 'accepted', expiredAt) },
    async fetch() { throw new Error('não deve executar durante a carga'); }
  });

  assert.equal(page.sessionStorage.getItem(stateKey), null);
  assert.equal(page.localStorage.getItem(stateKey), null);
  assert.ok(Object.values(page.fields).every(field => !field.disabled));
  assert.equal(page.retryButton.hidden, true);
  assert.equal(page.newContractButton.hidden, true);
});

test('Iniciar nova contratação só é liberado após 404 e limpa estado, formulário e bloqueios', async () => {
  const page = await pageHarness({
    session: { [stateKey]: savedState(acceptanceId, 'accepted') },
    async fetch() { return jsonResponse({ error: 'Aceite não encontrado.' }, 404); }
  });

  assert.equal(page.newContractButton.hidden, true);
  assert.ok(Object.values(page.fields).every(field => field.disabled));
  await page.retryButton.handlers.click();
  assert.equal(page.newContractButton.hidden, false);
  await page.newContractButton.handlers.click();

  assert.equal(page.sessionStorage.getItem(stateKey), null);
  assert.equal(page.localStorage.getItem(stateKey), null);
  assert.equal(page.form.resetCalled, true);
  assert.ok(Object.values(page.fields).every(field => !field.disabled && field.value === ''));
  assert.equal(page.consent.checked, false);
  assert.equal(page.fields.nome.focused, true);
  assert.equal(page.newContractButton.hidden, true);
});

test('404 do checkout limpa o aceite pendente e libera o formulário', async () => {
  const page = await pageHarness({
    local: { [stateKey]: savedState(acceptanceId, 'accepted') },
    async fetch() { return jsonResponse({ error: 'Aceite não encontrado.' }, 404); }
  });

  await page.retryButton.handlers.click();

  assert.equal(page.localStorage.getItem(stateKey), null);
  assert.equal(page.sessionStorage.getItem(stateKey), null);
  assert.ok(Object.values(page.fields).every(field => !field.disabled));
  assert.equal(page.retryButton.hidden, true);
  assert.equal(page.newContractButton.hidden, false);
  assert.deepEqual(page.assigned, []);
  assert.match(page.status.textContent, /formulário foi liberado/i);
});

test('checkout recusa HTTP e domínio parecido, aceitando apenas HTTPS oficial do Asaas', async t => {
  for (const badUrl of [
    'http://sandbox.asaas.com/checkoutSession/show/x',
    'https://asaas.com.evil.test/checkoutSession/show/x',
    'javascript:alert(1)'
  ]) {
    await t.test(`recusa ${badUrl}`, async () => {
      const page = await pageHarness({
        local: { [stateKey]: savedState(acceptanceId, 'accepted') },
        async fetch() { return jsonResponse({ checkout_id: 'chk-bad', checkout_url: badUrl }, 200); }
      });
      await page.retryButton.handlers.click();
      assert.deepEqual(page.assigned, []);
      assert.equal(page.retryButton.hidden, false);
      assert.equal(page.newContractButton.hidden, true);
      assert.equal(page.newContractButton.disabled, true);
      assert.match(page.status.textContent, /endereço de pagamento recebido não é válido/i);
    });
  }
});

test('termo atualizado limpa a tentativa e exige recarga sem liberar nova contratação', async () => {
  const page = await pageHarness({
    async fetch() {
      return jsonResponse({
        error: 'O termo de contratação foi atualizado. Recarregue a página para continuar.',
        code: 'TERM_UPDATED'
      }, 409);
    }
  });

  await page.form.handlers.submit({ preventDefault() {} });

  assert.equal(page.localStorage.getItem(stateKey), null);
  assert.equal(page.sessionStorage.getItem(stateKey), null);
  assert.equal(page.retryButton.hidden, true);
  assert.equal(page.newContractButton.hidden, true);
  assert.equal(page.newContractButton.disabled, true);
  assert.match(page.submitButton.textContent, /recarregue/i);
  assert.match(page.status.textContent, /atualize esta página/i);
});

test('colisão idempotente comprovada permite iniciar um fluxo realmente novo', async () => {
  const page = await pageHarness({
    async fetch() {
      return jsonResponse({
        error: 'Não foi possível confirmar esta solicitação. Inicie uma nova contratação.',
        code: 'IDEMPOTENCY_CONFLICT'
      }, 409);
    }
  });

  await page.form.handlers.submit({ preventDefault() {} });

  assert.equal(page.newContractButton.hidden, false);
  assert.equal(page.retryButton.hidden, true);
  assert.match(page.status.textContent, /iniciar nova contratação/i);

  const rendersBefore = page.turnstileRenders.length;
  const resetsBefore = page.resetCount;
  await page.newContractButton.handlers.click();
  assert.equal(page.turnstileRenders.length, rendersBefore);
  assert.equal(page.resetCount, resetsBefore + 1);
});

test('409 de aceite pago encerra a cobrança sem liberar contratação duplicada', async () => {
  const page = await pageHarness({
    local: { [stateKey]: savedState(acceptanceId, 'accepted') },
    async fetch() { return jsonResponse({ error: 'Pagamento confirmado.', paid: true }, 409); }
  });

  await page.retryButton.handlers.click();

  assert.equal(page.localStorage.getItem(stateKey), null);
  assert.equal(page.retryButton.hidden, true);
  assert.equal(page.newContractButton.hidden, true);
  assert.deepEqual(page.assigned, []);
  const event = page.window.dataLayer.find(item => item.event === 'analise_viabilidade_pagamento_confirmado');
  assert.equal('event_id' in event, false);
  assert.equal('aceite_id' in event, false);
});

test('o formulário mantém o ID estável usado por rastreamento e integrações externas', async () => {
  const page = await pageHarness({ async fetch() { throw new Error('não deve executar'); } });
  assert.match(page.html, /id="accept-form"/);
});

test('sem configuração Turnstile o botão permanece bloqueado e nenhum aceite é enviado', async () => {
  let applicationCalls = 0;
  const page = await pageHarness({
    configStatus: 503,
    async fetch() { applicationCalls += 1; throw new Error('não deve enviar'); }
  });

  assert.equal(page.submitButton.disabled, true);
  assert.equal(page.appendedScripts, 0);
  assert.match(page.turnstileStatus.textContent, /indisponível/i);
  await page.form.handlers.submit({ preventDefault() {} });
  assert.equal(applicationCalls, 0);
});

test('token libera o envio, segue apenas no corpo da requisição e nunca no estado persistido', async () => {
  const bodies = [];
  const page = await pageHarness({
    turnstile: 'manual',
    async fetch(url, options) {
      bodies.push(JSON.parse(options.body));
      if (url === '/api/aceites') return jsonResponse({ ok: true, id: acceptanceId }, 201);
      return jsonResponse({ checkout_id: 'chk-secure', checkout_url: 'https://asaas.com/checkoutSession/show/chk-secure' }, 201);
    }
  });

  assert.equal(page.submitButton.disabled, true);
  page.solve('token-efemero-manual');
  assert.equal(page.submitButton.disabled, false);
  await page.form.handlers.submit({ preventDefault() {} });

  assert.equal(bodies[0].turnstile_token, 'token-efemero-manual');
  assert.equal(String(page.localStorage.getItem(stateKey)).includes('token-efemero-manual'), false);
  assert.equal(String(page.sessionStorage.getItem(stateKey)).includes('token-efemero-manual'), false);
});

test('falha do aceite reseta o desafio e retenta com nova prova e a mesma chave idempotente', async () => {
  const acceptanceBodies = [];
  const page = await pageHarness({
    turnstile: 'manual',
    async fetch(url, options) {
      const body = JSON.parse(options.body);
      if (url === '/api/checkout') return jsonResponse({ checkout_id: 'chk-retry', checkout_url: 'https://asaas.com/checkoutSession/show/chk-retry' }, 201);
      acceptanceBodies.push(body);
      if (acceptanceBodies.length === 1) {
        return jsonResponse({ error: 'Faça uma nova verificação.', code: 'TURNSTILE_INVALID' }, 400);
      }
      return jsonResponse({ ok: true, reused: true, id: acceptanceId }, 200);
    }
  });

  page.solve('token-primeiro');
  await page.form.handlers.submit({ preventDefault() {} });
  assert.equal(page.resetCount, 1);
  assert.equal(page.submitButton.disabled, true);

  page.solve('token-segundo');
  await page.form.handlers.submit({ preventDefault() {} });
  assert.equal(acceptanceBodies.length, 2);
  assert.equal(acceptanceBodies[0].idempotency_key, acceptanceBodies[1].idempotency_key);
  assert.notEqual(acceptanceBodies[0].turnstile_token, acceptanceBodies[1].turnstile_token);
  assert.equal(page.resetCount, 1);
});

test('indisponibilidade transitória preserva a tentativa e reseta o desafio exatamente uma vez', async () => {
  const acceptanceBodies = [];
  const page = await pageHarness({
    turnstile: 'manual',
    async fetch(url, options) {
      assert.equal(url, '/api/aceites');
      acceptanceBodies.push(JSON.parse(options.body));
      return jsonResponse({
        error: 'A verificação de segurança está temporariamente indisponível. Tente novamente.',
        code: 'TURNSTILE_UNAVAILABLE',
        diagnostic: {
          reason: 'siteverify_http_error',
          attempts: 1,
          http_status: 400,
          error_name: 'TypeError',
          error_message: 'Falha de conexão'
        }
      }, 503);
    }
  });

  page.solve('token-transitorio');
  await page.form.handlers.submit({ preventDefault() {} });

  assert.equal(acceptanceBodies.length, 1);
  assert.equal(page.resetCount, 1);
  assert.equal(page.retryButton.hidden, false);
  assert.equal(page.retryButton.disabled, true);
  assert.match(page.status.textContent, /tentativa foi preservada/i);
  assert.match(page.status.textContent, /diagnóstico Preview: motivo siteverify_http_error, tentativas 1, HTTP 400/i);
  assert.match(page.status.textContent, /erro TypeError, detalhe Falha de conexão/i);
  const pending = JSON.parse(page.localStorage.getItem(stateKey));
  assert.equal(pending.state, 'attempt');
  assert.equal(pending.id, acceptanceBodies[0].idempotency_key);
});

test('expiração do desafio limpa o token e volta a bloquear a contratação', async () => {
  const page = await pageHarness({ turnstile: 'manual', async fetch() { throw new Error('não deve enviar'); } });
  page.solve('token-que-expira');
  assert.equal(page.submitButton.disabled, false);
  page.expire();
  assert.equal(page.submitButton.disabled, true);
  assert.match(page.turnstileStatus.textContent, /expirou/i);
});

test('retomada de aceite já criado ignora Turnstile e não consulta sua configuração', async () => {
  const urls = [];
  const page = await pageHarness({
    configStatus: 503,
    local: { [stateKey]: savedState(acceptanceId, 'accepted') },
    async fetch(url) {
      urls.push(url);
      return jsonResponse({ reused: true, checkout_id: 'chk-resume', checkout_url: 'https://asaas.com/checkoutSession/show/chk-resume' }, 200);
    }
  });

  assert.equal(page.turnstileBox.hidden, true);
  assert.equal(page.appendedScripts, 0);
  await page.retryButton.handlers.click();
  assert.deepEqual(urls, ['/api/checkout']);
  assert.deepEqual(page.assigned, ['https://asaas.com/checkoutSession/show/chk-resume']);
});
