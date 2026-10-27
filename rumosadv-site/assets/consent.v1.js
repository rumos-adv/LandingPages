(function () {
  'use strict';
  if (window.RumosConsent) return;
  var KEY = 'rumos_privacy_v1', MAX_AGE = 180 * 86400000, VERSION = 1;
  var production = /^(www\.)?rumosadv\.com\.br$/.test(location.hostname);
  var mode = document.currentScript ? document.currentScript.getAttribute('data-measurement') || 'gtm' : 'gtm';
  var choice = readChoice(), loaded = false, banner, preferences, returnFocus;
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  // Defaults precede every measurement command, including a previously saved choice.
  window.gtag('consent', 'default', consent(false, false));
  window.gtag('set', 'ads_data_redaction', true);
  window.gtag('set', 'url_passthrough', false);
  window.clarity = window.clarity || function () { (window.clarity.q = window.clarity.q || []).push(arguments); };

  function consent(analytics, marketing) {
    return { analytics_storage: analytics ? 'granted' : 'denied', ad_storage: marketing ? 'granted' : 'denied', ad_user_data: marketing ? 'granted' : 'denied', ad_personalization: marketing ? 'granted' : 'denied', functionality_storage: 'granted', security_storage: 'granted', personalization_storage: 'denied' };
  }
  function readChoice() {
    try {
      var item = JSON.parse(localStorage.getItem(KEY));
      if (item && item.version === VERSION && typeof item.analytics === 'boolean' && typeof item.marketing === 'boolean' && Number.isFinite(item.at) && item.at <= Date.now() && Date.now() - item.at < MAX_AGE) return item;
    } catch (error) { /* Storage denied: remain denied and show the choice again. */ }
    return null;
  }
  function apply(item) {
    var a = !!(item && item.analytics), m = mode === 'gtm' && !!(item && item.marketing);
    window['ga-disable-G-SM1QE14GF3'] = !a;
    window.gtag('consent', 'update', consent(a, m));
    window.clarity('consentv2', { analytics_Storage: a ? 'granted' : 'denied', ad_Storage: m ? 'granted' : 'denied' });
    document.documentElement.dataset.consentAnalytics = a ? 'granted' : 'denied';
    document.documentElement.dataset.consentMarketing = m ? 'granted' : 'denied';
    if (!m && typeof window.fbq === 'function') window.fbq('consent', 'revoke');
  }
  function loadTags() {
    if (loaded || !production || !choice || mode === 'none' || !(choice.analytics || choice.marketing)) return;
    if (mode === 'ga4' && !choice.analytics) return;
    loaded = true;
    // Never replay interactions made before consent was given.
    window.dataLayer = window.dataLayer.filter(function (entry) { return entry && typeof entry[0] === 'string' && entry[0] !== 'event'; });
    if (mode === 'ga4') {
      document.querySelectorAll('script[data-rumos-analytics-src]').forEach(function (placeholder) {
        var tag = document.createElement('script'); tag.async = true; tag.src = placeholder.getAttribute('data-rumos-analytics-src'); document.head.appendChild(tag);
      });
      return;
    }
    window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    var script = document.createElement('script');
    script.id = 'rumos-consented-gtm'; script.async = true;
    script.src = 'https://www.googletagmanager.com/gtm.js?id=GTM-NQTH2XWD';
    document.head.appendChild(script);
  }
  function clearCookies(analytics, marketing) {
    var domains = [null, location.hostname, '.rumosadv.com.br', 'rumosadv.com.br'];
    document.cookie.split(';').forEach(function (part) {
      var name = part.split('=')[0].trim();
      if (!((analytics && /^(?:_ga|_gid|_gat|_clck|_clsk)/.test(name)) || (marketing && /^(?:_fbp|_fbc|_gcl|_gac)/.test(name)))) return;
      domains.forEach(function (domain) { document.cookie = name + '=; Max-Age=0; Path=/; SameSite=Lax' + (domain ? '; Domain=' + domain : ''); });
    });
  }
  function save(analytics, marketing) {
    var old = choice, wasLoaded = loaded;
    choice = { version: VERSION, at: Date.now(), analytics: analytics, marketing: marketing };
    try { localStorage.setItem(KEY, JSON.stringify(choice)); } catch (error) { /* Current-page choice remains effective. */ }
    apply(choice);
    clearCookies(!analytics, !marketing);
    banner.hidden = true;
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
    // A fresh document also stops scripts which were already running before revocation.
    if (wasLoaded && old && (old.analytics !== analytics || old.marketing !== marketing)) { location.reload(); return; }
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
    banner.innerHTML = '<div><h2 id="rumos-consent-title" tabindex="-1">Sua privacidade, suas escolhas</h2><p>Com sua autorização, usamos cookies para entender o uso do site e medir anúncios. Você pode recusar os opcionais e continuar navegando e entrando em contato normalmente. <a href="/politica-de-privacidade/">Política de Privacidade</a>.</p></div><div id="rumos-consent-actions"><button type="button" id="rumos-cookie-reject">Recusar opcionais</button><button type="button" id="rumos-cookie-accept">Aceitar todos</button></div><details id="rumos-consent-preferences"><summary>Gerenciar preferências</summary><p>Necessários: mantêm o funcionamento e guardam sua escolha. Sempre ativos.</p><label><input type="checkbox" id="rumos-cookie-analytics"> <span><strong>Análise de uso</strong> — Google Analytics e Microsoft Clarity para estatísticas e compreensão da navegação.</span></label><label><input type="checkbox" id="rumos-cookie-marketing"> <span><strong>Publicidade</strong> — Google Ads e Meta Pixel para medir anúncios e formar públicos de visitantes.</span></label><p>Você pode alterar sua escolha depois em “Preferências de cookies”. Uma alteração poderá atualizar esta página.</p><button type="button" id="rumos-cookie-save">Salvar minhas escolhas</button></details>';
    banner.hidden = !!choice; document.body.appendChild(banner);
    preferences = document.getElementById('rumos-consent-preferences');
    document.getElementById('rumos-cookie-analytics').checked = !!(choice && choice.analytics);
    document.getElementById('rumos-cookie-marketing').checked = !!(choice && choice.marketing);
    document.getElementById('rumos-cookie-accept').addEventListener('click', function () { save(true, true); });
    document.getElementById('rumos-cookie-reject').addEventListener('click', function () { save(false, false); });
    document.getElementById('rumos-cookie-save').addEventListener('click', function () { save(document.getElementById('rumos-cookie-analytics').checked, document.getElementById('rumos-cookie-marketing').checked); });
    var settings = document.createElement('button'); settings.id = 'rumos-cookie-settings'; settings.type = 'button'; settings.textContent = 'Preferências de cookies'; settings.setAttribute('aria-controls', 'rumos-consent'); settings.addEventListener('click', openSettings);
    var footer = document.querySelector('footer'); (footer || document.body).appendChild(settings);
    if (!footer) settings.dataset.floating = 'true';
    document.addEventListener('click', function (event) { if (event.target.closest('[data-open-cookie-settings]')) { event.preventDefault(); openSettings(); } });
    apply(choice); loadTags();
  }
  window.RumosConsent = Object.freeze({ open: openSettings, version: VERSION });
  apply(choice);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
  window.addEventListener('storage', function (event) { if (event.key === KEY) location.reload(); });
}());
