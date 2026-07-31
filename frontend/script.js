// ==== Telegram WebApp init ====
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

// ==== Экраны ====
const screens = {
  check: document.getElementById("screen-check"),
  needSub: document.getElementById("screen-need-sub"),
  home: document.getElementById("screen-home"),
  game: document.getElementById("screen-game"),
  result: document.getElementById("screen-result"),
};
function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
}

// ==== Состояние ====
const state = {
  difficulty: "easy",
  duration: 90,
  words: [],
  wordIndex: 0,
  timer: null,
  timeLeft: 0,
  guessed: 0,
  skipped: 0,
};

// ==== Проверка подписки ====
async function checkSubscription() {
  const userId = tg?.initDataUnsafe?.user?.id;

  // Локальная отладка вне Telegram — сразу пускаем
  if (!userId) {
    showScreen("home");
    return;
  }

  try {
    const r = await fetch(`/api/check_subscription?user_id=${userId}`);
    const data = await r.json();
    if (data.subscribed) {
      showScreen("home");
    } else {
      showScreen("needSub");
    }
  } catch (e) {
    // Если сервер недоступен — тоже показываем игру, чтобы не блокировать
    showScreen("home");
  }
}

// ==== Pills (выбор) ====
function setupPills(containerId, key, cast = (v) => v) {
  const container = document.getElementById(containerId);
  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".pill");
    if (!btn) return;
    container.querySelectorAll(".pill").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    state[key] = cast(btn.dataset.value);
    hapticLight();
  });
}
setupPills("pills-difficulty", "difficulty");
setupPills("pills-duration", "duration", (v) => parseInt(v, 10));

// ==== Загрузка слов ====
async function loadWords() {
  const r = await fetch(`/api/words?difficulty=${state.difficulty}`);
  const data = await r.json();
  state.words = data.words;
  state.wordIndex = 0;
}

// ==== Игровой цикл ====
function nextWord() {
  if (state.wordIndex >= state.words.length) {
    // Слова кончились — перемешиваем заново
    state.words.sort(() => Math.random() - 0.5);
    state.wordIndex = 0;
  }
  document.getElementById("word").textContent = state.words[state.wordIndex];
  state.wordIndex++;
}

function startTimer() {
  state.timeLeft = state.duration;
  updateTimerUI();
  state.timer = setInterval(() => {
    state.timeLeft--;
    updateTimerUI();
    if (state.timeLeft <= 0) {
      stopRound();
    }
  }, 1000);
}

function updateTimerUI() {
  const el = document.getElementById("timer");
  el.textContent = state.timeLeft;
  el.classList.remove("warn", "danger");
  if (state.timeLeft <= 5) el.classList.add("danger");
  else if (state.timeLeft <= 15) el.classList.add("warn");
}

async function startRound() {
  hapticMedium();
  await loadWords();
  state.guessed = 0;
  state.skipped = 0;
  document.getElementById("score-guessed").textContent = 0;
  document.getElementById("score-skipped").textContent = 0;
  showScreen("game");
  nextWord();
  startTimer();
}

function stopRound() {
  clearInterval(state.timer);
  state.timer = null;
  document.getElementById("result-guessed").textContent = state.guessed;
  document.getElementById("result-skipped").textContent = state.skipped;
  showScreen("result");
  hapticSuccess();
}

// ==== Действия в игре ====
document.getElementById("btn-guessed").addEventListener("click", () => {
  state.guessed++;
  document.getElementById("score-guessed").textContent = state.guessed;
  hapticLight();
  nextWord();
});

document.getElementById("btn-skip").addEventListener("click", () => {
  state.skipped++;
  document.getElementById("score-skipped").textContent = state.skipped;
  hapticLight();
  nextWord();
});

document.getElementById("btn-stop").addEventListener("click", stopRound);
document.getElementById("btn-start").addEventListener("click", startRound);
document.getElementById("btn-again").addEventListener("click", startRound);
document.getElementById("btn-home").addEventListener("click", () => showScreen("home"));
document.getElementById("btn-recheck").addEventListener("click", checkSubscription);

// ==== Haptics ====
function hapticLight() { tg?.HapticFeedback?.impactOccurred?.("light"); }
function hapticMedium() { tg?.HapticFeedback?.impactOccurred?.("medium"); }
function hapticSuccess() { tg?.HapticFeedback?.notificationOccurred?.("success"); }

// ==== Старт ====
checkSubscription();
