import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(process.env.BLOQUEIO_TEST_HTML || new URL('../bloqueio-judicial/index.html', import.meta.url), 'utf8');
const tracking = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].findLast(match => match[1].includes("event: 'page_view_lp'"))[1];
const anchors = [...html.matchAll(/<a\s+([^>]+)>/g)].map(match => Object.fromEntries(
  [...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name, value]) => [name, value]),
));

function boot() {
  const messages = [], shown = [];
  const links = anchors.map(attrs => ({
    attrs, clicks: [],
    getAttribute(name) { return this.attrs[name] ?? null; },
    addEventListener(event, callback) { if (event === 'click') this.clicks.push(callback); },
  }));
  const box = { classList: { add: value => shown.push(value) }, scrollIntoView() {}, focus() {} };
  const document = {
    querySelectorAll(selector) {
      const tag = selector.match(/^[a-z]+/)?.[0];
      const clauses = [...selector.matchAll(/\[([\w-]+)(?:(\^?=)"([^"]*)")?\]/g)];
      if (tag && tag !== 'a') return [];
      return links.filter(link => clauses.every(([, name, operator, value]) => {
        const attribute = link.getAttribute(name);
        return attribute !== null && (!operator || (operator === '^=' ? attribute.startsWith(value) : attribute === value));
      }));
    },
    getElementById(id) { return id === 'form-done' ? box : null; },
  };
  const window = { dataLayer: [], addEventListener(event, callback) { if (event === 'message') messages.push(callback); } };
  vm.runInNewContext(tracking, { window, document, URL });
  return {
    links, shown, events: window.dataLayer,
    click(link) { link.clicks.forEach(callback => callback()); },
    message(origin, value) { messages.forEach(callback => callback({ origin, data: typeof value === 'string' ? value : JSON.stringify(value) })); },
  };
}
const count = (h, event) => h.events.filter(item => item.event === event).length;
const submission = formId => ({ event: 'Tally.FormSubmitted', payload: { formId } });

test('bloqueio: navegação interna mobile não conta como contato', () => {
  const h = boot();
  const mobile = h.links.find(link => (link.attrs['data-nav-source'] || link.attrs['data-wa-source']) === 'hero-mobile');
  assert.equal(mobile.attrs.href, '#situacao');
  h.links.filter(link => link.attrs.href?.startsWith('#')).forEach(link => h.click(link));
  assert.equal(count(h, 'whatsapp_click'), 0);
  assert.equal(count(h, 'lead_submit'), 0);
});

test('bloqueio: os onze links reais de WhatsApp mantêm um evento por clique', () => {
  const h = boot();
  const whatsapp = h.links.filter(link => link.attrs.href?.startsWith('https://wa.me/5519989119770?'));
  assert.equal(whatsapp.length, 11);
  whatsapp.forEach(link => {
    const previous = count(h, 'whatsapp_click');
    h.click(link);
    assert.equal(count(h, 'whatsapp_click'), previous + 1, link.attrs['data-wa-source']);
  });
  assert.equal(count(h, 'lead_submit'), 0);
});

test('bloqueio: origem não confiável, outro formulário e dados inválidos não geram lead nem sucesso', () => {
  const h = boot();
  h.message('https://untrusted.invalid', submission('OQ1EYK'));
  h.message('https://tally.so.untrusted.invalid', submission('OQ1EYK'));
  h.message('https://tally.so', submission('OTHER'));
  h.message('https://tally.so', { event: 'Tally.FormLoaded', payload: { formId: 'OQ1EYK' } });
  h.message('https://tally.so', '{Tally.FormSubmitted invalid JSON');
  assert.equal(count(h, 'lead_submit'), 0);
  assert.deepEqual(h.shown, []);
});

test('bloqueio: envio esperado mantém o lead e a confirmação visual', () => {
  const h = boot();
  h.message('https://tally.so', submission('OQ1EYK'));
  assert.equal(count(h, 'lead_submit'), 1);
  assert.equal(h.events.at(-1).form_id, 'OQ1EYK');
  assert.deepEqual(h.shown, ['is-on']);
});

test('bloqueio: prazo é descrito em dias úteis com ressalva nos dois heroes e na meta', () => {
  const description = html.match(/<meta name="description" content="([^"]+)"/)[1];
  assert(description.length <= 160);
  assert.match(description, /Em regra, são 5 dias úteis após a intimação/);
  assert.match(html, /empresa: em regra, há <strong>5 dias úteis<\/strong>/);
  assert.match(html, /empresa: em regra, há 5 dias úteis/);
  assert(!/\b5 dias(?! úteis)/.test(html));
});

test('bloqueio: atendimento fora do horário comercial tem retorno no próximo dia útil', () => {
  assert.match(html, /hero-m__lead[^>]*>[^<]*Fora desse horário|hero-m__lead[^>]*>[^<]*fora desse horário, retorno no próximo dia útil/);
  assert.match(html, /form-wrap__sub[^>]*>[^<]*Fora desse horário, retorno no próximo dia útil/);
  assert.match(html, /primeira resposta sai no mesmo dia útil para contatos em horário comercial\. Fora desse horário, retorno no próximo dia útil/);
});
