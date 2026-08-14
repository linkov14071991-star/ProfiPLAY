// main.js — Python-курс. Роутер и состояние.

import { sound } from './audio/sound_engine.js';
import { cloud } from './state/cloud_storage.js';
import { telemetry } from './telemetry/client.js';
import { Onboarding } from './onboarding.js?v=2';
import { TreeScreen } from './tree.js';
import { LessonPlayer } from './lesson.js';
import { TheoryScreen } from './theory_screen.js';
import { VideosScreen } from './videos_screen.js';
import { CURRICULUM, findLesson, findUnit, FIRST_EGE_UNIT_INDEX } from './curriculum/index.js';
import { THEORY } from './curriculum/theory.js';
import { buildDaily, todayKey } from './daily.js';
import { buildWeekly, weekKey, currentWeeklyPlan } from './weekly.js';
import { profikMessage, buildReview, weakestTopic, strongestTopic } from './profik.js';
import { readiness, readinessLabel, readinessColor, projectMastery } from './readiness.js';
import { buildPlan, buildBugFix, planReadinessGain } from './plan.js';
import { CHANNEL_URL, IGOR_MISTAKES, IDENTITY, CHANNEL_HINTS, CHANNEL_CONTINUE, EXPERT_NOTES, MASTERY, ADAPTIVE, daysToExam, tomorrowHook } from './mentor.js';
import { openYouTube } from './ui/youtube.js';
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
  heroCard: document.getElementById('hero-card'),
  planCard: document.getElementById('plan-card'),
  progressCard: document.getElementById('progress-card'),
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
  bossIntroSeen: new Set(),  // unitId боссов с показанной экспертной заметкой
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
  weekSolved: { week: null, count: 0 },   // решено заданий на текущей неделе
  readinessSnap: null,    // { week, value } — снимок готовности прошлой недели (для дельты)
  hadFlawless: false,     // был ли хоть один идеальный урок (для «первый идеальный»)
  lastLessonSec: null,    // длительность прошлого урока (для «быстрее, чем в прошлый раз»)
  masteryShown: [],       // показанные вехи роста мастерства
  firstOpenDay: null,     // первый день использования (для когорт/воронки)
  lastOpenDay: null,      // прошлый день открытия (для D1/D7)
};

// ── init sound on gesture ──
document.addEventListener('pointerdown', async () => {
  await sound.init(); await sound.resume();
}, { once: true });

telemetry.init(tg?.initDataUnsafe?.user?.id ?? 0);

// ── screens helper ──
function show(name) {
  for (const k of Object.keys(screens)) screens[k].classList.toggle('hidden', k !== name);
  if (name === 'tree') { try { renderPyLeaderboard(); } catch (e) {} }
}

// ── Таблица лучших курса (общий тотал / за неделю), данные из основного бэкенда ──
async function renderPyLeaderboard() {
  const card = document.getElementById('py-lb-card');
  if (!card) return;
  card.classList.remove('hidden');
  if (!card.dataset.init) {
    card.dataset.init = '1';
    card.innerHTML =
      '<div class="py-lb-head">🏆 Лучшие в курсе</div>' +
      '<div class="py-lb-tabs">' +
      '<button class="py-lb-tab active" data-period="all">За всё время</button>' +
      '<button class="py-lb-tab" data-period="week">За неделю</button>' +
      '</div><div class="py-lb-list" id="py-lb-list"></div>';
    card.querySelectorAll('.py-lb-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        card.querySelectorAll('.py-lb-tab').forEach((t) => t.classList.remove('active'));
        tab.classList.add('active');
        pyLoadLeaderboard(tab.dataset.period);
      });
    });
  }
  const active = card.querySelector('.py-lb-tab.active');
  pyLoadLeaderboard(active ? active.dataset.period : 'all');
}
async function pyLoadLeaderboard(period) {
  const el = document.getElementById('py-lb-list');
  if (!el) return;
  el.innerHTML = '<div class="py-lb-empty">Загрузка…</div>';
  try {
    const r = await fetch('/api/leaderboard/game?game=python&period=' + period + '&limit=10');
    const d = await r.json();
    const leaders = d.leaders || [];
    if (!leaders.length) { el.innerHTML = '<div class="py-lb-empty">Пока пусто — будь первым!</div>'; return; }
    el.innerHTML = leaders.map((l) => {
      const nm = String(l.name || '').replace(/[<>&]/g, '');
      return '<div class="py-lb-row' + (l.place <= 3 ? ' top' : '') + '">' +
             '<span class="py-lb-place">' + l.place + '</span>' +
             '<span class="py-lb-name">' + nm + '</span>' +
             '<span class="py-lb-score">' + l.score + '</span></div>';
    }).join('');
  } catch (e) { el.innerHTML = '<div class="py-lb-empty">Не удалось загрузить</div>'; }
}

// ── persistence ──
async function loadState() {
  const saved = await cloud.getJsonBest('pycourse.state', null);
  if (saved) {
    state.profile = saved.profile || null;
    state.done = new Set(saved.done || []);
    state.crowns = saved.crowns || {};
    state.theorySeen = new Set(saved.theorySeen || []);
    state.bossIntroSeen = new Set(saved.bossIntroSeen || []);
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
    state.weekSolved = saved.weekSolved || { week: null, count: 0 };
    state.readinessSnap = saved.readinessSnap || null;
    state.hadFlawless = saved.hadFlawless || false;
    state.lastLessonSec = saved.lastLessonSec || null;
    state.masteryShown = saved.masteryShown || [];
    state.firstOpenDay = saved.firstOpenDay || null;
    state.lastOpenDay = saved.lastOpenDay || null;
  }
}
async function saveState() {
  await cloud.setJson('pycourse.state', {
    _savedAt: Date.now(),
    profile: state.profile,
    done: [...state.done],
    crowns: state.crowns,
    theorySeen: [...state.theorySeen],
    bossIntroSeen: [...state.bossIntroSeen],
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
    weekSolved: state.weekSolved,
    readinessSnap: state.readinessSnap,
    hadFlawless: state.hadFlawless,
    lastLessonSec: state.lastLessonSec,
    masteryShown: state.masteryShown,
    firstOpenDay: state.firstOpenDay,
    lastOpenDay: state.lastOpenDay,
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
    telemetry.emit('onboarding_done', { goal: profile.goal, experience: profile.experience, exam: !!profile.examMonth });
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
  renderHero();
  renderProfikBanner();
  renderPlanCard();
  renderProgressCard();
  renderReadinessCard();
  renderWeeklyCard();
  renderDailyCard();
  renderProjectsCard();
  renderVideosCard();
  tree.render({ done: state.done, crowns: state.crowns });
}

// Следующий непройденный урок (для кнопки «Продолжить обучение»)
function nextLesson() {
  for (const u of CURRICULUM) for (const l of u.lessons) if (!state.done.has(l.id)) return { lesson: l, unit: u };
  return null;
}

// ── Главный экран: ЭМОЦИОНАЛЬНАЯ ЦЕЛЬ + одна кнопка ──
// Центр — мечта ученика (балл/оценка). Индекс готовности — внутренняя механика,
// показан как «готовность к цели». Экзамен постоянно чувствуется.
function renderHero() {
  const r = readiness(state);
  const color = readinessColor(r.total);
  const nx = nextLesson();
  const p = state.profile || {};

  // 1) Эмоциональная цель
  const goalLine = heroGoalLine(p);

  // 2) Кольцо готовности — «готовность к цели»
  const ring = r.hasData
    ? `<div class="hero-ring" style="background:conic-gradient(${color} ${r.total*3.6}deg, #3A2A5C 0)">
         <div class="hero-ring-in"><div class="hero-pct" style="color:${color}">${r.total}%</div><div class="hero-ring-lbl">к цели</div></div>
       </div>`
    : `<div class="hero-ring" style="background:conic-gradient(#3A2A5C 360deg, #3A2A5C 0)">
         <div class="hero-ring-in"><div class="hero-pct" style="color:var(--muted)">—</div><div class="hero-ring-lbl">старт</div></div>
       </div>`;

  // 3) Экзамен всегда чувствуется: отсчёт + осталось тем + уже умею задачи
  const dte = daysToExam(p.examMonth, p.examDay);
  const examName = p.goal === 'oge' ? 'ОГЭ' : 'ЕГЭ';
  const countdown = dte != null
    ? `До ${examName} <b>${dte}</b> ${plural(dte, 'день', 'дня', 'дней')}`
    : escapeHtml(readinessLabel(r.total));
  const remainThemes = CURRICULUM.filter(u => !u.lessons.every(l => state.done.has(l.id))).length;
  const themesLine = remainThemes > 0
    ? `осталось пройти <b>${remainThemes}</b> ${plural(remainThemes, 'тему', 'темы', 'тем')}`
    : 'вся программа пройдена';
  const bossNums = solvedBossNumbers();
  const bossLine = bossNums.length
    ? `<div class="hero-boss">Ты уже умеешь решать ${bossNums.map(n => '№' + n).join(', ')} 💪</div>` : '';

  const btnLabel = nx
    ? (state.done.size === 0 ? 'Начать подготовку' : 'Следующий шаг')
    : 'Программа пройдена 🎉';

  els.heroCard.innerHTML = `
    <div class="hero-top">
      ${ring}
      <div class="hero-goal">
        ${goalLine}
        <div class="hero-countdown">${countdown} · ${themesLine}</div>
        ${nx ? `<div class="hero-next">Сегодня: ${escapeHtml(nx.unit.icon + ' ' + nx.lesson.title)}</div>` : ''}
      </div>
    </div>
    ${bossLine}
    <button class="hero-continue" id="hero-continue" ${nx ? '' : 'disabled'}>${btnLabel}</button>
  `;
  const btn = els.heroCard.querySelector('#hero-continue');
  if (nx) btn.onclick = () => {
    sound.play('button_tap');
    telemetry.emit('continue_pressed', { lessonId: nx.lesson.id });
    requestLesson(nx.lesson.id);
  };
}

// Эмоциональный заголовок цели.
function heroGoalLine(p) {
  if (p.targetScore && p.goal === 'ege') {
    return `<div class="hero-title"><span class="hero-goal-em">🎯 Цель: ${p.targetScore} ${plural(p.targetScore, 'балл', 'балла', 'баллов')}</span></div>
            <div class="hero-goal-sub">Готовлю тебя к этому результату на ЕГЭ</div>`;
  }
  if (p.targetScore && p.goal === 'oge') {
    return `<div class="hero-title"><span class="hero-goal-em">🎯 Цель: сдать ОГЭ на ${p.targetScore}</span></div>
            <div class="hero-goal-sub">Ведём к этой оценке шаг за шагом</div>`;
  }
  const examTitle = p.goal === 'oge' ? 'Подготовка к ОГЭ по информатике'
    : p.goal === 'ege' ? 'Подготовка к ЕГЭ по информатике'
    : 'Изучаем Python шаг за шагом';
  return `<div class="hero-title">${examTitle}</div>`;
}

// Номера задач-боссов ЕГЭ, которые ученик уже закрыл (для «ты уже умеешь …»).
function solvedBossNumbers() {
  const nums = [];
  for (const u of CURRICULUM) {
    if (!u.isBoss) continue;
    if (!u.lessons.every(l => state.done.has(l.id))) continue;
    const m = /№\s*(\d+)/.exec(u.title);
    if (m) nums.push(parseInt(m[1], 10));
  }
  return nums.sort((a, b) => a - b);
}

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
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

  const gain = planReadinessGain(items);
  let html = `<div class="plan-header">
    <div class="plan-title">🎯 Маршрут на сегодня</div>
    <div class="plan-count">${doneCount} / ${items.length}</div>
  </div>
  <div class="plan-subtitle">Я составил тебе маршрут под твою цель. Пройдёшь — <b>готовность +${gain}%</b>.</div>`;
  if (allDone) {
    html += `<div class="plan-done-all">Маршрут пройден! Ты стал ближе к экзамену 🎉</div>`;
  }
  for (const it of items) {
    const done = doneIds.includes(it.id);
    html += `<div class="plan-item${done ? ' done' : ''}" data-id="${it.id}">
      <div class="pi-icon">${it.icon}</div>
      <div class="pi-body">
        <div class="pi-text">${escapeHtml(it.text)}</div>
        <div class="pi-sub">${escapeHtml(it.sub)}</div>
      </div>
      ${done ? '<div class="pi-check">✓</div>' : (it.gain ? `<div class="pi-gain">+${it.gain}%</div>` : '<div class="pi-check">›</div>')}
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

// «Мой прогресс» — личный кабинет: готовность+дельта за неделю, решено за неделю,
// сильная/слабая тема, всего пройдено. Обновляет недельный снимок готовности.
function renderProgressCard() {
  if (!els.progressCard) return;
  const r = readiness(state);
  if (!r.hasData && state.done.size === 0) { els.progressCard.classList.add('hidden'); return; }
  const wk = weekKey();

  // дельта готовности с прошлой недели + нарратив истории + обновление снимка
  let deltaHtml = '', historyHtml = '';
  if (state.readinessSnap && state.readinessSnap.week !== wk) {
    const was = state.readinessSnap.value;
    const d = r.total - was;
    const sign = d > 0 ? '+' : '';
    const cls = d > 0 ? 'up' : (d < 0 ? 'down' : '');
    deltaHtml = `<span class="prg-delta ${cls}">${sign}${d}% за неделю</span>`;
    if (d !== 0) historyHtml = `<div class="prg-history">Неделю назад — <b>${was}%</b>, сегодня — <b>${r.total}%</b>. ${d > 0 ? 'Так держать 💪' : 'Вернём форму — я помогу.'}</div>`;
  }
  if (!state.readinessSnap || state.readinessSnap.week !== wk) {
    state.readinessSnap = { week: wk, value: r.total };
    saveState();
  }

  const solved = (state.weekSolved.week === wk) ? state.weekSolved.count : 0;
  const totalLessons = CURRICULUM.reduce((s, u) => s + u.lessons.length, 0);
  const strong = strongestTopic(state.topicStats || {});
  const weak = weakestTopic(state.topicStats || {});

  els.progressCard.classList.remove('hidden');
  els.progressCard.innerHTML = `
    <div class="prg-head">📊 Мой прогресс ${deltaHtml}</div>
    ${historyHtml}
    <div class="prg-grid">
      <div class="prg-cell"><div class="prg-val">${r.hasData ? r.total + '%' : '—'}</div><div class="prg-lbl">готовность</div></div>
      <div class="prg-cell"><div class="prg-val">${solved}</div><div class="prg-lbl">решено за неделю</div></div>
      <div class="prg-cell"><div class="prg-val">${state.done.size}<span class="prg-of">/${totalLessons}</span></div><div class="prg-lbl">уроков пройдено</div></div>
    </div>
    ${(strong || weak) ? `<div class="prg-topics">
      ${strong ? `<div class="prg-topic"><span class="prg-dot ok">▲</span> сильная: <b>${escapeHtml(strong.title)}</b> (${strong.accuracy}%)</div>` : ''}
      ${weak ? `<div class="prg-topic"><span class="prg-dot bad">▼</span> подтянуть: <b>${escapeHtml(weak.title)}</b> (${weak.accuracy}%)</div>` : ''}
    </div>` : ''}
  `;
}

function dispatchPlanAction(action) {
  switch (action.type) {
    case 'review': openReview(action.unitId); break;
    case 'daily': openDaily(); break;
    case 'bugfix': openBugFix(); break;
    case 'boss': requestLesson(findUnit(action.unitId).lessons[0].id); break;
    case 'lesson': requestLesson(action.lessonId); break;
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

  // «Почему столько» — самое слабое место + проекция закрытия темы (доверие к индексу)
  const weak = weakestTopic(state.topicStats || {});
  let whyHtml = '';
  if (weak) {
    const projected = projectMastery(state, weak.unitId);
    const delta = projected - r.total;
    whyHtml = `<div class="rd-why">
      <div class="rd-why-line">Самое слабое место: <b>${escapeHtml(weak.title)}</b> · ${weak.accuracy}%</div>
      ${delta > 0 ? `<button class="rd-why-cta" id="rd-fix" data-unit="${weak.unitId}">Закрыть тему → станет ${projected}% <span class="rd-plus">+${delta}</span></button>` : ''}
    </div>`;
  }

  els.readinessCard.innerHTML = `
    <div class="readiness-top">
      <div class="readiness-ring" style="background:conic-gradient(${color} ${r.total * 3.6}deg, #3A2A5C 0)">
        <div style="width:44px;height:44px;border-radius:50%;background:#2E2154;display:flex;align-items:center;justify-content:center;color:${color}">${r.total}</div>
      </div>
      <div class="readiness-info">
        <div class="readiness-title">Готовность к цели</div>
        <div class="readiness-sub">${escapeHtml(readinessLabel(r.total))}</div>
      </div>
      <div class="readiness-arrow" id="rd-arrow">▾</div>
    </div>
    <div class="readiness-detail" id="rd-detail">${rows}${whyHtml}</div>
  `;
  els.readinessCard.onclick = () => {
    const d = els.readinessCard.querySelector('#rd-detail');
    const a = els.readinessCard.querySelector('#rd-arrow');
    d.classList.toggle('open');
    a.textContent = d.classList.contains('open') ? '▴' : '▾';
    sound.play('button_tap');
  };
  const fixBtn = els.readinessCard.querySelector('#rd-fix');
  if (fixBtn) fixBtn.onclick = (e) => {
    e.stopPropagation();
    sound.play('button_tap');
    telemetry.emit('readiness_fix', { unit: fixBtn.dataset.unit });
    openReview(fixBtn.dataset.unit);
  };
}

let recentMood = null;   // 'struggling' | 'onFire' — разовая адаптивная реплика Профика

function renderProfikBanner() {
  let msg;
  if (recentMood && ADAPTIVE[recentMood]) { msg = { text: ADAPTIVE[recentMood], action: null }; recentMood = null; }
  else msg = profikMessage(state, todayKey(), shiftDay);
  els.profikBanner.classList.remove('hidden');
  els.profikBanner.innerHTML = `
    <img class="pb-cat" src="profik-cat.png" alt="Профик">
    <div class="pb-body">
      <div class="pb-text">${escapeHtml(msg.text)}</div>
      ${msg.action ? `<button class="pb-action" id="pb-action">${
        msg.action.type === 'review' ? 'Повторить тему' :
        msg.action.type === 'daily' ? 'Начать повторение' :
        msg.action.type === 'lesson' ? 'Начать тему' : 'Поехали'
      }</button>` : ''}
    </div>
  `;
  if (msg.action) {
    els.profikBanner.querySelector('#pb-action').onclick = () => {
      sound.play('button_tap');
      if (msg.action.type === 'review') openReview(msg.action.unitId);
      else if (msg.action.type === 'daily') openDaily();
      else if (msg.action.type === 'lesson') requestLesson(msg.action.lessonId);
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
      <div class="daily-title">${doneToday ? 'Задача дня пройдена!' : 'Задача дня от Игоря'}</div>
      <div class="daily-sub">${doneToday ? 'Возвращайся завтра — серия не прервётся' : `${daily.questions.length} вопросов · +${daily.xp} XP · держит серию`}</div>
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

function openChannel() {
  const url = CHANNEL_URL;
  if (tg && typeof tg.openTelegramLink === 'function') tg.openTelegramLink(url);
  else if (tg && typeof tg.openLink === 'function') tg.openLink(url);
  else window.open(url, '_blank', 'noopener');
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
    const wasFirst = !state.projectsBuilt.has(activeProject.id);
    state.projectsBuilt.add(activeProject.id);
    state.xp += 25;
    touchStreak();
    // скорость для индекса готовности
    if (result.answerCount) {
      state.speedStats.count += result.answerCount;
      state.speedStats.totalMs += result.answerTimeMs || 0;
    }
    await saveState();
    if (wasFirst) syncBackend({ lessonId: 'project_' + activeProject.id, xp: 25, accuracy: result.accuracy }, 'project');
    show('projectDone');
    projectsScreen.showDone(activeProject, { onNext: openProjects, onChannel: () => { telemetry.emit('channel_open', { from: 'project' }); openChannel(); } });
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

  // Экспертная заметка перед задачей-боссом ЕГЭ — «почему это важно» (один раз).
  if (isFirstLessonOfUnit && unit && unit.isBoss && EXPERT_NOTES[unit.id] && !state.bossIntroSeen.has(unit.id)) {
    showBossIntro(unit, lessonId);
    return;
  }
  if (isFirstLessonOfUnit && hasTheory && notSeen) {
    showTheoryOffer(lesson.unitId, lessonId);
  } else {
    openLesson(lessonId);
  }
}

function showBossIntro(unit, lessonId) {
  state.bossIntroSeen.add(unit.id);
  saveState();
  telemetry.emit('boss_intro_shown', { unit: unit.id });
  const offer = document.createElement('div');
  offer.className = 'theory-offer boss-intro';
  offer.innerHTML = `
    <div class="boss-intro-badge">🧠 Разбор от Игоря</div>
    <h3>${escapeHtml(unit.title)}</h3>
    <p>${escapeHtml(EXPERT_NOTES[unit.id])}</p>
    <div class="offer-btns">
      <button class="offer-primary" id="boss-go">Разобрать задачу</button>
    </div>
  `;
  document.getElementById('app').appendChild(offer);
  offer.querySelector('#boss-go').onclick = () => {
    sound.play('button_tap'); offer.remove();
    const hasTheory = !!THEORY[unit.id];
    if (hasTheory && !state.theorySeen.has(unit.id)) showTheoryOffer(unit.id, lessonId);
    else openLesson(lessonId);
  };
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

let lastRatingAwarded = 0;   // рейтинг за последнее прохождение (для экрана результата)
let lastCompletedUnit = null; // тема, которую только что закрыли (для реплики роста)
let lastUnitPerfect = false;  // закрыли тему на 100% (для вау-момента)
let lastStruggled = false;    // урок дался тяжело (предложить видео)

async function onLessonComplete(result) {
  lastRatingAwarded = 0;
  lastCompletedUnit = null;
  lastUnitPerfect = false;
  lastStruggled = !!result.struggled;
  if (result.success) {
    touchStreak();
    state.xp += result.xp;
    // счётчик решённых заданий за неделю (для «Мой прогресс»)
    const wk = weekKey();
    if (state.weekSolved.week !== wk) state.weekSolved = { week: wk, count: 0 };
    state.weekSolved.count += result.correctCount || 0;
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
      const wasFirst = !state.done.has(result.lessonId);   // первое прохождение → будет рейтинг
      const wasEmpty = state.done.size === 0;
      state.done.add(result.lessonId);
      if (wasEmpty) telemetry.emit('first_lesson_done', { lessonId: result.lessonId, accuracy: result.accuracy });
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
        // тема закрыта целиком? → реплика роста + возможный вау-момент
        if (unit && unit.lessons.every(l => state.done.has(l.id))) {
          lastCompletedUnit = unit.id;
          lastUnitPerfect = unit.lessons.every(l => (state.crowns[l.id] || 0) >= 100);
        }
      }
      if (wasFirst) lastRatingAwarded = estimateRating(result.xp, result.accuracy);
      // веха роста мастерства (только для основных уроков)
      lastMastery = checkMastery();
    }
    // микро-победы (эмоция каждые пару минут)
    lastMicroWins = computeMicroWins(result);
    if (result.flawless) state.hadFlawless = true;
    if (activeMode === 'lesson') state.lastLessonSec = result.durationSec ?? null;
    await saveState();
    syncBackend(result, activeMode);   // рейтинг сервер даёт только за kind='lesson'
  }
  // адаптивная реплика Профика на следующем экране дерева
  if (result.struggled) recentMood = 'struggling';
  else if (result.success && result.accuracy === 100 && !lastCompletedUnit) recentMood = 'onFire';
  showResult(result);
}

let lastMicroWins = [];
let lastMastery = null;

// Эмоциональные микро-победы за сессию (не ачивки — мгновенная радость).
function computeMicroWins(result) {
  const wins = [];
  if (!result.success) return wins;
  if (result.flawless && !state.hadFlawless) wins.push('🏅 Твой первый идеальный урок!');
  else if (result.flawless) wins.push('🎯 Ни одной ошибки');
  if ((result.maxRun || 0) >= 4) wins.push(`🔥 ${result.maxRun} верных подряд`);
  if (activeMode === 'lesson' && state.lastLessonSec != null && result.durationSec != null
      && result.durationSec < state.lastLessonSec) {
    wins.push('⚡ Быстрее, чем в прошлый раз');
  }
  return wins.slice(0, 2);   // не перегружаем
}

// Вехи роста мастерства — крупные рубежи (показываем один раз каждую).
function checkMastery() {
  const done = state.done;
  const unitDone = (u) => u.lessons.every(l => done.has(l.id));
  const shown = new Set(state.masteryShown || []);
  const candidates = [];
  const bosses = CURRICULUM.filter(u => u.isBoss);
  if (bosses.length && bosses.every(unitDone)) candidates.push('all_bosses');
  const ogeUnits = CURRICULUM.slice(0, FIRST_EGE_UNIT_INDEX ?? CURRICULUM.length);
  if (ogeUnits.length && ogeUnits.every(unitDone)) candidates.push('oge_base_done');
  const funcU = findUnit('ege_func'); if (funcU && unitDone(funcU)) candidates.push('func_done');
  const listsU = findUnit('ege_lists'); if (listsU && unitDone(listsU)) candidates.push('lists_done');
  if (bosses.some(unitDone)) candidates.push('first_boss');
  for (const key of candidates) {
    if (!shown.has(key) && MASTERY[key]) {
      state.masteryShown = [...shown, key];
      return { key, text: MASTERY[key] };
    }
  }
  return null;
}

// ── Result ──
function showResult(result) {
  show('result');
  const unitDone = result.success && lastCompletedUnit;
  const wow = unitDone && lastUnitPerfect;
  const cat = wow ? '🏅' : (result.success ? '🎉' : '😿');
  const title = wow ? 'Тема освоена на 100%!' : (unitDone ? 'Тема пройдена!' : (result.success ? 'Урок пройден!' : 'Почти получилось'));
  if (result.success) { sound.play(wow ? 'shard_reveal' : 'correct'); tg?.HapticFeedback?.notificationOccurred?.('success'); }

  const ratingStat = (result.success && lastRatingAwarded > 0)
    ? `<div class="result-stat"><div class="rs-val">+${lastRatingAwarded}</div><div class="rs-lbl">рейтинг</div></div>`
    : '';

  // микро-победы — эмоциональные вспышки за сессию
  let winsHtml = '';
  if (lastMicroWins.length) {
    winsHtml = `<div class="result-wins">${lastMicroWins.map(w => `<span class="result-win">${escapeHtml(w)}</span>`).join('')}</div>`;
  }

  // реплика роста личности + веха мастерства от Профика/Игоря
  let growthHtml = '';
  if (lastMastery) {
    growthHtml = `<div class="result-growth mastery">🎓 ${escapeHtml(lastMastery.text)}</div>`;
  } else if (unitDone && IDENTITY[lastCompletedUnit]) {
    growthHtml = `<div class="result-growth with-cat"><img class="growth-cat" src="profik-cat.png" alt="Профик">${escapeHtml(IDENTITY[lastCompletedUnit])}</div>`;
  }
  // предложение видео/канала: при «застрял» — видео, при закрытии темы — иногда канал
  let extraBtn = '';
  const vids = lastStruggled ? ((THEORY[result.unitId] || {}).videos || []) : [];
  const programComplete = unitDone && CURRICULUM.every(u => u.lessons.every(l => state.done.has(l.id)));
  if (vids.length) {
    extraBtn = `<button class="result-video" id="result-video" data-vid="${vids[0].id}">🎥 Игорь объясняет это в видео</button>`;
  } else if (programComplete) {
    extraBtn = `<button class="result-channel" id="result-channel">🎓 ${escapeHtml(CHANNEL_CONTINUE)}</button>`;
  } else if (unitDone && CHANNEL_HINTS[lastCompletedUnit]) {
    extraBtn = `<button class="result-channel" id="result-channel">💬 ${escapeHtml(CHANNEL_HINTS[lastCompletedUnit])}</button>`;
  }

  els.resultWrap.innerHTML = `
    <div class="result-cat${wow ? ' wow' : ''}">${cat}</div>
    <div class="result-title">${title}</div>
    ${winsHtml}
    ${growthHtml}
    <div class="result-stats">
      <div class="result-stat"><div class="rs-val">+${result.xp}</div><div class="rs-lbl">XP</div></div>
      ${ratingStat}
      <div class="result-stat"><div class="rs-val">${result.accuracy}%</div><div class="rs-lbl">точность</div></div>
      <div class="result-stat"><div class="rs-val">🔥 ${state.streak}</div><div class="rs-lbl">серия</div></div>
    </div>
    ${result.success && lastRatingAwarded > 0 ? '<div style="font-size:13px;color:var(--muted);margin-top:-4px;">Баллы пошли в общий рейтинг Арены</div>' : ''}
    ${extraBtn}
    <button class="result-cta" id="result-continue">${result.success ? 'Продолжить' : 'Попробовать снова'}</button>
    ${(result.success && (unitDone || activeMode === 'daily' || activeMode === 'weekly')) ? `<div class="result-tomorrow">🌙 ${escapeHtml(tomorrowHook(todayKey()))}</div>` : ''}
  `;
  const vbtn = els.resultWrap.querySelector('#result-video');
  if (vbtn) vbtn.onclick = () => { sound.play('button_tap'); telemetry.emit('video_from_struggle', { id: vbtn.dataset.vid }); openYouTube(vbtn.dataset.vid); };
  const cbtn = els.resultWrap.querySelector('#result-channel');
  if (cbtn) cbtn.onclick = () => { sound.play('button_tap'); telemetry.emit('channel_open', { from: 'result' }); openChannel(); };
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
async function syncBackend(result, kind) {
  try {
    await fetch('/api/python/session_end', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        init_data: tg?.initData || '',
        lessonId: result.lessonId,
        xpEarned: result.xp,
        accuracy: result.accuracy,
        kind: kind || 'lesson',   // рейтинг только за kind='lesson'|'project'
      }),
    });
  } catch (e) { /* offline — не страшно */ }
}

// Клиентская оценка рейтинга за первое прохождение (совпадает с формулой сервера)
function estimateRating(xp, accuracy) {
  const base = Math.min(20, Math.max(5, xp || 0));
  return Math.max(2, Math.min(15, Math.round(base * (accuracy || 0) / 100)));
}

// ── back button ──
els.treeBack.addEventListener('click', () => {
  telemetry.flush();
  window.location.href = '../index.html';
});

// ── boot ──
(async () => {
  await loadState();
  emitAppOpen();
  if (state.profile) goToTree();
  else startOnboarding();
})();

// Воронка: открытие приложения с когортой и возвратом (для D1/D7).
function emitAppOpen() {
  const today = todayKey();
  if (!state.firstOpenDay) state.firstOpenDay = today;
  const daysSinceInstall = daysBetweenKeys(state.firstOpenDay, today);
  const daysSinceLast = state.lastOpenDay ? daysBetweenKeys(state.lastOpenDay, today) : null;
  const returned = state.lastOpenDay && state.lastOpenDay !== today;
  telemetry.emit('app_open', {
    day: today,
    daysSinceInstall,
    daysSinceLast,
    returnDay: returned ? daysSinceInstall : null,   // D1/D7 маркер
    hasProfile: !!state.profile,
    lessonsDone: state.done.size,
    reachedEge: solvedBossNumbers().length > 0 || [...state.done].some(id => /ege_/.test(id)),
  });
  if (state.lastOpenDay !== today) { state.lastOpenDay = today; saveState(); }
}

function daysBetweenKeys(a, b) {
  const d1 = new Date(a + 'T00:00:00Z'), d2 = new Date(b + 'T00:00:00Z');
  return Math.round((d2 - d1) / 86400000);
}
