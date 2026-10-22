/* Sem dependências. Arquivos de teste são abertos localmente, sem upload. */
(() => {
  'use strict';
  const triggers = Array.from(document.querySelectorAll('[data-rumos-video]'));
  if (!triggers.length) return;
  const preview = !['rumosadv.com.br', 'www.rumosadv.com.br'].includes(location.hostname);
  const records = new Map();
  const objectURLs = new Set();
  const finePointer = matchMedia('(hover:hover) and (pointer:fine)');
  const playIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="m8 5 11 7-11 7z"/></svg>';
  const closeIcon = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg>';
  let active = null;
  let pendingClose;
  let layoutFrame;

  function track(event, record, extra = {}) {
    if (preview) return;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event, page:'inventario', video_id:record.id, ...extra });
  }

  function isInline() { return innerWidth < 720 || innerHeight < 560; }

  function position(record) {
    if (!record || record.panel.hidden) return;
    const inline = isInline();
    record.panel.dataset.inline = String(inline);
    document.body.classList.toggle('rumos-video-inline-open',inline);
    if (inline) {
      if (record.panel.parentNode !== record.host) record.host.append(record.panel);
      record.panel.style.removeProperty('left');
      record.panel.style.removeProperty('top');
      return;
    }
    if (record.panel.parentNode !== document.body) document.body.append(record.panel);
    const anchor = record.trigger.getBoundingClientRect();
    const box = record.panel.getBoundingClientRect();
    const margin = 16;
    const gap = 14;
    const right = anchor.right + gap;
    const left = anchor.left - box.width - gap;
    let x;
    let y;
    const hero = record.trigger.closest('.hero--inventario');
    const portrait = hero && hero.querySelector('.hero-portrait');
    const portraitBox = portrait && portrait.getBoundingClientRect();
    if (portraitBox && portraitBox.width >= box.width + margin * 2) {
      // Na abertura, o vídeo ocupa a coluna da foto e mantém o título legível.
      x = portraitBox.left + (portraitBox.width - box.width) / 2;
      y = anchor.top - 12;
    } else if (right + box.width <= innerWidth - margin) {
      x = right; y = anchor.top - 12;
    } else if (left >= margin) {
      x = left; y = anchor.top - 12;
    } else {
      x = Math.max(margin, Math.min(anchor.left, innerWidth - box.width - margin));
      y = anchor.bottom + gap;
      if (y + box.height > innerHeight - margin) y = anchor.top - box.height - gap;
    }
    record.panel.style.left = Math.round(x) + 'px';
    record.panel.style.top = Math.round(Math.max(margin, Math.min(y,innerHeight-box.height-margin))) + 'px';
  }

  function close({restoreFocus = false} = {}) {
    clearTimeout(pendingClose);
    if (!active) return;
    const record = active;
    record.player.pause();
    record.panel.hidden = true;
    record.trigger.setAttribute('aria-expanded','false');
    record.pinned = false;
    active = null;
    document.body.classList.remove('rumos-video-inline-open');
    if (restoreFocus) record.trigger.focus({preventScroll:true});
  }

  function message(record, text, error = false) {
    record.message.textContent = text;
    record.message.dataset.error = String(error);
    position(record);
  }

  function resetPlayer(record) {
    record.player.pause();
    record.player.removeAttribute('src');
    record.player.load();
    record.player.hidden = true;
    record.cover.hidden = false;
    record.play.hidden = !record.source;
    record.badge.hidden = false;
    record.badge.textContent = record.source ? 'Gravação de teste' : 'Vídeo em preparação';
    record.started = false;
    record.progress = new Set();
  }

  function start(record) {
    if (!record.source) return;
    record.pinned = true;
    if (record.player.getAttribute('src') !== record.source) record.player.src = record.source;
    record.player.hidden = false;
    record.cover.hidden = true;
    record.play.hidden = true;
    record.badge.hidden = true;
    message(record,'');
    record.player.play().catch(() => {
      if (!record.player.error) message(record,'Use o botão de reprodução do vídeo para começar.');
    });
  }

  function build(trigger) {
    const id = trigger.dataset.rumosVideo;
    if (records.has(id)) return records.get(id);
    const host = trigger.closest('.rumos-video-host');
    const panel = document.createElement('div');
    panel.id = trigger.getAttribute('aria-controls');
    panel.className = 'rumos-video-panel';
    panel.setAttribute('role','region');
    panel.setAttribute('aria-label',trigger.dataset.videoTitle);
    panel.hidden = true;
    panel.innerHTML = '<div class="rumos-video-media">' +
      '<div class="rumos-video-cover"><img src="/assets/img/rodrigo-moura-800.webp" width="720" height="720" loading="lazy" decoding="async" alt="Rodrigo Moura Silva, advogado da Rumos Advocacia">' +
      '<div class="rumos-video-caption"><h3 class="rumos-video-title"></h3><div class="rumos-video-byline">Dr. Rodrigo Moura Silva<br>Rumos Advocacia · OAB/SP 188.004</div></div></div>' +
      '<video class="rumos-video-player" controls playsinline preload="none" hidden></video>' +
      '<span class="rumos-video-badge">Vídeo em preparação</span>' +
      '<button type="button" class="rumos-video-play" aria-label="Reproduzir vídeo" hidden>' + playIcon + '</button>' +
      '<button type="button" class="rumos-video-close" aria-label="Fechar vídeo">' + closeIcon + '</button></div>' +
      '<p class="rumos-video-message" role="status" aria-live="polite"></p>';
    const record = {
      id, trigger, host, panel, player:panel.querySelector('video'),
      cover:panel.querySelector('.rumos-video-cover'), play:panel.querySelector('.rumos-video-play'),
      badge:panel.querySelector('.rumos-video-badge'), message:panel.querySelector('.rumos-video-message'),
      source:trigger.dataset.videoSrc || '', pinned:false, started:false, progress:new Set()
    };
    panel.querySelector('img').src = trigger.dataset.videoPoster;
    panel.querySelector('img').alt = 'Rodrigo Moura Silva, advogado da Rumos Advocacia';
    panel.querySelector('h3').textContent = trigger.dataset.videoTitle;
    record.player.setAttribute('aria-label',trigger.dataset.videoTitle);
    if (trigger.dataset.videoCaptions) {
      const captions = document.createElement('track');
      Object.assign(captions,{kind:'captions',src:trigger.dataset.videoCaptions,srclang:'pt-BR',label:'Português',default:true});
      record.player.append(captions);
    }
    if (record.source) {
      record.badge.textContent = trigger.dataset.videoDuration + ' segundos';
      record.play.hidden = false;
    }
    if (preview) {
      const review = document.createElement('div');
      review.className = 'rumos-video-review';
      const note = document.createElement('p');
      note.textContent = 'Escolha uma gravação para testar neste cartão. O arquivo fica só neste navegador, até recarregar a página.';
      const label = document.createElement('label');
      label.className = 'rumos-video-file-label';
      label.htmlFor = 'rumos-video-file-' + id;
      label.textContent = 'Testar uma gravação';
      const input = document.createElement('input');
      input.id = label.htmlFor;
      input.className = 'rumos-video-file';
      input.type = 'file';
      input.accept = 'video/*,.mp4,.webm,.mov';
      input.addEventListener('change',() => {
        const file = input.files && input.files[0];
        if (!file) return;
        if (!file.type.startsWith('video/') && !/\.(mp4|webm|mov|m4v)$/i.test(file.name)) {
          message(record,'Escolha um arquivo de vídeo, como MP4 ou WebM.',true);
          input.value = '';
          return;
        }
        if (record.localURL) { URL.revokeObjectURL(record.localURL); objectURLs.delete(record.localURL); }
        record.localURL = URL.createObjectURL(file);
        objectURLs.add(record.localURL);
        record.source = record.localURL;
        resetPlayer(record);
        message(record,'Gravação de teste aberta neste navegador.');
        start(record);
      });
      review.append(note,label,input);
      panel.append(review);
    }
    record.play.addEventListener('click',() => start(record));
    panel.querySelector('.rumos-video-close').addEventListener('click',() => close({restoreFocus:true}));
    panel.addEventListener('pointerenter',() => clearTimeout(pendingClose));
    panel.addEventListener('pointerleave',scheduleClose);
    panel.addEventListener('focusin',() => { clearTimeout(pendingClose); record.pinned=true; });
    record.player.addEventListener('error',() => {
      record.player.pause();
      record.player.hidden = true;
      record.cover.hidden = false;
      record.play.hidden = true;
      record.badge.hidden = false;
      message(record,'Não foi possível reproduzir este arquivo. Tente um MP4 com vídeo H.264 e áudio AAC.',true);
    });
    record.player.addEventListener('play',() => {
      if (!record.started) { record.started=true; track('context_video_start',record); }
    });
    record.player.addEventListener('timeupdate',() => {
      if (!Number.isFinite(record.player.duration) || record.player.duration<=0) return;
      const percent = record.player.currentTime / record.player.duration * 100;
      [25,50,75].forEach(mark => {
        if (percent>=mark && !record.progress.has(mark)) { record.progress.add(mark); track('context_video_progress',record,{percent:mark}); }
      });
    });
    record.player.addEventListener('ended',() => track('context_video_complete',record));
    records.set(id,record);
    host.append(panel);
    return record;
  }

  function open(trigger, pinned) {
    clearTimeout(pendingClose);
    const record = build(trigger);
    if (active && active!==record) close();
    active = record;
    record.pinned = record.pinned || pinned;
    record.panel.hidden = false;
    record.trigger.setAttribute('aria-expanded','true');
    position(record);
    if (pinned && record.source) start(record);
  }

  function scheduleClose() {
    clearTimeout(pendingClose);
    if (active && !active.pinned && !active.panel.contains(document.activeElement)) {
      pendingClose = setTimeout(() => close(),350);
    }
  }

  triggers.forEach(trigger => {
    trigger.closest('.rumos-video-host').hidden = false;
    trigger.addEventListener('click',() => {
      if (active && active.trigger===trigger && active.pinned) close();
      else open(trigger,true);
    });
    trigger.addEventListener('pointerenter',() => {
      if (finePointer.matches && (!active || !active.pinned)) open(trigger,false);
    });
    trigger.addEventListener('pointerleave',scheduleClose);
    trigger.addEventListener('keydown',event => {
      if (event.key==='ArrowDown') {
        event.preventDefault(); open(trigger,true);
        active.panel.querySelector('button.rumos-video-close').focus();
      }
    });
  });

  document.addEventListener('keydown',event => {
    if (event.key==='Escape' && active) { event.preventDefault(); close({restoreFocus:true}); }
  });
  document.addEventListener('pointerdown',event => {
    if (active && !active.panel.contains(event.target) && !active.trigger.contains(event.target)) close();
  });
  document.addEventListener('focusin',event => {
    if (active && !active.panel.contains(event.target) && event.target!==active.trigger) close();
  });
  function queueLayout() {
    if (layoutFrame) cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = null;
      if (!active) return;
      const anchor = active.trigger.getBoundingClientRect();
      if (!isInline() && (anchor.bottom<64 || anchor.top>innerHeight)) close();
      else position(active);
    });
  }
  addEventListener('scroll',queueLayout,{passive:true});
  addEventListener('resize',queueLayout,{passive:true});
  addEventListener('pagehide',event => {
    close();
    // Arquivos só existem na memória deste documento; não vão ao servidor.
    if (!event.persisted) objectURLs.forEach(url => URL.revokeObjectURL(url));
  });

  if (preview) {
    const banner = document.createElement('div');
    banner.className = 'rumos-video-reviewbar';
    banner.innerHTML = '<div class="rumos-video-reviewbar__inner"><span><strong>Prévia de revisão</strong> · quatro vídeos em preparação</span><nav aria-label="Revisar os quatro vídeos"></nav></div>';
    const nav = banner.querySelector('nav');
    const names = {apresentacao:'Apresentação',atendimento:'Primeiro atendimento',documentos:'Documentos',atraso:'Inventário atrasado'};
    triggers.forEach(trigger => {
      const link = document.createElement('a');
      link.href = '#' + trigger.id;
      link.textContent = names[trigger.dataset.rumosVideo] || trigger.dataset.videoTitle;
      link.addEventListener('click',() => {
        close();
        requestAnimationFrame(() => trigger.scrollIntoView({block:'center',behavior:'auto'}));
      });
      nav.append(link);
    });
    document.body.prepend(banner);
  }
})();
