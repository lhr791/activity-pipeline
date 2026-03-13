# Skill 1: TG 数据读取

从 6 个 Telegram 频道拉取消息 → 存入 Supabase `raw_messages` 表。

## 执行命令
```powershell
cd "c:\Users\xtt\Desktop\ai 施工\活动整理"

# 实时监听（持续运行）
.\venv\Scripts\python.exe listener.py

# 批量拉取所有频道
.\venv\Scripts\python.exe backfill_all.py

# 单频道 backfill
.\venv\Scripts\python.exe backfill.py --chat-id -1002000478651 --limit 100

# 导出原始聊天记录为 Word
.\venv\Scripts\python.exe export_messages.py
```

## 输出

| 文件 | 位置 | 说明 |
|------|------|------|
| 原始聊天记录 | `output/TG原始聊天记录_YYYYMMDD_HHMM.docx` | 按频道分组、时间排序 |

## 监控频道

| Chat ID | 名称 |
|---------|------|
| -1002000478651 | Coinscalper Channel |
| -1003061431387 | 증정금 No1 레드터틀 채널 |
| -1003601907317 | Dalchuni Crypto Events |
| -1002770517188 | Global Loha(Crypto Event) |
| -1003500837149 | Redturtle_Global_Events |
| -1003389965115 | Global Exchange Event Summary |

## 关键文件

| 文件 | 用途 |
|------|------|
| `listener.py` | Telethon 实时监听脚本 |
| `backfill_all.py` | 所有频道批量拉取 |
| `backfill.py` | 单频道 backfill（`--chat-id` + `--limit`） |
| `export_messages.py` | 导出原始消息为 Word |
| `utils.py` | Supabase/TG 客户端配置 |

## 添加新频道
1. 在 `.env` 的 `TARGET_CHAT_IDS` 末尾追加新 ID
2. 更新 `listener.py` 和 `summarizer.py` 中的 `CHANNEL_NAMES` 字典
3. 用 `backfill.py` 拉取历史消息
4. 重启 listener

## 故障排查

| 问题 | 解决方案 |
|------|---------| 
| backfill 卡住 | TG session 过期，删除 `tg_session.session` 重新登录 |
| 导出为空 | 检查 Supabase `raw_messages` 表是否有数据 |
| 频道拉取失败 | 确认 TG 账号已加入该频道 |
| GBK 编码错误 | Windows 终端不支持 emoji，已修复 print 语句 |
