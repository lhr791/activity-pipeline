"""
Scheduled runner for the summarizer.

Usage:
    python3 run_summarizer.py          # start daily scheduler
    python3 run_summarizer.py --once   # run once and exit
"""

import argparse

from apscheduler.schedulers.blocking import BlockingScheduler

from summarizer import run_once
from utils import SUMMARIZE_HOUR, logger


def main():
    parser = argparse.ArgumentParser(description="Scheduled TG Summarizer")
    parser.add_argument(
        "--once", action="store_true", help="Run once and exit"
    )
    args = parser.parse_args()

    if args.once:
        run_once()
        return

    scheduler = BlockingScheduler()
    scheduler.add_job(
        run_once,
        "cron",
        hour=SUMMARIZE_HOUR,
        minute=0,
        id="daily_summarize",
    )

    logger.info("Scheduler started — will run daily at %02d:00", SUMMARIZE_HOUR)
    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        logger.info("Scheduler stopped.")


if __name__ == "__main__":
    main()
