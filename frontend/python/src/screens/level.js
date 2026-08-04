// level.js — экран одного уровня (Дюны, будущие миры, Sandbox).

import { parse } from '../lang/parser.js';
import { execute } from '../exec/engine.js';
import { sound } from '../audio/sound_engine.js';
import { telemetry } from '../telemetry/client.js';

export class LevelScreen {
  constructor({ renderer, editor, dialog, console_, els, tg }) {
    this.renderer = renderer;
    this.editor = editor;
    this.dialog = dialog;
    this.console = console_;
    this.els = els;
    this.tg = tg;

    this.level = null;
    this.running = false;
    this.runsThisLevel = 0;
    this.hasSuccess = false;
    this.startTs = 0;
    this.onFinishCb = null;
  }

  load(level, { onFinish } = {}) {
    this.level = level;
    this.runsThisLevel = 0;
    this.hasSuccess = false;
    this.startTs = Date.now();
    this.onFinishCb = onFinish;

    // Топбар
    this.els.topbarTitle.textContent = level.title;
    // Цель
    this.els.goalBanner.innerHTML =
      `<div class="task-label">Задача</div>${this.escape(level.goal)}`;
    this.els.goalBanner.classList.remove('hidden');

    // Сетап рендера
    this.renderer.setScene(level.scene ?? 'dunes');
    if (level.setup && level.setup.tiles) {
      this.renderer.setupDunes(level.setup.tiles, level.setup.profikTile ?? 0);
    } else {
      this.renderer.resetProfik(0.5, 0.72);
      this.renderer.world.tiles = [];
    }

    // Редактор
    this.editor.setReadOnlyCode(level.presetCode);

    // Кнопка
    this.els.btnRun.textContent = '▶ показать';
    this.els.btnRun.disabled = false;
    this.els.btnRun.classList.remove('running');
    this.els.btnRun.classList.add('pulsing');
    const oldNext = this.els.controls.querySelector('.btn-next');
    if (oldNext) oldNext.remove();

    if (level.profikIntro) {
      setTimeout(() => this.dialog.show(level.profikIntro, { autohideMs: 2200 }), 400);
    }

    telemetry.emit('level_start', { levelId: level.id, startTs: this.startTs });
  }

  async run() {
    if (this.running || !this.level) return;
    const lvl = this.level;
    this.running = true;
    this.runsThisLevel++;
    this.els.btnRun.classList.remove('pulsing');
    this.els.btnRun.classList.add('running');
    this.els.btnRun.textContent = '⏸ идёт…';

    this.tg?.HapticFeedback?.impactOccurred?.('medium');
    sound.play('button_tap');
    telemetry.emit('code_run', {
      levelId: lvl.id,
      codeLength: lvl.presetCode.length,
      runCount: this.runsThisLevel,
    });

    // Сброс мира к сетапу (чтобы Профик стартовал с той же плитки при повторе)
    if (lvl.setup?.tiles) {
      this.renderer.setupDunes(lvl.setup.tiles, lvl.setup.profikTile ?? 0);
    }
    this.console.clear();

    let events = [];
    let finalState = null;
    try {
      const ast = parse(lvl.presetCode);
      const result = execute(ast, {
        profikStart: { x: lvl.setup?.profikTile ?? 0, y: 0 },
      });
      events = result.events;
      finalState = result.finalState;
    } catch (e) {
      events = [
        { kind: 'ProgramStart' },
        { kind: 'RuntimeError', message: e.message },
        { kind: 'ProgramEnd', success: false },
      ];
      telemetry.emit('error_shown', { errorType: e.type ?? 'RuntimeError', message: e.message });
    }

    // Проигрываем события
    for (const ev of events) {
      if (ev.kind === 'PrintCalled') sound.play('print_bubble');
      if (ev.kind === 'ProfikHop') sound.play('tile_hop');
      if (ev.kind === 'RuntimeError') sound.play('error');
      await this.renderer.play(ev, 1);
    }

    this.running = false;
    this.els.btnRun.classList.remove('running');

    // Проверка успеха
    const result = lvl.successFn(events, finalState);
    if (result.success) {
      this.onSuccess();
    } else {
      this.onFail(result.reason);
    }
  }

  async onSuccess() {
    if (this.hasSuccess) {
      this.els.btnRun.textContent = '▶ показать ещё раз';
      this.els.btnRun.disabled = false;
      return;
    }
    this.hasSuccess = true;
    sound.play('correct');
    this.tg?.HapticFeedback?.notificationOccurred?.('success');
    // мини-cheer
    await this.renderer.play({ kind: 'ProfikCheer' }, 1);

    if (this.level.profikWin) {
      this.dialog.show(this.level.profikWin, { autohideMs: 2200 });
      await new Promise(r => setTimeout(r, 2200));
    }

    telemetry.emit('level_complete', {
      levelId: this.level.id,
      durationMs: Date.now() - this.startTs,
      runCount: this.runsThisLevel,
      perfect: this.runsThisLevel === 1,
    });

    this.showNextButton();
  }

  onFail(reason) {
    this.tg?.HapticFeedback?.notificationOccurred?.('error');
    telemetry.emit('error_shown', { errorType: 'goal_not_met', reason });
    const winLose = this.level.profikLose;
    const line = typeof winLose === 'string' ? winLose : (winLose?.[reason] ?? 'Хм.');
    this.dialog.show(line, { autohideMs: 2000 });
    setTimeout(() => {
      this.els.btnRun.textContent = '▶ попробовать ещё';
      this.els.btnRun.disabled = false;
      this.els.btnRun.classList.add('pulsing');
    }, 1500);
  }

  showNextButton() {
    this.els.btnRun.textContent = '▶ показать ещё раз';
    const btn = document.createElement('button');
    btn.className = 'btn-next';
    btn.textContent = 'дальше →';
    btn.addEventListener('click', () => {
      sound.play('button_tap');
      this.tg?.HapticFeedback?.impactOccurred?.('light');
      this.onFinishCb && this.onFinishCb({
        levelId: this.level.id,
        perfect: this.runsThisLevel === 1,
        xp: this.level.xpReward ?? 10,
      });
    });
    this.els.controls.appendChild(btn);
  }

  unmount() {
    this.els.goalBanner.classList.add('hidden');
    const oldNext = this.els.controls.querySelector('.btn-next');
    if (oldNext) oldNext.remove();
  }

  escape(s) {
    return s.replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
  }
}
