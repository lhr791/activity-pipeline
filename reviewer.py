import json
import sys
import io
from utils import get_supabase

# 强制设置控制台输出编码为 utf-8，解决 Windows 下的 emoji 报错
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def main():
    db = get_supabase()
    # 获取最新的一条 summary 记录
    r = db.table("summaries").select("*").order("created_at", desc=True).limit(1).execute()
    if not r.data:
        print("没有找到 AI 汇总的数据，请先运行数据抓取和整合！")
        return
        
    summary_id = r.data[0]['id']
    summary_data = json.loads(r.data[0]['summary'])
    events = summary_data.get('events', [])
    
    # 按照 exchange 分组显示
    exchanges = {}
    for i, ev in enumerate(events):
        ex = ev.get('exchange', 'Unknown').lower().strip()
        if ex not in exchanges:
            exchanges[ex] = []
        exchanges[ex].append((i, ev))
        
    print("\n" + "="*50)
    print("🚀 交易所活动人工审核工具")
    print("="*50)
    print("你可以按交易所逐个审核活动。可用命令：")
    print("  [d ID]       : 删除指定活动 (例如: d 3)")
    print("  [d ID1 ID2]  : 批量删除多个 (例如: d 3 4 5)")
    print("  [m SRC DST]  : 将 SRC 合并到 DST，保留 DST，合并TG链接 (例如: m 3 5)")
    print("  [n]          : 下一个交易所 / 跳过")
    print("  [q]          : 保存更改并退出该工具")
    print("="*50 + "\n")
    
    to_delete = set()
    to_merge = {} # src -> dst
    
    for ex, ev_list in exchanges.items():
        if not ev_list: continue
        
        while True:
            # 过滤掉已标记操作的
            current_list = [(idx, ev) for idx, ev in ev_list if idx not in to_delete and idx not in to_merge]
            if not current_list:
                break
                
            print(f"\n>>> 🏢 【{ex.upper()}】 待审核活动:")
            for idx, ev in current_list:
                status_icon = "🟢进行中" if ev.get("status") == "active" else "🔴已过期"
                name = ev.get("event_name", "未命名")
                reward = str(ev.get("reward", ""))[:60].replace("\n", "")
                date_range = f"{ev.get('start_date', '?')} ~ {ev.get('end_date', '?')}"
                print(f"  [{idx}] {status_icon} | {name} ({date_range})")
                print(f"      奖励摘要: {reward}...")
            
            cmd = input(f"\n[{ex.upper()}] 请输入命令 (d/m/n/q): ").strip().lower()
            if cmd == 'q':
                save_and_exit(db, summary_id, summary_data, events, to_delete, to_merge)
                return
            elif cmd == 'n' or cmd == '':
                break
            elif cmd.startswith('d '):
                try:
                    target_ids = [int(x) for x in cmd.split(' ')[1:] if x.isdigit()]
                    for tid in target_ids:
                        if any(idx == tid for idx, _ in current_list):
                            to_delete.add(tid)
                            print(f"✅ 已标记删除 [{tid}]")
                        else:
                            print(f"❌ 无效ID: {tid}")
                except Exception as e:
                    print("❌ 格式错误，例如: d 3 或者 d 3 4")
            elif cmd.startswith('m '):
                try:
                    parts = cmd.split(' ')
                    src_id = int(parts[1])
                    dst_id = int(parts[2])
                    if any(idx == src_id for idx, _ in current_list) and any(idx == dst_id for idx, _ in current_list):
                        if src_id == dst_id:
                            print("❌ 不能合并自己")
                        else:
                            to_merge[src_id] = dst_id
                            print(f"✅ [{src_id}] 将被保留 TG 链接并合并到 [{dst_id}]")
                    else:
                        print("❌ 无效ID")
                except Exception as e:
                    print("❌ 格式错误，例如: m 3 5")
            else:
                print("❌ 未知命令")

    save_and_exit(db, summary_id, summary_data, events, to_delete, to_merge)

def save_and_exit(db, summary_id, summary_data, events, to_delete, to_merge):
    if not to_delete and not to_merge:
        print("\n✨ 没有进行任何修改，已退出。")
        return

    # 处理合并
    for src_id, dst_id in to_merge.items():
        src_ev = events[src_id]
        dst_ev = events[dst_id]
        
        # 合并 sources 和 source_links
        # 注意去重
        merged_sources = list(dict.fromkeys(dst_ev.get("sources", []) + src_ev.get("sources", [])))
        merged_links = list(dict.fromkeys(dst_ev.get("source_links", []) + src_ev.get("source_links", [])))
        
        dst_ev["sources"] = merged_sources
        dst_ev["source_links"] = merged_links
        events[dst_id] = dst_ev
        
        to_delete.add(src_id) # 源活动在合并后被删除
        
    # 处理删除
    new_events = [ev for i, ev in enumerate(events) if i not in to_delete]
    
    summary_data['events'] = new_events
    
    print(f"\n💾 正在保存更新到数据库... (共清理了 {len(to_delete)} 个冗余活动)")
    
    # 将更新后的 summary 写回数据库
    db.table("summaries").update({
        "summary": json.dumps(summary_data, ensure_ascii=False)
    }).eq("id", summary_id).execute()
    
    print("✅ 保存成功！请运行 \033[92mpython generate_word.py\033[0m 生成最干净的 Word 报告。")

if __name__ == "__main__":
    main()
