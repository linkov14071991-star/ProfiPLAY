// videos_screen.js — экран «Видео-марафон Py.Go»: все 25 роликов.

import { MARATHON } from './curriculum/theory.js';
import { sound } from './audio/sound_engine.js';
import { telemetry } from './telemetry/client.js';

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
      Смотри по порядку или выбирай нужную тему.
    </div>`;
    for (const v of MARATHON) {
      html += `<div class="mvideo" data-id="${v.id}" data-title="${escapeHtml(v.title)}">
        <div class="mv-day">${v.day}</div>
        <div class="mv-body">
          <div class="mv-title">${escapeHtml(v.title)}</div>
          <div class="mv-dur">⏱ ${v.dur}</div>
        </div>
        <div class="mv-play">▶</div>
      </div>`;
    }
    this.els.scroll.innerHTML = html;

    this.els.scroll.querySelectorAll('.mvideo').forEach(el => {
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        this.playVideo(id, el.dataset.title);
        this.els.scroll.querySelectorAll('.mvideo').forEach(x => x.classList.remove('playing'));
        el.classList.add('playing');
        sound.play('button_tap');
      });
    });
  }

  playVideo(id, title) {
    this.els.player.classList.remove('hidden');
    this.els.player.innerHTML = `<iframe loading="lazy"
      src="https://www.youtube-nocookie.com/embed/${id}?autoplay=1"
      title="${escapeHtml(title)}" allow="autoplay; encrypted-media; picture-in-picture"
      allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
    telemetry.emit('video_play', { id });
    // прокрутить к плееру
    this.els.player.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  bind() {
    this.els.back.addEventListener('click', () => {
      sound.play('button_tap');
      this.els.player.innerHTML = ''; // остановить видео
      this.onBack && this.onBack();
    });
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}
