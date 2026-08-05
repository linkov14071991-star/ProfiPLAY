// readiness.js — индекс готовности к экзамену (Exam Readiness 0-100).
// Состав (по совету эксперта):
//   Точность    40%  — доля верных первых попыток по всем темам
//   Стабильность 25% — как держатся знания на повторениях (daily/weekly/review)
//   Скорость     20% — среднее время на ответ
//   Сложные      15% — точность на задачах-боссах (ЕГЭ №8,24,25,27)

function pct(correct, total) {
  if (!total) return null;
  return Math.round((correct / total) * 100);
}

function sumStats(map) {
  let c = 0, t = 0;
  for (const s of Object.values(map || {})) { c += s.correct || 0; t += s.total || 0; }
  return { correct: c, total: t };
}

// Скорость: среднее мс на ответ → балл. ≤8с = 100, ≥25с = 40, линейно.
function speedScore(speedStats) {
  if (!speedStats || !speedStats.count) return null;
  const avgMs = speedStats.totalMs / speedStats.count;
  const avgSec = avgMs / 1000;
  if (avgSec <= 8) return 100;
  if (avgSec >= 25) return 40;
  return Math.round(100 - (avgSec - 8) / (25 - 8) * 60);
}

export function readiness(state) {
  const all = sumStats(state.topicStats);
  const accuracy = pct(all.correct, all.total);          // может быть null
  const stability = pct((state.reviewStats || {}).correct, (state.reviewStats || {}).total);
  const speed = speedScore(state.speedStats);
  const boss = pct((state.bossStats || {}).correct, (state.bossStats || {}).total);

  // Компоненты с фолбэками. Пока данных мало — используем то, что есть.
  const cAcc = accuracy ?? 0;
  const cStab = stability ?? cAcc;                       // нет повторений — берём точность
  const cSpeed = speed ?? 70;                            // нет замеров — нейтрально
  const cBoss = boss ?? 0;                               // боссы не решались — 0 (честно: не готов)

  const total = Math.round(cAcc * 0.40 + cStab * 0.25 + cSpeed * 0.20 + cBoss * 0.15);

  return {
    total,
    components: [
      { key: 'accuracy',  label: 'Точность',     weight: 40, value: accuracy, has: accuracy != null },
      { key: 'stability', label: 'Стабильность', weight: 25, value: stability, has: stability != null },
      { key: 'speed',     label: 'Скорость',     weight: 20, value: speed, has: speed != null },
      { key: 'boss',      label: 'Сложные задачи', weight: 15, value: boss, has: boss != null },
    ],
    hasData: all.total > 0,
  };
}

// Короткая подпись под числом
export function readinessLabel(total) {
  if (total >= 85) return 'Отличная форма — экзамен по плечу';
  if (total >= 70) return 'Хорошо, но есть куда расти';
  if (total >= 50) return 'База есть, налегай на сложные задачи';
  if (total >= 30) return 'Начало положено, продолжай';
  return 'Только старт — вперёд по темам';
}

// Цвет индекса
export function readinessColor(total) {
  if (total >= 85) return '#58cc02';
  if (total >= 70) return '#a3d900';
  if (total >= 50) return '#ffd700';
  if (total >= 30) return '#ff9425';
  return '#ff6b6b';
}
