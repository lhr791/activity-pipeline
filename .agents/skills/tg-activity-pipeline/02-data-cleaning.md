# Skill 2: 数据清理与 AI 整合

读取 Supabase `raw_messages` 待处理消息 → GPT-5.4 Batch API 整合为结构化活动数据 → 存入 `summaries` 表 + 生成 Word 报告。

> **前置条件**：先用 Skill 1 拉取最新 TG 数据。

## 执行命令
```powershell
cd "c:\Users\xtt\Desktop\ai 施工\活动整理"

# 完整流程（backfill + 导出 + AI 整合 + Word）
.\venv\Scripts\python.exe run_pipeline.py

# 跳过 backfill
.\venv\Scripts\python.exe run_pipeline.py --no-backfill

# 仅用已有 summary 生成 Word
.\venv\Scripts\python.exe run_pipeline.py --word-only
```

## AI 整合核心逻辑

- **Prompt**：`summarizer.py` 中的 `SYSTEM_PROMPT`
- **模型**：GPT-5.4 via Batch API（半价）
- **排除**：Bybit、Bitget、交易量大赛、滑点补偿、纯抽奖
- **合并规则**：同一活动链接/页面 = 同一 event；跨频道去重
- **分批处理**：每 80 条消息一批（`BATCH_SIZE = 80`），多批结果合并
- **防截断**：`extract_json()` 兜底机制自动恢复已输出的活动
- **语义标注**：reward 字段使用 `{{d:入金}}` `{{v:交易量}}` `{{b:赠金}}`
- **延期事件**：消息含 extended/renewed + 新日期 → AI 必须输出为独立事件

### 排除的交易所
`summarizer.py` 的 `EXCLUDED_EXCHANGES`：Bybit、Bitget

### 目标交易所（21个）
LBank, Tapbit, AscendEX, BitMart, WOOX Pro, OrangeX, Toobit, XT, BTCC, VOOX, Zoomex, Deepcoin, Picol, OurBit, Phemex, FameEX, BYDFI, Hotcoin, WEEX, Bitrue, KuCoin

## 输出字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| exchange | string | ✅ | 交易所名称 |
| event_name | string | ✅ | 活动名称（中文） |
| type | string | ✅ | deposit_bonus / signup_bonus / airdrop / other |
| loss_offset | int | ✅ | 亏损抵扣比例 0-100，-1=未知 |
| commission_rate | int | ✅ | KOL 返佣比例（取最高），-1=未知 |
| reward | string | ✅ | 奖励详情（含 `{{d:}}` `{{v:}}` `{{b:}}` 标注） |
| requirements | string | ✅ | 参与条件 |
| sources | string[] | ✅ | 来源频道列表 |
| source_channel | string | ✅ | 信息最详细的来源 |
| source_links | string[] | ✅ | TG 跳转链接 |
| start_date / end_date | string | ☐ | 活动时间 |
| tips | string | ☐ | 避坑要点 |
| bonus_type | string | ☐ | opening_margin / trial_fund / voucher / cash / bonus |
| withdrawal_condition | string | ☐ | 提现/解锁条件 |
| min_deposit | int | ☐ | 最低入金 USDT |
| max_reward | int | ☐ | 最高奖励 USDT |
| is_new | bool | ✅ | 是否新活动 |
| rounds | array | 自动 | 合并时记录每轮 {start, end, sources}，日期差≤5天视为同轮 |
| status | string | 自动 | active / expired，由 classify_events 自动判定 |

## 后处理流程（AI 输出 → summaries）

```
AI 输出 events[] 
    ↓ merge_events()     按数值指纹合并跨 batch 重复，记录 rounds
    ↓ classify_events()  按 end_date 分为 active/expired
    ↓ validate_dates()   检测异常日期（仅告警不修正）
    ↓ find_version_pairs()  active↔expired 三字段指纹配对
    ↓ 存入 summaries {active_events, expired_events, version_pairs}
```

### merge_events 合并判定
- **链接归一化**（优先）：同 exchange + 归一化链接相同（去协议/www/语言路径/月份后缀/推广参数，保留 `id=` 等业务参数）
- **数值指纹**：同 exchange + ≥100 的数值指纹重叠 ≥90%
- end_date 跳跃 >60 天 → 拒绝合并（防幻觉）

### classify_events 过期判定
- end_date < 今天 → expired
- 无 end_date 且 start_date > 30天前 → expired（兜底）

## Word 报告格式（参照 `2026.2月 竞品所活动 .docx`）
1. **汇总表**：按亏损抵扣分组（0% / 33~50% / 100%）
2. **详细说明**：标题 + 核心规则 + 活动时间 + 参与条件 + 奖励详情 + ⚠️ 避坑 + 🔗 链接 + 📲 TG 原文

## 关键文件

| 文件 | 用途 |
|------|------|
| `summarizer.py` | GPT-5.4 AI 整合（prompt + 批处理 + merge + classify） |
| `run_pipeline.py` | Pipeline 入口 |
| `generate_word.py` | 生成结构化 Word 报告 |
| `reviewer.py` | 人工审核 |
| `enrich_events.py` | 抓取活动页面 + AI 优化赠金规则 |

## 故障排查

| 问题 | 解决方案 |
|------|---------| 
| AI 整合为空 | 检查 `raw_messages` 有无 `is_summarized=false` 的消息 |
| JSON 解析失败 | 查看 `last_response.txt`，截断恢复自动尝试 |
| 活动遗漏 | 可能被截断；或对应频道没提到该交易所 |
| 延期活动未识别 | AI 把 "extended" 当补充说明，SYSTEM_PROMPT 已加规则 |
| API 429 | 等几秒重试，或检查余额 |
| 返佣/抵扣不准 | 调整 `SYSTEM_PROMPT` |
| Word 内容缺失 | 检查 `summaries` 表最新记录 |
| 前端历史版本丢失 | 检查 deduplicateVersions 逻辑，可能被 reward 相似度过滤 |

## 排除/添加交易所
修改 `summarizer.py` 中的 `EXCLUDED_EXCHANGES` 和 `SYSTEM_PROMPT` 中的目标列表。
