"""
Простая SQLite-БД для ProfikArena.
- users: игроки с рейтингом
- rating_log: история изменений рейтинга (источник + delta + баланс)

DB_PATH задаётся через env. Для Railway — примонтировать том на /app/data
и выставить DB_PATH=/app/data/profikarena.db.
"""

import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB_PATH = os.environ.get("DB_PATH", "./data/profikarena.db")

# Создаём папку под БД, если её нет
Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            telegram_id       INTEGER PRIMARY KEY,
            first_name        TEXT,
            username          TEXT,
            rating            INTEGER NOT NULL DEFAULT 1000,
            xp                INTEGER NOT NULL DEFAULT 0,
            current_streak    INTEGER NOT NULL DEFAULT 0,
            longest_streak    INTEGER NOT NULL DEFAULT 0,
            last_streak_date  TEXT,
            joined_at         TEXT NOT NULL DEFAULT (datetime('now')),
            last_seen_at      TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    # Миграция для старых баз (безопасно — если колонка уже есть, catch)
    for stmt in (
        "ALTER TABLE users ADD COLUMN xp INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN current_streak INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN longest_streak INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE users ADD COLUMN last_streak_date TEXT",
    ):
        try:
            conn.execute(stmt)
        except Exception:
            pass
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS rating_log (
            id             INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id        INTEGER NOT NULL,
            delta          INTEGER NOT NULL,
            source         TEXT NOT NULL,
            balance_after  INTEGER NOT NULL,
            created_at     TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_rating_log_user_date "
        "ON rating_log (user_id, created_at)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_users_rating ON users (rating DESC)"
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS duels (
            id                    TEXT PRIMARY KEY,
            creator_id            INTEGER NOT NULL,
            opponent_id           INTEGER,
            difficulty            TEXT NOT NULL,
            questions_json        TEXT NOT NULL,
            creator_score         INTEGER,
            opponent_score        INTEGER,
            creator_finished_at   TEXT,
            opponent_finished_at  TEXT,
            status                TEXT NOT NULL DEFAULT 'created',
            winner_id             INTEGER,
            is_draw               INTEGER DEFAULT 0,
            creator_delta         INTEGER,
            opponent_delta        INTEGER,
            created_at            TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_duels_creator ON duels (creator_id)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_duels_opponent ON duels (opponent_id)")
    # миграция: формат дуэли (sprint = Профи-блиц по умолчанию; fastmath/infomath/numguess)
    _dcols = [r[1] for r in conn.execute("PRAGMA table_info(duels)").fetchall()]
    if "format" not in _dcols:
        conn.execute("ALTER TABLE duels ADD COLUMN format TEXT NOT NULL DEFAULT 'sprint'")

    # Вызов недели от админа: один активный вызов, все играют те же вопросы против его счёта
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS weekly_challenge (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            creator_id    INTEGER NOT NULL,
            format        TEXT NOT NULL,
            difficulty    TEXT NOT NULL,
            payload_json  TEXT NOT NULL,
            admin_score   INTEGER NOT NULL,
            active        INTEGER NOT NULL DEFAULT 1,
            created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS weekly_attempt (
            challenge_id  INTEGER NOT NULL,
            user_id       INTEGER NOT NULL,
            score         INTEGER NOT NULL,
            beat          INTEGER NOT NULL DEFAULT 0,
            bonus         INTEGER NOT NULL DEFAULT 0,
            created_at    TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (challenge_id, user_id)
        )
        """
    )
    # «Приглашение на дуэль»: бот пишет сюда, кого в какую дуэль позвали (по клику
    # на ссылку). Нужно на случай, если клиент режет параметр у web-app кнопки —
    # приложение спросит сервер и откроет приём даже без параметра в URL.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS pending_duel (
            user_id    INTEGER PRIMARY KEY,
            duel_id    TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    # Уведомления в приложении (например, результаты дуэлей)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS notification (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL,
            text       TEXT NOT NULL,
            read       INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_notif_user ON notification (user_id)")

    # Рекорды одиночных спринт-игр: один результат = одна партия (для «Рекорда дня» по уровням)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS daily_score (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL,
            game       TEXT NOT NULL,
            difficulty TEXT NOT NULL,
            score      INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_dscore_lookup ON daily_score (game, difficulty, created_at)")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS xp_log (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id       INTEGER NOT NULL,
            delta         INTEGER NOT NULL,
            source        TEXT NOT NULL,
            balance_after INTEGER NOT NULL,
            created_at    TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_xp_log_user ON xp_log (user_id, created_at)")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS daily_quests (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            date        TEXT NOT NULL,
            task_type   TEXT NOT NULL,
            title       TEXT NOT NULL,
            icon        TEXT NOT NULL,
            target      INTEGER NOT NULL,
            progress    INTEGER NOT NULL DEFAULT 0,
            completed   INTEGER NOT NULL DEFAULT 0,
            claimed     INTEGER NOT NULL DEFAULT 0,
            xp_reward   INTEGER NOT NULL,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE (user_id, date, task_type)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_quests_user_date ON daily_quests (user_id, date)")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS user_achievements (
            user_id         INTEGER NOT NULL,
            achievement_id  TEXT NOT NULL,
            earned_at       TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (user_id, achievement_id)
        )
        """
    )
    conn.execute("CREATE INDEX IF NOT EXISTS idx_ach_user ON user_achievements (user_id)")

    # Счётчик партий по конкретным командным играм (для ачивок).
    # Тусовка не пишет в rating_log (0 рейтинга), поэтому считаем отдельно здесь.
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS game_plays (
            user_id  INTEGER NOT NULL,
            game     TEXT NOT NULL,
            cnt      INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (user_id, game)
        )
        """
    )
    # Розыгрыш от Игоря: прогноз времени забега (один прогноз на пользователя, последний перезаписывает)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS giveaway_prediction (
            user_id    INTEGER PRIMARY KEY,
            username   TEXT,
            seconds    INTEGER NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )
    # Фактический результат забега (одна строка id=1), проставляет админ
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS giveaway_result (
            id         INTEGER PRIMARY KEY,
            actual_sec INTEGER
        )
        """
    )
    # Флаги приложения (например, «рассылка X уже отправлена»)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS app_flags (
            key   TEXT PRIMARY KEY,
            value TEXT
        )
        """
    )

    # Результаты жеребьёвок розыгрышей (фиксируем топ-20 и призёров на момент розыгрыша)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS giveaway_draws (
            key        TEXT PRIMARY KEY,
            data_json  TEXT NOT NULL,
            created_at TEXT
        )
        """
    )

    # Снимок места игрока в общем рейтинге (для «изменение за день» в оповещении)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS daily_rank (
            user_id    INTEGER PRIMARY KEY,
            rank       INTEGER,
            updated_at TEXT
        )
        """
    )

    # --- Миграции: колонки для «Вызова от Игоря» с таймером/статистикой ---
    _wc_cols = {r[1] for r in conn.execute("PRAGMA table_info(weekly_challenge)").fetchall()}
    if "expires_at" not in _wc_cols:
        conn.execute("ALTER TABLE weekly_challenge ADD COLUMN expires_at TEXT")
    if "state" not in _wc_cols:
        conn.execute("ALTER TABLE weekly_challenge ADD COLUMN state TEXT NOT NULL DEFAULT 'open'")
    if "stats_json" not in _wc_cols:
        conn.execute("ALTER TABLE weekly_challenge ADD COLUMN stats_json TEXT")

    conn.commit()
    conn.close()


# ---------- Каталог ачивок ----------
# Условия (cond):
#   games_played, sprint_played, marathon_played, party_played, duel_played,
#   duel_won, correct_answer, xp_total, level, longest_streak, rating
ACHIEVEMENTS = [
    # Первые шаги
    {"id": "first_game",    "title": "Первая партия",     "desc": "Сыграй свою первую игру",         "icon": "🥚", "cond": "games_played",    "target": 1,   "xp": 20,  "cat": "start"},
    {"id": "first_duel",    "title": "Первая дуэль",      "desc": "Сыграй первую дуэль",             "icon": "⚔",  "cond": "duel_played",     "target": 1,   "xp": 30,  "cat": "start"},
    {"id": "first_winner",  "title": "Первая победа",     "desc": "Победи в первой дуэли",           "icon": "🥇", "cond": "duel_won",        "target": 1,   "xp": 50,  "cat": "start"},
    {"id": "first_lvl_up",  "title": "Взлёт!",            "desc": "Достигни 2-го уровня",            "icon": "🚀", "cond": "level",           "target": 2,   "xp": 25,  "cat": "start"},

    # Спринт
    {"id": "sprint_10",     "title": "Бегунок",           "desc": "Сыграй 10 спринтов",              "icon": "🏃", "cond": "sprint_played",   "target": 10,  "xp": 40,  "cat": "sprint"},
    {"id": "sprint_50",     "title": "Спринтер",          "desc": "Сыграй 50 спринтов",              "icon": "💨", "cond": "sprint_played",   "target": 50,  "xp": 150, "cat": "sprint"},
    {"id": "sprint_200",    "title": "Молния",            "desc": "Сыграй 200 спринтов",             "icon": "⚡", "cond": "sprint_played",   "target": 200, "xp": 500, "cat": "sprint"},

    # Марафон
    {"id": "marathon_5",    "title": "Марафонец",         "desc": "Пройди 5 марафонов",              "icon": "🐢", "cond": "marathon_played", "target": 5,   "xp": 50,  "cat": "marathon"},
    {"id": "marathon_25",   "title": "Восходитель",       "desc": "Пройди 25 марафонов",             "icon": "🏔",  "cond": "marathon_played", "target": 25,  "xp": 200, "cat": "marathon"},

    # Дуэли
    {"id": "duel_5",        "title": "Дуэлянт",           "desc": "Сыграй 5 дуэлей",                 "icon": "🗡", "cond": "duel_played",     "target": 5,   "xp": 60,  "cat": "duel"},
    {"id": "duel_win_5",    "title": "Победитель",        "desc": "Выиграй 5 дуэлей",                "icon": "🏆", "cond": "duel_won",        "target": 5,   "xp": 100, "cat": "duel"},
    {"id": "duel_win_25",   "title": "Чемпион",           "desc": "Выиграй 25 дуэлей",               "icon": "👑", "cond": "duel_won",        "target": 25,  "xp": 300, "cat": "duel"},
    {"id": "duel_win_100",  "title": "Легенда арены",     "desc": "Выиграй 100 дуэлей",              "icon": "🌟", "cond": "duel_won",        "target": 100, "xp": 1000,"cat": "duel"},

    # Уровни
    {"id": "level_5",       "title": "Мидл",              "desc": "Достигни 5-го уровня",            "icon": "💻", "cond": "level",           "target": 5,   "xp": 80,  "cat": "level"},
    {"id": "level_10",      "title": "Синьор",            "desc": "Достигни 10-го уровня",           "icon": "🚀", "cond": "level",           "target": 10,  "xp": 200, "cat": "level"},
    {"id": "level_25",      "title": "Стар",              "desc": "Достигни 25-го уровня",           "icon": "⭐", "cond": "level",           "target": 25,  "xp": 500, "cat": "level"},
    {"id": "level_50",      "title": "Мастер",            "desc": "Достигни 50-го уровня",           "icon": "🎓", "cond": "level",           "target": 50,  "xp": 1500,"cat": "level"},

    # Стрик
    {"id": "streak_7",      "title": "Неделя силы",       "desc": "7 дней подряд в игре",            "icon": "🔥", "cond": "longest_streak",  "target": 7,   "xp": 100, "cat": "streak"},
    {"id": "streak_30",     "title": "Железная воля",     "desc": "30 дней подряд",                  "icon": "🔥", "cond": "longest_streak",  "target": 30,  "xp": 500, "cat": "streak"},
    {"id": "streak_100",    "title": "Легенда серии",     "desc": "100 дней подряд",                 "icon": "🔥", "cond": "longest_streak",  "target": 100, "xp": 2000,"cat": "streak"},

    # Разное
    {"id": "party_10",      "title": "Тусовщик",          "desc": "Сыграй 10 партий в Тусовке",      "icon": "🎉", "cond": "party_played",    "target": 10,  "xp": 100, "cat": "misc"},
    {"id": "correct_500",   "title": "Умник",             "desc": "500 правильных ответов",          "icon": "🎯", "cond": "correct_answer",  "target": 500, "xp": 150, "cat": "misc"},
    {"id": "correct_2000",  "title": "Гений",             "desc": "2000 правильных ответов",         "icon": "🧠", "cond": "correct_answer",  "target": 2000,"xp": 500, "cat": "misc"},
    {"id": "xp_5000",       "title": "Копилка",           "desc": "Накопи 5 000 XP",                 "icon": "💎", "cond": "xp_total",        "target": 5000,"xp": 300, "cat": "misc"},
    {"id": "xp_20000",      "title": "Магнат",            "desc": "Накопи 20 000 XP",                "icon": "💰", "cond": "xp_total",        "target": 20000,"xp": 1000,"cat": "misc"},

    # Лига
    {"id": "rating_1600",   "title": "Восход к Звёздам",  "desc": "Достигни рейтинга 1600 (Стар)",   "icon": "⭐", "cond": "rating",          "target": 1600,"xp": 200, "cat": "rating"},
    {"id": "rating_1900",   "title": "Легенда лиги",      "desc": "Достигни рейтинга 1900",          "icon": "👑", "cond": "rating",          "target": 1900,"xp": 500, "cat": "rating"},

    # Тусовка — командные игры (по каждой игре + общие)
    {"id": "croco_15",      "title": "Мим",               "desc": "Сыграй 15 партий в Крокодила",    "icon": "🐊", "cond": "croco_played",    "target": 15,  "xp": 80,  "cat": "party"},
    {"id": "alias_15",      "title": "Объясняка",         "desc": "Сыграй 15 партий в Alias",        "icon": "🗣", "cond": "alias_played",    "target": 15,  "xp": 80,  "cat": "party"},
    {"id": "gromko_10",     "title": "По губам",          "desc": "Сыграй 10 Громких вопросов",      "icon": "🔊", "cond": "gromko_played",   "target": 10,  "xp": 80,  "cat": "party"},
    {"id": "timebank_10",   "title": "Хранитель времени", "desc": "Сыграй 10 Тайм-баттлов",          "icon": "⏳", "cond": "timebank_played", "target": 10,  "xp": 80,  "cat": "party"},
    {"id": "spy_10",        "title": "Двойной агент",     "desc": "Сыграй 10 партий в Шпиона",       "icon": "🕵", "cond": "spy_played",      "target": 10,  "xp": 80,  "cat": "party"},
    {"id": "party_variety", "title": "Мастер тусовки",    "desc": "Попробуй все 5 командных игр",     "icon": "🎪", "cond": "party_variety",   "target": 5,   "xp": 250, "cat": "party"},
    {"id": "party_50",      "title": "Душа компании",     "desc": "Сыграй 50 партий в Тусовке",      "icon": "🎊", "cond": "party_played",    "target": 50,  "xp": 300, "cat": "party"},
    {"id": "party_150",     "title": "Король вечеринок",  "desc": "Сыграй 150 партий в Тусовке",     "icon": "🥳", "cond": "party_played",    "target": 150, "xp": 800, "cat": "party"},
    {"id": "games_100",     "title": "Игроман",           "desc": "Сыграй 100 игр всего",            "icon": "🎮", "cond": "games_played",    "target": 100, "xp": 250, "cat": "misc"},
]


# ---------- Шаблоны ежедневных заданий ----------
# Типы событий, по которым инкрементим прогресс:
#   'sprint_played'    — сыграна партия в Спринт
#   'marathon_played'  — сыграна партия в Марафон
#   'party_played'     — сыграна партия в Тусовке
#   'duel_won'         — победа в дуэли
#   'correct_answer'   — правильный ответ (любая игра)
#   'xp_earned'        — заработан XP (кроме streak)
QUEST_TEMPLATES = [
    {"type": "sprint_played",   "target": 3,   "xp": 30, "title": "Сыграй 3 спринта",       "icon": "⚡"},
    {"type": "sprint_played",   "target": 5,   "xp": 50, "title": "Сыграй 5 спринтов",       "icon": "⚡"},
    {"type": "marathon_played", "target": 2,   "xp": 40, "title": "Пройди 2 марафона",       "icon": "🏆"},
    {"type": "party_played",    "target": 1,   "xp": 25, "title": "Сыграй партию в Тусовке", "icon": "🎉"},
    {"type": "party_played",    "target": 2,   "xp": 45, "title": "Сыграй 2 партии в Тусовке","icon": "🎉"},
    {"type": "duel_won",        "target": 1,   "xp": 60, "title": "Победи в 1 дуэли",         "icon": "⚔"},
    {"type": "correct_answer",  "target": 20,  "xp": 30, "title": "Ответь правильно 20 раз",  "icon": "🎯"},
    {"type": "correct_answer",  "target": 50,  "xp": 60, "title": "Ответь правильно 50 раз",  "icon": "🎯"},
    {"type": "xp_earned",       "target": 100, "xp": 40, "title": "Заработай 100 XP за день", "icon": "💎"},
    {"type": "xp_earned",       "target": 200, "xp": 70, "title": "Заработай 200 XP за день", "icon": "💎"},
]


# ---------- ELO ----------
K_FACTOR = 32


def calculate_elo(rating_a: int, rating_b: int, score_a: float) -> tuple[int, int]:
    """
    Асимметричный ELO: проигравший теряет вдвое меньше, чем получает победитель.
    Пример: победа даёт +30, поражение снимает -15.
    Ничья — обычное симметричное изменение (обычно близко к 0).

    score_a: 1.0 (A победил), 0.0 (A проиграл), 0.5 (ничья)
    """
    expected_a = 1 / (1 + 10 ** ((rating_b - rating_a) / 400))
    base = round(K_FACTOR * (score_a - expected_a))
    if score_a == 1.0:
        # A победил
        delta_a = base                  # полный выигрыш
        delta_b = -int(abs(base) / 2)   # половинный проигрыш
    elif score_a == 0.0:
        # A проиграл
        delta_a = -int(abs(base) / 2)   # половинный проигрыш
        delta_b = abs(base)             # полный выигрыш соперника
    else:
        # ничья — симметрично
        delta_a = base
        delta_b = -base
    return delta_a, delta_b


@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


# ---------- Лиги + подуровни ----------
LEAGUES = [
    (1900, "Легенда", "👑"),
    (1600, "Стар", "⭐"),
    (1300, "Синьор", "🚀"),
    (1000, "Мидл", "💻"),
    (0,    "Юниор", "🎓"),
]
# Каждая лига делится на 3 подуровня (тиера). Размер тиера = диапазон лиги / 3.
# Легенда — без подуровней.
TIER_ROMAN = ["I", "II", "III"]


def get_league(rating: int) -> dict:
    for threshold, name, emoji in LEAGUES:
        if rating >= threshold:
            # Следующий (ближайший) порог лиги для прогресс-бара
            higher = [t for t, _, _ in LEAGUES if t > threshold]
            next_threshold = min(higher) if higher else None

            # Вычисляем подуровень (тиер I/II/III)
            tier = None
            tier_low = threshold
            tier_high = next_threshold
            if next_threshold is not None:
                league_range = next_threshold - threshold
                tier_size = league_range / 3
                # tier_idx: 0, 1, 2
                tier_idx = min(2, int((rating - threshold) / tier_size))
                tier = TIER_ROMAN[tier_idx]
                tier_low = threshold + int(tier_idx * tier_size)
                tier_high = threshold + int((tier_idx + 1) * tier_size) if tier_idx < 2 else next_threshold

            display = f"{name} {tier}" if tier else name
            return {
                "name": name,
                "emoji": emoji,
                "tier": tier,
                "display": display,
                "threshold": threshold,
                "next_threshold": next_threshold,
                "tier_low": tier_low,
                "tier_high": tier_high,
            }
    return {"name": "Юниор", "emoji": "🎓", "tier": "I", "display": "Юниор I",
            "threshold": 0, "next_threshold": 1000, "tier_low": 0, "tier_high": 333}


# ---------- Уровень аккаунта (по XP) ----------
def _xp_for_level(level: int) -> int:
    """Сколько XP нужно накопить всего, чтобы достичь этого уровня."""
    if level <= 1:
        return 0
    return 100 * level * (level - 1) // 2


def get_level_info(xp: int) -> dict:
    """
    Возвращает уровень + прогресс до следующего.
    Уровень 1: 0-100
    Уровень 2: 100-300
    Уровень 3: 300-600
    Уровень N: 100*N*(N-1)/2  до  100*(N+1)*N/2
    """
    xp = max(0, int(xp))
    # Вычисляем уровень методом решения N^2 - N - xp/50 = 0
    import math
    if xp == 0:
        level = 1
    else:
        level = int((1 + math.sqrt(1 + xp * 8 / 100)) / 2)
        # Защита от ошибок округления
        while _xp_for_level(level) > xp:
            level -= 1
        while _xp_for_level(level + 1) <= xp:
            level += 1
    current_threshold = _xp_for_level(level)
    next_threshold = _xp_for_level(level + 1)
    in_level = xp - current_threshold
    to_next = next_threshold - xp
    total_in_level = next_threshold - current_threshold
    return {
        "level": level,
        "current_threshold": current_threshold,
        "next_threshold": next_threshold,
        "in_level": in_level,
        "to_next": to_next,
        "progress_percent": round(in_level * 100 / total_in_level) if total_in_level else 0,
    }


# ---------- Стрик заходов ----------
from datetime import datetime, timedelta, timezone

MSK_TZ = timezone(timedelta(hours=3))

# Милстоуны: {день: бонус XP}
STREAK_MILESTONES = {
    3:   50,
    7:   100,
    14:  200,
    30:  500,
    60:  1000,
    100: 2000,
    365: 5000,
}
DAILY_STREAK_BASE_XP = 10  # +XP просто за вход в новый день


def today_msk() -> str:
    return datetime.now(MSK_TZ).date().isoformat()


def yesterday_msk() -> str:
    return (datetime.now(MSK_TZ) - timedelta(days=1)).date().isoformat()


def next_streak_milestone(current_streak: int) -> dict | None:
    """Ближайший неполученный милстоун и сколько дней до него."""
    for day in sorted(STREAK_MILESTONES.keys()):
        if day > current_streak:
            return {
                "day": day,
                "bonus_xp": STREAK_MILESTONES[day],
                "days_to_go": day - current_streak,
            }
    return None  # все милстоуны собраны (>365)


# ---------- Дневной кап тренировок ----------
DAILY_TRAINING_CAP = 100
TRAINING_SOURCES = ("sprint", "marathon", "party", "numguess", "fastmath", "infomath", "schulte", "gorbov", "stroop", "gametheory", "hangman")


def get_training_earned_today(db, user_id: int, source: str = None) -> int:
    """Сколько рейтинга набрано сегодня.
    source=None → суммарно по всем тренировочным источникам (для сводки).
    source задан → только по этой игре (для per-game капа 100/день)."""
    if source is None:
        row = db.execute(
            f"""
            SELECT COALESCE(SUM(delta), 0) AS total
            FROM rating_log
            WHERE user_id = ?
              AND source IN ({",".join("?" * len(TRAINING_SOURCES))})
              AND date(created_at) = date('now')
            """,
            (user_id, *TRAINING_SOURCES),
        ).fetchone()
    else:
        row = db.execute(
            """
            SELECT COALESCE(SUM(delta), 0) AS total
            FROM rating_log
            WHERE user_id = ? AND source = ?
              AND date(created_at) = date('now')
            """,
            (user_id, source),
        ).fetchone()
    return row["total"] or 0
