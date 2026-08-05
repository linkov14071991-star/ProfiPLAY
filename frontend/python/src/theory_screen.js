// theory_screen.js — необязательный экран теории по теме.

import { THEORY, PLAYLIST_ID } from './curriculum/theory.js';
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

    // видео по теме (встраиваем плейлист марафона)
    if (t.videoIndex) {
      html += `
        <div class="theory-video-label">🎬 Видео по теме — марафон Py.Go</div>
        <div class="theory-video">
          <iframe loading="lazy"
            src="https://www.youtube-nocookie.com/embed/videoseries?list=${PLAYLIST_ID}&index=${t.videoIndex}"
            title="Py.Go марафон" allow="encrypted-media; picture-in-picture"
            allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>
        </div>`;
    }

    for (const b of t.blocks) {
      html += `<div class="theory-block">
        <h3>${escapeHtml(b.h)}</h3>
        <div class="tb-text">${escapeHtml(b.t)}</div>
        ${b.code ? codeBlock(b.code) : ''}
        ${b.out != null ? `<div class="theory-out">${escapeHtml(b.out)}</div>` : ''}
      </div>`;
    }

    this.els.scroll.innerHTML = html;
    this.els.scroll.scrollTop = 0;
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
