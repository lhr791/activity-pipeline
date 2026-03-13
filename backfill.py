"""
Backfill historical messages from a TG chat into Supabase.

Usage:
    python3 backfill.py --chat-id -100123456789 --limit 500
"""

import argparse
import asyncio

from telethon import TelegramClient
from utils import TG_API_ID, TG_API_HASH, TG_PHONE, get_supabase, logger

db = get_supabase()


async def backfill(chat_id: int, limit: int):
    """Pull historical messages and insert into raw_messages."""
    client = TelegramClient("tg_session", TG_API_ID, TG_API_HASH)
    await client.start(phone=TG_PHONE)

    logger.info("Fetching up to %d messages from chat %s...", limit, chat_id)

    count = 0
    batch: list[dict] = []

    async for msg in client.iter_messages(chat_id, limit=limit):
        if not msg.text:
            continue

        sender = await msg.get_sender()
        sender_name = ""
        if sender:
            sender_name = getattr(sender, "first_name", "") or ""
            last = getattr(sender, "last_name", "") or ""
            if last:
                sender_name = f"{sender_name} {last}"

        batch.append(
            {
                "chat_id": chat_id,
                "message_id": msg.id,
                "sender_id": sender.id if sender else 0,
                "sender_name": sender_name,
                "text": msg.text,
                "sent_at": msg.date.isoformat(),
                "is_summarized": False,
            }
        )
        count += 1

        # Insert in batches of 100
        if len(batch) >= 100:
            db.table("raw_messages").upsert(
                batch, on_conflict="chat_id,message_id"
            ).execute()
            logger.info("Inserted %d messages so far...", count)
            batch = []

    # Final batch
    if batch:
        db.table("raw_messages").upsert(
            batch, on_conflict="chat_id,message_id"
        ).execute()

    logger.info("Done — backfilled %d text messages.", count)
    await client.disconnect()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill TG Messages")
    parser.add_argument(
        "--chat-id", type=int, required=True, help="Target chat ID"
    )
    parser.add_argument(
        "--limit", type=int, default=500, help="Max messages to fetch (default 500)"
    )
    args = parser.parse_args()

    asyncio.run(backfill(args.chat_id, args.limit))
