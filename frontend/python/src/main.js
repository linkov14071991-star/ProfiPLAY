// main.js — Python-курс. Роутер и состояние.

import { sound } from './audio/sound_engine.js';
import { cloud } from './state/cloud_storage.js';
import { telemetry } from './telemetry/client.js';
import { Onboarding } from './onboarding.js';
import { TreeScreen } from './tree.js';
import { LessonPlayer } from './lesson.js';
import { TheoryScreen } from './theory_screen.js';
import { VideosScreen } from './videos_screen.js';
import { CURRICULUM, findLesson, findUnit } from './curriculum/index.js';
import { THEORY } from './curriculum/theory.js';
import { buildDaily, todayKey } from './daily.js';
import { buildWeekly, weekKey, currentWeeklyPlan } from './weekly.js';
import { profikMessage, buildReview } from './profik.js';
import { readiness, readinessLabel, readinessColor } from './readiness.js';
import { buildPlan, buildBugFix } from './plan.js';
import { ProjectsScreen } from './projects_screen.js';
import { PROJECTS } from './curriculum/projects.js';

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
  videos: document.getElementById('s-videos'),
  projects: document.getElementById('s-projects'),
  projectDone: document.getElementById('s-project-done'),
  result: document.getElementById('s-result'),
};
const els = {
  onboardWrap: document.getElementById('onboard-wrap'),
  treeUnits: document.getElementById('tree-units'),
  treeBack: document.getElementById('tree-back'),
  statStreak: document.getElementById('stat-streak'),
  statXp: document.getElementById('stat-xp'),
  planCard: document.getElementById('plan-card'),
  projectsCard: document.getElementById('projects-card'),
  readinessCard: document.getElementById('readiness-card'),
  // projects screens
  projectsScroll: document.getElementById('projects-scroll'),
  projectsBack: document.getElementById('projects-back'),
  projdoneWrap: document.getElementById('projdone-wrap'),
  profikBanner: document.getElementById('profik-banner'),
  dailyCard: document.getElementById('daily-card'),
  weeklyCard: document.getElementById('weekly-card'),
  videosCard: document.getElementById('videos-card'),
  // videos screen
  videosScroll: document.getElementById('videos-scroll'),
  videosPlayer: document.getElementById('videos-player'),
  videosBack: document.getElementById('videos-back'),
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
  topicStats: {},         // unitId -> { correct, total } для памяти Профика
  reviewStats: { correct: 0, total: 0 },  // повторения (стабильность)
  speedStats: { count: 0, totalMs: 0 },   // скорость ответов
  bossStats: { correct: 0, total: 0 },    // задачи-боссы ЕГЭ
  planDone: { day: null, ids: [] },       // выполненные пункты плана за день
  projectsBuilt: new Set(),                // id собранных мини-проектов
  xp: 0,
  streak: 0,
  lastActiveDay: null,
  dailyDoneDay: null,
  weeklyDoneKey: null,    // ISO-неделя пройденного теста недели
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
    state.topicStats = saved.topicStats || {};
    state.reviewStats = saved.reviewStats || { correct: 0, total: 0 };
    state.speedStats = saved.speedStats || { count: 0, totalMs: 0 };
    state.bossStats = saved.bossStats || { correct: 0, total: 0 };
    state.planDone = saved.planDone || { day: null, ids: [] };
    state.projectsBuilt = new Set(saved.projectsBuilt || []);
    state.xp = saved.xp || 0;
    state.streak = saved.streak || 0;
    state.lastActiveDay = saved.lastActiveDay || null;
    state.dailyDoneDay = saved.dailyDoneDay || null;
    state.weeklyDoneKey = saved.weeklyDoneKey || null;
  }
}
async function saveState() {
  await cloud.setJson('pycourse.state', {
    profile: state.profile,
    done: [...state.done],
    crowns: state.crowns,
    theorySeen: [...state.theorySeen],
    topicStats: state.topicStats,
    reviewStats: state.reviewStats,
    speedStats: state.speedStats,
    bossStats: state.bossStats,
    planDone: state.planDone,
    projectsBuilt: [...state.projectsBuilt],
    xp: state.xp,
    streak: state.streak,
    lastActiveDay: state.lastActiveDay,
    dailyDoneDay: state.dailyDoneDay,
    weeklyDoneKey: state.weeklyDoneKey,
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
const tree = new TreeScreen(els.treeUnits, requestLesson, openDaily, openTheory);

function goToTree() {
  show('tree');
  els.statStreak.textContent = `🔥 ${state.streak}`;
  els.statXp.textContent = `⭐ ${state.xp}`;
  renderPlanCard();
  renderReadinessCard();
  renderProfikBanner();
  renderWeeklyCard();
  renderDailyCard();
  renderProjectsCard();
  renderVideosCard();
  tree.render({ done: state.done, crowns: state.crowns });
}

function planDoneToday() {
  if (state.planDone.day !== todayKey()) state.planDone = { day: todayKey(), ids: [] };
  return state.planDone.ids;
}

function renderPlanCard() {
  const items = buildPlan(state);
  if (items.length === 0) { els.planCard.classList.add('hidden'); return; }
  const doneIds = planDoneToday();
  els.planCard.classList.remove('hidden');
  const doneCount = items.filter(i => doneIds.includes(i.id)).length;
  const allDone = doneCount === items.length;

  let html = `<div class="plan-header">
    <div class="plan-title">🎯 План на сегодня</div>
    <div class="plan-count">${doneCount} / ${items.length}</div>
  </div>`;
  if (allDone) {
    html += `<div class="plan-done-all">Всё выполнено! Отличный день 🎉</div>`;
  }
  for (const it of items) {
    const done = doneIds.includes(it.id);
    html += `<div class="plan-item${done ? ' done' : ''}" data-id="${it.id}">
      <div class="pi-icon">${it.icon}</div>
      <div class="pi-body">
        <div class="pi-text">${escapeHtml(it.text)}</div>
        <div class="pi-sub">${escapeHtml(it.sub)}</div>
      </div>
      <div class="pi-check">${done ? '✓' : '›'}</div>
    </div>`;
  }
  els.planCard.innerHTML = html;

  els.planCard.querySelectorAll('.plan-item').forEach(el => {
    el.addEventListener('click', () => {
      const it = items.find(x => x.id === el.dataset.id);
      if (!it) return;
      markPlanDone(it.id);
      sound.play('button_tap');
      dispatchPlanAction(it.action);
    });
  });
}

function markPlanDone(id) {
  const ids = planDoneToday();
  if (!ids.includes(id)) { ids.push(id); saveState(); }
}

function dispatchPlanAction(action) {
  switch (action.type) {
    case 'review': openReview(action.unitId); break;
    case 'daily': openDaily(); break;
    case 'bugfix': openBugFix(); break;
    case 'boss': requestLesson(findUnit(action.unitId).lessons[0].id); break;
    case 'video': openTheory(action.unitId); break;
  }
}

function renderReadinessCard() {
  const r = readiness(state);
  if (!r.hasData) { els.readinessCard.classList.add('hidden'); return; }
  els.readinessCard.classList.remove('hidden');
  const color = readinessColor(r.total);
  const rows = r.components.map(c => {
    const w = c.has ? c.value : 0;
    const valTxt = c.has ? `${c.value}%` : '—';
    return `<div class="rd-row">
      <div class="rd-label">${c.label} · ${c.weight}%</div>
      <div class="rd-bar"><div class="rd-fill" style="width:${w}%;background:${color}"></div></div>
      <div class="rd-val${c.has ? '' : ' empty'}">${valTxt}</div>
    </div>`;
  }).join('');
  els.readinessCard.innerHTML = `
    <div class="readiness-top">
      <div class="readiness-ring" style="background:conic-gradient(${color} ${r.total * 3.6}deg, #2a3040 0)">
        <div style="width:44px;height:44px;border-radius:50%;background:#1a1f2b;display:flex;align-items:center;justify-content:center;color:${color}">${r.total}</div>
      </div>
      <div class="readiness-info">
        <div class="readiness-title">Готовность к экзамену</div>
        <div class="readiness-sub">${escapeHtml(readinessLabel(r.total))}</div>
      </div>
      <div class="readiness-arrow" id="rd-arrow">▾</div>
    </div>
    <div class="readiness-detail" id="rd-detail">${rows}</div>
  `;
  els.readinessCard.onclick = () => {
    const d = els.readinessCard.querySelector('#rd-detail');
    const a = els.readinessCard.querySelector('#rd-arrow');
    d.classList.toggle('open');
    a.textContent = d.classList.contains('open') ? '▴' : '▾';
    sound.play('button_tap');
  };
}

function renderProfikBanner() {
  const msg = profikMessage(state, todayKey(), shiftDay);
  els.profikBanner.classList.remove('hidden');
  els.profikBanner.innerHTML = `
    <div class="pb-cat">🐱</div>
    <div class="pb-body">
      <div class="pb-text">${escapeHtml(msg.text)}</div>
      ${msg.action ? `<button class="pb-action" id="pb-action">${
        msg.action.type === 'review' ? 'Повторить тему' :
        msg.action.type === 'daily' ? 'Начать повторение' : 'Поехали'
      }</button>` : ''}
    </div>
  `;
  if (msg.action) {
    els.profikBanner.querySelector('#pb-action').onclick = () => {
      sound.play('button_tap');
      if (msg.action.type === 'review') openReview(msg.action.unitId);
      else if (msg.action.type === 'daily') openDaily();
    };
  }
}

function renderWeeklyCard() {
  const plan = currentWeeklyPlan();
  const doneThisWeek = state.weeklyDoneKey === weekKey();
  els.weeklyCard.classList.remove('hidden');
  els.weeklyCard.innerHTML = `
    <div class="wk-icon">${doneThisWeek ? '✅' : '🏆'}</div>
    <div style="flex:1;">
      <div class="wk-title">Тест недели: ${escapeHtml(plan.title)}</div>
      <div class="wk-sub">${doneThisWeek ? 'Пройден! Новый — в понедельник' : '12 вопросов · +40 XP'}</div>
    </div>
  `;
  els.weeklyCard.onclick = doneThisWeek ? null : () => { sound.play('button_tap'); openWeekly(); };
}

function renderVideosCard() {
  els.videosCard.innerHTML = `
    <div class="vc-icon">🎬</div>
    <div style="flex:1;">
      <div class="vc-title">Видео-марафон Py.Go</div>
      <div class="vc-sub">25 видеоуроков от простого к сложному</div>
    </div>
    <div class="vc-arrow">›</div>
  `;
  els.videosCard.onclick = () => { sound.play('button_tap'); openVideos(); };
}

function renderProjectsCard() {
  const built = PROJECTS.filter(p => state.projectsBuilt.has(p.id)).length;
  els.projectsCard.innerHTML = `
    <div class="pjc-icon">🛠</div>
    <div style="flex:1;">
      <div class="pjc-title">Мини-проекты</div>
      <div class="pjc-sub">Собери настоящую программу · ${built}/${PROJECTS.length} собрано</div>
    </div>
    <div class="pjc-arrow">›</div>
  `;
  els.projectsCard.onclick = () => { sound.play('button_tap'); openProjects(); };
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

// ── Theory ──
const theoryScreen = new TheoryScreen({
  scroll: els.theoryScroll, htitle: els.theoryHtitle, back: els.theoryBack, start: els.theoryStart,
});
theoryScreen.bind();

// ── Videos ──
const videosScreen = new VideosScreen({
  scroll: els.videosScroll, player: els.videosPlayer, back: els.videosBack,
});
videosScreen.bind();

function openVideos() {
  show('videos');
  videosScreen.show({ onBack: goToTree });
}

// ── Projects ──
const projectsScreen = new ProjectsScreen({
  scroll: els.projectsScroll, back: els.projectsBack, doneWrap: els.projdoneWrap,
});
projectsScreen.bindBack();

let activeProject = null;

function isProjectUnlocked(p) {
  const unit = findUnit(p.unlockAfter);
  if (!unit) return true;
  return unit.lessons.some(l => state.done.has(l.id));  // хотя бы один урок темы пройден
}

function openProjects() {
  show('projects');
  projectsScreen.showList({
    builtSet: state.projectsBuilt,
    isUnlocked: isProjectUnlocked,
    onBack: goToTree,
    onOpen: startProject,
  });
}

function startProject(project) {
  activeProject = project;
  activeMode = 'project';
  const lesson = { id: 'project_' + project.id, title: project.title, xp: 25, questions: project.steps };
  show('lesson');
  player.start(lesson, { onComplete: onProjectComplete, onQuit: openProjects });
}

async function onProjectComplete(result) {
  if (result.success && activeProject) {
    state.projectsBuilt.add(activeProject.id);
    state.xp += 25;
    touchStreak();
    await saveState();
    show('projectDone');
    projectsScreen.showDone(activeProject, { onNext: openProjects });
  } else {
    // не собрал — вернуть к списку
    openProjects();
  }
}

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
    <p>Перед заданиями по теме «${escapeHtml(unit.title)}» можно освежить материал${(THEORY[unitId].videos || []).length ? ' и посмотреть видео' : ''}. Это не обязательно.</p>
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
  activeMode = 'lesson';
  show('lesson');
  player.start(lesson, { onComplete: onLessonComplete, onQuit: goToTree });
}

let activeMode = 'lesson';  // 'lesson' | 'daily' | 'weekly' | 'review'
let activeReviewUnit = null;

function openDaily() {
  const daily = buildDaily(state.done);
  if (!daily) return;
  activeMode = 'daily';
  show('lesson');
  player.start(daily, { onComplete: onLessonComplete, onQuit: goToTree });
}

function openWeekly() {
  const weekly = buildWeekly();
  if (!weekly) return;
  activeMode = 'weekly';
  show('lesson');
  player.start(weekly, { onComplete: onLessonComplete, onQuit: goToTree });
}

function openReview(unitId) {
  const review = buildReview(unitId);
  if (!review) return;
  activeMode = 'review';
  activeReviewUnit = unitId;
  show('lesson');
  player.start(review, { onComplete: onLessonComplete, onQuit: goToTree });
}

function openBugFix() {
  const lesson = buildBugFix(state);
  if (!lesson) return;
  activeMode = 'bugfix';
  show('lesson');
  player.start(lesson, { onComplete: onLessonComplete, onQuit: goToTree });
}

// Обновить статистику по теме (память Профика)
function updateTopicStats(unitId, correct, total) {
  if (!unitId || !total) return;
  const s = state.topicStats[unitId] || { correct: 0, total: 0 };
  s.correct += correct;
  s.total += total;
  state.topicStats[unitId] = s;
}

async function onLessonComplete(result) {
  if (result.success) {
    touchStreak();
    state.xp += result.xp;
    // скорость (для индекса готовности)
    if (result.answerCount) {
      state.speedStats.count += result.answerCount;
      state.speedStats.totalMs += result.answerTimeMs || 0;
    }
    if (activeMode === 'daily' || activeMode === 'weekly' || activeMode === 'review' || activeMode === 'bugfix') {
      // повторения = стабильность
      state.reviewStats.correct += result.correctCount || 0;
      state.reviewStats.total += result.totalCount || 0;
      if (activeMode === 'daily') state.dailyDoneDay = todayKey();
      else if (activeMode === 'weekly') state.weeklyDoneKey = weekKey();
      else if (activeMode === 'review') updateTopicStats(activeReviewUnit, result.correctCount, result.totalCount);
    } else {
      state.done.add(result.lessonId);
      state.crowns[result.lessonId] = Math.max(state.crowns[result.lessonId] || 0, result.accuracy);
      const lesson = findLesson(result.lessonId);
      if (lesson) {
        updateTopicStats(lesson.unitId, result.correctCount, result.totalCount);
        // задачи-боссы ЕГЭ отдельно
        const unit = findUnit(lesson.unitId);
        if (unit && unit.isBoss) {
          state.bossStats.correct += result.correctCount || 0;
          state.bossStats.total += result.totalCount || 0;
        }
      }
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
      // повтор того же
      if (activeMode === 'daily') openDaily();
      else if (activeMode === 'weekly') openWeekly();
      else if (activeMode === 'bugfix') openBugFix();
      else if (activeMode === 'review') openReview(activeReviewUnit);
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
