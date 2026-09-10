import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../marcas/index.html', import.meta.url), 'utf8');
const tracking = await readFile(new URL('../assets/js/trademark-intent.js', import.meta.url), 'utf8');

test('preserva o hero visual e não o contabiliza como WhatsApp', () => {
  assert.match(html, /hero-marcas-rod\.webp/);
  assert.match(html, /hero-marcas-rod\.png/);
  assert.doesNotMatch(html, /class="hero__visual"[^>]*data-wa-source="hero"/);
  assert.match(tracking, /a\[data-wa-source\]\[href\^="https:\/\/wa\.me\/5519989119770"\]/);
});

test('mantém a mensagem comercial aprovada e o escopo estadual', () => {
  assert.match(html, /Sem custo na primeira conversa/);
  assert.match(html, /Atendimento online em todo o Estado de São Paulo/);
  assert.match(html, /escritório em Campinas/i);
  assert.match(html, /Busca profissional de anterioridade, com análise jurídica de risco/);
});

test('limita o lead ao iframe e formulário Tally de Marcas', () => {
  assert.match(tracking, /e\.origin !== 'https:\/\/tally\.so'/);
  assert.match(tracking, /e\.source !== tallyFrame\.contentWindow/);
  assert.match(tracking, /payload\.payload\.formId !== FORM_ID/);
  assert.match(tracking, /var PAGE = 'marcas'/);
});

test('instrumenta o Trademark Intent Score e preserva a atribuição', () => {
  for (const event of ['scroll_50', 'scroll_80', 'view_pricing', 'faq_price', 'faq_timeline', 'faq_inpi', 'form_start', 'form_abandon', 'whatsapp_click', 'return_visit']) {
    assert.match(tracking, new RegExp(event));
  }
  for (const parameter of ['gclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content']) {
    assert.match(tracking, new RegExp(parameter));
  }
  assert.match(tracking, /intent_score_update/);
  assert.match(tracking, /alta_intencao/);
  assert.match(tracking, /window\.gtag\('event', eventName, analyticsData\)/);
  assert.match(tracking, /window\.clarity\('set', 'intent_band'/);
  assert.match(html, /src="\/assets\/js\/trademark-intent\.js" defer/);
});

test('mantém a meta description dentro do limite editorial', () => {
  const description = html.match(/<meta name="description" content="([^"]+)"/i)?.[1];
  assert.ok(description);
  assert.ok(description.length >= 150 && description.length <= 160, `comprimento: ${description.length}`);
});
