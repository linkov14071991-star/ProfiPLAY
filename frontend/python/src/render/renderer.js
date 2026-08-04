// renderer.js — рендер мира и Профика в canvas.
// Renderer «не знает Python». Он ест события (см. TDD §4).

import { tween, easings, wait } from './anim/tween.js';
import { duration } from '../exec/events.js';

const COLORS = {
  bg1: '#1a1f2b', bg2: '#12151c',
  dunes1: '#f4a460', dunes2: '#e8894a', dunes3: '#b96a2e', sky: '#ffcf88',
  tile: '#ffb84a', tileActive: '#ff9425',
  varBox: '#ffd700', varBoxText: '#12151c',
  trainCar: '#4a9eff', trainText: '#ffffff',
  profikBody: '#0d0d0d',
  profikHood: '#232936',
  profikEye: '#ffd700',
  profikChest: '#ffd700',
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.setupDpr();
    this.scene = 'blank';    // 'blank' | 'stage' | 'dunes'

    // Профик state
    this.profik = {
      x: 0.5, y: 0.72,          // относительные координаты 0..1
      state: 'idle',            // 'idle' | 'hop' | 'walk' | 'cheer' | 'sad' | 'say'
      breath: 0,
      blinkTimer: 2 + Math.random() * 2,
      blinking: false,
      mouth: 'neutral',         // 'neutral' | 'smile' | 'sad'
      currentTile: null,        // индекс плитки, если стоит на дорожке
    };

    // Мир (для будущих сцен)
    this.world = {
      tiles: [],                // { index, kind: 'tile'|'target'|'gap', visited }
      variables: [],
      lists: [],
    };

    this.callbacks = { onBubbleShow: null, onBubbleHide: null, onConsoleWrite: null };

    this.lastTime = performance.now();
    this.rafId = null;
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  setupDpr() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const cssW = rect.width || 360;
    const cssH = rect.height || 480;
    this.canvas.width = cssW * dpr;
    this.canvas.height = cssH * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssW = cssW;
    this.cssH = cssH;
  }

  setScene(name) { this.scene = name; }

  /** Установить плитки Дюн + позицию Профика */
  setupDunes(tiles, profikTileIndex = 0) {
    this.world.tiles = tiles.map(t => ({ ...t, visited: false }));
    this.profik.currentTile = profikTileIndex;
    const pos = this.tilePosition(profikTileIndex);
    this.profik.x = pos.x;
    this.profik.y = pos.y - 0.06; // над плиткой
    this.profik.state = 'idle';
    this.profik.mouth = 'neutral';
  }

  /** Координаты плитки на canvas (0..1) */
  tilePosition(tileIndex) {
    const n = this.world.tiles.length;
    if (n === 0) return { x: 0.5, y: 0.85 };
    const spread = Math.min(0.85, 0.14 * n);
    const startX = 0.5 - spread / 2;
    const stepX = n > 1 ? spread / (n - 1) : 0;
    // если индекс за пределами — экстраполяция (для "врезался в стену")
    const x = startX + stepX * Math.min(tileIndex, n - 1);
    const y = 0.85;
    return { x, y };
  }

  loop(now) {
    const dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    this.update(dt);
    this.draw();
    this.rafId = requestAnimationFrame(this.loop);
  }

  update(dt) {
    // дыхание
    this.profik.breath += dt * 2.0;
    // моргание
    this.profik.blinkTimer -= dt;
    if (this.profik.blinkTimer <= 0) {
      this.profik.blinking = true;
      setTimeout(() => { this.profik.blinking = false; this.profik.blinkTimer = 2 + Math.random() * 2; }, 120);
    }
  }

  draw() {
    const ctx = this.ctx, W = this.cssW, H = this.cssH;
    // фон
    if (this.scene === 'dunes') {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, COLORS.sky);
      g.addColorStop(0.5, COLORS.dunes1);
      g.addColorStop(1, COLORS.dunes3);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, COLORS.bg1);
      g.addColorStop(1, COLORS.bg2);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    // плитки Дюн
    if (this.scene === 'dunes') {
      // «бархан» — мягкая тень под плитками
      const H2 = H;
      ctx.fillStyle = 'rgba(74, 40, 15, 0.15)';
      ctx.beginPath();
      ctx.ellipse(W / 2, H2 * 0.92, W * 0.45, 30, 0, 0, Math.PI * 2);
      ctx.fill();
      for (const t of this.world.tiles) this.drawTile(t);
    }

    // Профик
    this.drawProfik(this.profik.x * W, this.profik.y * H);
  }

  drawTile(t) {
    const W = this.cssW, H = this.cssH;
    const pos = this.tilePosition(t.index);
    const x = pos.x * W;
    const y = pos.y * H;
    const size = 42;
    const ctx = this.ctx;

    if (t.kind === 'gap') {
      // пустое место: пунктирный контур
      ctx.save();
      ctx.strokeStyle = 'rgba(74,40,15,0.3)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 2;
      this.roundRect(ctx, x - size/2, y - size/2, size, size, 6);
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (t.kind === 'target') {
      // сундучок
      ctx.save();
      ctx.fillStyle = '#8b4513';
      this.roundRect(ctx, x - size/2, y - size/2, size, size, 4);
      ctx.fill();
      ctx.fillStyle = '#d4a24d';
      ctx.fillRect(x - size/2 + 4, y - 2, size - 8, 4);
      ctx.fillStyle = '#3a1f0d';
      ctx.fillRect(x - 3, y - 2, 6, 4);
      ctx.restore();
      return;
    }

    // обычная плитка
    const isActive = this.profik.currentTile === t.index;
    ctx.save();
    ctx.fillStyle = isActive ? COLORS.tileActive : COLORS.tile;
    ctx.shadowColor = 'rgba(74,40,15,0.4)';
    ctx.shadowBlur = 6;
    ctx.shadowOffsetY = 3;
    this.roundRect(ctx, x - size/2, y - size/2, size, size, 6);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#4a280f';
    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(t.index), x, y);
  }

  drawProfik(cx, cy) {
    const ctx = this.ctx;
    const breath = 1 + Math.sin(this.profik.breath) * 0.02;
    const scaleY = breath;
    const size = 84;
    const halfW = size / 2;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, scaleY);

    // тень
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath();
    ctx.ellipse(0, halfW * 0.9, halfW * 0.7, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // тело (капюшон = округлая форма)
    ctx.fillStyle = COLORS.profikHood;
    this.roundRect(ctx, -halfW * 0.85, -halfW * 0.9, halfW * 1.7, halfW * 1.6, 18);
    ctx.fill();

    // голова (чёрный кот)
    ctx.fillStyle = COLORS.profikBody;
    ctx.beginPath();
    ctx.ellipse(0, -halfW * 0.15, halfW * 0.7, halfW * 0.65, 0, 0, Math.PI * 2);
    ctx.fill();

    // уши
    ctx.beginPath();
    ctx.moveTo(-halfW * 0.55, -halfW * 0.6);
    ctx.lineTo(-halfW * 0.30, -halfW * 0.95);
    ctx.lineTo(-halfW * 0.10, -halfW * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(halfW * 0.10, -halfW * 0.55);
    ctx.lineTo(halfW * 0.30, -halfW * 0.95);
    ctx.lineTo(halfW * 0.55, -halfW * 0.6);
    ctx.closePath();
    ctx.fill();

    // глаза (пиксельные)
    if (!this.profik.blinking) {
      ctx.fillStyle = COLORS.profikEye;
      ctx.fillRect(-halfW * 0.28, -halfW * 0.22, 6, 8);
      ctx.fillRect( halfW * 0.22, -halfW * 0.22, 6, 8);
    } else {
      ctx.strokeStyle = COLORS.profikEye;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-halfW * 0.32, -halfW * 0.18);
      ctx.lineTo(-halfW * 0.20, -halfW * 0.18);
      ctx.moveTo( halfW * 0.20, -halfW * 0.18);
      ctx.lineTo( halfW * 0.32, -halfW * 0.18);
      ctx.stroke();
    }

    // рот
    ctx.strokeStyle = '#5b636e';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (this.profik.mouth === 'smile') {
      ctx.arc(0, halfW * 0.06, 6, 0, Math.PI);
    } else if (this.profik.mouth === 'sad') {
      ctx.arc(0, halfW * 0.15, 6, Math.PI, Math.PI * 2);
    } else {
      ctx.moveTo(-4, halfW * 0.08);
      ctx.lineTo( 4, halfW * 0.08);
    }
    ctx.stroke();

    // эмблема </>
    ctx.fillStyle = COLORS.profikChest;
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('</>', 0, halfW * 0.55);

    ctx.restore();
  }

  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /** Проиграть событие → вернуть Promise, resolving когда завершено */
  async play(event, speed = 1) {
    const d = duration(event, speed);
    switch (event.kind) {
      case 'ProgramStart':
        return wait(d);

      case 'ProgramEnd':
        return wait(d);

      case 'PrintCalled': {
        this.callbacks.onConsoleWrite && this.callbacks.onConsoleWrite(event.text);
        return wait(d);
      }

      case 'ProfikSay': {
        this.profik.mouth = 'smile';
        this.callbacks.onBubbleShow && this.callbacks.onBubbleShow(event.text, this.profik.x, this.profik.y);
        await wait(d);
        this.profik.mouth = 'neutral';
        this.callbacks.onBubbleHide && this.callbacks.onBubbleHide();
        return;
      }

      case 'ProfikHop': {
        // На сцене Дюн — прыжок между плитками; иначе — относительный dx.
        return new Promise((resolve) => {
          const startX = this.profik.x;
          const startY = this.profik.y;
          let targetX, targetY;
          if (this.scene === 'dunes' && this.profik.currentTile !== null) {
            const nextIdx = this.profik.currentTile + 1;
            const nextPos = this.tilePosition(nextIdx);
            targetX = nextPos.x;
            targetY = nextPos.y - 0.06;
            this.profik.currentTile = nextIdx;
          } else {
            const dx = event.to.x - event.from.x;
            targetX = startX + dx * 0.15;
            targetY = startY;
          }
          this.profik.state = 'hop';
          tween({
            from: 0, to: 1, duration: d,
            ease: easings.easeOutCubic,
            onUpdate: (t) => {
              this.profik.x = startX + (targetX - startX) * t;
              this.profik.y = startY + (targetY - startY) * t - Math.sin(t * Math.PI) * 0.08;
            },
            onComplete: () => {
              this.profik.x = targetX;
              this.profik.y = targetY;
              this.profik.state = 'idle';
              resolve();
            },
          });
        });
      }

      case 'ProfikCheer': {
        this.profik.mouth = 'smile';
        return new Promise((resolve) => {
          const startY = this.profik.y;
          tween({
            from: 0, to: 1, duration: d,
            ease: easings.easeOutBack,
            onUpdate: (t) => { this.profik.y = startY - Math.sin(t * Math.PI) * 0.12; },
            onComplete: () => { this.profik.y = startY; resolve(); },
          });
        });
      }

      case 'RuntimeError': {
        this.profik.mouth = 'sad';
        // мини-шейк
        const orig = this.profik.x;
        for (let i = 0; i < 6; i++) {
          this.profik.x = orig + (i % 2 === 0 ? 0.01 : -0.01);
          await wait(50);
        }
        this.profik.x = orig;
        await wait(200);
        this.profik.mouth = 'neutral';
        return;
      }

      default:
        return wait(d);
    }
  }

  resetProfik(x = 0.5, y = 0.72) {
    this.profik.x = x;
    this.profik.y = y;
    this.profik.state = 'idle';
    this.profik.mouth = 'neutral';
  }
}
