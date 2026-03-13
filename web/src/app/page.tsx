import { supabase, parseSummary } from "@/lib/supabase";
import Dashboard from "@/components/Dashboard";
import ThemeToggle from "@/components/ThemeToggle";

async function getLatestSummary() {
  const { data, error } = await supabase
    .from("summaries")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) return null;
  return parseSummary(data[0]);
}

export default async function Home() {
  const summary = await getLatestSummary();

  if (!summary) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <ThemeToggle />
        <div className="text-center">
          <p className="text-2xl text-gray-600">暂无数据</p>
          <p className="text-sm text-gray-700 mt-2">运行 summarizer.py 生成第一份活动整合</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <ThemeToggle />
      <Dashboard
        events={summary.events}
        activeEvents={summary.activeEvents}
        expiredEvents={summary.expiredEvents}
        summaryText={summary.summaryText}
        timeRangeStart={summary.time_range_start}
        timeRangeEnd={summary.time_range_end}
        createdAt={summary.created_at}
      />
    </>
  );
}
