// cloud_storage.js — обёртка над Telegram CloudStorage
// + fallback на localStorage, если запускаем вне Telegram

const tg = window.Telegram?.WebApp;
const hasCloud = !!(tg && tg.CloudStorage);

export const cloud = {
  async get(key) {
    if (hasCloud) {
      return new Promise((resolve) => {
        tg.CloudStorage.getItem(key, (err, val) => resolve(err ? null : val));
      });
    }
    return localStorage.getItem(key);
  },
  async set(key, val) {
    if (hasCloud) {
      return new Promise((resolve) => {
        tg.CloudStorage.setItem(key, val, () => resolve());
      });
    }
    localStorage.setItem(key, val);
  },
  async getJson(key, defaultValue = null) {
    const raw = await this.get(key);
    if (!raw) return defaultValue;
    try { return JSON.parse(raw); } catch { return defaultValue; }
  },
  async setJson(key, obj) {
    return this.set(key, JSON.stringify(obj));
  },
};
