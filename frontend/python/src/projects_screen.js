// projects_screen.js — экран списка мини-проектов и финальная витрина.

import { PROJECTS } from './curriculum/projects.js';
import { findUnit } from './curriculum/index.js';
import { codeBlock } from './ui/highlight.js';
import { sound } from './audio/sound_engine.js';
import { telemetry } from './telemetry/client.js';

export class ProjectsScreen {
  constructor(els) {
    this.els = els;   // { scroll, back, doneWrap }
    this.onBack = null;
    this.onOpen = null;
    this.onDoneNext = null;
  }

  showList({ builtSet, isUnlocked, onBack, onOpen }) {
    this.onBack = onBack;
    this.onOpen = onOpen;
    telemetry.emit('projects_open', {});
    let html = `<div class="projects-intro">Собери настоящую программу по шагам. В конце увидишь готовый код и как он работает.</div>`;
    for (const p of PROJECTS) {
      const recommended = isUnlocked(p);   // тема пройдена — рекомендуется
      const built = builtSet.has(p.id);
      const unit = findUnit(p.unlockAfter);
      const status = built ? '✓ Собрано'
        : recommended ? `${p.steps.length} шагов`
        : `Лучше после темы «${unit ? unit.title : '?'}»`;
      html += `<div class="project-card${built ? ' built' : ''}" data-id="${p.id}">
        <div class="proj-icon">${p.icon}</div>
        <div class="proj-body">
          <div class="proj-title">${escapeHtml(p.title)}</div>
          <div class="proj-desc">${escapeHtml(p.desc)}</div>
          <div class="proj-status">${escapeHtml(status)}</div>
        </div>
        <div class="proj-arrow">›</div>
      </div>`;
    }
    this.els.scroll.innerHTML = html;
    // все проекты открываются; тема — лишь рекомендация
    this.els.scroll.querySelectorAll('.project-card').forEach(el => {
      const p = PROJECTS.find(x => x.id === el.dataset.id);
      el.addEventListener('click', () => { sound.play('button_tap'); this.onOpen(p); });
    });
  }

  showDone(project, { onNext }) {
    this.onDoneNext = onNext;
    sound.play('correct');
    const ex = project.example;
    this.els.doneWrap.innerHTML = `
      <div class="projdone-cat">🛠</div>
      <div class="projdone-title">Программа готова!</div>
      <div class="projdone-sub">Ты собрал «${escapeHtml(project.title)}» из кусочков</div>
      <div class="projdone-label">Вот вся программа:</div>
      ${codeBlock(project.finalCode)}
      <div class="projdone-label">Как она работает:</div>
      <div class="projdone-run"><span class="run-lbl">Ввод:</span>\n${escapeHtml(ex.input)}\n\n<span class="run-lbl">Вывод:</span>\n${escapeHtml(ex.output)}</div>
      <button class="projdone-cta" id="projdone-cta">Отлично!</button>
    `;
    this.els.doneWrap.querySelector('#projdone-cta').onclick = () => {
      sound.play('button_tap');
      this.onDoneNext && this.onDoneNext();
    };
  }

  bindBack() {
    this.els.back.addEventListener('click', () => { sound.play('button_tap'); this.onBack && this.onBack(); });
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}
