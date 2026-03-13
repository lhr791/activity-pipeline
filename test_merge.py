import json, re
from utils import get_supabase

db = get_supabase()
r = db.table("summaries").select("summary").order("created_at", desc=True).limit(1).execute()
data = json.loads(r.data[0]["summary"])

def extract_nums(ev):
    texts = [str(ev.get("reward","")), str(ev.get("requirements","")), str(ev.get("target_volume",""))]
    nums = set()
    for t in texts:
        for n in re.findall(r'[\d,]+', t):
            c = n.replace(",","")
            if c.isdigit() and 2 <= len(c) <= 10:
                nums.add(int(c))
    for k in ["min_deposit","max_reward"]:
        v = ev.get(k)
        if v and isinstance(v,(int,float)) and v > 0:
            nums.add(int(v))
    return nums

keywords = ["新用户入金交易赠金活动", "存款与交易量赠金活动"]
evs = [ev for ev in data.get("events",[]) if "deepcoin" in ev.get("exchange","").lower() and ev.get("event_name","") in keywords]

for i, ev in enumerate(evs):
    nums = extract_nums(ev)
    print(f"#{i+1} {ev.get('event_name')} ({ev.get('start_date','?')} ~ {ev.get('end_date','?')})")
    print(f"  reward: {str(ev.get('reward',''))}")
    print(f"  nums: {sorted(nums)}")
    print()

for i in range(len(evs)):
    for j in range(i+1, len(evs)):
        n1, n2 = extract_nums(evs[i]), extract_nums(evs[j])
        if n1 and n2:
            ov = n1 & n2
            s = min(len(n1), len(n2))
            r = len(ov)/s if s else 0
            merged = "YES" if r >= 0.9 else "NO"
            print(f"  #{i+1} vs #{j+1} -> ratio:{r:.2f} -> merge:{merged}")
