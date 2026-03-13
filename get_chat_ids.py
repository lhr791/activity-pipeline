"""
Helper: list all groups/channels you've joined and their chat IDs.

Usage:
    python3 get_chat_ids.py
"""

from telethon import TelegramClient
from telethon.tl.types import Channel, Chat
from utils import TG_API_ID, TG_API_HASH, TG_PHONE


async def main():
    client = TelegramClient("tg_session", TG_API_ID, TG_API_HASH)
    await client.start(phone=TG_PHONE)

    print(f"{'Chat ID':<20} {'Type':<12} {'Title'}")
    print("-" * 60)

    async for dialog in client.iter_dialogs():
        entity = dialog.entity
        if isinstance(entity, (Channel, Chat)):
            kind = "Channel" if isinstance(entity, Channel) else "Group"
            print(f"{dialog.id:<20} {kind:<12} {dialog.title}")

    await client.disconnect()


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
