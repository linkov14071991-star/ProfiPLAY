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
            telegram_id  INTEGER PRIMARY KEY,
            first_name   TEXT,
            username     TEXT,
            rating       INTEGER NOT NULL DEFAULT 1000,
            joined_at    TEXT NOT NULL DEFAULT (datetime('now')),
            last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
        """
    )
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
    conn.commit()
    conn.close()


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


# ---------- Лиги ----------
LEAGUES = [
    (1900, "Легенда", "👑"),
    (1600, "Стар", "⭐"),
    (1300, "Синьор", "🚀"),
    (1000, "Мидл", "💻"),
    (0,    "Юниор", "🎓"),
]


def get_league(rating: int) -> dict:
    for threshold, name, emoji in LEAGUES:
        if rating >= threshold:
            # найти следующий порог для прогресс-бара
            next_threshold = None
            for t, _, _ in LEAGUES:
                if t > threshold:
                    next_threshold = t
                    break
            return {
                "name": name,
                "emoji": emoji,
                "threshold": threshold,
                "next_threshold": next_threshold,
            }
    return {"name": "Юниор", "emoji": "🎓", "threshold": 0, "next_threshold": 1000}


# ---------- Дневной кап тренировок ----------
DAILY_TRAINING_CAP = 100
TRAINING_SOURCES = ("sprint", "marathon", "party")


def get_training_earned_today(db, user_id: int) -> int:
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
    return row["total"] or 0
