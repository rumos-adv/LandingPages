import test from 'node:test';
import assert from 'node:assert/strict';
import { generateQueries, normalizeMark, phoneticKey, scoreResult, buildReportDraft } from '../functions/_lib/marcas-analysis.js';

test('normaliza acentos e pontuação', () => assert.equal(normalizeMark(' Montanha Cafés® '), 'montanha cafes'));
test('gera busca exata, aglutinada, invertida e termos dominantes', () => {
  const plan = generateQueries('Montanha Cafés');
  assert.deepEqual(plan.slice(0, 2), [{ type: 'exata', value: 'montanha cafes' }, { type: 'aglutinada', value: 'montanhacafes' }]);
  assert.ok(plan.some(item => item.type === 'ordem_invertida'));
});
test('aproxima grafias foneticamente equivalentes', () => assert.equal(phoneticKey('Pharma'), phoneticKey('Farma')));
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

