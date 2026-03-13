"""
Crypto exchange event aggregator — reads unprocessed messages from multiple TG channels,
deduplicates across channels, and produces a consolidated event summary via OpenAI.

Usage:
    python3 summarizer.py --once     # single run
    python3 summarizer.py            # same as --once (default)
"""

import argparse
import json
import os
import re
from datetime import datetime, date
from difflib import SequenceMatcher

from utils import get_supabase, get_openai, logger

db = get_supabase()
ai = get_openai()

# ── Channel name mapping ────────────────────────────────────────────────────

CHANNEL_NAMES: dict[int, str] = {
    -1002000478651: "Coinscalper Channel",
    -1003061431387: "증정금 No1 레드터틀 채널",
    -1003601907317: "Dalchuni Crypto Events",
    -1002770517188: "Global Loha(Crypto Event)",
    -1003500837149: "Redturtle_Global_Events",
    -1003389965115: "Global Exchange Event Summary",
}


def make_tg_link(chat_id: int, message_id: int) -> str:
    """生成 Telegram 消息跳转链接（私有频道格式 /c/{内部ID}/{msg_id}）。"""
    internal_id = str(chat_id).replace("-100", "", 1)
    return f"https://t.me/c/{internal_id}/{message_id}"

# ── Prompt for cross-channel crypto event aggregation ────────────────────────

# ── Exchanges to EXCLUDE ────────────────────────────────────────────────────
EXCLUDED_EXCHANGES = {"bybit", "bitget"}

SYSTEM_PROMPT = """你是加密货币交易所活动研究分析助手。整合 Telegram 多频道消息中的交易所活动信息。

## ⚠️ CRITICAL：延期活动处理（必须遵守）
当消息中出现 "extended"、"延期"、"续期"、"renewed" 等关键词且包含新日期时：
- **必须**为该活动输出一个事件，start_date/end_date 使用消息中的新日期
- 设置 is_extended: true
- **严禁跳过或忽略此类消息**

示例：消息内容 "🐢Tapbit event extended... Period: 3/2 16:00 ~ 3/16 16:00 (UTC+9)"
→ 必须输出：{"exchange":"Tapbit", "start_date":"2026-03-02 16:00", "end_date":"2026-03-16 16:00", "is_extended":true, ...}

## 排除规则
- 完全忽略 Bybit、Bitget
- 忽略交易量大赛/排名赛、滑点补偿、无入金要求的抽奖类活动
- 只关注有入金/交易量要求的赠金活动、注册奖励、空投

## 目标交易所（参考）
LBank, Tapbit, AscendEX, BitMart, WOOX Pro, OrangeX, Toobit, XT, BTCC, VOOX, Zoomex, Deepcoin, Picol, OurBit, Phemex, FameEX, BYDFI, Hotcoin, WEEX, Bitrue, KuCoin

## 合并规则
- 同一活动链接/页面 = 同一 event（多任务/档位写在 reward 中）
- 新老用户区分在同一活动框架下 = 同一 event
- 不同频道说同一活动 → 合并，sources 列出所有来源
- 核心规则（入金/交易量/档位）基本匹配就合并，容忍时间微调和标签差异
- 仅完全不同的活动页面才拆分

## 日期解析（极其重要）
- 消息中日期格式多样："3/2 16:00 ~ 3/16 16:00"、"2026.2.28 ~ 3.16"、"March 2 - March 16" 等
- **必须逐字符精确提取**，"3/16" 是3月16日不是3月6日，"2/28" 是2月28日不是2月8日
- start_date / end_date 统一格式 YYYY-MM-DD HH:MM（无时间则只写日期）
- 年份默认 2026，若消息中无年份
- **严禁猜测日期**：如果消息中没有明确的日期信息，start_date/end_date 必须输出 null
- **禁止使用 "2026-12-31" 或其他年底/年初日期作为占位符**
- 只有消息中明确写出的日期才可以填入，不确定时宁可输出 null

## 必填字段
- exchange, event_name（中文简短）, type（deposit_bonus/signup_bonus/airdrop/other）
- loss_offset（整数 0-100，不确定设 -1）, commission_rate（整数，取所有来源最高值）
- reward（中文，用语义标注：入金 `{{d:数值}}` 交易量 `{{v:数值}}` 赠金 `{{b:数值}}`。多档位时换行用"档位："引出）
- requirements（中文）, sources, source_channel, source_links（从 [TG_LINK:...] 提取）

## 可选字段（无信息留空或 null）
start_date, end_date, link（仅活动详情页）, tips, bonus_type（opening_margin/trial_fund/voucher/cash/bonus）, bonus_validity_days, withdrawal_condition, leverage_limit, min_deposit, target_volume, max_reward, new_users_only, kyc_required, is_new, is_extended（延期活动设 true）

## 输出格式（严格 JSON）
{"events": [{"exchange": "...", ...}], "summary": "..."}

## 注意
- 韩语/英语消息统一中文输出
- loss_offset, commission_rate 必须是整数
"""


def fetch_pending_messages() -> list[dict]:
    """Fetch all un-summarized messages across all channels."""
    result = (
        db.table("raw_messages")
        .select("*")
        .eq("is_summarized", False)
        .order("sent_at", desc=False)
        .execute()
    )
    return result.data


def build_conversation_text(messages: list[dict]) -> str:
    """Format messages with channel source info + TG deep link."""
    lines = []
    for m in messages:
        ts = m["sent_at"][:16].replace("T", " ")
        channel = CHANNEL_NAMES.get(m["chat_id"], str(m["chat_id"]))
        tg_link = make_tg_link(m["chat_id"], m["message_id"])
        lines.append(f"[{ts}] [{channel}] [TG_LINK:{tg_link}]\n{m['text']}\n")
    return "\n".join(lines)


def get_latest_events() -> list[dict] | None:
    """Get the most recent summary's events for dedup comparison."""
    result = (
        db.table("summaries")
        .select("summary, topics")
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    if result.data:
        try:
            parsed = json.loads(result.data[0]["summary"])
            return parsed.get("events", [])
        except (json.JSONDecodeError, TypeError):
            return None
    return None


def extract_json(text: str) -> dict:
    """Robustly extract JSON from LLM response, handles truncation."""
    # Strip markdown code fences
    text = re.sub(r"^```(?:json)?\s*\n?", "", text.strip())
    text = re.sub(r"\n?```\s*$", "", text.strip())

    # Try direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Find the JSON object boundaries
    match = re.search(r'\{', text)
    if not match:
        logger.error("No JSON object found in response")
        return {"events": [], "summary": "解析失败"}

    start = match.start()
    last_brace = text.rfind("}")
    if last_brace > start:
        candidate = text[start:last_brace + 1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass

    # Truncated JSON recovery: find the last complete event object
    partial = text[start:]
    # 用多种标记找最后一个完整事件对象的结尾
    last_complete = -1
    # 1) 试 "status" 字段（最后一个字段）
    for m in re.finditer(r'"status"\s*:\s*"(?:active|expired)"\s*\}', partial):
        last_complete = m.end()
    # 2) 试 "is_new" 字段
    if last_complete == -1:
        for m in re.finditer(r'"is_new"\s*:\s*(?:true|false|null)\s*\}', partial):
            last_complete = m.end()
    # 3) 通用方案：找最后一个 }\s*,\s*{ 的位置（事件对象之间的边界）
    if last_complete == -1:
        for m in re.finditer(r'\}\s*,\s*\{', partial):
            last_complete = m.start() + 1  # 取到 } 为止

    if last_complete > 0:
        truncated = partial[:last_complete]
        # Close the events array and root object, add a summary
        repaired = truncated + '], "summary": "部分结果（响应被截断）"}'
        try:
            result = json.loads(repaired)
            logger.warning("Recovered %d events from truncated response", len(result.get("events", [])))
            return result
        except json.JSONDecodeError:
            pass

    # Brute-force suffix attempts
    for suffix in ['"}]}', '"]}', ']}', '}']:
        try:
            return json.loads(partial + suffix)
        except json.JSONDecodeError:
            continue

    logger.error("Failed to parse JSON from response (length=%d)", len(text))
    return {"events": [], "summary": "JSON 解析失败，请重试"}


def call_llm(user_msg: str, use_reasoner: bool = False) -> dict:
    """Single LLM API call, returns parsed JSON.
    use_reasoner param kept for compatibility but ignored (GPT-5.4 handles all).
    """
    model = "gpt-5.4"

    resp = ai.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        temperature=0.2,
        max_completion_tokens=16384,
    )

    raw = resp.choices[0].message.content
    usage = resp.usage
    token_info = f"in={usage.prompt_tokens} out={usage.completion_tokens}" if usage else "N/A"

    # Save raw response for debugging
    debug_path = "last_response.txt"
    with open(debug_path, "a", encoding="utf-8") as f:
        f.write(f"\n{'='*60}\n[{model}] tokens: {token_info}\n{raw}\n")
    logger.info("[%s] response %d chars, tokens: %s", model, len(raw), token_info)
    return extract_json(raw)


def _parse_date(date_str) -> date | None:
    """解析日期字符串前 10 位，容错各种格式。"""
    if not date_str:
        return None
    try:
        return datetime.strptime(str(date_str)[:10], "%Y-%m-%d").date()
    except (ValueError, IndexError):
        return None


def merge_events(all_batches: list[list[dict]]) -> list[dict]:
    """Merge events from multiple batches, dedup by content similarity."""
    import re

    def _extract_numbers(event: dict) -> set[int]:
        """从 reward / requirements / target_volume 中提取数值作为活动指纹。"""
        texts = [
            str(event.get("reward", "")),
            str(event.get("requirements", "")),
            str(event.get("target_volume", "")),
        ]
        nums = set()
        for t in texts:
            for n in re.findall(r'[\d,]+', t):
                clean = n.replace(',', '')
                if clean.isdigit() and 2 <= len(clean) <= 10:
                    val = int(clean)
                    if val >= 100:  # 排除日期/百分比噪音（10,20,30等）
                        nums.add(val)
        # 也加入结构化数值字段
        for key in ["min_deposit", "max_reward"]:
            v = event.get(key)
            if v and isinstance(v, (int, float)) and v > 0:
                nums.add(int(v))
        return nums

    def _is_incomplete(e: dict) -> bool:
        """reward 太短的 event 很可能是 JSON 截断产物。"""
        return len(str(e.get("reward", ""))) < 20

    def is_similar(e1: dict, e2: dict) -> bool:
        # 必须是同一交易所
        if e1.get('exchange', '').lower().strip() != e2.get('exchange', '').lower().strip():
            return False
        # 相同活动链接 → 直接合并（归一化后比较）
        def _normalize_link(url: str) -> str:
            """归一化链接：去协议、www、语言路径、推广参数、月份后缀"""
            import re as _re
            from urllib.parse import urlparse, parse_qs, urlencode
            u = url.strip()
            if not u.startswith('http'):
                u = 'https://' + u
            parsed = urlparse(u.lower())
            # 去 www
            host = _re.sub(r'^www\.', '', parsed.netloc)
            # 去语言路径 /en-US/ /zh-CN/
            path = _re.sub(r'/[a-z]{2}(-[a-z]{2})?/', '/', parsed.path)
            # 去月份后缀
            path = _re.sub(r'-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)$', '', path.rstrip('/'))
            # 只去推广参数，保留业务参数(id等)
            promo_keys = {'invitecode', 'ru', 'vipcode', 'qrtype', 'invite_code', 'p', 'ref', 'referral', 'referralcode'}
            params = parse_qs(parsed.query)
            clean_params = {k: v for k, v in params.items() if k.lower() not in promo_keys}
            q = urlencode(clean_params, doseq=True) if clean_params else ''
            return f"{host}{path}{'?' + q if q else ''}"
        l1, l2 = (e1.get('link') or '').strip(), (e2.get('link') or '').strip()
        if l1 and l2 and _normalize_link(l1) == _normalize_link(l2):
            return True
        # 截断残缺品：同交易所 + 同 type 才合并（防止不同活动误合并）
        if _is_incomplete(e1) or _is_incomplete(e2):
            return e1.get("type") == e2.get("type")
        # 核心内容匹配：提取 ≥100 的数值指纹，比较重叠度
        nums1 = _extract_numbers(e1)
        nums2 = _extract_numbers(e2)
        if not nums1 or not nums2:
            return False
        overlap = nums1 & nums2
        smaller = min(len(nums1), len(nums2))
        # 重叠率 ≥ 90% 才判定为同一活动（避免版本更新被误合并）
        return len(overlap) / smaller >= 0.9

    merged_list = []
    
    for batch in all_batches:
        for event in batch:
            matched_existing = None
            for existing in merged_list:
                if is_similar(existing, event):
                    matched_existing = existing
                    break
            
            if matched_existing:
                old = matched_existing
                # 确保 sources/source_links 是列表（AI 有时输出为字符串）
                def _as_list(v): return v if isinstance(v, list) else [v] if v else []
                old["sources"] = list(dict.fromkeys(_as_list(old.get("sources")) + _as_list(event.get("sources"))))
                old["source_links"] = list(dict.fromkeys(_as_list(old.get("source_links")) + _as_list(event.get("source_links"))))

                # ── 记录每一轮的完整信息 ──
                new_round = {
                    "start": event.get("start_date"),
                    "end": event.get("end_date"),
                    "sources": _as_list(event.get("sources")),
                }
                rounds = old.setdefault("rounds", [])
                # 智能去重：日期差 ≤7 天视为同一轮，合并 sources
                new_end_d = _parse_date(new_round.get("end") or "")
                new_start_d = _parse_date(new_round.get("start") or "")
                matched_round = None
                for existing_round in rounds:
                    ex_end_d = _parse_date(existing_round.get("end") or "")
                    ex_start_d = _parse_date(existing_round.get("start") or "")
                    end_close = (not new_end_d or not ex_end_d or abs((new_end_d - ex_end_d).days) <= 5)
                    start_close = (not new_start_d or not ex_start_d or abs((new_start_d - ex_start_d).days) <= 5)
                    if end_close and start_close:
                        matched_round = existing_round
                        break
                if matched_round:
                    # 合并 sources
                    existing_src = matched_round.get("sources", [])
                    for s in new_round["sources"]:
                        if s not in existing_src:
                            existing_src.append(s)
                    matched_round["sources"] = existing_src
                else:
                    rounds.append(new_round)

                # ── 日期合并：取最晚 end_date + 防幻觉 ──
                old_end = _parse_date(old.get("end_date", ""))
                new_end = _parse_date(event.get("end_date", ""))
                if new_end and old_end and new_end != old_end:
                    if new_end > old_end:
                        jump_days = (new_end - old_end).days
                        if jump_days <= 60:
                            old["end_date"] = event.get("end_date")
                        else:
                            logger.warning("Ignoring suspicious end_date jump: %s -> %s (%d days) for %s",
                                           old.get("end_date"), event.get("end_date"), jump_days,
                                           event.get("exchange", "?"))
                elif new_end and not old_end:
                    old["end_date"] = event.get("end_date")

                # start_date 取更早的
                old_start = _parse_date(old.get("start_date", ""))
                new_start = _parse_date(event.get("start_date", ""))
                if new_start and (not old_start or new_start < old_start):
                    old["start_date"] = event.get("start_date")

                # link：优先取非空
                if not old.get("link") and event.get("link"):
                    old["link"] = event["link"]
                
                old_comm = old.get("commission_rate", -1)
                new_comm = event.get("commission_rate", -1)
                try:
                    if int(old_comm) >= 0 and int(new_comm) >= 0:
                        old["commission_rate"] = max(int(old_comm), int(new_comm))
                    elif int(new_comm) >= 0:
                        old["commission_rate"] = int(new_comm)
                except (ValueError, TypeError):
                    pass

                if len(str(event.get("reward", ""))) > len(str(old.get("reward", ""))):
                    old["reward"] = event.get("reward")
                if len(str(event.get("requirements", ""))) > len(str(old.get("requirements", ""))):
                    old["requirements"] = event.get("requirements")
                if len(str(event.get("tips", ""))) > len(str(old.get("tips", ""))):
                    old["tips"] = event.get("tips")
                
                old_loss = old.get("loss_offset", -1)
                new_loss = event.get("loss_offset", -1)
                try:
                    if int(old_loss) >= 0 and int(new_loss) >= 0:
                        old["loss_offset"] = max(int(old_loss), int(new_loss))
                    elif int(new_loss) >= 0:
                        old["loss_offset"] = int(new_loss)
                except (ValueError, TypeError):
                    pass

                # 如果 old 是残缺品但 new 是完整的，用 new 的核心字段整体替换
                if _is_incomplete(old) and not _is_incomplete(event):
                    for key in ["event_name", "reward", "requirements", "tips",
                                "start_date", "end_date", "link", "bonus_type",
                                "bonus_validity_days", "withdrawal_condition",
                                "leverage_limit", "min_deposit", "target_volume",
                                "max_reward", "new_users_only", "kyc_required"]:
                        if event.get(key):
                            old[key] = event[key]
            else:
                # 新事件：初始化第一轮
                def _as_list(v): return v if isinstance(v, list) else [v] if v else []
                event["rounds"] = [{
                    "start": event.get("start_date"),
                    "end": event.get("end_date"),
                    "sources": _as_list(event.get("sources")),
                }]
                merged_list.append(event)
                
    return merged_list


# ── 过期判定 + 版本对比 ──────────────────────────────────────────────────

def classify_events(events: list[dict], today: date | None = None) -> tuple[list[dict], list[dict]]:
    """将 events 按 end_date 分为 active 和 expired。"""
    today = today or date.today()
    active, expired = [], []

    for e in events:
        end = e.get("end_date", "") or ""
        try:
            end_dt = datetime.strptime(end[:10], "%Y-%m-%d").date()
            if end_dt < today:
                e["status"] = "expired"
                expired.append(e)
            else:
                e["status"] = "active"
                active.append(e)
        except (ValueError, IndexError):
            # 没有 end_date：检查 start_date 是否超过 30 天
            start = e.get("start_date", "") or ""
            try:
                start_dt = datetime.strptime(start[:10], "%Y-%m-%d").date()
                if (today - start_dt).days > 30:
                    e["status"] = "expired"
                    expired.append(e)
                    continue
            except (ValueError, IndexError):
                pass
            e["status"] = "active"
            active.append(e)

    return active, expired


def analyze_similarity(old: dict, new: dict) -> str:
    """对比入金/交易量/奖励三核心字段。返回 same/updated/different"""
    def extract_numbers(text: str) -> list[int]:
        return sorted(
            int(n.replace(',', ''))
            for n in re.findall(r'[\d,]+', text)
            if n.replace(',', '').isdigit() and len(n.replace(',', '')) <= 10
        )

    fields = ["requirements", "reward", "target_volume"]
    changes = sum(
        1 for f in fields
        if extract_numbers(str(old.get(f, ""))) != extract_numbers(str(new.get(f, "")))
    )

    if changes == 0:
        return "same"
    elif changes <= 2:
        return "updated"
    else:
        return "different"


def _name_similarity(a: str, b: str) -> float:
    """event_name 去月份/版本号后的相似度。"""
    def clean(s: str) -> str:
        s = re.sub(r'\d+月?', '', s)
        s = re.sub(r'Tier\s*\d+\.?\d*', 'Tier', s, flags=re.I)
        s = re.sub(r'[\d/\-~至日号（）()]', '', s)
        return s.strip()
    return SequenceMatcher(None, clean(a), clean(b)).ratio()


def find_version_pairs(active: list[dict], expired: list[dict]) -> list[dict]:
    """在 active 和 expired 中找同一活动的新旧版本对。"""
    pairs = []
    used_expired = set()

    for a in active:
        for i, ex in enumerate(expired):
            if i in used_expired:
                continue
            if a.get("exchange", "").lower() != ex.get("exchange", "").lower():
                continue
            if a.get("type") != ex.get("type"):
                continue
            # 粗匹配：名称相似度
            sim = _name_similarity(
                a.get("event_name", ""), ex.get("event_name", "")
            )
            if sim < 0.5:
                continue
            # 核心字段分析
            result = analyze_similarity(ex, a)
            if result == "updated":
                pairs.append({"old": ex, "new": a, "similarity": result})
                used_expired.add(i)
                break
            elif result == "same":
                used_expired.add(i)
                break

    return pairs


def load_manual_events() -> list[dict]:
    """读取 manual_events.json（如有）。"""
    path = os.path.join(os.path.dirname(__file__), "manual_events.json")
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else data.get("events", [])
    except (json.JSONDecodeError, IOError) as e:
        logger.warning("Failed to load manual_events.json: %s", e)
        return []


def validate_dates(events: list[dict], raw_messages: list[dict]) -> list[dict]:
    """C. 日期后处理：用 regex 从原始消息提取日期，校验/修正 AI 输出的 end_date。"""
    if not raw_messages:
        return events

    # 按 exchange 分组原始消息
    exchange_messages: dict[str, list[str]] = {}
    for m in raw_messages:
        text = m.get("text", "").lower()
        for ev in events:
            ex = ev.get("exchange", "").lower()
            if ex and ex in text:
                exchange_messages.setdefault(ex, []).append(m.get("text", ""))

    # 日期正则：匹配常见格式
    date_patterns = [
        # M/D 格式：3/16, 12/31
        r'(\d{1,2})/(\d{1,2})(?:\s+\d{1,2}:\d{2})?',
        # YYYY-MM-DD
        r'(20\d{2})-(\d{1,2})-(\d{1,2})',
        # YYYY.M.D
        r'(20\d{2})\.(\d{1,2})\.(\d{1,2})',
        # M.D 格式：3.16
        r'(?:^|\s)(\d{1,2})\.(\d{1,2})(?:\s|$)',
    ]

    def extract_dates_from_texts(texts: list[str]) -> list[date]:
        """Extract all dates from text list."""
        dates = []
        for text in texts:
            for pattern in date_patterns:
                for match in re.finditer(pattern, text):
                    groups = match.groups()
                    try:
                        if len(groups) == 3 and int(groups[0]) > 2000:
                            # YYYY-MM-DD or YYYY.M.D
                            d = date(int(groups[0]), int(groups[1]), int(groups[2]))
                        elif len(groups) == 2:
                            # M/D or M.D
                            month, day = int(groups[0]), int(groups[1])
                            if 1 <= month <= 12 and 1 <= day <= 31:
                                d = date(2026, month, day)
                            else:
                                continue
                        else:
                            continue
                        dates.append(d)
                    except (ValueError, IndexError):
                        continue
        return dates

    # 只检测告警，不自动修正（自动修正会把 A 活动的日期用 B 活动的消息修错）
    warnings = 0
    for ev in events:
        ex = ev.get("exchange", "").lower()
        ai_end = _parse_date(ev.get("end_date", ""))
        if not ai_end:
            continue

        # 检查疑似年底占位符
        end_str = str(ev.get("end_date", ""))
        if "12-31" in end_str or "01-01" in end_str:
            logger.warning("⚠️ Suspicious placeholder date: %s %s end=%s",
                           ev.get("exchange"), ev.get("event_name", "")[:20], end_str)
            warnings += 1

        # 检查日期跨度 >120 天
        ai_start = _parse_date(ev.get("start_date", ""))
        if ai_start and ai_end:
            span = (ai_end - ai_start).days
            if span > 120:
                logger.warning("⚠️ Suspicious date span: %s %s %d days (%s ~ %s)",
                               ev.get("exchange"), ev.get("event_name", "")[:20],
                               span, ev.get("start_date"), ev.get("end_date"))
                warnings += 1

    if warnings:
        logger.warning("Date validation: %d warnings (no auto-correction)", warnings)
    return events

def _prepare_batch_requests(conversation_parts: list[str], previous_events: list[dict] | None) -> list[dict]:
    """Prepare JSONL batch request lines."""
    requests = []
    for i, part in enumerate(conversation_parts):
        user_msg = part
        if previous_events:
            KEEP_KEYS = {"exchange", "event_name", "type", "end_date", "start_date",
                         "min_deposit", "max_reward", "link", "sources"}
            compressed = [{k: e[k] for k in KEEP_KEYS if k in e} for e in previous_events]
            prev_text = json.dumps(compressed, ensure_ascii=False)
            user_msg = (
                f"<之前的活动列表>\n{prev_text}\n</之前的活动列表>\n\n"
                f"<新消息>\n{part}\n</新消息>"
            )
        requests.append({
            "custom_id": f"batch-{i}",
            "method": "POST",
            "url": "/v1/chat/completions",
            "body": {
                "model": "gpt-5.4",
                "messages": [
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_msg},
                ],
                "temperature": 0.2,
                "max_completion_tokens": 16384,
            }
        })
    return requests


def _run_batch(requests: list[dict]) -> list[dict]:
    """Submit batch to OpenAI Batch API, poll until done, return parsed results."""
    import tempfile, time

    # 1. Write JSONL
    jsonl_path = os.path.join(tempfile.gettempdir(), "batch_input.jsonl")
    with open(jsonl_path, "w", encoding="utf-8") as f:
        for req in requests:
            f.write(json.dumps(req, ensure_ascii=False) + "\n")
    logger.info("Batch: wrote %d requests to %s", len(requests), jsonl_path)

    # 2. Upload file
    with open(jsonl_path, "rb") as f:
        uploaded = ai.files.create(file=f, purpose="batch")
    logger.info("Batch: uploaded file %s", uploaded.id)

    # 3. Create batch
    batch = ai.batches.create(
        input_file_id=uploaded.id,
        endpoint="/v1/chat/completions",
        completion_window="24h",
    )
    logger.info("Batch: created %s, status=%s", batch.id, batch.status)

    # 4. Poll until complete (check every 30s, max 2h)
    max_wait = 7200
    elapsed = 0
    while elapsed < max_wait:
        time.sleep(30)
        elapsed += 30
        batch = ai.batches.retrieve(batch.id)
        logger.info("Batch: %s status=%s (%ds elapsed)", batch.id, batch.status, elapsed)
        if batch.status == "completed":
            break
        if batch.status in ("failed", "expired", "cancelled"):
            logger.error("Batch failed: %s", batch.status)
            raise RuntimeError(f"Batch {batch.id} failed with status: {batch.status}")

    if batch.status != "completed":
        raise RuntimeError(f"Batch {batch.id} timed out after {max_wait}s")

    # Re-retrieve to ensure all fields are populated
    batch = ai.batches.retrieve(batch.id)
    logger.info("Batch completed: output_file_id=%s, error_file_id=%s",
                batch.output_file_id, batch.error_file_id)

    # Check for errors
    if batch.error_file_id:
        err_content = ai.files.content(batch.error_file_id)
        logger.warning("Batch errors:\n%s", err_content.text[:2000])

    if not batch.output_file_id:
        raise RuntimeError(f"Batch {batch.id} completed but output_file_id is None. "
                           f"Check error_file_id: {batch.error_file_id}")

    # 5. Download results
    output_file = ai.files.content(batch.output_file_id)
    results_text = output_file.text

    # 6. Parse results, sort by custom_id
    results_by_id: dict[str, dict] = {}
    total_in, total_out = 0, 0
    for line in results_text.strip().split("\n"):
        result = json.loads(line)
        cid = result["custom_id"]
        resp_body = result["response"]["body"]
        raw = resp_body["choices"][0]["message"]["content"]
        usage = resp_body.get("usage", {})
        t_in = usage.get("prompt_tokens", 0)
        t_out = usage.get("completion_tokens", 0)
        total_in += t_in
        total_out += t_out
        logger.info("[%s] tokens: in=%d out=%d", cid, t_in, t_out)
        results_by_id[cid] = extract_json(raw)

    logger.info("Batch total: in=%d out=%d total=%d", total_in, total_out, total_in + total_out)

    # Return in order
    ordered = []
    for i in range(len(requests)):
        cid = f"batch-{i}"
        ordered.append(results_by_id.get(cid, {"events": []}))
    return ordered


def generate_summary(
    conversation_parts: list[str],
    previous_events: list[dict] | None,
    raw_messages: list[dict] | None = None,
) -> dict:
    """Call GPT-5.4 via Batch API (half price), merge results."""
    # Clear debug file
    with open("last_response.txt", "w", encoding="utf-8") as f:
        f.write("")

    n_batches = len(conversation_parts)
    logger.info("Using model: gpt-5.4 via Batch API (%d batches, 50%% off)", n_batches)

    # Prepare and submit batch
    requests = _prepare_batch_requests(conversation_parts, previous_events)

    if n_batches <= 1:
        # 1 batch 不值得用 Batch API（等待时间太长），直接同步调用
        logger.info("Single batch: using sync API instead")
        user_msg = requests[0]["body"]["messages"][1]["content"]
        result = call_llm(user_msg)
        all_event_batches = [result.get("events", [])]
    else:
        # 多 batch 用 Batch API 省钱
        batch_results = _run_batch(requests)
        all_event_batches = [r.get("events", []) for r in batch_results]
        for i, events in enumerate(all_event_batches):
            logger.info("Batch %d: %d events", i + 1, len(events))

    merged = merge_events(all_event_batches)
    logger.info("Merged: %d unique events from %d batches", len(merged), n_batches)

    # C. 日期后处理
    merged = validate_dates(merged, raw_messages or [])

    return {"events": merged, "summary": f"整合共发现 {len(merged)} 个活动（已排除 Bybit/Bitget），来自 {n_batches} 批消息。"}


def events_are_same(new_events: list[dict], old_events: list[dict] | None) -> bool:
    """Check if the new event set is essentially the same as the old one."""
    if old_events is None:
        return False

    # Compare by event names + exchanges (normalized)
    def event_key(e: dict) -> str:
        return f"{e.get('exchange', '').lower()}:{e.get('event_name', '').lower()}:{str(e.get('end_date', ''))[:10]}"

    new_keys = sorted(event_key(e) for e in new_events)
    old_keys = sorted(event_key(e) for e in old_events)
    return new_keys == old_keys


def mark_summarized(message_ids: list[int]):
    """Mark messages as summarized."""
    db.table("raw_messages").update({"is_summarized": True}).in_(
        "id", message_ids
    ).execute()


def run_once():
    """Single aggregation pass across all channels."""
    messages = fetch_pending_messages()

    if not messages:
        logger.info("No pending messages to process.")
        return

    logger.info("Processing %d messages across channels...", len(messages))

    # Split into batches of ~80 messages each to avoid output truncation
    BATCH_SIZE = 80
    batches = [messages[i:i + BATCH_SIZE] for i in range(0, len(messages), BATCH_SIZE)]
    conversation_parts = [build_conversation_text(batch) for batch in batches]
    logger.info("Split into %d batches", len(conversation_parts))

    previous_events = get_latest_events()

    # 全量重跑（消息数过多）时不传 previous_events，避免 AI 输出超 8192 token
    # 增量更新时（少量新消息）传入以确保去重
    if len(messages) > 200:
        logger.info("Full re-run detected (%d msgs) — skipping previous_events to avoid token overflow", len(messages))
        previous_events = None

    result = generate_summary(conversation_parts, previous_events, raw_messages=messages)

    all_events = result.get("events", [])

    # Dedup check: if the events are the same as last time, skip
    if events_are_same(all_events, previous_events):
        logger.info("Events identical to previous summary -- skipping save.")
        mark_summarized([m["id"] for m in messages])
        return

    # ── 过期判定 + 版本对比 ──
    active_events, expired_events = classify_events(all_events)
    logger.info(
        "Classified: %d active, %d expired",
        len(active_events), len(expired_events),
    )

    # 合并手动录入的过期活动
    manual = load_manual_events()
    if manual:
        for me in manual:
            me.setdefault("status", "expired")
        expired_events.extend(manual)
        logger.info("Loaded %d manual events", len(manual))

    # 查找版本对比
    version_pairs = find_version_pairs(active_events, expired_events)
    if version_pairs:
        logger.info("Found %d version change pairs", len(version_pairs))

    # 构建新格式的 summary JSON
    final_result = {
        "active_events": active_events,
        "expired_events": expired_events,
        "version_pairs": version_pairs,
        "events": all_events,  # 保持向后兼容
        "summary": (
            f"整合共 {len(all_events)} 个活动（已排除 Bybit/Bitget）: "
            f"{len(active_events)} 当期 + {len(expired_events)} 过期, "
            f"{len(version_pairs)} 组版本变更。"
        ),
    }

    # Extract topic labels from events
    topics = list({e.get("exchange", "Unknown") for e in all_events})

    # Compute time range
    timestamps = [m["sent_at"] for m in messages]
    time_start = min(timestamps)
    time_end = max(timestamps)

    # Use chat_id=0 to indicate cross-channel aggregation
    summary_row = {
        "chat_id": 0,
        "summary": json.dumps(final_result, ensure_ascii=False),
        "topics": topics,
        "message_count": len(messages),
        "time_range_start": time_start,
        "time_range_end": time_end,
    }

    db.table("summaries").insert(summary_row).execute()
    mark_summarized([m["id"] for m in messages])

    logger.info(
        "Saved: %d active + %d expired events, %d version pairs, from %d messages",
        len(active_events),
        len(expired_events),
        len(version_pairs),
        len(messages),
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Crypto Event Aggregator")
    parser.add_argument(
        "--once",
        action="store_true",
        default=True,
        help="Run a single aggregation pass (default)",
    )
    parser.parse_args()
    run_once()
