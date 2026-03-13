---
name: TG Activity Pipeline
description: TG 币圈交易所活动完整 Pipeline — 从 TG 频道数据采集、AI 整合去重、人工审核、Word 报告生成，到前端研究仪表盘展示
---

# TG 币圈交易所活动 Pipeline

## 标准 6 步流程

| # | 步骤 | 命令 | 说明 |
|---|------|------|------|
| 1 | 拉取 TG 消息 | `run_pipeline.py` | 增量拉取新消息 → `raw_messages` |
| 2 | 导出原始记录 | ↑ 自动 | → `output/TG原始记录_*.docx` |
| 3 | AI 整合 | ↑ 自动 | 去重分类打标签 → `summaries` 表 |
| 4 | **人工审核** | `reviewer.py` | **必做**：删除/合并重复活动 |
| 5 | 生成 Word | `run_pipeline.py --word-only` | → `output/竞品所活动_*.docx` |
| 6 | Web 展示 | `cd web && npm run dev` | Dashboard: localhost:3000 |

## 📊 Google Sheets 同步（自动）
- **链接**：[Google Sheets](https://docs.google.com/spreadsheets/d/1LSbuQGsAp47IBpIbjM2iz_SZ6hIlkmKQtF-j6b0wHp0/edit)
- **脚本**：`google_sheets_script.js`（粘贴到 Sheets → Extensions → Apps Script）
- **触发器**：已设定定时自动同步，无需手动运行
- **数据源**：直接从 Supabase `summaries` 表读取 `active_events`/`expired_events`

## 常用命令

```powershell
cd "c:\Users\xtt\Desktop\ai 施工\活动整理"

# 日常更新（步骤 1-3，增量拉取）
.\venv\Scripts\python.exe run_pipeline.py

# 人工审核（步骤 4，必做）
.\venv\Scripts\python.exe reviewer.py

# 生成 Word 报告（步骤 5，审核后执行）
.\venv\Scripts\python.exe run_pipeline.py --word-only

# 全量拉取（从 2026-01-01，偶尔用）
.\venv\Scripts\python.exe run_pipeline.py --full-backfill

# 跳过拉取，只重新整合
.\venv\Scripts\python.exe run_pipeline.py --no-backfill

# 加 Word（跳过审核，快速出报告）
.\venv\Scripts\python.exe run_pipeline.py --with-word
```

## Google Sheets 同步
通过 Apps Script 自动同步到 [Google Sheets](https://docs.google.com/spreadsheets/d/1LSbuQGsAp47IBpIbjM2iz_SZ6hIlkmKQtF-j6b0wHp0/edit)，每小时更新。
与前端看板使用同款去重逻辑，额外展示 TG 原消息。详见 [04-google-sheets-sync.md](./04-google-sheets-sync.md)。

## 子模块文档

| # | 模块 | 文件 | 说明 |
|---|------|------|------|
| 1 | TG 数据读取 | [01-tg-reading.md](./01-tg-reading.md) | Telethon 监听 + Backfill → Supabase `raw_messages` |
| 2 | 数据清理与 AI 整合 | [02-data-cleaning.md](./02-data-cleaning.md) | DeepSeek AI 去重整合 → `summaries` 表 |
| 3 | 活动整合与展示 | [03-activity-dashboard.md](./03-activity-dashboard.md) | Next.js 前端仪表盘 + Pipeline 编排 |
| 4 | Google Sheets 同步 | [04-google-sheets-sync.md](./04-google-sheets-sync.md) | GAS 脚本同步 + TG 原文反查 |
| 5 | 活动页面抓取优化 | [05-enrich-events.md](./05-enrich-events.md) | 抓取活动页面 + AI 校准数据指纹（档位/交易量/入金门槛） |

## ⚠️ 数据规范

1. **禁止手拼 URL**：所有活动链接只从 `event.link` 字段或 TG 原文 (`raw_messages.text`) 中提取，**绝不手动构造/推断 URL 路径**。不同交易所 URL 格式差异大（slug、query 参数、多级路径），拼接必出错。
2. **测试用真实数据**：做可行性验证时，必须先从数据库查出真实链接再测试，不要用假数据。
3. **链接去注册化**：抓取前过滤掉注册/邀请链接（`/register`, `/signup`, `/invite`, `/referral`），只保留活动详情页。

## 项目位置
`c:\Users\xtt\Desktop\ai 施工\活动整理`

## 架构概览
```
[Backfill] backfill_all.py  ←── 默认增量，--full 全量
       ↓ 写入
    Supabase (raw_messages)
       ↓
[AI整合] summarizer.py (GPT-5.4 via Batch API, 半价)
       ↓ 结构化 JSON
    Supabase (summaries)
       ↓
[Enrich] enrich_events.py ←── 抓取活动页面 + AI 优化
       ↓
[审核] reviewer.py ←── 必做
       ↓
[报告] generate_word.py → Word 文档
       ↓
[展示] web/ (Next.js) + Google Sheets (Apps Script)
```

## ⚠️ AI 幻觉防御（重要经验）
- **禁止 AI 猜测日期**：SYSTEM_PROMPT 中已明确约束，消息无日期时必须输出 null
- **根因**：574 条消息分 8 batch，某个 batch 可能只看到活动名但没日期，AI 会瞎编 `2026-12-31`
- **merge_events**：end_date 跳跃 >60 天拒绝合并，防止 AI 幻觉值被保留
- **validate_dates**：只做检测告警，不自动修正（用 exchange 级别 max date 修正会跨活动改错）
- **rounds 版本追踪**：合并时记录每一轮的 start/end/sources，日期差 ≤5 天视为同一轮合并 sources
- **过期兜底**：没有 end_date 且 start_date 超过 30 天 → 自动标为 expired；没有 start_date 和 end_date → 也标为 expired（防止老活动被误判为 active）
- **活动延期规则**：消息标注 extended/延期/续期 + 新日期 → AI 正常提取该活动，用新日期替代旧日期，设 `is_extended: true`。merge_events 自动合并为 rounds
  - ⚠️ 此规则必须放在 SYSTEM_PROMPT **最前面**独立 section（`## ⚠️ CRITICAL`），否则会被 AI 忽略
  - ⚠️ 必须给 **few-shot example**（用真实 Tapbit 延期消息做示例），抽象规则 AI 不执行
  - ⚠️ 加 "严禁跳过" 等强制语气

## 🔧 提示词优化经验
- **规则优先级**：重要规则放 SYSTEM_PROMPT 最前面，AI 对靠前内容遵循度高
- **Few-shot > 抽象规则**：给具体示例比写规则有效 10 倍，AI 对 "禁止忽略" 之类抽象指令遵循度低，对 "看到这条消息→输出这个JSON" 的示例遵循度高
- **独立 section**：关键规则不要混在其他规则堆里，单独 `## ⚠️ CRITICAL` section
- **验证方式**：检查 `source_links` 是否包含目标消息的 TG 链接，判断 AI 是否真正读取了该消息

## 📐 活动同一性判定规则

### 后端 merge_events（`summarizer.py`）
- **链接归一化合并**（优先级最高）：同 exchange + 链接归一化后相同 → 同一活动
  - 归一化规则：去协议 → 去 www → 去语言路径(`/en-US/`) → 去月份后缀(`-Feb/-Mar`) → 去推广参数(`inviteCode/ru/vipCode/qrType/invite_code/ref`)
  - 保留业务参数（如 `id=`），避免不同活动误合并
  - 已验证：Toobit(`Starter-Bonuses-Feb/Mar` ✅合并)、WEEX(`vipCode`不同 ✅合并)、BYDFi(`id`不同 ✅不合并)
- **数值指纹合并**：同 exchange + ≥100 数值指纹重叠 ≥90% → 同一活动
- 合并时取 max(end_date)，记录每轮到 `rounds` 数组

### 后端 find_version_pairs（版本对比）
- **粗匹配**：①链接去推广参数后相同 ②同 exchange+type+名称相似度≥0.7 ③同 exchange+type 且唯一
- **三字段指纹**：requirements / reward / target_volume 提取数字对比
  - 0 变 = `same` | 1-2 变 = `updated`（版本迭代） | 3 全变 = `different`（不同活动）

### 前端 deduplicateVersions（`Dashboard.tsx`）
- 按 `exchange.toLowerCase() + type` 分组
- **日期重叠** → 并行活动，独立卡片（如 FameEX 三个并行活动）
- **日期连续/不重叠** → 迭代版本，链为 CURRENT + HISTORY
- **所有旧版本保留为 history**（不再按 reward 相似度丢弃）

## 🎯 前端展示规则
- 卡片排序：**交易所名 → end_date**（同交易所活动紧挨）
- 日期显示：取最新 round 的日期，多轮时显示 `N轮` 标签（点击展开详情）
- 已结束活动：显示 TG 溯源 + 查看原帖按钮
- HISTORY 版本：显示 TG/原帖按钮 + 过期/被替换标签

### 已结束活动卡片来源
已结束活动区域包含两类来源：
1. **独立的 expired series** — 被 deduplicateVersions 分为独立组的过期活动
2. **活跃 series 的 history** — 从进行中活动的历史版本中提取的已过期条目

### 过期卡片点击详情逻辑
- **有 parentSeries**（从 history 派生）→ 打开父 series
- **独立 expired series** → 动态查找同交易所+同类型的进行中 series，优先打开它
- **无关联活动** → 正常显示自身

确保详情面板的 CURRENT 始终显示进行中活动，HISTORY 显示过期版本，不会颠倒。

### 审核模式
已结束活动卡片也支持审核模式的选择框，可跨进行中/已结束活动进行合并操作。

## 🔍 Enrich 数据指纹提取

enrich 的核心目标是从活动页面提取/校准数值指纹，而非生成文字描述。

### 允许写入的字段（白名单）
| 字段 | 说明 |
|------|------|
| `reward` | 档位表（含 `{{d:}}` `{{v:}}` `{{b:}}` 标注） |
| `min_deposit` | 最低入金门槛 (USDT) |
| `max_reward` | 最高可获赠金 |
| `target_volume` | 最高档所需交易量 |
| `loss_offset` | 亏损抵扣百分比 (0-100) |
| `bonus_validity_days` | 赠金有效天数 |
| `commission_rate` | 手续费率 |

### 已废弃字段（不再输出）
`tips`, `withdrawal_condition`, `bonus_type` — 内容和 requirements 重复，浪费 token

### 数据同步
`enrich_events.py` 读取 `active_events` + `expired_events` 合并后做 enrich，优化完同步回 `active_events`、`expired_events`、`events` 三个字段。
