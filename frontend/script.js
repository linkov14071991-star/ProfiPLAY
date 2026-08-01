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
  party: "screen-party",
  crocoSetup: "screen-croco-setup",
  game: "screen-game",           // игра Крокодил
  result: "screen-result",       // итоги Крокодила
  sprintSetup: "screen-sprint-setup",
  sprint: "screen-sprint",
  sprintResult: "screen-sprint-result",
  aliasSetup: "screen-alias-setup",
  alias: "screen-alias",
  aliasResult: "screen-alias-result",
  marathonSetup: "screen-marathon-setup",
  marathon: "screen-marathon",
  marathonResult: "screen-marathon-result",
  fiveSetup: "screen-five-setup",
  fiveTurn: "screen-five-turn",
  fivePlay: "screen-five-play",
  fiveResult: "screen-five-result",
  spySetup: "screen-spy-setup",
  spyPass: "screen-spy-pass",
  spyRole: "screen-spy-role",
  spyDiscuss: "screen-spy-discuss",
  spyVote: "screen-spy-vote",
  spyGuess: "screen-spy-guess",
  spyResult: "screen-spy-result",
  whoamiSetup: "screen-whoami-setup",
  whoamiTurn: "screen-whoami-turn",
  whoamiPlay: "screen-whoami-play",
  whoamiResult: "screen-whoami-result",
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

// ==== Меню игр (делегирование по клику) ====
document.body.addEventListener("click", (e) => {
  const card = e.target.closest(".game-card");
  if (!card || card.classList.contains("locked")) return;
  const game = card.dataset.game;
  if (!game) return;
  hapticMedium();
  if (game === "party") showScreen("party");
  if (game === "crocodile") showScreen("crocoSetup");
  if (game === "sprint") { renderSprintRecord(); showScreen("sprintSetup"); }
  if (game === "alias") showScreen("aliasSetup");
  if (game === "marathon") { renderMarathonRecord(); showScreen("marathonSetup"); }
  if (game === "fivesec") showScreen("fiveSetup");
  if (game === "spy") showScreen("spySetup");
  if (game === "whoami") showScreen("whoamiSetup");
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

// ==============================
// ========= МАРАФОН ============
// ==============================
const marathon = {
  difficulty: "mixed",
  lives: 5,
  questions: [],
  qIndex: 0,
  livesLeft: 5,
  correct: 0,
  streak: 0,
  bestStreak: 0,
  locked: false,
};

setupPills("marathon-difficulty", (v) => (marathon.difficulty = v));
setupPills("marathon-lives", (v) => (marathon.lives = v), (v) => parseInt(v, 10));

function marathonRecordKey() {
  return `marathon_${marathon.difficulty}_${marathon.lives}`;
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
  for (let i = 0; i < marathon.lives; i++) {
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
  const r = await fetch(`/api/marathon?difficulty=${marathon.difficulty}&limit=300`);
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
  marathon.livesLeft = marathon.lives;
  marathon.correct = 0;
  marathon.streak = 0;
  marathon.bestStreak = 0;
  document.getElementById("marathon-answered").textContent = 0;
  marathonRenderLives();
  marathonRenderStreak();
  showScreen("marathon");
  marathonRenderQ();
}

function marathonFinish(userQuit) {
  const isNew = saveMarathonRecord(marathon.correct);
  document.getElementById("marathon-r-correct").textContent = marathon.correct;
  document.getElementById("marathon-r-streak").textContent = marathon.bestStreak;
  document.getElementById("marathon-r-best").textContent = getMarathonRecord();
  document.getElementById("marathon-result-title").textContent =
    userQuit ? "🏳 Сдался" : "🏁 Марафон окончен";
  document.getElementById("marathon-new-record").style.display =
    isNew && marathon.correct > 0 ? "block" : "none";
  showScreen("marathonResult");
  hapticSuccess();
}

document.getElementById("btn-marathon-start").addEventListener("click", marathonStart);
document.getElementById("btn-marathon-again").addEventListener("click", marathonStart);
document.getElementById("btn-marathon-stop").addEventListener("click", () => marathonFinish(true));

// ==== Загрузка рекордов Марафона из облака ====
(function preloadMarathonRecords() {
  if (!tg?.CloudStorage) return;
  const keys = [];
  for (const d of ["medium", "hard", "mixed"]) {
    for (const l of [3, 5, 7]) keys.push(`marathon_${d}_${l}`);
  }
  tg.CloudStorage.getItems(keys, (err, values) => {
    if (err || !values) return;
    Object.entries(values).forEach(([k, v]) => {
      if (v) records[k] = parseInt(v, 10) || 0;
    });
  });
})();

// ==============================
// ========= 5 СЕКУНД ===========
// ==============================
const five = {
  players: 3,
  rounds: 3,
  difficulty: "easy",
  categories: [],
  catIdx: 0,
  currentPlayer: 1,
  currentRound: 1,
  scores: [],
  timer: null,
  timeLeft: 0,
  locked: false,
};

setupPills("five-players", (v) => (five.players = v), (v) => parseInt(v, 10));
setupPills("five-rounds", (v) => (five.rounds = v), (v) => parseInt(v, 10));
setupPills("five-difficulty", (v) => (five.difficulty = v));

async function fiveLoadCats() {
  const r = await fetch(`/api/categories?difficulty=${five.difficulty}&limit=100`);
  const d = await r.json();
  five.categories = d.categories;
  five.catIdx = 0;
}

async function fiveStart() {
  hapticMedium();
  await fiveLoadCats();
  five.scores = new Array(five.players).fill(0);
  five.currentPlayer = 1;
  five.currentRound = 1;
  fiveShowTurn();
}

function fiveShowTurn() {
  if (five.currentRound > five.rounds) {
    fiveShowResult();
    return;
  }
  document.getElementById("five-turn-num").textContent = `Игрок ${five.currentPlayer}`;
  showScreen("fiveTurn");
}

function fivePlay() {
  if (five.catIdx >= five.categories.length) {
    five.categories.sort(() => Math.random() - 0.5);
    five.catIdx = 0;
  }
  document.getElementById("five-category").textContent = five.categories[five.catIdx++];
  document.getElementById("five-player-badge").textContent = five.currentPlayer;
  five.locked = false;
  showScreen("fivePlay");
  fiveStartTimer();
}

function fiveStartTimer() {
  five.timeLeft = 5;
  const el = document.getElementById("five-timer");
  el.textContent = 5;
  el.classList.add("danger");
  five.timer = setInterval(() => {
    five.timeLeft--;
    el.textContent = five.timeLeft;
    if (five.timeLeft <= 0) {
      clearInterval(five.timer);
      // Время вышло — засчитываем как "не успел", если игрок ещё не нажал
      if (!five.locked) fiveResolve(false);
    }
  }, 1000);
}

function fiveResolve(success) {
  if (five.locked) return;
  five.locked = true;
  clearInterval(five.timer);
  if (success) {
    five.scores[five.currentPlayer - 1]++;
    hapticSuccess();
  } else {
    hapticError();
  }
  // Следующий игрок / круг
  five.currentPlayer++;
  if (five.currentPlayer > five.players) {
    five.currentPlayer = 1;
    five.currentRound++;
  }
  setTimeout(fiveShowTurn, 500);
}

function fiveShowResult() {
  const wrap = document.getElementById("five-score-list");
  wrap.innerHTML = "";
  const maxScore = Math.max(...five.scores);
  const list = document.createElement("div");
  list.className = "five-scores";
  five.scores.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "five-score-row";
    if (s === maxScore && maxScore > 0) row.classList.add("win");
    row.innerHTML = `<span>Игрок ${i + 1}</span><span>${s} 🏅</span>`;
    list.appendChild(row);
  });
  wrap.appendChild(list);

  const winners = five.scores
    .map((s, i) => [s, i + 1])
    .filter(([s]) => s === maxScore && maxScore > 0)
    .map(([, i]) => `Игрок ${i}`);
  document.getElementById("five-winner-note").textContent =
    winners.length ? `🏆 Победитель: ${winners.join(", ")}` : "Никто не набрал очков";
  showScreen("fiveResult");
  hapticSuccess();
}

document.getElementById("btn-five-start").addEventListener("click", fiveStart);
document.getElementById("btn-five-again").addEventListener("click", fiveStart);
document.getElementById("btn-five-ready").addEventListener("click", fivePlay);
document.getElementById("btn-five-ok").addEventListener("click", () => fiveResolve(true));
document.getElementById("btn-five-fail").addEventListener("click", () => fiveResolve(false));

// ==============================
// =========== ШПИОН ============
// ==============================
const spy = {
  players: 4,
  difficulty: "easy",
  discussTime: 180,
  spyIndex: 0,        // индекс игрока-шпиона (0..players-1)
  word: "",
  decoys: [],
  currentPlayer: 0,   // 0..players-1 при раздаче ролей
  timer: null,
  timeLeft: 0,
};

setupPills("spy-players", (v) => (spy.players = v), (v) => parseInt(v, 10));
setupPills("spy-difficulty", (v) => (spy.difficulty = v));
setupPills("spy-time", (v) => (spy.discussTime = v), (v) => parseInt(v, 10));

async function spyStart() {
  hapticMedium();
  // Получаем слово и обманки
  const r = await fetch(`/api/spy?difficulty=${spy.difficulty}`);
  const d = await r.json();
  spy.word = d.word;
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
  if (spy.currentPlayer === spy.spyIndex) {
    document.getElementById("spy-role-word").textContent = "🕵 ТЫ ШПИОН";
    document.getElementById("spy-role-note").textContent =
      "Слова ты не знаешь. Слушай других и попробуй угадать, о чём речь.";
  } else {
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
      spyShowVote();
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
}

document.getElementById("btn-spy-start").addEventListener("click", spyStart);
document.getElementById("btn-spy-again").addEventListener("click", spyStart);
document.getElementById("btn-spy-reveal").addEventListener("click", spyShowRole);
document.getElementById("btn-spy-next-player").addEventListener("click", spyNextPlayer);
document.getElementById("btn-spy-to-vote").addEventListener("click", spyShowVote);

// ==============================
// ========= КТО Я? =============
// ==============================
const whoami = {
  players: 3,
  difficulty: "easy",
  duration: 90,
  words: [],
  wIdx: 0,
  currentPlayer: 1,
  scores: [],
  ok: 0,
  skip: 0,
  timer: null,
  timeLeft: 0,
};

setupPills("whoami-players", (v) => (whoami.players = v), (v) => parseInt(v, 10));
setupPills("whoami-difficulty", (v) => (whoami.difficulty = v));
setupPills("whoami-duration", (v) => (whoami.duration = v), (v) => parseInt(v, 10));

async function whoamiLoad() {
  const r = await fetch(`/api/words?difficulty=${whoami.difficulty}`);
  const d = await r.json();
  whoami.words = d.words;
  whoami.wIdx = 0;
}

async function whoamiStart() {
  hapticMedium();
  await whoamiLoad();
  whoami.scores = new Array(whoami.players).fill(0);
  whoami.currentPlayer = 1;
  whoamiShowTurn();
}

function whoamiShowTurn() {
  if (whoami.currentPlayer > whoami.players) {
    whoamiShowResult();
    return;
  }
  document.getElementById("whoami-turn-num").textContent = `Игрок ${whoami.currentPlayer}`;
  showScreen("whoamiTurn");
}

function whoamiNextWord() {
  if (whoami.wIdx >= whoami.words.length) {
    whoami.words.sort(() => Math.random() - 0.5);
    whoami.wIdx = 0;
  }
  document.getElementById("whoami-word").textContent = whoami.words[whoami.wIdx++];
}

function whoamiUpdateTimer() {
  const el = document.getElementById("whoami-timer");
  el.textContent = whoami.timeLeft;
  el.classList.remove("warn", "danger");
  if (whoami.timeLeft <= 5) el.classList.add("danger");
  else if (whoami.timeLeft <= 15) el.classList.add("warn");
}

function whoamiPlay() {
  whoami.ok = 0;
  whoami.skip = 0;
  document.getElementById("whoami-score-ok").textContent = 0;
  document.getElementById("whoami-score-skip").textContent = 0;
  showScreen("whoamiPlay");
  whoamiNextWord();
  whoami.timeLeft = whoami.duration;
  whoamiUpdateTimer();
  whoami.timer = setInterval(() => {
    whoami.timeLeft--;
    whoamiUpdateTimer();
    if (whoami.timeLeft <= 0) whoamiEndTurn();
  }, 1000);
}

function whoamiEndTurn() {
  clearInterval(whoami.timer);
  whoami.timer = null;
  whoami.scores[whoami.currentPlayer - 1] = whoami.ok;
  whoami.currentPlayer++;
  hapticSuccess();
  whoamiShowTurn();
}

function whoamiShowResult() {
  const wrap = document.getElementById("whoami-score-list");
  wrap.innerHTML = "";
  const maxScore = Math.max(...whoami.scores);
  const list = document.createElement("div");
  list.className = "five-scores";
  whoami.scores.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "five-score-row";
    if (s === maxScore && maxScore > 0) row.classList.add("win");
    row.innerHTML = `<span>Игрок ${i + 1}</span><span>${s} ✅</span>`;
    list.appendChild(row);
  });
  wrap.appendChild(list);
  const winners = whoami.scores
    .map((s, i) => [s, i + 1])
    .filter(([s]) => s === maxScore && maxScore > 0)
    .map(([, i]) => `Игрок ${i}`);
  document.getElementById("whoami-winner-note").textContent =
    winners.length ? `🏆 Победитель: ${winners.join(", ")}` : "Никто не угадал";
  showScreen("whoamiResult");
  hapticSuccess();
}

document.getElementById("btn-whoami-start").addEventListener("click", whoamiStart);
document.getElementById("btn-whoami-again").addEventListener("click", whoamiStart);
document.getElementById("btn-whoami-ready").addEventListener("click", whoamiPlay);
document.getElementById("btn-whoami-ok").addEventListener("click", () => {
  whoami.ok++;
  document.getElementById("whoami-score-ok").textContent = whoami.ok;
  hapticLight();
  whoamiNextWord();
});
document.getElementById("btn-whoami-skip").addEventListener("click", () => {
  whoami.skip++;
  document.getElementById("whoami-score-skip").textContent = whoami.skip;
  hapticLight();
  whoamiNextWord();
});
document.getElementById("btn-whoami-stop").addEventListener("click", whoamiEndTurn);

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
