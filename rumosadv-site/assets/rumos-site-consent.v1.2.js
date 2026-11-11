/* DECISÃO DO TITULAR (Rod, 31/10/2026, reafirmada em 04/11/2026): o site mede por padrão,
   sem aviso de cookies, enquanto o tráfego for pequeno. Quem quiser recusar usa
   "Preferências de privacidade" no rodapé, e a recusa é respeitada. NÃO reverter para
   consentimento prévio (opt-in) sem pedido explícito do Rod. Ver /DECISOES.md. */
(function () {
  'use strict';
  // One explicit, finite public-site scope. Historical assets remain immutable and unreferenced.
  var ROUTES = {"/leilao-de-imovel":"gtm","/compra-imovel-na-planta":"gtm","/distrato-de-imovel":"gtm","/alimentos":"gtm","/artigos/anuncio-removido-denuncia-marca-marketplace":"gtm","/artigos/banco-cobrando-avalista-documentos":"gtm","/artigos/bem-depois-inventario-sobrepartilha":"gtm","/artigos/citacao-execucao-banco-prazos":"gtm","/artigos/confissao-divida-bancaria-antes-assinar":"gtm","/artigos/construcao-nao-averbada-venda-imovel":"gtm","/artigos/conta-empresa-bloqueada-sisbajud":"gtm","/artigos/conta-vendedor-invadida-provas-comunicacoes":"gtm","/artigos/contrato-de-gaveta-regularizacao":"gtm","/artigos/custos-inventario-sao-paulo":"gtm","/artigos/divida-empresa-patrimonio-socio-cobranca":"gtm","/artigos/dividas-falecido-heranca-documentos":"gtm","/artigos/divorcio-antes-partilha-bens":"gtm","/artigos/divorcio-imovel-financiado-partilha":"gtm","/artigos/documentos-para-abrir-inventario":"gtm","/artigos/empresa-certidao-negativa-impedimento":"gtm","/artigos/escopo-retrabalho-contrato-servicos":"gtm","/artigos/execucao-fiscal-prazos-garantia-prescricao":"gtm","/artigos/herdei-imovel-sem-escritura-inventario":"gtm","/artigos/herdeiro-nao-participa-inventario-documentos":"gtm","/artigos/herdeiros-cidades-diferentes-inventario":"gtm","/artigos":"none","/artigos/instagram-whatsapp-business-suspenso-empresa":"gtm","/artigos/inventario-atrasado-sao-paulo":"gtm","/artigos/inventario-cartorio-herdeiro-menor-campinas":"gtm","/artigos/marca-oposicao-inpi-manifestacao":"gtm","/artigos/matricula-escritura-iptu-diferencas":"gtm","/artigos/mercadoria-falsificada-notas-origem-marketplace":"gtm","/artigos/multa-saida-antecipada-contrato-servicos":"gtm","/artigos/pensao-filho-18-anos-exoneracao":"gtm","/artigos/questionario-lgpd-cliente-fornecedor":"gtm","/artigos/renovacao-automatica-contrato-prazo-aviso":"gtm","/artigos/saldo-retido-mercado-livre-shopee":"gtm","/artigos/separacao-fato-despesas-imovel-registros":"gtm","/artigos/transacao-pgfn-2026-descontos-parcelas":"gtm","/artigos/usucapiao-adjudicacao-compulsoria-documentos":"gtm","/artigos/vendedor-faleceu-sem-escritura-campinas":"gtm","/assessoria":"ga4","/bloqueio-conta-pessoal":"none","/bloqueio-judicial":"gtm","/contato":"gtm","/divida-ativa":"gtm","/divorcio":"gtm","/execucao":"gtm","/imoveis":"gtm","/":"gtm","/inventario":"gtm","/lgpd":"none","/lgpd-empresas":"ga4","/marcas":"gtm","/marketplace":"gtm","/politica-de-privacidade":"none","/rodrigo-moura-silva":"gtm","/artigos/bem-terceiro-penhorado-divida-empresa":"gtm","/artigos/execucao-imovel-oferecido-garantia":"gtm","/artigos/capag-pgfn-documentos-revisao":"gtm","/artigos/acordo-tributario-risco-rescisao":"gtm","/artigos/mesma-divida-cobrancas-diferentes":"gtm","/artigos/empresa-encerrada-continua-cobranca":"gtm","/artigos/pagamento-condicionado-aceite-cliente":"gtm","/artigos/limitacao-responsabilidade-indenizacao-contrato":"gtm","/artigos/notificacao-uso-marca-documentos":"gtm","/artigos/trocar-nome-logotipo-conferir-marca":"gtm","/whatsapp-banido":"gtm","/whatsapp-business-banido":"gtm"};
  function normalize(path) { var value = path.replace(/\/index\.html$/, '/').replace(/\/$/, '') || '/'; return value === '/assessoria.html' ? '/assessoria' : value; }
  var route = normalize(location.pathname);
  if (!Object.prototype.hasOwnProperty.call(ROUTES, route)) return;
  if (window.RumosJourneyConsent && window.RumosJourneyConsent.version === 1 && window.RumosJourneyConsent.scope === 'public-site-2026-11-01' && window.RumosJourneyConsent.policy === '2026-11-01-site-v1' && window.RumosJourneyConsent.interfaceVersion === 'discreto-1.1') return;
  var KEY = 'rumos_site_privacy_v1', VERSION = 1, POLICY = '2026-11-01-site-v1';
  var SCOPE = 'public-site-2026-11-01', JOURNEY_KEY = 'rumos_journey_privacy_v2', PREVIOUS_KEY = 'rumos_journey_privacy_v1', LEGACY_KEY = 'rumos_bloqueio_privacy_v3', ORIGINAL_KEY = 'rumos_privacy_v1';
  var PREVIOUS_ROUTES = {"/":"gtm","/artigos/conta-empresa-bloqueada-sisbajud":"gtm","/bloqueio-conta-pessoal":"none","/bloqueio-judicial":"gtm","/divida-ativa":"gtm","/divorcio":"gtm","/execucao":"gtm","/imoveis":"gtm","/inventario":"gtm","/lgpd":"none","/marketplace":"gtm","/politica-de-privacidade":"none"};
  var previousScope = Object.prototype.hasOwnProperty.call(PREVIOUS_ROUTES, route);
  var elevenScope = previousScope && route !== '/inventario';
  var originalScope = route === '/bloqueio-judicial' || route === '/bloqueio-conta-pessoal';
  var MAX_AGE = 180 * 86400000;
  var node = document.currentScript;
  var mode = node ? node.getAttribute('data-measurement') : null;
  var offConfigured = !!(node && node.getAttribute('data-collection') === 'off');
  // Denial-only safety switch: it can never enable collection or grant consent.
  var offQuery = new URL(location.href).searchParams.getAll('rumos_measurement').indexOf('off') !== -1;
  var off = offConfigured || offQuery;
  var conflict = !!window.RumosSiteConsent || !!window.RumosJourneyConsent || !!window.RumosConsent || !!window.RumosBloqueioConsent || !!window.google_tag_manager ||
    !!document.querySelector('script[src*="/consent.v1.js"], script[src*="/consent.v2.js"], script[src*="/rumos-bloqueio-consent.v3.js"], script[src*="/rumos-jornada-consent.v1.js"], script[src*="/rumos-jornada-consent.v2.js"], script[src*="googletagmanager.com/gtm.js"], script[src*="googletagmanager.com/gtag/js"]');
  var blocked = conflict || mode !== ROUTES[route] && !(off && mode === 'none');
  var production = /^(www\.)?rumosadv\.com\.br$/.test(location.hostname);
  // Sem escolha registrada, mede por padrão (decisão do titular; ver cabeçalho).
  var DEFAULT_CHOICE = Object.freeze({ version: VERSION, scope: SCOPE, policy: POLICY, analytics: true, marketing: true, at: Date.now(), byDefault: true });
  var choice = readChoice() || DEFAULT_CHOICE, loaded = false, offLinksInstalled = false, banner, preferences, returnFocus, errorBox, settings;
  var authorizedAtStart = !blocked && !off && (mode === 'gtm' && !!(choice && (choice.analytics || choice.marketing)) || mode === 'ga4' && !!(choice && choice.analytics));
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
  function validRecord(raw, version, scope, policy) {
    try {
      var p = JSON.parse(raw);
      if (p && p.version === version && p.scope === scope && p.policy === policy &&
          ['accept', 'reject', 'save'].indexOf(p.action) !== -1 &&
          typeof p.analytics === 'boolean' && typeof p.marketing === 'boolean' &&
          (p.action !== 'accept' || p.analytics && p.marketing) &&
          (p.action !== 'reject' || !p.analytics && !p.marketing) &&
          Number.isFinite(p.at) && p.at <= Date.now() && Date.now() - p.at < MAX_AGE) return p;
    } catch (e) { /* Invalid format grants nothing. */ }
    return null;
  }
  function readNewChoice() {
    try { return validRecord(localStorage.getItem(KEY), VERSION, SCOPE, POLICY); }
    catch (e) { return null; }
  }
  function originalPreference() {
    // Storage access failure must propagate to readChoice's fail-closed guard;
    // malformed JSON is merely an invalid, unusable record.
    var raw = localStorage.getItem(ORIGINAL_KEY);
    try {
      var p = JSON.parse(raw);
      if (p && p.version === 1 && typeof p.analytics === 'boolean' && typeof p.marketing === 'boolean' &&
          Number.isFinite(p.at) && p.at <= Date.now() && Date.now() - p.at < MAX_AGE) return p;
    } catch (e) { /* Never accept original-key grants; only its denials may restrict. */ }
    return null;
  }
  function olderPreference(key, version, scope, policy) {
    return validRecord(localStorage.getItem(key), version, scope, policy);
  }
  function recentDenials(item) {
    // A later refusal in an older preference UI may restrict, never expand,
    // the current scope. Keep original timestamps and records unchanged.
    var result = item;
    var older = [olderPreference(JOURNEY_KEY, 2, 'bloqueio-direct-inventario-v2', '2026-11-01-jornada-v2'), olderPreference(PREVIOUS_KEY, 1, 'bloqueio-direct-v1', '2026-11-01-jornada-v1'), olderPreference(LEGACY_KEY, 3, 'bloqueio', '2026-11-01'), originalPreference()];
    older.forEach(function (p) {
      if (!p || p.at <= item.at) return;
      var a = result.analytics && p.analytics, m = result.marketing && p.marketing;
      if (a === result.analytics && m === result.marketing) return;
      result = Object.assign({}, result, { analytics: a, marketing: m, restrictedByPriorDenial: true });
    });
    return result;
  }
  function readChoice() {
    try {
      var raw = localStorage.getItem(KEY);
      // Any new record, even invalid/expired, supersedes old grants.
      if (raw !== null) {
        var current = validRecord(raw, VERSION, SCOPE, POLICY);
        return current ? recentDenials(current) : null;
      }
      raw = localStorage.getItem(JOURNEY_KEY);
      if (raw !== null) {
        var journey = validRecord(raw, 2, 'bloqueio-direct-inventario-v2', '2026-11-01-jornada-v2');
        if (!journey) return null;
        return previousScope || !journey.analytics && !journey.marketing ? recentDenials(journey) : null;
      }
      raw = localStorage.getItem(PREVIOUS_KEY);
      if (raw !== null) {
        var previous = validRecord(raw, 1, 'bloqueio-direct-v1', '2026-11-01-jornada-v1');
        if (!previous) return null;
        // Existing eleven-route grants remain eleven-route grants. A full
        // refusal can safely remain denied in Inventory without granting more.
        return elevenScope || !previous.analytics && !previous.marketing ? recentDenials(previous) : null;
      }
      var legacy = olderPreference(LEGACY_KEY, 3, 'bloqueio', '2026-11-01');
      if (legacy && (originalScope || !legacy.analytics && !legacy.marketing)) return recentDenials(legacy);
      var denial = originalPreference();
      return denial && !denial.analytics && !denial.marketing ? denial : null;
    } catch (e) { /* Inaccessible storage grants nothing. */ }
    return null;
  }
  function permitted(item) { return !blocked && !off && item; }
  function discardQueuedInteractions() {
    window.dataLayer = window.dataLayer.filter(function (e) { return e && (e[0] === 'consent' || e[0] === 'set' || mode === 'ga4' && (e[0] === 'js' || e[0] === 'config' && e[1] === 'G-WT5T6CK5JC')); });
  }
  function apply(item) {
    var p = permitted(item), a = (mode === 'gtm' || mode === 'ga4') && !!(p && p.analytics), m = mode === 'gtm' && !!(p && p.marketing);
    window['ga-disable-G-SM1QE14GF3'] = !(mode === 'gtm' && a);
    window['ga-disable-G-WT5T6CK5JC'] = !(mode === 'ga4' && a);
    window.gtag('consent', 'update', consent(a, m));
    window.clarity('consentv2', { analytics_Storage: a ? 'granted' : 'denied', ad_Storage: m ? 'granted' : 'denied' });
    // Informational none routes may store a choice, but never load optional tags.
    document.documentElement.dataset.consentAnalytics = a ? 'granted' : 'denied';
    document.documentElement.dataset.consentMarketing = m ? 'granted' : 'denied';
    if (!m && typeof window.fbq === 'function') window.fbq('consent', 'revoke');
  }
  function loadTags() {
    if (loaded || blocked || off || !production || mode === 'none' || !choice) return;
    if (mode === 'ga4' ? !choice.analytics : !(choice.analytics || choice.marketing)) return;
    var ga4 = 'https://www.googletagmanager.com/gtag/js?id=G-WT5T6CK5JC';
    if (mode === 'ga4') {
      var placeholders = document.querySelectorAll('script[data-rumos-analytics-src]');
      // Dedicated analytics pages retain their sole existing property. No arbitrary loader.
      if (placeholders.length !== 1 || placeholders[0].getAttribute('type') !== 'text/plain' || placeholders[0].getAttribute('data-rumos-analytics-src') !== ga4) {
        blocked = true; apply(null); errorBox.hidden = false;
        errorBox.textContent = 'A configuração de análise é incompatível. Os recursos opcionais permanecem bloqueados; o contato continua disponível.';
        return;
      }
    }
    loaded = true;
    // Keep initialization/configuration, never replay pre-consent interactions.
    if (!authorizedAtStart) discardQueuedInteractions();
    var script = document.createElement('script'); script.async = true;
    if (mode === 'ga4') {
      script.id = 'rumos-site-consented-ga4'; script.src = ga4;
    } else {
      window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
      script.id = 'rumos-site-consented-gtm'; script.src = 'https://www.googletagmanager.com/gtm.js?id=GTM-NQTH2XWD';
    }
    document.head.appendChild(script);
  }
  function save(analytics, marketing, action) {
    var old = choice;
    var next = { version: VERSION, scope: SCOPE, policy: POLICY, action: action, at: Date.now(), analytics: analytics, marketing: marketing };
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
      choice = readNewChoice();
      if (!choice || choice.at !== next.at || choice.analytics !== analytics || choice.marketing !== marketing) throw new Error('storage');
      // Apply only the effective permission, including any newer denial in
      // an older UI. A read failure must not authorize optional vendors.
      choice = readChoice();
      if (!choice || choice.at !== next.at || choice.analytics !== analytics || choice.marketing !== marketing) throw new Error('storage');
    } catch (e) {
      // Even a none route can pass a readable old grant to another route. A
      // failed write must deny the API and the whole allowlisted navigation,
      // regardless of whether this page ever loaded a vendor. Keep old records.
      choice = null; off = true; apply(null); preserveOffLinks();
      errorBox.hidden = false;
      errorBox.textContent = 'Não foi possível guardar sua escolha. Os recursos opcionais continuam bloqueados. Você pode navegar e entrar em contato normalmente.';
      var safe = new URL(location.href); safe.searchParams.set('rumos_measurement', 'off');
      location.replace(safe.href);
      return;
    }
    errorBox.hidden = true;
    // A fresh explicit choice may leave the failure fallback, but never the
    // deployment's independent emergency switch or an incompatible bootstrap.
    if (off && !offConfigured && !blocked) {
      apply(null);
      var resume = new URL(location.href); resume.searchParams.delete('rumos_measurement');
      location.replace(resume.href); return;
    }
    // Reload on either grant or revocation after loading: blocked GTM initialization tags
    // are not automatically replayed after a later grant. Do not synthesize conversions.
    if (loaded && old && (old.analytics !== analytics || old.marketing !== marketing)) {
      apply(null); location.reload(); return;
    }
    apply(choice); closeSettings();
    loadTags();
  }
  function closeSettings() {
    if (!banner) return;
    banner.hidden = true;
    if (settings) settings.setAttribute('aria-expanded', 'false');
    if (returnFocus && returnFocus.isConnected) returnFocus.focus();
  }
  function openSettings() {
    if (!banner) return;
    returnFocus = document.activeElement;
    banner.hidden = false; preferences.open = true;
    if (settings) settings.setAttribute('aria-expanded', 'true');
    document.getElementById('rumos-cookie-analytics').checked = !!(choice && choice.analytics);
    document.getElementById('rumos-cookie-marketing').checked = !!(choice && choice.marketing);
    document.getElementById('rumos-consent-title').focus();
    banner.scrollIntoView({ block: 'start', behavior: 'auto' });
  }
  function preserveOffLinks() {
    if (!off || offLinksInstalled) return;
    offLinksInstalled = true;
    function protect(link) {
      try {
        var raw = link.getAttribute('href');
        if (!raw || raw.charAt(0) === '#') return;
        var url = new URL(raw, location.href);
        var dest = normalize(url.pathname);
        if (url.origin !== location.origin || !Object.prototype.hasOwnProperty.call(ROUTES, dest)) return;
        ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'gbraid', 'wbraid', 'dclid', 'msclkid'].forEach(function (key) { url.searchParams.delete(key); });
        url.searchParams.set('rumos_measurement', 'off'); link.href = url.href;
      } catch (e) { /* Keep ordinary navigation if a URL cannot be parsed. */ }
    }
    document.querySelectorAll('a[href]').forEach(protect);
    document.addEventListener('click', function (e) { var link = e.target.closest('a[href]'); if (link) protect(link); });
  }
  function mount() {
    var css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/assets/rumos-consent-discreto.v1.css?v=20261101'; document.head.appendChild(css);
    banner = document.createElement('section'); banner.id = 'rumos-consent';
    banner.setAttribute('aria-labelledby', 'rumos-consent-title');
    banner.innerHTML = '<div id="rumos-consent-header"><h2 id="rumos-consent-title" tabindex="-1">Sua privacidade, suas escolhas</h2><button type="button" id="rumos-cookie-close">Fechar preferências</button></div><div><p>Nas páginas públicas listadas na Política de Privacidade, usamos ferramentas de análise e publicidade. Você pode recusá-las aqui, e a recusa fica guardada neste navegador. Algumas páginas usam análise e publicidade; Assessoria e LGPD para empresas usam somente análise. Conta pessoal, o índice de artigos, LGPD e Política de Privacidade permanecem sem essas ferramentas. As quatro páginas operacionais de Marcas não fazem parte deste escopo. Você pode recusar e continuar navegando ou entrando em contato normalmente. <a href="/politica-de-privacidade/#consentimento-site">Política de Privacidade</a>.</p></div><div id="rumos-consent-actions"><button type="button" id="rumos-cookie-reject">Recusar opcionais</button><button type="button" id="rumos-cookie-accept">Aceitar todos</button></div><details id="rumos-consent-preferences"><summary>Gerenciar preferências</summary><p>Necessários: funcionamento, segurança e sua escolha. Sempre ativos.</p><label><input type="checkbox" id="rumos-cookie-analytics"> <span><strong>Análise de uso</strong> — Google Analytics e Microsoft Clarity nas páginas aplicáveis da lista.</span></label><label><input type="checkbox" id="rumos-cookie-marketing"> <span><strong>Publicidade</strong> — Google Ads e Meta Pixel somente nas páginas da lista que usam o contêiner compartilhado.</span></label><p>A escolha permite levar parâmetros de origem entre estas páginas; identificadores publicitários exigem a finalidade Publicidade. Você pode alterar depois em “Preferências de privacidade”. Alterar finalidades já carregadas atualiza esta página. Cookies anteriores podem continuar armazenados; você pode apagá-los no navegador.</p><button type="button" id="rumos-cookie-save">Salvar minhas escolhas</button></details><p id="rumos-consent-error" role="alert" hidden></p>';
    if (choice && choice.policy !== POLICY) banner.innerHTML += '<p>Suas escolhas anteriores são preservadas nos escopos originais. Recusas continuam negadas; nenhum aceite é estendido automaticamente a novas páginas ou finalidades. Para autorizar as 54 páginas públicas listadas, confirme uma nova escolha.</p>';
    if (choice && choice.restrictedByPriorDenial) banner.innerHTML += '<p>Há uma recusa mais recente registrada em uma interface anterior. Ela permanece respeitada. Para atualizar suas preferências nesta jornada, confirme uma nova escolha.</p>';
    // Entry never opens a panel or moves focus. No choice means no optional grant.
    banner.hidden = true;
    var footer = document.querySelector('footer'); (footer || document.body).appendChild(banner);
    preferences = document.getElementById('rumos-consent-preferences');
    errorBox = document.getElementById('rumos-consent-error');
    if (blocked || off) {
      errorBox.hidden = false;
      errorBox.textContent = blocked ? 'Os recursos opcionais foram bloqueados por segurança devido a uma configuração incompatível. O contato continua disponível.' : offConfigured ? 'A medição está temporariamente desligada. O contato continua disponível.' : 'A medição está desligada nesta navegação até uma nova confirmação de preferências. Registros anteriores podem continuar no navegador. Para atualizar sua escolha, confirme as preferências quando o navegador permitir ou remova os dados deste site nas configurações do navegador. O contato continua disponível.';
    }
    document.getElementById('rumos-cookie-analytics').checked = !!(choice && choice.analytics);
    document.getElementById('rumos-cookie-marketing').checked = !!(choice && choice.marketing);
    document.getElementById('rumos-cookie-accept').addEventListener('click', function () { save(true, true, 'accept'); });
    document.getElementById('rumos-cookie-reject').addEventListener('click', function () { save(false, false, 'reject'); });
    document.getElementById('rumos-cookie-save').addEventListener('click', function () { save(document.getElementById('rumos-cookie-analytics').checked, document.getElementById('rumos-cookie-marketing').checked, 'save'); });
    document.getElementById('rumos-cookie-close').addEventListener('click', closeSettings);
    banner.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !banner.hidden) { e.preventDefault(); closeSettings(); } });
    settings = document.createElement('button'); settings.id = 'rumos-cookie-settings'; settings.type = 'button'; settings.textContent = 'Preferências de privacidade'; settings.setAttribute('aria-controls', 'rumos-consent'); settings.setAttribute('aria-expanded', 'false'); settings.addEventListener('click', openSettings);
    (footer || document.body).appendChild(settings);
    document.addEventListener('click', function (e) { if (e.target.closest('[data-open-cookie-settings]')) { e.preventDefault(); openSettings(); } });
    preserveOffLinks(); loadTags();
  }
  window.RumosSiteConsent = window.RumosJourneyConsent = Object.freeze({
    version: VERSION, scope: SCOPE, policy: POLICY, interfaceVersion: 'discreto-1.1', get blocked() { return blocked; }, get collectionOff() { return off; }, open: openSettings,
    getChoice: function () {
      var p = permitted(readChoice() || DEFAULT_CHOICE);
      return p ? Object.freeze({ analytics: p.analytics, marketing: p.marketing }) : null;
    }
  });
  // Also prevents a mistakenly appended legacy bootstrap from granting automatically.
  if (!window.RumosConsent) window.RumosConsent = window.RumosJourneyConsent;
  window.RumosBloqueioConsent = window.RumosJourneyConsent;
  // Entries queued before this bootstrap have no established permission here.
  if (authorizedAtStart) discardQueuedInteractions();
  apply(choice);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
  window.addEventListener('storage', function (e) {
    var original = null, originalReadFailed = false;
    if (e.key === ORIGINAL_KEY) {
      try { original = originalPreference(); } catch (error) { originalReadFailed = true; }
    }
    if (e.key === KEY || e.key === null) {
      var valid = e.key === KEY && readNewChoice();
      choice = null; off = true; apply(null); preserveOffLinks();
      if (valid) location.reload();
      else { var cleared = new URL(location.href); cleared.searchParams.set('rumos_measurement', 'off'); location.replace(cleared.href); }
    } else if (e.key === JOURNEY_KEY || e.key === PREVIOUS_KEY || e.key === LEGACY_KEY || originalReadFailed || original && (!original.analytics || !original.marketing)) {
      // Preserve denial across the reload when another, older UI changes.
      choice = null; off = true; apply(null); preserveOffLinks();
      var safe = new URL(location.href); safe.searchParams.set('rumos_measurement', 'off'); location.replace(safe.href);
    }
  });
}());
