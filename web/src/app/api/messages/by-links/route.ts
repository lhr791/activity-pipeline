import { supabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

/**
 * GET /api/messages/by-links?links=https://t.me/c/123/456,https://t.me/c/123/789
 * 
 * 从 source_links 解析 chat_id + message_id，反查 raw_messages 表。
 */
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const linksParam = searchParams.get("links");

    if (!linksParam) {
        return NextResponse.json({ error: "links parameter required" }, { status: 400 });
    }

    const links = linksParam.split(",").filter(Boolean);
    
    // 解析 TG 链接: https://t.me/c/{internal_id}/{msg_id}
    // internal_id 需要转换回 chat_id: -100{internal_id}
    const conditions: { chat_id: number; message_id: number }[] = [];
    
    for (const link of links) {
        const match = link.match(/\/c\/(\d+)\/(\d+)/);
        if (match) {
            conditions.push({
                chat_id: -parseInt(`100${match[1]}`),
                message_id: parseInt(match[2]),
            });
        }
    }

    if (conditions.length === 0) {
        return NextResponse.json([]);
    }

    // 用 OR 查询所有匹配的消息
    const orFilter = conditions.map(
        c => `and(chat_id.eq.${c.chat_id},message_id.eq.${c.message_id})`
    ).join(",");

    const { data, error } = await supabase
        .from("raw_messages")
        .select("id, chat_id, message_id, sender_name, text, sent_at")
        .or(orFilter)
        .order("sent_at", { ascending: false })
        .limit(20);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
}
