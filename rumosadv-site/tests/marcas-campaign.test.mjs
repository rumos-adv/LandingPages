import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../marcas/index.html', import.meta.url), 'utf8');

test('preserva o hero visual e não o contabiliza como WhatsApp', () => {
  assert.match(html, /hero-marcas-rod\.webp/);
  assert.match(html, /hero-marcas-rod\.png/);
  assert.doesNotMatch(html, /class="hero__visual"[^>]*data-wa-source="hero"/);
  assert.match(html, /a\[data-wa-source\]\[href\^="https:\/\/wa\.me\/5519989119770"\]/);
});

test('mantém a mensagem comercial aprovada e o escopo estadual', () => {
  assert.match(html, /Sem custo na primeira conversa/);
  assert.match(html, /Atendimento online em todo o Estado de São Paulo/);
  assert.match(html, /escritório em Campinas/i);
  assert.match(html, /Busca profissional de anterioridade, com análise jurídica de risco/);
});

test('limita o lead ao iframe e formulário Tally de Marcas', () => {
  assert.match(html, /e\.origin !== 'https:\/\/tally\.so'/);
  assert.match(html, /e\.source !== tallyFrame\.contentWindow/);
  assert.match(html, /p\.payload\.formId !== 'BzRag7'/);
  assert.match(html, /page: 'marcas'/);
});

test('mantém a meta description dentro do limite editorial', () => {
  const description = html.match(/<meta name="description" content="([^"]+)"/i)?.[1];
  assert.ok(description);
  assert.ok(description.length >= 150 && description.length <= 160, `comprimento: ${description.length}`);
});
