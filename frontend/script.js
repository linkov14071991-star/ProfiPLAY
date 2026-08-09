// ==== Telegram WebApp init ====
// SDK грузится асинхронно (не блокирует страницу, если telegram.org недоступен).
// tg может появиться чуть позже — присваиваем через let и добираем в boot().
let tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

// ==== Экраны ====
const SCREENS = {
  check: "screen-check",
  needSub: "screen-need-sub",
  menu: "screen-menu",
  party: "screen-party",
  profile: "screen-profile",
  leaderboard: "screen-leaderboard",
  achievements: "screen-achievements",
  rules: "screen-rules",
  duelSetup: "screen-duel-setup",
  duelAccept: "screen-duel-accept",
  duelPlay: "screen-duel-play",
  duelWaiting: "screen-duel-waiting",
  duelResult: "screen-duel-result",
  duelHistory: "screen-duel-history",
  crocoSetup: "screen-croco-setup",
  crocoTheme: "screen-croco-theme", // выбор темы (перед словом)
  game: "screen-game",           // игра Крокодил
  result: "screen-result",       // итоги Крокодила
  gromkoSetup: "screen-gromko-setup",
  gromkoDifficulty: "screen-gromko-difficulty",
  gromkoExplain: "screen-gromko-explain",
  gromkoSelect: "screen-gromko-select",
  gromkoBlitzIntro: "screen-gromko-blitz-intro",
  gromkoBlitz: "screen-gromko-blitz",
  gromkoResult: "screen-gromko-result",
  sprintSetup: "screen-sprint-setup",
  sprint: "screen-sprint",
  sprintResult: "screen-sprint-result",
  aliasSetup: "screen-alias-setup",
  alias: "screen-alias",
  aliasResult: "screen-alias-result",
  marathonSetup: "screen-marathon-setup",
  marathon: "screen-marathon",
  marathonResult: "screen-marathon-result",
  numguessSetup: "screen-numguess-setup",
  numguessPlay: "screen-numguess-play",
  fastmathSetup: "screen-fastmath-setup",
  fastmathPlay: "screen-fastmath-play",
  fastmathResult: "screen-fastmath-result",
  infomathSetup: "screen-infomath-setup",
  infomathPlay: "screen-infomath-play",
  infomathResult: "screen-infomath-result",
  tbSetup: "screen-tb-setup",
  tbNumSetup: "screen-tb-num-setup",
  tbNumPlay: "screen-tb-num-play",
  tbAttempt: "screen-tb-attempt",
  tbPlay: "screen-tb-play",
  tbReview: "screen-tb-review",
  tbCrocoSetup: "screen-tb-croco-setup",
  tbCrocoPlay: "screen-tb-croco-play",
  tbBlitzIntro: "screen-tb-blitz-intro",
  tbBlitz: "screen-tb-blitz",
  tbResult: "screen-tb-result",
  spySetup: "screen-spy-setup",
  spyPass: "screen-spy-pass",
  spyRole: "screen-spy-role",
  spyDiscuss: "screen-spy-discuss",
  spyVote: "screen-spy-vote",
  spyGuess: "screen-spy-guess",
  spyResult: "screen-spy-result",
};

function showScreen(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(SCREENS[name]).classList.add("active");
  window.scrollTo(0, 0);
  // при возврате на меню — обновим плашку рейтинга
  if (name === "menu") refreshProfile();
  if (name === "profile") loadProfileScreen();
  // Рандомная реплика Профика на любом экране с data-profik-context
  populateProfikChips();
}
window.showScreen = showScreen;  // для onclick в HTML

// ===== Релиз: ручное открытие игр =====
// null = все игры открыты. Чтобы открывать постепенно — впиши массив ключей игр,
// например:  const UNLOCKED_GAMES = ["python", "sprint"];
// Остальные карточки станут «🔒 Скоро» и некликабельны. Ключи = data-game на карточке
// (sprint, marathon, python, duel, party, crocodile, alias, timebank, spy, gromko).
const UNLOCKED_GAMES = null;
function applyUnlocks() {
  if (!Array.isArray(UNLOCKED_GAMES)) return;
  document.querySelectorAll(".game-card[data-game]").forEach((card) => {
    if (card.classList.contains("locked")) return;
    if (!UNLOCKED_GAMES.includes(card.dataset.game)) {
      card.classList.add("locked");
      if (!card.querySelector(".badge-soon")) {
        const b = document.createElement("div");
        b.className = "badge-soon";
        b.textContent = "🔒 Скоро";
        card.appendChild(b);
      }
    }
  });
}
// ===== Таблицы лучших по игре (общий тотал / за неделю) =====
async function loadGameLeaderboard(game, listId, period) {
  const el = document.getElementById(listId);
  if (!el) return;
  el.innerHTML = '<div class="game-lb-empty">Загрузка…</div>';
  try {
    const r = await fetch(`/api/leaderboard/game?game=${game}&period=${period}&limit=10`);
    const d = await r.json();
    const leaders = d.leaders || [];
    if (!leaders.length) { el.innerHTML = '<div class="game-lb-empty">Пока пусто — будь первым!</div>'; return; }
    el.innerHTML = leaders.map((l) => `
      <div class="game-lb-row${l.place <= 3 ? " top" : ""}">
        <span class="game-lb-place">${l.place}</span>
        <span class="game-lb-name">${escapeHtml(l.name)}</span>
        <span class="game-lb-score">${l.score}</span>
      </div>`).join("");
  } catch (e) { el.innerHTML = '<div class="game-lb-empty">Не удалось загрузить</div>'; }
}
function setupGameLeaderboard(game, wrapId, listId) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  wrap.querySelectorAll(".game-lb-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      wrap.querySelectorAll(".game-lb-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      hapticLight();
      loadGameLeaderboard(game, listId, tab.dataset.period);
    });
  });
}
function resetLbTabs(wrapId) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  wrap.querySelectorAll(".game-lb-tab").forEach((t, i) => t.classList.toggle("active", i === 0));
}

// Нижние ссылки «← назад/в меню» превращаем в стрелку в левом верхнем углу экрана
function installBackArrows() {
  document.querySelectorAll(".screen").forEach((scr) => {
    const back = scr.querySelector(".btn-back");
    if (!back || scr.querySelector(".screen-back")) return;
    const target = back.dataset.back;
    if (!target) return;
    const arrow = document.createElement("button");
    arrow.type = "button";
    arrow.className = "screen-back";
    arrow.setAttribute("aria-label", "Назад");
    arrow.textContent = "←";
    arrow.addEventListener("click", () => { hapticLight(); showScreen(target); });
    scr.insertBefore(arrow, scr.firstChild);
    back.style.display = "none";
  });
}

function initMenuExtras() {
  applyUnlocks();
  installBackArrows();
  setupGameLeaderboard("sprint", "sprint-lb", "sprint-lb-list");
  setupGameLeaderboard("marathon", "marathon-lb", "marathon-lb-list");
  setupGameLeaderboard("numguess", "numguess-lb", "numguess-lb-list");
  setupGameLeaderboard("fastmath", "fastmath-lb", "fastmath-lb-list");
  setupGameLeaderboard("infomath", "infomath-lb", "infomath-lb-list");
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initMenuExtras);
else initMenuExtras();

// ==== Проверка подписки ====
async function checkSubscription() {
  const userId = tg?.initDataUnsafe?.user?.id;
  let subscribed = true;
  if (userId) {
    try {
      // таймаут 6 сек: если бэкенд молчит — не держим ученика на экране проверки,
      // а пускаем внутрь (fail-open). Подписку перепроверим позже.
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 6000);
      const r = await fetch(`/api/check_subscription?user_id=${userId}`, { signal: ctrl.signal });
      clearTimeout(t);
      const data = await r.json();
      subscribed = !!data.subscribed;
    } catch (e) { subscribed = true; }
  }
  showScreen(subscribed ? "menu" : "needSub");
  if (subscribed && typeof window._maybeOpenIncomingDuel === "function") {
    await window._maybeOpenIncomingDuel();
  }
}

// ==== Универсальные Pills ====
function setupPills(containerId, onChange, cast = (v) => v) {
  const container = document.getElementById(containerId);
  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".pill");
    if (!btn) return;
    container.querySelectorAll(".pill").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    onChange(cast(btn.dataset.value));
    hapticLight();
  });
}

// Мультивыбор пилюль: можно отметить несколько, но минимум одну не даём снять.
// onChange получает массив выбранных значений. Возвращает функцию чтения текущего выбора.
function setupPillsMulti(containerId, onChange) {
  const container = document.getElementById(containerId);
  const read = () => [...container.querySelectorAll(".pill.active")].map((p) => p.dataset.value);
  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".pill");
    if (!btn) return;
    const activeCount = container.querySelectorAll(".pill.active").length;
    if (btn.classList.contains("active") && activeCount <= 1) { hapticLight(); return; } // нельзя снять последний
    btn.classList.toggle("active");
    onChange(read());
    hapticLight();
  });
  return read;
}

// Звуковой сигнал окончания времени (WebAudio, без внешних файлов).
let _audioCtx = null;
function playTimeUpSound() {
  try {
    _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _audioCtx;
    if (ctx.state === "suspended") ctx.resume();
    // три коротких нисходящих гудка
    [880, 660, 440].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      const t0 = ctx.currentTime + i * 0.22;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.25, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.22);
    });
    if (window.Telegram?.WebApp?.HapticFeedback) window.Telegram.WebApp.HapticFeedback.notificationOccurred("warning");
  } catch (e) { /* звук недоступен — не критично */ }
}

// Тиканье хронометра каждую секунду. В последние 10 сек громкость и высота растут —
// нагнетает напряжение. Вызывать раз в секунду с оставшимся временем.
function playTick(secondsLeft) {
  if (secondsLeft <= 0) return;
  try {
    _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _audioCtx;
    if (ctx.state === "suspended") ctx.resume();
    const last10 = secondsLeft <= 10;
    // громкость: тихо обычно (0.05), в последние 10 сек нарастает до ~0.6
    const vol = last10 ? Math.min(0.6, 0.1 + (10 - secondsLeft) * 0.055) : 0.05;
    const freq = last10 ? 1100 : 750;                 // в финале выше и звонче
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = last10 ? "square" : "sine";
    osc.frequency.value = freq;
    const t0 = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + (last10 ? 0.12 : 0.05));
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.13);
    if (last10 && secondsLeft <= 5 && window.Telegram?.WebApp?.HapticFeedback) {
      window.Telegram.WebApp.HapticFeedback.impactOccurred("light");
    }
  } catch (e) { /* не критично */ }
}

// ==== Меню игр (делегирование по клику) ====
document.body.addEventListener("click", (e) => {
  const card = e.target.closest(".game-card");
  if (!card || card.classList.contains("locked")) return;
  const game = card.dataset.game;
  if (!game) return;
  hapticMedium();
  if (game === "party") showScreen("party");
  if (game === "crocodile") { renderCrocoRecord(); showScreen("crocoSetup"); }
  if (game === "sprint") { renderSprintRecord(); resetLbTabs("sprint-lb"); loadGameLeaderboard("sprint", "sprint-lb-list", "all"); showScreen("sprintSetup"); }
  if (game === "alias") showScreen("aliasSetup");
  if (game === "marathon") { renderMarathonRecord(); resetLbTabs("marathon-lb"); loadGameLeaderboard("marathon", "marathon-lb-list", "all"); showScreen("marathonSetup"); }
  if (game === "numguess") { resetLbTabs("numguess-lb"); loadGameLeaderboard("numguess", "numguess-lb-list", "all"); showScreen("numguessSetup"); }
  if (game === "fastmath") { resetLbTabs("fastmath-lb"); loadGameLeaderboard("fastmath", "fastmath-lb-list", "all"); showScreen("fastmathSetup"); }
  if (game === "infomath") { resetLbTabs("infomath-lb"); loadGameLeaderboard("infomath", "infomath-lb-list", "all"); showScreen("infomathSetup"); }
  if (game === "timebank") { tbRenderRecords(); showScreen("tbSetup"); }
  if (game === "spy") showScreen("spySetup");
  if (game === "gromko") { renderGromkoRecord(); showScreen("gromkoSetup"); }
  if (game === "duel") showScreen("duelSetup");
  if (game === "python") window.location.href = "python/index.html";
});

// Кнопка "В меню" на любом экране
document.querySelectorAll(".btn-back").forEach((btn) => {
  btn.addEventListener("click", () => showScreen(btn.dataset.back));
});

// ==== Инфо-модалка с правилами игры ====
const GAME_INFO = {
  sprint: {
    title: "⚡ Спринт",
    body: `<p>Соло-режим на скорость. За выбранное время (30/60/90 сек) отвечай на максимум вопросов — 4 варианта, автопереход к следующему.</p>
      <p>Выбираешь <b>темы</b> (Информатика/Математика/Физика, можно несколько) и <b>сложность</b>.</p>
      <p>За правильный ответ: <b>+1 рейтинг и +2 XP</b>, умноженные на множитель сложности (×1 / ×1.5 / ×2).</p>`,
  },
  marathon: {
    title: "🏆 Марафон",
    body: `<p>Отвечай на вопросы, пока не закончатся жизни. Каждая ошибка — минус жизнь.</p>
      <p>Жизни зависят от сложности: простая — 1, средняя — 2, сложная — 3 (максимум 3). Серия правильных подряд восполняет жизнь: 30 / 20 / 10.</p>
      <p>Выбираешь темы и сложность. За правильный: <b>+2 рейтинга и +3 XP</b> × множитель сложности.</p>`,
  },
  numguess: {
    title: "🔢 Угадай число",
    body: `<p>Приложение загадывает число, ты вводишь догадки — оно подсказывает «📈 Больше» или «📉 Меньше» и сужает диапазон.</p>
      <p>Выбираешь сложность: просто (1–10, 15 сек), средне (1–100, 20 сек), сложно (1–1000, 30 сек). Угадал до конца времени — получаешь рейтинг (×1 / ×1.5 / ×2 по сложности).</p>
      <p>Тренировочная игра: рейтинг идёт в общий зачёт с капом <b>100 очков в день</b> (вместе со Спринтом и Марафоном). У игры своя таблица лучших.</p>`,
  },
  fastmath: {
    title: "🧮 Быстрый счёт",
    body: `<p>Решай короткие примеры и мини-уравнения (сложение, вычитание, умножение, деление, «x + 7 = 12»). 4 варианта ответа, автопереход.</p>
      <p>За <b>60 секунд</b> реши как можно больше. Сложность влияет на размер чисел и множитель наград: ×1 / ×1.5 / ×2.</p>
      <p>Тренировочная игра: рейтинг в общий зачёт с капом <b>100 очков в день</b> (со Спринтом, Марафоном и «Угадай число»). Есть своя таблица лучших.</p>`,
  },
  infomath: {
    title: "🖥️ Инфо-счёт",
    body: `<p>Тренажёр по информатике: <b>степени двойки</b> (2⁰…2¹⁶ наизусть), перевод <b>двоичная ↔ десятичная</b> и <b>единицы информации</b> (бит, байт, Кбайт, Мбайт, Гбайт). 4 варианта, автопереход.</p>
      <p>Числа подобраны так, чтобы считать <b>в уме</b>. За <b>60 секунд</b> реши как можно больше. Сложность (до 2⁸ / 2¹² / 2¹⁶) даёт множитель ×1 / ×1.5 / ×2.</p>
      <p>Тренировочная игра: рейтинг в общий зачёт с капом <b>100 очков в день</b>. Есть своя таблица лучших.</p>`,
  },
  python: {
    title: "🐍 Python by Профик",
    body: `<p>Курс программирования от основ до задач ЕГЭ. Идёшь по темам шаг за шагом.</p>
      <p>Внутри: теория с примерами, тесты, «что выведет код», «найди ошибку», «собери код», мини-проекты и ежедневные задания.</p>
      <p>Копишь готовность к экзамену, а за первое прохождение уроков — рейтинг в общий зачёт Арены.</p>`,
  },
  duel: {
    title: "⚔ Блиц-дуэль",
    body: `<p>Соревнование 1×1 — асинхронно. Ты играешь 10 вопросов по 15 секунд, очки за скорость ответа.</p>
      <p>Выбираешь <b>темы</b> (1–3) и <b>сложность</b>. После партии получаешь ссылку — отправляешь другу в Telegram. Он играет те же вопросы когда захочет.</p>
      <p>Очки сравниваются автоматически. Победа поднимает рейтинг (ELO), поражение — снижает.</p>`,
  },
  crocodile: {
    title: "🐊 Крокодил",
    body: `<p>Показывай слово жестами, без слов и звуков — друзья угадывают. Кто угадал, берёт телефон и играет дальше.</p>
      <p>Перед игрой выбираешь <b>сложность</b> слов и <b>время на показ одного слова</b> (1 мин, 2 мин или безлимит).</p>
      <p>Каждый ход игрок выбирает тему (Информатика/Математика/Физика) и показывает слово. Угадали — жми «Угадано!». Счёт угаданных сохраняется в рекорды.</p>`,
  },
  alias: {
    title: "🗣 Alias",
    body: `<p>Объясняй слово другими словами, не называя само слово и запретные слова к нему. Друзья угадывают.</p>
      <p>Выбираешь <b>предметы</b>, <b>сложность</b> и длительность раунда. Галочкой можно включить или выключить запретные слова.</p>
      <p>За раунд считаются угаданные слова, пропуски и штрафы (за названное запретное слово).</p>`,
  },
  spy: {
    title: "🕵 Шпион",
    body: `<p>Всем игрокам показывают одно слово — кроме шпиона. Телефон передаётся по кругу, каждый видит свою роль.</p>
      <p>Потом обсуждение: по очереди намекаете на слово, <b>не называя его прямо</b>. Шпион пытается понять, о чём речь.</p>
      <p>После обсуждения голосуете, кто шпион. Поймали шпиона — он пытается угадать слово. Угадал — победа шпиона, нет — победа мирных.</p>`,
  },
  gromko: {
    title: "🔊 Громкий вопрос",
    body: `<p>Командная игра: один игрок в наушниках с громкой музыкой <b>не слышит</b>, остальные объясняют ему жестами и по губам.</p>
      <p><b>3 раунда — банк времени.</b> Команда выбирает сложность и жмёт «Начать раунд». Даётся 10 секунд прочитать вопрос и придумать ответ, затем включается таймер (простой 30с / средний 60с / сложный 90с) — команда объясняет ответ игроку в наушниках. Потом он, <b>не видя вопроса</b>, выбирает вариант. Верно — время в банк: +30 / +60 / +90с.</p>
      <p><b>Супер-блиц.</b> Выбираете лучшего «чтеца по губам». За накопленное время команда объясняет ему <b>3 слова</b> (два простых и одно среднее) в любом порядке. Успели все три — победа, время кончилось — поражение.</p>`,
  },
  timebank: {
    title: "⏳ Тайм-баттл <span class='by-profik'>by Профик</span>",
    body: `
      <p>Командная игра на 4 раунда: три раунда копите «банк времени», в финале тратите его на супер-блиц.</p>
      <p><b>Р1 — Угадай число:</b> отгадайте число по подсказкам «больше/меньше». Простой +15с, средний +20с, сложный +30с.</p>
      <p><b>Р2 — Alias:</b> 60 сек, объясняйте слова словами. Каждое угаданное — +2/+4/+6с по сложности, потом проверка.</p>
      <p><b>Р3 — Крокодил:</b> покажите <b>одно</b> слово жестами. Простое 30с/+30, среднее 45с/+45, сложное 60с/+60.</p>
      <p><b>Р4 — Финал:</b> супер-блиц. Игрок в наушниках, 6 слов (2 простых, 2 средних, 2 сложных), объясняете за весь накопленный банк, в любом порядке. Очки: слово 10/20/30 + бонус +2 за секунду. Итог — в таблицу рекордов.</p>`,
  },
};
let _gimKey = null;
function openGameInfo(key) {
  const info = GAME_INFO[key];
  if (!info) return;
  _gimKey = key;
  document.getElementById("gim-title").innerHTML = info.title;
  document.getElementById("gim-body").innerHTML = info.body;
  document.getElementById("game-info-modal").classList.remove("hidden");
}
function closeGameInfo() { document.getElementById("game-info-modal").classList.add("hidden"); }
document.querySelectorAll(".game-info-btn").forEach((btn) => {
  btn.addEventListener("click", (e) => { e.stopPropagation(); hapticLight(); openGameInfo(btn.dataset.info); });
});
document.querySelector("#game-info-modal .gim-close").addEventListener("click", closeGameInfo);
document.querySelector("#game-info-modal .gim-backdrop").addEventListener("click", closeGameInfo);
// «Открыть правила» — переход в раздел правил, раскрыть блок этой игры
document.getElementById("gim-rules-btn").addEventListener("click", () => {
  const key = _gimKey;
  closeGameInfo();
  showScreen("rules");
  const el = key && document.getElementById("rules-" + key);
  if (el) {
    document.querySelectorAll("#screen-rules details.rules-block").forEach((d) => { if (d !== el) d.open = false; });
    el.open = true;
    setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }
});

// ==============================
// ========= КРОКОДИЛ ===========
// ==============================
// Механика: игроки по очереди выбирают тему и показывают слово. У каждого слова —
// свой таймер (1/2 мин или безлимит). Угадали → следующий игрок берёт телефон.
const croco = {
  difficulty: "easy",
  wordTime: 60,        // сек на показ ОДНОГО слова (0 = безлимит)
  pools: {}, idx: {},
  curSubject: null,
  timer: null, timeLeft: 0,
  guessed: 0,
  started: false,
};

const CROCO_SUBJECTS = ["informatika", "matematika", "fizika"];

setupPills("croco-difficulty", (v) => { croco.difficulty = v; renderCrocoRecord(); });
setupPills("croco-time", (v) => { croco.wordTime = v; renderCrocoRecord(); }, (v) => parseInt(v, 10));

// --- Рекорды Крокодила (по времени на слово и сложности) ---
const crocoRecords = {};
function crocoRecordKey() { return `croco_${croco.wordTime}_${croco.difficulty}`; }
function getCrocoRecord() { return crocoRecords[crocoRecordKey()] || 0; }
function saveCrocoRecord(score) {
  const key = crocoRecordKey();
  if (score > (crocoRecords[key] || 0)) {
    crocoRecords[key] = score;
    tg?.CloudStorage?.setItem?.(key, String(score), () => {});
    return true;
  }
  return false;
}
function loadCrocoRecordsFromCloud() {
  if (!tg?.CloudStorage) return;
  const keys = [];
  for (const t of [60, 120, 0]) for (const d of ["easy", "medium", "hard"]) keys.push(`croco_${t}_${d}`);
  tg.CloudStorage.getItems(keys, (err, values) => {
    if (err || !values) return;
    Object.entries(values).forEach(([k, v]) => { if (v) crocoRecords[k] = parseInt(v, 10) || 0; });
    renderCrocoRecord();
  });
}
function renderCrocoRecord() {
  const rec = getCrocoRecord();
  const hint = document.getElementById("croco-record-hint");
  if (rec > 0) { document.getElementById("croco-record").textContent = rec; hint.style.display = "block"; }
  else { hint.style.display = "none"; }
}

async function crocoLoadPools() {
  const results = await Promise.all(
    CROCO_SUBJECTS.map((s) => fetch(`/api/words?difficulty=${croco.difficulty}&subjects=${s}`).then((r) => r.json()))
  );
  CROCO_SUBJECTS.forEach((s, i) => {
    const items = results[i].items || [];
    items.sort(() => Math.random() - 0.5);
    croco.pools[s] = items;
    croco.idx[s] = 0;
  });
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
function crocoUpdateTimer() {
  const unlimited = croco.wordTime <= 0;
  document.querySelectorAll(".croco-timer").forEach((el) => {
    el.textContent = unlimited ? "∞" : fmtTime(Math.max(0, croco.timeLeft));
    el.classList.remove("warn", "danger");
    if (!unlimited && croco.timeLeft <= 5) el.classList.add("danger");
    else if (!unlimited && croco.timeLeft <= 15) el.classList.add("warn");
  });
  document.querySelectorAll(".croco-guessed").forEach((el) => (el.textContent = croco.guessed));
}

async function crocoStart() {
  hapticMedium();
  await crocoLoadPools();
  croco.guessed = 0;
  croco.curSubject = null;
  croco.started = false;
  croco.timeLeft = croco.wordTime;
  crocoShowThemePicker();
}

// Экран выбора темы (перед каждым словом). Таймер слова остановлен, пока выбираешь.
function crocoShowThemePicker() {
  if (croco.timer) { clearInterval(croco.timer); croco.timer = null; }
  croco.timeLeft = croco.wordTime;
  crocoUpdateTimer();
  document.getElementById("btn-croco-theme-back").style.display = croco.started ? "none" : "";
  document.getElementById("btn-croco-theme-stop").style.display = croco.started ? "" : "none";
  showScreen("crocoTheme");
}

// Показать слово выбранной темы. Запускает таймер этого слова.
function crocoShowWord(subject) {
  croco.curSubject = subject;
  croco.started = true;
  crocoNextWord();
  showScreen("game");
}

function crocoNextWord() {
  const s = croco.curSubject;
  const pool = croco.pools[s] || [];
  if (!pool.length) return;
  if (croco.idx[s] >= pool.length) { pool.sort(() => Math.random() - 0.5); croco.idx[s] = 0; }
  const item = pool[croco.idx[s]++];
  document.getElementById("word").textContent = item.word;
  document.getElementById("word-emoji").textContent = item.emoji || "";
  crocoStartWordTimer();
}

// Таймер на показ одного слова
function crocoStartWordTimer() {
  if (croco.timer) { clearInterval(croco.timer); croco.timer = null; }
  if (croco.wordTime <= 0) { crocoUpdateTimer(); return; }  // безлимит — без таймера
  croco.timeLeft = croco.wordTime;
  crocoUpdateTimer();
  croco.timer = setInterval(() => {
    croco.timeLeft--;
    crocoUpdateTimer();
    if (croco.timeLeft <= 0) { clearInterval(croco.timer); croco.timer = null; playTimeUpSound(); crocoWordTimeout(); }
    else playTick(croco.timeLeft);
  }, 1000);
}

// Время на слово вышло — слово не засчитано, ход переходит дальше
function crocoWordTimeout() {
  hapticError();
  crocoShowThemePicker();
}

async function crocoFinish() {
  if (croco.timer) { clearInterval(croco.timer); croco.timer = null; }
  const isRecord = saveCrocoRecord(croco.guessed);
  document.getElementById("result-guessed").textContent = croco.guessed;
  document.getElementById("result-record").textContent = getCrocoRecord();
  document.getElementById("croco-new-record").style.display = isRecord && croco.guessed > 0 ? "block" : "none";
  showScreen("result");
  hapticSuccess();
  const res = await awardTraining("party", 5, { game: "croco" });
  showRatingToast(res);
}

document.getElementById("btn-croco-start").addEventListener("click", crocoStart);
document.getElementById("btn-croco-again").addEventListener("click", crocoStart);
document.querySelectorAll("#screen-croco-theme .theme-btn").forEach((btn) => {
  btn.addEventListener("click", () => { hapticLight(); crocoShowWord(btn.dataset.subject); });
});
// Угадано → следующий ход: угадавший берёт телефон и выбирает тему
document.getElementById("btn-guessed").addEventListener("click", () => {
  if (croco.timer) { clearInterval(croco.timer); croco.timer = null; }
  croco.guessed++;
  hapticLight();
  crocoShowThemePicker();
});
// Другое слово той же темы (сбрасывает таймер слова)
document.getElementById("btn-skip").addEventListener("click", () => {
  hapticLight();
  crocoNextWord();
});
document.getElementById("btn-stop").addEventListener("click", crocoFinish);
document.getElementById("btn-croco-theme-stop").addEventListener("click", crocoFinish);

// ==============================
// ====== ГРОМКИЙ ВОПРОС ========
// ==============================
// Командная игра. Один игрок в наушниках с громкой музыкой не слышит команду.
// 3 раунда «банка времени»: перед раундом игрок выбирает сложность вопроса; команда
// объясняет игроку в наушниках верный ответ, он выбирает вариант. Верно → в банк капает
// время (простой +30с, средний +60с, сложный +90с). Затем СУПЕР-БЛИЦ: за накопленное время
// команда должна объяснить игроку в наушниках 3 слова (простое/среднее/сложное). Все три — победа.
const GROMKO_BANK_SEC = { easy: 30, medium: 60, hard: 90 };
const GROMKO_LEVEL_NAME = { easy: "Простой", medium: "Средний", hard: "Сложный" };
// темы вопросов (инф/мат/физ) → ключи банка слов для блица
const GROMKO_WORD_SUBJ = { informatika: "informatika", mathematics: "matematika", physics: "fizika" };

const gromko = {
  topics: ["informatika", "mathematics", "physics"],
  pools: { easy: [], medium: [], hard: [] }, idx: { easy: 0, medium: 0, hard: 0 },
  wordPools: { easy: [], medium: [], hard: [] },
  round: 0, totalRounds: 3,
  bank: 0,                 // накопленные секунды
  curDifficulty: "easy",
  phase: "read",           // фаза объяснения: read (10с) → explain (30/60/90)
  current: null, locked: false,
  blitzWords: [], blitzGuessed: 0,
  timer: null, timeLeft: 0,
};

setupPillsMulti("gromko-topic", (arr) => (gromko.topics = arr));

// --- Рекорд: максимальный накопленный банк (сек) ---
const gromkoRecords = { bank: 0 };
function saveGromkoBank(sec) {
  if (sec > gromkoRecords.bank) {
    gromkoRecords.bank = sec;
    tg?.CloudStorage?.setItem?.("gromko_bank", String(sec), () => {});
    return true;
  }
  return false;
}
function loadGromkoRecordsFromCloud() {
  if (!tg?.CloudStorage) return;
  tg.CloudStorage.getItem("gromko_bank", (err, val) => {
    if (!err && val) { gromkoRecords.bank = parseInt(val, 10) || 0; renderGromkoRecord(); }
  });
}
function renderGromkoRecord() {
  const hint = document.getElementById("gromko-record-hint");
  if (gromkoRecords.bank > 0) { document.getElementById("gromko-record").textContent = gromkoRecords.bank; hint.style.display = "block"; }
  else { hint.style.display = "none"; }
}
function updateGromkoBank() {
  document.querySelectorAll(".gromko-bank").forEach((el) => (el.textContent = gromko.bank));
}

// --- Громкая музыка в наушники игрока (WebAudio, зацикленный чиптюн) ---
let _gromkoMusic = null;
function gromkoStartMusic() {
  gromkoStopMusic(); // на всякий случай не плодим параллельные циклы
  try {
    _audioCtx = _audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const ctx = _audioCtx;
    if (ctx.state === "suspended") ctx.resume();
    const master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
    // бас-подложка
    const bass = ctx.createOscillator();
    const bg = ctx.createGain();
    bass.type = "triangle"; bass.frequency.value = 130.81; bg.gain.value = 0.5;
    bass.connect(bg).connect(master); bass.start();
    // зацикленное арпеджио
    const notes = [523.25, 659.25, 783.99, 659.25, 587.33, 784.0, 987.77, 784.0];
    let step = 0;
    const beat = 0.2;
    const iv = setInterval(() => {
      const f = notes[step++ % notes.length];
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = "sawtooth"; osc.frequency.value = f;
      const t0 = ctx.currentTime;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + beat * 0.9);
      osc.connect(g).connect(master);
      osc.start(t0); osc.stop(t0 + beat);
    }, beat * 1000);
    _gromkoMusic = { master, bass, iv };
  } catch (e) { /* звук недоступен — не критично */ }
}
function gromkoStopMusic() {
  if (!_gromkoMusic) return;
  try {
    clearInterval(_gromkoMusic.iv);
    _gromkoMusic.bass.stop();
    _gromkoMusic.master.disconnect();
  } catch (e) { /* ignore */ }
  _gromkoMusic = null;
}

function gromkoShuffle(a) { a.sort(() => Math.random() - 0.5); return a; }

// Предзагрузка: вопросы по всем трём уровням + слова для блица по всем уровням
async function gromkoLoad() {
  const topics = (gromko.topics || []).join(",");
  const [qe, qm, qh] = await Promise.all(
    ["easy", "medium", "hard"].map((d) =>
      fetch(`/api/questions?difficulty=${d}&limit=20&topics=${topics}`).then((r) => r.json()))
  );
  gromko.pools = { easy: qe.questions || [], medium: qm.questions || [], hard: qh.questions || [] };
  gromko.idx = { easy: 0, medium: 0, hard: 0 };

  const subj = (gromko.topics || []).map((t) => GROMKO_WORD_SUBJ[t]).filter(Boolean).join(",") || "informatika";
  const [we, wm, wh] = await Promise.all(
    ["easy", "medium", "hard"].map((d) =>
      fetch(`/api/words?difficulty=${d}&subjects=${subj}`).then((r) => r.json()))
  );
  gromko.wordPools = {
    easy: gromkoShuffle(we.items || []),
    medium: gromkoShuffle(wm.items || []),
    hard: gromkoShuffle(wh.items || []),
  };
}

async function gromkoStart() {
  hapticMedium();
  await gromkoLoad();
  gromko.round = 0;
  gromko.bank = 0;
  gromko.blitzGuessed = 0;
  updateGromkoBank();
  gromkoNextRound();
}

// Следующий раунд банка или переход к блицу
function gromkoNextRound() {
  if (gromko.timer) { clearInterval(gromko.timer); gromko.timer = null; }
  gromkoStopMusic();
  if (gromko.round >= gromko.totalRounds) { gromkoBlitzIntro(); return; }
  gromko.round++;
  document.getElementById("gromko-round").textContent = gromko.round;
  updateGromkoBank();
  // сброс выбора сложности
  gromko.curDifficulty = null;
  document.querySelectorAll("#screen-gromko-difficulty .gromko-diff-btn").forEach((b) => b.classList.remove("selected"));
  document.getElementById("btn-gromko-round-start").disabled = true;
  showScreen("gromkoDifficulty");
}

function gromkoSetLevelBadge(id, d) {
  const el = document.getElementById(id);
  el.textContent = `${GROMKO_LEVEL_NAME[d]} · +${GROMKO_BANK_SEC[d]}с`;
  el.className = "gromko-level-badge lvl-" + d;
}

// Игрок отметил сложность (кнопка «Начать раунд» разблокируется)
function gromkoSelectDifficulty(d) {
  gromko.curDifficulty = d;
  document.querySelectorAll("#screen-gromko-difficulty .gromko-diff-btn").forEach((b) =>
    b.classList.toggle("selected", b.dataset.difficulty === d));
  document.getElementById("btn-gromko-round-start").disabled = false;
}

// «Начать раунд» → показываем вопрос команде (без ответа), музыка и таймер
function gromkoStartRound() {
  const d = gromko.curDifficulty;
  if (!d) return;
  const pool = gromko.pools[d] || [];
  if (!pool.length) return;
  if (gromko.idx[d] >= pool.length) { gromkoShuffle(pool); gromko.idx[d] = 0; }
  gromko.current = pool[gromko.idx[d]++];
  gromko.locked = false;
  document.getElementById("gromko-question").textContent = gromko.current.q;
  gromkoSetLevelBadge("gromko-level-badge", d);
  updateGromkoBank();
  showScreen("gromkoExplain");
  gromkoStartMusic();
  gromkoStartExplainTimer();
}

// Фаза объяснения: сначала 10 сек на чтение вопроса, потом таймер уровня (30/60/90)
function gromkoRenderExplainPhase() {
  const badge = document.getElementById("gromko-phase-badge");
  const btn = document.getElementById("btn-gromko-toselect");
  if (gromko.phase === "read") {
    badge.textContent = "🤔 Читаем вопрос и думаем над ответом";
    badge.className = "gromko-badge phase-read";
    btn.textContent = "Объясняем! ▶";
  } else {
    badge.textContent = "🖐 Объясняйте жестами игроку в наушниках!";
    badge.className = "gromko-badge phase-explain";
    btn.textContent = "К выбору ответа →";
  }
}
function gromkoUpdateExplainTimer() {
  const el = document.getElementById("gromko-explain-timer");
  el.textContent = fmtTime(Math.max(0, gromko.timeLeft));
  el.classList.remove("warn", "danger");
  if (gromko.phase === "explain") {
    if (gromko.timeLeft <= 5) el.classList.add("danger");
    else if (gromko.timeLeft <= 10) el.classList.add("warn");
  }
}
function gromkoStartExplainTimer() {
  if (gromko.timer) { clearInterval(gromko.timer); gromko.timer = null; }
  gromko.phase = "read";
  gromko.timeLeft = 10;
  gromkoRenderExplainPhase();
  gromkoUpdateExplainTimer();
  gromko.timer = setInterval(gromkoExplainTick, 1000);
}
function gromkoExplainTick() {
  gromko.timeLeft--;
  gromkoUpdateExplainTimer();
  if (gromko.timeLeft > 0) return;
  if (gromko.phase === "read") {
    gromkoBeginExplaining();
  } else {
    if (gromko.timer) { clearInterval(gromko.timer); gromko.timer = null; }
    playTimeUpSound();
    gromkoToSelect();
  }
}
// read → explain (по истечении 10 сек или досрочно кнопкой)
function gromkoBeginExplaining() {
  gromko.phase = "explain";
  gromko.timeLeft = GROMKO_BANK_SEC[gromko.curDifficulty] || 60;
  hapticMedium();
  playTimeUpSound();
  gromkoRenderExplainPhase();
  gromkoUpdateExplainTimer();
  if (!gromko.timer) gromko.timer = setInterval(gromkoExplainTick, 1000);
}
// Кнопка на экране объяснения: read → сразу объяснять; explain → к выбору
function gromkoExplainAdvance() {
  if (gromko.phase === "read") gromkoBeginExplaining();
  else gromkoToSelect();
}

// Команда готова (или время вышло) → музыка стоп, игрок в наушниках выбирает вариант (вопрос не показываем)
function gromkoToSelect() {
  if (gromko.timer) { clearInterval(gromko.timer); gromko.timer = null; }
  gromkoStopMusic();
  hapticMedium();
  gromkoSetLevelBadge("gromko-level-badge-sel", gromko.curDifficulty);
  const wrap = document.getElementById("gromko-options");
  wrap.innerHTML = "";
  gromko.current.options.forEach((opt, i) => {
    const btn = document.createElement("button");
    btn.className = "answer-btn";
    btn.textContent = opt;
    btn.addEventListener("click", () => gromkoChoose(i, btn));
    wrap.appendChild(btn);
  });
  gromko.locked = false;
  document.getElementById("gromko-feedback").style.display = "none";
  document.getElementById("gromko-next-wrap").style.display = "none";
  showScreen("gromkoSelect");
}

function gromkoChoose(chosen, btnEl) {
  if (gromko.locked) return;
  gromko.locked = true;
  const correctIdx = gromko.current.correct;
  const isCorrect = chosen === correctIdx;
  const sec = GROMKO_BANK_SEC[gromko.curDifficulty];
  if (isCorrect) {
    gromko.bank += sec;
    btnEl.classList.add("correct");
    hapticSuccess();
  } else {
    btnEl.classList.add("wrong");
    document.querySelectorAll("#gromko-options .answer-btn")[correctIdx].classList.add("correct");
    hapticError();
  }
  document.querySelectorAll("#gromko-options .answer-btn").forEach((b) => (b.disabled = true));
  updateGromkoBank();
  const fb = document.getElementById("gromko-feedback");
  fb.textContent = isCorrect ? `✅ Верно! +${sec}с в банк` : "❌ Мимо. 0 секунд";
  fb.className = "gromko-feedback " + (isCorrect ? "ok" : "no");
  fb.style.display = "block";
  document.getElementById("btn-gromko-next").textContent =
    gromko.round >= gromko.totalRounds ? "К супер-блицу ⚡" : "Дальше →";
  document.getElementById("gromko-next-wrap").style.display = "";
}

// --- Супер-блиц ---
function gromkoPickWord(d) {
  const p = gromko.wordPools[d] || [];
  if (!p.length) return { word: "—", emoji: "" };
  return p[Math.floor(Math.random() * p.length)];
}

function gromkoBlitzIntro() {
  gromkoStopMusic();
  // два простых (разные) + одно среднее
  const easy = gromkoShuffle((gromko.wordPools.easy || []).slice());
  const med = gromko.wordPools.medium || [];
  const e1 = easy[0] || { word: "—" };
  const e2 = easy[1] || easy[0] || { word: "—" };
  const m1 = med.length ? med[Math.floor(Math.random() * med.length)] : { word: "—" };
  gromko.blitzWords = [
    { word: e1.word, emoji: e1.emoji || "", level: "easy", done: false },
    { word: e2.word, emoji: e2.emoji || "", level: "easy", done: false },
    { word: m1.word, emoji: m1.emoji || "", level: "medium", done: false },
  ];
  gromko.blitzGuessed = 0;
  document.getElementById("gromko-blitz-bank").textContent = gromko.bank;
  showScreen("gromkoBlitzIntro");
}

// Слова можно объяснять в ЛЮБОМ порядке: тапнул угаданное — оно отмечается
function gromkoRenderBlitzWords() {
  const wrap = document.getElementById("gromko-blitz-words");
  wrap.innerHTML = "";
  gromko.blitzWords.forEach((w, i) => {
    const row = document.createElement("div");
    row.className = "blitz-word" + (w.done ? " done" : " tap");
    const st = document.createElement("span");
    st.className = "bw-status";
    st.textContent = w.done ? "✅" : "◯";
    const wd = document.createElement("span");
    wd.className = "bw-word";
    wd.textContent = w.word;
    const lv = document.createElement("span");
    lv.className = "bw-level lvl-" + w.level;
    lv.textContent = GROMKO_LEVEL_NAME[w.level];
    row.append(st, wd, lv);
    if (!w.done) row.addEventListener("click", () => gromkoBlitzGuess(i));
    wrap.appendChild(row);
  });
}

function gromkoUpdateBlitzTimer() {
  const el = document.getElementById("gromko-blitz-timer");
  el.textContent = fmtTime(Math.max(0, gromko.timeLeft));
  el.classList.remove("warn", "danger");
  if (gromko.timeLeft <= 10) el.classList.add("danger");
  else if (gromko.timeLeft <= 20) el.classList.add("warn");
}

function gromkoBlitzStart() {
  gromko.timeLeft = gromko.bank;
  if (gromko.timeLeft <= 0) { gromkoBlitzEnd(false); return; }
  gromko.blitzWords.forEach((w) => (w.done = false));
  gromko.blitzGuessed = 0;
  gromkoRenderBlitzWords();
  document.getElementById("gromko-blitz-done").textContent = 0;
  gromkoUpdateBlitzTimer();
  showScreen("gromkoBlitz");
  gromkoStartMusic();
  hapticMedium();
  gromko.timer = setInterval(() => {
    gromko.timeLeft--;
    gromkoUpdateBlitzTimer();
    if (gromko.timeLeft <= 0) { clearInterval(gromko.timer); gromko.timer = null; gromkoBlitzEnd(false); }
  }, 1000);
}

function gromkoBlitzGuess(i) {
  const w = gromko.blitzWords[i];
  if (!w || w.done) return;
  w.done = true;
  gromko.blitzGuessed = gromko.blitzWords.filter((x) => x.done).length;
  document.getElementById("gromko-blitz-done").textContent = gromko.blitzGuessed;
  hapticSuccess();
  if (gromko.blitzWords.every((x) => x.done)) {
    if (gromko.timer) { clearInterval(gromko.timer); gromko.timer = null; }
    gromkoBlitzEnd(true);
  } else {
    gromkoRenderBlitzWords();
  }
}

async function gromkoBlitzEnd(win) {
  if (gromko.timer) { clearInterval(gromko.timer); gromko.timer = null; }
  gromkoStopMusic();
  if (win) { hapticSuccess(); } else { hapticError(); playTimeUpSound(); }
  const isRecord = saveGromkoBank(gromko.bank);
  document.getElementById("gromko-result-title").textContent = win ? "🏆 Победа!" : "⌛ Время вышло";
  document.getElementById("gromko-result-bank").textContent = gromko.bank;
  document.getElementById("gromko-result-words").textContent = gromko.blitzGuessed;
  document.getElementById("gromko-new-record").style.display = isRecord && gromko.bank > 0 ? "block" : "none";
  document.getElementById("gromko-result-msg").textContent = win
    ? `Успели объяснить все 3 слова! Осталось ${Math.max(0, gromko.timeLeft)} сек.`
    : `Объяснено ${gromko.blitzGuessed} из 3. В следующий раз копите больше времени!`;
  showScreen("gromkoResult");
  const res = await awardTraining("party", 5, { game: "gromko" });
  showRatingToast(res);
}

function gromkoAbort() {
  if (gromko.timer) { clearInterval(gromko.timer); gromko.timer = null; }
  gromkoStopMusic();
  showScreen("party");
}

document.getElementById("btn-gromko-start").addEventListener("click", gromkoStart);
document.getElementById("btn-gromko-again").addEventListener("click", gromkoStart);
document.querySelectorAll("#screen-gromko-difficulty .gromko-diff-btn").forEach((b) =>
  b.addEventListener("click", () => { hapticLight(); gromkoSelectDifficulty(b.dataset.difficulty); }));
document.getElementById("btn-gromko-round-start").addEventListener("click", () => { hapticMedium(); gromkoStartRound(); });
document.getElementById("btn-gromko-toselect").addEventListener("click", gromkoExplainAdvance);
document.getElementById("btn-gromko-next").addEventListener("click", gromkoNextRound);
document.getElementById("btn-gromko-abort").addEventListener("click", gromkoAbort);
document.getElementById("btn-gromko-blitz-start").addEventListener("click", gromkoBlitzStart);

// ==============================
// ========== СПРИНТ ============
// ==============================
const sprint = {
  difficulty: "easy",
  duration: 60,
  questions: [],
  qIndex: 0,
  timer: null,
  timeLeft: 0,
  correct: 0,
  wrong: 0,
  locked: false,
};

sprint.topics = ["informatika", "mathematics", "physics"];
setupPills("sprint-difficulty", (v) => { sprint.difficulty = v; renderSprintRecord(); updateSprintMult(); });
setupPillsMulti("sprint-topic", (arr) => (sprint.topics = arr));
setupPills("sprint-duration", (v) => { sprint.duration = v; renderSprintRecord(); }, (v) => parseInt(v, 10));

function updateSprintMult() {
  const map = {easy: "×1", medium: "×1.5", hard: "×2"};
  const el = document.getElementById("sprint-mult");
  if (el) el.textContent = map[sprint.difficulty] || "×1";
}
updateSprintMult();

// --- Рекорды (сохраняем в памяти на время сессии + Telegram CloudStorage если доступно) ---
const records = {};

function recordKey() {
  return `sprint_${sprint.difficulty}_${sprint.duration}`;
}

function getRecord() {
  return records[recordKey()] || 0;
}

function saveRecord(score) {
  const key = recordKey();
  if (score > (records[key] || 0)) {
    records[key] = score;
    // Пробуем сохранить в Telegram CloudStorage
    tg?.CloudStorage?.setItem?.(key, String(score), () => {});
    return true;
  }
  return false;
}

function loadRecordsFromCloud() {
  if (!tg?.CloudStorage) return;
  const keys = [];
  for (const d of ["easy", "medium", "hard"]) {
    for (const t of [30, 60, 90]) keys.push(`sprint_${d}_${t}`);
  }
  tg.CloudStorage.getItems(keys, (err, values) => {
    if (err || !values) return;
    Object.entries(values).forEach(([k, v]) => {
      if (v) records[k] = parseInt(v, 10) || 0;
    });
    renderSprintRecord();
  });
}

function renderSprintRecord() {
  const rec = getRecord();
  const hint = document.getElementById("sprint-record-hint");
  if (rec > 0) {
    document.getElementById("sprint-record").textContent = rec;
    hint.style.display = "block";
  } else {
    hint.style.display = "none";
  }
}

// --- Игра ---
async function sprintLoadQuestions() {
  const r = await fetch(`/api/questions?difficulty=${sprint.difficulty}&limit=50&topics=${(sprint.topics || []).join(",")}`);
  const data = await r.json();
  sprint.questions = data.questions;
  sprint.qIndex = 0;
}

function sprintUpdateTimer() {
  const el = document.getElementById("sprint-timer");
  el.textContent = sprint.timeLeft;
  el.classList.remove("warn", "danger");
  if (sprint.timeLeft <= 5) el.classList.add("danger");
  else if (sprint.timeLeft <= 10) el.classList.add("warn");
}

function sprintStartTimer() {
  sprint.timeLeft = sprint.duration;
  sprintUpdateTimer();
  sprint.timer = setInterval(() => {
    sprint.timeLeft--;
    sprintUpdateTimer();
    if (sprint.timeLeft <= 0) { playTimeUpSound(); sprintFinish(); }
    else playTick(sprint.timeLeft);
  }, 1000);
}

function sprintRenderQuestion() {
  if (sprint.qIndex >= sprint.questions.length) {
    // Вопросы кончились — перемешаем и с начала
    sprint.questions.sort(() => Math.random() - 0.5);
    sprint.qIndex = 0;
  }
  const q = sprint.questions[sprint.qIndex];
  document.getElementById("sprint-question").textContent = q.q;
  const wrap = document.getElementById("sprint-answers");
  wrap.innerHTML = "";
  q.options.forEach((opt, i) => {
    const btn = document.createElement("button");
    btn.className = "answer-btn";
    btn.textContent = opt;
    btn.addEventListener("click", () => sprintAnswer(i, btn));
    wrap.appendChild(btn);
  });
  sprint.locked = false;
}

function sprintAnswer(chosen, btnEl) {
  if (sprint.locked) return;
  sprint.locked = true;
  const q = sprint.questions[sprint.qIndex];
  const isCorrect = chosen === q.correct;

  if (isCorrect) {
    sprint.correct++;
    btnEl.classList.add("correct");
    hapticSuccess();
  } else {
    sprint.wrong++;
    btnEl.classList.add("wrong");
    // подсветим правильный
    document.querySelectorAll(".answer-btn")[q.correct].classList.add("correct");
    hapticError();
  }
  document.getElementById("sprint-score").textContent = sprint.correct;

  // Блокируем все кнопки
  document.querySelectorAll(".answer-btn").forEach((b) => (b.disabled = true));

  // Переход к следующему вопросу
  setTimeout(() => {
    sprint.qIndex++;
    sprintRenderQuestion();
  }, isCorrect ? 350 : 800);
}

async function sprintStart() {
  hapticMedium();
  await sprintLoadQuestions();
  sprint.correct = 0;
  sprint.wrong = 0;
  document.getElementById("sprint-score").textContent = 0;
  showScreen("sprint");
  sprintRenderQuestion();
  sprintStartTimer();
}

async function sprintFinish() {
  clearInterval(sprint.timer);
  sprint.timer = null;
  const oldRecord = getRecord();
  const isNewRecord = saveRecord(sprint.correct);
  document.getElementById("sprint-r-best").textContent = getRecord();
  document.getElementById("sprint-new-record").style.display =
    isNewRecord && sprint.correct > 0 ? "block" : "none";
  // «До рекорда осталось X»
  const toRec = document.getElementById("sprint-r-torec");
  if (!isNewRecord && oldRecord > 0 && sprint.correct > 0) {
    const diff = oldRecord - sprint.correct;
    toRec.textContent = diff > 0 ? `· до рекорда ${diff}` : "";
  } else {
    toRec.textContent = "";
  }

  // Начисляем очки на сервере
  const res = sprint.correct > 0
    ? await awardTraining("sprint", sprint.correct, {correct: sprint.correct, difficulty: sprint.difficulty})
    : {delta_awarded: 0, xp_awarded: 0};

  showProfikResult("sprint", {correct: sprint.correct});
  showTrainingResult({
    screenName: "sprintResult",
    screenId: "screen-sprint-result",
    correctEl: document.getElementById("sprint-r-correct"), correctTo: sprint.correct,
    wrongEl:   document.getElementById("sprint-r-wrong"),   wrongTo:   sprint.wrong,
    ratingEl:  document.getElementById("sprint-r-rating"),
    xpEl:      document.getElementById("sprint-r-xp"),
    res,
    levelupBlockId: "sprint-levelup", levelupNumId: "sprint-levelup-num",
    achContainerId: "sprint-achievements",
  });
  hapticSuccess();
}

document.getElementById("btn-sprint-start").addEventListener("click", sprintStart);
document.getElementById("btn-sprint-again").addEventListener("click", sprintStart);
document.getElementById("btn-sprint-stop").addEventListener("click", sprintFinish);

// ==============================
// ========== ALIAS =============
// ==============================
const alias = {
  difficulty: "easy",
  duration: 90,
  subjects: ["informatika"],
  showBanned: true,
  items: [],
  idx: 0,
  timer: null,
  timeLeft: 0,
  ok: 0,
  skip: 0,
  fail: 0,
};

setupPills("alias-difficulty", (v) => (alias.difficulty = v));
setupPills("alias-duration", (v) => (alias.duration = v), (v) => parseInt(v, 10));
setupPillsMulti("alias-subjects", (arr) => (alias.subjects = arr));
document.getElementById("alias-banned-toggle").addEventListener("change", (e) => {
  alias.showBanned = e.target.checked;
});

async function aliasLoad() {
  const r = await fetch(`/api/alias?difficulty=${alias.difficulty}&subjects=${alias.subjects.join(",")}`);
  const d = await r.json();
  alias.items = d.items;
  alias.idx = 0;
}

function aliasNextWord() {
  if (alias.idx >= alias.items.length) {
    alias.items.sort(() => Math.random() - 0.5);
    alias.idx = 0;
  }
  const it = alias.items[alias.idx++];
  document.getElementById("alias-word").textContent = it.word;
  document.getElementById("alias-emoji").textContent = it.emoji || "";
  const ul = document.getElementById("alias-banned");
  const title = document.querySelector(".alias-banned-title");
  ul.innerHTML = "";
  if (alias.showBanned) {
    if (title) title.style.display = "";
    ul.style.display = "";
    (it.banned || []).forEach((w) => {
      const li = document.createElement("li");
      li.textContent = w;
      ul.appendChild(li);
    });
  } else {
    if (title) title.style.display = "none";
    ul.style.display = "none";
  }
}

function aliasUpdateTimer() {
  const el = document.getElementById("alias-timer");
  el.textContent = alias.timeLeft;
  el.classList.remove("warn", "danger");
  if (alias.timeLeft <= 5) el.classList.add("danger");
  else if (alias.timeLeft <= 15) el.classList.add("warn");
}

function aliasStartTimer() {
  alias.timeLeft = alias.duration;
  aliasUpdateTimer();
  alias.timer = setInterval(() => {
    alias.timeLeft--;
    aliasUpdateTimer();
    if (alias.timeLeft <= 0) { playTimeUpSound(); aliasStop(); }
    else playTick(alias.timeLeft);
  }, 1000);
}

async function aliasStart() {
  hapticMedium();
  await aliasLoad();
  alias.ok = 0; alias.skip = 0; alias.fail = 0;
  document.getElementById("alias-score-ok").textContent = 0;
  document.getElementById("alias-score-skip").textContent = 0;
  document.getElementById("alias-score-fail").textContent = 0;
  showScreen("alias");
  aliasNextWord();
  aliasStartTimer();
}

async function aliasStop() {
  clearInterval(alias.timer);
  alias.timer = null;
  const total = alias.ok - alias.fail;
  document.getElementById("alias-r-ok").textContent = alias.ok;
  document.getElementById("alias-r-skip").textContent = alias.skip;
  document.getElementById("alias-r-fail").textContent = alias.fail;
  document.getElementById("alias-r-total").textContent = total;
  showScreen("aliasResult");
  hapticSuccess();
  const res = await awardTraining("party", 5, { game: "alias" });
  showRatingToast(res);
}

document.getElementById("btn-alias-start").addEventListener("click", aliasStart);
document.getElementById("btn-alias-again").addEventListener("click", aliasStart);
document.getElementById("btn-alias-stop").addEventListener("click", aliasStop);
document.getElementById("btn-alias-ok").addEventListener("click", () => {
  alias.ok++;
  document.getElementById("alias-score-ok").textContent = alias.ok;
  hapticLight();
  aliasNextWord();
});
document.getElementById("btn-alias-skip").addEventListener("click", () => {
  alias.skip++;
  document.getElementById("alias-score-skip").textContent = alias.skip;
  hapticLight();
  aliasNextWord();
});
document.getElementById("btn-alias-fail").addEventListener("click", () => {
  alias.fail++;
  document.getElementById("alias-score-fail").textContent = alias.fail;
  hapticError();
  aliasNextWord();
});

// ==============================
// ========= МАРАФОН ============
// ==============================
// Жизни зависят от сложности; серия правильных подряд восполняет жизнь (макс 3).
const MARATHON_LIVES = { easy: 1, medium: 2, hard: 3 };
const MARATHON_LIFE_STREAK = { easy: 30, medium: 20, hard: 10 };
const MARATHON_MAX_LIVES = 3;

const marathon = {
  difficulty: "easy",
  questions: [],
  qIndex: 0,
  livesLeft: 1,
  correct: 0,
  streak: 0,
  bestStreak: 0,
  locked: false,
};

marathon.topics = ["informatika", "mathematics", "physics"];
setupPills("marathon-difficulty", (v) => { marathon.difficulty = v; updateMarathonMult(); });
setupPillsMulti("marathon-topic", (arr) => (marathon.topics = arr));

function updateMarathonMult() {
  const dm = {easy: 1, medium: 1.5, hard: 2}[marathon.difficulty] || 1;
  const el = document.getElementById("marathon-mult");
  if (el) el.textContent = "×" + (Number.isInteger(dm) ? dm : dm.toFixed(1));
}
updateMarathonMult();

function marathonRecordKey() {
  return `marathon_${marathon.difficulty}`;
}
function showLifeToast() {
  const t = document.createElement("div");
  t.className = "rating-toast ok show";
  t.innerHTML = "❤️ <b>+1 жизнь</b> за серию!";
  document.body.appendChild(t);
  setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 1500);
  if (window.Telegram?.WebApp?.HapticFeedback) window.Telegram.WebApp.HapticFeedback.notificationOccurred("success");
}
function getMarathonRecord() { return records[marathonRecordKey()] || 0; }
function saveMarathonRecord(score) {
  const k = marathonRecordKey();
  if (score > (records[k] || 0)) {
    records[k] = score;
    tg?.CloudStorage?.setItem?.(k, String(score), () => {});
    return true;
  }
  return false;
}
function renderMarathonRecord() {
  const rec = getMarathonRecord();
  const hint = document.getElementById("marathon-record-hint");
  if (rec > 0) {
    document.getElementById("marathon-record").textContent = rec;
    hint.style.display = "block";
  } else {
    hint.style.display = "none";
  }
}

function marathonRenderLives() {
  const wrap = document.getElementById("marathon-lives-view");
  wrap.innerHTML = "";
  for (let i = 0; i < MARATHON_MAX_LIVES; i++) {
    const span = document.createElement("span");
    span.textContent = "❤️";
    if (i >= marathon.livesLeft) span.classList.add("lost");
    wrap.appendChild(span);
  }
}

function marathonRenderStreak() {
  const wrap = document.getElementById("marathon-streak-wrap");
  const el = document.getElementById("marathon-streak");
  if (marathon.streak >= 3) {
    el.textContent = marathon.streak;
    wrap.style.display = "flex";
  } else {
    wrap.style.display = "none";
  }
}

async function marathonLoad() {
  const r = await fetch(`/api/marathon?difficulty=${marathon.difficulty}&limit=300&topics=${(marathon.topics || []).join(",")}`);
  const d = await r.json();
  marathon.questions = d.questions;
  marathon.qIndex = 0;
}

function marathonRenderQ() {
  if (marathon.qIndex >= marathon.questions.length) {
    // Дозагрузим ещё пачку
    marathonLoad().then(marathonRenderQ);
    return;
  }
  const q = marathon.questions[marathon.qIndex];
  document.getElementById("marathon-question").textContent = q.q;
  const wrap = document.getElementById("marathon-answers");
  wrap.innerHTML = "";
  q.options.forEach((opt, i) => {
    const btn = document.createElement("button");
    btn.className = "answer-btn";
    btn.textContent = opt;
    btn.addEventListener("click", () => marathonAnswer(i, btn));
    wrap.appendChild(btn);
  });
  marathon.locked = false;
}

function marathonAnswer(chosen, btnEl) {
  if (marathon.locked) return;
  marathon.locked = true;
  const q = marathon.questions[marathon.qIndex];
  const isCorrect = chosen === q.correct;
  const allBtns = document.querySelectorAll("#marathon-answers .answer-btn");

  if (isCorrect) {
    btnEl.classList.add("correct");
    marathon.correct++;
    marathon.streak++;
    if (marathon.streak > marathon.bestStreak) marathon.bestStreak = marathon.streak;
    // Восполнение жизни за серию правильных подряд (до максимума)
    const need = MARATHON_LIFE_STREAK[marathon.difficulty] || 20;
    if (marathon.livesLeft < MARATHON_MAX_LIVES && marathon.streak % need === 0) {
      marathon.livesLeft++;
      showLifeToast();
    }
    hapticSuccess();
  } else {
    btnEl.classList.add("wrong");
    // подсветим правильный
    allBtns[q.correct].classList.add("correct");
    marathon.livesLeft--;
    marathon.streak = 0;
    hapticError();
  }
  allBtns.forEach((b) => (b.disabled = true));
  document.getElementById("marathon-answered").textContent = marathon.correct;
  marathonRenderLives();
  marathonRenderStreak();

  const delay = isCorrect ? 500 : 1200;
  setTimeout(() => {
    marathon.qIndex++;
    if (marathon.livesLeft <= 0) {
      marathonFinish(false);
    } else {
      marathonRenderQ();
    }
  }, delay);
}

async function marathonStart() {
  hapticMedium();
  await marathonLoad();
  marathon.livesLeft = MARATHON_LIVES[marathon.difficulty] || 1;
  marathon.correct = 0;
  marathon.streak = 0;
  marathon.bestStreak = 0;
  document.getElementById("marathon-answered").textContent = 0;
  marathonRenderLives();
  marathonRenderStreak();
  showScreen("marathon");
  marathonRenderQ();
}

async function marathonFinish(userQuit) {
  const oldMarathonRec = getMarathonRecord();
  const isNew = saveMarathonRecord(marathon.correct);
  document.getElementById("marathon-r-best").textContent = getMarathonRecord();
  const toMRec = document.getElementById("marathon-r-torec");
  if (!isNew && oldMarathonRec > 0 && marathon.correct > 0) {
    const diff = oldMarathonRec - marathon.correct;
    toMRec.textContent = diff > 0 ? `· до рекорда ${diff}` : "";
  } else {
    toMRec.textContent = "";
  }
  document.getElementById("marathon-result-title").textContent =
    userQuit ? "🏳 Сдался" : "🏁 Марафон окончен";
  document.getElementById("marathon-new-record").style.display =
    isNew && marathon.correct > 0 ? "block" : "none";

  const res = marathon.correct > 0
    ? await awardTraining("marathon", marathon.correct * 2, {
        correct: marathon.correct, difficulty: marathon.difficulty
      })
    : {delta_awarded: 0, xp_awarded: 0};

  showProfikResult("marathon", {correct: marathon.correct});
  showTrainingResult({
    screenName: "marathonResult",
    screenId: "screen-marathon-result",
    correctEl: document.getElementById("marathon-r-correct"), correctTo: marathon.correct,
    wrongEl:   document.getElementById("marathon-r-streak"),  wrongTo:   marathon.bestStreak,
    ratingEl:  document.getElementById("marathon-r-rating"),
    xpEl:      document.getElementById("marathon-r-xp"),
    res,
    levelupBlockId: "marathon-levelup", levelupNumId: "marathon-levelup-num",
    achContainerId: "marathon-achievements",
  });
  hapticSuccess();
}

document.getElementById("btn-marathon-start").addEventListener("click", marathonStart);
document.getElementById("btn-marathon-again").addEventListener("click", marathonStart);
document.getElementById("btn-marathon-stop").addEventListener("click", () => marathonFinish(true));

// ==== Загрузка рекордов Марафона из облака ====
(function preloadMarathonRecords() {
  if (!tg?.CloudStorage) return;
  const keys = ["easy", "medium", "hard"].map((d) => `marathon_${d}`);
  tg.CloudStorage.getItems(keys, (err, values) => {
    if (err || !values) return;
    Object.entries(values).forEach(([k, v]) => {
      if (v) records[k] = parseInt(v, 10) || 0;
    });
  });
})();

// ==============================
// ======= УГАДАЙ ЧИСЛО =========
// ==============================
// Отдельная тренировочная игра уровня Спринт/Марафон: рейтинг с общим капом 100/день
// (источник numguess) и своя таблица лидеров. Механика «больше/меньше».
const NG_LEVELS = {
  easy:   { max: 10,   time: 15 },
  medium: { max: 100,  time: 20 },
  hard:   { max: 1000, time: 30 },
};
const numguess = { difficulty: "easy", target: 0, lo: 1, hi: 10, timeLeft: 0, timer: null, tries: 0, locked: false };

setupPills("numguess-difficulty", (v) => { numguess.difficulty = v; updateNumguessMult(); });
function updateNumguessMult() {
  const dm = { easy: 1, medium: 1.5, hard: 2 }[numguess.difficulty] || 1;
  const el = document.getElementById("numguess-mult");
  if (el) el.textContent = "×" + (Number.isInteger(dm) ? dm : dm.toFixed(1));
}
updateNumguessMult();

function numguessStart() {
  hapticMedium();
  const cfg = NG_LEVELS[numguess.difficulty];
  numguess.target = 1 + Math.floor(Math.random() * cfg.max);
  numguess.lo = 1; numguess.hi = cfg.max;
  numguess.timeLeft = cfg.time; numguess.tries = 0; numguess.locked = false;
  document.getElementById("numguess-range").textContent = `от ${numguess.lo} до ${numguess.hi}`;
  document.getElementById("numguess-tries").textContent = 0;
  const fb = document.getElementById("numguess-feedback");
  fb.textContent = "Введите догадку"; fb.className = "tb-num-feedback";
  const inp = document.getElementById("numguess-input");
  inp.value = ""; inp.disabled = false;
  document.getElementById("btn-numguess-guess").disabled = false;
  numguessUpdateTimer();
  showScreen("numguessPlay");
  try { inp.focus(); } catch (e) {}
  numguess.timer = setInterval(() => {
    numguess.timeLeft--; numguessUpdateTimer();
    if (numguess.timeLeft <= 0) { clearInterval(numguess.timer); numguess.timer = null; playTimeUpSound(); numguessEnd(false); }
    else playTick(numguess.timeLeft);
  }, 1000);
}
function numguessUpdateTimer() {
  const el = document.getElementById("numguess-timer");
  el.textContent = numguess.timeLeft;
  el.classList.remove("warn", "danger");
  if (numguess.timeLeft <= 5) el.classList.add("danger");
  else if (numguess.timeLeft <= 10) el.classList.add("warn");
}
function numguessGuess() {
  if (numguess.locked) return;
  const inp = document.getElementById("numguess-input");
  const g = parseInt(inp.value, 10);
  const fb = document.getElementById("numguess-feedback");
  if (isNaN(g)) { fb.textContent = "Введите число"; fb.className = "tb-num-feedback"; return; }
  numguess.tries++;
  document.getElementById("numguess-tries").textContent = numguess.tries;
  if (g === numguess.target) { numguessEnd(true); return; }
  if (g < numguess.target) { numguess.lo = Math.max(numguess.lo, g + 1); fb.textContent = "📈 Больше!"; fb.className = "tb-num-feedback up"; }
  else { numguess.hi = Math.min(numguess.hi, g - 1); fb.textContent = "📉 Меньше!"; fb.className = "tb-num-feedback down"; }
  hapticLight();
  document.getElementById("numguess-range").textContent = `от ${numguess.lo} до ${numguess.hi}`;
  inp.value = ""; try { inp.focus(); } catch (e) {}
}
function numguessEnd(win) {
  if (numguess.locked) return;
  numguess.locked = true;
  if (numguess.timer) { clearInterval(numguess.timer); numguess.timer = null; }
  const fb = document.getElementById("numguess-feedback");
  document.getElementById("numguess-input").disabled = true;
  document.getElementById("btn-numguess-guess").disabled = true;
  if (win) {
    hapticSuccess();
    fb.textContent = `✅ Это ${numguess.target}! За ${numguess.tries} попыток`;
    fb.className = "tb-num-feedback win";
    awardTraining("numguess", 1, { correct: 1, difficulty: numguess.difficulty }).then(showRatingToast);
  } else {
    hapticError();
    fb.textContent = `⌛ Время! Было ${numguess.target}`;
    fb.className = "tb-num-feedback down";
  }
  setTimeout(() => {
    resetLbTabs("numguess-lb");
    loadGameLeaderboard("numguess", "numguess-lb-list", "all");
    showScreen("numguessSetup");
  }, 1700);
}

document.getElementById("btn-numguess-start").addEventListener("click", numguessStart);
document.getElementById("btn-numguess-guess").addEventListener("click", numguessGuess);
document.getElementById("numguess-input").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); numguessGuess(); } });
document.getElementById("btn-numguess-stop").addEventListener("click", () => numguessEnd(false));

// ==============================
// ======= БЫСТРЫЙ СЧЁТ =========
// ==============================
// Отдельная тренировочная игра уровня Спринта: примеры генерируются на лету,
// 4 варианта, таймер, рейтинг с общим капом 100/день (источник fastmath), своя таблица лидеров.
const fastmath = { difficulty: "easy", duration: 60, timeLeft: 0, timer: null, correct: 0, wrong: 0, cur: null, locked: false };

setupPills("fastmath-difficulty", (v) => { fastmath.difficulty = v; updateFastmathMult(); });
function updateFastmathMult() {
  const dm = { easy: 1, medium: 1.5, hard: 2 }[fastmath.difficulty] || 1;
  const el = document.getElementById("fastmath-mult");
  if (el) el.textContent = "×" + (Number.isInteger(dm) ? dm : dm.toFixed(1));
}
updateFastmathMult();

function fmRand(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function fmGen(difficulty) {
  let a, b, answer, expr;
  if (difficulty === "easy") {
    const t = fmRand(1, 3);
    if (t === 1) { a = fmRand(2, 20); b = fmRand(2, 20); answer = a + b; expr = `${a} + ${b}`; }
    else if (t === 2) { a = fmRand(5, 25); b = fmRand(1, a); answer = a - b; expr = `${a} − ${b}`; }
    else { a = fmRand(2, 9); b = fmRand(2, 9); answer = a * b; expr = `${a} × ${b}`; }
  } else if (difficulty === "medium") {
    const t = fmRand(1, 4);
    if (t === 1) { a = fmRand(15, 99); b = fmRand(15, 99); answer = a + b; expr = `${a} + ${b}`; }
    else if (t === 2) { a = fmRand(30, 120); b = fmRand(5, a); answer = a - b; expr = `${a} − ${b}`; }
    else if (t === 3) { a = fmRand(3, 12); b = fmRand(3, 12); answer = a * b; expr = `${a} × ${b}`; }
    else { b = fmRand(2, 12); answer = fmRand(2, 12); a = b * answer; expr = `${a} ÷ ${b}`; }
  } else {
    const t = fmRand(1, 5);
    if (t === 1) { a = fmRand(100, 500); b = fmRand(100, 500); answer = a + b; expr = `${a} + ${b}`; }
    else if (t === 2) { a = fmRand(120, 600); b = fmRand(20, a); answer = a - b; expr = `${a} − ${b}`; }
    else if (t === 3) { a = fmRand(6, 19); b = fmRand(6, 19); answer = a * b; expr = `${a} × ${b}`; }
    else if (t === 4) { b = fmRand(3, 12); answer = fmRand(4, 15); a = b * answer; expr = `${a} ÷ ${b}`; }
    else {
      if (fmRand(0, 1)) { const x = fmRand(2, 30); const c = fmRand(3, 40); answer = x; expr = `x + ${c} = ${x + c}`; }
      else { const k = fmRand(2, 9); const x = fmRand(2, 12); answer = x; expr = `${k}·x = ${k * x}`; }
    }
  }
  return { expr, answer };
}
function fmBuildOptions(answer) {
  const set = new Set([answer]);
  const offs = [1, -1, 2, -2, 3, -3, 5, -5, 10, -10];
  let guard = 0;
  while (set.size < 4 && guard++ < 50) {
    const v = answer + offs[Math.floor(Math.random() * offs.length)];
    if (v >= 0 && v !== answer) set.add(v);
  }
  let bump = 1;
  while (set.size < 4) { if (answer + bump >= 0) set.add(answer + bump); bump++; }
  const arr = [...set];
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return { options: arr, correct: arr.indexOf(answer) };
}

function fastmathRenderQ() {
  const g = fmGen(fastmath.difficulty);
  const o = fmBuildOptions(g.answer);
  fastmath.cur = { answer: g.answer, correct: o.correct };
  document.getElementById("fastmath-expr").textContent = g.expr;
  const wrap = document.getElementById("fastmath-answers");
  wrap.innerHTML = "";
  o.options.forEach((opt, i) => {
    const btn = document.createElement("button");
    btn.className = "answer-btn";
    btn.textContent = opt;
    btn.addEventListener("click", () => fastmathAnswer(i, btn));
    wrap.appendChild(btn);
  });
  fastmath.locked = false;
}
function fastmathUpdateTimer() {
  const el = document.getElementById("fastmath-timer");
  el.textContent = fastmath.timeLeft;
  el.classList.remove("warn", "danger");
  if (fastmath.timeLeft <= 5) el.classList.add("danger");
  else if (fastmath.timeLeft <= 10) el.classList.add("warn");
}
function fastmathAnswer(chosen, btnEl) {
  if (fastmath.locked) return;
  fastmath.locked = true;
  const isCorrect = chosen === fastmath.cur.correct;
  const btns = document.querySelectorAll("#fastmath-answers .answer-btn");
  if (isCorrect) { fastmath.correct++; btnEl.classList.add("correct"); hapticSuccess(); }
  else { fastmath.wrong++; btnEl.classList.add("wrong"); btns[fastmath.cur.correct].classList.add("correct"); hapticError(); }
  document.getElementById("fastmath-score").textContent = fastmath.correct;
  btns.forEach((b) => (b.disabled = true));
  setTimeout(fastmathRenderQ, isCorrect ? 300 : 700);
}
function fastmathStart() {
  hapticMedium();
  fastmath.correct = 0; fastmath.wrong = 0; fastmath.timeLeft = fastmath.duration;
  document.getElementById("fastmath-score").textContent = 0;
  fastmathUpdateTimer();
  showScreen("fastmathPlay");
  fastmathRenderQ();
  fastmath.timer = setInterval(() => {
    fastmath.timeLeft--; fastmathUpdateTimer();
    if (fastmath.timeLeft <= 0) { playTimeUpSound(); fastmathFinish(); }
    else playTick(fastmath.timeLeft);
  }, 1000);
}
async function fastmathFinish() {
  if (fastmath.timer) { clearInterval(fastmath.timer); fastmath.timer = null; }
  const isRecord = fmSaveRecord(fastmath.correct);
  document.getElementById("fastmath-r-correct").textContent = fastmath.correct;
  document.getElementById("fastmath-r-wrong").textContent = fastmath.wrong;
  document.getElementById("fastmath-r-best").textContent = fmGetRecord();
  document.getElementById("fastmath-new-record").style.display = isRecord && fastmath.correct > 0 ? "block" : "none";
  const res = fastmath.correct > 0
    ? await awardTraining("fastmath", fastmath.correct, { correct: fastmath.correct, difficulty: fastmath.difficulty })
    : { delta_awarded: 0, xp_awarded: 0 };
  document.getElementById("fastmath-r-rating").textContent = res.delta_awarded || 0;
  document.getElementById("fastmath-r-xp").textContent = res.xp_awarded || 0;
  showScreen("fastmathResult");
  hapticSuccess();
}

// Рекорды (личный лучший результат по сложности+длительности)
const fmRecords = {};
function fmRecordKey() { return `fastmath_${fastmath.difficulty}_${fastmath.duration}`; }
function fmGetRecord() { return fmRecords[fmRecordKey()] || 0; }
function fmSaveRecord(score) {
  const k = fmRecordKey();
  if (score > (fmRecords[k] || 0)) { fmRecords[k] = score; tg?.CloudStorage?.setItem?.(k, String(score), () => {}); return true; }
  return false;
}
function fmLoadRecords() {
  if (!tg?.CloudStorage) return;
  const keys = ["easy", "medium", "hard"].map((d) => `fastmath_${d}_60`);
  tg.CloudStorage.getItems(keys, (err, values) => {
    if (err || !values) return;
    Object.entries(values).forEach(([k, v]) => { if (v) fmRecords[k] = parseInt(v, 10) || 0; });
  });
}

document.getElementById("btn-fastmath-start").addEventListener("click", fastmathStart);
document.getElementById("btn-fastmath-again").addEventListener("click", fastmathStart);
document.getElementById("btn-fastmath-stop").addEventListener("click", fastmathFinish);

// ==============================
// ======== ИНФО-СЧЁТ ===========
// ==============================
// Тренажёр по информатике: степени двойки (до 2^16), перевод двоичная↔десятичная
// и единицы информации. Числа считаются в уме. Движок как у «Быстрого счёта».
const infomath = { difficulty: "easy", duration: 60, timeLeft: 0, timer: null, correct: 0, wrong: 0, cur: null, locked: false };

setupPills("infomath-difficulty", (v) => { infomath.difficulty = v; updateInfomathMult(); });
function updateInfomathMult() {
  const dm = { easy: 1, medium: 1.5, hard: 2 }[infomath.difficulty] || 1;
  const el = document.getElementById("infomath-mult");
  if (el) el.textContent = "×" + (Number.isInteger(dm) ? dm : dm.toFixed(1));
}
updateInfomathMult();

const IM_MAXEXP = { easy: 8, medium: 12, hard: 16 };
const IM_BINMAX = { easy: 15, medium: 31, hard: 63 };
const IM_CATS = {
  easy: ["pow", "powBack", "bin2dec", "dec2bin", "unitBB"],
  medium: ["pow", "powBack", "bin2dec", "dec2bin", "unitBB", "unitBK"],
  hard: ["pow", "powBack", "bin2dec", "dec2bin", "unitBB", "unitBK", "unitKM"],
};
function imRand(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function imMcq(correct, cands) {
  const opts = [String(correct)];
  for (const c of cands) { if (opts.length >= 4) break; const s = String(c); if (!opts.includes(s)) opts.push(s); }
  let k = 1;
  while (opts.length < 4 && k < 300) { const s = String((parseInt(correct, 10) || 0) + k); if (!opts.includes(s)) opts.push(s); k++; }
  for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [opts[i], opts[j]] = [opts[j], opts[i]]; }
  return { options: opts, correct: opts.indexOf(String(correct)) };
}
function imGen(difficulty) {
  const maxExp = IM_MAXEXP[difficulty], binMax = IM_BINMAX[difficulty];
  const cats = IM_CATS[difficulty];
  const cat = cats[Math.floor(Math.random() * cats.length)];
  if (cat === "pow") {
    const n = imRand(2, maxExp);
    const correct = Math.pow(2, n);
    const ds = [];
    [n - 1, n + 1, n + 2, n - 2, n + 3].forEach((k) => { if (k >= 0 && k <= 16 && k !== n) ds.push(Math.pow(2, k)); });
    return { q: `2^${n} = ?`, ...imMcq(correct, ds) };
  }
  if (cat === "powBack") {
    const n = imRand(2, maxExp);
    const val = Math.pow(2, n);
    const ds = [n - 1, n + 1, n + 2, n - 2].filter((k) => k >= 0 && k <= 16 && k !== n);
    return { q: `${val} = 2^?`, ...imMcq(n, ds) };
  }
  if (cat === "bin2dec") {
    const val = imRand(2, binMax);
    const bin = val.toString(2);
    const ds = [val + 1, val - 1, val + 2, val - 2, val + 4].filter((v) => v > 0 && v !== val);
    return { q: `${bin}₂ = ?  (в десятичной)`, ...imMcq(val, ds) };
  }
  if (cat === "dec2bin") {
    const val = imRand(2, binMax);
    const correct = val.toString(2);
    const ds = [val + 1, val - 1, val + 2, val - 2].filter((v) => v > 0 && v !== val).map((v) => v.toString(2));
    return { q: `${val} = ?₂  (в двоичной)`, ...imMcq(correct, ds) };
  }
  if (cat === "unitBB") {
    if (imRand(0, 1)) {
      const n = imRand(2, 16); const correct = n * 8;
      const ds = [correct + 8, correct - 8, n * 4, n * 16, correct + 16].filter((v) => v > 0 && v !== correct);
      return { q: `${n} байт = ? бит`, ...imMcq(correct, ds) };
    }
    const m = imRand(2, 12); const bits = m * 8; const correct = m;
    const ds = [m + 1, m - 1, m * 2, bits].filter((v) => v > 0 && v !== correct);
    return { q: `${bits} бит = ? байт`, ...imMcq(correct, ds) };
  }
  if (cat === "unitBK") {
    if (imRand(0, 1)) {
      const n = imRand(1, 8); const correct = n * 1024;
      const ds = [correct + 1024, correct - 1024, n * 512, n * 2048].filter((v) => v > 0 && v !== correct);
      return { q: `${n} Кбайт = ? байт`, ...imMcq(correct, ds) };
    }
    const n = imRand(1, 8); const bytes = n * 1024; const correct = n;
    const ds = [n + 1, n - 1, n * 2, 1024].filter((v) => v > 0 && v !== correct);
    return { q: `${bytes} байт = ? Кбайт`, ...imMcq(correct, ds) };
  }
  // unitKM
  const upper = imRand(0, 1);
  const n = imRand(1, 8); const correct = n * 1024;
  const ds = [correct + 1024, correct - 1024, n * 512, n * 2048].filter((v) => v > 0 && v !== correct);
  return { q: upper ? `${n} Мбайт = ? Кбайт` : `${n} Гбайт = ? Мбайт`, ...imMcq(correct, ds) };
}

function infomathRenderQ() {
  const g = imGen(infomath.difficulty);
  infomath.cur = { correct: g.correct };
  document.getElementById("infomath-expr").textContent = g.q;
  const wrap = document.getElementById("infomath-answers");
  wrap.innerHTML = "";
  g.options.forEach((opt, i) => {
    const btn = document.createElement("button");
    btn.className = "answer-btn";
    btn.textContent = opt;
    btn.addEventListener("click", () => infomathAnswer(i, btn));
    wrap.appendChild(btn);
  });
  infomath.locked = false;
}
function infomathUpdateTimer() {
  const el = document.getElementById("infomath-timer");
  el.textContent = infomath.timeLeft;
  el.classList.remove("warn", "danger");
  if (infomath.timeLeft <= 5) el.classList.add("danger");
  else if (infomath.timeLeft <= 10) el.classList.add("warn");
}
function infomathAnswer(chosen, btnEl) {
  if (infomath.locked) return;
  infomath.locked = true;
  const isCorrect = chosen === infomath.cur.correct;
  const btns = document.querySelectorAll("#infomath-answers .answer-btn");
  if (isCorrect) { infomath.correct++; btnEl.classList.add("correct"); hapticSuccess(); }
  else { infomath.wrong++; btnEl.classList.add("wrong"); btns[infomath.cur.correct].classList.add("correct"); hapticError(); }
  document.getElementById("infomath-score").textContent = infomath.correct;
  btns.forEach((b) => (b.disabled = true));
  setTimeout(infomathRenderQ, isCorrect ? 300 : 800);
}
function infomathStart() {
  hapticMedium();
  infomath.correct = 0; infomath.wrong = 0; infomath.timeLeft = infomath.duration;
  document.getElementById("infomath-score").textContent = 0;
  infomathUpdateTimer();
  showScreen("infomathPlay");
  infomathRenderQ();
  infomath.timer = setInterval(() => {
    infomath.timeLeft--; infomathUpdateTimer();
    if (infomath.timeLeft <= 0) { playTimeUpSound(); infomathFinish(); }
    else playTick(infomath.timeLeft);
  }, 1000);
}
async function infomathFinish() {
  if (infomath.timer) { clearInterval(infomath.timer); infomath.timer = null; }
  const isRecord = imSaveRecord(infomath.correct);
  document.getElementById("infomath-r-correct").textContent = infomath.correct;
  document.getElementById("infomath-r-wrong").textContent = infomath.wrong;
  document.getElementById("infomath-r-best").textContent = imGetRecord();
  document.getElementById("infomath-new-record").style.display = isRecord && infomath.correct > 0 ? "block" : "none";
  const res = infomath.correct > 0
    ? await awardTraining("infomath", infomath.correct, { correct: infomath.correct, difficulty: infomath.difficulty })
    : { delta_awarded: 0, xp_awarded: 0 };
  document.getElementById("infomath-r-rating").textContent = res.delta_awarded || 0;
  document.getElementById("infomath-r-xp").textContent = res.xp_awarded || 0;
  showScreen("infomathResult");
  hapticSuccess();
}

const imRecords = {};
function imRecordKey() { return `infomath_${infomath.difficulty}_60`; }
function imGetRecord() { return imRecords[imRecordKey()] || 0; }
function imSaveRecord(score) {
  const k = imRecordKey();
  if (score > (imRecords[k] || 0)) { imRecords[k] = score; tg?.CloudStorage?.setItem?.(k, String(score), () => {}); return true; }
  return false;
}
function imLoadRecords() {
  if (!tg?.CloudStorage) return;
  const keys = ["easy", "medium", "hard"].map((d) => `infomath_${d}_60`);
  tg.CloudStorage.getItems(keys, (err, values) => {
    if (err || !values) return;
    Object.entries(values).forEach(([k, v]) => { if (v) imRecords[k] = parseInt(v, 10) || 0; });
  });
}

document.getElementById("btn-infomath-start").addEventListener("click", infomathStart);
document.getElementById("btn-infomath-again").addEventListener("click", infomathStart);
document.getElementById("btn-infomath-stop").addEventListener("click", infomathFinish);

// ==============================
// ======= БАНК ВРЕМЕНИ =========
// ==============================
// 3 раунда: Alias (2 попытки) → Крокодил (2 попытки) копят банк секунд,
// финал «Кто я» (1 слово) тратит банк. Очки = остаток × множитель.
const TB_SUBJECTS = "informatika,matematika,fizika";
const TB_SEC_PER_WORD = { easy: 2, medium: 4, hard: 6 };   // Alias: секунд в банк за слово
const TB_ALIAS_TIME = 60;
const TB_CROCO = { easy: 30, medium: 45, hard: 60 };        // Крокодил: сек на слово = сек в банк
const TB_NUM = {
  easy:   { max: 10,   time: 15, bank: 15 },
  medium: { max: 100,  time: 20, bank: 20 },
  hard:   { max: 1000, time: 30, bank: 30 },
};
const TB_WORD_PTS = { easy: 10, medium: 20, hard: 30 };  // финал: очки за угаданное слово
const TB_TIME_BONUS = 2;                                  // очков за каждую оставшуюся секунду

const tb = {
  guest: "",
  bank: 0,
  timer: null, timeLeft: 0,
  numLevel: "easy", numTarget: 0, numLo: 1, numHi: 10,
  aliasDifficulty: "easy", subject: "informatika",
  items: [], idx: 0, cur: null, count: 0, attemptWords: [],
  crocoDifficulty: "easy", crocoWord: null,
  blitzWords: [], blitzGuessed: 0,
  score: 0,
};

function tbRenderBank() { document.querySelectorAll(".tb-bank").forEach((el) => (el.textContent = tb.bank)); }
function tbActivateFirst(id) { document.querySelectorAll(`#${id} .pill`).forEach((p, i) => p.classList.toggle("active", i === 0)); }

setupPills("tb-num-difficulty", (v) => (tb.numLevel = v));
setupPills("tb-difficulty", (v) => (tb.aliasDifficulty = v));
setupPills("tb-croco-difficulty", (v) => (tb.crocoDifficulty = v));

document.getElementById("btn-tb-start").addEventListener("click", tbStart);
document.getElementById("btn-tb-again").addEventListener("click", () => { tbRenderRecords(); showScreen("tbSetup"); });

function tbStart() {
  hapticMedium();
  const name = document.getElementById("tb-guest-name").value.trim();
  tb.guest = name || "Команда";
  tb.bank = 0;
  tbRenderBank();
  tbNumSetup();
}

// ---------- Р1: Угадай число ----------
function tbNumSetup() {
  tb.numLevel = "easy";
  tbActivateFirst("tb-num-difficulty");
  tbRenderBank();
  showScreen("tbNumSetup");
}
function tbNumStart() {
  hapticMedium();
  const cfg = TB_NUM[tb.numLevel];
  tb.numTarget = 1 + Math.floor(Math.random() * cfg.max);
  tb.numLo = 1; tb.numHi = cfg.max;
  tb.timeLeft = cfg.time;
  document.getElementById("tb-num-range").textContent = `от ${tb.numLo} до ${tb.numHi}`;
  const fb = document.getElementById("tb-num-feedback");
  fb.textContent = "Введите догадку"; fb.className = "tb-num-feedback";
  const inp = document.getElementById("tb-num-input");
  inp.value = ""; inp.disabled = false;
  document.getElementById("btn-tb-num-guess").disabled = false;
  tbRenderBank();
  tbNumUpdateTimer();
  showScreen("tbNumPlay");
  try { inp.focus(); } catch (e) {}
  tb.timer = setInterval(() => {
    tb.timeLeft--; tbNumUpdateTimer();
    if (tb.timeLeft <= 0) { clearInterval(tb.timer); tb.timer = null; playTimeUpSound(); tbNumEnd(false); }
    else playTick(tb.timeLeft);
  }, 1000);
}
function tbNumUpdateTimer() {
  const el = document.getElementById("tb-num-timer");
  el.textContent = tb.timeLeft;
  el.classList.toggle("danger", tb.timeLeft <= 5);
  el.classList.toggle("warn", tb.timeLeft > 5 && tb.timeLeft <= 10);
}
function tbNumGuess() {
  const inp = document.getElementById("tb-num-input");
  const g = parseInt(inp.value, 10);
  const fb = document.getElementById("tb-num-feedback");
  if (isNaN(g)) { fb.textContent = "Введите число"; fb.className = "tb-num-feedback"; return; }
  if (g === tb.numTarget) { tbNumEnd(true); return; }
  if (g < tb.numTarget) { tb.numLo = Math.max(tb.numLo, g + 1); fb.textContent = "📈 Больше!"; fb.className = "tb-num-feedback up"; }
  else { tb.numHi = Math.min(tb.numHi, g - 1); fb.textContent = "📉 Меньше!"; fb.className = "tb-num-feedback down"; }
  hapticLight();
  document.getElementById("tb-num-range").textContent = `от ${tb.numLo} до ${tb.numHi}`;
  inp.value = ""; try { inp.focus(); } catch (e) {}
}
function tbNumEnd(win) {
  if (tb.timer) { clearInterval(tb.timer); tb.timer = null; }
  const cfg = TB_NUM[tb.numLevel];
  const fb = document.getElementById("tb-num-feedback");
  document.getElementById("tb-num-input").disabled = true;
  document.getElementById("btn-tb-num-guess").disabled = true;
  if (win) { tb.bank += cfg.bank; hapticSuccess(); fb.textContent = `✅ Это ${tb.numTarget}! +${cfg.bank} сек`; fb.className = "tb-num-feedback win"; }
  else { hapticError(); fb.textContent = `⌛ Время вышло. Было ${tb.numTarget}`; fb.className = "tb-num-feedback down"; }
  tbRenderBank();
  setTimeout(tbAliasSetup, 1400);
}

// ---------- Р2: Alias ----------
// Пилюли предмета: forbidden — предмет, который нельзя выбрать.
function tbSetupSubjectPills(forbidden) {
  const cont = document.getElementById("tb-subjects");
  let firstEnabled = null;
  cont.querySelectorAll(".pill").forEach((p) => {
    const disabled = p.dataset.value === forbidden;
    p.classList.toggle("disabled", disabled);
    p.classList.remove("active");
    if (!disabled && !firstEnabled) firstEnabled = p;
  });
  if (firstEnabled) { firstEnabled.classList.add("active"); tb.subject = firstEnabled.dataset.value; }
}
function tbAliasSetup() {
  tb.aliasDifficulty = "easy";
  tbActivateFirst("tb-difficulty");
  tbSetupSubjectPills(null);
  tbRenderBank();
  showScreen("tbAttempt");
}
async function tbAliasGo() {
  hapticMedium();
  const d = await (await fetch(`/api/alias?difficulty=${tb.aliasDifficulty}&subjects=${tb.subject}`)).json();
  tb.items = (d.items || []); tb.items.sort(() => Math.random() - 0.5); tb.idx = 0;
  tb.count = 0; tb.attemptWords = []; tb.timeLeft = TB_ALIAS_TIME;
  tbAliasNextWord(); tbAliasRenderPlay(); showScreen("tbPlay");
  tb.timer = setInterval(() => {
    tb.timeLeft--; tbAliasRenderPlay();
    if (tb.timeLeft <= 0) { playTimeUpSound(); tbAliasReview(); }
    else playTick(tb.timeLeft);
  }, 1000);
}
function tbAliasNextWord() {
  if (tb.idx >= tb.items.length) { tb.items.sort(() => Math.random() - 0.5); tb.idx = 0; }
  const it = tb.items[tb.idx++] || { word: "—", emoji: "", banned: [] };
  tb.cur = it;
  document.getElementById("tb-play-word").textContent = it.word;
  document.getElementById("tb-play-emoji").textContent = it.emoji || "";
  const bannedEl = document.getElementById("tb-play-banned");
  if ((it.banned || []).length) {
    bannedEl.innerHTML = "Нельзя: " + it.banned.map((w) => `<span>${escapeTb(w)}</span>`).join(", ");
    bannedEl.style.display = "";
  } else {
    bannedEl.style.display = "none";
  }
}
function tbAliasRenderPlay() {
  const el = document.getElementById("tb-play-timer");
  el.textContent = tb.timeLeft;
  el.classList.toggle("danger", tb.timeLeft <= 5);
  el.classList.toggle("warn", tb.timeLeft > 5 && tb.timeLeft <= 15);
  document.getElementById("tb-play-count").textContent = tb.count;
  document.getElementById("tb-play-bank").textContent = tb.bank + tb.count * TB_SEC_PER_WORD[tb.aliasDifficulty];
}
function tbAliasReview() {
  clearInterval(tb.timer); tb.timer = null;
  document.getElementById("tb-review-title").textContent = "Проверка · Alias";
  const list = document.getElementById("tb-review-list");
  if (!tb.attemptWords.length) {
    list.innerHTML = `<div class="tb-review-empty">Слов не угадано.</div>`;
  } else {
    list.innerHTML = tb.attemptWords.map((it, i) => `
      <label class="tb-review-row">
        <input type="checkbox" class="tb-review-cb" data-i="${i}" checked>
        <span class="tb-review-emoji">${it.emoji || "•"}</span>
        <span class="tb-review-word">${escapeTb(it.word)}</span>
      </label>`).join("");
    list.querySelectorAll(".tb-review-cb").forEach((cb) => cb.addEventListener("change", () => { hapticLight(); tbReviewRecount(); }));
  }
  tbReviewRecount();
  showScreen("tbReview");
}
function tbReviewRecount() {
  const checked = document.querySelectorAll("#tb-review-list .tb-review-cb:checked").length;
  document.getElementById("tb-review-count").textContent = checked;
  document.getElementById("tb-review-sec").textContent = checked * TB_SEC_PER_WORD[tb.aliasDifficulty];
}
function tbAliasApplyReview() {
  const checked = document.querySelectorAll("#tb-review-list .tb-review-cb:checked").length;
  tb.bank += checked * TB_SEC_PER_WORD[tb.aliasDifficulty];
  tbRenderBank();
  tbCrocoSetup();
}

// ---------- Р3: Крокодил (одно слово) ----------
function tbCrocoSetup() {
  tb.crocoDifficulty = "easy";
  tbActivateFirst("tb-croco-difficulty");
  tbRenderBank();
  showScreen("tbCrocoSetup");
}
async function tbCrocoGo() {
  hapticMedium();
  const d = await (await fetch(`/api/words?difficulty=${tb.crocoDifficulty}&subjects=${TB_SUBJECTS}`)).json();
  const items = d.items || [];
  tb.crocoWord = items[Math.floor(Math.random() * items.length)] || { word: "—", emoji: "" };
  document.getElementById("tb-croco-word").textContent = tb.crocoWord.word;
  document.getElementById("tb-croco-emoji").textContent = tb.crocoWord.emoji || "";
  tb.timeLeft = TB_CROCO[tb.crocoDifficulty];
  tbCrocoUpdateTimer();
  tbRenderBank();
  showScreen("tbCrocoPlay");
  tb.timer = setInterval(() => {
    tb.timeLeft--; tbCrocoUpdateTimer();
    if (tb.timeLeft <= 0) { clearInterval(tb.timer); tb.timer = null; playTimeUpSound(); tbCrocoEnd(false); }
    else playTick(tb.timeLeft);
  }, 1000);
}
function tbCrocoUpdateTimer() {
  const el = document.getElementById("tb-croco-timer");
  el.textContent = fmtTime(Math.max(0, tb.timeLeft));
  el.classList.toggle("danger", tb.timeLeft <= 5);
  el.classList.toggle("warn", tb.timeLeft > 5 && tb.timeLeft <= 15);
}
function tbCrocoEnd(win) {
  if (tb.timer) { clearInterval(tb.timer); tb.timer = null; }
  if (win) { tb.bank += TB_CROCO[tb.crocoDifficulty]; hapticSuccess(); } else hapticError();
  tbRenderBank();
  tbBlitzIntro();
}

// ---------- Р4: Финал — супер-блиц (как в Громком вопросе) ----------
async function tbBlitzIntro() {
  const [we, wm, wh] = await Promise.all([
    fetch(`/api/words?difficulty=easy&subjects=${TB_SUBJECTS}`).then((r) => r.json()),
    fetch(`/api/words?difficulty=medium&subjects=${TB_SUBJECTS}`).then((r) => r.json()),
    fetch(`/api/words?difficulty=hard&subjects=${TB_SUBJECTS}`).then((r) => r.json()),
  ]);
  // по 2 разных слова каждого уровня → всего 6
  const pick2 = (data) => {
    const a = (data.items || []).slice().sort(() => Math.random() - 0.5);
    return [a[0] || { word: "—" }, a[1] || a[0] || { word: "—" }];
  };
  const [e1, e2] = pick2(we), [m1, m2] = pick2(wm), [h1, h2] = pick2(wh);
  tb.blitzWords = [
    { word: e1.word, level: "easy", done: false },
    { word: e2.word, level: "easy", done: false },
    { word: m1.word, level: "medium", done: false },
    { word: m2.word, level: "medium", done: false },
    { word: h1.word, level: "hard", done: false },
    { word: h2.word, level: "hard", done: false },
  ];
  tb.blitzGuessed = 0;
  document.getElementById("tb-blitz-bank").textContent = tb.bank;
  showScreen("tbBlitzIntro");
}
function tbBlitzRender() {
  const wrap = document.getElementById("tb-blitz-words");
  wrap.innerHTML = "";
  tb.blitzWords.forEach((w, i) => {
    const row = document.createElement("div");
    row.className = "blitz-word" + (w.done ? " done" : " tap");
    const st = document.createElement("span"); st.className = "bw-status"; st.textContent = w.done ? "✅" : "◯";
    const wd = document.createElement("span"); wd.className = "bw-word"; wd.textContent = w.word;
    const lv = document.createElement("span"); lv.className = "bw-level lvl-" + w.level; lv.textContent = GROMKO_LEVEL_NAME[w.level];
    row.append(st, wd, lv);
    if (!w.done) row.addEventListener("click", () => tbBlitzGuess(i));
    wrap.appendChild(row);
  });
}
function tbBlitzUpdateTimer() {
  const el = document.getElementById("tb-blitz-timer");
  el.textContent = fmtTime(Math.max(0, tb.timeLeft));
  el.classList.remove("warn", "danger");
  if (tb.timeLeft <= 10) el.classList.add("danger");
  else if (tb.timeLeft <= 20) el.classList.add("warn");
}
function tbBlitzStart() {
  tb.timeLeft = tb.bank;
  if (tb.timeLeft <= 0) { tbBlitzEnd(false); return; }
  tb.blitzWords.forEach((w) => (w.done = false));
  tb.blitzGuessed = 0;
  tbBlitzRender();
  document.getElementById("tb-blitz-done").textContent = 0;
  tbBlitzUpdateTimer();
  showScreen("tbBlitz");
  gromkoStartMusic();
  hapticMedium();
  tb.timer = setInterval(() => {
    tb.timeLeft--; tbBlitzUpdateTimer();
    if (tb.timeLeft <= 0) { clearInterval(tb.timer); tb.timer = null; tbBlitzEnd(false); }
  }, 1000);
}
function tbBlitzGuess(i) {
  const w = tb.blitzWords[i];
  if (!w || w.done) return;
  w.done = true; tb.blitzGuessed = tb.blitzWords.filter((x) => x.done).length;
  document.getElementById("tb-blitz-done").textContent = tb.blitzGuessed;
  hapticSuccess();
  if (tb.blitzWords.every((x) => x.done)) { if (tb.timer) { clearInterval(tb.timer); tb.timer = null; } tbBlitzEnd(true); }
  else tbBlitzRender();
}
async function tbBlitzEnd(win) {
  if (tb.timer) { clearInterval(tb.timer); tb.timer = null; }
  gromkoStopMusic();
  if (win) hapticSuccess(); else { hapticError(); playTimeUpSound(); }
  // Итоговый рейтинг: очки за угаданные слова (10/20/30) + бонус за оставшееся время
  const leftover = Math.max(0, tb.timeLeft);
  const wordPts = tb.blitzWords.filter((w) => w.done).reduce((s, w) => s + TB_WORD_PTS[w.level], 0);
  const timeBonus = leftover * TB_TIME_BONUS;
  tb.score = wordPts + timeBonus;
  const isRecord = tbSaveRecord(tb.guest, tb.score);
  document.getElementById("tb-result-title").textContent = win ? "🏆 Победа!" : "⌛ Не успели";
  document.getElementById("tb-result-score").textContent = tb.score;
  document.getElementById("tb-result-sub").textContent = win
    ? `очков · все 6 слов + ${timeBonus} за ${leftover}с`
    : `очков · угадано ${tb.blitzGuessed} из 6 (${wordPts} за слова)`;
  document.getElementById("tb-result-newrecord").style.display = (isRecord && tb.score > 0) ? "block" : "none";
  tbRenderRecords("tb-result-records");
  showScreen("tbResult");
  awardTraining("party", 5, { game: "timebank" }).then(showRatingToast);
}

// ── Кнопки ──
document.getElementById("btn-tb-num-go").addEventListener("click", tbNumStart);
document.getElementById("btn-tb-num-guess").addEventListener("click", tbNumGuess);
document.getElementById("tb-num-input").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); tbNumGuess(); } });
document.getElementById("tb-subjects").addEventListener("click", (e) => {
  const btn = e.target.closest(".pill");
  if (!btn || btn.classList.contains("disabled")) return;
  document.querySelectorAll("#tb-subjects .pill").forEach((p) => p.classList.remove("active"));
  btn.classList.add("active");
  tb.subject = btn.dataset.value;
  hapticLight();
});
document.getElementById("btn-tb-attempt-go").addEventListener("click", tbAliasGo);
document.getElementById("btn-tb-ok").addEventListener("click", () => {
  if (tb.cur) tb.attemptWords.push(tb.cur);
  tb.count = tb.attemptWords.length;
  hapticLight();
  tbAliasNextWord(); tbAliasRenderPlay();
});
document.getElementById("btn-tb-review-done").addEventListener("click", tbAliasApplyReview);
document.getElementById("btn-tb-skip").addEventListener("click", () => { hapticLight(); tbAliasNextWord(); });
document.getElementById("btn-tb-croco-go").addEventListener("click", tbCrocoGo);
document.getElementById("btn-tb-croco-ok").addEventListener("click", () => tbCrocoEnd(true));
document.getElementById("btn-tb-blitz-go").addEventListener("click", tbBlitzStart);

// ── Рекорды (имя + очки + дата) ──
let tbRecords = [];
function tbLoadRecordsFromCloud() {
  if (!tg?.CloudStorage) return;
  tg.CloudStorage.getItem("timebank_records", (err, val) => {
    if (err || !val) return;
    try { tbRecords = JSON.parse(val) || []; } catch (e) { tbRecords = []; }
    tbRenderRecords();
  });
}
function tbSaveRecord(name, score) {
  const today = new Date().toLocaleDateString("ru-RU");
  const best = tbRecords.length ? Math.max(...tbRecords.map((r) => r.score)) : 0;
  const isRecord = score > best;
  tbRecords.push({ name, score, date: today });
  tbRecords.sort((a, b) => b.score - a.score);
  tbRecords = tbRecords.slice(0, 20);
  tg?.CloudStorage?.setItem?.("timebank_records", JSON.stringify(tbRecords), () => {});
  return isRecord;
}
function tbRenderRecords(targetId = "tb-records") {
  const el = document.getElementById(targetId);
  if (!el) return;
  if (!tbRecords.length) { el.innerHTML = `<div class="tb-records-empty">Рекордов пока нет — станьте первым!</div>`; return; }
  const rows = tbRecords.slice(0, 8).map((r, i) => `
    <div class="tb-rec-row${i === 0 ? " top" : ""}">
      <span class="tb-rec-place">${i + 1}</span>
      <span class="tb-rec-name">${escapeTb(r.name)}</span>
      <span class="tb-rec-score">${r.score}</span>
      <span class="tb-rec-date">${r.date}</span>
    </div>`).join("");
  el.innerHTML = `<div class="tb-records-title">🏆 Таблица рекордов</div>${rows}`;
}
function escapeTb(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// ==============================
// =========== ШПИОН ============
// ==============================
const spy = {
  players: 4,
  difficulty: "easy",
  discussTime: 180,
  subjects: ["informatika"],
  spyIndex: 0,        // индекс игрока-шпиона (0..players-1)
  word: "",
  emoji: "",
  decoys: [],
  currentPlayer: 0,   // 0..players-1 при раздаче ролей
  timer: null,
  timeLeft: 0,
};

setupPills("spy-players", (v) => (spy.players = v), (v) => parseInt(v, 10));
setupPills("spy-difficulty", (v) => (spy.difficulty = v));
setupPills("spy-time", (v) => (spy.discussTime = v), (v) => parseInt(v, 10));
setupPillsMulti("spy-subjects", (arr) => (spy.subjects = arr));

async function spyStart() {
  hapticMedium();
  // Получаем слово и обманки
  const r = await fetch(`/api/spy?difficulty=${spy.difficulty}&subjects=${spy.subjects.join(",")}`);
  const d = await r.json();
  spy.word = d.word;
  spy.emoji = d.emoji || "";
  spy.decoys = d.decoys;
  spy.spyIndex = Math.floor(Math.random() * spy.players);
  spy.currentPlayer = 0;
  spyShowPass();
}

function spyShowPass() {
  document.getElementById("spy-pass-num").textContent = spy.currentPlayer + 1;
  document.getElementById("spy-pass-name").textContent = spy.currentPlayer + 1;
  showScreen("spyPass");
}

function spyShowRole() {
  const emojiEl = document.getElementById("spy-role-emoji");
  if (spy.currentPlayer === spy.spyIndex) {
    emojiEl.textContent = "🕵";
    document.getElementById("spy-role-word").textContent = "ТЫ ШПИОН";
    document.getElementById("spy-role-note").textContent =
      "Слова ты не знаешь. Слушай других и попробуй угадать, о чём речь.";
  } else {
    emojiEl.textContent = spy.emoji || "";
    document.getElementById("spy-role-word").textContent = spy.word;
    document.getElementById("spy-role-note").textContent =
      "Запомни слово. Не показывай никому.";
  }
  showScreen("spyRole");
}

function spyNextPlayer() {
  spy.currentPlayer++;
  if (spy.currentPlayer >= spy.players) {
    // Все увидели свои роли — начинаем обсуждение
    spyStartDiscussion();
  } else {
    spyShowPass();
  }
}

function spyStartDiscussion() {
  spy.timeLeft = spy.discussTime;
  spyRenderDiscussionTimer();
  spy.timer = setInterval(() => {
    spy.timeLeft--;
    spyRenderDiscussionTimer();
    if (spy.timeLeft <= 0) {
      clearInterval(spy.timer);
      spy.timer = null;
      playTimeUpSound();
      spyShowVote();
    } else {
      playTick(spy.timeLeft);
    }
  }, 1000);
  showScreen("spyDiscuss");
}

function spyRenderDiscussionTimer() {
  const m = Math.floor(spy.timeLeft / 60);
  const s = spy.timeLeft % 60;
  const el = document.getElementById("spy-timer");
  el.textContent = `${m}:${String(s).padStart(2, "0")}`;
  el.classList.remove("warn", "danger");
  if (spy.timeLeft <= 30) el.classList.add("warn");
  if (spy.timeLeft <= 10) el.classList.add("danger");
}

function spyShowVote() {
  if (spy.timer) { clearInterval(spy.timer); spy.timer = null; }
  const wrap = document.getElementById("spy-vote-list");
  wrap.innerHTML = "";
  for (let i = 0; i < spy.players; i++) {
    const btn = document.createElement("button");
    btn.className = "vote-btn";
    btn.textContent = `Игрок ${i + 1}`;
    btn.addEventListener("click", () => spyVoteChosen(i));
    wrap.appendChild(btn);
  }
  showScreen("spyVote");
}

function spyVoteChosen(playerIndex) {
  hapticMedium();
  if (playerIndex === spy.spyIndex) {
    // Шпион пойман — даём ему шанс угадать слово
    spyShowGuess();
  } else {
    // Не поймали — шпион побеждает
    spyShowResult(false, `Проиграли! Вы поймали не того. Игрок ${playerIndex + 1} — мирный.`);
  }
}

function spyShowGuess() {
  const wrap = document.getElementById("spy-guess-list");
  wrap.innerHTML = "";
  const opts = [spy.word, ...spy.decoys].slice(0, 8);
  opts.sort(() => Math.random() - 0.5);
  opts.forEach((w) => {
    const btn = document.createElement("button");
    btn.className = "guess-btn";
    btn.textContent = w;
    btn.addEventListener("click", () => {
      if (w === spy.word) {
        spyShowResult(false, "Шпион угадал слово и всё-таки победил!");
      } else {
        spyShowResult(true, "Шпион пойман и не угадал слово. Мирные победили!");
      }
    });
    wrap.appendChild(btn);
  });
  showScreen("spyGuess");
}

function spyShowResult(citizensWin, text) {
  document.getElementById("spy-result-title").textContent = citizensWin ? "🎉 Победа мирных!" : "🕵 Победа шпиона!";
  document.getElementById("spy-result-text").textContent = text;
  document.getElementById("spy-result-word").textContent = spy.word;
  document.getElementById("spy-result-spy").textContent = `Игрок ${spy.spyIndex + 1}`;
  showScreen("spyResult");
  if (citizensWin) hapticSuccess(); else hapticError();
  awardTraining("party", 5, { game: "spy" }).then(showRatingToast);
}

document.getElementById("btn-spy-start").addEventListener("click", spyStart);
document.getElementById("btn-spy-again").addEventListener("click", spyStart);
document.getElementById("btn-spy-reveal").addEventListener("click", spyShowRole);
document.getElementById("btn-spy-next-player").addEventListener("click", spyNextPlayer);
document.getElementById("btn-spy-to-vote").addEventListener("click", spyShowVote);

// ==============================
// ==== ФУНДАМЕНТ РЕЙТИНГА ======
// ==============================
const INIT_DATA = tg?.initData || "";
let currentProfile = null;

async function apiPost(path, body) {
  try {
    const r = await fetch(path, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(body || {}),
    });
    return await r.json();
  } catch (e) {
    console.error(path, e);
    return null;
  }
}

async function refreshProfile() {
  const prevProfile = currentProfile;
  const p = await apiPost("/api/profile", {init_data: INIT_DATA});
  if (!p || !p.rating) return;
  currentProfile = p;
  // обновляем плашку на главной
  const strip = document.getElementById("my-strip");
  if (strip) {
    document.getElementById("my-strip-league").textContent = `${p.league.emoji} ${p.league.display || p.league.name}`;
    // Анимация рейтинга и XP при изменении
    const rEl = document.getElementById("my-strip-rating");
    const prevRating = prevProfile?.rating ?? p.rating;
    if (prevRating !== p.rating) {
      animateNumber(rEl, prevRating, p.rating, 800);
      rEl.classList.add("value-pop");
      setTimeout(() => rEl.classList.remove("value-pop"), 800);
    } else {
      rEl.textContent = p.rating;
    }
    const lvl = p.level_info || {level: 1, progress_percent: 0};
    document.getElementById("my-strip-level-num").textContent = lvl.level;
    const fillEl = document.getElementById("my-strip-xpfill");
    const prevPct = parseFloat(fillEl.style.width) || 0;
    const newPct = lvl.progress_percent || 0;
    // Уровень поднялся — сначала долить до 100%, потом сбросить и залить до нового %
    if (prevProfile && lvl.level > (prevProfile.level_info?.level || 1)) {
      fillEl.style.transition = "width 400ms ease";
      fillEl.style.width = "100%";
      setTimeout(() => {
        fillEl.style.transition = "none";
        fillEl.style.width = "0%";
        setTimeout(() => {
          fillEl.style.transition = "width 600ms ease";
          fillEl.style.width = newPct + "%";
        }, 60);
      }, 450);
    } else {
      fillEl.style.transition = "width 600ms ease";
      fillEl.style.width = newPct + "%";
    }
    // Стрик — показываем только если ≥1
    const streakEl = document.getElementById("my-strip-streak");
    if (p.current_streak && p.current_streak > 0) {
      document.getElementById("my-strip-streak-num").textContent = p.current_streak;
      streakEl.style.display = "inline-flex";
    } else {
      streakEl.style.display = "none";
    }
    strip.style.display = "flex";
  }
  // Модалка нового дня (только при первом заходе за сутки)
  if (p.streak_update && p.streak_update.was_updated && p.streak_update.bonus_xp > 0) {
    setTimeout(() => showStreakModal(p.streak_update), 400);
  }
  // Дашборд: приветствие Profik, дневные плашки, «Быстрая игра»
  renderDashboard(p);
}

/**
 * Рендерит дашборд на главной.
 */
async function renderDashboard(profile) {
  const streak = profile.current_streak || 0;
  const xpToday = profile.xp_earned_today || 0;

  document.getElementById("today-streak").textContent = streak;
  document.getElementById("today-xp").textContent = xpToday;
  document.getElementById("today-strip").style.display = "grid";

  // Большая кнопка «Играть»
  document.getElementById("btn-play").style.display = "flex";

  // Мотивирующая строка (одна короткая цель)
  renderMotivateLine(profile);

  // Рекорды и статистика на карточках режимов
  renderCardStats(profile);

  // Свежие квесты
  let quests = [];
  try {
    const qr = await apiPost("/api/quests/daily", {init_data: INIT_DATA});
    quests = qr?.quests || [];
  } catch (e) {}
  const doneCount = quests.filter((q) => q.completed === 1).length;
  const claimableCount = quests.filter((q) => q.completed === 1 && q.claimed === 0).length;
  document.getElementById("today-quests").textContent = `${doneCount}/${quests.length || 3}`;

  // Приветствие Profik
  const helloBox = document.getElementById("profik-hello");
  const helloTitle = document.getElementById("profik-hello-title");
  const helloMsg = document.getElementById("profik-hello-msg");
  const firstName = tg?.initDataUnsafe?.user?.first_name || "Игрок";
  helloTitle.textContent = greetingByHour() + ", " + firstName + "!";

  const level = profile.level_info?.level || 1;
  const toNext = profile.level_info?.to_next || 0;
  const activeQuests = quests.filter((q) => q.completed === 0);

  let msg;
  if (claimableCount > 0) {
    msg = `У тебя ${claimableCount} невзятая награда за задания. Забирай!`;
  } else if (streak >= 3) {
    msg = `Держим серию — ${streak} дней подряд! 🔥`;
  } else if (streak === 0) {
    msg = "Готов начать серию? Первая игра — уже стрик!";
  } else if (toNext > 0 && toNext <= 60) {
    msg = `До ${level + 1}-го уровня всего ${toNext} XP — почти там!`;
  } else if (activeQuests.length > 0) {
    const q = activeQuests[0];
    msg = `Задание дня: «${q.title}» — ${q.progress}/${q.target}`;
  } else {
    msg = "Отличная форма! Продолжаем в том же духе.";
  }
  helloMsg.textContent = msg;
  helloBox.style.display = "flex";

  // подсказка для сабтайтла большой кнопки Играть
  const sub = document.getElementById("btn-play-sub");
  if (sub) {
    if (claimableCount > 0) sub.textContent = "Забери награды за задания и играй!";
    else if (activeQuests.length > 0) sub.textContent = `Задание дня: ${activeQuests[0].title}`;
    else sub.textContent = "Выбери режим ниже";
  }
}

// ==============================
// ====== РЕПЛИКИ ПРОФИКА =======
// ==============================
const PROFIK_LINES = {
  sprint_start: [
    "Готов рвать таймер? Погнали!",
    "Каждый правильный ответ — очко. Соберём максимум!",
    "Быстрее думай — больше набьёшь!",
    "Кстати: правильный ответ теперь <b>не всегда первый</b> 😉",
    "Спринт короткий. Настраивайся!",
    "Скорость и точность. Больше ничего не нужно.",
  ],
  marathon_start: [
    "Здесь важна выдержка. Не торопись — думай.",
    "Береги жизни. Ошибка — минус одна.",
    "Марафон не спринт. Настрой длинную дистанцию.",
    "После каждой ошибки видно правильный вариант — учись на ходу!",
    "3 жизни — по одной на каждый уровень уверенности?",
  ],
  duel_start: [
    "Скорость важна не меньше правильности!",
    "Соперник получит те же 10 вопросов. Дай ему бой!",
    "Ответил за секунду — <b>почти двойные очки</b>.",
    "Помни: даже за проигрыш дадут +20 XP.",
    "После победы — обязательно поделись карточкой в чат класса.",
  ],

  sprint_result_high: [
    "Ух! Ты машина! 🚀",
    "Это уровень легенды. Другим до тебя далеко!",
    "Так держать! Продолжай и попадёшь в топ.",
    "Отличный результат! Стрик копится, XP растёт.",
  ],
  sprint_result_mid: [
    "Хороший темп! Ещё пара тренировок — и будет ещё лучше.",
    "Не останавливайся — форма набирается.",
    "Пробуй разные сложности, они дают одинаковое количество XP.",
  ],
  sprint_result_low: [
    "Каждый мастер когда-то нажимал по 3 правильных за минуту.",
    "Тренируйся регулярно — станешь быстрее!",
    "Попробуй сложность попроще, чтобы разогнаться.",
  ],
  sprint_result_zero: [
    "Ноль — это тоже опыт. Приходи снова!",
    "Стрик за заход всё равно засчитан. Завтра ждёт бонус.",
  ],

  marathon_result_high: [
    "Марафонец! 15+ вопросов подряд — это уровень.",
    "Серия у тебя настоящая. Отличная концентрация.",
    "Забирай XP и жми ещё раз — рекорд впереди.",
  ],
  marathon_result_mid: [
    "Достойный результат! Работай над сериями — там XP больше.",
    "Смотри на правильные варианты после ошибок — это учит быстрее.",
  ],
  marathon_result_low: [
    "3 жизни ушли быстро? Не расстраивайся — попробуй проще.",
    "Не торопись отвечать — в марафоне важнее точность.",
  ],

  duel_result_win: [
    "Красивая победа! Рейтинг подрос.",
    "Так и надо! Соперник в шоке.",
    "Отличная работа. Соперник сдал слабее — ловим момент.",
    "Победа! Забирай карточку и делись с друзьями.",
  ],
  duel_result_loss: [
    "Не расстраивайся — <b>+20 XP</b> всё равно твои.",
    "Проиграл вдвое меньше очков, чем можно было. Это по-честному!",
    "Соперник силён. Приходи на реванш — теперь ты знаешь его слабости.",
    "Каждый поражение — плюс к опыту. И к XP.",
  ],
  duel_result_draw: [
    "Ничья! Оба молодцы.",
    "Равный бой. XP получил, рейтинг остался — по-честному.",
  ],
};

function profikSays(context) {
  const arr = PROFIK_LINES[context];
  if (!arr || !arr.length) return "";
  return arr[Math.floor(Math.random() * arr.length)];
}

function populateProfikChips() {
  document.querySelectorAll("[data-profik-context]").forEach((el) => {
    el.innerHTML = profikSays(el.dataset.profikContext);
  });
}

/**
 * Показать реплику Профика на экране результата.
 * type — 'sprint', 'marathon', 'duel'
 * Sprint/Marathon: определяет уровень по числу правильных.
 */
function showProfikResult(type, opts) {
  const chip = document.getElementById(`${type}-profik-chip`);
  const msgEl = document.getElementById(`${type}-profik-msg`);
  if (!chip || !msgEl) return;
  let context = "";
  if (type === "sprint") {
    const correct = opts.correct ?? 0;
    if (correct === 0)      context = "sprint_result_zero";
    else if (correct < 10)  context = "sprint_result_low";
    else if (correct < 20)  context = "sprint_result_mid";
    else                    context = "sprint_result_high";
  } else if (type === "marathon") {
    const correct = opts.correct ?? 0;
    if (correct < 5)        context = "marathon_result_low";
    else if (correct < 15)  context = "marathon_result_mid";
    else                    context = "marathon_result_high";
  } else if (type === "duel") {
    if (opts.is_draw)       context = "duel_result_draw";
    else if (opts.won)      context = "duel_result_win";
    else                    context = "duel_result_loss";
  }
  msgEl.innerHTML = profikSays(context);
  chip.style.display = "flex";
}

function greetingByHour() {
  const h = new Date().getHours();
  if (h < 5)  return "Доброй ночи";
  if (h < 12) return "Доброе утро";
  if (h < 18) return "Добрый день";
  return "Добрый вечер";
}

/**
 * Автотитул игрока по статистике.
 * Возвращает строку типа «Любитель Спринтов», «Марафонец», «Дуэлянт».
 */
function computeUserTitle(p) {
  const sp = p.sprint_count || 0;
  const ma = p.marathon_count || 0;
  const pa = p.party_count || 0;
  const du = p.duel_count || 0;
  const won = p.duel_won || 0;
  const total = sp + ma + pa + du;

  if (total === 0) return "Новичок";
  if (won >= 25) return "🏆 Чемпион";
  if (du >= 15 && won / Math.max(1, du) >= 0.6) return "⚔ Дуэлянт";
  if (ma >= 20) return "🏆 Марафонец";
  if (sp >= 30) return "⚡ Спринтер";
  if (pa >= 10) return "🎉 Тусовщик";
  if (du >= 5) return "🗡 Задира";
  if (total >= 20) return "🎓 Ученик";
  if (total >= 5) return "🌱 Начинающий";
  return "🐣 Новичок";
}

/**
 * Одна короткая мотивирующая строка на главной.
 * Приоритет: невзятые награды → близко к уровню → до следующей лиги → задание дня.
 */
function renderMotivateLine(profile) {
  const box = document.getElementById("motivate-line");
  const iconEl = document.getElementById("motivate-icon");
  const textEl = document.getElementById("motivate-text");
  if (!box) return;

  const toNext = profile.level_info?.to_next || 0;
  const currentLeague = profile.league?.display || profile.league?.name || "";
  const nextThreshold = profile.league?.next_threshold;
  const rating = profile.rating || 0;
  const toLeague = nextThreshold ? Math.max(0, nextThreshold - rating) : 0;

  let icon = "🎯", text = "Выбери режим и начни день!";

  if (toNext > 0 && toNext <= 80) {
    icon = "⭐";
    text = `До ${profile.level_info.level + 1}-го уровня осталось <b>${toNext} XP</b>`;
  } else if (toLeague > 0 && toLeague <= 60) {
    icon = "🏆";
    text = `До следующей лиги осталось <b>${toLeague} рейтинга</b>`;
  } else if (profile.training_remaining_today > 0) {
    icon = "🔥";
    text = `Сегодня можно заработать ещё <b>${profile.training_remaining_today} рейтинга</b>`;
  } else {
    icon = "💎";
    text = `Отличная форма! <b>XP-кап</b> собран`;
  }
  iconEl.textContent = icon;
  textEl.innerHTML = text;
  box.style.display = "flex";
}

/**
 * Плавно проскроллить к секции режимов при клике «Играть».
 */
function scrollToModes() {
  hapticMedium();
  const anchor = document.getElementById("modes-anchor");
  if (anchor) anchor.scrollIntoView({behavior: "smooth", block: "start"});
}
window.scrollToModes = scrollToModes;

/**
 * Показать личные рекорды/статистику на карточках режимов.
 */
function renderCardStats(profile) {
  // Спринт: лучший рекорд по любой длительности из CloudStorage
  let bestSprint = 0;
  for (const d of ["easy", "medium", "hard"]) {
    for (const t of [30, 60, 90]) {
      const v = records[`sprint_${d}_${t}`] || 0;
      if (v > bestSprint) bestSprint = v;
    }
  }
  const spEl = document.getElementById("card-sprint-stat");
  if (spEl) spEl.textContent = bestSprint > 0
    ? `⚡ Рекорд: ${bestSprint}`
    : `${profile.sprint_count || 0} партий сыграно`;

  // Марафон: лучший рекорд из CloudStorage
  let bestMarathon = 0;
  for (const d of ["easy", "medium", "hard"]) {
    for (const l of [3, 5, 7]) {
      const v = records[`marathon_${d}_${l}`] || 0;
      if (v > bestMarathon) bestMarathon = v;
    }
  }
  const maEl = document.getElementById("card-marathon-stat");
  if (maEl) maEl.textContent = bestMarathon > 0
    ? `🏆 Лучший: ${bestMarathon} вопросов`
    : `${profile.marathon_count || 0} партий сыграно`;

  // Тусовка: число партий
  const paEl = document.getElementById("card-party-stat");
  const partyCount = profile.party_count || 0;
  if (paEl) paEl.textContent = partyCount > 0 ? `🎉 ${partyCount} партий` : "";

  // Дуэль: победы
  const duEl = document.getElementById("card-duel-stat");
  if (duEl) {
    const won = profile.duel_won || 0;
    const played = profile.duel_count || 0;
    duEl.textContent = played > 0 ? `⚔ ${won} побед из ${played}` : "";
  }
}


async function loadProfileScreen() {
  const p = await apiPost("/api/profile", {init_data: INIT_DATA});
  if (!p || !p.rating) return;
  currentProfile = p;
  const name = p.username ? "@" + p.username : (p.first_name || "Игрок");
  document.getElementById("profile-name").textContent = name;
  document.getElementById("profile-title").textContent = computeUserTitle(p);
  document.getElementById("profile-league-emoji").textContent = p.league.emoji;
  document.getElementById("profile-league-name").textContent = p.league.display || p.league.name;
  document.getElementById("profile-rating").textContent = p.rating;
  document.getElementById("profile-today-earned").textContent = p.training_earned_today;
  document.getElementById("profile-cap-remaining").textContent = p.training_remaining_today;
  document.getElementById("profile-games-played").textContent = p.games_played;
  // Уровень и XP
  const lvl = p.level_info || {level: 1, in_level: 0, next_threshold: 100, current_threshold: 0, progress_percent: 0};
  document.getElementById("profile-level-num").textContent = lvl.level;
  document.getElementById("profile-xp-current").textContent = p.xp || 0;
  document.getElementById("profile-xp-next").textContent = lvl.next_threshold;
  document.getElementById("profile-xp-fill").style.width = (lvl.progress_percent || 0) + "%";
  // Стрик
  document.getElementById("profile-streak-num").textContent = p.current_streak || 0;
  document.getElementById("profile-streak-record").textContent = p.longest_streak || 0;
  const nextM = p.next_milestone;
  const nextEl = document.getElementById("profile-streak-next");
  if (nextM && p.current_streak > 0) {
    nextEl.textContent = `До ${nextM.day} дней подряд: ${nextM.days_to_go} · награда +${nextM.bonus_xp} XP`;
  } else if (p.current_streak === 0) {
    nextEl.textContent = "Заходи каждый день — серия начнёт расти";
  } else {
    nextEl.textContent = "Все милстоуны собраны! 🏆";
  }

  // Прогресс до следующей лиги
  const wrap = document.getElementById("profile-progress-wrap");
  if (p.league.next_threshold) {
    const cur = p.league.threshold;
    const next = p.league.next_threshold;
    const filled = Math.max(0, Math.min(100, ((p.rating - cur) / (next - cur)) * 100));
    document.getElementById("profile-progress-cur").textContent = cur;
    document.getElementById("profile-progress-next").textContent = next;
    document.getElementById("profile-progress-left").textContent = Math.max(0, next - p.rating);
    // Название следующей лиги
    const leagues = [
      {t: 1000, n: "Мидла"}, {t: 1300, n: "Синьора"},
      {t: 1600, n: "Стара"}, {t: 1900, n: "Легенды"},
    ];
    const nextLeague = leagues.find(l => l.t === next);
    document.getElementById("profile-progress-next-name").textContent = nextLeague ? nextLeague.n : "следующей лиги";
    document.getElementById("profile-progress-fill").style.width = filled + "%";
    wrap.style.display = "block";
  } else {
    wrap.style.display = "none";
  }

  // Место в топе
  const me = await apiPost("/api/leaderboard/me", {init_data: INIT_DATA});
  if (me && me.place) {
    document.getElementById("profile-place").textContent = me.place + " из " + me.total;
  }
  // Ежедневные задания
  await renderDailyQuests();
}

async function renderDailyQuests() {
  const wrap = document.getElementById("quests-list");
  if (!wrap) return;
  const res = await apiPost("/api/quests/daily", {init_data: INIT_DATA});
  if (!res || !res.quests) {
    wrap.innerHTML = "";
    return;
  }
  wrap.innerHTML = "";
  res.quests.forEach((q) => {
    const done = q.completed === 1;
    const claimed = q.claimed === 1;
    const percent = Math.min(100, Math.round(q.progress * 100 / q.target));
    const row = document.createElement("div");
    row.className = "quest-row" + (claimed ? " claimed" : done ? " done" : "");
    let rightSide;
    if (claimed) {
      rightSide = `<div class="quest-claimed-mark">✓</div>`;
    } else if (done) {
      rightSide = `<button class="quest-claim-btn" data-qid="${q.id}" data-xp="${q.xp_reward}">+${q.xp_reward} XP</button>`;
    } else {
      rightSide = `
        <div class="quest-reward">
          <div class="quest-reward-xp">+${q.xp_reward}</div>
          <div class="quest-reward-xp-label">XP</div>
        </div>`;
    }
    row.innerHTML = `
      <div class="quest-icon">${q.icon}</div>
      <div class="quest-info">
        <div class="quest-title">${escapeHtml(q.title)}</div>
        <div class="quest-progress-bar">
          <div class="quest-progress-fill" style="width:${percent}%"></div>
        </div>
        <div class="quest-progress-text">${q.progress}/${q.target}</div>
      </div>
      ${rightSide}
    `;
    wrap.appendChild(row);
  });
  // Обработчики claim-кнопок
  wrap.querySelectorAll(".quest-claim-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      hapticMedium();
      const qid = parseInt(btn.dataset.qid, 10);
      const res = await apiPost("/api/quests/claim", {init_data: INIT_DATA, quest_id: qid});
      if (res && res.xp_awarded) {
        // Тост
        showRatingToast({delta_awarded: 0, xp_awarded: res.xp_awarded, new_rating: null});
        // Level-up
        if (res.leveled_up) {
          setTimeout(() => showLevelUpModal(res.level_info.level), 800);
        }
        // Перерендер
        setTimeout(renderDailyQuests, 300);
        refreshProfile();
      }
    });
  });
}

let currentLbTab = "top";

function renderLbEmotion(tab, leaders, myId) {
  const box = document.getElementById("lb-emotion");
  if (!box) return;
  if (!leaders.length) { box.style.display = "none"; return; }
  const myIdx = leaders.findIndex((l) => l.telegram_id === myId || l.is_me);
  const me = myIdx >= 0 ? leaders[myIdx] : null;

  let text = null;
  if (tab === "neighbors" && me) {
    const above = myIdx > 0 ? leaders[myIdx - 1] : null;
    if (above) {
      const diff = above.rating - me.rating;
      text = `До <b>${escapeHtml(above.first_name || "соперника")}</b> осталось <b>${diff} рейтинга</b>`;
    }
  } else if (tab === "top" && me && me.place > 10) {
    const top10 = leaders.find((l) => l.place === 10);
    if (top10) {
      const diff = top10.rating - me.rating;
      text = `До топ-10 осталось <b>${diff} рейтинга</b>`;
    }
  } else if (tab === "weekly" && leaders.length > 0) {
    text = `🔥 На этой неделе играют <b>${leaders.length}</b> игроков`;
  } else if (tab === "top" && me && me.place <= 3) {
    text = `🏆 Ты в топ-3! Держи позицию!`;
  }
  if (text) {
    box.innerHTML = text;
    box.style.display = "flex";
  } else {
    box.style.display = "none";
  }
}

async function openLeaderboard() {
  showScreen("leaderboard");
  currentLbTab = "top";
  updateLbTabsUI();
  await renderLeaderboardTab("top");
}
window.openLeaderboard = openLeaderboard;

function updateLbTabsUI() {
  document.querySelectorAll(".lb-tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.tab === currentLbTab);
  });
}

// Обработчики табов (делегирование, чтобы подхватило и после первого рендера)
document.addEventListener("click", (e) => {
  const tab = e.target.closest(".lb-tab");
  if (!tab) return;
  currentLbTab = tab.dataset.tab;
  updateLbTabsUI();
  hapticLight();
  renderLeaderboardTab(currentLbTab);
});

async function renderLeaderboardTab(tab) {
  const wrap = document.getElementById("leaderboard-list");
  const sub = document.getElementById("leaderboard-subtitle");
  wrap.innerHTML = '<p style="text-align:center; opacity:0.5;">Загружаем...</p>';
  const myId = tg?.initDataUnsafe?.user?.id;

  let leaders = [];
  let showWeekly = false;
  if (tab === "top") {
    sub.textContent = "Топ игроков по рейтингу";
    const r = await fetch("/api/leaderboard?limit=100");
    leaders = (await r.json()).leaders || [];
  } else if (tab === "neighbors") {
    sub.textContent = "Твоё окружение — 5 сверху, 5 снизу";
    const data = await apiPost("/api/leaderboard/neighbors", {init_data: INIT_DATA, radius: 5});
    leaders = data?.leaders || [];
  } else if (tab === "weekly") {
    sub.textContent = "Топ по приросту рейтинга за 7 дней";
    const r = await fetch("/api/leaderboard/weekly?limit=50");
    leaders = (await r.json()).leaders || [];
    showWeekly = true;
  }

  // Эмоциональная подсказка сверху
  renderLbEmotion(tab, leaders, myId);

  wrap.innerHTML = "";
  if (!leaders.length) {
    wrap.innerHTML = `<p style="text-align:center; opacity:0.7; padding:20px;">${
      tab === "weekly"
        ? "На неделе никто ещё не играл. Стань первым!"
        : "Пока никого. Играй тренировки — попадёшь первым!"
    }</p>`;
    return;
  }
  leaders.forEach((row) => {
    const div = document.createElement("div");
    div.className = "lb-row";
    const isMe = row.is_me || row.telegram_id === myId;
    if (isMe) div.classList.add("me");
    const placeClass = row.place === 1 ? "gold" : row.place === 2 ? "silver" : row.place === 3 ? "bronze" : "";
    const displayName = row.username ? "@" + row.username : (row.first_name || "Игрок");
    const gainHtml = showWeekly ? `<span class="lb-week-gain">+${row.weekly_gain} за неделю</span>` : "";
    div.innerHTML = `
      <div class="lb-place ${placeClass}">${row.place}</div>
      <div class="lb-info">
        <div class="lb-name">${escapeHtml(displayName)}${isMe ? " · это ты" : ""}</div>
        <div class="lb-league">${row.league.emoji} ${row.league.display || row.league.name}</div>
        ${gainHtml}
      </div>
      <div class="lb-rating">${row.rating}</div>
    `;
    wrap.appendChild(div);
  });
}

/**
 * Начисление очков от тренировки.
 * source: 'sprint' | 'marathon' | 'party'
 * points: сколько запрашиваем (сервер применит дневной кап к рейтингу; XP без капа)
 * Возвращает {delta_awarded, xp_awarded, new_rating, new_xp, level_info, leveled_up}
 */
async function awardTraining(source, points, meta = {}) {
  if (points <= 0) return null;
  const body = {init_data: INIT_DATA, source: source, points: points, ...meta};
  const res = await apiPost("/api/rating/training", body);
  if (res && res.new_rating) {
    if (currentProfile) {
      currentProfile.rating = res.new_rating;
      currentProfile.xp = res.new_xp;
      currentProfile.level_info = res.level_info;
    }
  }
  // Обновим плашку на главной
  refreshProfile();
  // NB: level-up и ачивки теперь показываются прямо на экране результата
  //     (через showTrainingResult), поэтому здесь не дублируем.
  return res;
}

/**
 * Показать тост с итогом начисления рейтинга и XP.
 */
function showRatingToast(res) {
  if (!res) return;
  const toast = document.createElement("div");
  toast.className = "rating-toast";
  const parts = [];
  if (res.delta_awarded > 0) {
    parts.push(`<b>+${res.delta_awarded}</b> рейтинга`);
  } else if (res.cap_reached) {
    parts.push(`<span style="color:#FF8C42;">Кап рейтинга</span>`);
  }
  if (res.xp_awarded > 0) {
    parts.push(`<b style="color:var(--brand-lime);">+${res.xp_awarded}</b> XP`);
  }
  if (parts.length === 0) return;
  toast.innerHTML = parts.join(" · ") + (res.new_rating ? `<br><small>Рейтинг: ${res.new_rating}</small>` : "");
  toast.classList.add("ok");
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add("show"), 10);
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/**
 * Показать модалку нового уровня.
 */
function showLevelUpModal(newLevel) {
  const modal = document.getElementById("levelup-modal");
  document.getElementById("levelup-num").textContent = newLevel;
  modal.style.display = "flex";
  hapticSuccess();
}
document.getElementById("levelup-btn").addEventListener("click", () => {
  document.getElementById("levelup-modal").style.display = "none";
});

/**
 * Показать модалку стрика (новый день серии).
 */
function showStreakModal(update) {
  const modal = document.getElementById("streak-modal");
  const days = update.current_streak;
  document.getElementById("streak-modal-days").textContent = days;
  document.getElementById("streak-modal-bonus").textContent = update.bonus_xp;
  // Заголовок: специальный для милстоуна
  const title = document.getElementById("streak-modal-title");
  const sub = document.getElementById("streak-modal-sub");
  if (update.milestone_reached) {
    title.textContent = `МИЛСТОУН! ${days} ДНЕЙ!`;
    sub.textContent = `Ты получил бонус за ${days} дней подряд! Продолжай в том же духе.`;
  } else if (days === 1 && update.was_broken) {
    title.textContent = "СЕРИЯ ПОТЕРЯНА";
    sub.textContent = "Ничего страшного — начнём заново с сегодняшнего дня.";
  } else if (days === 1) {
    title.textContent = "ПЕРВЫЙ ДЕНЬ!";
    sub.textContent = "Приходи завтра — начнётся серия.";
  } else {
    title.textContent = `${days} ДНЕЙ ПОДРЯД!`;
    sub.textContent = "Не пропускай — серия продолжает расти!";
  }
  modal.style.display = "flex";
  hapticSuccess();
}
document.getElementById("streak-btn").addEventListener("click", () => {
  document.getElementById("streak-modal").style.display = "none";
});

/**
 * Показать модалку новой ачивки (по очереди если несколько).
 */
const achievementQueue = [];
let achievementModalOpen = false;

function enqueueAchievements(list) {
  if (!list || !list.length) return;
  list.forEach((a) => achievementQueue.push(a));
  if (!achievementModalOpen) showNextAchievement();
}

function showNextAchievement() {
  const a = achievementQueue.shift();
  if (!a) { achievementModalOpen = false; return; }
  achievementModalOpen = true;
  document.getElementById("ach-modal-icon").textContent = a.icon;
  document.getElementById("ach-modal-title").textContent = a.title;
  document.getElementById("ach-modal-desc").textContent = a.desc;
  document.getElementById("ach-modal-xp").textContent = a.xp;
  document.getElementById("ach-modal").style.display = "flex";
  hapticSuccess();
}
document.getElementById("ach-modal-btn").addEventListener("click", () => {
  document.getElementById("ach-modal").style.display = "none";
  setTimeout(showNextAchievement, 200);
});
window.enqueueAchievements = enqueueAchievements;

/**
 * Открыть экран ачивок.
 */
async function openAchievements() {
  showScreen("achievements");
  const wrap = document.getElementById("ach-grid");
  wrap.innerHTML = '<p style="text-align:center; grid-column: 1/-1; opacity:0.5;">Загружаем...</p>';
  const res = await apiPost("/api/achievements", {init_data: INIT_DATA});
  if (!res || !res.items) {
    wrap.innerHTML = '<p style="text-align:center; grid-column: 1/-1;">Ошибка загрузки</p>';
    return;
  }
  document.getElementById("ach-earned-count").textContent = res.earned;
  document.getElementById("ach-total-count").textContent = res.total;
  const pct = Math.round(res.earned * 100 / res.total);
  document.getElementById("ach-progress-fill").style.width = pct + "%";

  // Сортируем: полученные сверху, потом по прогрессу
  const items = res.items.slice().sort((a, b) => {
    if (a.earned !== b.earned) return b.earned - a.earned;
    return (b.progress / b.target) - (a.progress / a.target);
  });

  // Следующая цель — самая близкая к получению из незаработанных
  const nextGoal = res.items
    .filter((it) => !it.earned && it.target > 0)
    .sort((a, b) => (b.progress / b.target) - (a.progress / a.target))[0];
  const nextBox = document.getElementById("ach-next-goal");
  if (nextGoal) {
    const remain = nextGoal.target - nextGoal.progress;
    document.getElementById("ach-next-icon").textContent = nextGoal.icon;
    document.getElementById("ach-next-title").textContent = nextGoal.title;
    document.getElementById("ach-next-desc").textContent =
      `Осталось: ${remain} · награда +${nextGoal.xp} XP`;
    nextBox.style.display = "flex";
  } else {
    nextBox.style.display = "none";
  }

  wrap.innerHTML = "";
  items.forEach((it) => {
    const percent = Math.round(it.progress * 100 / it.target);
    const tile = document.createElement("div");
    tile.className = "ach-tile" + (it.earned ? " earned" : " locked");
    tile.innerHTML = `
      <div class="ach-tile-icon">${it.icon}</div>
      <div class="ach-tile-title">${escapeHtml(it.title)}</div>
      ${!it.earned ? `<div class="ach-tile-progress"><div class="ach-tile-progress-fill" style="width:${percent}%"></div></div>` : ""}
    `;
    tile.addEventListener("click", () => {
      hapticLight();
      alert(`${it.icon} ${it.title}\n\n${it.desc}\n\nНаграда: +${it.xp} XP\nПрогресс: ${it.progress}/${it.target}${it.earned ? "\n\n✅ Получено!" : ""}`);
    });
    wrap.appendChild(tile);
  });

  // Показываем свежевыданные ачивки модалкой (если пришли с сервера)
  if (res.newly_earned && res.newly_earned.length) {
    enqueueAchievements(res.newly_earned);
  }

  // Обновляем счётчик на кнопке в профиле
  const badge = document.getElementById("profile-ach-badge");
  if (badge) badge.textContent = `${res.earned}/${res.total}`;
}
window.openAchievements = openAchievements;

// ==============================
// ========== ДУЭЛЬ =============
// ==============================
const duel = {
  difficulty: "medium",
  topics: ["informatika", "mathematics", "physics"],
  duelId: null,
  role: null,          // 'creator' | 'opponent'
  questions: [],
  qIndex: 0,
  answers: [],
  score: 0,
  timer: null,
  timeLeft: 15,
  timeStart: 0,
  locked: false,
  timeLimitMs: 15000,
};

setupPills("duel-difficulty", (v) => (duel.difficulty = v));
setupPillsMulti("duel-topic", (arr) => (duel.topics = arr));

async function duelStartCreate() {
  hapticMedium();
  const res = await apiPost("/api/duel/create", {
    init_data: INIT_DATA, difficulty: duel.difficulty, topic: duel.topics.join(","),
  });
  if (!res || !res.duel_id) {
    alert("Не удалось создать дуэль. Попробуй ещё раз.");
    return;
  }
  duel.duelId = res.duel_id;
  duel.role = "creator";
  duel.questions = res.questions;
  duel.timeLimitMs = res.time_limit_ms || 15000;
  duel.qIndex = 0;
  duel.answers = [];
  duel.score = 0;
  document.getElementById("duel-score").textContent = 0;
  showScreen("duelPlay");
  duelRenderQ();
}

function duelRenderQ() {
  const q = duel.questions[duel.qIndex];
  document.getElementById("duel-q-index").textContent = duel.qIndex + 1;
  document.getElementById("duel-question").textContent = q.q;
  const wrap = document.getElementById("duel-answers");
  wrap.innerHTML = "";
  q.options.forEach((opt, i) => {
    const btn = document.createElement("button");
    btn.className = "answer-btn";
    btn.textContent = opt;
    btn.addEventListener("click", () => duelAnswer(i));
    wrap.appendChild(btn);
  });
  duel.locked = false;
  duel.timeLeft = Math.floor(duel.timeLimitMs / 1000);
  duel.timeStart = Date.now();
  duelUpdateTimer();
  duel.timer = setInterval(() => {
    duel.timeLeft--;
    duelUpdateTimer();
    if (duel.timeLeft <= 0) {
      duelAnswer(-1);  // таймаут
    } else {
      playTick(duel.timeLeft);
    }
  }, 1000);
}

function duelUpdateTimer() {
  const el = document.getElementById("duel-timer");
  el.textContent = duel.timeLeft;
  el.classList.remove("warn", "danger");
  if (duel.timeLeft <= 3) el.classList.add("danger");
  else if (duel.timeLeft <= 7) el.classList.add("warn");
}

function duelAnswer(chosen) {
  if (duel.locked) return;
  duel.locked = true;
  clearInterval(duel.timer);
  const elapsed = Math.min(duel.timeLimitMs, Date.now() - duel.timeStart);
  duel.answers.push({
    index: duel.qIndex,
    chosen: chosen,
    elapsed_ms: elapsed,
  });

  // Локально прикинем очки для UX
  // (сервер посчитает точно). Не знаем правильный ответ, поэтому просто идём дальше.
  hapticLight();

  duel.qIndex++;
  if (duel.qIndex >= duel.questions.length) {
    duelSubmit();
  } else {
    setTimeout(duelRenderQ, 250);
  }
}

async function duelSubmit() {
  const res = await apiPost(`/api/duel/${duel.duelId}/submit`, {
    init_data: INIT_DATA, answers: duel.answers,
  });
  if (!res) {
    alert("Не смог отправить результат. Попробуй ещё раз.");
    return;
  }
  // Обновим локальный рейтинг (может быть изменён если дуэль завершилась)
  refreshProfile();

  if (res.status === "complete") {
    duelShowResult(res);
  } else {
    // ожидание соперника — это делает только создатель
    duelShowWaiting(res);
  }
}

function duelShowWaiting(info) {
  const myScore = duel.role === "creator" ? info.creator_score : info.opponent_score;
  document.getElementById("duel-wait-score").textContent = myScore;
  showScreen("duelWaiting");
  hapticSuccess();
}

function duelShowResult(info) {
  const isCreator = info.you_are === "creator";
  const myScore = isCreator ? info.creator_score : info.opponent_score;
  const oppScore = isCreator ? info.opponent_score : info.creator_score;
  const myDelta = isCreator ? info.creator_delta : info.opponent_delta;
  const oppObj = isCreator ? info.opponent : info.creator;
  const myObj = isCreator ? info.creator : info.opponent;

  document.getElementById("duel-you-name").textContent = myObj?.name || "Ты";
  document.getElementById("duel-opp-name").textContent = oppObj?.name || "Соперник";
  document.getElementById("duel-you-score").textContent = myScore || 0;
  document.getElementById("duel-opp-score").textContent = oppScore || 0;

  let emoji = "🤝", title = "Ничья";
  if (info.is_draw) {
    emoji = "🤝"; title = "Ничья";
  } else if (info.winner_id === myObj?.id) {
    emoji = "🎉"; title = "Победа!";
    hapticSuccess();
  } else {
    emoji = "😞"; title = "Поражение";
    hapticError();
  }
  document.getElementById("duel-result-emoji").textContent = emoji;
  document.getElementById("duel-result-title").textContent = title;
  document.getElementById("duel-you-score").textContent = "0";
  document.getElementById("duel-opp-score").textContent = "0";

  const deltaEl = document.getElementById("duel-elo-delta");
  const xpTxt = info.xp_awarded ? ` · <b style="color:var(--brand-lime);">+${info.xp_awarded} XP</b>` : "";
  deltaEl.innerHTML = (myDelta > 0 ? "+" : "") + myDelta + xpTxt;
  deltaEl.style.color = myDelta > 0 ? "var(--ok)" : (myDelta < 0 ? "var(--danger)" : "");

  // Level-up блок в результате
  const prevLvl = currentProfile?.level_info?.level || 1;
  const newLvl = info.my_level_info?.level || prevLvl;
  const luBlock = document.getElementById("duel-levelup");
  if (newLvl > prevLvl) {
    document.getElementById("duel-levelup-num").textContent = newLvl;
    luBlock.style.display = "block";
  } else {
    luBlock.style.display = "none";
  }

  showScreen("duelResult");

  // Реплика Профика по итогу
  const wonForMe = !info.is_draw && info.winner_id === myObj?.id;
  showProfikResult("duel", {won: wonForMe, is_draw: info.is_draw});

  // Готовим и показываем виральную карточку
  const cardWrap = document.getElementById("duel-card-wrap");
  try {
    const dataUrl = renderDuelCard({
      me: {
        id: myObj?.id,
        name: myObj?.name || "Ты",
        score: myScore || 0,
        league_emoji: myObj?.league?.emoji,
        league_name: myObj?.league?.name,
      },
      opp: {
        id: oppObj?.id,
        name: oppObj?.name || "Соперник",
        score: oppScore || 0,
        league_emoji: oppObj?.league?.emoji,
        league_name: oppObj?.league?.name,
      },
      is_draw: info.is_draw,
      winner_id: info.winner_id,
      myDelta,
    });
    document.getElementById("duel-card-img").src = dataUrl;
    cardWrap.style.display = "block";
  } catch (e) {
    console.error("card render failed", e);
    cardWrap.style.display = "none";
  }

  // Ревил
  revealResultScreen("screen-duel-result", {stepDelay: 200});
  // Counter-up для очков
  setTimeout(() => {
    animateNumber(document.getElementById("duel-you-score"), 0, myScore || 0, 1100);
    animateNumber(document.getElementById("duel-opp-score"), 0, oppScore || 0, 1100);
  }, 500);

  refreshProfile();
  // Ачивки — дёрнем /api/achievements и вставим прямо в экран
  setTimeout(async () => {
    const res = await apiPost("/api/achievements", {init_data: INIT_DATA});
    if (res && res.newly_earned && res.newly_earned.length) {
      fillResultAchievements("duel-achievements", res.newly_earned);
      // Плавно проявляем блок
      const el = document.getElementById("duel-achievements");
      el.classList.remove("show");
      setTimeout(() => el.classList.add("show"), 50);
    }
  }, 1800);
}

async function duelCheckResult() {
  if (!duel.duelId) return;
  const res = await apiPost(`/api/duel/${duel.duelId}`, {init_data: INIT_DATA});
  if (res && res.status === "complete") {
    duelShowResult(res);
  } else {
    alert("Соперник ещё не сыграл. Загляни позже.");
  }
}

function duelGetShareLink() {
  const botUser = document.querySelector('a[href^="https://t.me/"]')?.getAttribute("href");
  // Пробуем достать username бота из initDataUnsafe / переменных окружения нет, поэтому используем текущий домен
  // Лучший вариант: показать сообщение с текстом ссылки к боту
  // Формат: https://t.me/<bot_username>?start=duel_XXX
  const botLink = `https://t.me/${DUEL_BOT_USERNAME}?start=duel_${duel.duelId}`;
  return botLink;
}

// Username бота подгружаем с /api/config
let DUEL_BOT_USERNAME = "your_bot";
fetch("/api/config").then(r => r.json()).then(cfg => {
  if (cfg && cfg.bot_username) DUEL_BOT_USERNAME = cfg.bot_username;
}).catch(() => {});

/**
 * Рисует красивую карточку результата дуэли на Canvas.
 * Возвращает data URL PNG.
 */
function renderDuelCard(info) {
  const canvas = document.getElementById("duel-card-canvas");
  const ctx = canvas.getContext("2d");
  const W = canvas.width;   // 640
  const H = canvas.height;  // 640

  // === Фон: фиолетовый градиент ===
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#2A1B4A");
  bg.addColorStop(0.5, "#4020B0");
  bg.addColorStop(1, "#2A1B4A");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Декоративные полупрозрачные круги
  ctx.fillStyle = "rgba(180, 242, 77, 0.08)";
  ctx.beginPath();
  ctx.arc(90, 90, 120, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(W - 90, H - 90, 120, 0, Math.PI * 2);
  ctx.fill();

  // === Шапка: логотип «профиматика» + название ===
  ctx.fillStyle = "#B4F24D";
  const badgeW = 240, badgeH = 44, badgeX = (W - badgeW) / 2, badgeY = 40;
  roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 22);
  ctx.fill();
  ctx.fillStyle = "#2A1B4A";
  ctx.font = "900 22px 'Segoe UI', Roboto, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("профиматика", W / 2, badgeY + badgeH / 2);

  ctx.fillStyle = "#fff";
  ctx.font = "900 34px 'Segoe UI', Roboto, sans-serif";
  ctx.fillText("ПРОФИК АРЕНА", W / 2, 130);
  ctx.fillStyle = "rgba(180, 242, 77, 0.9)";
  ctx.font = "600 18px 'Segoe UI', Roboto, sans-serif";
  ctx.fillText("⚔  Блиц-дуэль", W / 2, 162);

  // === Верхний эмоджи: победа/поражение/ничья ===
  const isDraw = info.is_draw;
  const isMe = info.winner_id === (info.me?.id);
  const emoji = isDraw ? "🤝" : (isMe ? "🏆" : "⚔");
  ctx.font = "72px sans-serif";
  ctx.fillText(emoji, W / 2, 230);

  const titleText = isDraw ? "Ничья" : (isMe ? "Победа!" : "Поражение");
  ctx.fillStyle = isDraw ? "#B6A9D9" : (isMe ? "#B4F24D" : "#FF4D6D");
  ctx.font = "900 36px 'Segoe UI', Roboto, sans-serif";
  ctx.fillText(titleText, W / 2, 285);

  // === Центр: VS-блок ===
  const boxY = 320;
  const boxH = 180;
  ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
  roundRect(ctx, 40, boxY, W - 80, boxH, 20);
  ctx.fill();

  // Левый игрок
  drawPlayerBlock(ctx, info.me, 90, boxY + 30, boxH - 60);
  // Правый игрок
  drawPlayerBlock(ctx, info.opp, W - 90, boxY + 30, boxH - 60, true);

  // "VS" в центре
  ctx.fillStyle = "#B4F24D";
  ctx.font = "900 44px 'Segoe UI', Roboto, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("VS", W / 2, boxY + boxH / 2 + 14);

  // === Изменение рейтинга ===
  const myDelta = info.myDelta || 0;
  ctx.fillStyle = myDelta > 0 ? "#B4F24D" : (myDelta < 0 ? "#FF4D6D" : "#B6A9D9");
  ctx.font = "900 28px 'Segoe UI', Roboto, sans-serif";
  const deltaTxt = (myDelta > 0 ? "+" : "") + myDelta + "  рейтинга";
  ctx.textAlign = "center";
  ctx.fillText(deltaTxt, W / 2, 540);

  // === CTA снизу ===
  ctx.fillStyle = "#fff";
  ctx.font = "700 20px 'Segoe UI', Roboto, sans-serif";
  ctx.fillText("Прими вызов на Профик Арене!", W / 2, 585);
  ctx.fillStyle = "rgba(180, 242, 77, 0.8)";
  ctx.font = "500 15px 'Courier New', monospace";
  ctx.fillText("t.me/" + DUEL_BOT_USERNAME, W / 2, 610);

  return canvas.toDataURL("image/png");
}

function drawPlayerBlock(ctx, player, x, y, h, alignRight = false) {
  if (!player) return;
  ctx.textAlign = "center";
  // Имя
  ctx.fillStyle = "#fff";
  ctx.font = "700 20px 'Segoe UI', Roboto, sans-serif";
  const name = ellipsize(player.name || "Игрок", 12);
  ctx.fillText(name, x, y + 22);
  // Счёт (крупно)
  ctx.fillStyle = "#B4F24D";
  ctx.font = "900 56px 'Segoe UI', Roboto, sans-serif";
  ctx.fillText(String(player.score || 0), x, y + 90);
  // Лига
  ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
  ctx.font = "600 14px 'Segoe UI', Roboto, sans-serif";
  ctx.fillText(`${player.league_emoji || ""} ${player.league_name || ""}`.trim(), x, y + h);
}

function ellipsize(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

function duelShare() {
  const link = duelGetShareLink();
  const text = `⚔ Я вызываю тебя на Блиц-дуэль в Профик Арене! Прими вызов: ${link}`;
  if (tg?.openTelegramLink) {
    tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent("⚔ Я вызываю тебя на Блиц-дуэль в Профик Арене!")}`);
  } else {
    // fallback: копируем ссылку
    duelCopy();
  }
}

async function duelCopy() {
  const link = duelGetShareLink();
  try {
    await navigator.clipboard.writeText(link);
    showRatingToast({delta_awarded: 1, new_rating: 0}); // хак-тост
    const el = document.createElement("div");
    el.className = "rating-toast ok show";
    el.innerHTML = "<b>Ссылка скопирована!</b>";
    document.body.appendChild(el);
    setTimeout(() => { el.classList.remove("show"); setTimeout(()=>el.remove(), 300); }, 2000);
  } catch (e) {
    prompt("Скопируй ссылку вручную:", link);
  }
}

async function duelOpenIncoming(duelId) {
  duel.duelId = duelId;
  duel.role = "opponent";
  const info = await apiPost(`/api/duel/${duelId}`, {init_data: INIT_DATA});
  if (!info) {
    alert("Не смог загрузить дуэль.");
    showScreen("menu");
    return;
  }
  if (info.status === "complete") {
    duelShowResult(info);
    return;
  }
  // Показываем экран приёма
  document.getElementById("duel-accept-from").textContent = info.creator.name;
  const league = info.creator.league;
  document.getElementById("duel-accept-league").textContent =
    `${league.emoji} ${league.display || league.name} · ${info.creator.rating}`;
  if (info.creator_score) {
    document.getElementById("duel-accept-opp-score").textContent = info.creator_score;
    document.getElementById("duel-accept-opp-score-wrap").style.display = "block";
  }
  showScreen("duelAccept");
}

async function duelAcceptChallenge() {
  hapticMedium();
  const res = await apiPost(`/api/duel/${duel.duelId}/join`, {init_data: INIT_DATA});
  if (!res || !res.questions) {
    alert("Не смог присоединиться. Возможно, дуэль уже занята.");
    showScreen("menu");
    return;
  }
  duel.questions = res.questions;
  duel.timeLimitMs = res.time_limit_ms || 15000;
  duel.qIndex = 0;
  duel.answers = [];
  duel.score = 0;
  document.getElementById("duel-score").textContent = 0;
  showScreen("duelPlay");
  duelRenderQ();
}

document.getElementById("btn-duel-start").addEventListener("click", duelStartCreate);
document.getElementById("btn-duel-accept").addEventListener("click", duelAcceptChallenge);
document.getElementById("btn-duel-check").addEventListener("click", duelCheckResult);
document.getElementById("btn-duel-share").addEventListener("click", duelShare);
document.getElementById("btn-duel-copy").addEventListener("click", duelCopy);
document.getElementById("btn-duel-rematch").addEventListener("click", () => {
  duel.duelId = null;
  showScreen("duelSetup");
});

// === Скачать карточку PNG ===
document.getElementById("btn-duel-download").addEventListener("click", () => {
  const img = document.getElementById("duel-card-img");
  if (!img.src || img.src.length < 100) return;
  const a = document.createElement("a");
  a.href = img.src;
  a.download = `profik-arena-duel-${duel.duelId || "result"}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  hapticSuccess();
});

// === Поделиться карточкой в Telegram ===
document.getElementById("btn-duel-share-card").addEventListener("click", async () => {
  hapticMedium();
  const link = duelGetShareLink();
  const shareText = "⚔ Смотри как я сыграл в Профик Арене! Прими вызов: " + link;
  // Пытаемся native share (файл), с fallback на Telegram share URL
  if (navigator.share && document.getElementById("duel-card-img").src) {
    try {
      // Конвертируем dataURL в Blob и делимся файлом
      const dataUrl = document.getElementById("duel-card-img").src;
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], "profik-arena-duel.png", {type: "image/png"});
      if (navigator.canShare && navigator.canShare({files: [file]})) {
        await navigator.share({files: [file], text: shareText, title: "Профик Арена"});
        return;
      }
    } catch (e) {
      console.warn("navigator.share failed", e);
    }
  }
  // Fallback: обычный Telegram share (без картинки)
  if (tg?.openTelegramLink) {
    tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(shareText)}`);
  } else {
    duelCopy();
  }
});

async function openDuelHistory() {
  showScreen("duelHistory");
  const wrap = document.getElementById("duel-history-list");
  wrap.innerHTML = '<p class="dh-empty">Загружаем...</p>';
  const res = await apiPost("/api/duels/history", {init_data: INIT_DATA, limit: 30});
  if (!res || !res.history) {
    wrap.innerHTML = '<p class="dh-empty">Не смог загрузить историю</p>';
    return;
  }
  if (res.history.length === 0) {
    wrap.innerHTML = '<p class="dh-empty">Пока боёв не было.<br>Создай первую дуэль!</p>';
    return;
  }
  wrap.innerHTML = "";
  res.history.forEach((h) => {
    const row = document.createElement("div");
    let outcome = "draw", cls = "draw";
    let title = "🤝 Ничья";
    if (h.won) { outcome = "win"; cls = "win"; title = "🏆 Победа"; }
    else if (!h.draw) { outcome = "loss"; cls = "loss"; title = "❌ Поражение"; }
    row.className = "dh-row " + outcome;
    const deltaCls = h.my_delta > 0 ? "pos" : h.my_delta < 0 ? "neg" : "";
    const deltaTxt = (h.my_delta > 0 ? "+" : "") + h.my_delta;
    const dateShort = (h.created_at || "").split(" ")[0].split("-").reverse().slice(0, 2).join(".");
    row.innerHTML = `
      <div class="dh-main">
        <div class="dh-title ${cls}">${title}</div>
        <div class="dh-opp">vs <b>${escapeHtml(h.opponent_name)}</b></div>
        <div class="dh-meta">${h.my_score} : ${h.opp_score} · ${dateShort}</div>
      </div>
      <div class="dh-delta ${deltaCls}">${deltaTxt}<span class="dh-delta-lbl">рейтинг</span></div>
    `;
    wrap.appendChild(row);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

document.getElementById("btn-duel-history").addEventListener("click", openDuelHistory);

// Экспортируем для checkSubscription — она вызывает после успеха
window._maybeOpenIncomingDuel = async function() {
  const params = new URLSearchParams(window.location.search);
  const incoming = params.get("duel");
  if (incoming) await duelOpenIncoming(incoming);
};

// ==== Проверка подписки: кнопка ====
document.getElementById("btn-recheck").addEventListener("click", checkSubscription);

// ==== Haptics ====
function hapticLight() { tg?.HapticFeedback?.impactOccurred?.("light"); }
function hapticMedium() { tg?.HapticFeedback?.impactOccurred?.("medium"); }
function hapticSuccess() { tg?.HapticFeedback?.notificationOccurred?.("success"); }
function hapticError() { tg?.HapticFeedback?.notificationOccurred?.("error"); }

// ==== Утилиты анимации экрана результата ====
function easeOutQuad(t) { return t * (2 - t); }

function animateNumber(el, from, to, duration = 900) {
  if (!el) return;
  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / duration);
    el.textContent = Math.round(from + (to - from) * easeOutQuad(p));
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = to;
  };
  requestAnimationFrame(step);
}

/**
 * Плавно раскрывает все .reveal внутри контейнера с задержкой.
 * Игнорирует те, что скрыты через style.display = 'none'.
 */
function revealResultScreen(screenId, options = {}) {
  const root = document.getElementById(screenId);
  if (!root) return;
  const stepDelay = options.stepDelay || 180;
  // Сбрасываем предыдущее состояние
  root.querySelectorAll(".reveal").forEach((el) => el.classList.remove("show"));
  // Собираем видимые элементы
  const items = Array.from(root.querySelectorAll(".reveal")).filter((el) => {
    return getComputedStyle(el).display !== "none";
  });
  items.forEach((el, i) => {
    setTimeout(() => {
      el.classList.add("show");
      if (i === 0) hapticLight();
      if (el.classList.contains("result-levelup")) hapticSuccess();
    }, i * stepDelay);
  });
}

/**
 * Заполнить блок «Ачивки внутри результата» плашками.
 */
function fillResultAchievements(containerId, achievements) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  wrap.innerHTML = "";
  if (!achievements || !achievements.length) return;
  achievements.forEach((a) => {
    const tag = document.createElement("div");
    tag.className = "result-ach-tag";
    tag.innerHTML = `${a.icon} ${escapeHtml(a.title)}`;
    wrap.appendChild(tag);
  });
}

/**
 * Универсальный ревил экрана результата для тренировочных игр.
 * options: { screenId, correctEl, correctFrom, correctTo,
 *            wrongEl, wrongFrom, wrongTo,
 *            ratingEl, xpEl, res,
 *            levelupBlockId, levelupNumId,
 *            achContainerId, prevLevel }
 */
function showTrainingResult(opts) {
  showScreen(opts.screenName);
  // Начальные значения
  if (opts.correctEl) opts.correctEl.textContent = "0";
  if (opts.wrongEl)   opts.wrongEl.textContent   = "0";
  if (opts.ratingEl)  opts.ratingEl.textContent  = "0";
  if (opts.xpEl)      opts.xpEl.textContent      = "0";

  // Level-up блок
  const luBlock = document.getElementById(opts.levelupBlockId);
  const res = opts.res || {};
  const isLevelUp = res.leveled_up && res.level_info;
  if (luBlock) {
    if (isLevelUp) {
      document.getElementById(opts.levelupNumId).textContent = res.level_info.level;
      luBlock.style.display = "block";
    } else {
      luBlock.style.display = "none";
    }
  }
  // Ачивки
  fillResultAchievements(opts.achContainerId, res.newly_earned_achievements);

  // Ревил
  revealResultScreen(opts.screenId, {stepDelay: 180});

  // Counter-up после того как соответствующая плашка появилась
  setTimeout(() => {
    if (opts.correctEl && opts.correctTo != null)
      animateNumber(opts.correctEl, 0, opts.correctTo, 900);
    if (opts.wrongEl && opts.wrongTo != null)
      animateNumber(opts.wrongEl, 0, opts.wrongTo, 900);
  }, 400);
  setTimeout(() => {
    if (opts.ratingEl && res.delta_awarded != null)
      animateNumber(opts.ratingEl, 0, res.delta_awarded, 700);
    if (opts.xpEl && res.xp_awarded != null)
      animateNumber(opts.xpEl, 0, res.xp_awarded, 800);
  }, 900);
}

// ==== Старт ====
// Ждём Telegram SDK до 2.5 сек (он грузится async). Если пришёл — используем его;
// если нет (обычный браузер или заблокирован telegram.org) — стартуем без него,
// чтобы приложение НИКОГДА не зависало на экране проверки.
function boot() {
  let waited = 0;
  const iv = setInterval(() => {
    const wa = window.Telegram?.WebApp;
    waited += 100;
    if (wa || waited >= 2500) {
      clearInterval(iv);
      if (wa && !tg) { tg = wa; try { tg.ready(); tg.expand(); } catch (e) {} }
      loadRecordsFromCloud();
      loadCrocoRecordsFromCloud();
      loadGromkoRecordsFromCloud();
      tbLoadRecordsFromCloud();
      fmLoadRecords();
      imLoadRecords();
      checkSubscription();
    }
  }, 100);
}
boot();
