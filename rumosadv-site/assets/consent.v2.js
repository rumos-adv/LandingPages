(function () {
  'use strict';
  // v2 (31/10/2026): sem aviso de cookies. As ferramentas de medição carregam ao abrir a página.
  // data-measurement: "gtm" (GTM completo), "ga4" (só Google Analytics) ou "none" (nada).
  if (window.RumosConsent) return;
  var production = /^(www\.)?rumosadv\.com\.br$/.test(location.hostname);
  var mode = document.currentScript ? document.currentScript.getAttribute('data-measurement') || 'gtm' : 'gtm';
  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window.gtag('consent', 'default', { analytics_storage: 'granted', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted', functionality_storage: 'granted', security_storage: 'granted', personalization_storage: 'denied' });
  // Mantém o registro no formato v1 como liberado, para scripts que o leem (ex.: rumos-bloqueio-pf-pj.v1.js).
  try { localStorage.setItem('rumos_privacy_v1', JSON.stringify({ version: 1, at: Date.now(), analytics: true, marketing: true })); } catch (error) { /* sem armazenamento */ }
  document.documentElement.dataset.consentAnalytics = 'granted';
  document.documentElement.dataset.consentMarketing = 'granted';
  window.RumosConsent = Object.freeze({ version: 2 });

  function loadTags() {
    if (!production || mode === 'none') return;
    if (mode === 'ga4') {
      document.querySelectorAll('script[data-rumos-analytics-src]').forEach(function (placeholder) {
        var tag = document.createElement('script'); tag.async = true; tag.src = placeholder.getAttribute('data-rumos-analytics-src'); document.head.appendChild(tag);
      });
      return;
    }
    window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
    var script = document.createElement('script');
    script.id = 'rumos-gtm'; script.async = true;
    script.src = 'https://www.googletagmanager.com/gtm.js?id=GTM-NQTH2XWD';
    document.head.appendChild(script);
  }
  // Placeholders do modo ga4 ficam no <body>; GTM pode carregar já.
  if (mode === 'ga4' && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadTags, { once: true }); else loadTags();
}());
