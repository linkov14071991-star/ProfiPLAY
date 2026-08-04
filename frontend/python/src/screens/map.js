// map.js — экран карты миров.

import { WORLDS } from '../worlds.js';
import { cloud } from '../state/cloud_storage.js';
import { sound } from '../audio/sound_engine.js';

export class MapScreen {
  constructor(rootEl, onOpen) {
    this.root = rootEl;
    this.list = rootEl.querySelector('#map-scroll');
    this.onOpen = onOpen;
  }

  async show() {
    const progress = await cloud.getJson('python.worldsProgress', {});
    this.list.innerHTML = '';
    let firstUnlocked = true;
    WORLDS.forEach((w, i) => {
      const worldProgress = progress[w.id] || { completed: 0 };
      const isCompleted = worldProgress.completed >= w.levels;
      const isCurrent = !w.locked && !isCompleted && firstUnlocked;
      if (!w.locked && !isCompleted) firstUnlocked = false;

      const node = document.createElement('div');
      node.className = 'map-node';
      if (w.locked) node.classList.add('locked');
      if (isCompleted) node.classList.add('completed');
      if (isCurrent) node.classList.add('current');

      const badge = w.locked
        ? '<div class="node-badge" style="background:#3a4050;color:#8b95a7;">🔒</div>'
        : (w.mvp ? '<div class="node-badge">MVP</div>' : '');

      const progressText = w.locked
        ? ''
        : `<div class="node-progress">${worldProgress.completed} / ${w.levels}</div>`;

      node.innerHTML = `
        <div class="node-icon">${w.icon}</div>
        <div class="node-body">
          <div class="node-title">${w.title}</div>
          <div class="node-subtitle">${w.subtitle}</div>
          ${progressText}
        </div>
        ${badge}
      `;

      if (!w.locked) {
        node.addEventListener('click', () => {
          sound.play('button_tap');
          this.onOpen(w.id);
        });
      }
      this.list.appendChild(node);

      if (i < WORLDS.length - 1) {
        const link = document.createElement('div');
        link.className = 'map-link';
        this.list.appendChild(link);
      }
    });
  }
}
