// console.js — маленькая консоль вывода print

export class Console {
  constructor(el) {
    this.el = el;
    this.hideTimer = null;
  }
  write(text) {
    clearTimeout(this.hideTimer);
    this.el.textContent = text;
    this.el.classList.remove('hidden');
    requestAnimationFrame(() => this.el.classList.add('visible'));
    this.hideTimer = setTimeout(() => this.clear(), 4000);
  }
  clear() {
    this.el.classList.remove('visible');
    setTimeout(() => this.el.classList.add('hidden'), 300);
  }
}
