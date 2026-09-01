export const ENGINE_VERSION = 'rumos-marcas-v1';

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

export function phoneticKey(value) {
  return normalizeMark(value).replace(/ph/g, 'f').replace(/[ckq]/g, 'k')
    .replace(/[szx]/g, 's').replace(/g(?=[ei])/g, 'j').replace(/h/g, '')
    .replace(/[aeiou]/g, '').replace(/(.)\1+/g, '$1');
}

export function scoreResult(targetMark, candidateMark, classAffinity = 0) {
  const text = textSimilarity(targetMark, candidateMark);
  const phonetic = textSimilarity(phoneticKey(targetMark), phoneticKey(candidateMark));
  const affinity = Math.max(0, Math.min(1, Number(classAffinity) || 0));
  const score = Number((text * .5 + phonetic * .3 + affinity * .2).toFixed(3));
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
    relevant_results: relevant,
    methodology: 'Busca orientada por expressão exata, variações estruturais e triagem de semelhança textual, fonética e afinidade informada. A conclusão depende de revisão jurídica.',
    disclaimer: 'A pesquisa reflete as bases consultadas na data de corte, reduz incertezas e não garante concessão pelo INPI.'
  };
}

export function buildOperationalMessages(caseData = {}) {
  const name = String(caseData.client || '').trim().split(/\s+/)[0] || 'Olá';
  const mark = String(caseData.mark || 'sua marca').trim();
  return {
    payment_confirmed: `${name}, confirmamos o pagamento da análise de viabilidade da marca ${mark}. Vou enviar agora um link seguro para o briefing. O prazo de até 1 dia útil começa após recebermos todas as informações necessárias e o logotipo, quando aplicável.`,
    briefing_reminder: `${name}, o briefing da análise da marca ${mark} ainda está pendente. Assim que ele for concluído, consigo iniciar a pesquisa e confirmar o prazo de entrega.`,
    delivery: `${name}, a análise de viabilidade da marca ${mark} foi concluída. Estou enviando o relatório em PDF e um resumo dos principais achados. A pesquisa reflete as bases consultadas na data de corte e não garante a concessão pelo INPI.`,
    registration_offer: `${name}, se você decidir prosseguir com o pedido de registro da marca ${mark}, os R$ 390 pagos pela análise serão abatidos integralmente dos honorários se a contratação ocorrer em até 30 dias da entrega. Posso lhe enviar a proposta com classes, taxas oficiais e etapas do acompanhamento.`
  };
}
