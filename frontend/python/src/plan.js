// plan.js — «План на сегодня»: адаптивный дневной план из статистики ученика.
// 4 слота: повторить слабое, исправить ошибки, решить задачу ЕГЭ, посмотреть видео.

import { CURRICULUM, findUnit } from './curriculum/index.js';
import { THEORY } from './curriculum/theory.js';
import { weakestTopic } from './profik.js';

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

// Построить план из 4 пунктов под текущего ученика.
export function buildPlan(state) {
  const items = [];
  const weak = weakestTopic(state.topicStats || {});

  // 1. Повторить слабое (или общее повторение)
  if (weak) {
    items.push({ id: 'review', icon: '🔁', text: `Повторить тему «${weak.title}»`, sub: `Пока ${weak.accuracy}% верных`, action: { type: 'review', unitId: weak.unitId } });
  } else {
    items.push({ id: 'review', icon: '🔁', text: 'Повторение изученного', sub: '8 вопросов вперемешку', action: { type: 'daily' } });
  }

  // 2. Работа над ошибками
  items.push({ id: 'bugfix', icon: '🐞', text: 'Исправить 3 ошибки в коде', sub: 'Найди, что не так', action: { type: 'bugfix' } });

  // 3. Задача ЕГЭ (босс)
  const boss = nextBossUnit(state);
  if (boss) {
    items.push({ id: 'boss', icon: '🧠', text: `Решить: ${boss.title}`, sub: 'Задача экзамена', action: { type: 'boss', unitId: boss.id } });
  }

  // 4. Видео
  const vu = videoUnit(state);
  if (vu) {
    items.push({ id: 'video', icon: '📺', text: `Видео по теме «${vu.title}»`, sub: 'Марафон Py.Go', action: { type: 'video', unitId: vu.id } });
  }

  return items;
}
