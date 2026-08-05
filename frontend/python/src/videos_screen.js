// videos_screen.js — экран «Видео-марафон Py.Go»: все 25 роликов.
// Тап открывает видео во внешнем YouTube (обход авторизации во встроенном плеере).

import { MARATHON } from './curriculum/theory.js';
import { sound } from './audio/sound_engine.js';
import { telemetry } from './telemetry/client.js';
import { ytThumb, openYouTube } from './ui/youtube.js';

export class VideosScreen {
  constructor(els) {
    this.els = els;    // { scroll, player, back }
    this.onBack = null;
  }

  show({ onBack }) {
    this.onBack = onBack;
    telemetry.emit('videos_open', {});
    this.els.player.classList.add('hidden');
    this.els.player.innerHTML = '';

    let html = `<div class="marathon-intro">
      <b>Марафон Py.Go: 25 дней кода.</b> Полный видеокурс от простого к сложному.
      Нажми на ролик — он откроется в YouTube.
    </div>`;
    for (const v of MARATHON) {
      html += `<div class="mvideo" data-id="${v.id}">
        <div class="mv-thumb" style="background-image:url('${ytThumb(v.id)}')">
          <span class="mv-day-badge">${v.day}</span>
          <span class="mv-play-badge">▶</span>
        </div>
        <div class="mv-body">
          <div class="mv-title">${escapeHtml(v.title)}</div>
          <div class="mv-dur">⏱ ${v.dur} · день ${v.day}</div>
        </div>
      </div>`;
    }
    this.els.scroll.innerHTML = html;

    this.els.scroll.querySelectorAll('.mvideo').forEach(el => {
      el.addEventListener('click', () => {
        sound.play('button_tap');
        telemetry.emit('video_open_external', { id: el.dataset.id });
        openYouTube(el.dataset.id);
      });
    });
  }

  bind() {
    this.els.back.addEventListener('click', () => {
      sound.play('button_tap');
      this.onBack && this.onBack();
    });
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}
