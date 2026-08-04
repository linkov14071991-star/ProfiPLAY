// daily.js — ежедневное задание на повторение из пройденных уроков.

import { CURRICULUM } from './curriculum/index.js';

const MSK_OFFSET = 3 * 60; // минут

export function todayKey() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  const msk = new Date(utc + MSK_OFFSET * 60000);
  return msk.toISOString().slice(0, 10); // YYYY-MM-DD
}

// Собрать ежедневное задание: 8 случайных вопросов из пройденных уроков.
export function buildDaily(doneSet) {
  const pool = [];
  for (const unit of CURRICULUM) {
    for (const lesson of unit.lessons) {
      if (doneSet.has(lesson.id)) {
        lesson.questions.forEach((q, i) => pool.push({ ...q, _src: lesson.id }));
      }
    }
  }
  if (pool.length === 0) return null;

  // детерминированное перемешивание по дате (одно и то же в течение дня)
  const seed = hashStr(todayKey());
  const rng = mulberry32(seed);
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const questions = shuffled.slice(0, Math.min(8, shuffled.length));
  return {
    id: 'daily_' + todayKey(),
    title: 'Повторение дня',
    xp: 20,
    questions,
    isDaily: true,
  };
}

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
