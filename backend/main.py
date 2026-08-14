"""
ProfiPlay - Telegram Mini App
Backend: FastAPI
Игра: Крокодил (Информатика)

Задачи backend:
1. Отдавать статику фронтенда (index.html и т.д.)
2. Проверять подписку пользователя на канал @profimatika_inf
3. Отдавать список слов по выбранной сложности
"""

import asyncio
import hashlib
import hmac
import json
import os
import random
import re
import secrets
import string
from pathlib import Path
from urllib.parse import parse_qsl

import httpx
from fastapi import Body, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from db import (
    ACHIEVEMENTS,
    DAILY_STREAK_BASE_XP,
    DAILY_TRAINING_CAP,
    QUEST_TEMPLATES,
    STREAK_MILESTONES,
    TRAINING_SOURCES,
    calculate_elo,
    get_db,
    get_league,
    get_level_info,
    get_training_earned_today,
    init_db,
    next_streak_milestone,
    today_msk,
    yesterday_msk,
)

# XP-множители для тренировок (сколько XP за каждое очко рейтинга)
XP_PER_RATING = {
    "sprint": 2.0,    # спринт: за правильный ответ +1 рейтинг → +2 XP
    "marathon": 1.5,  # марафон: за правильный +2 рейтинг → +3 XP
    "party": 3.0,     # тусовка: +5 рейтинг → +15 XP
    "numguess": 2.0,  # угадай число: как спринт
    "fastmath": 2.0,  # быстрый счёт: как спринт
    "infomath": 2.0,  # IT-разминка: как спринт
}

# Множитель по сложности вопросов
DIFFICULTY_MULT = {"easy": 1.0, "medium": 1.5, "hard": 2.0}
# Множитель по количеству жизней в Марафоне (меньше жизней = больше очков за риск)
LIVES_MULT = {1: 3.0, 3: 2.0, 5: 1.0}
# Базовая ставка рейтинга за один правильный ответ.
# Тусовка (party) = 0 очков, потому что играется на своей честности —
# слишком просто накрутить рейтинг. Прогресс квестов и ачивок при этом сохраняется.
BASE_RATING_PER_CORRECT = {"sprint": 1, "marathon": 2, "party": 0, "numguess": 4, "fastmath": 1, "infomath": 1}
# Игры Спринта, где партия за 60 сек = один результат (для «Рекорда дня» по уровням)
DAILY_RECORD_GAMES = ("sprint", "fastmath", "infomath")
DIFF_LABELS = {"easy": "Простая", "medium": "Средняя", "hard": "Сложная"}
# Duel XP
XP_DUEL_WIN = 50
XP_DUEL_DRAW = 30
XP_DUEL_LOSS = 20

# Командные игры Тусовки — для пер-гейм ачивок (тег присылает фронтенд)
PARTY_GAMES = {"croco", "gromko", "alias", "spy", "whoami", "timebank"}

# ---------- Настройки ----------
BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
BOT_USERNAME = os.environ.get("BOT_USERNAME", "")  # без @, например 'profikarena_bot'
CHANNEL_USERNAME = os.environ.get("CHANNEL_USERNAME", "@profimatika_inf")

# Админы (могут создавать «Вызов от Игоря»). Можно переопределить через env ADMIN_IDS="123,456".
ADMIN_IDS = {int(x) for x in os.environ.get("ADMIN_IDS", "1388800589").replace(" ", "").split(",") if x}
WEBAPP_URL = os.environ.get("WEBAPP_URL", "")  # для рассылки Вызова от Игоря (кнопка + картинка)

BASE_DIR = Path(__file__).parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"
WORDS_FILE = BASE_DIR / "words.json"
QUESTIONS_FILE = BASE_DIR / "questions.json"
CATEGORIES_FILE = BASE_DIR / "categories.json"

with open(WORDS_FILE, "r", encoding="utf-8") as f:
    WORDS = json.load(f)

# Доступные предметы словесных игр (Крокодил, Alias, Шпион)
SUBJECTS = [s for s in ("informatika", "matematika", "fizika") if s in WORDS]


def _parse_subjects(subjects: str) -> list:
    """Разбирает параметр subjects (через запятую) → список валидных предметов.
    Пусто/мусор → информатика по умолчанию (обратная совместимость)."""
    picked = [s.strip() for s in (subjects or "").split(",") if s.strip() in SUBJECTS]
    return picked or ["informatika"]


def _pool_words(subjects: str, difficulty: str) -> list:
    """Собирает слова выбранных предметов на заданной сложности в один пул.
    difficulty='mixed' → все уровни. Каждый элемент → {word, banned, emoji}."""
    levels = ("easy", "medium", "hard") if difficulty == "mixed" else (difficulty,)
    result = []
    for subj in _parse_subjects(subjects):
        for lv in levels:
            for it in WORDS.get(subj, {}).get(lv, []):
                if isinstance(it, dict):
                    result.append({
                        "word": it["word"],
                        "banned": it.get("banned", []),
                        "emoji": it.get("emoji", ""),
                    })
                else:
                    result.append({"word": it, "banned": [], "emoji": ""})
    return result

with open(QUESTIONS_FILE, "r", encoding="utf-8") as f:
    QUESTIONS = json.load(f)

with open(CATEGORIES_FILE, "r", encoding="utf-8") as f:
    CATEGORIES = json.load(f)

# ---------- Приложение ----------
app = FastAPI(title="Профик Arena API")
init_db()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Проверка подписи Telegram WebApp ----------
def verify_telegram_init_data(init_data: str) -> dict | None:
    """
    Telegram присылает initData при открытии мини-приложения.
    Проверяем HMAC-подпись, чтобы убедиться, что данные настоящие.
    Возвращает распарсенные данные пользователя или None.
    """
    if not init_data or not BOT_TOKEN:
        return None

    try:
        parsed = dict(parse_qsl(init_data, strict_parsing=True))
        received_hash = parsed.pop("hash", None)
        if not received_hash:
            return None

        data_check_string = "\n".join(
            f"{k}={v}" for k, v in sorted(parsed.items())
        )
        secret_key = hmac.new(
            b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256
        ).digest()
        calculated_hash = hmac.new(
            secret_key, data_check_string.encode(), hashlib.sha256
        ).hexdigest()

        if calculated_hash != received_hash:
            return None

        user_json = parsed.get("user")
        if user_json:
            parsed["user"] = json.loads(user_json)
        return parsed
    except Exception:
        return None


def get_verified_user(init_data: str) -> dict:
    """
    Возвращает Telegram user dict {id, first_name, username, ...}.
    В dev-режиме (без BOT_TOKEN) — фейковый пользователь.
    Иначе — 401 если initData некорректна.
    """
    verified = verify_telegram_init_data(init_data)
    if verified and isinstance(verified.get("user"), dict):
        return verified["user"]
    if not BOT_TOKEN:
        # локальная разработка / smoke-тест
        return {"id": 12345, "first_name": "Dev", "username": "dev"}
    raise HTTPException(status_code=401, detail="Invalid Telegram init data")


def _compute_user_stats(db, user_id: int) -> dict:
    """Собирает метрики для проверки ачивок."""
    row = db.execute(
        "SELECT xp, rating, longest_streak FROM users WHERE telegram_id = ?",
        (user_id,),
    ).fetchone()
    stats = {
        "xp_total": row["xp"] or 0,
        "rating": row["rating"] or 0,
        "longest_streak": row["longest_streak"] or 0,
        "level": get_level_info(row["xp"] or 0)["level"],
    }
    # Количество партий по источникам
    play_counts = db.execute(
        """
        SELECT source, COUNT(*) AS c FROM rating_log
        WHERE user_id = ? AND source IN ('sprint','marathon','party','duel')
        GROUP BY source
        """,
        (user_id,),
    ).fetchall()
    for pc in play_counts:
        stats[f"{pc['source']}_played"] = pc["c"]
    for k in ("sprint_played", "marathon_played", "party_played", "duel_played"):
        stats.setdefault(k, 0)
    # Дуэли: победы
    won = db.execute(
        "SELECT COUNT(*) AS c FROM duels WHERE winner_id = ? AND status = 'complete'",
        (user_id,),
    ).fetchone()["c"]
    stats["duel_won"] = won
    # Командные игры считаем по game_plays (party не пишет в rating_log)
    gp = db.execute(
        "SELECT game, cnt FROM game_plays WHERE user_id = ?", (user_id,)
    ).fetchall()
    party_total = 0
    variety = 0
    for r in gp:
        stats[f"{r['game']}_played"] = r["cnt"]
        party_total += r["cnt"]
        if r["cnt"] > 0:
            variety += 1
    for g in ("croco", "gromko", "alias", "spy", "whoami", "timebank"):
        stats.setdefault(f"{g}_played", 0)
    stats["party_played"] = party_total
    stats["party_variety"] = variety
    stats["games_played"] = (
        stats["sprint_played"] + stats["marathon_played"]
        + stats["party_played"] + stats["duel_played"]
    )
    # Правильные ответы (примерная оценка по rating_log: спринт=1:1, марафон=1:2)
    correct = db.execute(
        """
        SELECT COALESCE(SUM(
            CASE
                WHEN source='sprint' THEN delta
                WHEN source='marathon' THEN delta / 2
                ELSE 0
            END
        ), 0) AS total
        FROM rating_log WHERE user_id = ?
        """,
        (user_id,),
    ).fetchone()["total"]
    stats["correct_answer"] = correct or 0
    return stats


def _notify(db, user_id: int, text: str):
    """Записать уведомление игроку (появится в колокольчике на главной)."""
    try:
        db.execute("INSERT INTO notification (user_id, text) VALUES (?, ?)", (user_id, text))
    except Exception:
        pass


def _check_and_grant_achievements(db, user_id: int) -> list:
    """
    Проверяет все ачивки для игрока, выдаёт новые.
    Возвращает список свежевыданных ачивок с XP.
    """
    stats = _compute_user_stats(db, user_id)
    # Уже полученные ачивки
    earned_rows = db.execute(
        "SELECT achievement_id FROM user_achievements WHERE user_id = ?",
        (user_id,),
    ).fetchall()
    earned = {r["achievement_id"] for r in earned_rows}

    newly = []
    for ach in ACHIEVEMENTS:
        if ach["id"] in earned:
            continue
        actual = stats.get(ach["cond"], 0)
        if actual >= ach["target"]:
            # Выдаём
            try:
                db.execute(
                    "INSERT INTO user_achievements (user_id, achievement_id) VALUES (?, ?)",
                    (user_id, ach["id"]),
                )
                award_xp(db, user_id, ach["xp"], f"ach:{ach['id']}")
                _notify(db, user_id, f"🏆 Новая ачивка: {ach['icon']} {ach['title']}")
                newly.append({
                    "id": ach["id"], "title": ach["title"], "desc": ach["desc"],
                    "icon": ach["icon"], "xp": ach["xp"],
                })
            except Exception:
                pass  # уже была
    return newly


def _ensure_daily_quests(db, user_id: int):
    """Генерирует 3 квеста для игрока на сегодня, если ещё нет."""
    today = today_msk()
    row = db.execute(
        "SELECT COUNT(*) AS c FROM daily_quests WHERE user_id = ? AND date = ?",
        (user_id, today),
    ).fetchone()
    if row["c"] >= 3:
        return
    # Выбираем 3 разных по типу квеста
    templates = QUEST_TEMPLATES.copy()
    random.shuffle(templates)
    picked = []
    seen_types = set()
    for tpl in templates:
        if tpl["type"] in seen_types:
            continue
        picked.append(tpl)
        seen_types.add(tpl["type"])
        if len(picked) == 3:
            break
    for tpl in picked:
        try:
            db.execute(
                """
                INSERT OR IGNORE INTO daily_quests
                    (user_id, date, task_type, title, icon, target, xp_reward)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, today, tpl["type"], tpl["title"], tpl["icon"],
                 tpl["target"], tpl["xp"]),
            )
        except Exception:
            pass


def _get_daily_quests(db, user_id: int) -> list:
    """Возвращает список квестов на сегодня."""
    today = today_msk()
    rows = db.execute(
        """
        SELECT id, task_type, title, icon, target, progress, completed, claimed, xp_reward
        FROM daily_quests
        WHERE user_id = ? AND date = ?
        ORDER BY id
        """,
        (user_id, today),
    ).fetchall()
    return [dict(r) for r in rows]


def update_quest_progress(db, user_id: int, event_type: str, amount: int = 1):
    """
    Инкрементим прогресс всех активных квестов заданного типа.
    Если прогресс достиг target — помечаем completed=1 (но не claimed).
    """
    if amount <= 0:
        return
    today = today_msk()
    # Убедимся что квесты сгенерированы
    _ensure_daily_quests(db, user_id)
    db.execute(
        """
        UPDATE daily_quests
        SET progress = MIN(target, progress + ?),
            completed = CASE WHEN progress + ? >= target THEN 1 ELSE completed END
        WHERE user_id = ? AND date = ? AND task_type = ? AND claimed = 0
        """,
        (amount, amount, user_id, today, event_type),
    )


def update_streak(db, user_id: int) -> dict:
    """
    Обновляет ежедневный стрик пользователя. Идемпотентно в пределах суток (MSK).
    Возвращает {was_updated, current_streak, longest_streak, bonus_xp,
                base_bonus, milestone_bonus, milestone_reached, was_broken}.
    """
    row = db.execute(
        "SELECT current_streak, longest_streak, last_streak_date FROM users WHERE telegram_id = ?",
        (user_id,),
    ).fetchone()
    if not row:
        return {"was_updated": False}

    cur = row["current_streak"] or 0
    longest = row["longest_streak"] or 0
    last = row["last_streak_date"]
    today = today_msk()
    yesterday = yesterday_msk()

    # Уже отметились сегодня — ничего не делаем
    if last == today:
        return {
            "was_updated": False,
            "current_streak": cur,
            "longest_streak": longest,
            "bonus_xp": 0,
            "base_bonus": 0,
            "milestone_bonus": 0,
            "milestone_reached": None,
            "was_broken": False,
        }

    was_broken = last is not None and last != yesterday and cur > 0

    if last == yesterday:
        new_streak = cur + 1
    else:
        new_streak = 1  # первый день или после пропуска

    # Бонусы
    base_bonus = DAILY_STREAK_BASE_XP
    milestone_bonus = STREAK_MILESTONES.get(new_streak, 0)
    milestone_reached = new_streak if milestone_bonus > 0 else None
    total_bonus = base_bonus + milestone_bonus

    new_longest = max(longest, new_streak)
    db.execute(
        """
        UPDATE users
        SET current_streak = ?, longest_streak = ?, last_streak_date = ?
        WHERE telegram_id = ?
        """,
        (new_streak, new_longest, today, user_id),
    )
    # Начисляем XP за стрик
    award_xp(db, user_id, total_bonus, "streak")

    return {
        "was_updated": True,
        "current_streak": new_streak,
        "longest_streak": new_longest,
        "bonus_xp": total_bonus,
        "base_bonus": base_bonus,
        "milestone_bonus": milestone_bonus,
        "milestone_reached": milestone_reached,
        "was_broken": was_broken,
    }


def award_xp(db, user_id: int, amount: int, source: str) -> tuple[int, dict, bool]:
    """
    Начисляет XP игроку. Возвращает (new_xp, level_info, leveled_up).
    """
    if amount <= 0:
        row = db.execute("SELECT xp FROM users WHERE telegram_id = ?", (user_id,)).fetchone()
        return (row["xp"] if row else 0), get_level_info(row["xp"] if row else 0), False

    row = db.execute("SELECT xp FROM users WHERE telegram_id = ?", (user_id,)).fetchone()
    old_xp = row["xp"] if row else 0
    old_level = get_level_info(old_xp)["level"]

    db.execute(
        "UPDATE users SET xp = xp + ? WHERE telegram_id = ?",
        (amount, user_id),
    )
    new_xp = db.execute(
        "SELECT xp FROM users WHERE telegram_id = ?", (user_id,)
    ).fetchone()["xp"]
    db.execute(
        """
        INSERT INTO xp_log (user_id, delta, source, balance_after)
        VALUES (?, ?, ?, ?)
        """,
        (user_id, amount, source, new_xp),
    )
    new_level_info = get_level_info(new_xp)
    leveled_up = new_level_info["level"] > old_level
    return new_xp, new_level_info, leveled_up


def upsert_user(db, tg_user: dict):
    """Создаём или обновляем игрока в БД. Возвращаем строку users."""
    db.execute(
        """
        INSERT INTO users (telegram_id, first_name, username)
        VALUES (?, ?, ?)
        ON CONFLICT(telegram_id) DO UPDATE SET
            first_name = excluded.first_name,
            username = excluded.username,
            last_seen_at = datetime('now')
        """,
        (tg_user["id"], tg_user.get("first_name", ""), tg_user.get("username")),
    )
    return db.execute(
        "SELECT * FROM users WHERE telegram_id = ?", (tg_user["id"],)
    ).fetchone()


# ---------- Эндпоинты API ----------
@app.get("/api/check_subscription")
async def check_subscription(user_id: int = Query(...)):
    """
    Проверяем, подписан ли пользователь на канал.
    Бот должен быть админом канала, иначе Telegram вернёт ошибку.
    """
    if not BOT_TOKEN:
        # В режиме разработки без токена — пропускаем всех
        return {"subscribed": True, "dev_mode": True}

    url = f"https://api.telegram.org/bot{BOT_TOKEN}/getChatMember"
    params = {"chat_id": CHANNEL_USERNAME, "user_id": user_id}

    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            r = await client.get(url, params=params)
            data = r.json()
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Telegram error: {e}")

    if not data.get("ok"):
        # Скорее всего бот не админ канала или user_id не найден
        return {"subscribed": False, "error": data.get("description")}

    status = data["result"]["status"]
    # Подпиской считаем: creator, administrator, member
    is_subscribed = status in ("creator", "administrator", "member")
    return {"subscribed": is_subscribed, "status": status}


@app.get("/api/words")
async def get_words(difficulty: str = Query("easy"), subjects: str = Query("informatika")):
    """Слова для Крокодила (термин + эмодзи) из выбранных предметов."""
    if difficulty not in ("easy", "medium", "hard", "mixed"):
        raise HTTPException(status_code=400, detail="Bad difficulty")
    items = _pool_words(subjects, difficulty)
    random.shuffle(items)
    # Крокодилу нужны термин и картинка-эмодзи
    result = [{"word": it["word"], "emoji": it["emoji"]} for it in items]
    # обратная совместимость: старый ключ words со строками
    return {"items": result, "words": [it["word"] for it in result]}


@app.get("/api/alias")
async def get_alias_words(difficulty: str = Query("easy"), subjects: str = Query("informatika")):
    """Слова с запретными словами и эмодзи для Alias из выбранных предметов."""
    if difficulty not in ("easy", "medium", "hard"):
        raise HTTPException(status_code=400, detail="Bad difficulty")
    items = _pool_words(subjects, difficulty)
    random.shuffle(items)
    return {"items": items}


@app.get("/api/questions")
async def get_questions(difficulty: str = Query("easy"), limit: int = Query(50), topics: str = Query("")):
    """Список вопросов для Спринта. topics — темы через запятую, пусто = микс всех."""
    questions = _spread_questions(_pool_for(difficulty, topics))
    # Перемешиваем варианты внутри каждого вопроса, чтобы правильный не был всегда первым
    return {"questions": [shuffle_question(q) for q in questions[:limit]]}


@app.get("/api/categories")
async def get_categories(difficulty: str = Query("easy"), limit: int = Query(30)):
    """Категории для игры «5 секунд»."""
    if difficulty == "mixed":
        pool = (
            CATEGORIES["informatika"]["easy"]
            + CATEGORIES["informatika"]["medium"]
            + CATEGORIES["informatika"]["hard"]
        )
    elif difficulty in ("easy", "medium", "hard"):
        pool = CATEGORIES["informatika"][difficulty]
    else:
        raise HTTPException(status_code=400, detail="Bad difficulty")
    pool = pool.copy()
    random.shuffle(pool)
    return {"categories": pool[:limit]}


@app.get("/api/spy")
async def get_spy(difficulty: str = Query("easy"), subjects: str = Query("informatika")):
    """Одно случайное слово (+эмодзи) и список отвлекающих слов (для Шпиона)."""
    if difficulty not in ("easy", "medium", "hard"):
        raise HTTPException(status_code=400, detail="Bad difficulty")
    items = _pool_words(subjects, difficulty)
    random.shuffle(items)
    if not items:
        raise HTTPException(status_code=500, detail="No words")
    target = items[0]
    decoys = [it["word"] for it in items[1:8]]  # 7 других слов
    return {"word": target["word"], "emoji": target["emoji"], "decoys": decoys}


@app.get("/api/marathon")
async def get_marathon(difficulty: str = Query("easy"), limit: int = Query(200), topics: str = Query("")):
    """Для Марафона: пул вопросов выбранной сложности. topics — темы через запятую."""
    pool = _spread_questions(_pool_for(difficulty, topics))
    return {"questions": [shuffle_question(q) for q in pool[:limit]]}


_BOT_USERNAME_CACHE = None


async def _resolve_bot_username() -> str:
    """Username бота определяем из самого токена (getMe) и кэшируем — тогда при
    смене бота ссылки на дуэль автоматически ведут на нового. Фолбэк — env BOT_USERNAME."""
    global _BOT_USERNAME_CACHE
    if _BOT_USERNAME_CACHE:
        return _BOT_USERNAME_CACHE
    if BOT_TOKEN:
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                r = await client.get(f"https://api.telegram.org/bot{BOT_TOKEN}/getMe")
                uname = (r.json().get("result") or {}).get("username")
                if uname:
                    _BOT_USERNAME_CACHE = uname
                    return uname
        except Exception:
            pass
    return BOT_USERNAME or "your_bot"


@app.post("/api/whoami")
async def whoami(init_data: str = Body("", embed=True)):
    """Диагностика авторизации: проходит ли initData проверку по токену бота."""
    verified = verify_telegram_init_data(init_data)
    if verified and isinstance(verified.get("user"), dict):
        u = verified["user"]
        return {"ok": True, "id": u.get("id"), "name": u.get("first_name", "")}
    return {"ok": False, "has_init": bool(init_data), "token_set": bool(BOT_TOKEN)}


@app.get("/api/config")
async def get_config():
    """Небольшой конфиг для фронтенда (публичные данные + множители)."""
    return {
        "bot_username": await _resolve_bot_username(),
        "channel_username": CHANNEL_USERNAME.lstrip("@"),
        "difficulty_mult": DIFFICULTY_MULT,
        "lives_mult": LIVES_MULT,
        "base_per_correct": BASE_RATING_PER_CORRECT,
    }


@app.post("/api/notifications")
async def get_notifications(init_data: str = Body(..., embed=True)):
    """Список уведомлений игрока (результаты дуэлей и т.п.) + число непрочитанных."""
    tg_user = get_verified_user(init_data)
    with get_db() as db:
        me = upsert_user(db, tg_user)
        rows = db.execute(
            "SELECT id, text, read, created_at FROM notification WHERE user_id = ? ORDER BY id DESC LIMIT 30",
            (me["telegram_id"],),
        ).fetchall()
        unread = db.execute(
            "SELECT COUNT(*) AS c FROM notification WHERE user_id = ? AND read = 0",
            (me["telegram_id"],),
        ).fetchone()["c"]
    return {"items": [dict(r) for r in rows], "unread": unread}


@app.post("/api/notifications/read")
async def mark_notifications_read(init_data: str = Body(..., embed=True)):
    """Отметить все уведомления игрока прочитанными."""
    tg_user = get_verified_user(init_data)
    with get_db() as db:
        me = upsert_user(db, tg_user)
        db.execute("UPDATE notification SET read = 1 WHERE user_id = ?", (me["telegram_id"],))
    return {"ok": True}


# ==============================
# ==== ФУНДАМЕНТ РЕЙТИНГА =====
# ==============================


def _user_to_dict(row) -> dict:
    """Sqlite Row + служебные поля лиги + уровня."""
    d = dict(row)
    d["league"] = get_league(d["rating"])
    d["xp"] = d.get("xp", 0) or 0
    d["level_info"] = get_level_info(d["xp"])
    return d


@app.post("/api/profile")
async def get_or_create_profile(init_data: str = Body(..., embed=True)):
    """Возвращает профиль игрока. Создаёт, если новичок. Обновляет стрик."""
    tg_user = get_verified_user(init_data)
    with get_db() as db:
        row = upsert_user(db, tg_user)
        user_id = row["telegram_id"]
        # Обновляем стрик (идемпотентно в пределах суток)
        streak_update = update_streak(db, user_id)
        # Перечитываем после стрика — XP и колонки могли измениться
        row = db.execute("SELECT * FROM users WHERE telegram_id = ?", (user_id,)).fetchone()
        earned_today = get_training_earned_today(db, user_id)
        games_played = db.execute(
            "SELECT COUNT(*) AS c FROM rating_log WHERE user_id = ?",
            (user_id,),
        ).fetchone()["c"]
        # Разбивка по режимам для карточек на главной
        play_counts = db.execute(
            """
            SELECT source, COUNT(*) AS c FROM rating_log
            WHERE user_id = ? AND source IN ('sprint','marathon','party','duel')
            GROUP BY source
            """,
            (user_id,),
        ).fetchall()
        play_stats = {r["source"] + "_count": r["c"] for r in play_counts}
        duel_won = db.execute(
            "SELECT COUNT(*) AS c FROM duels WHERE winner_id = ? AND status = 'complete'",
            (user_id,),
        ).fetchone()["c"]
        xp_today = db.execute(
            """
            SELECT COALESCE(SUM(delta), 0) AS total
            FROM xp_log
            WHERE user_id = ? AND date(created_at) = date('now')
            """,
            (user_id,),
        ).fetchone()["total"]
    profile = _user_to_dict(row)
    profile["training_earned_today"] = earned_today
    profile["training_cap"] = DAILY_TRAINING_CAP
    profile["training_remaining_today"] = max(0, DAILY_TRAINING_CAP - earned_today)
    profile["games_played"] = games_played
    profile["sprint_count"] = play_stats.get("sprint_count", 0)
    profile["marathon_count"] = play_stats.get("marathon_count", 0)
    profile["party_count"] = play_stats.get("party_count", 0)
    profile["duel_count"] = play_stats.get("duel_count", 0)
    profile["duel_won"] = duel_won
    profile["xp_earned_today"] = xp_today or 0
    profile["current_streak"] = row["current_streak"] or 0
    profile["longest_streak"] = row["longest_streak"] or 0
    profile["next_milestone"] = next_streak_milestone(profile["current_streak"])
    profile["streak_update"] = streak_update  # для показа модалки клиентом
    return profile


@app.post("/api/rating/training")
async def add_training_points(
    init_data: str = Body(...),
    source: str = Body(...),
    points: int = Body(0),           # legacy: если correct не передан
    correct: int = Body(None),       # число правильных ответов (или партий для party)
    difficulty: str = Body("easy"),
    lives: int = Body(None),         # только для марафона
    game: str = Body(None),          # конкретная командная игра (croco/gromko/alias/spy/whoami/timebank)
    tries: int = Body(None),         # только для numguess: число попыток (для «Рекорда дня»)
):
    """
    Начисляем очки от тренировки с учётом множителей и дневного капа.
    Формулы:
      rating = correct × base × difficulty_mult × lives_mult (marathon)
      xp = round(rating × xp_per_rating[source])
    XP всегда без капа. Рейтинг с капом 100/день.
    """
    if source not in TRAINING_SOURCES:
        raise HTTPException(status_code=400, detail="Bad source")
    # Тусовка не даёт рейтинга — защита от накрутки (компанейские игры без верификации)
    if source == "party":
        base_points = 0
    elif correct is None:
        # Легаси-режим: клиент прислал готовые points (для старых версий фронта)
        base_points = points
    else:
        base = BASE_RATING_PER_CORRECT.get(source, 1)
        diff_mult = DIFFICULTY_MULT.get(difficulty, 1.0)
        lives_mult = LIVES_MULT.get(lives, 1.0) if source == "marathon" and lives else 1.0
        base_points = round(correct * base * diff_mult * lives_mult)
    points = base_points
    if points < 0 or points > 1000:
        raise HTTPException(status_code=400, detail="Bad points")

    tg_user = get_verified_user(init_data)
    with get_db() as db:
        row = upsert_user(db, tg_user)
        user_id = row["telegram_id"]

        # --- Рейтинг с капом (у каждой игры свой лимит 100/день) ---
        earned = get_training_earned_today(db, user_id, source)
        remaining = max(0, DAILY_TRAINING_CAP - earned)
        actual_delta = min(points, remaining)

        if actual_delta > 0:
            db.execute(
                "UPDATE users SET rating = rating + ? WHERE telegram_id = ?",
                (actual_delta, user_id),
            )
            new_rating = db.execute(
                "SELECT rating FROM users WHERE telegram_id = ?", (user_id,)
            ).fetchone()["rating"]
            db.execute(
                """
                INSERT INTO rating_log (user_id, delta, source, balance_after)
                VALUES (?, ?, ?, ?)
                """,
                (user_id, actual_delta, source, new_rating),
            )
        else:
            new_rating = row["rating"]

        # --- XP всегда, БЕЗ капа. Считаем от исходного points, не от actual_delta ---
        xp_amount = round(points * XP_PER_RATING.get(source, 2.0))
        new_xp, level_info, leveled_up = award_xp(db, user_id, xp_amount, source)

        # --- Рекорд дня по уровням (одиночные спринт-игры: партия = один результат) ---
        if source in DAILY_RECORD_GAMES and correct is not None and correct > 0:
            db.execute(
                "INSERT INTO daily_score (user_id, game, difficulty, score) VALUES (?, ?, ?, ?)",
                (user_id, source, difficulty, int(correct)),
            )
        # numguess: рекорд дня = наименьшее число попыток (score = tries, сортировка по возрастанию)
        elif source == "numguess" and tries and tries > 0:
            db.execute(
                "INSERT INTO daily_score (user_id, game, difficulty, score) VALUES (?, ?, ?, ?)",
                (user_id, "numguess", difficulty, int(tries)),
            )

        # --- Прогресс ежедневных квестов ---
        # Считаем правильные ответы: sprint(1:1), marathon(points/2), party — нет ответов
        if source == "sprint":
            update_quest_progress(db, user_id, "sprint_played", 1)
            update_quest_progress(db, user_id, "correct_answer", points)
        elif source == "marathon":
            update_quest_progress(db, user_id, "marathon_played", 1)
            update_quest_progress(db, user_id, "correct_answer", max(1, points // 2))
        elif source == "party":
            update_quest_progress(db, user_id, "party_played", 1)
        update_quest_progress(db, user_id, "xp_earned", xp_amount)

        # --- Учёт конкретной командной игры (для ачивок) ---
        # Тусовка не пишет в rating_log (0 рейтинга), поэтому копим счётчик здесь.
        if source == "party" and game in PARTY_GAMES:
            db.execute(
                """
                INSERT INTO game_plays (user_id, game, cnt) VALUES (?, ?, 1)
                ON CONFLICT(user_id, game) DO UPDATE SET cnt = cnt + 1
                """,
                (user_id, game),
            )

        # Проверка ачивок после тренировки
        newly_ach = _check_and_grant_achievements(db, user_id)

    return {
        "delta_awarded": actual_delta,
        "requested": points,
        "new_rating": new_rating,
        "league": get_league(new_rating),
        "cap_reached": remaining <= actual_delta,
        "training_remaining_today": max(0, remaining - actual_delta),
        "xp_awarded": xp_amount,
        "new_xp": new_xp,
        "level_info": level_info,
        "leveled_up": leveled_up,
        "newly_earned_achievements": newly_ach,
    }


@app.post("/api/achievements")
async def get_achievements(init_data: str = Body(..., embed=True)):
    """Список всех ачивок с флагом получения + прогрессом."""
    tg_user = get_verified_user(init_data)
    with get_db() as db:
        row = upsert_user(db, tg_user)
        user_id = row["telegram_id"]
        # Проверяем и выдаём новые
        newly = _check_and_grant_achievements(db, user_id)
        earned_rows = db.execute(
            "SELECT achievement_id, earned_at FROM user_achievements WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        earned_map = {r["achievement_id"]: r["earned_at"] for r in earned_rows}
        stats = _compute_user_stats(db, user_id)

    items = []
    for a in ACHIEVEMENTS:
        actual = stats.get(a["cond"], 0)
        items.append({
            "id": a["id"],
            "title": a["title"],
            "desc": a["desc"],
            "icon": a["icon"],
            "target": a["target"],
            "progress": min(actual, a["target"]),
            "xp": a["xp"],
            "cat": a["cat"],
            "earned": a["id"] in earned_map,
            "earned_at": earned_map.get(a["id"]),
        })
    total = len(ACHIEVEMENTS)
    earned_count = len(earned_map)
    return {
        "items": items,
        "total": total,
        "earned": earned_count,
        "newly_earned": newly,  # клиент покажет модалку
    }


@app.post("/api/quests/daily")
async def get_daily_quests(init_data: str = Body(..., embed=True)):
    """Список квестов на сегодня. Автогенерация при первом заходе за день."""
    tg_user = get_verified_user(init_data)
    with get_db() as db:
        row = upsert_user(db, tg_user)
        _ensure_daily_quests(db, row["telegram_id"])
        quests = _get_daily_quests(db, row["telegram_id"])
    return {"quests": quests, "date": today_msk()}


@app.post("/api/quests/claim")
async def claim_quest(
    init_data: str = Body(...),
    quest_id: int = Body(...),
):
    """Забрать награду за выполненный квест."""
    tg_user = get_verified_user(init_data)
    with get_db() as db:
        row = upsert_user(db, tg_user)
        user_id = row["telegram_id"]
        q = db.execute(
            "SELECT * FROM daily_quests WHERE id = ? AND user_id = ?",
            (quest_id, user_id),
        ).fetchone()
        if not q:
            raise HTTPException(status_code=404, detail="Quest not found")
        if not q["completed"]:
            raise HTTPException(status_code=400, detail="Not completed yet")
        if q["claimed"]:
            raise HTTPException(status_code=400, detail="Already claimed")
        # Помечаем как claimed и начисляем XP
        db.execute("UPDATE daily_quests SET claimed = 1 WHERE id = ?", (quest_id,))
        new_xp, level_info, leveled_up = award_xp(db, user_id, q["xp_reward"], "quest")
    return {
        "quest_id": quest_id,
        "xp_awarded": q["xp_reward"],
        "new_xp": new_xp,
        "level_info": level_info,
        "leveled_up": leveled_up,
    }


@app.get("/api/leaderboard")
async def get_leaderboard(limit: int = Query(50)):
    """Топ игроков по рейтингу."""
    limit = max(1, min(200, limit))
    with get_db() as db:
        rows = db.execute(
            """
            SELECT telegram_id, first_name, username, rating
            FROM users
            ORDER BY rating DESC, joined_at ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        total = db.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
        active = db.execute(
            "SELECT COUNT(*) AS c FROM users WHERE last_seen_at >= datetime('now', '-7 days')"
        ).fetchone()["c"]
    leaders = []
    for i, r in enumerate(rows, start=1):
        d = dict(r)
        d["place"] = i
        d["league"] = get_league(d["rating"])
        leaders.append(d)
    return {"leaders": leaders, "total_players": total, "active_players": active}


@app.post("/api/leaderboard/neighbors")
async def get_neighbors(
    init_data: str = Body(...),
    radius: int = Body(5),
):
    """Соседи в лидерборде: игроки в диапазоне ±radius позиций от текущего."""
    tg_user = get_verified_user(init_data)
    radius = max(1, min(20, radius))
    with get_db() as db:
        me = upsert_user(db, tg_user)
        my_id = me["telegram_id"]
        my_place = db.execute(
            """
            SELECT COUNT(*) + 1 AS place FROM users
            WHERE rating > ?
               OR (rating = ? AND joined_at < ?)
            """,
            (me["rating"], me["rating"], me["joined_at"]),
        ).fetchone()["place"]
        total = db.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]

        offset = max(0, my_place - radius - 1)
        count = min(2 * radius + 1, total - offset)
        rows = db.execute(
            """
            SELECT telegram_id, first_name, username, rating, joined_at
            FROM users
            ORDER BY rating DESC, joined_at ASC
            LIMIT ? OFFSET ?
            """,
            (count, offset),
        ).fetchall()

    leaders = []
    for i, r in enumerate(rows):
        d = dict(r)
        d["place"] = offset + i + 1
        d["league"] = get_league(d["rating"])
        d["is_me"] = d["telegram_id"] == my_id
        leaders.append(d)
    return {"leaders": leaders, "my_place": my_place, "total": total}


@app.get("/api/leaderboard/weekly")
async def get_weekly_leaderboard(limit: int = Query(50)):
    """
    Топ по приросту рейтинга за последние 7 дней.
    Смотрим сумму delta из rating_log с created_at ≥ 7 дней назад.
    """
    limit = max(1, min(100, limit))
    with get_db() as db:
        rows = db.execute(
            """
            SELECT
              u.telegram_id, u.first_name, u.username, u.rating,
              COALESCE(SUM(rl.delta), 0) AS gain
            FROM users u
            LEFT JOIN rating_log rl
              ON rl.user_id = u.telegram_id
              AND rl.created_at >= datetime('now', '-7 days')
            GROUP BY u.telegram_id
            HAVING gain > 0
            ORDER BY gain DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()

    leaders = []
    for i, r in enumerate(rows, start=1):
        d = dict(r)
        d["place"] = i
        d["league"] = get_league(d["rating"])
        d["weekly_gain"] = d["gain"]
        leaders.append(d)
    return {"leaders": leaders}


# Источники рейтинга для таблицы лидеров игры.
# У игр Спринта таблица = одиночная + дуэль (до 200 очков в день: 100 + 100).
GAME_LB_SOURCES = {
    "sprint":   ["sprint", "duel_sprint"],
    "numguess": ["numguess", "duel_numguess"],
    "fastmath": ["fastmath", "duel_fastmath"],
    "infomath": ["infomath", "duel_infomath"],
    "marathon": ["marathon"],
    "python":   ["python"],
}


@app.get("/api/leaderboard/game")
async def get_game_leaderboard(
    game: str = Query(...),
    period: str = Query("all"),
    limit: int = Query(10),
):
    """Топ игроков по суммарному рейтингу, заработанному в конкретной игре.
    Для игр Спринта считается одиночная + дуэль. period: all / week."""
    sources = GAME_LB_SOURCES.get(game)
    if not sources:
        raise HTTPException(status_code=400, detail="Bad game")
    limit = max(1, min(50, limit))
    if period == "week":
        where_time = "AND rl.created_at >= datetime('now', '-7 days')"
    elif period == "day":
        where_time = "AND date(rl.created_at) = date('now')"
    else:
        where_time = ""
    placeholders = ",".join("?" * len(sources))
    with get_db() as db:
        rows = db.execute(
            f"""
            SELECT u.first_name, u.username, COALESCE(SUM(rl.delta), 0) AS total
            FROM rating_log rl
            JOIN users u ON u.telegram_id = rl.user_id
            WHERE rl.source IN ({placeholders}) {where_time}
            GROUP BY rl.user_id
            HAVING total > 0
            ORDER BY total DESC, MIN(rl.created_at) ASC
            LIMIT ?
            """,
            (*sources, limit),
        ).fetchall()
    leaders = []
    for i, r in enumerate(rows, start=1):
        name = r["first_name"] or (f"@{r['username']}" if r["username"] else "Игрок")
        leaders.append({"place": i, "name": name, "score": r["total"]})
    return {"leaders": leaders}


@app.get("/api/sprint/records")
async def sprint_daily_records(game: str = Query(...), period: str = Query("day")):
    """Рекорды по каждому уровню: топ-3 лучших результата для одиночных спринт-игр.
    period: day (за сегодня) или all (за всё время). Один игрок — один (лучший)
    результат. numguess: лучший = наименьшее число попыток (сортировка по возрастанию)."""
    if game not in DAILY_RECORD_GAMES and game != "numguess":
        raise HTTPException(status_code=400, detail="Bad game")
    asc = (game == "numguess")            # для numguess меньше попыток — лучше
    agg = "MIN" if asc else "MAX"
    order = "ASC" if asc else "DESC"
    where_time = "" if period == "all" else "AND date(ds.created_at) = date('now')"
    out = {}
    with get_db() as db:
        for diff in ("easy", "medium", "hard"):
            rows = db.execute(
                f"""
                SELECT u.first_name, u.username, {agg}(ds.score) AS best
                FROM daily_score ds
                JOIN users u ON u.telegram_id = ds.user_id
                WHERE ds.game = ? AND ds.difficulty = ? {where_time}
                GROUP BY ds.user_id
                ORDER BY best {order}, MIN(ds.created_at) ASC
                LIMIT 3
                """,
                (game, diff),
            ).fetchall()
            out[diff] = [
                {
                    "name": r["first_name"] or (f"@{r['username']}" if r["username"] else "Игрок"),
                    "score": r["best"],
                }
                for r in rows
            ]
    return {
        "records": out,
        "labels": DIFF_LABELS,
        "order": "asc" if asc else "desc",
        "unit": "поп." if asc else "",
        "period": "all" if period == "all" else "day",
    }


@app.post("/api/leaderboard/me")
async def get_my_place(init_data: str = Body(..., embed=True)):
    """Возвращает моё место в общем рейтинге."""
    tg_user = get_verified_user(init_data)
    with get_db() as db:
        row = upsert_user(db, tg_user)
        # Место = количество игроков с большим рейтингом + 1
        place = db.execute(
            """
            SELECT COUNT(*) + 1 AS place FROM users
            WHERE rating > ?
               OR (rating = ? AND joined_at < ?)
            """,
            (row["rating"], row["rating"], row["joined_at"]),
        ).fetchone()["place"]
        total = db.execute("SELECT COUNT(*) AS c FROM users").fetchone()["c"]
    return {"place": place, "total": total, "rating": row["rating"], "league": get_league(row["rating"])}


# ==============================
# ========= БЛИЦ-ДУЭЛЬ ========
# ==============================

DUEL_QUESTIONS_COUNT = 10
DUEL_TIME_LIMIT_MS = 15000  # 15 сек на вопрос

# Форматы дуэли = игры Спринта
DUEL_FORMATS = ("sprint", "fastmath", "infomath", "numguess")
# Дуэль «Угадай число»: диапазон и время (как в соло — 60 сек на всех уровнях)
DUEL_NG = {
    "easy":   {"maxN": 10,   "time_ms": 60000},
    "medium": {"maxN": 100,  "time_ms": 60000},
    "hard":   {"maxN": 1000, "time_ms": 60000},
}
# Рейтинг за бой в общий зачёт: победа / ничья / поражение
DUEL_RATING = {"win": 20, "draw": 0, "loss": -20}


def _validate_client_questions(qs) -> list:
    """Проверяем клиентские MCQ (Быстрый счёт / IT-разминка): ровно 10 штук,
    4 варианта, correct в 0..3. Возвращаем очищенный список {q, options, correct}."""
    if not isinstance(qs, list) or len(qs) != DUEL_QUESTIONS_COUNT:
        raise HTTPException(status_code=400, detail="Bad questions")
    out = []
    for q in qs:
        opts = q.get("options") if isinstance(q, dict) else None
        c = q.get("correct") if isinstance(q, dict) else None
        if not isinstance(opts, list) or len(opts) != 4 or not isinstance(c, int) or c < 0 or c > 3:
            raise HTTPException(status_code=400, detail="Bad question item")
        out.append({
            "q": str(q.get("q", ""))[:200],
            "options": [str(o)[:60] for o in opts],
            "correct": c,
        })
    return out


def _score_numguess(payload: dict) -> int:
    """Очки за дуэль «Угадай число»: угадал → тем больше, чем меньше попыток и быстрее."""
    if not payload or not payload.get("solved"):
        return 0
    guesses = max(1, int(payload.get("guesses", 1)))
    elapsed_ms = max(0, int(payload.get("elapsed_ms", 0)))
    score = 1000 - (guesses - 1) * 80 - (elapsed_ms // 1000) * 5
    return max(100, score)


def _gen_duel_id() -> str:
    """Короткий URL-безопасный ID (8 символов)."""
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(8))


def _question_sig(q: dict) -> str:
    """Сигнатура «подтипа»: текст вопроса без чисел (шаблон)."""
    s = re.sub(r"\d+", "#", q["q"].lower())
    s = re.sub(r"\s+", " ", s).strip()
    return s[:40]


def _spread_questions(questions: list) -> list:
    """Честно перемешивает вопросы случайным образом и разводит соседние
    одинаковые подтипы (шаблоны), чтобы вопросы одного типа не шли друг за
    другом. В отличие от жадного «reorganize» не кластеризует по темам —
    даёт по-настоящему случайный, разнообразный порядок каждый раз."""
    sigged = [[_question_sig(q), q] for q in questions]
    random.shuffle(sigged)
    n = len(sigged)
    for i in range(1, n):
        if sigged[i][0] != sigged[i - 1][0]:
            continue
        # текущий совпал с предыдущим — ищем впереди вопрос другого подтипа,
        # который не конфликтует ни слева (i-1), ни справа (i+1), и меняем местами
        for j in range(i + 1, n):
            sj = sigged[j][0]
            if sj != sigged[i - 1][0] and (i + 1 >= n or sj != sigged[i + 1][0]):
                sigged[i], sigged[j] = sigged[j], sigged[i]
                break
    return [q for _, q in sigged]


def shuffle_question(q: dict) -> dict:
    """
    Возвращает копию вопроса со случайно перемешанными вариантами и
    обновлённым индексом правильного ответа.
    """
    opts = list(q["options"])
    correct = q["correct"]
    indexed = [(opt, i == correct) for i, opt in enumerate(opts)]
    random.shuffle(indexed)
    new_options = [opt for opt, _ in indexed]
    new_correct = next(i for i, (_, is_c) in enumerate(indexed) if is_c)
    return {"q": q["q"], "options": new_options, "correct": new_correct}


def _pool_for_difficulty(difficulty: str) -> list:
    """
    Собирает пул вопросов заданной сложности со всех дисциплин
    (информатика + математика + программирование, если есть).
    """
    if difficulty not in ("easy", "medium", "hard"):
        raise HTTPException(status_code=400, detail="Bad difficulty")
    pool = []
    for discipline_key in QUESTIONS:
        section = QUESTIONS[discipline_key]
        if difficulty in section:
            pool.extend(section[difficulty])
    if not pool:
        raise HTTPException(status_code=500, detail="Empty question pool")
    return pool


# Доступные темы вопросов (для выбора темы в дуэли/спринте)
QUIZ_TOPICS = list(QUESTIONS.keys())


def _pool_for(difficulty: str, topic: str = "") -> list:
    """Пул вопросов заданной сложности. topic — одна или несколько тем через запятую
    (informatika/mathematics/physics/programming). Пусто/мусор → микс всех тем."""
    if difficulty not in ("easy", "medium", "hard"):
        raise HTTPException(status_code=400, detail="Bad difficulty")
    picked = [t.strip() for t in (topic or "").split(",") if t.strip() in QUESTIONS]
    if not picked:
        return _pool_for_difficulty(difficulty)
    pool = []
    for t in picked:
        pool.extend(QUESTIONS[t].get(difficulty, []))
    if not pool:
        raise HTTPException(status_code=500, detail="Empty question pool")
    return pool


def _score_answers(questions: list, answers: list) -> int:
    """Считаем очки: 100 базы + до 100 бонуса за скорость на каждый правильный."""
    total = 0
    for a in answers:
        i = a.get("index")
        if i is None or i < 0 or i >= len(questions):
            continue
        q = questions[i]
        chosen = a.get("chosen", -1)
        elapsed = a.get("elapsed_ms", DUEL_TIME_LIMIT_MS)
        elapsed = max(0, min(DUEL_TIME_LIMIT_MS, elapsed))
        if elapsed >= DUEL_TIME_LIMIT_MS:
            continue  # таймаут
        if chosen == q["correct"]:
            base = 100
            speed_bonus = round(100 * (DUEL_TIME_LIMIT_MS - elapsed) / DUEL_TIME_LIMIT_MS)
            total += base + speed_bonus
    return total


def _display_name(row) -> str:
    if not row:
        return "Игрок"
    return row["first_name"] or row["username"] or "Игрок"


def _duel_outcome_line(won, is_draw, my_score, opp_score, delta, opp_name):
    """Короткая строка результата дуэли для уведомления."""
    if is_draw:
        head = f"🤝 Ничья с {opp_name}"
    elif won:
        head = f"🎉 Победа над {opp_name}"
    else:
        head = f"😞 Поражение от {opp_name}"
    sign = "+" if delta > 0 else ""
    line = f"{head} · {my_score}:{opp_score} · рейтинг {sign}{delta}"
    return head, line


def _try_finalize_duel(db, duel_id: str):
    """Если оба игрока сдали — считаем результат, фиксируем, пишем уведомления.
    Возвращает список сообщений (chat_id, text) для отправки ботом в чат."""
    d = db.execute("SELECT * FROM duels WHERE id = ?", (duel_id,)).fetchone()
    if not d or d["status"] == "complete":
        return
    if not (d["creator_finished_at"] and d["opponent_finished_at"]):
        return

    cs = d["creator_score"] or 0
    os_ = d["opponent_score"] or 0
    creator = db.execute("SELECT * FROM users WHERE telegram_id = ?", (d["creator_id"],)).fetchone()
    opponent = db.execute("SELECT * FROM users WHERE telegram_id = ?", (d["opponent_id"],)).fetchone()

    if cs > os_:
        score_a, winner, is_draw = 1.0, creator["telegram_id"], 0
    elif cs < os_:
        score_a, winner, is_draw = 0.0, opponent["telegram_id"], 0
    else:
        score_a, winner, is_draw = 0.5, None, 1

    # Рейтинг за бой: фикс +20 / 0 / −20, свой кап 100/день на каждый формат
    fmt = d["format"] or "sprint"
    src = f"duel_{fmt}"
    res_a = "win" if score_a == 1.0 else ("draw" if is_draw else "loss")
    res_b = "win" if score_a == 0.0 else ("draw" if is_draw else "loss")

    def _apply_duel_rating(uid, res):
        delta = DUEL_RATING[res]
        if delta > 0:  # выигрыш ограничен дневным капом на формат
            earned = get_training_earned_today(db, uid, src)
            delta = min(delta, max(0, DAILY_TRAINING_CAP - earned))
        if delta != 0:
            db.execute(
                "UPDATE users SET rating = MAX(0, rating + ?) WHERE telegram_id = ?",
                (delta, uid),
            )
            nr = db.execute(
                "SELECT rating FROM users WHERE telegram_id = ?", (uid,)
            ).fetchone()["rating"]
            db.execute(
                "INSERT INTO rating_log (user_id, delta, source, balance_after) VALUES (?, ?, ?, ?)",
                (uid, delta, src, nr),
            )
        return delta

    d_a = _apply_duel_rating(creator["telegram_id"], res_a)
    d_b = _apply_duel_rating(opponent["telegram_id"], res_b)

    # --- Начисляем XP: победитель много, проигравший — утешительно ---
    if is_draw:
        xp_a = XP_DUEL_DRAW
        xp_b = XP_DUEL_DRAW
    elif score_a == 1.0:  # A победил
        xp_a = XP_DUEL_WIN
        xp_b = XP_DUEL_LOSS
    else:  # A проиграл
        xp_a = XP_DUEL_LOSS
        xp_b = XP_DUEL_WIN
    award_xp(db, creator["telegram_id"], xp_a, "duel")
    award_xp(db, opponent["telegram_id"], xp_b, "duel")

    # Прогресс квестов: победа в дуэли + xp_earned
    if not is_draw:
        winner_id_local = creator["telegram_id"] if score_a == 1.0 else opponent["telegram_id"]
        update_quest_progress(db, winner_id_local, "duel_won", 1)
    update_quest_progress(db, creator["telegram_id"], "xp_earned", xp_a)
    update_quest_progress(db, opponent["telegram_id"], "xp_earned", xp_b)

    # Проверка ачивок для обоих
    _check_and_grant_achievements(db, creator["telegram_id"])
    _check_and_grant_achievements(db, opponent["telegram_id"])

    db.execute(
        """
        UPDATE duels
        SET status = 'complete', winner_id = ?, is_draw = ?,
            creator_delta = ?, opponent_delta = ?
        WHERE id = ?
        """,
        (winner, is_draw, d_a, d_b, duel_id),
    )

    # --- Уведомления обоим игрокам (в приложение) + сообщения для бота ---
    msgs = []
    for uid, won_flag, my_s, opp_s, dlt, opp_nm in (
        (creator["telegram_id"], winner == creator["telegram_id"], cs, os_, d_a, _display_name(opponent)),
        (opponent["telegram_id"], winner == opponent["telegram_id"], os_, cs, d_b, _display_name(creator)),
    ):
        head, line = _duel_outcome_line(won_flag, is_draw, my_s, opp_s, dlt, opp_nm)
        db.execute("INSERT INTO notification (user_id, text) VALUES (?, ?)", (uid, line))
        sign = "+" if dlt > 0 else ""
        msgs.append((uid, f"⚔ <b>Блиц-дуэль завершена!</b>\n\n{head}\nСчёт: <b>{my_s}:{opp_s}</b> · рейтинг: <b>{sign}{dlt}</b>"))
    return msgs


async def _send_bot_messages(messages):
    """Отправляет список (chat_id, text) через Bot API (для результатов дуэлей)."""
    if not BOT_TOKEN:
        return
    async with httpx.AsyncClient(timeout=15) as client:
        for chat_id, text in messages:
            try:
                await client.post(
                    f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
                    json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
                )
            except Exception:
                pass
            await asyncio.sleep(0.03)


def _duel_public_view(db, duel, viewer_id: int) -> dict:
    """Формируем ответ для клиента (без ответов до финала)."""
    creator = db.execute(
        "SELECT * FROM users WHERE telegram_id = ?", (duel["creator_id"],)
    ).fetchone()
    opponent = None
    if duel["opponent_id"]:
        opponent = db.execute(
            "SELECT * FROM users WHERE telegram_id = ?", (duel["opponent_id"],)
        ).fetchone()

    res = {
        "id": duel["id"],
        "status": duel["status"],
        "difficulty": duel["difficulty"],
        "format": duel["format"] or "sprint",
        "creator": {
            "id": creator["telegram_id"],
            "name": _display_name(creator),
            "rating": creator["rating"],
            "league": get_league(creator["rating"]),
        },
        "opponent": None,
        "you_are": None,
        "creator_score": duel["creator_score"],
        "opponent_score": duel["opponent_score"],
        "creator_delta": duel["creator_delta"],
        "opponent_delta": duel["opponent_delta"],
        "is_draw": bool(duel["is_draw"]),
        "winner_id": duel["winner_id"],
    }
    if opponent:
        res["opponent"] = {
            "id": opponent["telegram_id"],
            "name": _display_name(opponent),
            "rating": opponent["rating"],
            "league": get_league(opponent["rating"]),
        }
    if viewer_id == duel["creator_id"]:
        res["you_are"] = "creator"
    elif opponent and viewer_id == opponent["telegram_id"]:
        res["you_are"] = "opponent"

    # XP-инфа зрителя (если дуэль завершена)
    if duel["status"] == "complete" and res["you_are"]:
        me_row = db.execute(
            "SELECT xp FROM users WHERE telegram_id = ?", (viewer_id,)
        ).fetchone()
        if me_row:
            res["my_xp"] = me_row["xp"]
            res["my_level_info"] = get_level_info(me_row["xp"])
            # Сколько XP дали за эту дуэль
            if duel["is_draw"]:
                res["xp_awarded"] = XP_DUEL_DRAW
            elif res["you_are"] == "creator":
                res["xp_awarded"] = XP_DUEL_WIN if duel["winner_id"] == duel["creator_id"] else XP_DUEL_LOSS
            else:
                res["xp_awarded"] = XP_DUEL_WIN if duel["winner_id"] == duel["opponent_id"] else XP_DUEL_LOSS

    return res


@app.post("/api/duel/create")
async def duel_create(
    init_data: str = Body(...),
    difficulty: str = Body("mixed"),
    topic: str = Body(""),
    format: str = Body("sprint"),
    questions: list = Body(None),   # клиентские MCQ для fastmath / infomath
):
    """Создать новую дуэль в одном из форматов Спринта.
    sprint — вопросы из банка (сервер); fastmath/infomath — MCQ от клиента;
    numguess — сервер загадывает число."""
    if format not in DUEL_FORMATS:
        raise HTTPException(status_code=400, detail="Bad format")
    tg_user = get_verified_user(init_data)

    with get_db() as db:
        creator = upsert_user(db, tg_user)
        duel_id = _gen_duel_id()

        if format == "numguess":
            cfg = DUEL_NG.get(difficulty)
            if not cfg:
                raise HTTPException(status_code=400, detail="Bad difficulty")
            secret = random.randint(1, cfg["maxN"])
            payload = {"format": "numguess", "secret": secret,
                       "maxN": cfg["maxN"], "time_ms": cfg["time_ms"]}
            db.execute(
                "INSERT INTO duels (id, creator_id, difficulty, questions_json, format) VALUES (?, ?, ?, ?, ?)",
                (duel_id, creator["telegram_id"], difficulty, json.dumps(payload), format),
            )
            return {
                "duel_id": duel_id, "format": "numguess",
                "maxN": cfg["maxN"], "secret": secret, "time_limit_ms": cfg["time_ms"],
            }

        if format == "sprint":
            pool = _pool_for(difficulty, topic)
            if len(pool) < DUEL_QUESTIONS_COUNT:
                raise HTTPException(status_code=500, detail="Not enough questions")
            selected = [shuffle_question(q) for q in random.sample(pool, DUEL_QUESTIONS_COUNT)]
        else:  # fastmath / infomath — MCQ сгенерил клиент
            selected = [shuffle_question(q) for q in _validate_client_questions(questions)]

        db.execute(
            "INSERT INTO duels (id, creator_id, difficulty, questions_json, format) VALUES (?, ?, ?, ?, ?)",
            (duel_id, creator["telegram_id"], difficulty, json.dumps(selected), format),
        )

    public_questions = [{"q": q["q"], "options": q["options"]} for q in selected]
    return {
        "duel_id": duel_id, "format": format,
        "questions": public_questions,
        "time_limit_ms": DUEL_TIME_LIMIT_MS,
    }


@app.post("/api/duel/{duel_id}/join")
async def duel_join(
    duel_id: str,
    init_data: str = Body(..., embed=True),
):
    """Принять вызов. Возвращает вопросы (без правильных)."""
    tg_user = get_verified_user(init_data)
    with get_db() as db:
        me = upsert_user(db, tg_user)
        duel = db.execute("SELECT * FROM duels WHERE id = ?", (duel_id,)).fetchone()
        if not duel:
            raise HTTPException(status_code=404, detail="Duel not found")
        if duel["status"] == "complete":
            raise HTTPException(status_code=400, detail="Duel already complete")
        if duel["creator_id"] == me["telegram_id"]:
            raise HTTPException(status_code=400, detail="Cannot join your own duel")
        if duel["opponent_id"] and duel["opponent_id"] != me["telegram_id"]:
            raise HTTPException(status_code=400, detail="Duel already taken")
        if not duel["opponent_id"]:
            db.execute(
                "UPDATE duels SET opponent_id = ? WHERE id = ?",
                (me["telegram_id"], duel_id),
            )
            duel = db.execute("SELECT * FROM duels WHERE id = ?", (duel_id,)).fetchone()

    fmt = duel["format"] or "sprint"
    payload = json.loads(duel["questions_json"])
    with get_db() as db2:
        creator = db2.execute(
            "SELECT * FROM users WHERE telegram_id = ?", (duel["creator_id"],)
        ).fetchone()
    common = {
        "duel_id": duel_id,
        "format": fmt,
        "creator_name": _display_name(creator),
        "creator_score": duel["creator_score"],
    }
    if fmt == "numguess":
        return {**common, "maxN": payload["maxN"], "secret": payload["secret"],
                "time_limit_ms": payload["time_ms"]}
    public_questions = [{"q": q["q"], "options": q["options"]} for q in payload]
    return {
        **common,
        "questions": public_questions,
        "time_limit_ms": DUEL_TIME_LIMIT_MS,
    }


@app.post("/api/duel/{duel_id}/submit")
async def duel_submit(
    duel_id: str,
    init_data: str = Body(...),
    answers: list = Body(None),      # MCQ-форматы (sprint/fastmath/infomath)
    ng: dict = Body(None),           # результат «Угадай число»
):
    """Сдать результат. Считаем очки, если оба сдали — финализируем."""
    tg_user = get_verified_user(init_data)
    with get_db() as db:
        me = upsert_user(db, tg_user)
        my_id = me["telegram_id"]
        duel = db.execute("SELECT * FROM duels WHERE id = ?", (duel_id,)).fetchone()
        if not duel:
            raise HTTPException(status_code=404, detail="Duel not found")
        if duel["status"] == "complete":
            raise HTTPException(status_code=400, detail="Duel already complete")

        if (duel["format"] or "sprint") == "numguess":
            my_score = _score_numguess(ng or {})
        else:
            questions = json.loads(duel["questions_json"])
            my_score = _score_answers(questions, answers or [])

        if my_id == duel["creator_id"]:
            if duel["creator_finished_at"]:
                raise HTTPException(status_code=400, detail="Already submitted")
            db.execute(
                """
                UPDATE duels
                SET creator_score = ?, creator_finished_at = datetime('now'),
                    status = 'waiting'
                WHERE id = ?
                """,
                (my_score, duel_id),
            )
        else:
            # Оппонент. Если ещё не занял слот — занимает
            if duel["opponent_id"] and duel["opponent_id"] != my_id:
                raise HTTPException(status_code=400, detail="Duel already taken")
            if duel["opponent_id"] == my_id and duel["opponent_finished_at"]:
                raise HTTPException(status_code=400, detail="Already submitted")
            db.execute(
                """
                UPDATE duels
                SET opponent_id = ?, opponent_score = ?, opponent_finished_at = datetime('now')
                WHERE id = ?
                """,
                (my_id, my_score, duel_id),
            )

        _duel_msgs = _try_finalize_duel(db, duel_id)
        duel = db.execute("SELECT * FROM duels WHERE id = ?", (duel_id,)).fetchone()
        view = _duel_public_view(db, duel, my_id)
    # дубль результата в чат обоим игрокам (в фоне, не держим ответ)
    if _duel_msgs:
        _t = asyncio.create_task(_send_bot_messages(_duel_msgs))
        _bg_tasks.add(_t)
        _t.add_done_callback(_bg_tasks.discard)
    return view


@app.post("/api/duels/history")
async def duels_history(
    init_data: str = Body(...),
    limit: int = Body(30),
):
    """Последние завершённые дуэли текущего игрока."""
    tg_user = get_verified_user(init_data)
    limit = max(1, min(100, limit))
    with get_db() as db:
        me = upsert_user(db, tg_user)
        my_id = me["telegram_id"]
        rows = db.execute(
            """
            SELECT * FROM duels
            WHERE (creator_id = ? OR opponent_id = ?)
              AND status = 'complete'
            ORDER BY created_at DESC
            LIMIT ?
            """,
            (my_id, my_id, limit),
        ).fetchall()

        history = []
        for d in rows:
            is_creator = d["creator_id"] == my_id
            opp_id = d["opponent_id"] if is_creator else d["creator_id"]
            my_score = d["creator_score"] if is_creator else d["opponent_score"]
            opp_score = d["opponent_score"] if is_creator else d["creator_score"]
            my_delta = d["creator_delta"] if is_creator else d["opponent_delta"]
            opp_row = db.execute(
                "SELECT * FROM users WHERE telegram_id = ?", (opp_id,)
            ).fetchone()
            history.append({
                "duel_id": d["id"],
                "opponent_name": _display_name(opp_row),
                "opponent_rating": opp_row["rating"] if opp_row else 0,
                "my_score": my_score or 0,
                "opp_score": opp_score or 0,
                "my_delta": my_delta or 0,
                "won": d["winner_id"] == my_id,
                "draw": bool(d["is_draw"]),
                "created_at": d["created_at"],
                "difficulty": d["difficulty"],
            })
    return {"history": history}


@app.post("/api/duel/pending")
async def duel_pending(init_data: str = Body(..., embed=True)):
    """Есть ли у игрока свежее приглашение на дуэль (записанное ботом по клику на
    ссылку). Одноразово: отдаём и очищаем. Нужно, если клиент не донёс параметр в URL."""
    tg_user = get_verified_user(init_data)
    with get_db() as db:
        me = upsert_user(db, tg_user)
        row = db.execute(
            "SELECT duel_id FROM pending_duel WHERE user_id = ? "
            "AND created_at >= datetime('now', '-30 minutes')",
            (me["telegram_id"],),
        ).fetchone()
        db.execute("DELETE FROM pending_duel WHERE user_id = ?", (me["telegram_id"],))
        if not row:
            return {"duel_id": None}
        duel = db.execute("SELECT status FROM duels WHERE id = ?", (row["duel_id"],)).fetchone()
        if not duel or duel["status"] == "complete":
            return {"duel_id": None}
        return {"duel_id": row["duel_id"]}


async def _notify_challenge(target_id: int, from_name: str, league: dict, rating: int):
    """Личное сообщение игроку от бота: тебя вызвали на дуэль."""
    if not (BOT_TOKEN and WEBAPP_URL):
        return
    lg = f"{league.get('emoji', '')} {league.get('display') or league.get('name', '')}".strip()
    text = (
        f"🔥 <b>{from_name}</b> ({lg}, рейтинг {rating}) вызвал тебя на Блиц-дуэль!\n\n"
        f"Прими вызов — сыграешь те же вопросы. Победа <b>+20</b> к рейтингу."
    )
    markup = {"inline_keyboard": [[{"text": "⚔ Принять вызов", "web_app": {"url": WEBAPP_URL}}]]}
    async with httpx.AsyncClient(timeout=15) as client:
        try:
            await client.post(
                f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
                json={"chat_id": target_id, "text": text, "parse_mode": "HTML", "reply_markup": markup},
            )
        except Exception:
            pass


@app.post("/api/duel/incoming")
async def duel_incoming(init_data: str = Body(..., embed=True)):
    """Входящие вызовы: дуэли, где меня назначили соперником и я ещё не сыграл."""
    tg_user = get_verified_user(init_data)
    with get_db() as db:
        me = upsert_user(db, tg_user)
        rows = db.execute(
            """
            SELECT id, creator_id, creator_score, format, difficulty, created_at
            FROM duels
            WHERE opponent_id = ? AND status != 'complete' AND opponent_finished_at IS NULL
            ORDER BY created_at DESC LIMIT 20
            """,
            (me["telegram_id"],),
        ).fetchall()
        out = []
        for d in rows:
            c = db.execute("SELECT * FROM users WHERE telegram_id = ?", (d["creator_id"],)).fetchone()
            out.append({
                "duel_id": d["id"],
                "from_name": _display_name(c),
                "from_rating": c["rating"] if c else 0,
                "from_league": get_league(c["rating"]) if c else None,
                "format": d["format"] or "sprint",
                "score": d["creator_score"] or 0,
            })
    return {"incoming": out}


@app.post("/api/duel/{duel_id}/challenge")
async def duel_challenge(
    duel_id: str,
    init_data: str = Body(...),
    target_id: int = Body(...),
):
    """Назначить сыгранную дуэль конкретному игроку (вызов по рейтингу) + уведомить его."""
    tg_user = get_verified_user(init_data)
    with get_db() as db:
        me = upsert_user(db, tg_user)
        duel = db.execute("SELECT * FROM duels WHERE id = ?", (duel_id,)).fetchone()
        if not duel or duel["creator_id"] != me["telegram_id"]:
            raise HTTPException(status_code=404, detail="Duel not found")
        if duel["status"] == "complete":
            raise HTTPException(status_code=400, detail="Already complete")
        if duel["opponent_id"]:
            raise HTTPException(status_code=400, detail="Already assigned")
        if duel["creator_score"] is None:
            raise HTTPException(status_code=400, detail="Play the duel first")
        if target_id == me["telegram_id"]:
            raise HTTPException(status_code=400, detail="Cannot challenge yourself")
        target = db.execute("SELECT * FROM users WHERE telegram_id = ?", (target_id,)).fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="Player not found")
        # нельзя звать того же игрока повторно в ту же игру, пока он не принял первый вызов
        pending = db.execute(
            """SELECT 1 FROM duels
               WHERE creator_id = ? AND opponent_id = ? AND format = ?
                 AND status != 'complete' AND opponent_finished_at IS NULL
                 AND id != ?
               LIMIT 1""",
            (me["telegram_id"], target_id, duel["format"], duel_id),
        ).fetchone()
        if pending:
            raise HTTPException(
                status_code=409,
                detail=f"{_display_name(target)} ещё не принял твой прошлый вызов в этой игре. Дождись ответа.",
            )
        db.execute("UPDATE duels SET opponent_id = ? WHERE id = ?", (target_id, duel_id))
        db.execute(
            "INSERT OR REPLACE INTO pending_duel (user_id, duel_id, created_at) VALUES (?, ?, datetime('now'))",
            (target_id, duel_id),
        )
        from_name = _display_name(me)
        from_rating = me["rating"]
        from_league = get_league(from_rating)
        target_name = _display_name(target)
        _notify(db, target_id, f"⚔ {from_name} вызвал тебя на Блиц-дуэль! Прими вызов во «Входящих».")
    t = asyncio.create_task(_notify_challenge(target_id, from_name, from_league, from_rating))
    _bg_tasks.add(t)
    t.add_done_callback(_bg_tasks.discard)
    return {"ok": True, "name": target_name}


@app.post("/api/duel/{duel_id}")
async def duel_info(
    duel_id: str,
    init_data: str = Body(..., embed=True),
):
    """Получить состояние дуэли."""
    tg_user = get_verified_user(init_data)
    with get_db() as db:
        me = upsert_user(db, tg_user)
        duel = db.execute("SELECT * FROM duels WHERE id = ?", (duel_id,)).fetchone()
        if not duel:
            raise HTTPException(status_code=404, detail="Duel not found")
        return _duel_public_view(db, duel, me["telegram_id"])


# ==============================
# ======= ВЫЗОВ НЕДЕЛИ =========
# ==============================

WEEKLY_FMT_TITLES = {
    "sprint": "Профи-блиц",
    "fastmath": "Быстрый счёт",
    "infomath": "IT-разминка",
    "numguess": "Угадай число",
}
WEEKLY_BONUS = 50
_bg_tasks: set = set()


async def _broadcast_weekly(fmt: str, admin_score: int, exclude_id: int = 0):
    """Рассылает «Вызов от Игоря» всем пользователям (sendPhoto + web_app кнопка)."""
    if not (BOT_TOKEN and WEBAPP_URL):
        return
    with get_db() as db:
        ids = [r["telegram_id"] for r in db.execute(
            "SELECT telegram_id FROM users WHERE telegram_id != ?", (exclude_id,)
        ).fetchall()]
    fmt_title = WEEKLY_FMT_TITLES.get(fmt, fmt)
    caption = (
        f"⚔ <b>Новый Вызов от Игоря!</b>\n\n"
        f"Формат: <b>{fmt_title}</b>. Счёт, который надо побить: <b>{admin_score}</b>.\n"
        f"Обгони — и получи <b>+{WEEKLY_BONUS}</b> к рейтингу. Попытка одна.\n\n"
        f"Жми «Принять вызов» 👇"
    )
    photo = f"{WEBAPP_URL.rstrip('/')}/profik-weekly.png"
    markup = {"inline_keyboard": [[{"text": "⚔ Принять вызов", "web_app": {"url": f"{WEBAPP_URL}?weekly=1"}}]]}
    async with httpx.AsyncClient(timeout=20) as client:
        for uid in ids:
            try:
                await client.post(
                    f"https://api.telegram.org/bot{BOT_TOKEN}/sendPhoto",
                    json={"chat_id": uid, "photo": photo, "caption": caption,
                          "parse_mode": "HTML", "reply_markup": markup},
                )
            except Exception:
                pass
            await asyncio.sleep(0.05)  # ~20 сообщений/сек — в пределах лимитов Telegram


@app.post("/api/weekly/promote")
async def weekly_promote(init_data: str = Body(...), duel_id: str = Body(...)):
    """Админ: делает свою сыгранную дуэль активным «Вызовом от Игоря» и рассылает его."""
    tg_user = get_verified_user(init_data)
    if tg_user["id"] not in ADMIN_IDS:
        raise HTTPException(status_code=403, detail="Not admin")
    with get_db() as db:
        me = upsert_user(db, tg_user)
        duel = db.execute("SELECT * FROM duels WHERE id = ?", (duel_id,)).fetchone()
        if not duel or duel["creator_id"] != me["telegram_id"]:
            raise HTTPException(status_code=404, detail="Duel not found")
        if duel["creator_score"] is None:
            raise HTTPException(status_code=400, detail="Play the duel first")
        db.execute("UPDATE weekly_challenge SET active = 0 WHERE active = 1")
        cur = db.execute(
            """
            INSERT INTO weekly_challenge (creator_id, format, difficulty, payload_json, admin_score, active)
            VALUES (?, ?, ?, ?, ?, 1)
            """,
            (me["telegram_id"], duel["format"] or "sprint", duel["difficulty"],
             duel["questions_json"], duel["creator_score"]),
        )
        challenge_id = cur.lastrowid
        fmt = duel["format"] or "sprint"
        admin_score = duel["creator_score"]
        # уведомление всем игрокам в приложении (кроме автора)
        db.execute(
            "INSERT INTO notification (user_id, text) SELECT telegram_id, ? FROM users WHERE telegram_id != ?",
            (f"🔥 Новый Вызов от Игоря! Обгони {admin_score} в «{WEEKLY_FMT_TITLES.get(fmt, fmt)}» → +50",
             me["telegram_id"]),
        )
    t = asyncio.create_task(_broadcast_weekly(fmt, admin_score, me["telegram_id"]))
    _bg_tasks.add(t)
    t.add_done_callback(_bg_tasks.discard)
    return {"id": challenge_id, "admin_score": admin_score}


@app.post("/api/weekly/active")
async def weekly_active(init_data: str = Body(..., embed=True)):
    """Текущий активный Вызов от Игоря + моя попытка (если играл)."""
    tg_user = get_verified_user(init_data)
    with get_db() as db:
        me = upsert_user(db, tg_user)
        ch = db.execute(
            "SELECT * FROM weekly_challenge WHERE active = 1 ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if not ch:
            return {"active": False}
        creator = db.execute(
            "SELECT * FROM users WHERE telegram_id = ?", (ch["creator_id"],)
        ).fetchone()
        attempt = db.execute(
            "SELECT score, beat, bonus FROM weekly_attempt WHERE challenge_id = ? AND user_id = ?",
            (ch["id"], me["telegram_id"]),
        ).fetchone()
        fmt = ch["format"]
        payload = json.loads(ch["payload_json"])
        res = {
            "active": True,
            "id": ch["id"],
            "format": fmt,
            "difficulty": ch["difficulty"],
            "admin_name": _display_name(creator),
            "admin_score": ch["admin_score"],
            "is_admin": me["telegram_id"] == ch["creator_id"],
            "my_attempt": (dict(attempt) if attempt else None),
        }
        if fmt == "numguess":
            res.update({"maxN": payload["maxN"], "secret": payload["secret"],
                        "time_limit_ms": payload["time_ms"]})
        else:
            res["questions"] = [{"q": q["q"], "options": q["options"]} for q in payload]
            res["time_limit_ms"] = DUEL_TIME_LIMIT_MS
        return res


@app.post("/api/weekly/{challenge_id}/attempt")
async def weekly_attempt(
    challenge_id: int,
    init_data: str = Body(...),
    answers: list = Body(None),
    ng: dict = Body(None),
):
    """Пользователь сдаёт попытку. Обогнал счёт админа → +50 (один раз за вызов)."""
    tg_user = get_verified_user(init_data)
    with get_db() as db:
        me = upsert_user(db, tg_user)
        my_id = me["telegram_id"]
        ch = db.execute("SELECT * FROM weekly_challenge WHERE id = ?", (challenge_id,)).fetchone()
        if not ch:
            raise HTTPException(status_code=404, detail="Challenge not found")
        if my_id == ch["creator_id"]:
            raise HTTPException(status_code=400, detail="Own challenge")
        existing = db.execute(
            "SELECT score, beat, bonus FROM weekly_attempt WHERE challenge_id = ? AND user_id = ?",
            (challenge_id, my_id),
        ).fetchone()
        if existing:
            return {"score": existing["score"], "admin_score": ch["admin_score"],
                    "beat": bool(existing["beat"]), "bonus": existing["bonus"], "already": True}

        if (ch["format"] or "sprint") == "numguess":
            score = _score_numguess(ng or {})
        else:
            questions = json.loads(ch["payload_json"])
            score = _score_answers(questions, answers or [])

        beat = score > ch["admin_score"]
        bonus = WEEKLY_BONUS if beat else 0
        if bonus:
            db.execute("UPDATE users SET rating = rating + ? WHERE telegram_id = ?", (bonus, my_id))
            nr = db.execute("SELECT rating FROM users WHERE telegram_id = ?", (my_id,)).fetchone()["rating"]
            db.execute(
                "INSERT INTO rating_log (user_id, delta, source, balance_after) VALUES (?, ?, 'weekly', ?)",
                (my_id, bonus, nr),
            )
            _notify(db, my_id, f"🎉 Ты обыграл Вызов от Игоря! +{bonus} к рейтингу")
        db.execute(
            "INSERT INTO weekly_attempt (challenge_id, user_id, score, beat, bonus) VALUES (?, ?, ?, ?, ?)",
            (challenge_id, my_id, score, 1 if beat else 0, bonus),
        )
        return {"score": score, "admin_score": ch["admin_score"], "beat": beat, "bonus": bonus}


# ---------- Python-режим (MVP) ----------
@app.post("/api/python/telemetry_batch")
async def python_telemetry_batch(payload: dict = Body(...)):
    """
    Приём батчей телеметрии Python-режима.
    Пока просто пишем в файл — позже перенесём в SQLite таблицу python_telemetry.
    """
    events = payload.get("events", [])
    if not events:
        return {"ok": True, "received": 0}
    try:
        DATA_DIR = Path(__file__).parent / "data"
        DATA_DIR.mkdir(exist_ok=True)
        log_path = DATA_DIR / "python_telemetry.jsonl"
        with open(log_path, "a", encoding="utf-8") as f:
            for ev in events:
                f.write(json.dumps(ev, ensure_ascii=False) + "\n")
    except Exception as e:
        # не роняем сессию из-за телеметрии
        print(f"[python_telemetry] {e}")
    return {"ok": True, "received": len(events)}


@app.post("/api/python/session_end")
async def python_session_end(payload: dict = Body(...)):
    """
    Финализация сессии Python-режима.
    XP — начисляется всегда. Рейтинг — только за ПЕРВОЕ прохождение
    реального урока/проекта (сервер хранит зачтённые уроки — накрутка
    повторами невозможна). Повторы, ежедневки, тесты недели — только XP.
    """
    init_data = payload.get("init_data", "")
    xp_earned = int(payload.get("xpEarned", 0) or 0)
    if xp_earned < 0 or xp_earned > 500:
        xp_earned = 0
    accuracy = int(payload.get("accuracy", 0) or 0)
    accuracy = max(0, min(100, accuracy))
    lesson_id = str(payload.get("lessonId", ""))[:64]
    kind = str(payload.get("kind", ""))

    if not init_data:
        return {"ok": True, "xp_added": 0, "rating_added": 0, "reason": "no_auth"}
    tg_user = verify_telegram_init_data(init_data, BOT_TOKEN)
    if not tg_user:
        return {"ok": True, "xp_added": 0, "rating_added": 0, "reason": "bad_auth"}

    rating_added = 0
    with get_db() as db:
        me = upsert_user(db, tg_user)
        uid = me["telegram_id"]

        # таблица зачтённых уроков (создаём при первом обращении)
        db.execute(
            """
            CREATE TABLE IF NOT EXISTS python_completed (
                user_id   INTEGER NOT NULL,
                lesson_id TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now')),
                PRIMARY KEY (user_id, lesson_id)
            )
            """
        )

        # XP — всегда
        if xp_earned:
            db.execute(
                "UPDATE users SET xp = COALESCE(xp,0) + ? WHERE telegram_id = ?",
                (xp_earned, uid),
            )

        # Рейтинг — только за первое прохождение реального урока или проекта
        if kind in ("lesson", "project") and lesson_id:
            already = db.execute(
                "SELECT 1 FROM python_completed WHERE user_id = ? AND lesson_id = ?",
                (uid, lesson_id),
            ).fetchone()
            if not already:
                base = min(20, max(5, xp_earned))
                rating_added = max(2, min(15, round(base * accuracy / 100)))
                # у Python свой кап 100 рейтинга в день, как у игр Спринта
                earned_py = get_training_earned_today(db, uid, "python")
                rating_added = min(rating_added, max(0, DAILY_TRAINING_CAP - earned_py))
            if not already and rating_added > 0:
                db.execute(
                    "UPDATE users SET rating = rating + ? WHERE telegram_id = ?",
                    (rating_added, uid),
                )
                new_rating = db.execute(
                    "SELECT rating FROM users WHERE telegram_id = ?", (uid,)
                ).fetchone()["rating"]
                db.execute(
                    "INSERT INTO rating_log (user_id, delta, source, balance_after) VALUES (?, ?, ?, ?)",
                    (uid, rating_added, "python", new_rating),
                )
                db.execute(
                    "INSERT INTO python_completed (user_id, lesson_id) VALUES (?, ?)",
                    (uid, lesson_id),
                )
        db.commit()

    return {"ok": True, "xp_added": xp_earned, "rating_added": rating_added}


# ---------- Версия сборки (для проверки, что задеплоилось) ----------
BUILD_TAG = "python-onboard-nowait-v81"


@app.get("/api/version")
async def version():
    return {
        "build": BUILD_TAG,
        "commit": os.environ.get("RAILWAY_GIT_COMMIT_SHA", "dev")[:8],
    }


# ---------- Раздача статики фронтенда ----------
# Всё, что не /api/*, отдаём как статику
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

# HTML всегда свежий (в нём ссылки с ?v=… на js/css) — иначе после деплоя покажется старая версия.
_NO_CACHE = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
}
# JS и CSS: кэшируем, но с обязательной ревалидацией (no-cache = условный запрос,
# сервер отвечает 304 без тела, если файл не менялся). Так браузер не качает
# заново тяжёлый script.js каждый раз, но всегда получает свежую версию —
# безопасно даже для неверсионированных модулей (Python-курс импортирует их без ?v=).
_ASSET_CACHE = {"Cache-Control": "no-cache"}
# Картинки/шрифты не версионируются — кэшируем на час (обновления доезжают быстро).
_MEDIA_CACHE = {"Cache-Control": "public, max-age=3600"}


def _cache_headers(path: str) -> dict:
    p = path.lower()
    if p.endswith((".js", ".css")):
        return _ASSET_CACHE
    if p.endswith((".png", ".jpg", ".jpeg", ".svg", ".webp", ".gif", ".ico",
                   ".woff", ".woff2", ".ttf", ".mp3", ".wav")):
        return _MEDIA_CACHE
    return _NO_CACHE  # html и всё остальное — без кэша, всегда свежее


@app.get("/")
async def root():
    return FileResponse(FRONTEND_DIR / "index.html", headers=_NO_CACHE)


@app.get("/{path:path}")
async def spa(path: str):
    file_path = FRONTEND_DIR / path
    if file_path.exists() and file_path.is_file():
        return FileResponse(file_path, headers=_cache_headers(path))
    return FileResponse(FRONTEND_DIR / "index.html", headers=_NO_CACHE)


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
