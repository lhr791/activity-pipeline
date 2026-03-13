# Skill 3: 活动整合与前端展示

Next.js 14 研究级仪表盘 + Pipeline 编排 + 数据运维。

## 前端启动
```powershell
cd "c:\Users\xtt\Desktop\ai 施工\活动整理\web"
npm run dev
# 打开 http://localhost:3000
```

## 前端功能

| 功能 | 说明 |
|------|------|
| 详细卡片 | 12+ 字段（赠金类型/有效期/提现条件等） |
| 亏损抵扣分组 | 100%（绿）/ 33-50%（黄）/ 0%（红） |
| 进行中/已结束分区 | 按 end_date 自动分类 |
| 版本对比 | 新旧版本 reward 差异高亮 |
| 语义标注高亮 | 入金(蓝) / 交易量(紫) / 赠金(绿) 发光标记 |
| 对比矩阵 | 最多 3 个活动并排比较 |
| ISR | 60 秒自动刷新 |

### 版本去重逻辑（前端）
1. 同交易所活动按 `type` 分组
2. 按 `end_date` 降序排列
3. `reward` 相同 → 静默覆盖；`reward` 变化 → 旧版进入版本对比弹窗

## Pipeline 三步曲（推荐流程）

1. **拉取 + AI 整合**
   ```powershell
   .\venv\Scripts\python.exe run_pipeline.py
   ```
2. **人工审核（防误杀去重）**
   ```powershell
   .\venv\Scripts\python.exe -m streamlit run web_reviewer.py
   # http://localhost:8501
   ```
3. **导出最终 Word**
   ```powershell
   .\venv\Scripts\python.exe generate_word.py
   ```

## Supabase 项目
- **Project ID**: `lunwwthueinnokzpwkig`
- **URL**: `https://lunwwthueinnokzpwkig.supabase.co`
- **表**: `raw_messages`, `summaries`（public schema，RLS 已启用，anon 可读）

## 数据操作

### 重置全部重新整合
```sql
UPDATE raw_messages SET is_summarized = false;
DELETE FROM summaries;
```

### 查看消息统计
```sql
SELECT chat_id, count(*) as cnt,
       count(*) FILTER (WHERE is_summarized = false) as pending
FROM raw_messages GROUP BY chat_id;
```

## 关键文件

| 文件 | 用途 |
|------|------|
| `web/` | Next.js 14 前端仪表盘 |
| `web/src/components/Dashboard.tsx` | 前端核心组件 |
| `web/src/app/api/messages/route.ts` | 原始消息 API |
| `run_pipeline.py` | Pipeline 编排入口 |
| `view_summary.py` | CLI 查看摘要 |
| `get_chat_ids.py` | 列出群/频道 ID |

## 故障排查

| 问题 | 解决方案 |
|------|---------| 
| listener 断开 | 重启 `listener.py`，session 自动重连 |
| 消息重复入库 | `(chat_id, message_id)` 唯一约束自动跳过 |
| 摘要重复 | `events_are_same()` 对比 exchange+event_name |
| 前端不更新 | ISR 60 秒缓存，等一下或硬刷新 |
