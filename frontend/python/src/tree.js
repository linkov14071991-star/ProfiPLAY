// tree.js — экран дерева тем (skill tree).

import { CURRICULUM } from './curriculum/index.js';
import { THEORY } from './curriculum/theory.js';
import { sound } from './audio/sound_engine.js';

export class TreeScreen {
  constructor(scrollEl, onOpenLesson, onOpenDaily, onOpenTheory) {
    this.scroll = scrollEl;
    this.onOpenLesson = onOpenLesson;
    this.onOpenDaily = onOpenDaily;
    this.onOpenTheory = onOpenTheory;
    this.expanded = new Set();   // unitId, которые ученик вручную раскрыл
  }

  // progress: { done: Set<lessonId>, crowns: {lessonId: accuracy} }
  render(progress) {
    const doneSet = progress.done || new Set();
    this.scroll.innerHTML = '';

    // Определяем «текущий» урок — первый непройденный
    let currentFound = false;

    for (const unit of CURRICULUM) {
      const doneCount = unit.lessons.filter(l => doneSet.has(l.id)).length;
      const unitDone = doneCount === unit.lessons.length;
      // Пройденные темы сворачиваем (если ученик не раскрыл вручную)
      const collapsed = unitDone && !this.expanded.has(unit.id);

      const block = document.createElement('div');
      block.className = 'unit-block' + (collapsed ? ' collapsed' : '') + (unitDone ? ' unit-done' : '');

      const head = document.createElement('div');
      head.className = 'unit-head';
      head.style.background = unit.color;
      head.innerHTML = `
        <div class="unit-emoji">${unit.icon}</div>
        <div class="unit-info">
          <div class="unit-title">${escapeHtml(unit.title)}</div>
          <div class="unit-desc">${unitDone ? '✓ Пройдено · ' + doneCount + '/' + unit.lessons.length : escapeHtml(unit.desc)}</div>
        </div>
        <div class="unit-chevron">${collapsed ? '▸' : '▾'}</div>
      `;
      // Заголовок сворачивает/разворачивает тему
      head.addEventListener('click', () => {
        sound.play('button_tap');
        const sy = this.scroll.scrollTop;
        if (this.expanded.has(unit.id)) this.expanded.delete(unit.id);
        else this.expanded.add(unit.id);
        this.render(progress);
        this.scroll.scrollTop = sy;
      });
      block.appendChild(head);

      const lessonsWrap = document.createElement('div');
      lessonsWrap.className = 'unit-lessons';

      // Кнопка теории (если есть)
      if (THEORY[unit.id]) {
        const tbtn = document.createElement('button');
        tbtn.className = 'unit-theory-btn';
        const hasVid = (THEORY[unit.id].videos || []).length;
        tbtn.innerHTML = `<span class="ut-icon">${hasVid ? '🎥' : '📖'}</span> ${hasVid ? 'Разбор от Игоря' : 'Теория темы'}<span class="ut-arrow">›</span>`;
        tbtn.addEventListener('click', () => {
          sound.play('button_tap');
          this.onOpenTheory(unit.id);
        });
        lessonsWrap.appendChild(tbtn);
      }

      unit.lessons.forEach((lesson, li) => {
        const isDone = doneSet.has(lesson.id);
        const isCurrent = !isDone && !currentFound;
        if (isCurrent) currentFound = true;
        const isLocked = !isDone && !isCurrent;

        const row = document.createElement('div');
        row.className = 'lesson-row' + (isDone ? ' done' : '') + (isCurrent ? ' current' : '') + (isLocked ? ' locked' : '');

        const nodeSymbol = isDone ? '✓' : (li + 1);
        const crown = progress.crowns?.[lesson.id];
        const crownStr = crown != null ? (crown >= 100 ? '👑' : crown >= 80 ? '⭐' : '') : '';

        row.innerHTML = `
          <div class="lesson-node">${nodeSymbol}</div>
          <div class="lesson-meta">
            <div class="lesson-name">${escapeHtml(lesson.title)}</div>
            <div class="lesson-sub">${lesson.questions.length} заданий · ${lesson.xp} XP</div>
          </div>
          <div class="lesson-crown">${crownStr}</div>
        `;

        if (!isLocked) {
          row.addEventListener('click', () => {
            sound.play('button_tap');
            this.onOpenLesson(lesson.id);
          });
        }
        lessonsWrap.appendChild(row);
      });

      block.appendChild(lessonsWrap);
      this.scroll.appendChild(block);
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}
