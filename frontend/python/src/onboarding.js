// onboarding.js — приветствие, анкета, placement-тест, рекомендация уровня.

import { codeBlock } from './ui/highlight.js';
import { sound } from './audio/sound_engine.js';
import { CURRICULUM, FIRST_EGE_UNIT_INDEX } from './curriculum/index.js';
import { EXAM_PRESETS } from './mentor.js';

// Placement-вопросы: возрастающая сложность. Каждый привязан к юниту.
const PLACEMENT = [
  { unitIdx: 0, q: 'Что выведет print(2 + 3)?', options: ['23', '5', '2 3', 'ошибка'], answer: 1 },
  { unitIdx: 4, q: 'Что выведет код?', code: 'x = 7\nif x > 5:\n    print("да")\nelse:\n    print("нет")', options: ['да', 'нет', '7', 'ошибка'], answer: 0 },
  { unitIdx: 6, q: 'Сколько чисел выведет for i in range(1, 4)?', options: ['4', '3', '2', '1'], answer: 1 },
  { unitIdx: 8, q: 'Что выведет код?', code: 'a = [10, 20, 30]\nprint(a[1])', options: ['10', '20', '30', 'ошибка'], answer: 1 },
  { unitIdx: 10, q: 'Что выведет код?', code: 'def f(x):\n    return x * x\nprint(f(4))', options: ['8', '16', '4', 'ошибка'], answer: 1 },
  { unitIdx: 11, q: 'Что выведет "Python"[::-1]?', code: 'print("Python"[::-1])', options: ['Python', 'nohtyP', 'P', 'ошибка'], answer: 1 },
];

export class Onboarding {
  constructor(wrapEl, tg) {
    this.wrap = wrapEl;
    this.tg = tg;
    this.answers = { goal: null, experience: null };
    this.placementScore = 0;
    this.placementIndex = 0;
    this.highestPassedUnit = -1;
  }

  start(onDone) {
    this.onDone = onDone;
    this.step = 0;
    this.renderWelcome();
  }

  // Шаг 0 — приветствие
  renderWelcome() {
    this.wrap.innerHTML = `
      <img class="onboard-cat-img" src="profik.svg" alt="Профик">
      <div class="onboard-title">Привет! Я Профик.</div>
      <div class="onboard-sub">Помогу тебе подготовиться к экзамену по информатике.<br>Пройдём Python шаг за шагом.</div>
      <div class="onboard-options"></div>
      <button class="onboard-cta" id="ob-next">Поехали</button>
    `;
    this.wrap.querySelector('#ob-next').onclick = () => { sound.play('button_tap'); this.renderGoal(); };
  }

  // Шаг 1 — цель
  renderGoal() {
    this.renderChoice({
      dots: 4, active: 0,
      cat: '🎯',
      title: 'К какому экзамену готовишься?',
      options: [
        { key: 'oge', label: 'ОГЭ', desc: '9 класс' },
        { key: 'ege', label: 'ЕГЭ', desc: '11 класс' },
        { key: 'both', label: 'Просто хочу выучить Python', desc: 'Без привязки к экзамену' },
      ],
      onPick: (key) => {
        this.answers.goal = key;
        // дата экзамена — из цели (без лишнего шага)
        if (key === 'oge') { const p = EXAM_PRESETS.find(x => x.key === 'oge'); this.answers.examMonth = p.month; this.answers.examDay = p.day; }
        else if (key === 'ege') { const p = EXAM_PRESETS.find(x => x.key === 'ege'); this.answers.examMonth = p.month; this.answers.examDay = p.day; }
        else { this.answers.examMonth = null; this.answers.examDay = null; }
        if (key === 'both') { this.answers.targetScore = null; this.renderExperience(); }
        else this.renderTarget(key);
      },
    });
  }

  // Шаг 1.5 — целевой результат (эмоциональный якорь)
  renderTarget(goal) {
    const isOge = goal === 'oge';
    const cfg = isOge
      ? {
          title: 'На какую оценку метишь?',
          sub: 'Поставим цель — и я поведу тебя к ней.',
          options: [
            { key: '4', label: 'На 4', desc: 'уверенный результат' },
            { key: '5', label: 'На 5', desc: 'по-максимуму' },
          ],
        }
      : {
          title: 'На сколько баллов метишь?',
          sub: 'Выбирай смело — цель важнее, чем кажется. Я подстрою маршрут.',
          options: [
            { key: '75', label: '75+ баллов', desc: 'проходной на бюджет' },
            { key: '85', label: '85+ баллов', desc: 'сильный результат' },
            { key: '95', label: '95+ баллов', desc: 'на максимум' },
          ],
        };
    this.renderChoice({
      dots: 4, active: 0, cat: '🎯',
      title: cfg.title, sub: cfg.sub, options: cfg.options,
      onPick: (key) => { this.answers.targetScore = parseInt(key, 10); this.renderExperience(); },
    });
  }

  // Шаг 2 — опыт
  renderExperience() {
    this.renderChoice({
      dots: 4, active: 1,
      cat: '🧠',
      title: 'Ты уже программировал?',
      options: [
        { key: 'none', label: 'Совсем нет', desc: 'Начинаю с нуля' },
        { key: 'little', label: 'Немного', desc: 'Знаю основы' },
        { key: 'yes', label: 'Да, уверенно', desc: 'Пишу код' },
      ],
      onPick: (key) => {
        this.answers.experience = key;
        if (key === 'none') {
          // новичка не мучаем тестом
          this.highestPassedUnit = -1;
          this.renderResult(-1);
        } else {
          this.renderPlacementIntro();
        }
      },
    });
  }

  renderPlacementIntro() {
    this.wrap.innerHTML = `
      <div class="onboard-progress">${this.dots(4, 2)}</div>
      <div class="onboard-cat">📝</div>
      <div class="onboard-title">Небольшой тест</div>
      <div class="onboard-sub">6 вопросов, чтобы понять с чего тебе лучше начать. Не переживай за ошибки — это не оценка.</div>
      <div class="onboard-options"></div>
      <button class="onboard-cta" id="ob-next">Начать тест</button>
    `;
    this.wrap.querySelector('#ob-next').onclick = () => { sound.play('button_tap'); this.placementIndex = 0; this.renderPlacement(); };
  }

  renderPlacement() {
    const p = PLACEMENT[this.placementIndex];
    if (!p) return this.renderResult(this.highestPassedUnit);
    this.selection = null;
    // перемешиваем показ вариантов, исходный индекс — в data-i
    const order = p.options.map((o, i) => ({ o, i }));
    for (let k = order.length - 1; k > 0; k--) {
      const j = Math.floor(Math.random() * (k + 1));
      [order[k], order[j]] = [order[j], order[k]];
    }
    const opts = order.map(({ o, i }) =>
      `<button class="opt-btn${/[=()\[\]".0-9]/.test(o) ? ' mono' : ''}" data-i="${i}">${escapeHtml(o)}</button>`).join('');
    this.wrap.innerHTML = `
      <div class="onboard-progress">${this.dots(6, this.placementIndex)}</div>
      <div class="onboard-title" style="font-size:20px;">${escapeHtml(p.q)}</div>
      ${p.code ? codeBlock(p.code) : ''}
      <div class="onboard-options">${opts}</div>
      <button class="onboard-cta" id="ob-next" disabled>Ответить</button>
    `;
    const cta = this.wrap.querySelector('#ob-next');
    this.wrap.querySelectorAll('.opt-btn').forEach(btn => {
      btn.onclick = () => {
        this.wrap.querySelectorAll('.opt-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.selection = parseInt(btn.dataset.i, 10);
        cta.disabled = false;
        sound.play('button_tap');
      };
    });
    cta.onclick = () => {
      if (this.selection === p.answer) {
        this.highestPassedUnit = Math.max(this.highestPassedUnit, p.unitIdx);
        sound.play('correct');
      } else {
        sound.play('error');
      }
      this.placementIndex++;
      this.renderPlacement();
    };
  }

  renderResult(startUnitIdx) {
    // Рекомендованный юнит
    let recIdx = Math.max(0, startUnitIdx);
    // если новичок с целью ЕГЭ — всё равно начинаем с ОГЭ-базы
    if (this.answers.experience === 'none') recIdx = 0;
    // не перепрыгиваем весь курс — максимум оставляем 1 юнит форы
    const rec = CURRICULUM[Math.min(recIdx, CURRICULUM.length - 1)];

    const levelText = startUnitIdx < 0
      ? 'Начнём с самых азов — с вывода на экран.'
      : `По тесту ты уже знаешь основы. Рекомендую начать с темы «${rec.title}».`;

    this.wrap.innerHTML = `
      <div class="onboard-cat">🎉</div>
      <div class="onboard-title">Готово!</div>
      <div class="onboard-sub">${levelText}</div>
      <div class="onboard-options">
        <button class="opt-btn selected" id="rec-start">
          Начать с «${escapeHtml(rec.title)}»
          <span class="opt-desc">${rec.level} · рекомендовано</span>
        </button>
        <button class="opt-btn" id="rec-scratch">
          Начать с самого начала
          <span class="opt-desc">Пройти всё по порядку</span>
        </button>
      </div>
      <button class="onboard-cta" id="ob-finish">В курс →</button>
    `;
    let chosenUnitIdx = recIdx;
    const startBtn = this.wrap.querySelector('#rec-start');
    const scratchBtn = this.wrap.querySelector('#rec-scratch');
    startBtn.onclick = () => { chosenUnitIdx = recIdx; startBtn.classList.add('selected'); scratchBtn.classList.remove('selected'); sound.play('button_tap'); };
    scratchBtn.onclick = () => { chosenUnitIdx = 0; scratchBtn.classList.add('selected'); startBtn.classList.remove('selected'); sound.play('button_tap'); };
    this.wrap.querySelector('#ob-finish').onclick = () => {
      sound.play('correct');
      this.onDone({
        goal: this.answers.goal,
        experience: this.answers.experience,
        startUnitIndex: chosenUnitIdx,
        examMonth: this.answers.examMonth,
        examDay: this.answers.examDay,
        targetScore: this.answers.targetScore ?? null,
      });
    };
  }

  renderChoice({ dots, active, cat, title, sub, options, onPick }) {
    const opts = options.map(o =>
      `<button class="opt-btn" data-key="${o.key}">${escapeHtml(o.label)}<span class="opt-desc">${escapeHtml(o.desc)}</span></button>`).join('');
    this.wrap.innerHTML = `
      <div class="onboard-progress">${this.dots(dots, active)}</div>
      <div class="onboard-cat">${cat}</div>
      <div class="onboard-title">${escapeHtml(title)}</div>
      ${sub ? `<div class="onboard-sub">${escapeHtml(sub)}</div>` : ''}
      <div class="onboard-options">${opts}</div>
      <button class="onboard-cta" id="ob-next" disabled>Дальше</button>
    `;
    let picked = null;
    const cta = this.wrap.querySelector('#ob-next');
    this.wrap.querySelectorAll('.opt-btn').forEach(btn => {
      btn.onclick = () => {
        this.wrap.querySelectorAll('.opt-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        picked = btn.dataset.key;
        cta.disabled = false;
        sound.play('button_tap');
      };
    });
    cta.onclick = () => { if (picked) { sound.play('button_tap'); onPick(picked); } };
  }

  dots(n, active) {
    let s = '';
    for (let i = 0; i < n; i++) s += `<span class="onboard-dot${i <= active ? ' active' : ''}"></span>`;
    return s;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
}
