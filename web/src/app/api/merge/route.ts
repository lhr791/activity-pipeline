import { supabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

interface MergeEvent {
    exchange: string;
    event_name: string;
}

export async function POST(req: Request) {
    try {
        const { main_event, merge_events } = await req.json() as {
            main_event: MergeEvent;
            merge_events: MergeEvent[];
        };

        if (!main_event?.exchange || !merge_events?.length) {
            return NextResponse.json({ error: "main_event and merge_events required" }, { status: 400 });
        }

        // 1. 读最新 summary
        const { data: rows, error: fetchErr } = await supabase
            .from("summaries")
            .select("id, summary")
            .order("created_at", { ascending: false })
            .limit(1);

        if (fetchErr || !rows?.length) {
            return NextResponse.json({ error: fetchErr?.message || "No summary" }, { status: 500 });
        }

        const row = rows[0];
        const summary = typeof row.summary === "string" ? JSON.parse(row.summary) : row.summary;
        const activeEvents: any[] = summary.active_events || [];
        const expiredEvents: any[] = summary.expired_events || [];

        // 2. 用 exchange+event_name 匹配找事件
        const matchKey = (ev: any) => `${(ev.exchange || '').toLowerCase()}::${ev.event_name || ''}`;
        const mainKey = `${main_event.exchange.toLowerCase()}::${main_event.event_name}`;
        const mergeKeys = new Set(merge_events.map(e => `${e.exchange.toLowerCase()}::${e.event_name}`));

        // 在两个数组中找主事件
        let mainEvent = activeEvents.find(e => matchKey(e) === mainKey)
            || expiredEvents.find(e => matchKey(e) === mainKey);

        if (!mainEvent) {
            return NextResponse.json({ error: `Main event not found: ${mainKey}` }, { status: 400 });
        }

        // 找被合并事件
        const toMerge = [
            ...activeEvents.filter(e => mergeKeys.has(matchKey(e))),
            ...expiredEvents.filter(e => mergeKeys.has(matchKey(e))),
        ];

        if (toMerge.length === 0) {
            return NextResponse.json({ error: "No merge events found" }, { status: 400 });
        }

        // 3. 合并 sources / source_links / rounds
        for (const ev of toMerge) {
            mainEvent.sources = [...new Set([...(mainEvent.sources || []), ...(ev.sources || [])])];
            mainEvent.source_links = [...new Set([...(mainEvent.source_links || []), ...(ev.source_links || [])])];

            const mainRounds = mainEvent.rounds || [];
            const evRounds = ev.rounds || [];
            if (evRounds.length > 0) {
                mainRounds.push(...evRounds);
            } else {
                mainRounds.push({ start: ev.start_date, end: ev.end_date, sources: ev.sources });
            }
            mainEvent.rounds = mainRounds;

            if (ev.start_date && (!mainEvent.start_date || ev.start_date < mainEvent.start_date)) {
                mainEvent.start_date = ev.start_date;
            }
            if (ev.end_date && (!mainEvent.end_date || ev.end_date > mainEvent.end_date)) {
                mainEvent.end_date = ev.end_date;
            }
        }

        // 4. 从数组中移除被合并的事件
        summary.active_events = activeEvents.filter(e => !mergeKeys.has(matchKey(e)));
        summary.expired_events = expiredEvents.filter(e => !mergeKeys.has(matchKey(e)));

        // 确保主事件在正确的分组中
        const mainInActive = summary.active_events.some((e: any) => matchKey(e) === mainKey);
        const mainInExpired = summary.expired_events.some((e: any) => matchKey(e) === mainKey);
        if (!mainInActive && !mainInExpired) {
            // 主事件被误删了（它也在 mergeKeys 里），重新加回
            if (mainEvent.status === 'active') {
                summary.active_events.push(mainEvent);
            } else {
                summary.expired_events.push(mainEvent);
            }
        }

        // 5. 写回 Supabase
        const { error: updateErr } = await supabase
            .from("summaries")
            .update({ summary: JSON.stringify(summary) })
            .eq("id", row.id);

        if (updateErr) {
            return NextResponse.json({ error: updateErr.message }, { status: 500 });
        }

        return NextResponse.json({
            success: true,
            active_count: summary.active_events.length,
            expired_count: summary.expired_events.length,
        });

    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        return NextResponse.json({ error: msg }, { status: 500 });
    }
}
