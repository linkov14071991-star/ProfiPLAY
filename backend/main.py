"""
ProfiPlay - Telegram Mini App
Backend: FastAPI
Игра: Крокодил (Информатика)

Задачи backend:
1. Отдавать статику фронтенда (index.html и т.д.)
2. Проверять подписку пользователя на канал @profimatika_inf
3. Отдавать список слов по выбранной сложности
"""

import hashlib
import hmac
import json
import os
import random
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
}

# Множитель по сложности вопросов
DIFFICULTY_MULT = {"easy": 1.0, "medium": 1.5, "hard": 2.0}
# Множитель по количеству жизней в Марафоне (меньше жизней = больше очков за риск)
LIVES_MULT = {1: 3.0, 3: 2.0, 5: 1.0}
# Базовая ставка рейтинга за один правильный ответ.
# Тусовка (party) = 0 очков, потому что играется на своей честности —
# слишком просто накрутить рейтинг. Прогресс квестов и ачивок при этом сохраняется.
BASE_RATING_PER_CORRECT = {"sprint": 1, "marathon": 2, "party": 0}
# Duel XP
XP_DUEL_WIN = 50
XP_DUEL_DRAW = 30
XP_DUEL_LOSS = 20

# ---------- Настройки ----------
BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
BOT_USERNAME = os.environ.get("BOT_USERNAME", "")  # без @, например 'profikarena_bot'
CHANNEL_USERNAME = os.environ.get("CHANNEL_USERNAME", "@profimatika_inf")

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
    questions = _pool_for(difficulty, topics).copy()
    random.shuffle(questions)
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
    pool = _pool_for(difficulty, topics).copy()
    random.shuffle(pool)
    return {"questions": [shuffle_question(q) for q in pool[:limit]]}


@app.get("/api/config")
async def get_config():
    """Небольшой конфиг для фронтенда (публичные данные + множители)."""
    return {
        "bot_username": BOT_USERNAME,
        "channel_username": CHANNEL_USERNAME.lstrip("@"),
        "difficulty_mult": DIFFICULTY_MULT,
        "lives_mult": LIVES_MULT,
        "base_per_correct": BASE_RATING_PER_CORRECT,
    }


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

        # --- Рейтинг с капом ---
        earned = get_training_earned_today(db, user_id)
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
    leaders = []
    for i, r in enumerate(rows, start=1):
        d = dict(r)
        d["place"] = i
        d["league"] = get_league(d["rating"])
        leaders.append(d)
    return {"leaders": leaders}


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


def _gen_duel_id() -> str:
    """Короткий URL-безопасный ID (8 символов)."""
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(8))


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


def _try_finalize_duel(db, duel_id: str):
    """Если оба игрока сдали — считаем ELO, фиксируем результат."""
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

    d_a, d_b = calculate_elo(creator["rating"], opponent["rating"], score_a)

    # Обновляем рейтинги (не даём уйти в минус)
    for uid, delta in ((creator["telegram_id"], d_a), (opponent["telegram_id"], d_b)):
        db.execute(
            "UPDATE users SET rating = MAX(0, rating + ?) WHERE telegram_id = ?",
            (delta, uid),
        )
        new_rating = db.execute(
            "SELECT rating FROM users WHERE telegram_id = ?", (uid,)
        ).fetchone()["rating"]
        db.execute(
            """
            INSERT INTO rating_log (user_id, delta, source, balance_after)
            VALUES (?, ?, 'duel', ?)
            """,
            (uid, delta, new_rating),
        )

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
):
    """Создать новую дуэль. Возвращает id и 10 вопросов (без правильных ответов).
    topic — тема вопросов (informatika/mathematics/programming) или пусто = микс."""
    tg_user = get_verified_user(init_data)
    pool = _pool_for(difficulty, topic)
    if len(pool) < DUEL_QUESTIONS_COUNT:
        raise HTTPException(status_code=500, detail="Not enough questions")
    # Перемешиваем варианты каждого вопроса. Сохраняется этот вариант — оба игрока увидят один и тот же порядок.
    selected = [shuffle_question(q) for q in random.sample(pool, DUEL_QUESTIONS_COUNT)]

    with get_db() as db:
        creator = upsert_user(db, tg_user)
        duel_id = _gen_duel_id()
        db.execute(
            """
            INSERT INTO duels (id, creator_id, difficulty, questions_json)
            VALUES (?, ?, ?, ?)
            """,
            (duel_id, creator["telegram_id"], difficulty, json.dumps(selected)),
        )

    # Отдаём вопросы БЕЗ correct
    public_questions = [{"q": q["q"], "options": q["options"]} for q in selected]
    return {
        "duel_id": duel_id,
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

    questions = json.loads(duel["questions_json"])
    public_questions = [{"q": q["q"], "options": q["options"]} for q in questions]
    creator = db.execute(
        "SELECT * FROM users WHERE telegram_id = ?", (duel["creator_id"],)
    ).fetchone() if False else None
    with get_db() as db2:
        creator = db2.execute(
            "SELECT * FROM users WHERE telegram_id = ?", (duel["creator_id"],)
        ).fetchone()
    return {
        "duel_id": duel_id,
        "questions": public_questions,
        "time_limit_ms": DUEL_TIME_LIMIT_MS,
        "creator_name": _display_name(creator),
        "creator_score": duel["creator_score"],
    }


@app.post("/api/duel/{duel_id}/submit")
async def duel_submit(
    duel_id: str,
    init_data: str = Body(...),
    answers: list = Body(...),
):
    """Сдать ответы на 10 вопросов. Считаем очки, если оба сдали — финализируем."""
    tg_user = get_verified_user(init_data)
    with get_db() as db:
        me = upsert_user(db, tg_user)
        my_id = me["telegram_id"]
        duel = db.execute("SELECT * FROM duels WHERE id = ?", (duel_id,)).fetchone()
        if not duel:
            raise HTTPException(status_code=404, detail="Duel not found")
        if duel["status"] == "complete":
            raise HTTPException(status_code=400, detail="Duel already complete")

        questions = json.loads(duel["questions_json"])
        my_score = _score_answers(questions, answers)

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

        _try_finalize_duel(db, duel_id)
        duel = db.execute("SELECT * FROM duels WHERE id = ?", (duel_id,)).fetchone()
        return _duel_public_view(db, duel, my_id)


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
BUILD_TAG = "rules-detailed-v20"


@app.get("/api/version")
async def version():
    return {
        "build": BUILD_TAG,
        "commit": os.environ.get("RAILWAY_GIT_COMMIT_SHA", "dev")[:8],
    }


# ---------- Раздача статики фронтенда ----------
# Всё, что не /api/*, отдаём как статику
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

# Запрет кэширования: чтобы Telegram/браузер всегда брали свежие index.html/script.js/style.css
# после каждого деплоя, а не показывали старую версию из кэша.
_NO_CACHE = {
    "Cache-Control": "no-cache, no-store, must-revalidate",
    "Pragma": "no-cache",
    "Expires": "0",
}


@app.get("/")
async def root():
    return FileResponse(FRONTEND_DIR / "index.html", headers=_NO_CACHE)


@app.get("/{path:path}")
async def spa(path: str):
    file_path = FRONTEND_DIR / path
    if file_path.exists() and file_path.is_file():
        return FileResponse(file_path, headers=_NO_CACHE)
    return FileResponse(FRONTEND_DIR / "index.html", headers=_NO_CACHE)


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
