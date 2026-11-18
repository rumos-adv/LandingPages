// Referência do contato (Ref. F…) para ligar o clique no WhatsApp ao anúncio de origem.
// Só altera links do wa.me; âncoras internas (#situacao) ficam intactas.
(() => {
  'use strict';
  const PAGE = 'divida-ativa', KEY = 'rumos_lead_divida_ativa';
  const keys = ['gclid','gbraid','wbraid','fbclid','utm_source','utm_medium','utm_campaign','utm_content','utm_term'];
  const params = new URLSearchParams(location.search);
  let lead = {};
  try { lead = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) {}
  if (!lead || typeof lead !== 'object' || Array.isArray(lead)) lead = {};
  const incoming = {};
  keys.forEach(k => { if (params.get(k)) incoming[k] = params.get(k).slice(0, 120); });
  if (Object.keys(incoming).some(k => incoming[k] !== lead[k])) lead = incoming;
  if (!/^F[A-Z0-9]{3,9}$/.test(lead.ref || '')) {
    const b = new Uint8Array(4); crypto.getRandomValues(b);
    lead.ref = 'F' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  try { localStorage.setItem(KEY, JSON.stringify(lead)); } catch (_) {}
  function origin(source) {
    const body = { page: PAGE, source, lead_ref: lead.ref };
    keys.forEach(k => { if (lead[k]) body[k] = lead[k]; });
    if (!window.RumosSiteConsent?.getChoice?.()?.marketing) ['gclid','gbraid','wbraid','fbclid'].forEach(k => delete body[k]);
    const data = JSON.stringify(body);
    let queued = false;
    try { if (navigator.sendBeacon) queued = navigator.sendBeacon('/api/lead-origin', new Blob([data], { type: 'application/json' })); } catch (_) {}
    if (!queued) fetch('/api/lead-origin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: data, keepalive: true }).catch(() => {});
  }
  document.querySelectorAll('a[href*="wa.me/"]').forEach(link => {
    let url;
    try { url = new URL(link.href); } catch (_) { return; }
    if (url.hostname !== 'wa.me') return;
    url.searchParams.set('text', (url.searchParams.get('text') || '') + ' (Ref. ' + lead.ref + ')');
    link.href = url.toString();
    const source = link.dataset.waSource || null;
    link.addEventListener('click', () => origin(source));
  });
})();
