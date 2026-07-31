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
from pathlib import Path
from urllib.parse import parse_qsl

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

# ---------- Настройки ----------
BOT_TOKEN = os.environ.get("BOT_TOKEN", "")
CHANNEL_USERNAME = os.environ.get("CHANNEL_USERNAME", "@profimatika_inf")

BASE_DIR = Path(__file__).parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"
WORDS_FILE = BASE_DIR / "words.json"
QUESTIONS_FILE = BASE_DIR / "questions.json"

with open(WORDS_FILE, "r", encoding="utf-8") as f:
    WORDS = json.load(f)

with open(QUESTIONS_FILE, "r", encoding="utf-8") as f:
    QUESTIONS = json.load(f)

# ---------- Приложение ----------
app = FastAPI(title="ProfiPlay API")

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
async def get_words(difficulty: str = Query("easy")):
    """Возвращает перемешанный список слов заданной сложности (для Крокодила)."""
    if difficulty not in ("easy", "medium", "hard"):
        raise HTTPException(status_code=400, detail="Bad difficulty")
    words = WORDS["informatika"][difficulty].copy()
    random.shuffle(words)
    return {"words": words}


@app.get("/api/questions")
async def get_questions(difficulty: str = Query("easy"), limit: int = Query(50)):
    """Возвращает перемешанный список вопросов (для Спринта / Марафона)."""
    if difficulty not in ("easy", "medium", "hard"):
        raise HTTPException(status_code=400, detail="Bad difficulty")
    questions = QUESTIONS["informatika"][difficulty].copy()
    random.shuffle(questions)
    return {"questions": questions[:limit]}


# ---------- Раздача статики фронтенда ----------
# Всё, что не /api/*, отдаём как статику
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")


@app.get("/")
async def root():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/{path:path}")
async def spa(path: str):
    file_path = FRONTEND_DIR / path
    if file_path.exists() and file_path.is_file():
        return FileResponse(file_path)
    return FileResponse(FRONTEND_DIR / "index.html")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
