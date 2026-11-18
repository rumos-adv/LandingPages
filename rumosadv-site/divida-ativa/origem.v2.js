// Referência do contato (Ref. F…) para ligar o clique no WhatsApp ao anúncio de origem.
// Só altera links do wa.me; âncoras internas (#situacao) ficam intactas.
// Também cuida do formulário próprio (grava em /contas/admin/) e do aviso de retorno.
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
    link.addEventListener('click', () => { origin(source); tapped = Date.now(); setTimeout(openPrompt, 6000); });
  });

  window.dataLayer = window.dataLayer || [];
  const track = (event, extra = {}) => window.dataLayer.push({ event, page: PAGE, service: 'Dívida ativa e transação com a PGFN', lead_ref: lead.ref, ...extra });
  const form = document.getElementById('contact-form'), status = document.getElementById('form-status');
  const prompt = document.getElementById('return-prompt'), done = document.getElementById('form-done');
  if (!form) return;
  const f = form.elements;
  let tapped = 0, shown = false, sent = false, formVisible = false;
  try { shown = sessionStorage.getItem('rumos_return_divida_ativa') === '1'; } catch (_) {}
  function closePrompt() { if (prompt) prompt.hidden = true; }
  function openPrompt() {
    if (!prompt || shown || sent || formVisible || !tapped || Date.now() - tapped < 1500 || document.visibilityState !== 'visible') return;
    shown = true;
    try { sessionStorage.setItem('rumos_return_divida_ativa', '1'); } catch (_) {}
    prompt.hidden = false; track('contas_retorno_mostrar');
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') openPrompt(); });
  window.addEventListener('focus', openPrompt);
  window.addEventListener('pageshow', openPrompt);
  if (prompt) {
    document.getElementById('return-close').addEventListener('click', () => { closePrompt(); track('contas_retorno_fechar'); });
    document.getElementById('return-sent').addEventListener('click', () => { closePrompt(); track('contas_retorno_ja_enviei'); });
    document.getElementById('return-go').addEventListener('click', e => {
      e.preventDefault(); closePrompt(); track('contas_retorno_abrir');
      document.getElementById('consulta').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      f.nome.focus({ preventScroll: true });
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !prompt.hidden) closePrompt(); });
  }
  if ('IntersectionObserver' in window) new IntersectionObserver(en => { formVisible = en[0].isIntersecting; if (formVisible) closePrompt(); }).observe(form);
  f.email.disabled = true;
  f.preferencia.addEventListener('change', () => {
    const useEmail = f.preferencia.value === 'email';
    document.getElementById('email-field').hidden = !useEmail;
    f.email.disabled = !useEmail; f.email.required = useEmail;
  });
  const show = (msg, error = false) => { status.hidden = false; status.className = error ? 'error' : ''; status.textContent = msg; };
  let busy = false;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy || sent) return;
    if (f.nome.value.trim().length < 2) { show('Informe seu nome para que possamos retornar.', true); f.nome.focus(); return; }
    const phone = f.telefone.value.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
    if (!/^\d{10,11}$/.test(phone)) { show('Confira o telefone: informe DDD e número, com 10 ou 11 dígitos.', true); f.telefone.focus(); return; }
    if (!f.situacao.value) { show('Escolha a situação mais parecida com a sua.', true); f.situacao.focus(); return; }
    if (f.preferencia.value === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email.value.trim())) { show('Informe um e-mail válido para o retorno.', true); f.email.focus(); return; }
    const relato = ['Situação: ' + f.situacao.value, f.cnpj.value.trim() ? 'CNPJ: ' + f.cnpj.value.trim() : '', f.valor.value.trim() ? 'Valor aproximado: ' + f.valor.value.trim() : '', f.relato.value.trim()].filter(Boolean).join('\n');
    const body = { page: PAGE, lead_ref: lead.ref, nome: f.nome.value.trim(), telefone: phone, preferencia: f.preferencia.value, email: f.preferencia.value === 'email' ? f.email.value.trim() : '', relato, site: f.site.value };
    const button = form.querySelector('[type="submit"]');
    busy = true; button.disabled = true; form.setAttribute('aria-busy', 'true'); show('Enviando…');
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 15000);
    try {
      const r = await fetch('/api/contas/contato', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
      const out = await r.json();
      if (!r.ok || out.ok !== true) throw new Error(out.error || 'Não foi possível registrar. Tente novamente ou fale pelo WhatsApp.');
      sent = true; closePrompt();
      form.querySelectorAll('input, select, textarea, button').forEach(x => { x.disabled = true; });
      show('Recebido. Referência: ' + lead.ref + '.');
      if (done) { done.classList.add('is-on'); done.focus({ preventScroll: true }); }
      track('lead_submit', { source: 'form' }); origin('form');
    } catch (err) {
      show(err.name === 'AbortError' || err instanceof TypeError || err instanceof SyntaxError ? 'Não conseguimos confirmar o envio. Seus dados continuam aqui. Tente de novo ou use o WhatsApp.' : err.message, true);
      button.disabled = false;
    } finally { clearTimeout(timer); busy = false; form.removeAttribute('aria-busy'); }
  });
})();
