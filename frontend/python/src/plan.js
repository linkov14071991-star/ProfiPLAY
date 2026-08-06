// plan.js — «План на сегодня»: адаптивный дневной план из статистики ученика.
// 4 слота: повторить слабое, исправить ошибки, решить задачу ЕГЭ, посмотреть видео.

import { CURRICULUM, findUnit } from './curriculum/index.js';
import { THEORY } from './curriculum/theory.js';
import { weakestTopic } from './profik.js';
import { readiness } from './readiness.js';

// Следующий непройденный урок программы.
export function nextNewLesson(state) {
  const done = state.done || new Set();
  for (const u of CURRICULUM) for (const l of u.lessons) if (!done.has(l.id)) return { lesson: l, unit: u };
  return null;
}

// Собрать «bug-урок» из вопросов «найди ошибку» по теме (или по всем пройденным).
export function buildBugFix(state) {
  const weak = weakestTopic(state.topicStats || {});
  const pools = [];
  // сначала пробуем слабую тему
  const tryUnits = [];
  if (weak) tryUnits.push(weak.unitId);
  for (const u of CURRICULUM) if (state.done && [...state.done].some(id => id.startsWith(u.id))) tryUnits.push(u.id);

  const seen = new Set();
  for (const uid of tryUnits) {
    if (seen.has(uid)) continue; seen.add(uid);
    const unit = findUnit(uid);
    if (!unit) continue;
    for (const l of unit.lessons) for (const q of l.questions) if (q.type === 'bug') pools.push(q);
    if (pools.length >= 3) break;
  }
  // если багов мало — добавим из всего курса
  if (pools.length < 3) {
    for (const u of CURRICULUM) for (const l of u.lessons) for (const q of l.questions) if (q.type === 'bug') pools.push(q);
  }
  if (pools.length === 0) return null;
  const shuffled = [...pools];
  for (let i = shuffled.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]; }
  return { id: 'plan_bugfix', title: 'Работа над ошибками', xp: 15, questions: shuffled.slice(0, 3), isReview: true };
}

// Найти первый непройденный боссовый юнит (задача ЕГЭ).
export function nextBossUnit(state) {
  const done = state.done || new Set();
  for (const u of CURRICULUM) {
    if (!u.isBoss) continue;
    const allDone = u.lessons.every(l => done.has(l.id));
    if (!allDone) return u;
  }
  // все боссы пройдены — вернём любой для повторения
  return CURRICULUM.find(u => u.isBoss) || null;
}

// Юнит для видео (слабая тема, иначе первый непройденный с видео).
export function videoUnit(state) {
  const weak = weakestTopic(state.topicStats || {});
  if (weak && (THEORY[weak.unitId]?.videos || []).length) return findUnit(weak.unitId);
  const done = state.done || new Set();
  for (const u of CURRICULUM) {
    if ((THEORY[u.id]?.videos || []).length && !u.lessons.every(l => done.has(l.id))) return u;
  }
  return CURRICULUM.find(u => (THEORY[u.id]?.videos || []).length) || null;
}

// Построить маршрут на сегодня. СОСТАВ И ПОРЯДОК зависят от индекса готовности —
// индекс работает как «мозг» продукта (совет эксперта).
//   низкая готовность  → фундамент: новая тема + повторение + видео
//   средняя            → баланс: новая тема + повторение + задача ЕГЭ
//   высокая            → экзамен-фокус: задача ЕГЭ + повторение слабого + новое
export function buildPlan(state) {
  const r = readiness(state).total || 0;
  const weak = weakestTopic(state.topicStats || {});
  const nx = nextNewLesson(state);
  const boss = nextBossUnit(state);
  const vu = videoUnit(state);

  const newItem = nx
    ? { id: 'new', icon: '📘', text: `Новая тема: «${nx.lesson.title}»`, sub: 'следующий шаг программы', action: { type: 'lesson', lessonId: nx.lesson.id }, gain: 3 }
    : null;
  const reviewItem = weak
    ? { id: 'review', icon: '🔁', text: `Повторить «${weak.title}»`, sub: `пока ${weak.accuracy}% верных`, action: { type: 'review', unitId: weak.unitId }, gain: 2 }
    : { id: 'review', icon: '🔁', text: 'Повторение изученного', sub: 'вопросы вперемешку', action: { type: 'daily' }, gain: 1 };
  const bugItem = { id: 'bugfix', icon: '🐞', text: 'Работа над ошибками', sub: '3 задачи «найди ошибку»', action: { type: 'bugfix' }, gain: 1 };
  const bossItem = boss
    ? { id: 'boss', icon: '🧠', text: `${boss.title}`, sub: 'разбор задачи экзамена', action: { type: 'boss', unitId: boss.id }, gain: 4 }
    : null;
  const videoItem = vu
    ? { id: 'video', icon: '🎥', text: `Разбор от Игоря: «${vu.title}»`, sub: 'видео марафона', action: { type: 'video', unitId: vu.id }, gain: 1 }
    : null;

  let order;
  if (r < 40) order = [newItem, reviewItem, videoItem, bugItem];        // фундамент
  else if (r < 70) order = [newItem, reviewItem, bossItem, bugItem];    // баланс
  else order = [bossItem, reviewItem, bugItem, newItem];                // экзамен-фокус

  const items = [];
  for (const it of order) if (it && !items.find(x => x.id === it.id)) items.push(it);
  return items.slice(0, 4);
}

// Прогноз роста готовности за выполнение всего плана (сумма gain, с потолком).
export function planReadinessGain(items) {
  const sum = items.reduce((s, it) => s + (it.gain || 0), 0);
  return Math.min(sum, 12);
}
