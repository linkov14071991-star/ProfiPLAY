// ==== Telegram WebApp init ====
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

// ==== Экраны ====
const SCREENS = {
  check: "screen-check",
  needSub: "screen-need-sub",
  menu: "screen-menu",
  crocoSetup: "screen-croco-setup",
  game: "screen-game",           // игра Крокодил
  result: "screen-result",       // итоги Крокодила
  sprintSetup: "screen-sprint-setup",
  sprint: "screen-sprint",
  sprintResult: "screen-sprint-result",
  aliasSetup: "screen-alias-setup",
  alias: "screen-alias",
  aliasResult: "screen-alias-result",
};

function showScreen(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(SCREENS[name]).classList.add("active");
  window.scrollTo(0, 0);
}

// ==== Проверка подписки ====
async function checkSubscription() {
  const userId = tg?.initDataUnsafe?.user?.id;
  if (!userId) { showScreen("menu"); return; }

  try {
    const r = await fetch(`/api/check_subscription?user_id=${userId}`);
    const data = await r.json();
    showScreen(data.subscribed ? "menu" : "needSub");
  } catch (e) {
    showScreen("menu");
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

// ==== Меню игр ====
document.querySelectorAll(".game-card:not(.locked)").forEach((card) => {
  card.addEventListener("click", () => {
    const game = card.dataset.game;
    hapticMedium();
    if (game === "crocodile") showScreen("crocoSetup");
    if (game === "sprint") { renderSprintRecord(); showScreen("sprintSetup"); }
    if (game === "alias") showScreen("aliasSetup");
  });
});

// Кнопка "В меню" на любом экране
document.querySelectorAll(".btn-back").forEach((btn) => {
  btn.addEventListener("click", () => showScreen(btn.dataset.back));
});

// ==============================
// ========= КРОКОДИЛ ===========
// ==============================
const croco = {
  difficulty: "easy",
  duration: 90,
  words: [],
  wordIndex: 0,
  timer: null,
  timeLeft: 0,
  guessed: 0,
  skipped: 0,
};

setupPills("croco-difficulty", (v) => (croco.difficulty = v));
setupPills("croco-duration", (v) => (croco.duration = v), (v) => parseInt(v, 10));

async function crocoLoadWords() {
  const r = await fetch(`/api/words?difficulty=${croco.difficulty}`);
  const data = await r.json();
  croco.words = data.words;
  croco.wordIndex = 0;
}

function crocoNextWord() {
  if (croco.wordIndex >= croco.words.length) {
    croco.words.sort(() => Math.random() - 0.5);
    croco.wordIndex = 0;
  }
  document.getElementById("word").textContent = croco.words[croco.wordIndex++];
}

function crocoUpdateTimer() {
  const el = document.getElementById("timer");
  el.textContent = croco.timeLeft;
  el.classList.remove("warn", "danger");
  if (croco.timeLeft <= 5) el.classList.add("danger");
  else if (croco.timeLeft <= 15) el.classList.add("warn");
}

function crocoStartTimer() {
  croco.timeLeft = croco.duration;
  crocoUpdateTimer();
  croco.timer = setInterval(() => {
    croco.timeLeft--;
    crocoUpdateTimer();
    if (croco.timeLeft <= 0) crocoStop();
  }, 1000);
}

async function crocoStart() {
  hapticMedium();
  await crocoLoadWords();
  croco.guessed = 0;
  croco.skipped = 0;
  document.getElementById("score-guessed").textContent = 0;
  document.getElementById("score-skipped").textContent = 0;
  showScreen("game");
  crocoNextWord();
  crocoStartTimer();
}

function crocoStop() {
  clearInterval(croco.timer);
  croco.timer = null;
  document.getElementById("result-guessed").textContent = croco.guessed;
  document.getElementById("result-skipped").textContent = croco.skipped;
  showScreen("result");
  hapticSuccess();
}

document.getElementById("btn-croco-start").addEventListener("click", crocoStart);
document.getElementById("btn-croco-again").addEventListener("click", crocoStart);
document.getElementById("btn-guessed").addEventListener("click", () => {
  croco.guessed++;
  document.getElementById("score-guessed").textContent = croco.guessed;
  hapticLight();
  crocoNextWord();
});
document.getElementById("btn-skip").addEventListener("click", () => {
  croco.skipped++;
  document.getElementById("score-skipped").textContent = croco.skipped;
  hapticLight();
  crocoNextWord();
});
document.getElementById("btn-stop").addEventListener("click", crocoStop);

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

setupPills("sprint-difficulty", (v) => { sprint.difficulty = v; renderSprintRecord(); });
setupPills("sprint-duration", (v) => { sprint.duration = v; renderSprintRecord(); }, (v) => parseInt(v, 10));

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
  const r = await fetch(`/api/questions?difficulty=${sprint.difficulty}&limit=50`);
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
    if (sprint.timeLeft <= 0) sprintFinish();
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

function sprintFinish() {
  clearInterval(sprint.timer);
  sprint.timer = null;
  const isNewRecord = saveRecord(sprint.correct);
  document.getElementById("sprint-r-correct").textContent = sprint.correct;
  document.getElementById("sprint-r-wrong").textContent = sprint.wrong;
  document.getElementById("sprint-r-best").textContent = getRecord();
  document.getElementById("sprint-new-record").style.display = isNewRecord && sprint.correct > 0 ? "block" : "none";
  showScreen("sprintResult");
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

async function aliasLoad() {
  const r = await fetch(`/api/alias?difficulty=${alias.difficulty}`);
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
  const ul = document.getElementById("alias-banned");
  ul.innerHTML = "";
  (it.banned || []).forEach((w) => {
    const li = document.createElement("li");
    li.textContent = w;
    ul.appendChild(li);
  });
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
    if (alias.timeLeft <= 0) aliasStop();
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

function aliasStop() {
  clearInterval(alias.timer);
  alias.timer = null;
  const total = alias.ok - alias.fail;
  document.getElementById("alias-r-ok").textContent = alias.ok;
  document.getElementById("alias-r-skip").textContent = alias.skip;
  document.getElementById("alias-r-fail").textContent = alias.fail;
  document.getElementById("alias-r-total").textContent = total;
  showScreen("aliasResult");
  hapticSuccess();
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

// ==== Проверка подписки: кнопка ====
document.getElementById("btn-recheck").addEventListener("click", checkSubscription);

// ==== Haptics ====
function hapticLight() { tg?.HapticFeedback?.impactOccurred?.("light"); }
function hapticMedium() { tg?.HapticFeedback?.impactOccurred?.("medium"); }
function hapticSuccess() { tg?.HapticFeedback?.notificationOccurred?.("success"); }
function hapticError() { tg?.HapticFeedback?.notificationOccurred?.("error"); }

// ==== Старт ====
loadRecordsFromCloud();
checkSubscription();
