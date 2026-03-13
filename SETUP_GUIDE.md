# TG 币圈活动整合工具 — 部署指南

## 0. 前置条件

| 工具 | 版本 | 安装 |
|------|------|------|
| Python | 3.11+ | [python.org](https://www.python.org/downloads/) |
| Node.js | 18+ | [nodejs.org](https://nodejs.org/) |
| Git | 任意 | [git-scm.com](https://git-scm.com/) |

## 1. 拿到代码

让我把项目发你（压缩包 / U盘 / Git），解压到任意目录。

> **注意**：不要直接复制 `venv/`、`node_modules/`、`__pycache__/`、`.next/`，这些在你本地重新生成。

## 2. 配置环境变量

### 2.1 Python 后端 `.env`

```bash
cp .env.example .env
```

打开 `.env`，填入以下内容：

| 变量 | 怎么拿 | 备注 |
|------|--------|------|
| `TG_API_ID` | [my.telegram.org](https://my.telegram.org) → API development tools | 用你自己的 TG 账号申请 |
| `TG_API_HASH` | 同上 | - |
| `TG_PHONE` | 你的手机号，带国际区号 | 如 `+8613812345678` |
| `SUPABASE_URL` | 已填好，不用改 | 共用同一个 Supabase 项目 |
| `SUPABASE_SERVICE_ROLE_KEY` | 找我要 | ⚠️ 不要泄露 |
| `OPENAI_API_KEY` | [DeepSeek](https://platform.deepseek.com/) 注册拿 key | 或用我的（找我要） |
| `OPENAI_BASE_URL` | 已填好 `https://api.deepseek.com` | - |
| `TARGET_CHAT_IDS` | 已填好，不用改 | 监听的 TG 频道 |

### 2.2 前端 `web/.env.local`

在 `web/` 目录下创建 `.env.local`：

```env
NEXT_PUBLIC_SUPABASE_URL=https://lunwwthueinnokzpwkig.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=找我要
DEEPSEEK_API_KEY=同上面的 OPENAI_API_KEY
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

## 3. 安装依赖

### 3.1 Python

```powershell
# 在项目根目录
python3 -m venv venv
.\venv\Scripts\activate        # Windows
# source venv/bin/activate     # Mac/Linux

python3 -m pip install -r requirements.txt
```

### 3.2 前端

```powershell
cd web
npm install
```

## 4. 首次运行 — Telegram 登录

```powershell
.\venv\Scripts\python.exe listener.py
```

首次运行会在终端提示你输入：
1. **手机号**（和 `.env` 里的 `TG_PHONE` 一致）
2. **验证码**（TG 会发到你手机上）
3. 如果开了两步验证，还会要密码

登录成功后会在目录下生成 `tg_session.session` 文件，**以后不需要再登录**。

> ⚠️ `tg_session.session` 相当于你的 TG 登录凭证，**不要给别人**。

## 5. 日常使用

### 启动监听（后台一直跑）

```powershell
.\venv\Scripts\python.exe listener.py
```

会实时把监听频道的消息写入 Supabase `raw_messages` 表。

### 手动触发整合

```powershell
.\venv\Scripts\python.exe summarizer.py --once
```

把未处理的消息喂给 DeepSeek，生成结构化活动数据写入 `summaries` 表。

### 查看最新摘要

```powershell
.\venv\Scripts\python.exe view_summary.py --latest
```

### 查看待处理消息数

```powershell
.\venv\Scripts\python.exe view_summary.py --pending
```

### 补拉历史消息

```powershell
.\venv\Scripts\python.exe backfill.py --chat-id <CHAT_ID> --limit 50
```

### 启动前端仪表盘

```powershell
cd web
npm run dev
# 浏览器打开 http://localhost:3000
```

## 6. 注意事项

1. **Telegram 账号**：你需要用**自己的 TG 账号**登录，因为每个 session 绑定一个用户
2. **Supabase 共用**：数据库是共用的，listener 写入的数据大家都能看到
3. **DeepSeek Key**：可以自己注册一个，也可以用我的；如果共用要注意额度
4. **listener 要保持运行**：关了就收不到新消息了。建议用 `tmux`/`screen`（Linux）或保持终端窗口开着（Windows）
5. **tg_session.session**：换电脑需要重新登录，不能直接拷贝这个文件（除非同一台电脑同一个账号）

## 7. 目录结构速览

```
.
├── .env                  # 环境变量（需要自己填）
├── .env.example          # 环境变量模板
├── listener.py           # TG 消息监听
├── summarizer.py         # AI 整合
├── run_summarizer.py     # 定时调度
├── view_summary.py       # CLI 查看
├── backfill.py           # 补拉历史
├── get_chat_ids.py       # 查看群/频道 ID
├── utils.py              # 公共配置
├── requirements.txt      # Python 依赖
└── web/                  # Next.js 前端
    ├── .env.local        # 前端环境变量（需要自己填）
    ├── package.json
    └── src/
```
