// profik.js — «память» Профика: анализ слабых тем и персональные реплики.

import { CURRICULUM, findUnit } from './curriculum/index.js';
import { daysToExam } from './mentor.js';

const MIN_SAMPLES = 6;   // минимум ответов по теме для суждения о слабости

// Точность по каждой теме: [{ unitId, title, accuracy, total }]
export function topicAccuracy(topicStats) {
  const out = [];
  for (const unit of CURRICULUM) {
    const s = topicStats[unit.id];
    if (!s || s.total === 0) continue;
    out.push({
      unitId: unit.id,
      title: unit.title,
      level: unit.level,
      accuracy: Math.round((s.correct / s.total) * 100),
      total: s.total,
    });
  }
  return out;
}

// Самая слабая тема (низкая точность при достаточной выборке)
export function weakestTopic(topicStats) {
  const arr = topicAccuracy(topicStats).filter(t => t.total >= MIN_SAMPLES && t.accuracy < 75);
  if (arr.length === 0) return null;
  arr.sort((a, b) => a.accuracy - b.accuracy);
  return arr[0];
}

// Самая сильная тема (для похвалы)
export function strongestTopic(topicStats) {
  const arr = topicAccuracy(topicStats).filter(t => t.total >= MIN_SAMPLES && t.accuracy >= 90);
  if (arr.length === 0) return null;
  arr.sort((a, b) => b.accuracy - a.accuracy);
  return arr[0];
}

// Собрать персональную реплику Профика на основе состояния.
// Возвращает { text, action } где action = { type, unitId } | null
export function profikMessage(state, todayKey, shiftDay) {
  const weak = weakestTopic(state.topicStats || {});
  const strong = strongestTopic(state.topicStats || {});
  const lessonsDone = state.done.size;

  // 1) Возврат после долгого отсутствия
  if (state.lastActiveDay) {
    const gap = daysBetween(state.lastActiveDay, todayKey);
    if (gap >= 3) {
      const t = weak || (strong ? null : null);
      if (weak) return { text: `Тебя не было ${gap} дн. Давай вернёмся и подтянем тему «${weak.title}» — там ты чаще ошибаешься.`, action: { type: 'review', unitId: weak.unitId, title: weak.title } };
      return { text: `Тебя не было ${gap} дн. Начнём мягко — небольшое повторение?`, action: { type: 'daily' } };
    }
  }

  // 2) Есть слабая тема
  if (weak) {
    return {
      text: `Заметил: в теме «${weak.title}» ты пока ошибаешься (${weak.accuracy}% верных). Давай разберём — я подобрал задачи именно на неё.`,
      action: { type: 'review', unitId: weak.unitId, title: weak.title },
    };
  }

  // 3) Проактивный наставник: «почему именно сегодня» с привязкой к экзамену
  const p = state.profile || {};
  const dte = daysToExam(p.examMonth, p.examDay);
  const nextL = nextNewLesson(state);
  if (nextL) {
    const examName = p.goal === 'oge' ? 'ОГЭ' : 'ЕГЭ';
    const timing = dte != null
      ? `До ${examName} ${dte} ${pl(dte, 'день', 'дня', 'дней')}. Сейчас самое время взяться за «${nextL.lesson.title}».`
      : `Двигаемся дальше. Сегодня советую взяться за «${nextL.lesson.title}».`;
    return { text: timing, action: { type: 'lesson', lessonId: nextL.lesson.id } };
  }

  // 3) Всё хорошо + есть сильная тема
  if (strong && lessonsDone >= 3) {
    return {
      text: `Тема «${strong.title}» у тебя уже отскакивает от зубов (${strong.accuracy}%). Красавчик. Идём дальше?`,
      action: null,
    };
  }

  // 4) Хороший streak
  if (state.streak >= 3) {
    return { text: `${state.streak} дней подряд! Не сбавляй — так и до экзамена дойдёшь в форме.`, action: null };
  }

  // 5) Новичок / нейтрально
  if (lessonsDone === 0) {
    return { text: 'Начнём с первой темы? Я рядом и помогу, если что.', action: null };
  }
  return { text: 'Готов продолжать. Выбирай тему или загляни в повторение.', action: null };
}

function daysBetween(a, b) {
  const d1 = new Date(a + 'T00:00:00Z');
  const d2 = new Date(b + 'T00:00:00Z');
  return Math.round((d2 - d1) / 86400000);
}

function nextNewLesson(state) {
  const done = state.done || new Set();
  for (const u of CURRICULUM) for (const l of u.lessons) if (!done.has(l.id)) return { lesson: l, unit: u };
  return null;
}

function pl(n, one, few, many) {
  const a = n % 10, b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 10 || b >= 20)) return few;
  return many;
}

// Собрать урок-повторение по конкретной теме (слабой).
export function buildReview(unitId) {
  const unit = findUnit(unitId);
  if (!unit) return null;
  const pool = [];
  for (const lesson of unit.lessons) for (const q of lesson.questions) pool.push(q);
  if (pool.length === 0) return null;
  // перемешать и взять до 8
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return {
    id: 'review_' + unitId,
    title: 'Повторение: ' + unit.title,
    xp: 15,
    questions: shuffled.slice(0, Math.min(8, shuffled.length)),
    isReview: true,
    unitId,
  };
}
