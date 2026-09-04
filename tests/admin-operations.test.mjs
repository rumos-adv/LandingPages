import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { onRequestGet, onRequestPost } from '../rumosadv-site/functions/api/admin/analises.js';

let DatabaseSync = null;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch {
  // A suíte restante continua disponível em versões antigas do Node.
}

const ADMIN_TOKEN = 'admin-test-token';
const SIGNING_SECRET = 'segredo-de-teste-com-tamanho-adequado';
const CREATED_AT = '2026-09-01T12:00:00.000Z';

function changes(count) {
  return { meta: { changes: Number(count) }, results: [] };
}

async function hashText(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function createDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of [
    '../migrations/0001_aceites.sql',
    '../migrations/0002_asaas_checkout.sql',
    '../migrations/0003_analise_v1.sql',
    '../migrations/0004_asaas_checkout_history.sql',
    '../migrations/0005_marca_operational_events.sql',
    '../migrations/0006_marca_search_completion.sql',
    '../migrations/0008_marca_report_delivery_integrity.sql'
  ]) {
    sqlite.exec(readFileSync(new URL(file, import.meta.url), 'utf8'));
  }

  class Statement {
    constructor(sql) {
      this.sql = sql;
      this.values = [];
    }
    bind(...values) {
      this.values = values;
      return this;
    }
    async first() {
      return sqlite.prepare(this.sql).get(...this.values) || null;
    }
    async all() {
      return { results: sqlite.prepare(this.sql).all(...this.values) };
    }
    async run() {
      return changes(sqlite.prepare(this.sql).run(...this.values).changes);
    }
  }

  const db = {
    prepare(sql) {
      return new Statement(sql);
    },
    async batch(statements) {
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(statement => changes(
          sqlite.prepare(statement.sql).run(...statement.values).changes
        ));
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
  return { sqlite, db };
}

function addAcceptance(sqlite, overrides = {}) {
  const row = {
    id: 'case-1',
    nome: 'Cliente Sigiloso',
    email: 'cliente@example.test',
    whatsapp: '19999999999',
    marca: 'Montanha Cafés',
    status: 'pago',
    payment_status: 'PAID',
    paid_at: CREATED_AT,
    briefing_status: 'concluido',
    analysis_status: 'aguardando_material',
    analysis_due_at: null,
    ...overrides
  };
  sqlite.prepare(`INSERT INTO aceites (
    id, created_at, nome, cpf_cnpj, email, whatsapp, marca,
    term_version, term_hash, status, payment_status, paid_at,
    briefing_status, analysis_status, analysis_due_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    row.id, CREATED_AT, row.nome, '12345678909', row.email, row.whatsapp,
    row.marca, 'v1', 'hash', row.status, row.payment_status, row.paid_at,
    row.briefing_status, row.analysis_status, row.analysis_due_at
  );
  return row;
}

function addBriefing(sqlite, caseId, presentationType, logoUrl, status = 'concluido') {
  sqlite.prepare(`INSERT INTO marca_briefings (
    id, aceite_id, created_at, updated_at, completed_at, status,
    exact_mark, presentation_type, current_goods_services, market_scope,
    intended_owner_type, logo_url, information_confirmed,
    temporal_search_ack, data_use_authorized
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1)`).run(
    `briefing-${caseId}`, caseId, CREATED_AT, CREATED_AT, CREATED_AT, status,
    'Montanha Cafés', presentationType, 'Café torrado', 'brasil',
    'pessoa_juridica', logoUrl
  );
}

function addPlan(sqlite, caseId, needsVienna = 0) {
  sqlite.prepare(`INSERT INTO marca_search_plans (
    id, aceite_id, created_at, updated_at, engine_version,
    normalized_mark, queries_json, needs_vienna, status
  ) VALUES (?, ?, ?, ?, ?, ?, '[{"type":"exata","value":"montanha cafes"}]', ?, 'gerado')`).run(
    `plan-${caseId}`, caseId, CREATED_AT, CREATED_AT, 'test', 'montanha cafes', needsVienna
  );
}

function context(db, method, body, env = {}) {
  return {
    request: new Request('https://rumos.example/api/admin/analises', {
      method,
      headers: {
        authorization: `Bearer ${ADMIN_TOKEN}`,
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    }),
    env: {
      ACEITES_DB: db,
      ANALYSIS_ADMIN_TOKEN: ADMIN_TOKEN,
      BRIEFING_SIGNING_SECRET: SIGNING_SECRET,
      ANALYSIS_TIME_ZONE: 'America/Sao_Paulo',
      ...env
    }
  };
}

test('confirma material visual uma única vez e preserva o prazo na repetição', {
  skip: DatabaseSync ? false : 'node:sqlite indisponível neste runtime'
}, async () => {
  const { sqlite, db } = createDatabase();
  addAcceptance(sqlite);
  addBriefing(sqlite, 'case-1', 'mista', 'https://example.test/logo.png');

  const first = await onRequestPost(context(db, 'POST', {
    action: 'confirm_material', aceite_id: 'case-1'
  }));
  const firstBody = await first.json();
  assert.equal(first.status, 200);
  assert.equal(firstBody.already_confirmed, false);
  assert.match(firstBody.analysis_due_at, /^\d{4}-\d{2}-\d{2}T/);
  const stored = sqlite.prepare('SELECT analysis_status, analysis_due_at FROM aceites WHERE id=?').get('case-1');
  assert.equal(stored.analysis_status, 'pesquisando');
  assert.equal(stored.analysis_due_at, firstBody.analysis_due_at);

  const repeated = await onRequestPost(context(db, 'POST', {
    action: 'confirm_material', aceite_id: 'case-1'
  }));
  const repeatedBody = await repeated.json();
  assert.equal(repeated.status, 200);
  assert.equal(repeatedBody.already_confirmed, true);
  assert.equal(repeatedBody.analysis_due_at, firstBody.analysis_due_at);
  sqlite.close();
});

test('não inicia prazo para apresentação indefinida nem para material sem URL válida', {
  skip: DatabaseSync ? false : 'node:sqlite indisponível neste runtime'
}, async () => {
  for (const [presentation, logo, expected] of [
    ['indefinida', null, /Defina primeiro/i],
    ['figurativa', 'arquivo-local.png', /link válido/i],
    ['figurativa', 'http://example.test/logo.png', /link válido/i]
  ]) {
    const { sqlite, db } = createDatabase();
    addAcceptance(sqlite, { analysis_status: presentation === 'indefinida' ? 'aguardando_definicao' : 'aguardando_material' });
    addBriefing(sqlite, 'case-1', presentation, logo);
    const response = await onRequestPost(context(db, 'POST', {
      action: 'confirm_material', aceite_id: 'case-1'
    }));
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, expected);
    assert.equal(sqlite.prepare('SELECT analysis_due_at FROM aceites WHERE id=?').get('case-1').analysis_due_at, null);
    sqlite.close();
  }
});

test('resolve apresentação indefinida com trilha auditável e fluxo adequado à modalidade', {
  skip: DatabaseSync ? false : 'node:sqlite indisponível neste runtime'
}, async () => {
  {
    const { sqlite, db } = createDatabase();
    addAcceptance(sqlite, { analysis_status: 'aguardando_definicao' });
    addBriefing(sqlite, 'case-1', 'indefinida', null);
    addPlan(sqlite, 'case-1');
    const response = await onRequestPost(context(db, 'POST', {
      action: 'resolve_presentation', aceite_id: 'case-1', presentation_type: 'nominativa'
    }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.already_resolved, false);
    assert.equal(body.analysis_status, 'pesquisando');
    assert.match(body.analysis_due_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(sqlite.prepare('SELECT presentation_type FROM marca_briefings WHERE aceite_id=?').get('case-1').presentation_type, 'nominativa');
    assert.equal(sqlite.prepare('SELECT needs_vienna FROM marca_search_plans WHERE aceite_id=?').get('case-1').needs_vienna, 0);
    const audit = sqlite.prepare('SELECT * FROM marca_operational_events WHERE aceite_id=?').get('case-1');
    assert.equal(audit.event_type, 'PRESENTATION_RESOLVED');
    assert.equal(audit.previous_presentation_type, 'indefinida');
    assert.equal(audit.new_presentation_type, 'nominativa');

    const repeated = await onRequestPost(context(db, 'POST', {
      action: 'resolve_presentation', aceite_id: 'case-1', presentation_type: 'nominativa'
    }));
    assert.equal((await repeated.json()).already_resolved, true);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM marca_operational_events').get().count, 1);
    sqlite.close();
  }

  {
    const { sqlite, db } = createDatabase();
    addAcceptance(sqlite, { analysis_status: 'aguardando_definicao' });
    addBriefing(sqlite, 'case-1', 'indefinida', null);
    addPlan(sqlite, 'case-1');
    const missingLogo = await onRequestPost(context(db, 'POST', {
      action: 'resolve_presentation', aceite_id: 'case-1', presentation_type: 'mista'
    }));
    assert.equal(missingLogo.status, 400);

    const response = await onRequestPost(context(db, 'POST', {
      action: 'resolve_presentation', aceite_id: 'case-1', presentation_type: 'mista',
      logo_url: 'https://example.test/logo.svg'
    }));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.analysis_status, 'aguardando_material');
    assert.equal(body.analysis_due_at, null);
    const stored = sqlite.prepare('SELECT presentation_type, logo_url FROM marca_briefings WHERE aceite_id=?').get('case-1');
    assert.equal(stored.presentation_type, 'mista');
    assert.equal(stored.logo_url, 'https://example.test/logo.svg');
    assert.equal(sqlite.prepare('SELECT needs_vienna FROM marca_search_plans WHERE aceite_id=?').get('case-1').needs_vienna, 1);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM marca_operational_events').get().count, 1);
    sqlite.close();
  }
});

test('entrega e conversão concorrentes preservam o primeiro registro canônico', {
  skip: DatabaseSync ? false : 'node:sqlite indisponível neste runtime'
}, async () => {
  const { sqlite, db } = createDatabase();
  addAcceptance(sqlite, {
    analysis_status: 'em_revisao',
    analysis_due_at: '2026-09-02T12:00:00.000Z'
  });
  const reportJson = '{"case":{"mark":"Montanha Cafés"}}';
  const reportSha256 = await hashText(reportJson);
  sqlite.prepare(`INSERT INTO marca_reviews (
    id, aceite_id, created_at, updated_at, cutoff_at, executive_summary,
    recommendation, report_json, report_sha256, approved, reviewed_by
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`).run(
    'review-1', 'case-1', CREATED_AT, CREATED_AT, CREATED_AT,
    'Síntese revisada.', 'Prosseguir conforme a estratégia indicada.', reportJson,
    reportSha256, 'Dr. Revisor'
  );
  addPlan(sqlite, 'case-1');
  sqlite.prepare(`UPDATE marca_search_plans SET status='pesquisa_concluida',
    search_completed_at=?, search_cutoff_at=?, search_completed_by=?,
    search_coverage_json=? WHERE aceite_id=?`).run(
    CREATED_AT, CREATED_AT, 'Pesquisador',
    '{"source":"INPI","queries":[{"type":"exata","value":"montanha cafes"}],"result_count":0,"no_results_found":true}',
    'case-1'
  );

  const deliveries = await Promise.all([
    onRequestPost(context(db, 'POST', { action: 'mark_delivered', aceite_id: 'case-1', report_file: 'relatorio-a.pdf', report_sha256: reportSha256, review_updated_at: CREATED_AT })),
    onRequestPost(context(db, 'POST', { action: 'mark_delivered', aceite_id: 'case-1', report_file: 'relatorio-b.pdf', report_sha256: reportSha256, review_updated_at: CREATED_AT }))
  ]);
  const deliveryBodies = await Promise.all(deliveries.map(response => response.json()));
  assert.deepEqual(deliveries.map(response => response.status), [200, 200]);
  assert.deepEqual(deliveryBodies.map(body => body.already_delivered).sort(), [false, true]);
  const storedDelivery = sqlite.prepare('SELECT delivered_at, credit_expires_at, report_file, delivered_report_sha256, delivered_review_updated_at FROM aceites WHERE id=?').get('case-1');
  assert.ok(storedDelivery.delivered_at);
  assert.ok(storedDelivery.credit_expires_at);
  assert.equal(deliveryBodies[0].delivered_at, deliveryBodies[1].delivered_at);
  assert.equal(deliveryBodies[0].report_file, deliveryBodies[1].report_file);
  assert.equal(storedDelivery.report_file, deliveryBodies[0].report_file);
  assert.equal(storedDelivery.delivered_report_sha256, reportSha256);
  assert.equal(storedDelivery.delivered_review_updated_at, CREATED_AT);

  const conversions = await Promise.all([
    onRequestPost(context(db, 'POST', { action: 'mark_converted', aceite_id: 'case-1' })),
    onRequestPost(context(db, 'POST', { action: 'mark_converted', aceite_id: 'case-1' }))
  ]);
  const conversionBodies = await Promise.all(conversions.map(response => response.json()));
  assert.deepEqual(conversions.map(response => response.status), [200, 200]);
  assert.deepEqual(conversionBodies.map(body => body.already_converted).sort(), [false, true]);
  assert.equal(conversionBodies[0].registration_converted_at, conversionBodies[1].registration_converted_at);
  assert.equal(
    sqlite.prepare('SELECT registration_converted_at FROM aceites WHERE id=?').get('case-1').registration_converted_at,
    conversionBodies[0].registration_converted_at
  );
  sqlite.close();
});

test('aprovação exige fluxo completo e revisão entregue fica imutável', {
  skip: DatabaseSync ? false : 'node:sqlite indisponível neste runtime'
}, async () => {
  const { sqlite, db } = createDatabase();
  addAcceptance(sqlite, {
    analysis_status: 'pesquisando',
    analysis_due_at: '2026-09-02T12:00:00.000Z'
  });
  addBriefing(sqlite, 'case-1', 'nominativa', null);
  addPlan(sqlite, 'case-1');

  const incomplete = await onRequestPost(context(db, 'POST', {
    action: 'save_review', aceite_id: 'case-1', risk_level: 'favoravel',
    cutoff_at: CREATED_AT, executive_summary: 'Síntese.',
    recommendation: 'Prosseguir.', reviewed_by: 'Dr. Revisor', approved: true
  }));
  assert.equal(incomplete.status, 409);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM marca_reviews').get().count, 0);

  sqlite.prepare(`UPDATE marca_search_plans SET status='revisado',
    suggested_classes_json='["30"]' WHERE aceite_id=?`).run('case-1');
  sqlite.prepare(`INSERT INTO marca_search_results (
    id, aceite_id, imported_at, source, cutoff_at, mark_name,
    text_similarity, phonetic_similarity, class_affinity,
    relevance_score, relevance_level, raw_json
  ) VALUES (?, ?, ?, 'INPI', ?, ?, 1, 1, 1, 1, 'alta', '{}')`).run(
    'result-1', 'case-1', CREATED_AT, CREATED_AT, 'Montanha Cafés'
  );

  const completed = await onRequestPost(context(db, 'POST', {
    action: 'complete_search', aceite_id: 'case-1', cutoff_at: CREATED_AT,
    completed_by: 'Pesquisador', scope_confirmed: true,
    completed_queries: [{ type: 'exata', value: 'montanha cafes' }]
  }));
  assert.equal(completed.status, 200);

  const approved = await onRequestPost(context(db, 'POST', {
    action: 'save_review', aceite_id: 'case-1', risk_level: 'favoravel',
    cutoff_at: CREATED_AT, executive_summary: 'Síntese final.',
    recommendation: 'Prosseguir com cautela.', reviewed_by: 'Dr. Revisor', approved: true
  }));
  const approvedBody = await approved.json();
  assert.equal(approved.status, 200);

  const revised = await onRequestPost(context(db, 'POST', {
    action: 'save_review', aceite_id: 'case-1', risk_level: 'favoravel',
    executive_summary: 'Síntese final atualizada.',
    recommendation: 'Prosseguir com cautela.', reviewed_by: 'Dr. Revisor', approved: true
  }));
  const revisedBody = await revised.json();
  assert.equal(revised.status, 200);

  const staleDelivery = await onRequestPost(context(db, 'POST', {
    action: 'mark_delivered', aceite_id: 'case-1', report_file: 'relatorio-antigo.pdf',
    report_sha256: approvedBody.report_sha256,
    review_updated_at: approvedBody.review_updated_at
  }));
  assert.equal(staleDelivery.status, 409);
  assert.equal(sqlite.prepare('SELECT delivered_at FROM aceites WHERE id=?').get('case-1').delivered_at, null);

  const delivered = await onRequestPost(context(db, 'POST', {
    action: 'mark_delivered', aceite_id: 'case-1', report_file: 'relatorio-final.pdf',
    report_sha256: revisedBody.report_sha256,
    review_updated_at: revisedBody.review_updated_at
  }));
  assert.equal(delivered.status, 200);

  const changedAfterDelivery = await onRequestPost(context(db, 'POST', {
    action: 'save_review', aceite_id: 'case-1', risk_level: 'desaconselhado',
    cutoff_at: CREATED_AT, executive_summary: 'Texto divergente.',
    recommendation: 'Não prosseguir.', reviewed_by: 'Outro revisor', approved: false
  }));
  assert.equal(changedAfterDelivery.status, 409);
  const canonical = sqlite.prepare(`SELECT risk_level, executive_summary, approved
    FROM marca_reviews WHERE aceite_id=?`).get('case-1');
  assert.equal(canonical.risk_level, 'favoravel');
  assert.equal(canonical.executive_summary, 'Síntese final atualizada.');
  assert.equal(canonical.approved, 1);
  sqlite.close();
});

test('importação repetida é idempotente e descarta campos desconhecidos', {
  skip: DatabaseSync ? false : 'node:sqlite indisponível neste runtime'
}, async () => {
  const { sqlite, db } = createDatabase();
  addAcceptance(sqlite, {
    analysis_status: 'pesquisando',
    analysis_due_at: '2026-09-02T12:00:00.000Z'
  });
  addBriefing(sqlite, 'case-1', 'nominativa', null);
  addPlan(sqlite, 'case-1');
  sqlite.prepare(`UPDATE marca_search_plans SET status='revisado',
    suggested_classes_json='["30"]' WHERE aceite_id=?`).run('case-1');
  const payload = {
    action: 'import_results', aceite_id: 'case-1', cutoff_at: CREATED_AT,
    results: [{
      mark_name: 'Montanha Café', process_number: '123', nice_classes: '30',
      class_affinity: 1, segredo_inesperado: 'não persistir'
    }]
  };

  const first = await onRequestPost(context(db, 'POST', payload));
  const second = await onRequestPost(context(db, 'POST', {
    ...payload, cutoff_at: '2026-09-01T13:00:00.000Z'
  }));
  assert.deepEqual(await first.json(), { ok: true, imported: 1, ignored: 0 });
  assert.deepEqual(await second.json(), { ok: true, imported: 0, ignored: 1 });
  const stored = sqlite.prepare('SELECT COUNT(*) AS count, raw_json FROM marca_search_results').get();
  assert.equal(stored.count, 1);
  assert.doesNotMatch(stored.raw_json, /segredo_inesperado/);

  const withoutConfirmation = await onRequestPost(context(db, 'POST', {
    action: 'update_plan', aceite_id: 'case-1', suggested_classes: ['43'],
    related_classes: [], lawyer_notes: 'Escopo revisado.'
  }));
  assert.equal(withoutConfirmation.status, 409);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM marca_search_results').get().count, 1);

  const reset = await onRequestPost(context(db, 'POST', {
    action: 'update_plan', aceite_id: 'case-1', suggested_classes: ['43'],
    related_classes: [], lawyer_notes: 'Escopo revisado.', discard_results: true
  }));
  assert.equal(reset.status, 200);
  assert.equal((await reset.json()).discarded_results, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM marca_search_results').get().count, 0);
  sqlite.close();
});

test('pesquisa sem anterioridades pode ser concluída, mas exige cobertura exata do plano', {
  skip: DatabaseSync ? false : 'node:sqlite indisponível neste runtime'
}, async () => {
  const { sqlite, db } = createDatabase();
  addAcceptance(sqlite, {
    analysis_status: 'pesquisando',
    analysis_due_at: '2026-09-02T12:00:00.000Z'
  });
  addBriefing(sqlite, 'case-1', 'nominativa', null);
  addPlan(sqlite, 'case-1');
  sqlite.prepare(`UPDATE marca_search_plans SET status='revisado',
    suggested_classes_json='["30"]' WHERE aceite_id=?`).run('case-1');

  const futureCutoff = await onRequestPost(context(db, 'POST', {
    action: 'complete_search', aceite_id: 'case-1', cutoff_at: '2099-01-01T00:00:00.000Z',
    completed_by: 'Pesquisador', scope_confirmed: true,
    completed_queries: [{ type: 'exata', value: 'montanha cafes' }]
  }));
  assert.equal(futureCutoff.status, 400);

  const incompleteCoverage = await onRequestPost(context(db, 'POST', {
    action: 'complete_search', aceite_id: 'case-1', cutoff_at: CREATED_AT,
    completed_by: 'Pesquisador', scope_confirmed: true,
    completed_queries: [{ type: 'exata', value: 'outra consulta' }]
  }));
  assert.equal(incompleteCoverage.status, 409);

  const completed = await onRequestPost(context(db, 'POST', {
    action: 'complete_search', aceite_id: 'case-1', cutoff_at: CREATED_AT,
    completed_by: 'Pesquisador', scope_confirmed: true,
    completed_queries: [{ type: 'exata', value: 'montanha cafes' }]
  }));
  assert.equal(completed.status, 200);
  assert.equal((await completed.json()).result_count, 0);

  const approved = await onRequestPost(context(db, 'POST', {
    action: 'save_review', aceite_id: 'case-1', risk_level: 'favoravel',
    executive_summary: 'Nenhuma anterioridade relevante foi identificada.',
    recommendation: 'Prosseguir conforme a estratégia indicada.',
    reviewed_by: 'Dr. Revisor', approved: true
  }));
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).report.search_scope.result_count, 0);
  const plan = sqlite.prepare(`SELECT status, search_coverage_json
    FROM marca_search_plans WHERE aceite_id=?`).get('case-1');
  assert.equal(plan.status, 'pesquisa_concluida');
  assert.equal(JSON.parse(plan.search_coverage_json).no_results_found, true);
  sqlite.close();
});

test('POST administrativo limita o corpo antes de consultar ou gravar o caso', {
  skip: DatabaseSync ? false : 'node:sqlite indisponível neste runtime'
}, async () => {
  const { sqlite, db } = createDatabase();
  const response = await onRequestPost(context(db, 'POST', {
    action: 'update_plan', aceite_id: 'case-1',
    lawyer_notes: 'x'.repeat(1024 * 1024 + 1)
  }));
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /tamanho permitido/i);
  sqlite.close();
});

test('lista alertas financeiros auditáveis sem incluir payload ou PII nos alertas', {
  skip: DatabaseSync ? false : 'node:sqlite indisponível neste runtime'
}, async () => {
  const { sqlite, db } = createDatabase();
  addAcceptance(sqlite, {
    status: 'pago_revisao_pagamento_duplicado',
    payment_status: 'PAID',
    paid_at: null
  });
  sqlite.prepare(`INSERT INTO asaas_webhook_events (
    id, event, checkout_id, received_at, payload, processing_status,
    quarantine_reason, aceite_id, attempt_id, processed_at, payload_sha256
  ) VALUES (?, ?, ?, ?, ?, 'QUARANTINED', ?, ?, ?, ?, ?)`).run(
    'evt-1', 'CHECKOUT_PAID', 'chk-1', CREATED_AT,
    '{"customer":{"email":"segredo@example.test"}}', 'EVENT_ID_COLLISION',
    'case-1', 'attempt-old', CREATED_AT, 'abc'
  );
  sqlite.prepare(`INSERT INTO asaas_checkout_attempts (
    id, aceite_id, external_reference, checkout_id, state, is_current,
    created_at, updated_at, failure_reason
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'attempt-old', 'case-1', 'case-1:attempt-old', 'chk-1',
    'CREATING', 1, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', null
  );
  sqlite.prepare(`INSERT INTO asaas_checkout_attempts (
    id, aceite_id, external_reference, checkout_id, state, is_current,
    created_at, updated_at, failure_reason
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'attempt-review', 'case-1', 'case-1:attempt-review', 'chk-2',
    'REQUIRES_REVIEW', 0, CREATED_AT, CREATED_AT, 'DOUBLE_PAYMENT_REVIEW'
  );

  const response = await onRequestGet(context(db, 'GET'));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.alerts.monitoring_error, false);
  assert.equal(body.alerts.total, 4);
  assert.deepEqual(
    new Set(body.alerts.items.map(item => item.category)),
    new Set(['webhook_quarantined', 'checkout_stale_creating', 'checkout_requires_review', 'payment_requires_review'])
  );
  const serializedAlerts = JSON.stringify(body.alerts);
  assert.doesNotMatch(serializedAlerts, /payload|segredo@example|Cliente Sigiloso|19999999999/);
  assert.match(serializedAlerts, /EVENT_ID_COLLISION|DOUBLE_PAYMENT_REVIEW/);
  sqlite.close();
});

test('painel contém faixa de alertas e confirmação explícita do material', async () => {
  const html = readFileSync(new URL('../rumosadv-site/marcas/admin/analises/index.html', import.meta.url), 'utf8');
  assert.match(html, /Alertas operacionais/);
  assert.match(html, /data-alert-case/);
  assert.match(html, /confirm_material/);
  assert.match(html, /resolve_presentation/);
  assert.match(html, /Confirmar material e iniciar prazo/);
  assert.match(html, /aguardando_definicao/);
  assert.match(html, /complete_search/);
  assert.match(html, /executei todas as consultas do plano vigente/);
  assert.match(html, /deliverBtn'\);button\.disabled=true/);
  assert.match(html, /convertedBtn'\);button\.disabled=true/);
  assert.match(html, /catch\(e=>\{button\.disabled=false;msg\(e\.message\)\}\)/);
});

test('trocar de caso revisado para caso sem revisão limpa integralmente o editor', async () => {
  const html = readFileSync(new URL('../rumosadv-site/marcas/admin/analises/index.html', import.meta.url), 'utf8');
  const finalScript = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .find(source => source.includes('function resetReviewEditor'));
  assert.ok(finalScript);
  const start = finalScript.indexOf('const gateBaseOpenCase=openCase;');
  const end = finalScript.indexOf('function renderMaterialGate');
  assert.ok(start >= 0 && end > start);
  const source = `${finalScript.slice(start, end)}function renderMaterialGate(){} function renderOperationalHistory(){}`;

  const ids = ['cutoff', 'risk', 'summary', 'recommendation', 'caveats', 'reviewer', 'approved', 'report', 'detail'];
  const controls = Object.fromEntries(ids.map(id => [id, {
    value: '', checked: false, textContent: '',
    classList: { add() {}, remove() {} }
  }]));
  const records = {
    A: {
      aceite: {}, briefing: {}, review: {
        cutoff_at: '2026-09-01T12:00', risk_level: 'risco_elevado',
        executive_summary: 'Resumo de A', recommendation: 'Recomendação de A',
        caveats: 'Ressalvas de A', reviewed_by: 'Advogado A', approved: 1,
        report_json: '{"case":"A"}'
      }
    },
    B: { aceite: {}, briefing: {}, review: null }
  };
  const sandbox = {
    current: '', currentData: null,
    $(id) { return controls[id]; }
  };
  sandbox.openCase = async id => {
    sandbox.current = id;
    const data = records[id];
    sandbox.currentData = data;
    if (data.review) {
      controls.cutoff.value = data.review.cutoff_at;
      controls.risk.value = data.review.risk_level;
      controls.summary.value = data.review.executive_summary;
      controls.recommendation.value = data.review.recommendation;
      controls.caveats.value = data.review.caveats;
      controls.reviewer.value = data.review.reviewed_by;
      controls.approved.checked = Boolean(data.review.approved);
      controls.report.textContent = data.review.report_json;
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'admin-reset-review.js' });

  await sandbox.openCase('A');
  assert.equal(controls.summary.value, 'Resumo de A');
  assert.equal(controls.approved.checked, true);
  await sandbox.openCase('B');
  for (const id of ['cutoff', 'summary', 'recommendation', 'caveats', 'reviewer']) {
    assert.equal(controls[id].value, '', `${id} deveria estar vazio`);
  }
  assert.equal(controls.risk.value, 'favoravel');
  assert.equal(controls.approved.checked, false);
  assert.equal(controls.report.textContent, '');
  assert.equal(sandbox.currentData.review, null);
});

test('restauração de sessão dispara apenas uma listagem automática', () => {
  const html = readFileSync(new URL('../rumosadv-site/marcas/admin/analises/index.html', import.meta.url), 'utf8');
  assert.equal((html.match(/if\(auth\)list\(\)\.catch/g) || []).length, 1);
});

test('resposta tardia de outro caso não troca a tela nem o destino das ações', async () => {
  const html = readFileSync(new URL('../rumosadv-site/marcas/admin/analises/index.html', import.meta.url), 'utf8');
  const firstScript = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .find(source => source.includes('openCaseGeneration'));
  assert.ok(firstScript);
  const source = `${firstScript.slice(0, firstScript.indexOf('function post'))}
    globalThis.__openCase=openCase;
    globalThis.__caseState=()=>({current,currentData,openCaseGeneration});`;

  const control = () => ({
    value: '', checked: false, textContent: '', innerHTML: '',
    classList: { add() {}, remove() {} }
  });
  const controls = Object.fromEntries([
    'detail', 'caseTitle', 'briefingData', 'queries', 'mainClasses',
    'relatedClasses', 'planNotes', 'results', 'risk', 'summary',
    'recommendation', 'caveats', 'reviewer', 'approved', 'report'
  ].map(id => [id, control()]));
  const pending = new Map();
  const sandbox = {
    document: { getElementById(id) { return controls[id] || null; } },
    deliveryState: control(), msgPayment: control(), msgBriefing: control(),
    msgDelivery: control(), msgOffer: control(), location: { hash: '' },
    encodeURIComponent, String, JSON, Array, Math, Date,
    fetch(url) {
      const id = new URL(url, 'https://rumos.example').searchParams.get('id');
      return new Promise(resolve => pending.set(id, resolve));
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'admin-open-case-race.js' });

  const openingA = sandbox.__openCase('A');
  const openingB = sandbox.__openCase('B');
  pending.get('B')({ ok: true, async json() { return {
    aceite: { marca: 'Marca B', nome: 'Cliente B' }, briefing: null,
    plan: null, results: [], review: null, messages: {}
  }; } });
  assert.equal(await openingB, true);
  pending.get('A')({ ok: true, async json() { return {
    aceite: { marca: 'Marca A', nome: 'Cliente A' }, briefing: null,
    plan: null, results: [], review: null, messages: {}
  }; } });
  assert.equal(await openingA, false);

  assert.equal(controls.caseTitle.textContent, 'Marca B · Cliente B');
  assert.equal(sandbox.__caseState().current, 'B');
  assert.equal(sandbox.__caseState().currentData.aceite.marca, 'Marca B');
  assert.equal(sandbox.__caseState().openCaseGeneration, 2);
});

test('resposta tardia de uma ação não contamina o caso aberto depois dela', async () => {
  const html = readFileSync(new URL('../rumosadv-site/marcas/admin/analises/index.html', import.meta.url), 'utf8');
  const actionBindingScript = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .find(source => source.includes('Vincula cada mutação ao caso'));
  assert.ok(actionBindingScript);

  let completeRequest;
  let importedBody;
  let applied = false;
  const sandbox = {
    current: 'A',
    openCaseGeneration: 1,
    api(_path, options) {
      importedBody = JSON.parse(options.body);
      return new Promise(resolve => { completeRequest = resolve; });
    },
    Promise,
    JSON
  };
  vm.createContext(sandbox);
  vm.runInContext(actionBindingScript, sandbox, { filename: 'admin-action-race.js' });

  sandbox.post({ action: 'create_briefing_link' }).then(() => { applied = true; });
  assert.equal(importedBody.aceite_id, 'A');
  sandbox.current = 'B';
  sandbox.openCaseGeneration = 2;
  completeRequest({ url: 'https://example.test/briefing-A' });
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(applied, false);
});
