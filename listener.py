"""
Telethon Userbot listener — monitors target TG channels for crypto exchange events
and saves messages to Supabase.

Usage:
    python3 listener.py
"""

from telethon import TelegramClient, events
from utils import (
    TG_API_ID,
    TG_API_HASH,
    TG_PHONE,
    TARGET_CHAT_IDS,
    get_supabase,
    logger,
)

CHANNEL_NAMES: dict[int, str] = {
    -1002000478651: "Coinscalper",
    -1003061431387: "레드터틀",
    -1003601907317: "Dalchuni",
    -1002770517188: "Global Loha",
    -1003500837149: "Redturtle Global",
    -1003389965115: "Exchange Summary",
}

client = TelegramClient("tg_session", TG_API_ID, TG_API_HASH)
db = get_supabase()


@client.on(events.NewMessage(chats=TARGET_CHAT_IDS or None))
async def on_new_message(event):
    """Handle incoming messages from target channels."""
    msg = event.message

    # Skip empty / media-only messages
    if not msg.text:
        return

    # For channels, sender is usually the channel itself
    sender = await event.get_sender()
    sender_name = ""
    if sender:
        sender_name = getattr(sender, "title", "") or getattr(sender, "first_name", "") or ""

    channel_name = CHANNEL_NAMES.get(event.chat_id, str(event.chat_id))

    row = {
        "chat_id": event.chat_id,
        "message_id": msg.id,
        "sender_id": sender.id if sender else 0,
        "sender_name": sender_name,
        "text": msg.text,
        "sent_at": msg.date.isoformat(),
        "is_summarized": False,
    }

    try:
        db.table("raw_messages").insert(row).execute()
        logger.info("📥 [%s] msg #%s saved", channel_name, msg.id)
    except Exception as exc:
        # Duplicate message_id — skip silently
        if "duplicate" in str(exc).lower() or "unique" in str(exc).lower():
            return
        logger.error("Failed to save message: %s", exc)


async def main():
    """Start the listener."""
    await client.start(phone=TG_PHONE)
    me = await client.get_me()
    logger.info("Logged in as %s (id=%s)", me.first_name, me.id)

    if TARGET_CHAT_IDS:
        names = [CHANNEL_NAMES.get(cid, str(cid)) for cid in TARGET_CHAT_IDS]
        logger.info("Monitoring %d channels: %s", len(names), ", ".join(names))
    else:
        logger.info("No TARGET_CHAT_IDS — monitoring ALL chats")

    logger.info("Listener started. Press Ctrl+C to stop.")
    await client.run_until_disconnected()


if __name__ == "__main__":
    import asyncio

    asyncio.run(main())
