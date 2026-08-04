// sound_engine.js — Web Audio с синтезированными звуками.
// Для MVP не тащим внешние файлы — генерируем звуки в реальном времени.

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.envSource = null;
  }
  async init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    // на некоторых мобильных нужен user gesture
  }
  async resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      try { await this.ctx.resume(); } catch (e) {}
    }
  }
  mute(v) { this.muted = !!v; }

  _blip({ freq = 440, dur = 0.1, type = 'sine', volume = 0.15, sweep = 0 }) {
    if (!this.ctx || this.muted) return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweep) osc.frequency.linearRampToValueAtTime(freq + sweep, t0 + dur);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  play(key) {
    switch (key) {
      case 'box_open':    this._blip({ freq: 320, dur: 0.09, type: 'triangle' }); break;
      case 'box_fill':    this._blip({ freq: 480, dur: 0.12, type: 'sine' }); break;
      case 'tile_step':   this._blip({ freq: 220, dur: 0.08, type: 'triangle', volume: 0.1 }); break;
      case 'tile_hop':    this._blip({ freq: 520, dur: 0.15, type: 'sine', sweep: 80 }); break;
      case 'correct':     this._chord([523.25, 659.25, 783.99], 0.25); break;
      case 'error':       this._blip({ freq: 180, dur: 0.30, type: 'sawtooth', sweep: -60, volume: 0.1 }); break;
      case 'shard_reveal':this._chord([523.25, 659.25, 783.99, 1046.5], 1.5, 0.4); break;
      case 'print_bubble':this._blip({ freq: 660, dur: 0.18, type: 'sine' }); break;
      case 'train_add':   this._blip({ freq: 380, dur: 0.22, type: 'triangle', sweep: 40 }); break;
      case 'button_tap':  this._blip({ freq: 720, dur: 0.06, type: 'sine', volume: 0.08 }); break;
      default: break;
    }
  }

  _chord(freqs, dur = 0.3, spread = 0) {
    if (!this.ctx || this.muted) return;
    freqs.forEach((f, i) => {
      setTimeout(() => this._blip({ freq: f, dur, type: 'sine', volume: 0.12 }), i * spread * 100);
    });
  }
}

export const sound = new SoundEngine();
