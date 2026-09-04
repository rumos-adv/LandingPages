import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ANALYSIS_TIME_ZONE,
  analysisBusinessDayConfig,
  nextBusinessDay,
  parseAnalysisHolidays
} from '../rumosadv-site/functions/_lib/business-days.js';
import { createBriefingToken } from '../rumosadv-site/functions/_lib/marcas-auth.js';
import { onRequestGet, onRequestPost } from '../rumosadv-site/functions/api/briefing.js';

test('usa São Paulo por padrão e ignora fim de semana e feriado configurado', () => {
  const config = analysisBusinessDayConfig({ ANALYSIS_HOLIDAYS: '2026-09-07' });
  assert.equal(config.timeZone, DEFAULT_ANALYSIS_TIME_ZONE);
  assert.equal(
    nextBusinessDay('2026-09-04T18:30:12.345Z', config),
    '2026-09-08T18:30:12.345Z'
  );
});

test('preserva o horário local quando há mudança de horário de verão', () => {
  const config = analysisBusinessDayConfig({ ANALYSIS_TIMEZONE: 'America/New_York' });
  assert.equal(
    nextBusinessDay('2026-03-06T15:15:30.250Z', config),
    '2026-03-09T14:15:30.250Z'
  );
});

test('aceita lista simples ou JSON e elimina feriados duplicados', () => {
  assert.deepEqual(parseAnalysisHolidays('2026-09-07, 2026-10-12\n2026-09-07'), ['2026-09-07', '2026-10-12']);
  assert.deepEqual(parseAnalysisHolidays('["2026-09-07","2026-10-12"]'), ['2026-09-07', '2026-10-12']);
});

test('recusa configurações ambíguas ou inválidas em vez de calcular prazo incorreto', () => {
  assert.throws(
    () => analysisBusinessDayConfig({ ANALYSIS_TIME_ZONE: 'Mars/Olympus' }),
    /fuso horário válido/
  );
  assert.throws(
    () => analysisBusinessDayConfig({ ANALYSIS_TIME_ZONE: 'UTC', ANALYSIS_TIMEZONE: 'America/Sao_Paulo' }),
    /não podem divergir/
  );
  assert.throws(
    () => analysisBusinessDayConfig({ ANALYSIS_HOLIDAYS: '2026-02-30' }),
    /Feriado inválido/
  );
  assert.throws(() => nextBusinessDay('não é uma data'), /Data de referência inválida/);
});

test('usa a variável legada válida quando a variável principal está vazia', () => {
  const config = analysisBusinessDayConfig({
    ANALYSIS_TIME_ZONE: '',
    ANALYSIS_TIMEZONE: 'UTC'
  });
  assert.equal(config.timeZone, 'UTC');
});

function createPaidDb(options = {}) {
  const batches = [];
  const queries = [];
  return {
    batches,
    queries,
    prepare(sql) {
      queries.push(sql);
      return {
        bind(...values) {
          return {
            sql,
            values,
            async first() {
              if (sql.includes('FROM aceites')) {
                return {
                  id: 'case-1',
                  nome: options.nome || 'Cliente Teste',
                  marca: options.marca || 'Montanha Cafés',
                  payment_status: 'PAID',
                  briefing_status: options.briefingStatus || 'pendente'
                };
              }
              if (sql.includes('FROM marca_briefings')) {
                return options.exactMark ? { exact_mark: options.exactMark } : null;
              }
              return null;
            }
          };
        }
      };
    },
    async batch(statements) {
      batches.push(statements);
      const inserted = options.insertChanges ?? 1;
      return [
        { meta: { changes: inserted } },
        { meta: { changes: inserted } },
        { meta: { changes: inserted } }
      ];
    }
  };
}

async function getBriefing(db) {
  const secret = 'segredo-de-teste-com-tamanho-adequado';
  const token = await createBriefingToken('case-1', secret);
  return onRequestGet({
    request: new Request('https://example.com/api/briefing', {
      headers: { 'x-briefing-token': token }
    }),
    env: { ACEITES_DB: db, BRIEFING_SIGNING_SECRET: secret }
  });
}

function validBriefing(presentationType, logoUrl) {
  return {
    exact_mark: 'Montanha Cafés',
    current_goods_services: 'Café torrado',
    presentation_type: presentationType,
    market_scope: 'brasil',
    intended_owner_type: 'pessoa_juridica',
    information_confirmed: true,
    temporal_search_ack: true,
    data_use_authorized: true,
    ...(logoUrl === undefined ? {} : { logo_url: logoUrl })
  };
}

async function submitBriefing(body, db, env = {}) {
  const secret = 'segredo-de-teste-com-tamanho-adequado';
  const token = await createBriefingToken('case-1', secret);
  return onRequestPost({
    request: new Request('https://example.com/api/briefing', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-briefing-token': token },
      body: JSON.stringify(body)
    }),
    env: {
      ACEITES_DB: db,
      BRIEFING_SIGNING_SECRET: secret,
      ANALYSIS_TIME_ZONE: 'America/Sao_Paulo',
      ...env
    }
  });
}

test('não conclui briefing misto ou figurativo sem logotipo', async () => {
  for (const presentationType of ['mista', 'figurativa']) {
    const db = createPaidDb();
    const response = await submitBriefing(validBriefing(presentationType), db);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /logotipo.*conferência/i);
    assert.equal(db.batches.length, 0);
  }
});

test('recusa link inseguro de logotipo antes de qualquer gravação', async () => {
  const db = createPaidDb();
  const response = await submitBriefing(validBriefing('mista', 'javascript:alert(1)'), db);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /link válido/i);
  assert.equal(db.batches.length, 0);
});

test('inicia o SLA sem logotipo para marca nominativa', async () => {
  const db = createPaidDb();
  const response = await submitBriefing(validBriefing('nominativa'), db);
  assert.equal(response.status, 201);
  assert.equal(db.batches.length, 1);
  const update = db.batches[0].find(statement => statement.sql.includes('analysis_due_at'));
  assert.ok(update);
  assert.equal(update.values[2], 'pesquisando');
  assert.match(update.values[3], /^\d{4}-\d{2}-\d{2}T/);
});

test('marca mista conclui o briefing, mas aguarda conferência humana antes do SLA', async () => {
  const db = createPaidDb();
  const response = await submitBriefing(validBriefing('mista', '  https://example.com/logo.png  '), db);
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(db.batches.length, 1);
  const briefingInsert = db.batches[0].find(statement => statement.sql.includes('INSERT INTO marca_briefings'));
  assert.equal(briefingInsert.values.at(-1), 'https://example.com/logo.png');
  const update = db.batches[0].find(statement => statement.sql.includes('analysis_due_at'));
  assert.equal(update.values[2], 'aguardando_material');
  assert.equal(update.values[3], null);
  assert.equal(body.analysis_status, 'aguardando_material');
  assert.equal(body.analysis_due_at, null);
  assert.match(body.message, /conferência do logotipo/i);
});

test('apresentação indefinida conclui sem iniciar SLA', async () => {
  const db = createPaidDb();
  const response = await submitBriefing(validBriefing('indefinida'), db);
  const body = await response.json();
  assert.equal(response.status, 201);
  const update = db.batches[0].find(statement => statement.sql.includes('analysis_due_at'));
  assert.equal(update.values[2], 'aguardando_definicao');
  assert.equal(update.values[3], null);
  assert.equal(body.analysis_status, 'aguardando_definicao');
  assert.equal(body.analysis_due_at, null);
  assert.match(body.message, /precisa ser definida/i);
});

test('não permite sobrescrever briefing já concluído nem reiniciar o SLA', async () => {
  const db = createPaidDb({ briefingStatus: 'concluido' });
  const response = await submitBriefing(validBriefing('nominativa'), db);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /já foi concluído/i);
  assert.equal(db.batches.length, 0);
});

test('uma segunda submissão concorrente perde a inserção atômica sem alterar o caso', async () => {
  const db = createPaidDb({ insertChanges: 0 });
  const response = await submitBriefing(validBriefing('nominativa'), db);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /já foi concluído/i);
  assert.equal(db.batches.length, 1);
});

test('valida booleanos e data estritamente antes de gravar', async () => {
  const invalidBooleanDb = createPaidDb();
  const invalidBoolean = await submitBriefing({
    ...validBriefing('nominativa'),
    in_use: 'false'
  }, invalidBooleanDb);
  assert.equal(invalidBoolean.status, 400);
  assert.equal(invalidBooleanDb.batches.length, 0);

  const invalidDateDb = createPaidDb();
  const invalidDate = await submitBriefing({
    ...validBriefing('nominativa'),
    first_use_date: '2026-02-30'
  }, invalidDateDb);
  assert.equal(invalidDate.status, 400);
  assert.match((await invalidDate.json()).error, /data válida/i);
  assert.equal(invalidDateDb.batches.length, 0);
});

test('recusa briefing acima do limite e JSON malformado sem gravar', async () => {
  const secret = 'segredo-de-teste-com-tamanho-adequado';
  const token = await createBriefingToken('case-1', secret);
  for (const raw of [
    '{"exact_mark":',
    JSON.stringify({ ...validBriefing('nominativa'), known_conflicts: 'x'.repeat(70_000) })
  ]) {
    const db = createPaidDb();
    const response = await onRequestPost({
      request: new Request('https://example.com/api/briefing', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-briefing-token': token },
        body: raw
      }),
      env: { ACEITES_DB: db, BRIEFING_SIGNING_SECRET: secret }
    });
    assert.ok([400, 413].includes(response.status));
    assert.equal(db.batches.length, 0);
  }
});

test('cancela stream sem Content-Length assim que ultrapassa 64 KB', async () => {
  const secret = 'segredo-de-teste-com-tamanho-adequado';
  const token = await createBriefingToken('case-1', secret);
  const db = createPaidDb();
  let cancelled = false;
  const request = new Request('https://example.com/api/briefing', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-briefing-token': token },
    body: new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(8 * 1024)); },
      cancel() { cancelled = true; }
    }),
    duplex: 'half'
  });

  assert.equal(request.headers.has('content-length'), false);
  const response = await onRequestPost({
    request,
    env: { ACEITES_DB: db, BRIEFING_SIGNING_SECRET: secret }
  });
  assert.equal(response.status, 413);
  assert.equal(cancelled, true);
  assert.equal(db.batches.length, 0);
});

test('GET pendente devolve somente os campos mínimos usados pela página', async () => {
  const db = createPaidDb({ exactMark: 'Montanha Café' });
  const response = await getBriefing(db);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    ok: true,
    case: {
      nome: 'Cliente Teste',
      marca: 'Montanha Cafés',
      briefing_status: 'pendente'
    },
    briefing: { exact_mark: 'Montanha Café' }
  });
  assert.ok(db.queries.every(sql => !/SELECT\s+\*/i.test(sql)));
});

test('GET concluído devolve apenas o estado, sem briefing nem dados pessoais', async () => {
  const db = createPaidDb({ briefingStatus: 'concluido', exactMark: 'Dado sigiloso' });
  const response = await getBriefing(db);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, { ok: true, case: { briefing_status: 'concluido' } });
  assert.equal(JSON.stringify(body).includes('Cliente Teste'), false);
  assert.equal(JSON.stringify(body).includes('Montanha'), false);
  assert.equal(db.queries.filter(sql => sql.includes('FROM marca_briefings')).length, 0);
  assert.ok(db.queries.every(sql => !/SELECT\s+\*/i.test(sql)));
});

test('API de briefing não aceita mais token pela query string', async () => {
  const secret = 'segredo-de-teste-com-tamanho-adequado';
  const token = await createBriefingToken('case-1', secret);
  const db = createPaidDb();
  const response = await onRequestGet({
    request: new Request(`https://example.com/api/briefing?token=${encodeURIComponent(token)}`),
    env: { ACEITES_DB: db, BRIEFING_SIGNING_SECRET: secret }
  });

  assert.equal(response.status, 401);
  assert.equal(db.queries.length, 0);
});

test('configuração de feriados inválida falha antes de iniciar o prazo', async () => {
  const db = createPaidDb();
  const response = await submitBriefing(validBriefing('nominativa'), db, {
    ANALYSIS_HOLIDAYS: '2026-02-30'
  });
  assert.equal(response.status, 500);
  assert.equal(db.batches.length, 0);
});

test('configuração de feriados inválida não bloqueia briefing visual que ainda não inicia prazo', async () => {
  const db = createPaidDb();
  const response = await submitBriefing(validBriefing('figurativa', 'https://example.com/sinal.svg'), db, {
    ANALYSIS_HOLIDAYS: '2026-02-30'
  });
  assert.equal(response.status, 201);
  const update = db.batches[0].find(statement => statement.sql.includes('analysis_due_at'));
  assert.equal(update.values[2], 'aguardando_material');
  assert.equal(update.values[3], null);
});
