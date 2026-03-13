# 04 - Google Sheets 同步

## 概述

通过 Google Apps Script 将 Supabase 中的活动数据同步到 Google Sheets，实现与前端 Activity Intelligence 看板一致的展示。

## 数据流

```
Supabase summaries 表（最新 summary）
   ↓ 拉取 events JSON
GAS 脚本 deduplicateEvents()  ← 和前端 Dashboard.tsx 同逻辑
   ↓ 按 exchange+type 去重
GAS 脚本 isActive()
   ↓ 分为进行中/已结束
Supabase raw_messages 表
   ↓ 通过 source_links 反查 TG 原文
Google Sheets 写入
```

## 核心机制

### 去重逻辑（对齐前端）

按 `exchange + type` 分组 → 每组按 `end_date` 降序 → 取最新版本。

和前端 `Dashboard.tsx` 的 `deduplicateVersions()` 完全一致。

### TG 原消息匹配

1. 每个 event 有 `source_links` 字段，如 `https://t.me/c/3389965115/16`
2. 解析出 `internal_id=3389965115`, `message_id=16`
3. 反推 `chat_id = -100{internal_id} = -1003389965115`
4. 查 `raw_messages` 表的 `(chat_id, message_id)` 匹配原文
5. 每个活动最多取 2 条原文

**性能**：`raw_messages` 目前 ~548 条，GAS 脚本一次性全量拉到内存用 Map 查找。

### 列结构

| 列 | 字段 | 说明 |
|----|------|------|
| A | 状态 | 进行中 / 已结束 |
| B | 交易所 | `exchange` |
| C | 活动名称 | `event_name` |
| D | 类型 | `type`（中文） |
| E | 活动日期 | `start_date ~ end_date` |
| F | 奖励内容 | `reward`（清除标签） |
| G | 参与条件 | `requirements` |
| H-K | 数值指标 | 最低入金 / 最高奖励 / 亏损抵扣% / 返佣% |
| L-M | 赠金信息 | 赠金类型 / 提现条件 |
| N-O | 限制 | 仅新用户 / 需KYC |
| P | 来源频道 | `sources` |
| Q | 活动链接 | `link` |
| R | TG 原消息 | 从 `raw_messages` 反查 |

### 排序 & 样式

- 进行中排前、已结束排后
- 条件格式：进行中浅绿底色，已结束灰色

## 文件位置

- 脚本：`c:\Users\xtt\Desktop\ai 施工\活动整理\google_sheets_script.js`
- Google Sheets：[共享链接](https://docs.google.com/spreadsheets/d/1LSbuQGsAp47IBpIbjM2iz_SZ6hIlkmKQtF-j6b0wHp0/edit)

## 部署方式

1. 打开 Google Sheets → Extensions → Apps Script
2. 粘贴 `google_sheets_script.js` 全部内容
3. 运行 `syncActivities()`
4. 设置定时触发器（每小时）：Edit → Triggers → Add Trigger

## 更新记录

- **2026-03-11**：大改版 — 移植前端去重逻辑、新增 TG 原消息列、活动日期列、状态排序
- 旧版仅直接输出 summary 中所有 events，无去重、无 TG 原文
