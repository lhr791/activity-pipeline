# 活动整理 Pipeline

从 Telegram 频道自动采集竞品交易所活动信息，AI 整合去重，生成 Word 报告。

## 快速部署

### 前提条件
- Python 3.11+（[下载](https://www.python.org/downloads/)）
- Node.js 18+（可选，仅前端仪表盘需要）

### 一键安装
```bash
# Windows：双击 setup.bat
# 或者手动：
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # Mac/Linux
pip install -r requirements.txt
playwright install chromium
```

### 配置 .env
复制 `.env.example` 为 `.env`，填入：
```
OPENAI_API_KEY=sk-...          # OpenAI API Key
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_KEY=eyJ...            # Supabase anon key
TG_API_ID=12345678             # Telegram API ID
TG_API_HASH=abc123...          # Telegram API Hash
```

> 首次运行 TG 相关脚本会要求登录 Telegram（输入手机号 + 验证码）

## 使用方法

### 完整流程（一键）
```bash
venv\Scripts\python.exe run_pipeline.py
```

### 分步运行
```bash
# 1. TG 数据回填（首次运行）
venv\Scripts\python.exe backfill_all.py

# 2. AI 整合 TG 消息 → 结构化活动记录（~$0.5，用 GPT-5.4）
venv\Scripts\python.exe summarizer.py

# 3. 抓取活动页面 + AI 补全数据（~$0.04，用 GPT-4o-mini）
venv\Scripts\python.exe enrich_events.py

# 4. 生成 Word 报告
venv\Scripts\python.exe generate_word.py

# 5. 赠金机制规则提取（~$0.008，用 GPT-4o-mini）
venv\Scripts\python.exe bonus_rules.py --bonus-rules
```

### 前端仪表盘（可选）
```bash
cd web
npm install
npm run dev
# 浏览器打开 http://localhost:3000
```

## 文件说明

| 文件 | 用途 |
|------|------|
| `summarizer.py` | AI 整合 TG 多频道消息，去重合并 |
| `enrich_events.py` | 抓取活动页面，AI 补全规则数据 |
| `bonus_rules.py` | 提取赠金机制规则（帮助中心页面） |
| `generate_word.py` | 生成 Word 对比报告 |
| `run_pipeline.py` | 一键跑全流程 |
| `backfill.py` / `backfill_all.py` | TG 历史消息回填 |
| `listener.py` | TG 实时消息监听 |
| `utils.py` | Supabase / OpenAI 客户端初始化 |
| `.env` | API Key 配置（不要泄露！） |
| `output/` | 生成的报告输出目录 |

## 费用估算
全流程跑一次 ≈ **$0.5~1**（主要是 summarizer 用 GPT-5.4）
