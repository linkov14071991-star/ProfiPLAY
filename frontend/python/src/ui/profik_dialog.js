// profik_dialog.js — облако-реплика Профика.

export class ProfikDialog {
  constructor(el) {
    this.el = el;
    this.autohideTimer = null;
  }
  show(text, opts = {}) {
    clearTimeout(this.autohideTimer);
    this.el.textContent = text;
    this.el.classList.remove('hidden');
    // размещение над Профиком (при передаче координат — сдвигаем)
    if (opts.x != null && opts.y != null) {
      const canvas = document.getElementById('canvas');
      const stage = document.getElementById('stage');
      const rect = canvas.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const left = rect.left - stageRect.left + rect.width * opts.x - 100;
      const top  = rect.top  - stageRect.top  + rect.height * (opts.y - 0.28);
      this.el.style.left = Math.max(12, left) + 'px';
      this.el.style.top  = Math.max(12, top)  + 'px';
    } else {
      this.el.style.left = '50%';
      this.el.style.top = '20%';
      this.el.style.transform = 'translateX(-50%)';
    }
    requestAnimationFrame(() => this.el.classList.add('visible'));
    if (opts.autohideMs !== 0) {
      const ms = opts.autohideMs || (2500 + 60 * text.length);
      this.autohideTimer = setTimeout(() => this.hide(), ms);
    }
  }
  hide() {
    this.el.classList.remove('visible');
    setTimeout(() => this.el.classList.add('hidden'), 300);
  }
}
