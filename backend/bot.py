"""
Профик Arena - Telegram-бот
Роль:
1. По команде /start — открывает мини-приложение.
2. По /start duel_XXX — показывает кнопку 'Принять вызов' на конкретную дуэль.
"""

import asyncio
import datetime
import os
from pathlib import Path

from aiogram import Bot, Dispatcher
from aiogram.filters import CommandObject, CommandStart
from aiogram.types import (
    FSInputFile,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    MenuButtonWebApp,
    Message,
    WebAppInfo,
)
from dotenv import load_dotenv

from db import get_db

load_dotenv()

import time

BOT_TOKEN = os.environ["BOT_TOKEN"]
WEBAPP_URL = os.environ["WEBAPP_URL"]
CHANNEL_USERNAME = os.environ.get("CHANNEL_USERNAME", "@profimatika_inf")

# Картинки для сообщений бота
_IMG_DIR = Path(__file__).resolve().parent.parent / "frontend"
HERO_IMG = _IMG_DIR / "profik-hero.png"   # приветствие /start
DUEL_IMG = _IMG_DIR / "profik-duel.png"   # приглашение на дуэль

# Админы — им бот раз в неделю напоминает создать «Вызов недели»
ADMIN_IDS = {int(x) for x in os.environ.get("ADMIN_IDS", "1388800589").replace(" ", "").split(",") if x}
# Username бота (для startapp-ссылок). Заполняется на старте через getMe.
BOT_ME_USERNAME = os.environ.get("BOT_USERNAME", "")

# Версия сборки для сброса кэша мини-аппа. Меняется на каждый деплой (Railway
# отдаёт RAILWAY_GIT_COMMIT_SHA), поэтому Telegram открывает свежую версию, а не
# закэшированную. Fallback — время запуска.
APP_VER = (os.environ.get("RAILWAY_GIT_COMMIT_SHA") or str(int(time.time())))[:8]


def _bust(url: str) -> str:
    """Добавляет ?v=<версия> к адресу — Telegram считает его новым и грузит заново."""
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}v={APP_VER}"


bot = Bot(token=BOT_TOKEN)
dp = Dispatcher()


def _kb_open_app(url: str, label: str = "🎮 Играть в Профик Arena") -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text=label, web_app=WebAppInfo(url=_bust(url)))],
            [
                InlineKeyboardButton(
                    text="📢 Подписаться на канал",
                    url=f"https://t.me/{CHANNEL_USERNAME.lstrip('@')}",
                )
            ],
        ]
    )


def _kb_accept_duel(duel_id: str) -> InlineKeyboardMarkup:
    """Кнопка приёма дуэли — web-app с id дуэли в адресе (?duel=...)."""
    return _kb_open_app(f"{WEBAPP_URL}?duel={duel_id}", "⚔ Принять вызов!")


@dp.message(CommandStart())
async def start(message: Message, command: CommandObject):
    payload = command.args or ""

    # Deep-link на конкретную дуэль
    if payload.startswith("duel_"):
        duel_id = payload[5:]
        # Запоминаем приглашение на сервере — приложение откроет приём даже если
        # клиент не донесёт параметр в URL.
        try:
            with get_db() as db:
                db.execute(
                    "INSERT OR REPLACE INTO pending_duel (user_id, duel_id, created_at) VALUES (?, ?, datetime('now'))",
                    (message.from_user.id, duel_id),
                )
        except Exception as e:
            print("pending_duel write err:", e)
        kb = _kb_accept_duel(duel_id)
        caption = (
            f"⚔ <b>Тебя вызвали на Блиц-дуэль!</b>\n\n"
            f"Докажи, что ты лучший — набери больше очков, чем соперник. "
            f"Победа: <b>+20</b> к рейтингу, поражение: −20.\n\n"
            f"⚠️ Для участия нужна подписка на канал {CHANNEL_USERNAME}.\n\n"
            f"👇 Жми кнопку <b>«⚔ Принять вызов!»</b> под этим сообщением."
        )
        try:
            await message.answer_photo(
                photo=FSInputFile(str(DUEL_IMG)),
                caption=caption,
                reply_markup=kb,
                parse_mode="HTML",
            )
        except Exception as e:
            print("Не удалось отправить картинку дуэли:", e)
            await message.answer(caption, reply_markup=kb, parse_mode="HTML")
        return

    # Обычный /start — приветствие с картинкой Профика
    kb = _kb_open_app(WEBAPP_URL)
    caption = (
        f"{message.from_user.first_name}, добро пожаловать! 👋\n\n"
        f"Жми <b>«Играть»</b> — тренируйся, вызывай друзей на дуэли и поднимайся в топ рейтинга.\n\n"
        f"⚠️ Нужна подписка на канал {CHANNEL_USERNAME}."
    )
    try:
        await message.answer_photo(
            photo=FSInputFile(str(HERO_IMG)),
            caption=caption,
            reply_markup=kb,
            parse_mode="HTML",
        )
    except Exception as e:
        print("Не удалось отправить картинку приветствия:", e)
        await message.answer(caption, reply_markup=kb, parse_mode="HTML")


async def _weekly_reminder_loop():
    """Раз в неделю (Пн 10:00 МСК) напоминает админам создать «Вызов недели»."""
    while True:
        now = datetime.datetime.utcnow() + datetime.timedelta(hours=3)  # МСК
        days_ahead = (0 - now.weekday()) % 7  # понедельник = 0
        target = (now + datetime.timedelta(days=days_ahead)).replace(
            hour=10, minute=0, second=0, microsecond=0)
        if target <= now:
            target += datetime.timedelta(days=7)
        await asyncio.sleep(max(60, (target - now).total_seconds()))
        for uid in ADMIN_IDS:
            try:
                await bot.send_message(
                    uid,
                    "🗓 Пора запустить <b>Вызов недели</b>!\n\n"
                    "Зайди в приложение → <b>Соревнования</b> → «Создать вызов недели», "
                    "сыграй партию — и вызов улетит всем ученикам.",
                    reply_markup=_kb_open_app(WEBAPP_URL, "🎮 Открыть приложение"),
                    parse_mode="HTML",
                )
            except Exception as e:
                print("Напоминание не отправлено:", e)


@dp.startup()
async def _on_startup():
    """При каждом запуске бота (то есть на каждый деплой) прописываем постоянную
    кнопку-меню со свежей версией — чтобы Telegram не открывал старый кэш."""
    global BOT_ME_USERNAME
    try:
        me = await bot.get_me()
        if me and me.username:
            BOT_ME_USERNAME = me.username
            print(f"Username бота: @{BOT_ME_USERNAME}")
    except Exception as e:
        print("Не удалось получить username бота:", e)
    try:
        await bot.set_chat_menu_button(
            menu_button=MenuButtonWebApp(text="🎮 Играть", web_app=WebAppInfo(url=_bust(WEBAPP_URL)))
        )
        print(f"Кнопка-меню обновлена (v={APP_VER})")
    except Exception as e:
        print("Не удалось обновить кнопку-меню:", e)
    asyncio.create_task(_weekly_reminder_loop())


async def main():
    print("Бот запущен. Ctrl+C для остановки.")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
