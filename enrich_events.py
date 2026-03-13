"""
活动页面抓取 → AI 二次优化活动描述
从 TG 原文和 event.link 中提取活动详情页 URL，抓取页面内容，
用 DeepSeek 优化赠金规则等描述字段。

Usage:
    python3 enrich_events.py          # 优化最新 summary 中的所有有链接的活动
    python3 enrich_events.py --dry    # 只抓取页面，不调用 AI（调试用）
"""

import argparse
import json
import os
import re
import time
import logging
from datetime import datetime
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

from utils import get_supabase, get_openai, logger

db = get_supabase()
ai = get_openai()

# ── 配置 ──────────────────────────────────────────────────────────────────

# 注册/邀请类链接，跳过不抓
SKIP_PATH_PATTERNS = [
    "/register", "/signup", "/invite", "/referral",
    "/login", "/download", "/ref/", "/partner",
]

# 只抓这些域名的活动页（白名单，避免误抓无关网站）
ALLOWED_DOMAINS = {
    "www.bitrue.com", "www.bitmart.com", "www.ourbit.com",
    "www.picol.com", "phemex.com", "www.lbank.com", "lbank.com",
    "www.wooxpro.com", "www.toobit.com", "www.xt.com",
    "www.tapbit.com", "www.weex.com", "www.hotcoin.com",
    "m.hotcoin.com", "s.deepcoin.com", "www.deepcoin.com",
    "www.fameex.com", "www.voox.com", "activity.voox.com",
    "www.bydfi.com", "www.kucoin.com", "www.orangex.com",
    "www.btcc.com", "www.zoomex.com", "www.bitunix.com",
    "ktx.finance", "www.ascendex.com",
    "blockfin.com",
}

REQUEST_TIMEOUT = 15  # 秒
MAX_PAGES_PER_EVENT = 2  # 每个活动最多抓 2 个页面
MAX_CONTENT_LENGTH = 5000  # 每页最多保留字符数

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8",
}


# ── URL 提取 & 过滤 ──────────────────────────────────────────────────────

def extract_activity_urls_from_text(text: str) -> list[str]:
    """从 TG 消息原文中提取活动详情页 URL（排除 TG 链接和注册链接）。"""
    # 匹配 http(s):// 和裸域名 www.xxx.com/...
    urls = re.findall(r'(?:https?://|www\.)[^\s\)\]\*\*]+', text)
    result = []
    for url in urls:
        url = url.rstrip("*.,;:!?）】」")
        # 补全缺 scheme 的 URL
        if not url.startswith("http"):
            url = "https://" + url
        if "t.me/" in url or "telegram" in url:
            continue
        if any(p in url.lower() for p in SKIP_PATH_PATTERNS):
            continue
        try:
            domain = urlparse(url).hostname
            if domain and domain in ALLOWED_DOMAINS:
                result.append(url)
        except Exception:
            continue
    return list(dict.fromkeys(result))  # 去重保序


def should_skip_url(url: str) -> bool:
    """检查是否应跳过该 URL。"""
    lower = url.lower()
    return any(p in lower for p in SKIP_PATH_PATTERNS)


# ── 页面抓取 ──────────────────────────────────────────────────────────────

def fetch_page_http(url: str) -> str | None:
    """HTTP 抓取页面，提取正文。"""
    try:
        # verify=False: 部分交易所（如 LBank）SSL 证书有问题
        resp = requests.get(
            url, headers=HEADERS, timeout=REQUEST_TIMEOUT,
            allow_redirects=True, verify=False,
        )
        if resp.status_code != 200:
            logger.warning("HTTP %d for %s", resp.status_code, url)
            return None

        soup = BeautifulSoup(resp.text, "html.parser")

        # 移除无用元素
        for tag in soup.find_all(["script", "style", "nav", "footer", "header", "noscript"]):
            tag.decompose()

        text = soup.get_text(separator="\n", strip=True)

        # 如果正文太短（< 200 字符），可能是 SPA 空壳
        if len(text) < 200:
            logger.info("Content too short (%d chars) for %s — likely SPA", len(text), url)
            return None

        # 截断过长内容
        if len(text) > MAX_CONTENT_LENGTH:
            text = text[:MAX_CONTENT_LENGTH] + "\n...(truncated)"

        return text

    except requests.RequestException as e:
        logger.warning("Failed to fetch %s: %s", url, e)
        return None


def fetch_page_playwright(url: str) -> str | None:
    """Playwright 无头浏览器抓取 SPA 页面。"""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        logger.warning("Playwright not installed, skipping SPA fetch for %s", url)
        return None

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)
            ctx = browser.new_context(
                user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                locale="en-US",
                viewport={"width": 1280, "height": 720},
            )
            page = ctx.new_page()

            # 先用 domcontentloaded（快，不等后台请求）
            page.goto(url, wait_until="domcontentloaded", timeout=15000)
            page.wait_for_timeout(3000)

            # 提取正文
            text = page.evaluate("""() => {
                ['nav', 'footer', 'header', 'script', 'style', 'noscript'].forEach(tag => {
                    document.querySelectorAll(tag).forEach(el => el.remove());
                });
                return document.body ? document.body.innerText : '';
            }""")

            browser.close()

            if not text or len(text.strip()) < 200:
                logger.info("Playwright content too short (%d chars) for %s",
                           len(text.strip()) if text else 0, url)
                return None

            text = text.strip()
            if len(text) > MAX_CONTENT_LENGTH:
                text = text[:MAX_CONTENT_LENGTH] + "\n...(truncated)"

            return text

    except Exception as e:
        logger.warning("Playwright failed for %s: %s", url, e)
        return None


def fetch_page(url: str) -> str | None:
    """分层抓取：HTTP 优先，SPA 用 Playwright 备用。"""
    text = fetch_page_http(url)
    if text:
        return text

    # HTTP 失败 → Playwright 备用（SPA 页面）
    logger.info("  → Trying Playwright for %s", url)
    text = fetch_page_playwright(url)
    return text


# ── 获取活动链接 ──────────────────────────────────────────────────────────

def collect_urls_for_event(event: dict, raw_msg_map: dict) -> list[str]:
    """
    收集一个活动的所有可抓取 URL。
    来源：1) event.link  2) TG 原文中的 URL（通过 source_links 反查）
    绝不手拼 URL。
    """
    urls = []

    # 1. event 自带的 link
    link = (event.get("link") or "").strip()
    if link and not should_skip_url(link):
        urls.append(link)

    # 2. 从 TG 原文中提取
    source_links = event.get("source_links") or []
    for tg_link in source_links:
        match = re.search(r"/c/(\d+)/(\d+)", tg_link)
        if not match:
            continue
        chat_id = -int("100" + match.group(1))
        message_id = int(match.group(2))
        key = f"{chat_id}:{message_id}"
        raw_text = raw_msg_map.get(key, "")
        if raw_text:
            page_urls = extract_activity_urls_from_text(raw_text)
            urls.extend(page_urls)

    # 去重保序，最多取 MAX_PAGES_PER_EVENT 个
    seen = set()
    unique = []
    for u in urls:
        # 去掉 referral code 做去重（同一页面不同 KOL 的链接）
        base = re.sub(r'[?&](referralCode|ru|ref|icode|vipCode|channelCode|qrType|p)=[^&]*', '', u)
        if base not in seen:
            seen.add(base)
            unique.append(u)
    return unique[:MAX_PAGES_PER_EVENT]


# ── 加载 raw_messages ──────────────────────────────────────────────────────

def load_raw_messages() -> dict[str, str]:
    """从 Supabase 加载全部消息，返回 {chat_id:message_id → text} 映射。"""
    result = (
        db.table("raw_messages")
        .select("chat_id, message_id, text")
        .order("id", desc=False)
        .limit(5000)
        .execute()
    )
    return {f"{m['chat_id']}:{m['message_id']}": m["text"] for m in result.data}


# ── AI 优化 Prompt ────────────────────────────────────────────────────────

ENRICH_PROMPT = """你是加密货币交易所活动数据提取专家。

我给你活动的现有数据和活动页面原文。请从页面中校准/补全以下数值。

## 提取目标
1. **reward** — 用 `{{d:入金}}` `{{v:交易量}}` `{{b:赠金}}` 标注的档位表，精确数字
2. **min_deposit** — 最低入金门槛（数字，单位 USDT）
3. **max_reward** — 最高可获赠金（数字）
4. **target_volume** — 最高档所需交易量（数字）
5. **loss_offset** — 赠金可抵扣亏损百分比（0-100 整数）
6. **bonus_validity_days** — 赠金有效天数（整数）
7. **commission_rate** — 手续费率（如 Maker 0.02% / Taker 0.06%，写成字符串）

## 规则
- 只输出和现有数据不同的字段，相同的不要输出
- reward 保留 `{{d:}}` `{{v:}}` `{{b:}}` 标注格式
- 纯数值字段用数字，不要字符串
- 如果页面没有对应信息，不要猜
- 如果所有数据都一致，返回 "NO_CHANGE"

## 输出（严格 JSON，只含有变化的字段）
{
  "reward": "...",
  "min_deposit": 1000,
  "max_reward": 4000,
  "target_volume": 32000000,
  "loss_offset": 20,
  "bonus_validity_days": 7,
  "commission_rate": "Maker 0.02% / Taker 0.06%",
  "changes_summary": "简要说明"
}
"""


def call_enrich_ai(event: dict, page_contents: list[dict]) -> dict | None:
    """调用 DeepSeek 优化活动描述。"""
    # 构建用户消息
    event_info = json.dumps({
        "exchange": event.get("exchange"),
        "event_name": event.get("event_name"),
        "reward": event.get("reward"),
        "min_deposit": event.get("min_deposit"),
        "max_reward": event.get("max_reward"),
        "target_volume": event.get("target_volume"),
        "loss_offset": event.get("loss_offset"),
        "bonus_validity_days": event.get("bonus_validity_days"),
        "commission_rate": event.get("commission_rate"),
    }, ensure_ascii=False, indent=2)

    pages_text = ""
    for pc in page_contents:
        pages_text += f"\n--- 页面: {pc['url']} ---\n{pc['content']}\n"

    user_msg = f"<现有活动描述>\n{event_info}\n</现有活动描述>\n\n<活动页面内容>{pages_text}\n</活动页面内容>"

    resp = ai.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": ENRICH_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.1,
        max_tokens=2048,
    )

    raw = resp.choices[0].message.content.strip()

    if "NO_CHANGE" in raw:
        return None

    # 解析 JSON
    raw = re.sub(r"^```(?:json)?\s*\n?", "", raw)
    raw = re.sub(r"\n?```\s*$", "", raw)
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # 尝试找 JSON 对象
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        if match:
            try:
                return json.loads(match.group())
            except json.JSONDecodeError:
                pass
        logger.warning("Failed to parse AI response for %s", event.get("exchange"))
        return None


# ── 主流程 ────────────────────────────────────────────────────────────────

def run(dry_run: bool = False):
    """主流程：读取 events → 抓取页面 → AI 优化 → 更新 summary。"""

    # 1. 读取最新 summary
    result = (
        db.table("summaries")
        .select("id, summary")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if not result.data:
        logger.error("No summary found")
        return

    summary_id = result.data[0]["id"]
    summary = json.loads(result.data[0]["summary"])

    # 读取 active_events 和 expired_events（前端实际使用的字段）
    active_events = summary.get("active_events", [])
    expired_events = summary.get("expired_events", [])
    # 合并所有活动进行 enrich
    events = active_events + expired_events
    # 如果没有分类字段，fallback 到 events
    if not events:
        events = summary.get("events", [])
    logger.info("Loaded %d events from summary #%d (%d active, %d expired)",
                len(events), summary_id, len(active_events), len(expired_events))

    # 1.5 备份优化前数据（用于后续前后对比）
    os.makedirs("output", exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_path = f"output/enrich_backup_{ts}.json"
    with open(backup_path, "w", encoding="utf-8") as bf:
        json.dump({"active_events": active_events, "expired_events": expired_events}, bf, ensure_ascii=False, indent=2)
    logger.info("Backup saved to %s (%d events)", backup_path, len(events))

    # 2. 加载 raw messages
    raw_msg_map = load_raw_messages()
    logger.info("Loaded %d raw messages", len(raw_msg_map))

    # 3. 逐活动处理
    enriched_count = 0
    skipped_count = 0

    for i, event in enumerate(events):
        exchange = event.get("exchange", "?")
        name = event.get("event_name", "?")

        urls = collect_urls_for_event(event, raw_msg_map)
        if not urls:
            skipped_count += 1
            continue

        logger.info("[%d/%d] %s - %s: %d URLs", i + 1, len(events), exchange, name, len(urls))

        # 抓取页面
        page_contents = []
        for url in urls:
            content = fetch_page(url)
            if content:
                page_contents.append({"url": url, "content": content})
                logger.info("  ✓ Fetched %s (%d chars)", url, len(content))
            else:
                logger.info("  ✗ Skip %s (empty/SPA)", url)
            time.sleep(0.5)  # 礼貌延迟

        if not page_contents:
            skipped_count += 1
            continue

        if dry_run:
            logger.info("  [DRY] Would enrich with %d pages", len(page_contents))
            continue

        # AI 优化
        updates = call_enrich_ai(event, page_contents)
        if updates:
            changes = updates.pop("changes_summary", "")
            ALLOWED_KEYS = {"reward", "min_deposit", "max_reward", "target_volume", "loss_offset", "bonus_validity_days", "commission_rate"}
            for key, value in updates.items():
                if key in ALLOWED_KEYS and value is not None and value != "":
                    event[key] = value
            enriched_count += 1
            logger.info("  ✓ Enriched: %s", changes)
        else:
            logger.info("  - No changes needed")

        time.sleep(1)  # API 限流

    logger.info(
        "Done: %d enriched, %d skipped (no URL/no content), %d total",
        enriched_count, skipped_count, len(events),
    )

    if dry_run or enriched_count == 0:
        return

    # 4. 同步更新 active_events、expired_events 和 events
    n_active = len(active_events)
    summary["active_events"] = events[:n_active]
    summary["expired_events"] = events[n_active:]
    summary["events"] = events
    db.table("summaries").update({
        "summary": json.dumps(summary, ensure_ascii=False),
    }).eq("id", summary_id).execute()

    logger.info("Updated summary #%d with enriched events (synced active/expired/events)", summary_id)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="活动页面抓取优化")
    parser.add_argument("--dry", action="store_true", help="只抓取页面，不调用 AI")
    args = parser.parse_args()
    run(dry_run=args.dry)
