(function(window, document) {
  'use strict';

  const STORAGE_KEY = 'rumos_marketing_consent_v1';
  const GTM_ID = 'GTM-NQTH2XWD';
  const GRANTED = 'granted';
  const DENIED = 'denied';
  let preference = readPreference();
  let gtmRequested = false;
  let banner = null;
  let reviewButton = null;

  function readPreference() {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      return stored === GRANTED || stored === DENIED ? stored : null;
    } catch {
      return null;
    }
  }

  function writePreference(value) {
    preference = value;
    try { window.localStorage.setItem(STORAGE_KEY, value); } catch {}
  }

  function loadGtm() {
    if (preference !== GRANTED || gtmRequested || document.querySelector('script[data-rumos-gtm]')) return false;
    gtmRequested = true;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(GTM_ID)}`;
    script.dataset.rumosGtm = GTM_ID;
    document.head.appendChild(script);
    return true;
  }

  function announceChoice(choice) {
    window.dispatchEvent(new CustomEvent('rumos:marketing-consent', {
      detail: { choice }
    }));
  }

  function closeChoices() {
    if (banner) banner.hidden = true;
    if (reviewButton) reviewButton.hidden = false;
  }

  function grant() {
    const changed = preference !== GRANTED;
    writePreference(GRANTED);
    loadGtm();
    closeChoices();
    if (changed) announceChoice(GRANTED);
  }

  function deny() {
    const hadActiveTag = preference === GRANTED || gtmRequested || Boolean(document.querySelector('script[data-rumos-gtm]'));
    const changed = preference !== DENIED;
    writePreference(DENIED);
    closeChoices();
    if (changed) announceChoice(DENIED);
    if (hadActiveTag && window.location && typeof window.location.reload === 'function') window.location.reload();
  }

  function track(event) {
    if (preference !== GRANTED || !event || typeof event !== 'object' || Array.isArray(event)) return false;
    loadGtm();
    window.dataLayer.push(event);
    return true;
  }

  function element(tag, properties = {}) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(properties)) {
      if (name === 'text') node.textContent = value;
      else if (name === 'className') node.className = value;
      else node.setAttribute(name, value);
    }
    return node;
  }

  function mountControls() {
    if (banner || !document.body) return;

    const style = element('style');
    style.textContent = '.rumos-consent{position:fixed;z-index:1000;left:1rem;right:1rem;bottom:1rem;max-width:760px;margin:auto;padding:1rem 1.15rem;background:#fbfaf9;color:#223a23;border:1px solid #d6b165;box-shadow:0 12px 32px rgba(34,58,35,.18);font:14px/1.5 Arial,sans-serif}.rumos-consent[hidden],.rumos-consent-review[hidden]{display:none!important}.rumos-consent p{margin:0 0 .75rem;color:#223a23}.rumos-consent a{color:#3d6420;text-decoration:underline}.rumos-consent__actions{display:flex;flex-wrap:wrap;gap:.6rem}.rumos-consent button,.rumos-consent-review{border:1px solid #3d6420;padding:.65rem .9rem;font:600 13px Arial,sans-serif;cursor:pointer}.rumos-consent__allow{background:#3d6420;color:#fff}.rumos-consent__deny,.rumos-consent-review{background:#fbfaf9;color:#223a23}.rumos-consent button:focus-visible,.rumos-consent-review:focus-visible{outline:3px solid #d6b165;outline-offset:2px}.rumos-consent-review{position:fixed;z-index:999;right:1rem;bottom:1rem}';
    document.head.appendChild(style);

    banner = element('section', {
      className: 'rumos-consent',
      role: 'dialog',
      'aria-modal': 'false',
      'aria-labelledby': 'rumos-consent-title',
      'aria-describedby': 'rumos-consent-description'
    });
    const title = element('strong', { id: 'rumos-consent-title', text: 'Preferências de privacidade' });
    const description = element('p', { id: 'rumos-consent-description' });
    description.appendChild(document.createTextNode('Com sua permissão, usamos Google e Meta para medir o desempenho das campanhas. Você pode continuar sem cookies de medição. Consulte a '));
    description.appendChild(element('a', { href: '/politica-de-privacidade/', text: 'Política de Privacidade' }));
    description.appendChild(document.createTextNode('.'));
    const actions = element('div', { className: 'rumos-consent__actions' });
    const allow = element('button', { type: 'button', className: 'rumos-consent__allow', text: 'Permitir medição' });
    const refuse = element('button', { type: 'button', className: 'rumos-consent__deny', text: 'Continuar sem cookies' });
    allow.addEventListener('click', grant);
    refuse.addEventListener('click', deny);
    actions.append(allow, refuse);
    banner.append(title, description, actions);

    reviewButton = element('button', {
      type: 'button',
      className: 'rumos-consent-review',
      text: 'Rever privacidade',
      'aria-label': 'Rever preferências de privacidade'
    });
    reviewButton.addEventListener('click', function() {
      reviewButton.hidden = true;
      banner.hidden = false;
      allow.focus();
    });

    document.body.append(banner, reviewButton);
    if (preference === GRANTED || preference === DENIED) {
      banner.hidden = true;
      reviewButton.hidden = false;
    } else {
      banner.hidden = false;
      reviewButton.hidden = true;
    }
  }

  window.RumosMarketing = Object.freeze({
    track,
    grant,
    deny,
    review() {
      mountControls();
      if (reviewButton) reviewButton.click();
    },
    preference() { return preference; }
  });

  if (preference === GRANTED) loadGtm();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountControls, { once: true });
  else mountControls();
})(window, document);
