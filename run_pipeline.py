"""
活动整理 Pipeline（标准 6 步流程）

步骤:
  1. 拉取 TG 新消息 → raw_messages 表
  2. 导出原始记录 → output/TG原始记录_*.docx
  3. AI 整合 → 去重、分类、打标签 → summaries 表
  4. 人工审核 → reviewer.py（必做）
  5. 生成 Word 报告 → output/竞品所活动_*.docx
  6. Web 前端展示 → cd web && npm run dev

Usage:
    python3 run_pipeline.py              # 步骤 1-3（拉取+导出+整合，不生成Word）
    python3 run_pipeline.py --with-word   # 步骤 1-3 + 自动生成 Word
    python3 run_pipeline.py --word-only   # 仅生成 Word（步骤5）
    python3 run_pipeline.py --no-backfill # 跳过拉取，只做整合
"""

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime

from utils import logger


def step_backfill(full: bool = False):
    """Step 1: 从 TG 拉取各频道最新消息到 Supabase。"""
    logger.info("=" * 50)
    mode = "全量" if full else "增量"
    logger.info("Step 1: Backfill TG 消息（%s）...", mode)
    logger.info("=" * 50)
    from backfill_all import backfill_all
    asyncio.run(backfill_all(full=full))


def step_export_raw() -> str | None:
    """Step 2: 导出原始聊天记录为 Word 文档。"""
    logger.info("=" * 50)
    logger.info("Step 2: 导出原始聊天记录...")
    logger.info("=" * 50)
    from export_messages import export
    raw_path = export()
    if raw_path and os.path.exists(raw_path):
        logger.info("原始聊天记录: %s", raw_path)
        return raw_path
    return None


def step_summarize():
    """Step 3: 用 DeepSeek AI 整合消息。"""
    logger.info("=" * 50)
    logger.info("Step 3: AI 整合活动信息...")
    logger.info("=" * 50)
    from summarizer import run_once
    run_once()


def step_generate_word() -> str | None:
    """Step 4: 生成活动报告 Word 文档。"""
    logger.info("=" * 50)
    logger.info("Step 4: 生成活动报告 Word 文档...")
    logger.info("=" * 50)
    from generate_word import load_events_from_supabase, generate_word

    data = load_events_from_supabase()
    active = data.get("active_events", [])
    expired = data.get("expired_events", [])
    pairs = data.get("version_pairs", [])

    if not active and not expired:
        logger.warning("没有活动数据可生成 Word 文档")
        return None

    logger.info(
        "读取到 %d 个当期 + %d 个过期活动, %d 组版本变更",
        len(active), len(expired), len(pairs),
    )

    output_dir = os.path.join(os.path.dirname(__file__), "output")
    os.makedirs(output_dir, exist_ok=True)
    now = datetime.now()
    date_str = now.strftime("%Y%m%d_%H%M")
    month_str = f"{now.year}.{now.month}月"
    output_path = os.path.join(output_dir, f"{month_str} 竞品所活动_{date_str}.docx")

    generate_word(active, output_path, expired_events=expired, version_pairs=pairs)
    return output_path


def main():
    parser = argparse.ArgumentParser(description="活动整理 Pipeline")
    parser.add_argument("--word-only", action="store_true",
                        help="仅生成 Word 报告（步骤5）")
    parser.add_argument("--with-word", action="store_true",
                        help="步骤 1-3 后自动生成 Word（跳过人工审核）")
    parser.add_argument("--no-backfill", action="store_true",
                        help="跳过 TG 拉取，只做整合")
    parser.add_argument("--full-backfill", action="store_true",
                        help="全量拉取 TG（从 2026-01-01 开始）")
    args = parser.parse_args()

    outputs = []

    if not args.word_only:
        if not args.no_backfill:
            step_backfill(full=args.full_backfill)
        raw_path = step_export_raw()
        if raw_path:
            outputs.append(("[RAW] 原始聊天记录", raw_path))
        step_summarize()

    # Word 生成：默认不自动跑（需人工审核后手动生成）
    if args.word_only or args.with_word:
        word_path = step_generate_word()
        if word_path:
            outputs.append(("[RPT] 活动报告", word_path))

    logger.info("=" * 50)
    if outputs:
        logger.info("Pipeline 完成! 输出文件:")
        for label, path in outputs:
            logger.info("  %s: %s", label, path)
    else:
        logger.info("Pipeline 完成（步骤1-3）")
    logger.info("=" * 50)

    if not args.word_only and not args.with_word:
        total = sum(1 for _ in outputs)
        logger.info("")
        logger.info("下一步: python3 reviewer.py     # 人工审核")
        logger.info("然后:   python3 run_pipeline.py --word-only  # 生成 Word")


if __name__ == "__main__":
    main()
