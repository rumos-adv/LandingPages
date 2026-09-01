import test from 'node:test';
import assert from 'node:assert/strict';
import { generateQueries, normalizeMark, phoneticKey, scoreResult, tokenSetSimilarity, buildReportDraft, buildOperationalMessages } from '../functions/_lib/marcas-analysis.js';

test('normaliza acentos e pontuação', () => assert.equal(normalizeMark(' Montanha Cafés® '), 'montanha cafes'));
test('gera busca exata, aglutinada, invertida e termos dominantes', () => {
  const plan = generateQueries('Montanha Cafés');
  assert.deepEqual(plan.slice(0, 2), [{ type: 'exata', value: 'montanha cafes' }, { type: 'aglutinada', value: 'montanhacafes' }]);
  assert.ok(plan.some(item => item.type === 'ordem_invertida'));
});
test('aproxima grafias foneticamente equivalentes', () => assert.equal(phoneticKey('Pharma'), phoneticKey('Farma')));
test('reconhece os mesmos elementos em ordem invertida, com conectivo e singular/plural', () => {
  assert.equal(tokenSetSimilarity('Montanha Cafés', 'Café da Montanha'), 1);
  assert.equal(scoreResult('Montanha Cafés', 'Café da Montanha', .9).relevance_level, 'alta');
});
test('classifica identidade com afinidade como alta relevância', () => {
  const result = scoreResult('Montanha Cafés', 'Montanha Cafes', 1);
  assert.equal(result.relevance_level, 'alta');
  assert.equal(result.relevance_score, 1);
});
test('minuta exige revisão jurídica', () => {
  const draft = buildReportDraft({ mark: 'Teste' }, [], {});
  assert.equal(draft.legal_review_required, true);
  assert.equal(draft.risk_level, null);
});
test('mensagens operacionais preservam prazo e crédito comercial', () => {
  const messages = buildOperationalMessages({ client: 'Rodrigo Moura', mark: 'Montanha Cafés' });
  assert.match(messages.payment_confirmed, /1 dia útil/);
  assert.match(messages.registration_offer, /R\$ 390/);
  assert.match(messages.registration_offer, /30 dias/);
});
