// tree.js — экран дерева тем (skill tree).

import { CURRICULUM } from './curriculum/index.js';
import { sound } from './audio/sound_engine.js';

export class TreeScreen {
  constructor(scrollEl, onOpenLesson, onOpenDaily) {
    this.scroll = scrollEl;
    this.onOpenLesson = onOpenLesson;
    this.onOpenDaily = onOpenDaily;
  }

  // progress: { done: Set<lessonId>, crowns: {lessonId: accuracy} }
  render(progress) {
    const doneSet = progress.done || new Set();
    this.scroll.innerHTML = '';

    // Определяем «текущий» урок — первый непройденный
    let currentFound = false;

    for (const unit of CURRICULUM) {
      const block = document.createElement('div');
      block.className = 'unit-block';

      const head = document.createElement('div');
      head.className = 'unit-head';
      head.style.background = unit.color;
      head.innerHTML = `
        <div class="unit-emoji">${unit.icon}</div>
        <div class="unit-info">
          <div class="unit-title">${escapeHtml(unit.title)}</div>
          <div class="unit-desc">${escapeHtml(unit.desc)}</div>
        </div>
        <div class="unit-badge">${unit.level}</div>
      `;
      block.appendChild(head);

      const lessonsWrap = document.createElement('div');
      lessonsWrap.className = 'unit-lessons';

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
