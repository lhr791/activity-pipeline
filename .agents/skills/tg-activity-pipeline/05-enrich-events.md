# 05 - 活动页面抓取优化 (Enrich Events)

## 概述

从 TG 原文和 `event.link` 中提取活动详情页真实 URL，HTTP 抓取页面内容，用 DeepSeek 二次优化赠金规则等描述字段。

## 执行命令
```powershell
cd "c:\Users\xtt\Desktop\ai 施工\活动整理"

# 完整运行（抓取 + AI 优化 + 更新 Supabase）
.\venv\Scripts\python.exe enrich_events.py

# 只抓取页面不调用 AI（调试用）
.\venv\Scripts\python.exe enrich_events.py --dry
```

## 核心逻辑

1. 读取 `summaries` 表最新 events
2. 通过 `source_links` 反查 `raw_messages.text`，提取真实活动 URL
3. HTTP 抓取页面内容（`verify=False` 兼容 SSL 问题）
4. 发 DeepSeek 优化：赠金规则、提现条件、bonus_type、tips 等
5. 合并回 events → 更新 summaries 表

> ⚠️ **绝不手拼 URL**。所有链接只从 `event.link` 或 TG 原文中提取。

## 抓取覆盖率

| 交易所 | HTTP 抓取 | 备注 |
|--------|----------|------|
| Phemex | ✅ | 完整规则+条款 |
| Bitrue | ✅ | 完整 |
| BitMart | ✅ | 完整 |
| LBank | ✅ | 需 `verify=False` |
| Deepcoin | ✅ | 完整 |
| WOOX Pro | ✅ | 内容较少但可用 |
| Picol | ✅ | 完整 |
| KuCoin | ✅ | 完整 |
| WEEX | ✅ | 完整 |
| OurBit | ⚠️ | SPA，内容少 |
| Toobit | ❌ | SPA 空壳 |
| BYDFi | ❌ | SPA 空壳 |
| Hotcoin (m.) | ❌ | 移动版 SPA |
| BTCC | ❌ | SPA 空壳 |
| VOOX | ❌ | SPA 空壳 |

## 关键配置

| 配置项 | 值 | 说明 |
|--------|---|------|
| `MAX_PAGES_PER_EVENT` | 2 | 每个活动最多抓 2 个页面 |
| `MAX_CONTENT_LENGTH` | 5000 | 每页最多保留字符数 |
| `REQUEST_TIMEOUT` | 15s | HTTP 请求超时 |
| `ALLOWED_DOMAINS` | 25+ | 白名单域名 |

## 流程位置

步骤 3.5：AI 整合之后、人工审核之前。
