(function () {
  'use strict';
  if (window.__rumosBloqueioProfileInstalled) return;
  window.__rumosBloqueioProfileInstalled = true;

  var PROFILE_KEY = 'rumos_bloqueio_profile_v1';
  var CONSENT_KEY = 'rumos_bloqueio_privacy_v3';
  var choice = readProfile();
  var section = document.getElementById('rumos-profile-choice');
  var title = document.getElementById('rumos-profile-title');
  var toggle = document.getElementById('rumos-profile-toggle');
  var skip = document.getElementById('rumos-profile-skip');
  if (!section || !title || !toggle || !skip) return;

  function readProfile() {
    try {
      var value = JSON.parse(sessionStorage.getItem(PROFILE_KEY));
      if (value && value.version === 1 && (value.selected === null || value.selected === 'pf' || value.selected === 'pj') && typeof value.dismissed === 'boolean') return value;
    } catch (e) { /* Navigation still works when storage is unavailable. */ }
    return { version: 1, selected: null, dismissed: false };
  }
  function saveProfile() {
    try { sessionStorage.setItem(PROFILE_KEY, JSON.stringify(choice)); } catch (e) { /* Effective for the current page. */ }
  }
  function privacyChoice() {
    // Only the route-scoped CMP may authorize handoff. Never trust legacy v1 grants.
    var cmp = window.RumosBloqueioConsent;
    if (cmp && cmp.version === 3 && cmp.scope === 'bloqueio' && cmp.policy === '2026-11-01' && !cmp.blocked && !cmp.collectionOff) {
      var p = cmp.getChoice();
      if (p) return p;
    }
    return { analytics: false, marketing: false };
  }
  function permittedAttribution() {
    var result = new URLSearchParams();
    var c = privacyChoice();
    if (!c.analytics && !c.marketing) return result;
    var utms = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
    var ids = ['gclid', 'gbraid', 'wbraid', 'dclid', 'msclkid'];
    var incoming = new URL(location.href).searchParams;
    incoming.forEach(function (value, key) {
      if (utms.indexOf(key) === -1 && !(c.marketing && ids.indexOf(key) !== -1)) return;
      if (result.has(key) || !value || value.length > 256 || /[\r\n<>@]/.test(value)) return;
      if (/(?:https?:\/\/|wa\.me\/|\b(?:cpf|cnpj|senha|token|email|telefone)\s*[:=])/i.test(value)) return;
      result.set(key, value);
    });
    return result;
  }
  function refreshLinks() {
    document.querySelectorAll('[data-rumos-profile-link]').forEach(function (link) {
      var profile = link.getAttribute('data-rumos-profile-link');
      var route = profile === 'pf' ? '/bloqueio-conta-pessoal/' : '/bloqueio-judicial/';
      var url = new URL(route, location.origin);
      url.search = permittedAttribution().toString();
      // Keep a storage-failure denial active throughout this PF/PJ journey.
      if (new URL(location.href).searchParams.get('rumos_measurement') === 'off') url.searchParams.set('rumos_measurement', 'off');
      link.href = url.href;
    });
  }
  function updateVisibility() {
    section.hidden = choice.dismissed;
    toggle.setAttribute('aria-expanded', String(!choice.dismissed));
  }
  document.querySelectorAll('[data-rumos-profile-link]').forEach(function (link) {
    link.addEventListener('click', function (event) {
      refreshLinks();
      var explicitChoice = link.getAttribute('data-rumos-profile-choice');
      if (explicitChoice !== 'pf' && explicitChoice !== 'pj') return;
      choice.selected = explicitChoice;
      choice.dismissed = true;
      saveProfile(); updateVisibility();
      var current = document.documentElement.getAttribute('data-rumos-page-profile');
      if (current === explicitChoice && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        var main = document.getElementById('main');
        if (main) { main.setAttribute('tabindex', '-1'); main.focus(); }
      }
    });
  });
  toggle.addEventListener('click', function () {
    choice.dismissed = false; saveProfile(); updateVisibility();
    title.focus(); section.scrollIntoView({ block: 'start' });
  });
  skip.addEventListener('click', function () {
    choice.selected = null; choice.dismissed = true; saveProfile(); updateVisibility();
    var main = document.getElementById('main');
    if (main) { main.setAttribute('tabindex', '-1'); main.focus(); }
  });
  window.addEventListener('storage', function (event) { if (event.key === CONSENT_KEY || event.key === null) refreshLinks(); });
  document.addEventListener('click', function (event) {
    if (event.target.closest('#rumos-cookie-accept, #rumos-cookie-reject, #rumos-cookie-save')) setTimeout(refreshLinks, 0);
  });
  if (window.MutationObserver) {
    new MutationObserver(refreshLinks).observe(document.documentElement, { attributes: true, attributeFilter: ['data-consent-analytics', 'data-consent-marketing'] });
  }
  updateVisibility(); refreshLinks();
  // This functional component writes no events, dataLayer commands, cookies or contact data.
}());
