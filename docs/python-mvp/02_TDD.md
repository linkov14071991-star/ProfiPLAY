# 02 · Technical Design Document (TDD)

**Проект:** Python-режим «Профик Арены»
**Стек:** Vanilla JS + Canvas 2D + Web Audio API, backend FastAPI/SQLite (уже развёрнут)
**Версия:** 1.0

> Что за игра — см. `01_GDD.md`. Арт — `03_ArtBible.md`. Уровни — `04_LevelDesignBible.md`.
> Этот документ отвечает разработчику на вопрос **«как это устроено внутри».**

---

## 1. Архитектура: 5 слоёв

```
┌──────────────────────────────────────────┐
│  Level (JSON — задача + ожидаемое)       │
└──────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────┐
│  Editor (сборка кода игроком)            │
└──────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────┐
│  Parser (текст → AST наших типов)        │
└──────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────┐
│  Execution Engine (AST → поток событий)  │
└──────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────┐
│  Event Bus (очередь событий с таймингом) │
└──────────────────────────────────────────┘
                    ↓
┌──────────────────────────────────────────┐
│  Renderer + Sound + Haptics              │
└──────────────────────────────────────────┘
```

**Ключевой принцип от эксперта:** Renderer НЕ знает Python. Он знает только события. Это позволяет добавлять новые Python-конструкции без переписывания рендера.

---

## 2. Editor (слой сборки кода)

### 2.1. Два режима ввода

- **Block-mode** (уровни 1-8): игрок таскает блоки-кнопки. Каждый блок = токен (`for`, `range`, `5`, `:`, `hop()`).
- **Text-mode** (уровни 9-10 и Sandbox): игрок печатает Python в моноширинном инпуте с подсветкой.

Переход между режимами — постепенный. В `04_LevelDesignBible.md` для каждого уровня указано.

### 2.2. Что возвращает Editor

Всегда одно и то же: **строку Python-кода**. Дальше её ест Parser.

```typescript
interface EditorOutput {
  code: string;                  // "for i in range(5):\n    profik.hop()"
  timestamp: number;             // ms since level start
  editEventCount: number;        // сколько раз игрок менял код
}
```

---

## 3. Parser

**Не тащим настоящий Python-парсер.** Берём подмножество:

- `print(...)`, `profik.hop()`, `profik.say(...)`, `profik.pick_up(...)`
- Присваивание `x = expr`
- `for VAR in ITERABLE:` где ITERABLE ∈ {`range(...)`, литерал-список, литерал-строка, переменная}
- Литералы: int, str в двойных кавычках, list `[...]`
- Индексация `a[0]`
- Простые сравнения (для Мира 4, не в срезе)

**Реализация:** ручной recursive descent parser в `src/lang/parser.js`. Никаких зависимостей. ~400 строк кода.

**Ошибки парсинга** возвращаются как объект:

```typescript
interface ParseError {
  type: 'ParseError';
  message: string;               // русский текст: "не хватает :"
  hint?: string;                 // мягкая подсказка
  position: {line: number, col: number};
}
```

---

## 4. Execution Engine (ключевой новый слой)

Слой, которого не было в v3. Единственный, кто «понимает» Python.

### 4.1. AST → Events

Engine обходит AST и генерирует **упорядоченный поток событий**. Не рендерит, не играет звуки — просто складывает события в очередь.

### 4.2. Каталог событий (для среза)

```typescript
type ExecEvent =
  | {kind: 'ProgramStart'}
  | {kind: 'ProgramEnd', success: boolean}
  | {kind: 'VariableCreated', name: string, value: PyValue}
  | {kind: 'VariableAssigned', name: string, oldValue: PyValue, newValue: PyValue}
  | {kind: 'RangeCreated', id: string, start: number, stop: number, step: number}
  | {kind: 'ListCreated', id: string, items: PyValue[]}
  | {kind: 'ListAppended', id: string, item: PyValue}
  | {kind: 'LoopStarted', loopId: string, iterVar: string, iterableId: string}
  | {kind: 'LoopIteration', loopId: string, iterationIndex: number, iterValue: PyValue}
  | {kind: 'LoopFinished', loopId: string}
  | {kind: 'PrintCalled', text: string}
  | {kind: 'ProfikHop', from: Position, to: Position}
  | {kind: 'ProfikSay', text: string}
  | {kind: 'ProfikPickUp', targetId: string}
  | {kind: 'ProfikIdle', duration: number}
  | {kind: 'RuntimeError', type: string, message: string, position: Position}
```

### 4.3. Пример: `for i in range(3): profik.hop()`

Engine выдаёт:

```
ProgramStart
RangeCreated(id="r1", start=0, stop=3, step=1)
LoopStarted(loopId="l1", iterVar="i", iterableId="r1")
LoopIteration(loopId="l1", iterationIndex=0, iterValue=0)
VariableAssigned(name="i", oldValue=null, newValue=0)
ProfikHop(from=P0, to=P1)
LoopIteration(loopId="l1", iterationIndex=1, iterValue=1)
VariableAssigned(name="i", oldValue=0, newValue=1)
ProfikHop(from=P1, to=P2)
LoopIteration(loopId="l1", iterationIndex=2, iterValue=2)
VariableAssigned(name="i", oldValue=1, newValue=2)
ProfikHop(from=P2, to=P3)
LoopFinished(loopId="l1")
ProgramEnd(success=true)
```

Каждое событие имеет **логическое время** (индекс) и **целевую длительность** — но само по себе не рендерит.

### 4.4. State (для интроспекции и отладки)

Engine держит внутреннее состояние:

```typescript
interface ExecState {
  vars: Map<string, PyValue>;
  objects: Map<string, PyObject>;   // range, list, etc. — все с id
  profikPos: Position;
  callStack: Frame[];
  outputBuffer: string[];           // для print
}
```

Доступ снаружи — только для debug-режима.

---

## 5. Event Bus и Playback

События **не воспроизводятся мгновенно**. Игрок нажимает `▶ показать` — тогда бас начинает проигрывать.

### 5.1. Playback контроллер

```typescript
class Playback {
  events: ExecEvent[];
  speed: 0.5 | 1 | 2 | 'step';    // управление скоростью
  isPlaying: boolean;
  currentIndex: number;

  play(): void;
  pause(): void;
  stepForward(): void;
  reset(): void;
  setSpeed(s): void;
}
```

### 5.2. Замер тайминга каждого события

Событие рендерится не мгновенно, а через таблицу длительностей:

```typescript
const EVENT_DURATION_MS: Record<ExecEvent['kind'], number> = {
  ProgramStart: 100,
  RangeCreated: 300,           // плитки выкладываются
  LoopStarted: 200,
  LoopIteration: 100,          // короткая пауза перед действием
  VariableAssigned: 200,       // коробка меняет цифру
  ProfikHop: 350,              // прыжок с ease-out
  ProfikSay: 800,              // облако видно
  ProfikIdle: 500,
  PrintCalled: 400,
  ListCreated: 300,
  ListAppended: 250,
  LoopFinished: 100,
  ProgramEnd: 200,
  RuntimeError: 700,           // shake + пффф
  // ...
};
```

Скорости:
- **0.5×** — все длительности ×2
- **1×** — как в таблице
- **2×** — все ×0.5, минимум 80мс
- **step** — все длительности игнорируются, ждём тапа игрока

---

## 6. Object Model

**Архитектурное правило (по требованию эксперта):** новые типы объектов регистрируются через фабрику, а не хардкодятся в switch. Это позволит добавлять новые Python-конструкции без правки Renderer/Engine.

```typescript
interface PyObjectDefinition {
  kind: string;                                    // 'variable', 'list', 'range', ...
  create(spec: any): PyObject;
  render(obj: PyObject, ctx: CanvasRenderingContext2D): void;
  animate?(obj: PyObject, event: ExecEvent): AnimHandle | null;
}

class PyObjectRegistry {
  register(def: PyObjectDefinition): void;
  create(kind: string, spec: any): PyObject;
  render(obj: PyObject, ctx: CanvasRenderingContext2D): void;
}
```

При старте Python-режима:
```typescript
registry.register(variableDefinition);
registry.register(listDefinition);
registry.register(rangeDefinition);
// ... позже:
// registry.register(dictDefinition);
// registry.register(setDefinition);
```

Полный список типов для среза:

```typescript
type PyValue = number | string | boolean | null | PyList | PyRange;

interface PyList {
  kind: 'list';
  id: string;
  items: PyValue[];
}

interface PyRange {
  kind: 'range';
  id: string;
  start: number;
  stop: number;
  step: number;
}

interface PyObject {         // визуальное представление
  id: string;                // тот же id, что у PyValue
  visualType: 'box' | 'train' | 'path' | 'tile' | 'label';
  x: number; y: number;
  currentAnim?: AnimHandle;
}
```

Соответствие value → visual:

| PyValue | visualType |
|---|---|
| number | tile |
| string | path из tiles |
| PyList | train |
| PyRange | path |
| VariableBox (обёртка) | box |

---

## 7. Renderer

### 7.1. Технология

- Один `<canvas>` 360×640 (портрет, DPR-aware).
- `requestAnimationFrame` loop.
- 60 fps в активной сцене, `cancelAnimationFrame` в паузе.

### 7.2. Слои рендера (снизу вверх)

1. **Background** — SVG-фон мира (drawImage один раз в кадр).
2. **Static world objects** — плитки, поезда, коробки (без анимации).
3. **Animated objects** — те же объекты, но в момент анимации.
4. **Profik** — SVG-спрайт (см. Art Bible).
5. **Foreground FX** — вспышки, частицы, дрожь.
6. **UI overlay** — DOM поверх canvas (кнопки, реплики Профика, консоль).

### 7.3. Producer/Consumer с Event Bus

```typescript
class Renderer {
  onEvent(event: ExecEvent, duration: number): Promise<void> {
    // конвертирует event → анимацию, ждёт её завершения
    // resolve() = событие полностью отрендерено
  }
}
```

Playback ждёт `await renderer.onEvent(...)` перед следующим событием.

### 7.4. Анимационная библиотека

Не тащим ни GSAP, ни tween.js. Своя мини-либа `src/anim/tween.js` (~50 строк):

```typescript
function tween({
  from: number,
  to: number,
  duration: number,
  ease: (t: number) => number,
  onUpdate: (v: number) => void,
  onComplete?: () => void,
}): AnimHandle;
```

Каталог easings: `linear`, `easeOutQuad`, `easeOutCubic`, `easeOutBack`, `easeInOutCubic`. Всё из `easings.net`.

---

## 8. Sound Engine

### 8.1. Технология

Web Audio API, преcompiled buffers.

```typescript
class SoundEngine {
  loadAll(): Promise<void>;                    // при старте Python-режима
  play(key: SfxKey, opts?: {volume?: number}): void;
  loopEnv(key: EnvKey): void;                  // окружение мира
  stopEnv(): void;
}
```

### 8.2. Каталог (для среза)

| Ключ | Файл | Длительность | Использование |
|---|---|---|---|
| `sfx.box_open` | box_open.ogg | 90ms | коробка раскрылась |
| `sfx.box_fill` | box_fill.ogg | 120ms | значение положили в коробку |
| `sfx.tile_step` | tile_step.ogg | 80ms | Профик шагнул на плитку |
| `sfx.tile_hop` | tile_hop.ogg | 150ms | Профик прыгнул |
| `sfx.correct` | correct.ogg | 250ms | правильный ответ (уровень пройден) |
| `sfx.error` | error.ogg | 300ms | ошибка (RuntimeError) |
| `sfx.shard_reveal` | shard.ogg | 1500ms | раскрытие Осколка |
| `sfx.print_bubble` | print.ogg | 180ms | появилось облако с текстом |
| `sfx.train_add` | train.ogg | 220ms | новый вагон / элемент списка |
| `env.dunes` | dunes_loop.ogg | 20s loop | ветер в Дюнах (окружение) |

Все файлы — CC0 (freesound.org, zapsplat free tier). Полный prep-list в `03_ArtBible.md`.

### 8.3. Правила подачи

- Максимум 2 звука одновременно.
- Loop окружения — 30% громкости от эффектов.
- Мьют при неактивной вкладке.
- Настройка «звук выкл» — в общем меню Арены.

---

## 9. Haptics

Через `Telegram.WebApp.HapticFeedback`.

| Событие | Тип |
|---|---|
| Шаг Профика | `impactOccurred('light')` |
| Прыжок | `impactOccurred('medium')` |
| Правильно | `notificationOccurred('success')` |
| Ошибка | `notificationOccurred('error')` |
| Раскрытие Осколка | `notificationOccurred('success')` + через 400мс ещё раз |

Все `impact` не чаще 1 раза в 100мс (debounce).

---

## 10. Persistence

### 10.1. Что храним локально (Telegram CloudStorage)

Ключи под префиксом `python.`:

```typescript
{
  "python.prologueCompleted": "1",
  "python.dunesProgress": {
    "levelsCompleted": [1,2,3,4,5,6,7],
    "levelsPerfect": [1,2,3,5],
    "bestTimes": {"1": 32000, "2": 41000, ...}
  },
  "python.profik_memory": {
    "avgAnswerMs": 3200,
    "errorsInSession": 1,
    "lastPlayHour": 23,
    "lastPlayDate": "2026-08-15",
    "perfectRun": true,
    "sessionCount": 4
  },
  "python.shardsRevealed": ["dunes"],
  "python.abilitiesUnlocked": ["run"]
}
```

CloudStorage лимит: ключ до 128 байт, значение до 4096 байт. Все структуры влезают.

### 10.2. Что летит на backend

Только XP и агрегаты — детальные события НЕ уходят (privacy + трафик).

`POST /api/python/session_end`:
```json
{
  "worldId": "dunes",
  "levelsCompleted": [1,2,3,4,5,6,7,8,9,10],
  "durationSec": 1840,
  "xpEarned": 320,
  "perfectCount": 6
}
```

Backend (уже есть FastAPI): начисляет XP, обновляет квесты и ачивки, возвращает обновлённый профиль.

---

## 11. Telemetry (по требованию эксперта)

### 11.1. Что собираем

Локально, батчами по 20 событий или каждые 30 секунд.

**Требование эксперта:** собирать подробнее. Каждое поведенческое событие — золото для последующего балансирования.

```typescript
interface TelemetryEvent {
  sessionId: string;
  userId: number;           // Telegram id
  ts: number;               // unix ms
  levelId: string;          // "dunes.3"
  eventType:
    // структурные
    | 'level_start'
    | 'level_complete'
    | 'level_abandon'
    | 'first_action'                 // первый ввод игрока
    // редактор
    | 'code_edit'                    // любое изменение кода
    | 'code_run'                     // нажал ▶ показать
    | 'code_run_completed'           // анимация досмотрена до конца
    | 'code_run_skipped'             // тапнул мимо во время анимации
    // ошибки
    | 'error_shown'                  // на экране появилась ошибка (parser или runtime)
    | 'error_fixed'                  // ошибка исправлена, payload.timeSinceError
    // подсказки
    | 'hint_shown'                   // Профик выдал подсказку
    | 'hint_dismissed'               // игрок закрыл подсказку тапом
    | 'hint_followed'                // применил подсказку в течение 15с
    // replay
    | 'replay_started'
    | 'replay_speed_changed'
    | 'replay_stepped'               // ткнул пошагово
    | 'replay_ended'                 // payload.completionRatio
    // sandbox
    | 'sandbox_enter'
    | 'sandbox_exit'
    | 'sandbox_share_gif'
    // концептуальные (эвристики)
    | 'concept_range_first_success'  // первый раз собрал range правильно
    | 'concept_step_understood'      // прошёл уровень с нестандартным step
    | 'concept_list_iter_success'    // прошёл for x in list
    | 'concept_index_vs_value'       // прошёл уровень 7 (различие индекс/значение)
    // Профик
    | 'profik_line_shown'
    | 'profik_line_read'              // 3+ сек просмотрел облако
  ;
  payload?: Record<string, any>;
}
```

### 11.2. Ключевые метрики (агрегируются на backend)

Для каждого уровня в разрезе всех игроков:

| Метрика | Что показывает |
|---|---|
| `median_time_to_first_action` | Насколько ясен онбординг уровня |
| `median_time_to_success` | Сложность |
| `p95_time_to_success` | Экстремумы (кто-то застрял) |
| `abandon_rate` | Ушёл не пройдя = уровень тяжёл или скучен |
| `code_run_count_per_success` | Насколько активно пользуются `▶ показать` |
| `error_shown_rate` | Как часто игроки натыкаются на runtime error |
| `hint_usage_rate` | Насколько нужны подсказки |
| `replay_usage_rate` | Смотрят ли анимацию после победы (=любят ли зрелище) |

### 11.3. Ключевая метрика проекта

**`code_run_count_per_success` за пролог + первые 3 уровня Дюн.**

Если медиана < 2 — идея «Живого Python» не сработала. Чиним не уровни, а сам эффект.

### 11.4. Endpoint

`POST /api/python/telemetry_batch`:
```json
{"events": [...]}
```

Backend пишет в отдельную таблицу `python_telemetry(id, user_id, ts, level_id, event_type, payload_json)`. Раз в сутки cron агрегирует в `python_metrics_daily`.

---

## 12. Replay

**Строгое правило (по требованию эксперта):** replay доступен ТОЛЬКО после `level_complete`.

До победы кнопки нет вообще — иначе школьник начинает «дебажить», а не думать. Это подтверждено плейтестами других обучающих продуктов.

Появляется после `level_complete`.

### 12.1. UI

Панель под canvas:
```
[◀◀]  [◀ шаг]  [▶ 0.5×]  [▶ 1×]  [▶ 2×]  [шаг ▶]  [▶▶]
```

Плюс переключатель «показывать состояние переменных» (по умолчанию on).

### 12.2. Что делает

Проигрывает **тот же поток событий**, что был на успешной попытке. Но:
- Можно поставить на паузу в любой момент.
- Можно пойти пошагово.
- Можно ускорить.

Технически: playback контроллер уже поддерживает speed/step — раздел 5.

### 12.3. Триггер телеметрии

Каждое использование → `replay_used` с payload `{speed: 0.5, steps: 12}`.

---

## 13. Backend интеграция

### 13.1. Существующие эндпоинты (не меняем)

- `POST /api/auth` — Telegram HMAC verification
- `GET /api/profile` — профиль игрока
- `POST /api/quests/tick` — обновить квесты
- `GET /api/achievements` — ачивки

### 13.2. Новые эндпоинты

- `POST /api/python/session_end` (см. 10.2)
- `POST /api/python/telemetry_batch` (см. 11.4)
- `GET /api/python/config` — конфигурация Python-режима (например, включён ли Sandbox)

### 13.3. Новые квесты

Регистрируем в `backend/db.py` вместе с существующими:

```python
QUEST_TEMPLATES = [
    # ... существующие ...
    ("python_prologue", "Пройти пролог", "python.prologue_complete", 1, 20),
    ("python_first_world", "Пройти первый мир Python", "python.world_complete", 1, 100),
    ("python_perfect_level", "Пройти уровень без ошибок", "python.level_perfect", 3, 60),
]
```

### 13.4. Новые ачивки

```python
ACHIEVEMENTS_CATALOG += [
    ("python_hello", "Первое слово", "Написал первый print", "🐍"),
    ("python_dunes", "Разбудил Дюны", "Прошёл Дюны Возврата", "🏜️"),
    ("python_perfect_dunes", "Идеальный шаг", "Прошёл все уровни Дюн без ошибок", "⭐"),
    ("python_sandbox_50", "Исследователь", "Провёл в Sandbox 50+ минут суммарно", "🔬"),
]
```

---

## 14. Performance budgets

| Метрика | Бюджет |
|---|---|
| Первый экран Python-режима (LCP) | < 800ms на 4G |
| Размер бандла Python-модуля (после gzip) | < 250KB |
| Размер всех звуков суммарно | < 400KB |
| Размер всех спрайтов Профика | < 80KB (SVG inline) |
| FPS во время анимации | ≥ 55 |
| Задержка от `▶ показать` до первой анимации | < 100ms |
| Задержка ответа `/api/python/session_end` | < 300ms p95 |

Профилирование — Chrome DevTools Performance panel + Lighthouse CI в GitHub Actions.

---

## 15. Файловая структура фронтенда

```
frontend/
  python/
    index.html                    # entry point Python-режима
    style.css                     # стили Python (плюс переопределения общих)
    src/
      lang/
        parser.js                 # ~400 LOC
        parser.test.js
      exec/
        engine.js                 # ~500 LOC
        events.js                 # типы событий
      render/
        renderer.js
        canvas.js
        anim/
          tween.js
          easings.js
        sprites/
          profik.js               # loading + state
      audio/
        sound_engine.js
        assets/
          sfx/                    # 10 файлов
          env/                    # 1 файл dunes_loop
      levels/
        prologue.json
        dunes/
          level_01.json
          ... level_10.json
        sandbox.json
      telemetry/
        client.js
      state/
        cloud_storage.js
      ui/
        editor_block.js
        editor_text.js
        replay_controls.js
        console.js
        profik_dialog.js
      main.js                     # bootstrap
```

Общий размер оценочно ~4-5K LOC на JS.

---

## 16. Тестирование

### 16.1. Unit-тесты (Vitest)

Обязательные:
- `parser` — 40+ кейсов (валидные + невалидные)
- `execution engine` — для каждой конструкции убеждаемся, что события идут в нужном порядке
- `tween` — граничные случаи easing

### 16.2. Snapshot-тесты рендера

Ключевые сцены → сохраняем canvas.toDataURL как эталон, сравниваем в CI.

### 16.3. Playtest gates

Перед приёмкой каждого уровня — 3 внутренних плейтеста (кто-то из команды кто НЕ делал уровень). Если проходит с первой без вопросов — приёмка.

---

## 17. Riски и митигация

| Риск | Митигация |
|---|---|
| Canvas 2D тормозит на слабых Android | Ограничить fps до 30, снизить количество частиц. Тест на referenc-девайсе (Redmi 9A). |
| Runtime error в Execution Engine крашит игру | Обёртка в try/catch, при исключении — soft error «Профик задумался, попробуй ещё раз» + телеметрия `engine_crash` |
| Дети находят баги парсера | Поддерживаем `error.hint`. Если игрок 3 раза ошибся одинаково — Профик предлагает подсказку. |
| CloudStorage переполнится | Мониторим размер профиля. Старые сессии агрегируем в счётчики. |
| Backend down → нельзя сохранить XP | Локальный буфер `pendingXp` в CloudStorage, отсылаем при следующем удачном pings. |

---

## 18. Открытые технические вопросы

Требуют решения до старта:

1. **Vitest или Jest?** Vitest — быстрее, меньше конфигурации. Предлагаю Vitest.
2. **TypeScript или JSDoc-типы?** Проект сейчас на vanilla JS. Предлагаю остаться на JS, добавить JSDoc-типы для критичных интерфейсов (Object Model, Events).
3. **Хостинг звуков:** прямо в бандле или CDN? При <400KB — в бандле, экономим RTT.
4. **Локализация:** русский hardcoded или через i18n JSON? Для среза — hardcoded (быстрее), позже вынесем.
