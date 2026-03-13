import json
import streamlit as st
import pandas as pd
from utils import get_supabase

# 设置页面宽屏模式
st.set_page_config(page_title="活动整合审核看板", page_icon="🚀", layout="wide")

# 注入全局 CSS 美化界面
st.markdown("""
    <style>
    /* 缩小整体顶部空白 */
    .block-container {
        padding-top: 2rem;
        padding-bottom: 2rem;
    }
    /* 卡片悬浮和边距优化 */
    div[data-testid="stVerticalBlock"] > div[style*="border-color"] {
        border-radius: 10px !important;
        padding: 1rem !important;
        margin-bottom: 0.5rem !important;
        transition: box-shadow 0.3s ease;
        background-color: #fcfcfc;
    }
    div[data-testid="stVerticalBlock"] > div[style*="border-color"]:hover {
        box-shadow: 0 4px 12px rgba(0,0,0,0.08);
    }
    /* 暗黑模式下卡片背景调整 */
    @media (prefers-color-scheme: dark) {
        div[data-testid="stVerticalBlock"] > div[style*="border-color"] {
            background-color: #1e1e1e;
        }
    }
    /* 弱化小字号标签 */
    .stMarkdown p {
        margin-bottom: 0.5rem;
    }
    /* 调整标题与内容的紧凑度 */
    h4 {
        margin-top: 0 !important;
        padding-top: 0 !important;
        color: #1f77b4;
    }
    </style>
""", unsafe_allow_html=True)

@st.cache_resource
def init_db():
    return get_supabase()

def load_data():
    db = init_db()
    r = db.table("summaries").select("*").order("created_at", desc=True).limit(1).execute()
    if not r.data:
        return None, None
    summary_id = r.data[0]['id']
    summary_data = json.loads(r.data[0]['summary'])
    return summary_id, summary_data

def save_data(summary_id, summary_data):
    db = init_db()
    db.table("summaries").update({
        "summary": json.dumps(summary_data, ensure_ascii=False)
    }).eq("id", summary_id).execute()
    st.success("✅ 数据已保存到 Supabase！")

def main():
    st.title("🚀 交易所活动整合审核看板")
    
    # 状态初始化
    if 'summary_id' not in st.session_state:
        summary_id, summary_data = load_data()
        if not summary_id:
            st.error("❌ 数据库中未找到活动汇总数据，请先运行数据抓取。")
            return
        st.session_state.summary_id = summary_id
        st.session_state.summary_data = summary_data
        st.session_state.events = summary_data.get('events', [])

    events = st.session_state.events
    
    # 获取所有的交易所
    exchanges = sorted(list(set([ev.get('exchange', 'Unknown').strip().upper() for ev in events])))
    
    # Sidebar 侧边栏
    st.sidebar.header("🏢 筛选器")
    selected_ex = st.sidebar.selectbox("选择交易所进行审核", ["全部"] + exchanges)
    status_filter = st.sidebar.radio("活动状态", ["全部", "active (进行中)", "expired (已过期)"])
    
    st.sidebar.markdown("---")
    st.sidebar.info("操作说明：\n1. 点击活动卡片右侧的『删除』直接移除该版本。\n2. 或者选择并入其他活动ID，保存原始TG链接。")
    if st.sidebar.button("💾 手动保存全量数据", type="primary"):
        save_data(st.session_state.summary_id, st.session_state.summary_data)

    # 过滤当前要显示的活动
    filtered_indices = []
    for i, ev in enumerate(events):
        ex = ev.get("exchange", "Unknown").upper()
        status = ev.get("status", "")
        
        if selected_ex != "全部" and ex != selected_ex:
            continue
        if status_filter == "active (进行中)" and status != "active":
            continue
        if status_filter == "expired (已过期)" and status != "expired":
            continue
            
        filtered_indices.append(i)

    if not filtered_indices:
        st.info("该筛选条件下没有活动。")
        return

    # 按交易所名称排序显示
    filtered_indices.sort(key=lambda idx: events[idx].get("exchange", "Unknown").upper())

    st.subheader(f"共找到 {len(filtered_indices)} 个活动记录")

    # 遍历显示卡片
    for idx in filtered_indices:
        ev = events[idx]
        is_active = (ev.get("status") == "active")
        status_text = "🟢 进行中" if is_active else "🔴 已过期"
        
        with st.container(border=True):
            col1, col2 = st.columns([3, 1])
            
            with col1:
                st.markdown(f"#### [{idx}] {status_text} | {ev.get('event_name', '未命名')} ({ev.get('exchange', 'Unknown')})")
                st.caption(f"📅 活动时间：{ev.get('start_date', '?')} ~ {ev.get('end_date', '?')}")
                st.markdown(f"**💰 奖励：** {ev.get('reward', '无详细说明')}")
                
                # 计算与前面其他同交易所活动的相似度，给出变更提示
                import re as _re
                def _get_nums(text):
                    nums = set()
                    for n in _re.findall(r'[\d,]+', str(text)):
                        c = n.replace(',', '')
                        if c.isdigit() and 2 <= len(c) <= 10:
                            nums.add(int(c))
                    return nums

                my_nums = _get_nums(ev.get('reward','')) | _get_nums(ev.get('target_volume',''))
                if my_nums:
                    best_match = None
                    best_ratio = 0
                    for other_idx in range(len(events)):
                        if other_idx == idx: continue
                        other_ev = events[other_idx]
                        if other_ev.get('exchange','').upper() != ev.get('exchange','').upper(): continue
                        
                        other_nums = _get_nums(other_ev.get('reward','')) | _get_nums(other_ev.get('target_volume',''))
                        if other_nums:
                            ov = my_nums & other_nums
                            un = my_nums | other_nums
                            r = len(ov)/len(un) if un else 0
                            if r > best_ratio:
                                best_ratio = r
                                best_match = (other_idx, other_ev)
                                
                    if best_ratio >= 0.6 and best_match:
                        other_idx, other_ev = best_match
                        st.warning(f"💡 **疑似历史更新版本** (数值重合度 {best_ratio:.0%} )：与 **[{other_idx}] {other_ev.get('event_name')}** 高度相似。")
                        
                        # 渲染 Diff 对比
                        import diff_match_patch as dmp_module
                        dmp = dmp_module.diff_match_patch()
                        
                        text_old = str(other_ev.get('reward', ''))
                        text_new = str(ev.get('reward', ''))
                        
                        diffs = dmp.diff_main(text_old, text_new)
                        dmp.diff_cleanupSemantic(diffs)
                        
                        html_diff = ""
                        for op, text in diffs:
                            text = text.replace('\n', '<br>')
                            if op == 1: # 新增
                                html_diff += f'<span style="background-color: #d4edda; color: #155724; font-weight: bold; text-decoration: underline;">{text}</span>'
                            elif op == -1: # 删除
                                html_diff += f'<span style="background-color: #f8d7da; color: #721c24; text-decoration: line-through;">{text}</span>'
                            else: # 保持不变
                                html_diff += f'<span style="color: #6c757d;">{text}</span>'
                                
                        with st.expander("🔍 查看新老版本《奖励细则》文字对比 (红删绿增)"):
                            st.markdown(f'<div style="font-size: 0.9em; line-height: 1.6; border-left: 3px solid #ccc; padding-left: 10px;">{html_diff}</div>', unsafe_allow_html=True)

                # 显示关键指纹
                tips = ev.get('tips', '')
                if tips:
                    st.markdown(f"**⚠️ 避坑：** {tips}")
                source_links = ev.get("source_links", [])
                if source_links:
                    import re as _re
                    best_per_channel = {}
                    for link in source_links:
                        m = _re.search(r'/c/(\d+)/(\d+)', link)
                        if m:
                            chat_id, msg_id = m.group(1), int(m.group(2))
                            if chat_id not in best_per_channel or msg_id > best_per_channel[chat_id][0]:
                                best_per_channel[chat_id] = (msg_id, link)
                        else:
                            best_per_channel[link] = (0, link)
                    display_links = [v[1] for v in best_per_channel.values()]
                    
                    links_md = " | ".join([f"[🔗TG]({l})" for l in display_links])
                    st.markdown(f"**📲 原文链接：** {links_md}")
                elif ev.get('link'):
                    st.markdown(f"**📲 官网链接：** {ev.get('link')}")
                    
            with col2:
                st.markdown("<br>", unsafe_allow_html=True)
                # 删除操作
                if st.button("🗑️ 彻底删除", key=f"del_{idx}", help="直接从数据库中移除此版本", use_container_width=True):
                    # 从列表中移除
                    st.session_state.events.pop(idx)
                    st.session_state.summary_data['events'] = st.session_state.events
                    save_data(st.session_state.summary_id, st.session_state.summary_data)
                    st.rerun()
                
                # 合并操作
                st.markdown("<p style='font-size:0.8em; margin-bottom: 2px; color:gray'>合并到目标 (保留TG来源) :</p>", unsafe_allow_html=True)
                merge_opts = ["(不合并)"] + [f"[{i}] {events[i].get('event_name')}"[:20]+".." for i in range(len(events)) if i != idx and events[i].get('exchange').upper() == ev.get('exchange').upper()]
                merge_target = st.selectbox("", options=merge_opts, key=f"merge_{idx}", label_visibility="collapsed")
                
                if merge_target != "(不合并)" and st.button("🔗 确认并入", key=f"confirm_m_{idx}", type="secondary", use_container_width=True):
                    target_idx = int(merge_target.split("]")[0].replace("[", ""))
                    
                    # 合并 sources 和 source_links
                    target_ev = events[target_idx]
                    merged_sources = list(dict.fromkeys(target_ev.get("sources", []) + ev.get("sources", [])))
                    merged_links = list(dict.fromkeys(target_ev.get("source_links", []) + ev.get("source_links", [])))
                    
                    target_ev["sources"] = merged_sources
                    target_ev["source_links"] = merged_links
                    st.session_state.events[target_idx] = target_ev
                    
                    # 删除原有的
                    st.session_state.events.pop(idx)
                    st.session_state.summary_data['events'] = st.session_state.events
                    save_data(st.session_state.summary_id, st.session_state.summary_data)
                    st.rerun()

if __name__ == "__main__":
    main()
