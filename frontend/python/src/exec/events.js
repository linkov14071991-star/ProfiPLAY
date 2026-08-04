// events.js — типы событий выполнения (см. TDD §4.2)

/**
 * @typedef {Object} ExecEvent
 * @property {string} kind
 * @property {any} [data]
 */

export const EVENT_DURATION_MS = {
  ProgramStart:      100,
  ProgramEnd:        200,
  VariableCreated:   250,
  VariableAssigned:  250,
  RangeCreated:      300,
  ListCreated:       300,
  ListAppended:      250,
  LoopStarted:       200,
  LoopIteration:     100,
  LoopFinished:      100,
  PrintCalled:       500,
  ProfikSay:         900,
  ProfikHop:         350,
  ProfikStep:        220,
  ProfikPickUp:      400,
  ProfikIdle:        500,
  ProfikCheer:       800,
  RuntimeError:      700,
};

export function duration(event, speedMultiplier = 1) {
  const base = EVENT_DURATION_MS[event.kind] ?? 200;
  return Math.max(60, base * speedMultiplier);
}
