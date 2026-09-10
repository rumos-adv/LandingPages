(function () {
  'use strict';

  var PAGE = 'marcas';
  var SERVICE = 'Registro de marca no INPI';
  var FORM_ID = 'BzRag7';
  var STORAGE_PREFIX = 'rumos_trademark_intent_v1';
  var ATTRIBUTION_KEYS = [
    'gclid', 'gbraid', 'wbraid', 'fbclid',
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'
  ];
  var WEIGHTS = {
    scroll_50: 15,
    scroll_80: 10,
    view_pricing: 20,
    faq_price: 15,
    faq_timeline: 15,
    faq_inpi: 15,
    form_start: 25,
    whatsapp_click: 30,
    return_visit: 10,
    short_exit: -15
  };

  window.dataLayer = window.dataLayer || [];

  function safeStorage(storage) {
    try {
      var probe = STORAGE_PREFIX + '_probe';
      storage.setItem(probe, '1');
      storage.removeItem(probe);
      return storage;
    } catch (err) {
      return null;
    }
  }

  var local = safeStorage(window.localStorage);
  var session = safeStorage(window.sessionStorage);

  function parseJSON(value, fallback) {
    try { return value ? JSON.parse(value) : fallback; } catch (err) { return fallback; }
  }

  function randomId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return prefix + '_' + window.crypto.randomUUID();
    }
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  function getOrCreate(storage, key, prefix) {
    var value = storage && storage.getItem(key);
    if (!value) {
      value = randomId(prefix);
      if (storage) storage.setItem(key, value);
    }
    return value;
  }

  var visitorId = getOrCreate(local, STORAGE_PREFIX + '_visitor_id', 'visitor');
  var sessionId = getOrCreate(session, STORAGE_PREFIX + '_session_id', 'session');
  var params = new URLSearchParams(window.location.search);
  var currentAttribution = {};

  ATTRIBUTION_KEYS.forEach(function (key) {
    var value = params.get(key);
    if (value) currentAttribution[key] = value.slice(0, 500);
  });

  var firstTouchKey = STORAGE_PREFIX + '_first_touch';
  var lastTouchKey = STORAGE_PREFIX + '_last_touch';
  var firstTouch = parseJSON(local && local.getItem(firstTouchKey), null);
  var nowIso = new Date().toISOString();

  if (!firstTouch) {
    firstTouch = Object.assign({ captured_at: nowIso, landing_page: window.location.pathname }, currentAttribution);
    if (local) local.setItem(firstTouchKey, JSON.stringify(firstTouch));
  }

  var lastTouch = Object.assign({ captured_at: nowIso, landing_page: window.location.pathname }, currentAttribution);
  if (Object.keys(currentAttribution).length && local) {
    local.setItem(lastTouchKey, JSON.stringify(lastTouch));
  } else {
    lastTouch = parseJSON(local && local.getItem(lastTouchKey), lastTouch);
  }

  var visitsKey = STORAGE_PREFIX + '_visits';
  var visitData = parseJSON(local && local.getItem(visitsKey), { count: 0, last_session_id: null });
  var isReturnVisit = Boolean(visitData.last_session_id && visitData.last_session_id !== sessionId);
  if (visitData.last_session_id !== sessionId) {
    visitData.count += 1;
    visitData.last_session_id = sessionId;
    visitData.last_visit_at = nowIso;
    if (local) local.setItem(visitsKey, JSON.stringify(visitData));
  }

  var stateKey = STORAGE_PREFIX + '_state';
  var state = parseJSON(session && session.getItem(stateKey), {
    score: 0,
    signals: {},
    form_started: false,
    form_submitted: false
  });
  var activeSeconds = 0;
  var activeStartedAt = document.visibilityState === 'visible' ? Date.now() : null;
  var shortExitSent = false;

  function intentBand(score) {
    if (score >= 66) return 'alta_intencao';
    if (score >= 31) return 'interessado';
    return 'curioso';
  }

  function commonData() {
    return Object.assign({
      page: PAGE,
      service: SERVICE,
      visitor_id: visitorId,
      session_id: sessionId,
      intent_score: state.score,
      intent_band: intentBand(state.score),
      visit_count: visitData.count
    }, lastTouch);
  }

  function push(eventName, data) {
    var eventData = Object.assign({}, commonData(), data || {});
    window.dataLayer.push(Object.assign({ event: eventName }, eventData));

    // Encaminha os mesmos sinais para a tag Google já instalada pelo GTM.
    // Parâmetros aninhados são mantidos apenas no dataLayer, pois o GA4 aceita
    // como parâmetros de evento somente valores escalares.
    var analyticsData = {};
    Object.keys(eventData).forEach(function (key) {
      if (['string', 'number', 'boolean'].indexOf(typeof eventData[key]) !== -1) {
        analyticsData[key] = eventData[key];
      }
    });
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag('event', eventName, analyticsData);

    // Torna as gravações do Clarity filtráveis por faixa de intenção e origem.
    window.clarity = window.clarity || function () {
      (window.clarity.q = window.clarity.q || []).push(arguments);
    };
    window.clarity('set', 'intent_band', intentBand(state.score));
    window.clarity('set', 'intent_score', String(state.score));
    if (lastTouch.utm_source) window.clarity('set', 'utm_source', lastTouch.utm_source);
    if (lastTouch.utm_campaign) window.clarity('set', 'utm_campaign', lastTouch.utm_campaign);
  }

  function saveState() {
    if (session) session.setItem(stateKey, JSON.stringify(state));
  }

  function signal(name, extra) {
    if (state.signals[name]) return;
    state.signals[name] = new Date().toISOString();
    state.score = Math.max(0, Math.min(100, state.score + (WEIGHTS[name] || 0)));
    saveState();
    push(name, Object.assign({
      score_delta: WEIGHTS[name] || 0,
      signal: name
    }, extra || {}));
    push('intent_score_update', {
      score_delta: WEIGHTS[name] || 0,
      signal: name
    });
  }

  push('page_view_lp', {
    first_touch: firstTouch,
    returning_visitor: isReturnVisit
  });

  if (isReturnVisit) signal('return_visit');

  var scrollTicking = false;
  function checkScroll() {
    scrollTicking = false;
    var doc = document.documentElement;
    var maxScroll = Math.max(1, doc.scrollHeight - window.innerHeight);
    var depth = Math.round(Math.min(100, Math.max(0, window.scrollY / maxScroll * 100)));
    if (depth >= 50) signal('scroll_50', { scroll_depth: depth });
    if (depth >= 80) signal('scroll_80', { scroll_depth: depth });
  }
  window.addEventListener('scroll', function () {
    if (!scrollTicking) {
      scrollTicking = true;
      window.requestAnimationFrame(checkScroll);
    }
  }, { passive: true });
  checkScroll();

  document.querySelectorAll('a[data-wa-source][href^="https://wa.me/5519989119770"]').forEach(function (el) {
    el.addEventListener('click', function () {
      signal('whatsapp_click', { source: el.getAttribute('data-wa-source') });
    });
  });

  var faqItems = Array.prototype.slice.call(document.querySelectorAll('#faq .faq__item'));
  faqItems.forEach(function (item) {
    item.addEventListener('toggle', function () {
      if (!item.open) return;
      var question = (item.querySelector('summary') || {}).textContent || '';
      var normalized = question.toLocaleLowerCase('pt-BR');
      var signalName = 'faq_open';
      if (normalized.indexOf('quanto custa') !== -1) signalName = 'faq_price';
      else if (normalized.indexOf('quanto tempo') !== -1 || normalized.indexOf('prazo') !== -1) signalName = 'faq_timeline';
      else if (normalized.indexOf('sozinho') !== -1 || normalized.indexOf('inpi') !== -1) signalName = 'faq_inpi';

      push('faq_open', { faq_question: question.slice(0, 150), faq_type: signalName });
      if (signalName !== 'faq_open') signal(signalName, { faq_question: question.slice(0, 150) });
    });
  });

  var pricingItem = faqItems.find(function (item) {
    var summary = item.querySelector('summary');
    return summary && summary.textContent.toLocaleLowerCase('pt-BR').indexOf('quanto custa') !== -1;
  });
  if (pricingItem && 'IntersectionObserver' in window) {
    var priceTimer = null;
    var priceObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
          priceTimer = window.setTimeout(function () { signal('view_pricing'); }, 3000);
        } else if (priceTimer) {
          window.clearTimeout(priceTimer);
          priceTimer = null;
        }
      });
    }, { threshold: [0.6] });
    priceObserver.observe(pricingItem);
  }

  var tallyFrame = document.querySelector('iframe[data-tally-src*="/embed/' + FORM_ID + '"]');
  function markFormStart(method) {
    if (state.form_started) return;
    state.form_started = true;
    saveState();
    signal('form_start', { detection_method: method });
  }

  if (tallyFrame) {
    window.addEventListener('blur', function () {
      window.setTimeout(function () {
        if (document.activeElement === tallyFrame) markFormStart('iframe_focus');
      }, 0);
    });
  }

  if (!window.__tallyListenerInstalled) {
    window.__tallyListenerInstalled = true;
    window.addEventListener('message', function (e) {
      if (!tallyFrame || e.origin !== 'https://tally.so' || e.source !== tallyFrame.contentWindow) return;
      if (typeof e.data !== 'string' || e.data.indexOf('Tally.') === -1) return;
      try {
        var payload = JSON.parse(e.data);
        if (!payload.payload || payload.payload.formId !== FORM_ID) return;
        if (payload.event === 'Tally.FormPageView' || payload.event === 'Tally.FormStarted') {
          markFormStart(payload.event);
        }
        if (payload.event === 'Tally.FormSubmitted') {
          state.form_started = true;
          state.form_submitted = true;
          saveState();
          push('lead_submit', {
            form_id: payload.payload.formId,
            submission_id: payload.payload.id || null
          });
        }
      } catch (err) {}
    });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      activeStartedAt = Date.now();
    } else if (activeStartedAt) {
      activeSeconds += Math.round((Date.now() - activeStartedAt) / 1000);
      activeStartedAt = null;
    }
  });

  function finalActiveSeconds() {
    return activeSeconds + (activeStartedAt ? Math.round((Date.now() - activeStartedAt) / 1000) : 0);
  }

  window.addEventListener('pagehide', function () {
    var seconds = finalActiveSeconds();
    if (state.form_started && !state.form_submitted) {
      push('form_abandon', { active_seconds: seconds });
    }
    if (!shortExitSent && seconds < 15 && Object.keys(state.signals).length === 0) {
      shortExitSent = true;
      signal('short_exit', { active_seconds: seconds });
    }
    push('intent_session_end', {
      active_seconds: seconds,
      form_started: state.form_started,
      form_submitted: state.form_submitted,
      signals_count: Object.keys(state.signals).length
    });
  });
})();
