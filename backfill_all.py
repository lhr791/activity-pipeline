"""
TG 频道消息拉取（默认增量，支持全量）

增量模式（默认）：每个频道从 DB 中最新消息时间开始拉取
全量模式（--full）：从 DEFAULT_SINCE 开始全部重新拉取

Usage:
    python3 backfill_all.py              # 增量拉取（只拉新消息）
    python3 backfill_all.py --full       # 全量拉取（从 2026-01-01 开始）
    python3 backfill_all.py --since 2026-02-01  # 从指定日期拉取
"""
import argparse
import asyncio
from datetime import datetime, timezone, timedelta
from telethon import TelegramClient
from utils import TG_API_ID, TG_API_HASH, TG_PHONE, TARGET_CHAT_IDS, get_supabase, logger

db = get_supabase()

# 全量拉取的默认起始日期
DEFAULT_SINCE = "2026-01-01"

# 交易所名列表，用于检测汇总帖
EXCHANGE_NAMES = {
    "ourbit", "zoomex", "woox", "fameex", "bydfi", "btcc", "voox",
    "weex", "lbank", "tapbit", "ascendex", "bitmart", "orangex",
    "toobit", "deepcoin", "picol", "phemex", "hotcoin",
    "bitrue", "kucoin", "bybit", "bitget",
}


def _is_roundup(text: str) -> bool:
    """消息提到 3 个以上交易所 → 汇总帖，跳过。"""
    t = text.lower()
    return sum(1 for ex in EXCHANGE_NAMES if ex in t) >= 3


def _get_latest_message_time(chat_id: int) -> datetime | None:
    """查询该频道在 DB 中的最新消息时间。"""
    res = (
        db.table("raw_messages")
        .select("sent_at")
        .eq("chat_id", chat_id)
        .order("sent_at", desc=True)
        .limit(1)
        .execute()
    )
    if res.data:
        ts = res.data[0]["sent_at"]
        return datetime.fromisoformat(ts).replace(tzinfo=timezone.utc)
    return None


async def backfill_all(since: str | None = None, full: bool = False):
    """拉取各频道消息。

    Args:
        since: 指定起始日期（YYYY-MM-DD）。如果为 None 且非全量模式，则自动增量。
        full: 全量模式，从 DEFAULT_SINCE 开始。
    """
    client = TelegramClient("tg_session", TG_API_ID, TG_API_HASH)
    await client.start(phone=TG_PHONE)

    total_new = 0

    for chat_id in TARGET_CHAT_IDS:
        # 确定起始时间
        if full or since:
            since_str = since or DEFAULT_SINCE
            since_dt = datetime.strptime(since_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            mode = "全量"
        else:
            # 增量：从 DB 最新消息时间开始（留 1 小时重叠避免遗漏）
            latest = _get_latest_message_time(chat_id)
            if latest:
                since_dt = latest - timedelta(hours=1)
                mode = "增量"
            else:
                # 该频道无数据，首次全量拉取
                since_dt = datetime.strptime(DEFAULT_SINCE, "%Y-%m-%d").replace(tzinfo=timezone.utc)
                mode = "首次全量"

        logger.info(
            "Chat %s [%s]: 从 %s 开始拉取...",
            chat_id, mode, since_dt.strftime("%Y-%m-%d %H:%M")
        )

        batch = []
        count = 0
        skipped = 0
        try:
            async for msg in client.iter_messages(chat_id, offset_date=None, reverse=False):
                if msg.date < since_dt:
                    break
                if not msg.text:
                    continue
                # 跳过汇总帖（包含 3+ 交易所名）
                if _is_roundup(msg.text):
                    skipped += 1
                    continue
                sender = await msg.get_sender()
                sender_name = ""
                if sender:
                    sender_name = getattr(sender, "first_name", "") or ""
                    last = getattr(sender, "last_name", "") or ""
                    if last:
                        sender_name = f"{sender_name} {last}"
                batch.append({
                    "chat_id": chat_id,
                    "message_id": msg.id,
                    "sender_id": sender.id if sender else 0,
                    "sender_name": sender_name,
                    "text": msg.text,
                    "sent_at": msg.date.isoformat(),
                    "is_summarized": False,
                })
                count += 1
                if len(batch) >= 100:
                    db.table("raw_messages").upsert(batch, on_conflict="chat_id,message_id").execute()
                    batch = []
            if batch:
                db.table("raw_messages").upsert(batch, on_conflict="chat_id,message_id").execute()
            logger.info("Chat %s: %d new, %d roundups skipped", chat_id, count, skipped)
            total_new += count
        except Exception as e:
            logger.error("Chat %s failed: %s", chat_id, e)

    await client.disconnect()
    logger.info("All channels done. Total new messages: %d", total_new)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="TG 频道消息拉取")
    parser.add_argument("--full", action="store_true",
                        help="全量拉取（从 2026-01-01 开始）")
    parser.add_argument("--since",
                        help="从指定日期拉取（YYYY-MM-DD）")
    args = parser.parse_args()
    asyncio.run(backfill_all(since=args.since, full=args.full))
