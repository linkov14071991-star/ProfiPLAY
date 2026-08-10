"""
Профик Arena - Telegram-бот
Роль:
1. По команде /start — открывает мини-приложение.
2. По /start duel_XXX — показывает кнопку 'Принять вызов' на конкретную дуэль.
"""

import asyncio
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

load_dotenv()

import time

BOT_TOKEN = os.environ["BOT_TOKEN"]
WEBAPP_URL = os.environ["WEBAPP_URL"]
CHANNEL_USERNAME = os.environ.get("CHANNEL_USERNAME", "@profimatika_inf")

# Картинки для сообщений бота
_IMG_DIR = Path(__file__).resolve().parent.parent / "frontend"
HERO_IMG = _IMG_DIR / "profik-hero.png"   # приветствие /start
DUEL_IMG = _IMG_DIR / "profik-duel.png"   # приглашение на дуэль

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


@dp.message(CommandStart())
async def start(message: Message, command: CommandObject):
    payload = command.args or ""

    # Deep-link на конкретную дуэль
    if payload.startswith("duel_"):
        duel_id = payload[5:]
        url = f"{WEBAPP_URL}?duel={duel_id}"
        kb = _kb_open_app(url, "⚔ Принять вызов!")
        caption = (
            f"⚔ <b>Тебя вызвали на Блиц-дуэль!</b>\n\n"
            f"Докажи, что ты лучший — набери больше очков, чем соперник. "
            f"Победа: <b>+15</b> к рейтингу, поражение: −15.\n\n"
            f"⚠️ Для участия нужна подписка на канал {CHANNEL_USERNAME}."
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
        f"Привет, {message.from_user.first_name}! 👋\n\n"
        f"Это <b>Профик Arena</b> — играй, учись, побеждай.\n\n"
        f"⚠️ Для игры нужна подписка на канал {CHANNEL_USERNAME}."
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
