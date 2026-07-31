"""
Единая точка запуска для Railway/Render/локального запуска.
Запускает одновременно:
 - FastAPI веб-сервер (для мини-приложения)
 - Telegram-бота (для команды /start)
"""

import asyncio
import os

import uvicorn
from dotenv import load_dotenv

load_dotenv()


async def run_web():
    port = int(os.environ.get("PORT", 8000))
    config = uvicorn.Config(
        "main:app", host="0.0.0.0", port=port, log_level="info"
    )
    server = uvicorn.Server(config)
    await server.serve()


async def run_bot():
    # Импортируем здесь, чтобы load_dotenv успел отработать
    from bot import bot, dp
    print("Бот стартует...")
    await dp.start_polling(bot)


async def main():
    await asyncio.gather(run_web(), run_bot())


if __name__ == "__main__":
    asyncio.run(main())
