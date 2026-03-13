import { NextResponse } from "next/server";

export async function POST(req: Request) {
    const { text } = await req.json();

    if (!text || typeof text !== "string") {
        return NextResponse.json({ error: "text required" }, { status: 400 });
    }

    const apiKey = process.env.DEEPSEEK_API_KEY;
    const baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";

    if (!apiKey) {
        return NextResponse.json({ error: "DEEPSEEK_API_KEY not set" }, { status: 500 });
    }

    try {
        const resp = await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model: "deepseek-chat",
                messages: [
                    {
                        role: "system",
                        content:
                            "你是一个翻译助手。将用户发来的文字翻译为简体中文。保留原文的格式（换行、列表、符号等）。如果原文已经是中文，直接原样返回。只输出翻译结果，不要加任何解释。",
                    },
                    { role: "user", content: text },
                ],
                temperature: 0.1,
                max_tokens: 4096,
            }),
        });

        const data = await resp.json();
        const translated = data.choices?.[0]?.message?.content || text;
        return NextResponse.json({ translated });
    } catch {
        return NextResponse.json({ translated: text });
    }
}
