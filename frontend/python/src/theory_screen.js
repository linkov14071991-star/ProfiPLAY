// theory_screen.js — необязательный экран теории по теме.

import { THEORY } from './curriculum/theory.js';
import { codeBlock } from './ui/highlight.js';
import { sound } from './audio/sound_engine.js';
import { telemetry } from './telemetry/client.js';

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

    // видео по теме — конкретные ролики марафона Py.Go
    const videos = t.videos || [];
    if (videos.length > 0) {
      const first = videos[0];
      html += `
        <div class="theory-video-label">🎬 Видео по теме — марафон Py.Go</div>
        <div class="theory-video">
          <iframe id="theory-iframe" loading="lazy"
            src="https://www.youtube-nocookie.com/embed/${first.id}"
            title="${escapeHtml(first.title)}" allow="encrypted-media; picture-in-picture"
            allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
        </div>`;
      if (videos.length > 1) {
        html += `<div class="video-list">`;
        videos.forEach((v, i) => {
          html += `<button class="video-item${i === 0 ? ' active' : ''}" data-vid="${v.id}" data-title="${escapeHtml(v.title)}">
            <span class="vi-play">▶</span> ${escapeHtml(v.title)}</button>`;
        });
        html += `</div>`;
      }
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
    this.els.scroll.scrollTop = 0;

    // переключение видео в списке
    const iframe = this.els.scroll.querySelector('#theory-iframe');
    this.els.scroll.querySelectorAll('.video-item').forEach(btn => {
      btn.addEventListener('click', () => {
        const vid = btn.dataset.vid;
        if (iframe) {
          iframe.src = `https://www.youtube-nocookie.com/embed/${vid}?autoplay=1`;
          iframe.title = btn.dataset.title;
        }
        this.els.scroll.querySelectorAll('.video-item').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        sound.play('button_tap');
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
