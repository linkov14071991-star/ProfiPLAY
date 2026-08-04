// index.js — единая программа курса.

import { OGE_UNITS } from './oge.js';
import { EGE_UNITS } from './ege.js';

export const CURRICULUM = [...OGE_UNITS, ...EGE_UNITS];

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
