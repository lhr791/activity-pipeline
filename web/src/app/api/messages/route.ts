import { supabase } from "@/lib/supabase";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const start = searchParams.get("start");
    const end = searchParams.get("end");

    if (!start || !end) {
        return NextResponse.json({ error: "start and end required" }, { status: 400 });
    }

    const { data, error } = await supabase
        .from("raw_messages")
        .select("id, chat_id, message_id, sender_name, text, sent_at")
        .gte("sent_at", start)
        .lte("sent_at", end)
        .order("sent_at", { ascending: true })
        .limit(500);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
}
