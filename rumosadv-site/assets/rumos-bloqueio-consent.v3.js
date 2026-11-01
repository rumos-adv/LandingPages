(function () {
  'use strict';
  // This correction is deliberately limited to the two Bloqueio routes.
  var route = location.pathname.replace(/\/index\.html$/, '/').replace(/\/$/, '');
  if (route !== '/bloqueio-judicial' && route !== '/bloqueio-conta-pessoal') return;
  if (window.RumosBloqueioConsent) return;
  var KEY = 'rumos_bloqueio_privacy_v3', VERSION = 3, POLICY = '2026-11-01';
  var MAX_AGE = 180 * 86400000;
  var node = document.currentScript;
  var mode = node ? node.getAttribute('data-measurement') : null;
  var offConfigured = !!(node && node.getAttribute('data-collection') === 'off');
  // Denial-only safety switch: it can never enable collection or grant consent.
  var offQuery = new URL(location.href).searchParams.get('rumos_measurement') === 'off';
  var off = offConfigured || offQuery;
  var pf = route === '/bloqueio-conta-pessoal';
  var conflict = !!window.RumosConsent || !!window.google_tag_manager ||
    !!document.querySelector('script[src*="/consent.v1.js"], script[src*="/consent.v2.js"], script[src*="googletagmanager.com/gtm.js"]');
  var blocked = conflict || (pf ? mode !== 'none' : mode !== 'gtm' && !(off && mode === 'none'));
  var production = /^(www\.)?rumosadv\.com\.br$/.test(location.hostname);
  var choice = readChoice(), loaded = false, banner, preferences, returnFocus, errorBox;
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  // Denial precedes every measurement command, even with a saved explicit choice.
  window.gtag('consent', 'default', consent(false, false));
  window.gtag('set', 'ads_data_redaction', true);
  window.gtag('set', 'url_passthrough', false);
  window.clarity = window.clarity || function () { (window.clarity.q = window.clarity.q || []).push(arguments); };

  function consent(a, m) {
    return { analytics_storage: a ? 'granted' : 'denied', ad_storage: m ? 'granted' : 'denied', ad_user_data: m ? 'granted' : 'denied', ad_personalization: m ? 'granted' : 'denied', functionality_storage: 'granted', security_storage: 'granted', personalization_storage: 'denied' };
  }
  function readChoice() {
    // Never migrate rumos_privacy_v1: v2 fabricated the same record as real v1 choices.
    try {
      var p = JSON.parse(localStorage.getItem(KEY));
      if (p && p.version === VERSION && p.scope === 'bloqueio' && p.policy === POLICY &&
          ['accept', 'reject', 'save'].indexOf(p.action) !== -1 &&
          typeof p.analytics === 'boolean' && typeof p.marketing === 'boolean' &&
          (p.action !== 'accept' || p.analytics && p.marketing) &&
          (p.action !== 'reject' || !p.analytics && !p.marketing) &&
          Number.isFinite(p.at) && p.at <= Date.now() && Date.now() - p.at < MAX_AGE) return p;
    } catch (e) { /* A missing or inaccessible record grants nothing. */ }
    return null;
  }
  function permitted(item) { return !blocked && !off && item; }
  function apply(item) {
    var p = permitted(item), a = !pf && !!(p && p.analytics), m = !pf && !!(p && p.marketing);
    window['ga-disable-G-SM1QE14GF3'] = !a;
    window.gtag('consent', 'update', consent(a, m));
    window.clarity('consentv2', { analytics_Storage: a ? 'granted' : 'denied', ad_Storage: m ? 'granted' : 'denied' });
    // PF's local choice may permit handoff to PJ; it never permits tags on PF itself.
    document.documentElement.dataset.consentAnalytics = a ? 'granted' : 'denied';
    document.documentElement.dataset.consentMarketing = m ? 'granted' : 'denied';
    if (!m && typeof window.fbq === 'function') window.fbq('consent', 'revoke');
  }
  function loadTags() {
    if (loaded || blocked || off || !production || pf || mode !== 'gtm' || !choice || !(choice.analytics || choice.marketing)) return;
    loaded = true;
    // Drop queued interactions, rather than retrospectively measuring pre-consent visits/clicks.
    window.dataLayer = window.dataLayer.filter(function (e) { return e && (e[0] === 'consent' || e[0] === 'set'); });
    window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    var script = document.createElement('script');
    script.id = 'rumos-bloqueio-consented-gtm'; script.async = true;
    script.src = 'https://www.googletagmanager.com/gtm.js?id=GTM-NQTH2XWD';
    document.head.appendChild(script);
  }
  function save(analytics, marketing, action) {
    var old = choice;
    var next = { version: VERSION, scope: 'bloqueio', policy: POLICY, action: action, at: Date.now(), analytics: analytics, marketing: marketing };
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
      choice = readChoice();
      if (!choice || choice.at !== next.at || choice.analytics !== analytics || choice.marketing !== marketing) throw new Error('storage');
    } catch (e) {
      choice = null; apply(null);
      errorBox.hidden = false;
      errorBox.textContent = 'Não foi possível guardar sua escolha. Os recursos opcionais continuam bloqueados. Você pode navegar e entrar em contato normalmente.';
      if (loaded) {
        // A write failure can leave the previous grant readable. Do not reload
        // into that grant. Remove only our record, or reload with collection off.
        var removed = false;
        try { localStorage.removeItem(KEY); removed = localStorage.getItem(KEY) === null; } catch (ignore) { /* Denial URL fallback below. */ }
        if (removed) location.reload();
        else {
          var safe = new URL(location.href); safe.searchParams.set('rumos_measurement', 'off');
          location.replace(safe.href);
        }
      }
      return;
    }
    errorBox.hidden = true;
    // A fresh explicit choice may leave the failure fallback, but never the
    // deployment's independent emergency switch or an incompatible bootstrap.
    if (offQuery && !offConfigured && !blocked) {
      apply(null);
      var resume = new URL(location.href); resume.searchParams.delete('rumos_measurement');
      location.replace(resume.href); return;
    }
    // Reload on either grant or revocation after loading: blocked GTM initialization tags
    // are not automatically replayed after a later grant. Do not synthesize conversions.
    if (loaded && old && (old.analytics !== analytics || old.marketing !== marketing)) {
      apply(null); location.reload(); return;
    }
    apply(choice); banner.hidden = true;
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
    loadTags();
  }
  function openSettings() {
    if (!banner) return;
    returnFocus = document.activeElement;
    banner.hidden = false; preferences.open = true;
    document.getElementById('rumos-cookie-analytics').checked = !!(choice && choice.analytics);
    document.getElementById('rumos-cookie-marketing').checked = !!(choice && choice.marketing);
    document.getElementById('rumos-consent-title').focus();
  }
  function mount() {
    var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/assets/consent.v1.css?v=20261027'; document.head.appendChild(css);
    banner = document.createElement('section'); banner.id = 'rumos-consent';
    banner.setAttribute('aria-labelledby', 'rumos-consent-title');
    banner.innerHTML = '<div><h2 id="rumos-consent-title" tabindex="-1">Sua privacidade, suas escolhas</h2><p>Na página empresarial, usamos análise de uso e publicidade somente após sua escolha. A página de conta pessoal permanece sem essas ferramentas. Suas preferências valem para estas duas páginas de bloqueio. Você pode recusar e continuar navegando ou entrando em contato normalmente. <a href="/politica-de-privacidade/#bloqueio">Política de Privacidade</a>.</p></div><div id="rumos-consent-actions"><button type="button" id="rumos-cookie-reject">Recusar opcionais</button><button type="button" id="rumos-cookie-accept">Aceitar todos</button></div><details id="rumos-consent-preferences"><summary>Gerenciar preferências</summary><p>Necessários: funcionamento, segurança e sua escolha. Sempre ativos.</p><label><input type="checkbox" id="rumos-cookie-analytics"> <span><strong>Análise de uso</strong> — Google Analytics e Microsoft Clarity na página empresarial.</span></label><label><input type="checkbox" id="rumos-cookie-marketing"> <span><strong>Publicidade</strong> — Google Ads e Meta Pixel na página empresarial.</span></label><p>A escolha permite levar parâmetros de origem entre estas páginas; identificadores publicitários exigem a finalidade Publicidade. Você pode alterar depois em “Preferências de cookies”. Alterar finalidades já carregadas atualiza esta página. Cookies anteriores podem continuar armazenados; você pode apagá-los no navegador.</p><button type="button" id="rumos-cookie-save">Salvar minhas escolhas</button></details><p id="rumos-consent-error" role="alert" hidden></p>';
    banner.hidden = !!choice && !blocked && !off; document.body.appendChild(banner);
    preferences = document.getElementById('rumos-consent-preferences');
    errorBox = document.getElementById('rumos-consent-error');
    if (blocked || off) {
      errorBox.hidden = false;
      errorBox.textContent = blocked ? 'Os recursos opcionais foram bloqueados por segurança devido a uma configuração incompatível. O contato continua disponível.' : offQuery ? 'A medição está desligada nesta navegação porque sua escolha não pôde ser guardada. Uma preferência anterior pode continuar no navegador. Para concluir a alteração, confirme sua escolha novamente quando o navegador permitir ou remova os dados deste site nas configurações do navegador. O contato continua disponível.' : 'A medição está temporariamente desligada. O contato continua disponível.';
    }
    document.getElementById('rumos-cookie-analytics').checked = !!(choice && choice.analytics);
    document.getElementById('rumos-cookie-marketing').checked = !!(choice && choice.marketing);
    document.getElementById('rumos-cookie-accept').addEventListener('click', function () { save(true, true, 'accept'); });
    document.getElementById('rumos-cookie-reject').addEventListener('click', function () { save(false, false, 'reject'); });
    document.getElementById('rumos-cookie-save').addEventListener('click', function () { save(document.getElementById('rumos-cookie-analytics').checked, document.getElementById('rumos-cookie-marketing').checked, 'save'); });
    var settings = document.createElement('button'); settings.id = 'rumos-cookie-settings'; settings.type = 'button'; settings.textContent = 'Preferências de cookies'; settings.setAttribute('aria-controls', 'rumos-consent'); settings.addEventListener('click', openSettings);
    var footer = document.querySelector('footer'); (footer || document.body).appendChild(settings);
    if (!footer) settings.dataset.floating = 'true';
    document.addEventListener('click', function (e) { if (e.target.closest('[data-open-cookie-settings]')) { e.preventDefault(); openSettings(); } });
    loadTags();
  }
  window.RumosBloqueioConsent = Object.freeze({
    version: VERSION, scope: 'bloqueio', policy: POLICY, blocked: blocked, collectionOff: off, open: openSettings,
    getChoice: function () {
      var p = permitted(readChoice());
      return p ? Object.freeze({ analytics: p.analytics, marketing: p.marketing }) : null;
    }
  });
  // Also prevents a mistakenly appended legacy bootstrap from granting automatically.
  if (!window.RumosConsent) window.RumosConsent = window.RumosBloqueioConsent;
  apply(choice);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
  window.addEventListener('storage', function (e) {
    if (e.key === KEY || e.key === null) { apply(null); location.reload(); }
  });
}());
