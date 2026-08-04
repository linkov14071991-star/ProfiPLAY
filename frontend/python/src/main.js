// main.js — bootstrap Python-режима + screen router.

import { parse } from './lang/parser.js';
import { execute } from './exec/engine.js';
import { Renderer } from './render/renderer.js';
import { sound } from './audio/sound_engine.js';
import { ProfikDialog } from './ui/profik_dialog.js';
import { Console } from './ui/console.js';
import { Editor } from './ui/editor.js';
import { cloud } from './state/cloud_storage.js';
import { telemetry } from './telemetry/client.js';
import { PROLOGUE_SCENES } from './levels/prologue.js';
import { DUNES_LEVELS } from './levels/dunes.js';
import { WORLDS } from './worlds.js';
import { MapScreen } from './screens/map.js';
import { LevelScreen } from './screens/level.js';

const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const els = {
  screens: {
    game: document.getElementById('screen-game'),
    map: document.getElementById('screen-map'),
    ceremony: document.getElementById('screen-ceremony'),
  },
  canvas: document.getElementById('canvas'),
  console: document.getElementById('console-overlay'),
  bubble: document.getElementById('profik-bubble'),
  editor: document.getElementById('editor'),
  btnRun: document.getElementById('btn-run'),
  btnBack: document.getElementById('btn-back'),
  btnMenu: document.getElementById('btn-menu'),
  topbarTitle: document.getElementById('topbar-title'),
  controls: document.getElementById('controls'),
  goalBanner: document.getElementById('goal-banner'),
  ceremonyShard: document.getElementById('ceremony-shard'),
  ceremonyTitle: document.getElementById('ceremony-title'),
  ceremonyLore: document.getElementById('ceremony-lore'),
  ceremonyNext: document.getElementById('ceremony-next'),
};

// корректный размер canvas
requestAnimationFrame(() => {
  const rect = els.canvas.getBoundingClientRect();
  els.canvas.style.height = (rect.width * 4 / 3) + 'px';
});

const renderer = new Renderer(els.canvas);
const dialog = new ProfikDialog(els.bubble);
const console_ = new Console(els.console);
const editor = new Editor(els.editor);

renderer.callbacks.onBubbleShow = (text, x, y) => dialog.show(text, { x, y, autohideMs: 1400 });
renderer.callbacks.onBubbleHide = () => dialog.hide();
renderer.callbacks.onConsoleWrite = (text) => console_.write(text);

telemetry.init(tg?.initDataUnsafe?.user?.id ?? 0);

// звук — при первом тапе
document.addEventListener('pointerdown', async () => {
  await sound.init();
  await sound.resume();
}, { once: true });

// ── Screens ─────────────────────────────────
const mapScreen = new MapScreen(els.screens.map, (worldId) => enterWorld(worldId));
const levelScreen = new LevelScreen({ renderer, editor, dialog, console_, els, tg });

let currentScreen = 'prologue';   // 'prologue' | 'map' | 'level' | 'ceremony'
let prologueIndex = 0;
let currentWorldId = null;
let currentLevelIndex = 0;

function showScreen(name) {
  // prologue и level шэрят #screen-game
  els.screens.game.classList.toggle('hidden', name !== 'prologue' && name !== 'level');
  els.screens.map.classList.toggle('hidden', name !== 'map');
  els.screens.ceremony.classList.toggle('hidden', name !== 'ceremony');
  // при показе canvas — пересчитать размер
  if (name === 'prologue' || name === 'level') {
    requestAnimationFrame(() => {
      const rect = els.canvas.getBoundingClientRect();
      if (rect.width > 0) {
        els.canvas.style.height = (rect.width * 4 / 3) + 'px';
        renderer.setupDpr();
      }
    });
  }
}

// ── Prologue ────────────────────────────────
function loadProloguePreset() {
  const scene = PROLOGUE_SCENES[prologueIndex];
  if (!scene) return goToMap();

  currentScreen = 'prologue';
  showScreen('prologue');
  els.topbarTitle.textContent = `Пролог · ${scene.title}`;
  els.goalBanner.innerHTML =
    `<div class="task-label">Задача</div>${scene.goal}`;
  els.goalBanner.classList.remove('hidden');
  renderer.setScene(scene.scene ?? 'stage');
  renderer.world.tiles = [];
  renderer.resetProfik(0.5, 0.72);
  editor.setReadOnlyCode(scene.presetCode);

  els.btnRun.textContent = '▶ показать';
  els.btnRun.disabled = false;
  els.btnRun.classList.remove('running');
  els.btnRun.classList.add('pulsing');
  const oldNext = els.controls.querySelector('.btn-next');
  if (oldNext) oldNext.remove();

  telemetry.emit('level_start', { levelId: `prologue.${scene.id}`, startTs: Date.now() });
}

let prologueState = { running: false, hasSuccess: false, runs: 0, startTs: 0 };

async function runPrologueScene() {
  if (prologueState.running) return;
  const scene = PROLOGUE_SCENES[prologueIndex];
  prologueState.running = true;
  prologueState.runs++;
  els.btnRun.classList.remove('pulsing');
  els.btnRun.classList.add('running');
  els.btnRun.textContent = '⏸ идёт…';

  tg?.HapticFeedback?.impactOccurred?.('medium');
  sound.play('button_tap');
  console_.clear();

  let events = [];
  try {
    const ast = parse(scene.presetCode);
    events = execute(ast).events;
  } catch (e) {
    events = [{ kind: 'ProgramStart' }, { kind: 'RuntimeError', message: e.message }, { kind: 'ProgramEnd', success: false }];
  }

  for (const ev of events) {
    if (ev.kind === 'PrintCalled') sound.play('print_bubble');
    if (ev.kind === 'RuntimeError') sound.play('error');
    await renderer.play(ev, 1);
  }

  prologueState.running = false;
  els.btnRun.classList.remove('running');

  const last = events[events.length - 1];
  const success = last && last.kind === 'ProgramEnd' && last.success !== false;
  if (success && !prologueState.hasSuccess) {
    prologueState.hasSuccess = true;
    sound.play('correct');
    tg?.HapticFeedback?.notificationOccurred?.('success');
    if (scene.profikOutro) {
      dialog.show(scene.profikOutro, { autohideMs: 2500 });
      await new Promise(r => setTimeout(r, 2500));
    }
    saveProloguePassed(scene.id);
    telemetry.emit('level_complete', {
      levelId: `prologue.${scene.id}`,
      runCount: prologueState.runs,
    });
    showPrologueNext();
  } else if (!success) {
    tg?.HapticFeedback?.notificationOccurred?.('error');
    els.btnRun.textContent = '▶ попробовать ещё';
    els.btnRun.classList.add('pulsing');
  } else {
    els.btnRun.textContent = '▶ показать ещё раз';
    els.btnRun.disabled = false;
  }
}

function showPrologueNext() {
  els.btnRun.textContent = '▶ показать ещё раз';
  const btn = document.createElement('button');
  btn.className = 'btn-next';
  btn.textContent = prologueIndex === PROLOGUE_SCENES.length - 1 ? 'В Дюны →' : 'Дальше →';
  btn.addEventListener('click', () => {
    sound.play('button_tap');
    tg?.HapticFeedback?.impactOccurred?.('light');
    prologueIndex++;
    prologueState = { running: false, hasSuccess: false, runs: 0, startTs: 0 };
    if (prologueIndex >= PROLOGUE_SCENES.length) {
      cloud.setJson('python.prologueCompleted', 1);
      goToMap();
    } else {
      loadProloguePreset();
    }
  });
  els.controls.appendChild(btn);
}

async function saveProloguePassed(id) {
  const p = await cloud.getJson('python.prologueProgress', { completed: [] });
  if (!p.completed.includes(id)) p.completed.push(id);
  await cloud.setJson('python.prologueProgress', p);
}

// ── Map ─────────────────────────────────────
async function goToMap() {
  currentScreen = 'map';
  els.topbarTitle.textContent = 'Карта миров';
  els.goalBanner.classList.add('hidden');
  showScreen('map');
  await mapScreen.show();
}

// ── World / Level ───────────────────────────
function enterWorld(worldId) {
  currentWorldId = worldId;
  loadCurrentLevel(worldId);
}

function getLevelsForWorld(worldId) {
  if (worldId === 'dunes') return DUNES_LEVELS;
  return [];
}

async function loadCurrentLevel(worldId, forceIndex) {
  const levels = getLevelsForWorld(worldId);
  if (levels.length === 0) return goToMap();
  const progress = await cloud.getJson('python.worldsProgress', {});
  const done = progress[worldId]?.completed ?? 0;
  currentLevelIndex = forceIndex != null
    ? Math.min(forceIndex, levels.length - 1)
    : Math.min(done, levels.length - 1);
  const level = levels[currentLevelIndex];
  currentScreen = 'level';
  showScreen('level');
  levelScreen.load(level, { onFinish: onLevelFinish });
}

async function onLevelFinish({ levelId, perfect, xp }) {
  const progress = await cloud.getJson('python.worldsProgress', {});
  const wp = progress[currentWorldId] || { completed: 0, perfect: 0 };
  const levels = getLevelsForWorld(currentWorldId);
  if (currentLevelIndex + 1 > wp.completed) wp.completed = currentLevelIndex + 1;
  if (perfect) wp.perfect = (wp.perfect || 0) + 1;
  progress[currentWorldId] = wp;
  await cloud.setJson('python.worldsProgress', progress);

  // Начисляем XP (пока — только клиентское напоминание; backend позже)
  telemetry.emit('level_xp_awarded', { levelId, xp });

  levelScreen.unmount();

  const nextIndex = currentLevelIndex + 1;
  if (nextIndex >= levels.length) {
    // мир пройден — Этап 5 добавит церемонию раскрытия Осколка
    goToMap();
  } else {
    currentLevelIndex = nextIndex;
    loadCurrentLevel(currentWorldId, nextIndex);
  }
}

// ── Кнопки ──────────────────────────────────
els.btnRun.addEventListener('click', () => {
  if (currentScreen === 'prologue') runPrologueScene();
  else if (currentScreen === 'level') levelScreen.run();
});

els.btnBack.addEventListener('click', () => {
  sound.play('button_tap');
  if (currentScreen === 'level') {
    levelScreen.unmount();
    goToMap();
  } else if (currentScreen === 'map') {
    telemetry.flush();
    window.location.href = '../index.html';
  } else if (currentScreen === 'prologue') {
    telemetry.flush();
    window.location.href = '../index.html';
  } else {
    window.location.href = '../index.html';
  }
});

els.btnMenu.addEventListener('click', () => {
  tg?.showAlert?.('Меню появится позже.');
});

els.ceremonyNext.addEventListener('click', () => {
  goToMap();
});

// ── Старт ───────────────────────────────────
(async () => {
  const prologueDone = await cloud.get('python.prologueCompleted');
  if (prologueDone) {
    goToMap();
  } else {
    prologueIndex = 0;
    loadProloguePreset();
  }
})();
