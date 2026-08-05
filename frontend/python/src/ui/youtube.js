// youtube.js — открытие видео во внешнем приложении (обход авторизации во встроенном плеере Telegram).

export function ytThumb(id) {
  return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

export function ytWatchUrl(id) {
  return `https://www.youtube.com/watch?v=${id}`;
}

// Открыть видео снаружи: в Telegram — через openLink (откроется браузер/приложение YouTube),
// иначе — обычная новая вкладка.
export function openYouTube(id) {
  const url = ytWatchUrl(id);
  const tg = window.Telegram?.WebApp;
  if (tg && typeof tg.openLink === 'function') {
    tg.openLink(url, { try_instant_view: false });
  } else {
    window.open(url, '_blank', 'noopener');
  }
}
