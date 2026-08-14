// cloud_storage.js — надёжное хранение прогресса.
// Пишем И в Telegram CloudStorage, И в localStorage. Читаем из того, где есть данные.
// Так профиль не теряется, даже если CloudStorage упрётся в лимит 4096 байт или недоступен.

const tg = window.Telegram?.WebApp;
const hasCloud = !!(tg && tg.CloudStorage);

function lsGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, val); } catch { /* переполнение — не критично */ }
}

// На некоторых клиентах Telegram колбэк CloudStorage не вызывается вовсе —
// без таймаута промис висит вечно и приложение застревает на чёрном экране.
function cloudGet(key) {
  if (!hasCloud) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const t = setTimeout(() => finish(null), 1500);
    try {
      tg.CloudStorage.getItem(key, (err, val) => { clearTimeout(t); finish(err ? null : (val || null)); });
    } catch { clearTimeout(t); finish(null); }
  });
}
function cloudSet(key, val) {
  if (!hasCloud) return Promise.resolve(false);
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const t = setTimeout(() => finish(false), 1500);
    try {
      tg.CloudStorage.setItem(key, val, (err, ok) => { clearTimeout(t); finish(!err && ok !== false); });
    } catch { clearTimeout(t); finish(false); }
  });
}

export const cloud = {
  async get(key) {
    // сначала облако (синхронизация между устройствами), затем локальный кэш
    const c = await cloudGet(key);
    if (c) return c;
    return lsGet(key);
  },
  async set(key, val) {
    lsSet(key, val);              // локально — всегда (надёжно, большой лимит)
    await cloudSet(key, val);     // и в облако — по возможности
  },
  async getJson(key, defaultValue = null) {
    const raw = await this.get(key);
    if (!raw) return defaultValue;
    try { return JSON.parse(raw); } catch { return defaultValue; }
  },
  async setJson(key, obj) {
    return this.set(key, JSON.stringify(obj));
  },
  // Выбрать более свежую версию из облака и локального кэша (по полю _savedAt).
  async getJsonBest(key, defaultValue = null) {
    const [c, l] = await Promise.all([cloudGet(key), Promise.resolve(lsGet(key))]);
    const parse = (raw) => { if (!raw) return null; try { return JSON.parse(raw); } catch { return null; } };
    const co = parse(c), lo = parse(l);
    if (co && lo) return ((lo._savedAt || 0) >= (co._savedAt || 0)) ? lo : co;
    return co || lo || defaultValue;
  },
};
