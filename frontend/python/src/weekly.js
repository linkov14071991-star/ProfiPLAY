// weekly.js — тест недели. Ротация по ISO-неделям, сброс в понедельник.

import { CURRICULUM } from './curriculum/index.js';

// Порядок тем недель: сначала ОГЭ-база, потом ЕГЭ. Ротация по кругу.
const WEEKLY_PLAN = [
  { title: 'Вывод и переменные', units: ['oge_print', 'oge_vars'] },
  { title: 'Ввод и арифметика', units: ['oge_input', 'oge_math'] },
  { title: 'Условия', units: ['oge_if'] },
  { title: 'Циклы', units: ['oge_while', 'oge_for'] },
  { title: 'Строки', units: ['oge_str'] },
  { title: 'Списки', units: ['ege_lists'] },
  { title: 'Вложенные циклы и функции', units: ['ege_nested', 'ege_func'] },
  { title: 'Строки и словари', units: ['ege_str2', 'ege_dict'] },
  { title: 'Библиотеки', units: ['ege_lib'] },
  { title: 'Задачи ЕГЭ', units: ['ege_algo'] },
];

const WEEK_SIZE = 12; // вопросов в тесте недели

// Номер ISO-недели и год
export function isoWeek(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // пн=0
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(
    ((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7
  );
  return { year: date.getUTCFullYear(), week };
}

export function weekKey() {
  const { year, week } = isoWeek();
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// Текущий тест недели (ротация)
export function currentWeeklyPlan() {
  const { week } = isoWeek();
  const idx = (week - 1) % WEEKLY_PLAN.length;
  return { ...WEEKLY_PLAN[idx], index: idx };
}

// Собрать тест недели из вопросов выбранных юнитов (детерминированно по неделе)
export function buildWeekly() {
  const plan = currentWeeklyPlan();
  const pool = [];
  for (const unit of CURRICULUM) {
    if (!plan.units.includes(unit.id)) continue;
    for (const lesson of unit.lessons) {
      for (const q of lesson.questions) pool.push(q);
    }
  }
  if (pool.length === 0) return null;

  const seed = hashStr(weekKey());
  const rng = mulberry32(seed);
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return {
    id: 'weekly_' + weekKey(),
    title: 'Тест недели: ' + plan.title,
    xp: 40,
    questions: shuffled.slice(0, Math.min(WEEK_SIZE, shuffled.length)),
    isWeekly: true,
    theme: plan.title,
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
