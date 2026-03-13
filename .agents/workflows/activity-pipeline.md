---
description: 活动整理标准流程 - 从 TG 拉取到生成报告的完整 6 步流程
---

# 活动整理标准流程

## 前置条件
- 虚拟环境已激活
- `.env` 配置完整（TG API、Supabase、DeepSeek）

## 标准 6 步流程

### 步骤 1-3：拉取 + 导出 + AI 整合

```powershell
cd "c:\Users\xtt\Desktop\ai 施工\活动整理"
// turbo
.\venv\Scripts\python.exe run_pipeline.py
```

默认**增量拉取**（只拉新消息），如需全量：
```powershell
.\venv\Scripts\python.exe run_pipeline.py --full-backfill
```

### 步骤 4：人工审核（必做）

```powershell
.\venv\Scripts\python.exe reviewer.py
```

### 步骤 5：生成 Word 报告

```powershell
// turbo
.\venv\Scripts\python.exe run_pipeline.py --word-only
```

输出：`output/2026.N月 竞品所活动_*.docx`

### 步骤 6：Web 前端展示

```powershell
cd web
npm run dev
```

打开 http://localhost:3000

## 快捷命令参考

| 场景 | 命令 |
|------|------|
| 日常更新（增量，不含Word） | `run_pipeline.py` |
| 全量拉取 | `run_pipeline.py --full-backfill` |
| 跳过拉取只整合 | `run_pipeline.py --no-backfill` |
| 步骤1-3含Word | `run_pipeline.py --with-word` |
| 只生成Word | `run_pipeline.py --word-only` |
| 人工审核 | `reviewer.py` |

## Google Sheets 同步
已通过 Apps Script 自动同步（每小时触发）。
