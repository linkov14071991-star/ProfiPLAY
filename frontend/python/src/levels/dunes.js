// dunes.js — 10 уровней мира «Дюны Возврата».
// Пока реализован Уровень 1, остальные — задел на Этап 4.

/**
 * Формат уровня:
 *   id            — уникальный ID ('dunes.1')
 *   title         — короткое имя
 *   goal          — текст цели игроку (одна фраза, Pillar 3)
 *   presetCode    — код, уже собранный (для block-mode read-only)
 *   editable      — можно ли редактировать
 *   setup         — начальный сетап рендера
 *      profikTile — индекс плитки, на которой стоит Профик (0-based)
 *      tiles      — массив: { index: N, kind: 'tile'|'target'|'gap' }
 *   successFn     — (events, finalState) => { success, reason }
 *   profikIntro   — короткая реплика перед стартом (или null)
 *   profikWin     — реплика при победе
 *   profikLose    — реплика при провале
 *   xpReward      — награда
 */

export const DUNES_LEVELS = [
  {
    id: 'dunes.1',
    title: 'Первый шаг',
    goal: 'Помоги Профику допрыгнуть до сундучка.',
    presetCode: 'for i in range(5):\n    profik.hop()',
    editable: false,
    setup: {
      profikTile: 0,
      tiles: [
        { index: 0, kind: 'tile' },
        { index: 1, kind: 'tile' },
        { index: 2, kind: 'tile' },
        { index: 3, kind: 'tile' },
        { index: 4, kind: 'tile' },
        { index: 5, kind: 'target' },
      ],
    },
    successFn: (events, finalState) => {
      const hops = events.filter(e => e.kind === 'ProfikHop').length;
      if (hops === 5) return { success: true };
      if (hops < 5) return { success: false, reason: 'short' };
      return { success: false, reason: 'over' };
    },
    profikIntro: null,
    profikWin: 'Дошёл. Спасибо.',
    profikLose: {
      short: 'Не дотянулся.',
      over: 'Куда я лечу…',
    },
    xpReward: 15,
  },
  // остальные 9 уровней — Этап 4
];
