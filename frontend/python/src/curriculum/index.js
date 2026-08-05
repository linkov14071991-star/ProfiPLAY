// index.js — единая программа курса.

import { OGE_UNITS } from './oge.js';
import { EGE_UNITS } from './ege.js';
import { EGE_LIB_UNITS } from './ege_libs.js';
import { EGE_LIB_UNITS_2 } from './ege_libs2.js';
import { EXTRA_LESSONS } from './practice.js';
import { EXTRA_LESSONS_2 } from './practice2.js';
import { BUG_LESSONS } from './bugs.js';

// Собираем юниты и дополняем практическими уроками и уроками «найди ошибку»
export const CURRICULUM = [...OGE_UNITS, ...EGE_UNITS, ...EGE_LIB_UNITS, ...EGE_LIB_UNITS_2].map(unit => {
  const extra = EXTRA_LESSONS[unit.id] || [];
  const extra2 = EXTRA_LESSONS_2[unit.id] || [];
  const bugs = BUG_LESSONS[unit.id] || [];
  return { ...unit, lessons: [...unit.lessons, ...extra, ...extra2, ...bugs] };
});

// Плоский список уроков в порядке прохождения
export function allLessons() {
  const out = [];
  for (const unit of CURRICULUM) {
    for (const lesson of unit.lessons) {
      out.push({ ...lesson, unitId: unit.id, unitTitle: unit.title, level: unit.level, color: unit.color });
    }
  }
  return out;
}

export function findUnit(unitId) {
  return CURRICULUM.find(u => u.id === unitId);
}

export function findLesson(lessonId) {
  for (const unit of CURRICULUM) {
    const l = unit.lessons.find(x => x.id === lessonId);
    if (l) return { ...l, unitId: unit.id, unitTitle: unit.title, level: unit.level, color: unit.color };
  }
  return null;
}

// Индекс юнита, с которого начинается ЕГЭ (для рекомендации уровня)
export const FIRST_EGE_UNIT_INDEX = CURRICULUM.findIndex(u => u.level === 'ЕГЭ');

export function unitStats() {
  return CURRICULUM.map(u => ({
    id: u.id,
    title: u.title,
    level: u.level,
    lessons: u.lessons.length,
    questions: u.lessons.reduce((s, l) => s + l.questions.length, 0),
  }));
}
