"""
CLI tool to view crypto event summaries and pending message counts.

Usage:
    python3 view_summary.py --latest       # latest event aggregation
    python3 view_summary.py --pending      # pending message counts per channel
    python3 view_summary.py --all          # all summaries
"""

import argparse
import json

from utils import get_supabase

db = get_supabase()

CHANNEL_NAMES: dict[int, str] = {
    -1002000478651: "Coinscalper Channel",
    -1003061431387: "레드터틀 채널",
    -1003601907317: "Dalchuni Crypto Events",
    -1002770517188: "Global Loha",
    -1003500837149: "Redturtle Global",
    -1003389965115: "Exchange Event Summary",
}


def show_latest():
    """Display the most recent event aggregation."""
    result = (
        db.table("summaries")
        .select("*")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )

    if not result.data:
        print("No summaries found.")
        return

    print_summary(result.data[0])


def show_all():
    """Display all summaries."""
    result = (
        db.table("summaries")
        .select("*")
        .order("created_at", desc=True)
        .limit(20)
        .execute()
    )

    if not result.data:
        print("No summaries found.")
        return

    for row in result.data:
        print_summary(row)
        print()


def show_pending():
    """Display counts of un-summarized messages per channel."""
    result = (
        db.table("raw_messages")
        .select("chat_id, id")
        .eq("is_summarized", False)
        .execute()
    )

    if not result.data:
        print("No pending messages.")
        return

    counts: dict[int, int] = {}
    for r in result.data:
        cid = r["chat_id"]
        counts[cid] = counts.get(cid, 0) + 1

    print(f"{'Channel':<30} {'Pending'}")
    print("-" * 45)
    for cid, cnt in sorted(counts.items(), key=lambda x: -x[1]):
        name = CHANNEL_NAMES.get(cid, str(cid))
        print(f"{name:<30} {cnt}")
    print(f"\nTotal: {sum(counts.values())} messages across {len(counts)} channels")


def print_summary(row: dict):
    """Pretty-print a structured event summary."""
    print("=" * 70)
    print(f"Time Range: {row['time_range_start']} → {row['time_range_end']}")
    print(f"Messages:   {row['message_count']}")
    print(f"Created:    {row['created_at']}")

    topics = row.get("topics") or []
    if topics:
        print(f"Exchanges:  {', '.join(topics)}")

    print("-" * 70)

    try:
        data = json.loads(row["summary"])
    except (json.JSONDecodeError, TypeError):
        print(row["summary"])
        return

    events = data.get("events", [])
    summary_text = data.get("summary", "")

    if summary_text:
        print(f"\n📋 {summary_text}\n")

    for i, ev in enumerate(events, 1):
        new_tag = "🆕" if ev.get("is_new", True) else "📌"
        print(f"\n{new_tag} [{i}] {ev.get('exchange', '?')} — {ev.get('event_name', '?')}")
        print(f"   Type:     {ev.get('type', '?')}")
        if ev.get("start_date") or ev.get("end_date"):
            print(f"   Period:   {ev.get('start_date', '?')} ~ {ev.get('end_date', '?')}")
        if ev.get("reward"):
            print(f"   Reward:   {ev.get('reward')}")
        if ev.get("requirements"):
            print(f"   Require:  {ev.get('requirements')}")
        if ev.get("link"):
            print(f"   Link:     {ev.get('link')}")
        sources = ev.get("sources", [])
        if sources:
            print(f"   Sources:  {', '.join(sources)}")

    print(f"\n{'=' * 70}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="View Crypto Event Summaries")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--latest", action="store_true", help="Latest aggregation")
    group.add_argument("--pending", action="store_true", help="Pending message counts")
    group.add_argument("--all", action="store_true", help="All summaries")
    args = parser.parse_args()

    if args.latest:
        show_latest()
    elif args.pending:
        show_pending()
    elif args.all:
        show_all()
