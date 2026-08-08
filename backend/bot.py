"""
Профик Арена - Telegram-бот
Роль:
1. По команде /start — открывает мини-приложение.
2. По /start duel_XXX — показывает кнопку 'Принять вызов' на конкретную дуэль.
"""

import asyncio
import os

from aiogram import Bot, Dispatcher
from aiogram.filters import CommandObject, CommandStart
from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    MenuButtonWebApp,
    Message,
    WebAppInfo,
)
from dotenv import load_dotenv

load_dotenv()

import time

BOT_TOKEN = os.environ["BOT_TOKEN"]
WEBAPP_URL = os.environ["WEBAPP_URL"]
CHANNEL_USERNAME = os.environ.get("CHANNEL_USERNAME", "@profimatika_inf")

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


def _kb_open_app(url: str, label: str = "🎮 Играть в Профик Арена") -> InlineKeyboardMarkup:
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


@dp.message(CommandStart())
async def start(message: Message, command: CommandObject):
    payload = command.args or ""

    # Deep-link на конкретную дуэль
    if payload.startswith("duel_"):
        duel_id = payload[5:]
        url = f"{WEBAPP_URL}?duel={duel_id}"
        kb = _kb_open_app(url, "⚔ Принять вызов!")
        await message.answer(
            f"⚔ <b>Тебя вызвали на Блиц-дуэль!</b>\n\n"
            f"Прими вызов и попробуй набрать больше очков, чем соперник. "
            f"Победа поднимает твой рейтинг, поражение — снижает.\n\n"
            f"⚠️ Для участия нужна подписка на канал {CHANNEL_USERNAME}.",
            reply_markup=kb,
            parse_mode="HTML",
        )
        return

    # Обычный /start
    kb = _kb_open_app(WEBAPP_URL)
    await message.answer(
        f"Привет, {message.from_user.first_name}! 👋\n\n"
        f"Это <b>Профик Арена</b> — играй, учись, побеждай.\n\n"
        f"⚠️ Для игры нужна подписка на канал {CHANNEL_USERNAME}.",
        reply_markup=kb,
        parse_mode="HTML",
    )


@dp.startup()
async def _on_startup():
    """При каждом запуске бота (то есть на каждый деплой) прописываем постоянную
    кнопку-меню со свежей версией — чтобы Telegram не открывал старый кэш."""
    try:
        await bot.set_chat_menu_button(
            menu_button=MenuButtonWebApp(text="🎮 Играть", web_app=WebAppInfo(url=_bust(WEBAPP_URL)))
        )
        print(f"Кнопка-меню обновлена (v={APP_VER})")
    except Exception as e:
        print("Не удалось обновить кнопку-меню:", e)


async def main():
    print("Бот запущен. Ctrl+C для остановки.")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
