import test from 'node:test';
import assert from 'node:assert/strict';
import { generateQueries, normalizeMark, phoneticKey, scoreResult, tokenSetSimilarity, buildReportDraft, buildOperationalMessages, buildPostSaleMessages, buildDeliveryRecord, buildConversionRecord } from '../rumosadv-site/functions/_lib/marcas-analysis.js';

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
test('relatório definitivo incorpora estratégia, contexto e escopo', () => {
  const draft = buildReportDraft({
    mark: 'Montanha Cafés', presentation_type: 'nominativa',
    suggested_classes: ['30'], related_classes: ['43'],
    current_goods_services: 'Café torrado', queries: [{ type: 'exata', value: 'montanha cafes' }]
  }, [{ mark_name: 'Café da Montanha', relevance_level: 'alta' }], { risk_level: 'favoravel_com_ressalvas' });
  assert.deepEqual(draft.protection_strategy.suggested_classes, ['30']);
  assert.equal(draft.business_context.current_goods_services, 'Café torrado');
  assert.equal(draft.search_scope.result_count, 1);
  assert.equal(draft.search_scope.relevant_result_count, 1);
});
test('mensagens operacionais preservam prazo e crédito comercial', () => {
  const messages = buildOperationalMessages({ client: 'Rodrigo Moura', mark: 'Montanha Cafés' });
  assert.match(messages.payment_confirmed, /1 dia útil/);
  assert.match(messages.registration_offer, /R\$ 390/);
  assert.match(messages.registration_offer, /30 dias/);
});
test('pós-venda muda a orientação em casos de risco', () => {
  const favorable = buildPostSaleMessages({ client: 'Rodrigo Moura', mark: 'Montanha Cafés', risk_level: 'favoravel', credit_expires_at: '2026-10-01T15:00:00.000Z' });
  const risky = buildPostSaleMessages({ client: 'Rodrigo Moura', mark: 'Montanha Cafés', risk_level: 'risco_elevado', credit_expires_at: '2026-10-01T15:00:00.000Z' });
  assert.match(favorable.followup_d15, /proposta/);
  assert.match(risky.followup_d15, /antes de pensar em protocolo/);
  assert.match(favorable.followup_d25, /01\/10\/2026/);
  assert.match(favorable.followup_d0, /não garante concessão/);
  assert.match(risky.followup_d0, /não recomendo protocolar/);
  assert.match(risky.followup_d25, /não altera a recomendação técnica/);
  assert.match(risky.close_or_nurture, /atualização da pesquisa/);
});
test('entrega exige referência do PDF e calcula crédito de 30 dias', () => {
  const delivery = buildDeliveryRecord({}, 'relatorio-montanha-cafes-2026-09-01.pdf', new Date('2026-09-01T15:00:00.000Z'));
  assert.equal(delivery.delivered_at, '2026-09-01T15:00:00.000Z');
  assert.equal(delivery.credit_expires_at, '2026-10-01T15:00:00.000Z');
  assert.equal(delivery.report_file, 'relatorio-montanha-cafes-2026-09-01.pdf');
  assert.throws(() => buildDeliveryRecord({}, ''), /referência válida/);
});
test('entrega repetida preserva as datas e a referência originais', () => {
  const current = { delivered_at: '2026-09-01T15:00:00.000Z', credit_expires_at: '2026-10-01T15:00:00.000Z', report_file: 'original.pdf' };
  assert.deepEqual(buildDeliveryRecord(current, 'novo.pdf', new Date('2026-09-10T15:00:00.000Z')), { already_delivered: true, ...current });
});
test('conversão exige entrega e é idempotente', () => {
  assert.throws(() => buildConversionRecord({}), /Registre a entrega/);
  const first = buildConversionRecord({ delivered_at: '2026-09-01T15:00:00.000Z' }, new Date('2026-09-02T15:00:00.000Z'));
  assert.equal(first.registration_converted_at, '2026-09-02T15:00:00.000Z');
  assert.deepEqual(buildConversionRecord({ delivered_at: '2026-09-01T15:00:00.000Z', registration_converted_at: first.registration_converted_at }, new Date('2026-09-12T15:00:00.000Z')), { already_converted: true, registration_converted_at: first.registration_converted_at });
});
