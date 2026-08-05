// lesson.js — плеер урока с тремя типами заданий.

import { codeBlock } from './ui/highlight.js';
import { sound } from './audio/sound_engine.js';
import { telemetry } from './telemetry/client.js';
import { safeTrace } from './trace/tracer.js';

const MAX_HEARTS = 5;

export class LessonPlayer {
  constructor(els, tg) {
    this.els = els;
    this.tg = tg;
    this.onComplete = null;
    this.onQuit = null;
  }

  start(lesson, { onComplete, onQuit } = {}) {
    this.lesson = lesson;
    this.onComplete = onComplete;
    this.onQuit = onQuit;
    this.queue = lesson.questions.map((q, i) => ({ q, originalIndex: i }));
    this.total = this.queue.length;
    this.done = 0;
    this.hearts = MAX_HEARTS;
    this.correctFirstTry = 0;
    this.answeredWrong = new Set();
    this.startTs = Date.now();
    this.current = null;
    this.selection = null;

    telemetry.emit('lesson_start', { lessonId: lesson.id });
    this.renderHearts();
    this.next();
  }

  next() {
    if (this.queue.length === 0) return this.finish(true);
    this.current = this.queue.shift();
    this.selection = null;
    this.renderProgress();
    this.renderQuestion(this.current.q);
    this.els.feedback.classList.add('hidden');
    this.setCheckEnabled(false);
    this.els.checkBtn.textContent = 'Проверить';
  }

  renderProgress() {
    const pct = Math.round((this.done / this.total) * 100);
    this.els.progressFill.style.width = pct + '%';
  }

  renderHearts() {
    let h = '';
    for (let i = 0; i < MAX_HEARTS; i++) h += i < this.hearts ? '❤️' : '🤍';
    this.els.hearts.textContent = h;
  }

  renderQuestion(q) {
    const body = this.els.lessonBody;
    body.scrollTop = 0;
    if (q.type === 'mcq') return this.renderMcq(q);
    if (q.type === 'bug') return this.renderMcq(q, true);
    if (q.type === 'output') return this.renderOutput(q);
    if (q.type === 'assemble') return this.renderAssemble(q);
  }

  // ── MCQ / BUG ──
  renderMcq(q, isBug = false) {
    const opts = q.options.map((opt, i) =>
      `<button class="mcq-opt${/[=()\[\]".]/.test(opt) ? ' mono' : ''}" data-i="${i}">${escapeHtml(opt)}</button>`
    ).join('');
    this.els.lessonBody.innerHTML = `
      <div class="q-prompt">${isBug ? '🐞 ' : ''}${escapeHtml(q.q)}</div>
      ${q.code ? codeBlock(q.code) : ''}
      <div class="mcq-options">${opts}</div>
    `;
    this.els.lessonBody.querySelectorAll('.mcq-opt').forEach(btn => {
      btn.addEventListener('click', () => {
        this.els.lessonBody.querySelectorAll('.mcq-opt').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.selection = parseInt(btn.dataset.i, 10);
        this.setCheckEnabled(true);
        sound.play('button_tap');
      });
    });
  }

  // ── OUTPUT ──
  renderOutput(q) {
    const multiline = q.answer.includes('\n');
    this.els.lessonBody.innerHTML = `
      <div class="q-prompt">${escapeHtml(q.q)}</div>
      ${q.code ? codeBlock(q.code) : ''}
      <textarea class="output-input" id="out-input" rows="${multiline ? 4 : 1}"
        placeholder="Впиши ответ..." autocomplete="off" autocapitalize="off" spellcheck="false"></textarea>
      <div class="output-hint">${multiline ? 'Каждое значение с новой строки' : 'Впиши то, что появится на экране'}</div>
    `;
    const input = this.els.lessonBody.querySelector('#out-input');
    input.addEventListener('input', () => this.setCheckEnabled(input.value.trim().length > 0));
    setTimeout(() => input.focus(), 100);
  }

  // ── ASSEMBLE ──
  renderAssemble(q) {
    // Перемешиваем строки для банка
    const shuffled = q.lines.map((line, i) => ({ line, i }));
    for (let k = shuffled.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      [shuffled[k], shuffled[j]] = [shuffled[j], shuffled[k]];
    }
    this.asmTarget = [];
    this.asmBank = shuffled;
    this.els.lessonBody.innerHTML = `
      <div class="q-prompt">${escapeHtml(q.q)}</div>
      <div class="assemble-target" id="asm-target"></div>
      <div class="assemble-bank" id="asm-bank"></div>
    `;
    this.renderAsm();
  }

  renderAsm() {
    const targetEl = this.els.lessonBody.querySelector('#asm-target');
    const bankEl = this.els.lessonBody.querySelector('#asm-bank');
    targetEl.innerHTML = this.asmTarget.length
      ? this.asmTarget.map((item, pos) =>
          `<div class="asm-line in-target" data-pos="${pos}">${escapeHtml(item.line)}</div>`).join('')
      : '<div class="asm-placeholder">Нажимай строки внизу в правильном порядке</div>';
    bankEl.innerHTML = this.asmBank.map((item, pos) =>
      `<div class="asm-line" data-bank="${pos}">${escapeHtml(item.line)}</div>`).join('');

    targetEl.querySelectorAll('.asm-line').forEach(el => {
      el.addEventListener('click', () => {
        const pos = parseInt(el.dataset.pos, 10);
        const [item] = this.asmTarget.splice(pos, 1);
        this.asmBank.push(item);
        sound.play('button_tap');
        this.renderAsm();
        this.setCheckEnabled(this.asmTarget.length === this.current.q.lines.length);
      });
    });
    bankEl.querySelectorAll('.asm-line').forEach(el => {
      el.addEventListener('click', () => {
        const pos = parseInt(el.dataset.bank, 10);
        const [item] = this.asmBank.splice(pos, 1);
        this.asmTarget.push(item);
        sound.play('button_tap');
        this.renderAsm();
        this.setCheckEnabled(this.asmTarget.length === this.current.q.lines.length);
      });
    });
  }

  setCheckEnabled(v) { this.els.checkBtn.disabled = !v; }

  check() {
    const q = this.current.q;
    let correct = false;
    let correctAnswerText = '';

    if (q.type === 'mcq' || q.type === 'bug') {
      correct = this.selection === q.answer;
      correctAnswerText = q.options[q.answer];
    } else if (q.type === 'output') {
      const input = this.els.lessonBody.querySelector('#out-input');
      correct = this.checkOutput(input.value, q);
      correctAnswerText = q.answer;
    } else if (q.type === 'assemble') {
      correct = this.asmTarget.every((item, i) => item.i === i)
        && this.asmTarget.length === q.lines.length;
      correctAnswerText = q.lines.join('\n');
    }

    this.showFeedback(correct, q, correctAnswerText);
  }

  checkOutput(value, q) {
    const norm = (s) => s.split('\n').map(l => l.trim()).filter((l, i, arr) => !(l === '' && i === arr.length - 1)).join('\n').trim();
    const user = norm(value);
    const variants = [q.answer, ...(q.accept || [])].map(norm);
    return variants.includes(user);
  }

  showFeedback(correct, q, correctAnswerText) {
    const first = !this.answeredWrong.has(this.current.originalIndex);
    if (correct) {
      sound.play('correct');
      this.tg?.HapticFeedback?.notificationOccurred?.('success');
      this.done++;
      if (first) this.correctFirstTry++;
      telemetry.emit('answer', { lessonId: this.lesson.id, qIndex: this.current.originalIndex, correct: true, firstTry: first });
    } else {
      sound.play('error');
      this.tg?.HapticFeedback?.notificationOccurred?.('error');
      this.hearts--;
      this.answeredWrong.add(this.current.originalIndex);
      // вернуть вопрос в конец очереди
      this.queue.push(this.current);
      this.renderHearts();
      telemetry.emit('answer', { lessonId: this.lesson.id, qIndex: this.current.originalIndex, correct: false });
    }
    this.renderProgress();

    // подсветка mcq / bug
    if (q.type === 'mcq' || q.type === 'bug') {
      this.els.lessonBody.querySelectorAll('.mcq-opt').forEach(b => {
        const i = parseInt(b.dataset.i, 10);
        if (i === q.answer) b.classList.add('correct');
        else if (i === this.selection && !correct) b.classList.add('wrong');
        b.style.pointerEvents = 'none';
      });
    }

    const fb = this.els.feedback;
    fb.className = 'feedback ' + (correct ? 'correct' : 'wrong');
    this.els.feedbackHead.textContent = correct ? '✓ Верно!' : '✗ Не так';
    const ansHtml = `<span class="ans">${escapeHtml(correctAnswerText)}</span>`;
    let html = (correct ? '' : `Правильный ответ: ${ansHtml}<br><br>`) + escapeHtml(q.explain);

    // Пошаговая трассировка для output-заданий (только если вывод совпал с проверенным ответом)
    if (q.type === 'output' && q.code) {
      const steps = safeTrace(q.code, q.answer);
      if (steps && steps.length > 1) {
        html += `<div class="trace-wrap">
          <button class="trace-toggle" id="trace-toggle">👁 Показать выполнение по шагам</button>
          <div class="trace-steps hidden" id="trace-steps">${
            steps.map(s => `<div class="trace-step">${escapeHtml(s)}</div>`).join('')
          }</div>
        </div>`;
      }
    }
    this.els.feedbackExplain.innerHTML = html;

    // обработчик раскрытия трассировки
    const toggle = this.els.feedbackExplain.querySelector('#trace-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        const box = this.els.feedbackExplain.querySelector('#trace-steps');
        box.classList.toggle('hidden');
        toggle.textContent = box.classList.contains('hidden')
          ? '👁 Показать выполнение по шагам'
          : '🙈 Скрыть выполнение';
        sound.play('button_tap');
        telemetry.emit('trace_view', { lessonId: this.lesson.id, qIndex: this.current.originalIndex });
      });
    }

    if (this.hearts <= 0) {
      this.els.continueBtn.textContent = 'Попробовать заново';
      this.els.continueBtn.dataset.action = 'fail';
    } else {
      this.els.continueBtn.textContent = 'Продолжить';
      this.els.continueBtn.dataset.action = 'next';
    }
  }

  continue() {
    if (this.els.continueBtn.dataset.action === 'fail') {
      return this.finish(false);
    }
    this.next();
  }

  finish(success) {
    const durationSec = Math.round((Date.now() - this.startTs) / 1000);
    const accuracy = this.total > 0 ? Math.round((this.correctFirstTry / this.total) * 100) : 0;
    telemetry.emit('lesson_complete', { lessonId: this.lesson.id, success, accuracy, durationSec });
    this.onComplete && this.onComplete({
      lessonId: this.lesson.id,
      success,
      accuracy,
      correctCount: this.correctFirstTry,
      totalCount: this.total,
      xp: success ? (this.lesson.xp ?? 10) : 0,
      heartsLeft: this.hearts,
    });
  }

  quit() {
    telemetry.emit('lesson_quit', { lessonId: this.lesson?.id });
    this.onQuit && this.onQuit();
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}
