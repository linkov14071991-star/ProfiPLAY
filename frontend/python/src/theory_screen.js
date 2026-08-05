// theory_screen.js — необязательный экран теории по теме.

import { THEORY } from './curriculum/theory.js';
import { codeBlock } from './ui/highlight.js';
import { sound } from './audio/sound_engine.js';
import { telemetry } from './telemetry/client.js';
import { ytThumb, openYouTube } from './ui/youtube.js';

export class TheoryScreen {
  constructor(els) {
    this.els = els;      // { scroll, htitle, back, start }
    this.onStart = null;
    this.onBack = null;
  }

  show(unit, { onStart, onBack }) {
    this.onStart = onStart;
    this.onBack = onBack;
    const t = THEORY[unit.id];
    this.els.htitle.textContent = unit.title;
    telemetry.emit('theory_open', { unitId: unit.id });

    if (!t) {
      this.els.scroll.innerHTML = `<div class="theory-intro">Теория по этой теме скоро появится.</div>`;
      return;
    }

    let html = `<div class="theory-intro">${escapeHtml(t.intro)}</div>`;

    // видео по теме — превью-карточки, открываются во внешнем YouTube
    const videos = t.videos || [];
    if (videos.length > 0) {
      html += `<div class="theory-video-label">🎬 Видео по теме — марафон Py.Go</div>`;
      html += `<div class="video-list">`;
      videos.forEach((v) => {
        html += `<button class="video-thumb" data-vid="${v.id}">
          <div class="vt-img" style="background-image:url('${ytThumb(v.id)}')"><span class="vt-play">▶</span></div>
          <div class="vt-title">${escapeHtml(v.title)}</div>
        </button>`;
      });
      html += `</div>`;
    }

    for (const b of t.blocks) {
      html += `<div class="theory-block">
        <h3>${escapeHtml(b.h)}</h3>
        <div class="tb-text">${escapeHtml(b.t)}</div>
        ${b.code ? codeBlock(b.code) : ''}
        ${b.out != null ? `<div class="theory-out">${escapeHtml(b.out)}</div>` : ''}
        ${b.tip ? `<div class="theory-tip">💡 ${escapeHtml(b.tip)}</div>` : ''}
      </div>`;
    }

    this.els.scroll.innerHTML = html;
    // надёжный сброс прокрутки наверх (и контейнера, и страницы)
    this.els.scroll.scrollTop = 0;
    requestAnimationFrame(() => {
      this.els.scroll.scrollTop = 0;
      window.scrollTo(0, 0);
    });

    // тап по превью — открыть видео во внешнем YouTube
    this.els.scroll.querySelectorAll('.video-thumb').forEach(btn => {
      btn.addEventListener('click', () => {
        sound.play('button_tap');
        telemetry.emit('video_open_external', { id: btn.dataset.vid });
        openYouTube(btn.dataset.vid);
      });
    });
  }

  bind() {
    this.els.start.addEventListener('click', () => {
      sound.play('button_tap');
      this.onStart && this.onStart();
    });
    this.els.back.addEventListener('click', () => {
      sound.play('button_tap');
      this.onBack && this.onBack();
    });
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}
