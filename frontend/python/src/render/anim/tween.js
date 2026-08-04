// tween.js — минимальная анимационная библиотека.

export const easings = {
  linear:      (t) => t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeOutCubic:(t) => 1 - Math.pow(1 - t, 3),
  easeInOutCubic: (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  easeOutBack: (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
};

export function tween({ from, to, duration, ease = easings.easeOutCubic, onUpdate, onComplete }) {
  const start = performance.now();
  let cancelled = false;

  function frame(now) {
    if (cancelled) return;
    const elapsed = now - start;
    const t = Math.min(1, elapsed / duration);
    const v = from + (to - from) * ease(t);
    onUpdate && onUpdate(v);
    if (t < 1) requestAnimationFrame(frame);
    else onComplete && onComplete();
  }
  requestAnimationFrame(frame);

  return { cancel: () => { cancelled = true; } };
}

export function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
