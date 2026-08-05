// main.js — Python-курс. Роутер и состояние.

import { sound } from './audio/sound_engine.js';
import { cloud } from './state/cloud_storage.js';
import { telemetry } from './telemetry/client.js';
import { Onboarding } from './onboarding.js';
import { TreeScreen } from './tree.js';
import { LessonPlayer } from './lesson.js';
import { TheoryScreen } from './theory_screen.js';
import { CURRICULUM, findLesson, findUnit } from './curriculum/index.js';
import { THEORY } from './curriculum/theory.js';
import { buildDaily, todayKey } from './daily.js';

const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}

// ── DOM ──
const screens = {
  onboard: document.getElementById('s-onboard'),
  tree: document.getElementById('s-tree'),
  lesson: document.getElementById('s-lesson'),
  theory: document.getElementById('s-theory'),
  result: document.getElementById('s-result'),
};
const els = {
  onboardWrap: document.getElementById('onboard-wrap'),
  treeScroll: document.getElementById('tree-scroll'),
  treeBack: document.getElementById('tree-back'),
  statStreak: document.getElementById('stat-streak'),
  statXp: document.getElementById('stat-xp'),
  dailyCard: document.getElementById('daily-card'),
  // lesson
  lessonBody: document.getElementById('lesson-body'),
  lessonFooter: document.getElementById('lesson-footer'),
  checkBtn: document.getElementById('check-btn'),
  progressFill: document.getElementById('progress-fill'),
  hearts: document.getElementById('hearts'),
  lessonQuit: document.getElementById('lesson-quit'),
  feedback: document.getElementById('feedback'),
  feedbackHead: document.getElementById('feedback-head'),
  feedbackExplain: document.getElementById('feedback-explain'),
  continueBtn: document.getElementById('continue-btn'),
  // theory
  theoryScroll: document.getElementById('theory-scroll'),
  theoryHtitle: document.getElementById('theory-htitle'),
  theoryBack: document.getElementById('theory-back'),
  theoryStart: document.getElementById('theory-start'),
  // result
  resultWrap: document.getElementById('result-wrap'),
};

// ── state ──
let state = {
  profile: null,          // { goal, experience, startUnitIndex }
  done: new Set(),        // пройденные lessonId
  crowns: {},             // lessonId -> accuracy
  theorySeen: new Set(),  // unitId с прочитанной теорией
  xp: 0,
  streak: 0,
  lastActiveDay: null,
  dailyDoneDay: null,
};

// ── init sound on gesture ──
document.addEventListener('pointerdown', async () => {
  await sound.init(); await sound.resume();
}, { once: true });

telemetry.init(tg?.initDataUnsafe?.user?.id ?? 0);

// ── screens helper ──
function show(name) {
  for (const k of Object.keys(screens)) screens[k].classList.toggle('hidden', k !== name);
}

// ── persistence ──
async function loadState() {
  const saved = await cloud.getJson('pycourse.state', null);
  if (saved) {
    state.profile = saved.profile || null;
    state.done = new Set(saved.done || []);
    state.crowns = saved.crowns || {};
    state.theorySeen = new Set(saved.theorySeen || []);
    state.xp = saved.xp || 0;
    state.streak = saved.streak || 0;
    state.lastActiveDay = saved.lastActiveDay || null;
    state.dailyDoneDay = saved.dailyDoneDay || null;
  }
}
async function saveState() {
  await cloud.setJson('pycourse.state', {
    profile: state.profile,
    done: [...state.done],
    crowns: state.crowns,
    theorySeen: [...state.theorySeen],
    xp: state.xp,
    streak: state.streak,
    lastActiveDay: state.lastActiveDay,
    dailyDoneDay: state.dailyDoneDay,
  });
}

// ── streak ──
function touchStreak() {
  const today = todayKey();
  if (state.lastActiveDay === today) return;
  const yesterday = shiftDay(today, -1);
  if (state.lastActiveDay === yesterday) state.streak += 1;
  else state.streak = 1;
  state.lastActiveDay = today;
}
function shiftDay(key, delta) {
  const d = new Date(key + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

// ── Onboarding ──
const onboarding = new Onboarding(els.onboardWrap, tg);

function startOnboarding() {
  show('onboard');
  onboarding.start(async (profile) => {
    state.profile = profile;
    // Пометим все уроки в юнитах ДО стартового как пройденные (по рекомендации теста)
    if (profile.startUnitIndex > 0) {
      for (let i = 0; i < profile.startUnitIndex; i++) {
        for (const l of CURRICULUM[i].lessons) state.done.add(l.id);
      }
    }
    await saveState();
    goToTree();
  });
}

// ── Tree ──
const tree = new TreeScreen(els.treeScroll, requestLesson, openDaily, openTheory);

function goToTree() {
  show('tree');
  els.statStreak.textContent = `🔥 ${state.streak}`;
  els.statXp.textContent = `⭐ ${state.xp}`;
  renderDailyCard();
  tree.render({ done: state.done, crowns: state.crowns });
}

function renderDailyCard() {
  const daily = buildDaily(state.done);
  if (!daily) { els.dailyCard.classList.add('hidden'); return; }
  const doneToday = state.dailyDoneDay === todayKey();
  els.dailyCard.classList.remove('hidden');
  els.dailyCard.innerHTML = `
    <div class="daily-icon">${doneToday ? '✅' : '🔥'}</div>
    <div style="flex:1;">
      <div class="daily-title">${doneToday ? 'Повторение пройдено!' : 'Ежедневное повторение'}</div>
      <div class="daily-sub">${doneToday ? 'Возвращайся завтра за серией' : `${daily.questions.length} вопросов · +${daily.xp} XP`}</div>
    </div>
  `;
  els.dailyCard.onclick = doneToday ? null : () => { sound.play('button_tap'); openDaily(); };
}

// ── Lesson ──
const player = new LessonPlayer(els, tg);

els.checkBtn.addEventListener('click', () => player.check());
els.continueBtn.addEventListener('click', () => player.continue());
els.lessonQuit.addEventListener('click', () => {
  if (confirm('Выйти из урока? Прогресс урока не сохранится.')) player.quit();
});

let activeDailyLesson = null;

// ── Theory ──
const theoryScreen = new TheoryScreen({
  scroll: els.theoryScroll, htitle: els.theoryHtitle, back: els.theoryBack, start: els.theoryStart,
});
theoryScreen.bind();

let theoryReturnLessonId = null;  // куда идти после «Перейти к заданиям»

function openTheory(unitId, startLessonId = null) {
  const unit = findUnit(unitId);
  if (!unit) return;
  theoryReturnLessonId = startLessonId;
  show('theory');
  theoryScreen.show(unit, {
    onStart: async () => {
      state.theorySeen.add(unitId);
      await saveState();
      if (theoryReturnLessonId) openLesson(theoryReturnLessonId);
      else goToTree();
    },
    onBack: async () => {
      state.theorySeen.add(unitId);
      await saveState();
      goToTree();
    },
  });
}

// Перед открытием урока — если это первый урок юнита и теорию не читали, предложить
function requestLesson(lessonId) {
  const lesson = findLesson(lessonId);
  if (!lesson) return;
  const unit = findUnit(lesson.unitId);
  const isFirstLessonOfUnit = unit && unit.lessons[0].id === lessonId;
  const hasTheory = !!THEORY[lesson.unitId];
  const notSeen = !state.theorySeen.has(lesson.unitId);

  if (isFirstLessonOfUnit && hasTheory && notSeen) {
    showTheoryOffer(lesson.unitId, lessonId);
  } else {
    openLesson(lessonId);
  }
}

function showTheoryOffer(unitId, lessonId) {
  const unit = findUnit(unitId);
  const offer = document.createElement('div');
  offer.className = 'theory-offer';
  offer.innerHTML = `
    <h3>📖 Сначала теория?</h3>
    <p>Перед заданиями по теме «${escapeHtml(unit.title)}» можно освежить материал${THEORY[unitId].videoIndex ? ' и посмотреть видео' : ''}. Это не обязательно.</p>
    <div class="offer-btns">
      <button class="offer-primary" id="offer-yes">Изучить теорию</button>
      <button class="offer-secondary" id="offer-no">Сразу к заданиям</button>
    </div>
  `;
  document.getElementById('app').appendChild(offer);
  offer.querySelector('#offer-yes').onclick = () => { sound.play('button_tap'); offer.remove(); openTheory(unitId, lessonId); };
  offer.querySelector('#offer-no').onclick = () => { sound.play('button_tap'); offer.remove(); openLesson(lessonId); };
}

function openLesson(lessonId) {
  const lesson = findLesson(lessonId);
  if (!lesson) return;
  activeDailyLesson = null;
  show('lesson');
  player.start(lesson, { onComplete: onLessonComplete, onQuit: goToTree });
}

function openDaily() {
  const daily = buildDaily(state.done);
  if (!daily) return;
  activeDailyLesson = daily;
  show('lesson');
  player.start(daily, { onComplete: onLessonComplete, onQuit: goToTree });
}

async function onLessonComplete(result) {
  if (result.success) {
    touchStreak();
    state.xp += result.xp;
    if (activeDailyLesson) {
      state.dailyDoneDay = todayKey();
    } else {
      state.done.add(result.lessonId);
      state.crowns[result.lessonId] = Math.max(state.crowns[result.lessonId] || 0, result.accuracy);
    }
    await saveState();
    syncBackend(result);
  }
  showResult(result);
}

// ── Result ──
function showResult(result) {
  show('result');
  const cat = result.success ? '🎉' : '😿';
  const title = result.success ? 'Урок пройден!' : 'Почти получилось';
  if (result.success) { sound.play('correct'); tg?.HapticFeedback?.notificationOccurred?.('success'); }

  els.resultWrap.innerHTML = `
    <div class="result-cat">${cat}</div>
    <div class="result-title">${title}</div>
    <div class="result-stats">
      <div class="result-stat"><div class="rs-val">+${result.xp}</div><div class="rs-lbl">XP</div></div>
      <div class="result-stat"><div class="rs-val">${result.accuracy}%</div><div class="rs-lbl">точность</div></div>
      <div class="result-stat"><div class="rs-val">🔥 ${state.streak}</div><div class="rs-lbl">серия</div></div>
    </div>
    <button class="result-cta" id="result-continue">${result.success ? 'Продолжить' : 'Попробовать снова'}</button>
  `;
  els.resultWrap.querySelector('#result-continue').onclick = () => {
    sound.play('button_tap');
    if (result.success) goToTree();
    else {
      // повтор того же урока
      if (activeDailyLesson) openDaily();
      else openLesson(result.lessonId);
    }
  };
}

// ── backend sync (best-effort) ──
async function syncBackend(result) {
  try {
    await fetch('/api/python/session_end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        init_data: tg?.initData || '',
        lessonId: result.lessonId,
        xpEarned: result.xp,
        accuracy: result.accuracy,
      }),
    });
  } catch (e) { /* offline — не страшно */ }
}

// ── back button ──
els.treeBack.addEventListener('click', () => {
  telemetry.flush();
  window.location.href = '../index.html';
});

// ── boot ──
(async () => {
  await loadState();
  if (state.profile) goToTree();
  else startOnboarding();
})();
