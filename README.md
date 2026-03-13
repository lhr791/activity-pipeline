# 活动整理 Pipeline

竞品交易所活动自动化采集 + AI 分析 + 人工审核的完整工作流。

## 📖 项目介绍

### 这个工具做什么？
自动从 6 个 Telegram 频道实时采集 20+ 家竞品交易所的赠金活动信息，经过 AI 整合去重后，生成结构化报告供团队使用。

### 完整流程

```
┌─────────────────────────────────────────────────────────┐
│  第一阶段：数据采集                                       │
│  Telegram 6个频道 → 自动拉取消息 → 存入 Supabase 数据库    │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  第二阶段：AI 整合（GPT-5.4）                             │
│  多频道消息去重 → 识别交易所 → 提取活动规则 → 结构化数据     │
│  自动处理：韩语/英语翻译、日期解析、档位提取、活动合并       │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  第三阶段：活动页面抓取（Playwright + GPT-4o-mini）        │
│  打开活动链接 → 抓取页面内容 → AI 校准/补全规则数据         │
│  支持 SPA 页面、反爬虫绕过                                │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  第四阶段：人工审核（前端仪表盘）                           │
│  浏览器打开 localhost:3000 →                              │
│  · 按交易所筛选活动                                       │
│  · 查看 TG 原始消息来源                                   │
│  · 确认/修改/删除活动                                     │
│  · 合并重复活动                                           │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  第五阶段：输出                                           │
│  · Word 报告（竞品活动对比表，直接发给领导）                │
│  · 赠金机制规则汇总（各交易所赠金怎么用/怎么扣/怎么回收）   │
│  · JSON 数据（供程序化分析）                               │
└─────────────────────────────────────────────────────────┘
```

### 支持的交易所
LBank, Tapbit, BitMart, WOOX Pro, OrangeX, Toobit, XT, BTCC, VOOX, Zoomex, Deepcoin, Picol, OurBit, Phemex, FameEX, BYDFI, Hotcoin, WEEX, Bitrue, KuCoin 等 20+ 家

---


## 🚀 新电脑部署（从零开始）

### 第 1 步：安装 Python

1. 打开 https://www.python.org/downloads/
2. 点 **Download Python 3.x.x**
3. 运行安装程序，**⚠️ 必须勾选底部的 "Add Python to PATH"**
4. 一路 Next 完成安装

验证：打开 PowerShell（按 Win+X 选 "终端"），输入：
```
python --version
```
看到 `Python 3.11.x` 就对了。

### 第 2 步：安装 Git

1. 打开 https://git-scm.com/downloads
2. 下载 Windows 版，一路 Next 安装

### 第 3 步：下载代码

打开 PowerShell，复制粘贴以下命令：
```powershell
cd ~/Desktop
git clone https://github.com/lhr791/activity-pipeline.git
cd activity-pipeline
```

### 第 4 步：安装依赖

```powershell
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
playwright install chromium
```

> 看到 `(venv)` 出现在命令行开头就说明虚拟环境激活了

### 第 5 步：配置 API Key

```powershell
copy .env.example .env
notepad .env
```

在记事本里填入以下内容（找管理员要）：
```
OPENAI_API_KEY=sk-...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=eyJ...
TG_API_ID=12345678
TG_API_HASH=abc123...
```
保存关闭。

### 第 6 步：首次登录 Telegram

```powershell
.\venv\Scripts\python.exe backfill.py
```

首次运行会要求：
1. 输入手机号（+86 格式）
2. 输入 Telegram 收到的验证码
3. 登录成功后自动生成 `tg_session.session` 文件，以后不再需要

### 第 7 步：加入 Telegram 频道

新账号需要先加入以下 6 个频道，否则无法读取消息：

| 频道 | 加群链接 |
|------|---------|
| Coinscalper Channel | https://t.me/coinscalper_1199 |
| 증정금 No1 레드터틀 채널 | https://t.me/redturtle7777 |
| Dalchuni Crypto Events | https://t.me/dalchuni2 |
| Global Loha(Crypto Event) | https://t.me/lowriskcoin |
| Redturtle_Global_Events | https://t.me/Global_redturtle |
| Global Exchange Event Summary | https://t.me/global_exchange_event |

---

## 📋 日常使用

每次使用前先激活虚拟环境：
```powershell
cd ~/Desktop/activity-pipeline
.\venv\Scripts\activate
```

### 一键跑全流程
```powershell
python run_pipeline.py
```

### 分步运行
```powershell
# 1. TG 数据回填
python backfill_all.py

# 2. AI 整合消息（~$0.5，用 GPT-5.4）
python summarizer.py

# 3. 活动页面抓取 + AI 补全（~$0.04）
python enrich_events.py

# 4. 生成 Word 报告
python generate_word.py

# 5. 赠金机制规则提取（~$0.008）
python bonus_rules.py --bonus-rules
```

### 查看结果
报告输出在 `output/` 文件夹里，包括 `.docx` 和 `.json` 文件。

---

## 🖥️ 前端仪表盘（活动审核 / 管理）

### 首次安装
需要先装 **Node.js 18+**：https://nodejs.org/

```powershell
cd web
npm install
```

### 启动
```powershell
cd web
npm run dev
```

浏览器打开 **http://localhost:3000**，可以：
- 📊 查看所有活动数据（按交易所筛选）
- ✅ 人工审核活动（确认/修改/删除）
- 🔀 合并重复活动
- 📝 查看 TG 原始消息来源

> 数据存在 Supabase 云端，多台电脑用同一个 `.env` 配置就能看到相同数据

---

## 🤖 AI 助手（Antigravity Skill）

如果你用的是 Antigravity AI 编程助手，本项目自带 skill 文件，AI 可以自动理解整个 pipeline。

### 使用方式
- 输入 `/activity-pipeline` 即可让 AI 按标准流程执行
- AI 会自动识别 `.agents/skills/tg-activity-pipeline/` 下的步骤文档

### Skill 步骤文档
| 文件 | 内容 |
|------|------|
| `SKILL.md` | 总览：完整 pipeline 流程说明 |
| `01-tg-reading.md` | TG 数据采集 |
| `02-data-cleaning.md` | AI 整合去重 |
| `03-activity-dashboard.md` | 前端仪表盘使用 |
| `04-google-sheets-sync.md` | Google Sheets 同步 |
| `05-enrich-events.md` | 活动页面抓取 + 赠金规则 |

---

## 📁 文件说明

| 文件 | 用途 |
|------|------|
| `run_pipeline.py` | 一键跑全流程 |
| `summarizer.py` | AI 整合 TG 消息 |
| `enrich_events.py` | 抓取活动页 + AI 补全 |
| `bonus_rules.py` | 赠金机制规则提取 |
| `generate_word.py` | 生成 Word 报告 |
| `backfill.py` | TG 历史消息回填 |
| `utils.py` | 公共工具 |
| `web/` | 前端仪表盘（Next.js） |
| `.env` | API Key 配置（**不要泄露**） |
| `output/` | 报告输出目录 |

## 💰 费用
全流程一次 ≈ **$0.5~1**（主要是 summarizer 用 GPT-5.4）

