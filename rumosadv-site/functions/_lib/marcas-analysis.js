export const ENGINE_VERSION = 'rumos-marcas-v1.1';

export function normalizeMark(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function unique(values) {
  return [...new Set(values.map(normalizeMark).filter(Boolean))];
}

export function generateQueries(mark) {
  const normalized = normalizeMark(mark);
  const words = normalized.split(' ').filter(Boolean);
  const queries = [{ type: 'exata', value: normalized }];
  if (words.length > 1) {
    queries.push({ type: 'aglutinada', value: words.join('') });
    queries.push({ type: 'ordem_invertida', value: [...words].reverse().join(' ') });
    for (const word of words) if (word.length >= 4) queries.push({ type: 'elemento_dominante', value: word });
  }
  const variants = unique(queries.map(q => q.value)).map(value => {
    const original = queries.find(q => normalizeMark(q.value) === value);
    return { type: original.type, value };
  });
  return variants.slice(0, 12);
}

function levenshtein(a, b) {
  const x = normalizeMark(a), y = normalizeMark(b);
  const row = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    let diagonal = row[0]; row[0] = i;
    for (let j = 1; j <= y.length; j++) {
      const old = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (x[i - 1] === y[j - 1] ? 0 : 1));
      diagonal = old;
    }
  }
  return row[y.length];
}

export function textSimilarity(a, b) {
  const x = normalizeMark(a), y = normalizeMark(b);
  if (!x || !y) return 0;
  return Number((1 - levenshtein(x, y) / Math.max(x.length, y.length)).toFixed(3));
}

const connectiveWords = new Set(['a', 'as', 'da', 'das', 'de', 'do', 'dos', 'e', 'o', 'os']);

function comparisonTokens(value) {
  return normalizeMark(value).split(' ').filter(Boolean).filter(word => !connectiveWords.has(word))
    .map(word => word.length > 4 && word.endsWith('s') ? word.slice(0, -1) : word);
}

export function tokenSetSimilarity(a, b) {
  const x = new Set(comparisonTokens(a)), y = new Set(comparisonTokens(b));
  if (!x.size || !y.size) return 0;
  const intersection = [...x].filter(token => y.has(token)).length;
  return Number((intersection / new Set([...x, ...y]).size).toFixed(3));
}

export function phoneticKey(value) {
  return normalizeMark(value).replace(/ph/g, 'f').replace(/[ckq]/g, 'k')
    .replace(/[szx]/g, 's').replace(/g(?=[ei])/g, 'j').replace(/h/g, '')
    .replace(/[aeiou]/g, '').replace(/(.)\1+/g, '$1');
}

export function scoreResult(targetMark, candidateMark, classAffinity = 0) {
  const structural = tokenSetSimilarity(targetMark, candidateMark);
  const text = Math.max(textSimilarity(targetMark, candidateMark), structural);
  const phonetic = textSimilarity(phoneticKey(targetMark), phoneticKey(candidateMark));
  const affinity = Math.max(0, Math.min(1, Number(classAffinity) || 0));
  const sequentialScore = text * .5 + phonetic * .3 + affinity * .2;
  const structuralScore = structural * .8 + affinity * .2;
  const score = Number(Math.max(sequentialScore, structuralScore).toFixed(3));
  return {
    text_similarity: text,
    phonetic_similarity: phonetic,
    class_affinity: affinity,
    relevance_score: score,
    relevance_level: score >= .78 ? 'alta' : score >= .52 ? 'media' : 'baixa'
  };
}

export function buildReportDraft(caseData, results, review = {}) {
  const relevant = results.filter(item => item.relevance_level !== 'baixa');
  return {
    version: ENGINE_VERSION,
    generated_at: new Date().toISOString(),
    legal_review_required: true,
    case: caseData,
    executive_summary: review.executive_summary || '',
    risk_level: review.risk_level || null,
    recommendation: review.recommendation || '',
    caveats: review.caveats || '',
    protection_strategy: {
      presentation_type: caseData.presentation_type || null,
      suggested_classes: caseData.suggested_classes || [],
      related_classes: caseData.related_classes || [],
      lawyer_notes: caseData.lawyer_notes || ''
    },
    business_context: {
      current_goods_services: caseData.current_goods_services || '',
      planned_goods_services: caseData.planned_goods_services || '',
      market_scope: caseData.market_scope || '',
      intended_owner_type: caseData.intended_owner_type || '',
      in_use: caseData.in_use ?? null,
      first_use_date: caseData.first_use_date || null
    },
    search_scope: {
      queries: caseData.queries || [],
      result_count: results.length,
      relevant_result_count: relevant.length
    },
    relevant_results: relevant,
    methodology: 'Busca orientada por expressão exata, variações estruturais e triagem de semelhança textual, fonética e afinidade informada. A conclusão depende de revisão jurídica.',
    disclaimer: 'A pesquisa reflete as bases consultadas na data de corte, reduz incertezas e não garante concessão pelo INPI.'
  };
}

function formatDatePtBr(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo' }).format(date);
}

export function buildPostSaleMessages(caseData = {}) {
  const name = String(caseData.client || '').trim().split(/\s+/)[0] || 'Olá';
  const mark = String(caseData.mark || 'sua marca').trim();
  const risk = String(caseData.risk_level || '');
  const expiry = formatDatePtBr(caseData.credit_expires_at);
  const creditText = expiry ? ` até ${expiry}` : ' durante o prazo contratual de 30 dias';
  const cautious = risk === 'risco_elevado' || risk === 'desaconselhado';
  const d0ByRisk = {
    favoravel: `${name}, enviei o relatório da marca ${mark}. Na data de corte, não identificamos obstáculo relevante no escopo pesquisado. Isso reduz a incerteza, mas não garante concessão pelo INPI. Posso esclarecer os próximos passos por aqui?`,
    favoravel_com_ressalvas: `${name}, enviei o relatório da marca ${mark}. A conclusão foi favorável com ressalvas: existe um caminho possível, mas a estratégia indicada no documento precisa ser observada antes de qualquer depósito. Não há garantia de concessão. Posso esclarecer o ponto principal por aqui?`,
    risco_elevado: `${name}, enviei o relatório da marca ${mark}. Foram identificados obstáculos relevantes e não recomendo protocolar a marca na forma atual sem uma estratégia específica. Posso explicar as alternativas indicadas no relatório.`,
    desaconselhado: `${name}, enviei o relatório da marca ${mark}. Na configuração analisada, a recomendação é não realizar o depósito. O documento explica os obstáculos e as alternativas iniciais. Posso esclarecer a conclusão em uma conversa breve?`
  };
  const nextStep = cautious
    ? 'O próximo passo mais prudente é conversarmos sobre ajustes no sinal ou alternativas antes de qualquer pedido.'
    : 'Se fizer sentido avançar, posso estruturar o pedido com a apresentação, as classes e a especificação recomendadas.';
  return {
    followup_d0: d0ByRisk[risk] || `${name}, enviei o relatório da marca ${mark}. Ele apresenta a conclusão, as ressalvas e os próximos passos. Posso esclarecer algum ponto por aqui?`,
    followup_d3: `${name}, conseguiu examinar o relatório da marca ${mark}? Se algum ponto da conclusão ou das ressalvas não ficou claro, posso esclarecer por aqui. ${nextStep}`,
    followup_d7: `${name}, retomo a análise da marca ${mark} para saber se você deseja definir o próximo passo. Os R$ 390 permanecem disponíveis como crédito nos honorários do pedido${creditText}.`,
    followup_d15: cautious
      ? `${name}, sobre a marca ${mark}: antes de pensar em protocolo, vale decidirmos se ajustaremos o sinal, a apresentação ou o escopo de proteção. Posso organizar essas alternativas em uma conversa breve.`
      : `${name}, a estratégia indicada para a marca ${mark} continua disponível. Se desejar, envio a proposta discriminando honorários, taxas oficiais, classes e acompanhamento, com aplicação do crédito da análise.`,
    followup_d25: cautious
      ? `${name}, este é o encerramento do acompanhamento da marca ${mark}. Embora o crédito contratual${expiry ? ` tenha prazo até ${expiry}` : ' tenha prazo próprio'}, isso não altera a recomendação técnica de não depositar na forma analisada sem a estratégia indicada. Encerro os lembretes por aqui.`
      : `${name}, aviso administrativo final: o crédito de R$ 390 referente à análise da marca ${mark}${expiry ? ` está previsto para encerrar em ${expiry}` : ' está próximo do vencimento'}. Se quiser receber a proposta, me avise; depois desta mensagem, encerro os lembretes.`,
    close_or_nurture: `${name}, encerro por ora o acompanhamento comercial da análise da marca ${mark}, para não ser inconveniente. O relatório continua válido como retrato das bases consultadas na data de corte; uma decisão futura pode exigir atualização da pesquisa.`
  };
}

export function buildOperationalMessages(caseData = {}) {
  const name = String(caseData.client || '').trim().split(/\s+/)[0] || 'Olá';
  const mark = String(caseData.mark || 'sua marca').trim();
  return {
    payment_confirmed: `${name}, confirmamos o pagamento da análise de viabilidade da marca ${mark}. Vou enviar agora um link seguro para o briefing. O prazo de até 1 dia útil começa após recebermos todas as informações necessárias e o logotipo, quando aplicável.`,
    briefing_reminder: `${name}, o briefing da análise da marca ${mark} ainda está pendente. Assim que ele for concluído, consigo iniciar a pesquisa e confirmar o prazo de entrega.`,
    delivery: `${name}, a análise de viabilidade da marca ${mark} foi concluída. Estou enviando o relatório em PDF e um resumo dos principais achados. A pesquisa reflete as bases consultadas na data de corte e não garante a concessão pelo INPI.`,
    registration_offer: `${name}, se você decidir prosseguir com o pedido de registro da marca ${mark}, os R$ 390 pagos pela análise serão abatidos integralmente dos honorários se a contratação ocorrer em até 30 dias da entrega. Posso lhe enviar a proposta com classes, taxas oficiais e etapas do acompanhamento.`,
    ...buildPostSaleMessages(caseData)
  };
}

export function buildDeliveryRecord(current = {}, reportFile = '', now = new Date()) {
  if (current.delivered_at) {
    return {
      already_delivered: true,
      delivered_at: current.delivered_at,
      credit_expires_at: current.credit_expires_at || null,
      report_file: current.report_file || null
    };
  }
  const deliveredAt = new Date(now);
  if (Number.isNaN(deliveredAt.getTime())) throw new TypeError('Data de entrega inválida.');
  const reference = String(reportFile || '').trim();
  if (!reference || reference.length > 240 || /[\u0000-\u001f]/.test(reference)) {
    throw new TypeError('Informe uma referência válida para o PDF entregue.');
  }
  return {
    already_delivered: false,
    delivered_at: deliveredAt.toISOString(),
    credit_expires_at: new Date(deliveredAt.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    report_file: reference
  };
}

export function buildConversionRecord(current = {}, now = new Date()) {
  if (!current.delivered_at) throw new TypeError('Registre a entrega antes da conversão para o pedido.');
  if (current.registration_converted_at) {
    return { already_converted: true, registration_converted_at: current.registration_converted_at };
  }
  const convertedAt = new Date(now);
  if (Number.isNaN(convertedAt.getTime())) throw new TypeError('Data de conversão inválida.');
  return { already_converted: false, registration_converted_at: convertedAt.toISOString() };
}
