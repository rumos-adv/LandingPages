(() => {
  'use strict';
  const PAGE = 'dinheiro-retido';
  const form = document.getElementById('contact-form');
  const status = document.getElementById('form-status');
  const prompt = document.getElementById('return-prompt');
  const sticky = document.getElementById('sticky');
  const fields = form.elements;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.dataLayer = window.dataLayer || [];
  function track(event, extra = {}) {
    window.dataLayer.push({ event, page: PAGE, service: 'Saldo retido ou loja suspensa', lead_ref: lead.ref, ...extra });
  }
  // Referência própria desta página: não mistura o contato com campanhas de WhatsApp.
  const KEY = 'rumos_lead_dinheiro_retido';
  const params = new URLSearchParams(location.search);
  const originKeys = ['gclid','gbraid','wbraid','fbclid','utm_source','utm_medium','utm_campaign','utm_content','utm_term'];
  let lead = {};
  try { lead = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) {}
  if (!lead || typeof lead !== 'object' || Array.isArray(lead)) lead = {};
  const incoming = {};
  originKeys.forEach(key => { if (params.get(key)) incoming[key] = params.get(key).slice(0, 120); });
  if (Object.keys(incoming).some(key => incoming[key] !== lead[key])) lead = incoming;
  if (!/^C[A-Z0-9]{3,9}$/.test(lead.ref || '')) {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    lead.ref = 'C' + Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  }
  try { localStorage.setItem(KEY, JSON.stringify(lead)); } catch (_) {}
  function origin(source) {
    const body = { page: PAGE, source, lead_ref: lead.ref };
    originKeys.forEach(key => { if (lead[key]) body[key] = lead[key]; });
    const choice = window.RumosSiteConsent?.getChoice?.();
    if (!choice?.marketing) ['gclid','gbraid','wbraid','fbclid'].forEach(key => delete body[key]);
    const data = JSON.stringify(body);
    let queued = false;
    try { if (navigator.sendBeacon) queued = navigator.sendBeacon('/api/lead-origin', new Blob([data], { type: 'application/json' })); } catch (_) {}
    if (!queued) fetch('/api/lead-origin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: data, keepalive: true }).catch(() => {});
  }
  track('page_view_lp');
  let tapped = 0, sent = false, formVisible = false, heroVisible = true;
  let shown = false;
  const RETURN_KEY = 'rumos_return_dinheiro_retido';
  try { shown = sessionStorage.getItem(RETURN_KEY) === '1'; } catch (_) {}
  function closePrompt() { prompt.hidden = true; }
  function openPrompt() {
    if (shown || sent || formVisible || !tapped || Date.now() - tapped < 1500 || document.visibilityState !== 'visible') return;
    shown = true;
    try { sessionStorage.setItem(RETURN_KEY, '1'); } catch (_) {}
    prompt.hidden = false;
    track('contas_retorno_mostrar');
  }
  document.querySelectorAll('[data-wa-source]').forEach(link => {
    const url = new URL(link.href);
    url.searchParams.set('text', (url.searchParams.get('text') || '') + ' (Ref. ' + lead.ref + ')');
    link.href = url.toString();
    link.addEventListener('click', () => {
      tapped = Date.now();
      track('whatsapp_click', { source: link.dataset.waSource });
      origin(link.dataset.waSource);
      // Também oferece alternativa se o aplicativo não abrir. Não presume mensagem enviada.
      setTimeout(openPrompt, 6000);
    });
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') openPrompt(); });
  window.addEventListener('focus', openPrompt);
  window.addEventListener('pageshow', openPrompt);
  document.getElementById('return-close').addEventListener('click', () => { closePrompt(); track('contas_retorno_fechar'); });
  document.getElementById('return-sent').addEventListener('click', () => { closePrompt(); track('contas_retorno_ja_enviei'); });
  document.getElementById('return-go').addEventListener('click', event => {
    event.preventDefault(); closePrompt(); track('contas_retorno_abrir');
    document.getElementById('contato').scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth' });
    fields.nome.focus({ preventScroll: true });
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !prompt.hidden) closePrompt(); });
  document.querySelectorAll('a[href="#contato"]').forEach(link => link.addEventListener('click', () => track('contas_form_abrir')));
  if ('IntersectionObserver' in window) {
    const updateSticky = () => sticky.classList.toggle('visible', !heroVisible && !formVisible && !sent);
    new IntersectionObserver(entries => { heroVisible = entries[0].isIntersecting; updateSticky(); }).observe(document.querySelector('[data-wa-source="hero"]'));
    new IntersectionObserver(entries => { formVisible = entries[0].isIntersecting; if (formVisible) closePrompt(); updateSticky(); }, { threshold: 0 }).observe(form);
  }
  fields.preferencia.addEventListener('change', () => {
    const useEmail = fields.preferencia.value === 'email';
    document.getElementById('email-field').hidden = !useEmail;
    fields.email.required = useEmail;
    fields.email.disabled = !useEmail;
  });
  fields.email.disabled = true;
  const showStatus = (message, error = false) => {
    status.hidden = false;
    status.className = error ? 'error' : '';
    status.textContent = message;
  };
  let submitting = false;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting || sent || !form.reportValidity()) return;
    if (fields.nome.value.trim().length < 2) { showStatus('Informe seu nome para que possamos retornar.', true); fields.nome.focus(); return; }
    const phone = fields.telefone.value.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
    if (!/^\d{10,11}$/.test(phone)) { showStatus('Confira o telefone: informe DDD e número, com 10 ou 11 dígitos.', true); fields.telefone.focus(); return; }
    const relato = [fields.plataforma.value ? 'Plataforma: ' + fields.plataforma.value : '', fields.valor.value.trim() ? 'Valor retido informado: ' + fields.valor.value.trim() : '', fields.relato.value.trim()].filter(Boolean).join('\n');
    const body = { page: PAGE, lead_ref: lead.ref, nome: fields.nome.value.trim(), telefone: phone, preferencia: fields.preferencia.value, email: fields.preferencia.value === 'email' ? fields.email.value.trim() : '', relato, site: fields.site.value };
    const button = form.querySelector('[type="submit"]');
    submitting = true; button.disabled = true; form.setAttribute('aria-busy', 'true');
    showStatus('Enviando seu pedido…');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/contas/contato', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
      const result = await response.json();
      if (!response.ok || result.ok !== true) throw new Error(result.error || 'Não foi possível registrar o pedido. Tente novamente ou fale pelo WhatsApp.');
      sent = true; closePrompt(); sticky.classList.remove('visible');
      showStatus('Pedido recebido. Referência: ' + lead.ref + '. O Dr. Rodrigo retorna de segunda a sexta, das 9h às 18h, pelo meio escolhido.');
      form.querySelectorAll('input, select, textarea, button[type="submit"]').forEach(field => { field.disabled = true; });
      track('contas_form_enviado', { source: 'form' }); origin('form'); status.focus({ preventScroll: true });
    } catch (error) {
      showStatus(error.name === 'AbortError' ? 'O envio demorou mais que o esperado. Seus dados continuam aqui. Tente novamente ou use o WhatsApp.' : (error instanceof TypeError || error instanceof SyntaxError ? 'Não conseguimos confirmar o envio. Seus dados continuam aqui. Tente novamente ou use o WhatsApp.' : error.message), true);
      button.disabled = false;
    } finally {
      clearTimeout(timeout); submitting = false; form.removeAttribute('aria-busy');
    }
  });
})();

