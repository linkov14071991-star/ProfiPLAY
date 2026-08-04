// client.js — сбор телеметрии, батч по 20 событий или 30 сек.

const BATCH_SIZE = 20;
const BATCH_INTERVAL_MS = 30_000;

class TelemetryClient {
  constructor() {
    this.buffer = [];
    this.sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    this.userId = null;
    this.timer = null;
    this.enabled = true;
  }

  init(userId) {
    this.userId = userId;
    this.timer = setInterval(() => this.flush(), BATCH_INTERVAL_MS);
  }

  emit(eventType, payload = {}) {
    if (!this.enabled) return;
    const event = {
      sessionId: this.sessionId,
      userId: this.userId,
      ts: Date.now(),
      eventType,
      payload,
    };
    this.buffer.push(event);
    if (this.buffer.length >= BATCH_SIZE) this.flush();
  }

  async flush() {
    if (this.buffer.length === 0) return;
    const events = this.buffer.splice(0, this.buffer.length);
    try {
      await fetch('/api/python/telemetry_batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events }),
      });
    } catch (e) {
      // при ошибке возвращаем в буфер
      this.buffer.unshift(...events);
    }
  }
}

export const telemetry = new TelemetryClient();
