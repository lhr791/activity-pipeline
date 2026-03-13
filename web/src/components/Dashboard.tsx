"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import type { CryptoEvent } from "@/lib/supabase";
import { 
  Trophy, Gift, Users, Activity, Calendar, DollarSign, 
  AlertTriangle, ExternalLink, ShieldCheck, ShieldAlert,
  Shield, CheckSquare, GitCommit, ArrowRight, X, Columns,
  Filter, Layers, Send, FileText, ClipboardCheck, Merge, Check
} from "lucide-react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";


function cn(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

// ── Helpers ──────────────────────────────────────────────────────────────

function parseDate(d: string | null | undefined): number {
    if (!d) return 0;
    return new Date(d.replace(/\//g, "-")).getTime() || 0;
}

function normalizeReward(r: string | null | undefined): string {
    if (!r) return "";
    return r.replace(/[\s，,。；;：:！!？?\n\r]/g, "").toLowerCase();
}

/** 
 * Series represents a specific event lineage (latest version + its history)
 */
interface EventSeries {
    id: string;
    latest: CryptoEvent;
    history: CryptoEvent[];
}

function deduplicateVersions(events: CryptoEvent[]): EventSeries[] {
    const byType = new Map<string, CryptoEvent[]>();
    for (const e of events) {
        // Group by exchange (lowercase) + type
        const key = `${e.exchange.toLowerCase()}_${e.type || "other"}`;
        if (!byType.has(key)) byType.set(key, []);
        byType.get(key)!.push(e);
    }

    const seriesList: EventSeries[] = [];

    for (const [key, group] of byType) {
        if (group.length <= 1) {
            seriesList.push({ id: key, latest: group[0], history: [] });
            continue;
        }
        
        // Sort by dates (newest first)
        group.sort((a, b) => {
            const dB = parseDate(b.end_date) || parseDate(b.start_date);
            const dA = parseDate(a.end_date) || parseDate(a.start_date);
            if (dB !== dA) return (dB - dA);
            return (b.reward?.length || 0) - (a.reward?.length || 0);
        });

        // Separate into: parallel activities (overlapping dates) vs sequential versions
        // If two events' date ranges overlap, they are parallel → separate series
        // If sequential (non-overlapping), they are versions → same series
        const used = new Set<number>();
        
        for (let i = 0; i < group.length; i++) {
            if (used.has(i)) continue;
            const latest = group[i];
            const history: CryptoEvent[] = [];
            used.add(i);

            for (let j = i + 1; j < group.length; j++) {
                if (used.has(j)) continue;
                const older = group[j];
                
                // Check if dates overlap → parallel activity, skip
                const latestStart = parseDate(latest.start_date) || 0;
                const latestEnd = parseDate(latest.end_date) || latestStart;
                const olderStart = parseDate(older.start_date) || 0;
                const olderEnd = parseDate(older.end_date) || olderStart;
                
                const overlaps = olderStart < latestEnd && olderEnd > latestStart;
                
                if (overlaps && olderStart > 0 && latestStart > 0) {
                    // Overlapping dates → different parallel activity, keep separate
                    continue;
                }
                
                // Sequential → version history
                history.push(older);
                used.add(j);
            }

            seriesList.push({ id: `${key}_${i}`, latest, history });
        }
    }
    
    // Global sort: exchange name → end_date (newest first)
    return seriesList.sort((a, b) => {
        const exCmp = a.latest.exchange.toLowerCase().localeCompare(b.latest.exchange.toLowerCase());
        if (exCmp !== 0) return exCmp;
        return parseDate(b.latest.end_date) - parseDate(a.latest.end_date);
    });
}

function extractNumber(text: string | number | undefined | null): number {
    if (typeof text === 'number') return text;
    if (!text) return 0;
    const match = String(text).match(/\d{2,}/g);
    if (!match) return 0;
    return Math.max(...match.map(Number));
}

// ── Categories ───────────────────────────────────────────────────────────

const LOSS_CATEGORIES = [
    { id: "full", label: "真金不怕亏 (100%)", desc: "赠金可 100% 承担穿仓", match: (loss: number) => loss >= 100, color: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/20", activeBg: "bg-emerald-500/20 border-emerald-500/40", icon: ShieldCheck },
    { id: "partial", label: "部分兜底 (33~50%)", desc: "按比例抵扣亏损", match: (loss: number) => loss >= 10 && loss < 100, color: "text-amber-400", bg: "bg-amber-500/10 border-amber-500/20", activeBg: "bg-amber-500/20 border-amber-500/40", icon: ShieldAlert },
    { id: "zero", label: "纸面富贵 (0%)", desc: "坑！亏损优先扣本金", match: (loss: number) => loss === 0, color: "text-rose-400", bg: "bg-rose-500/10 border-rose-500/20", activeBg: "bg-rose-500/20 border-rose-500/40", icon: Shield },
];

// ── UI Components ─────────────────────────────────────────────────────────

function RewardBlock({ text }: { text: string }) {
    if (!text) return null;
    
    // 尝试按照分号区分条件
    const parts = text.split(/(?<=[；;。])\s*/).filter(s => s.trim().length > 0);
    
    // 检查是否大部分片段包含箭头 → 或 =
    const isTableFormat = parts.length > 1 && parts.filter(p => p.includes('→') || p.includes('=>') || p.includes('=')).length >= (parts.length / 2);

    if (isTableFormat) {
        return (
            <div className="mt-2 bg-black/40 border border-white/5 rounded-xl overflow-hidden p-1">
                <table className="w-full text-left text-sm">
                    <tbody>
                        {parts.map((part, i) => {
                            let cond = part;
                            let rew = "";
                            const arrowMatch = part.match(/^(.+?)\s*[→=>]\s*(.+)$/);
                            if (arrowMatch) {
                                cond = arrowMatch[1];
                                rew = arrowMatch[2];
                            }
                            return (
                                <tr key={i} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                                    <td className="py-2 px-3 text-slate-200 text-xs w-2/3">{cond}</td>
                                    <td className="py-2 px-3 text-emerald-400 text-xs font-medium text-right">{rew}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        );
    }

    // 普通长文本：增加行高和段落间距
    return (
        <p className="text-sm text-white leading-relaxed whitespace-pre-wrap">
            {text.replace(/([；;。])\s*/g, "$1\n")}
        </p>
    );
}

// ── Tag-based Semantic Renderer ──────────────────────────────────────
// 解析 AI 生成的语义标注：{{d:入金}} {{v:交易量}} {{b:赠金}}
// 并渲染为对应颜色的发光标记。

const TAG_REGEX = /\{\{([dvb]):(.+?)\}\}/g;

const TAG_CSS: Record<string, string> = {
    d: "vdiff-deposit",
    v: "vdiff-volume",
    b: "vdiff-bonus",
};

/**
 * Detect parallel v/b lists like:
 *   "交易量达 {{v:X}}/{{v:Y}}/{{v:Z}}，分别获得 {{b:A}}/{{b:B}}/{{b:C}} 赠金"
 * and zip them into:
 *   "交易量达 {{v:X}} → {{b:A}}；\n交易量达 {{v:Y}} → {{b:B}}；\n..."
 *
 * Also handles d+v or d+b parallel lists.
 */
function zipParallelTiers(text: string): string {
    // Pattern: (prefix)({{v:X}}/{{v:Y}}/...)(.+?)({{b:A}}/{{b:B}}/...)(suffix)
    // We look for runs of same-type tags separated by / (tags must be adjacent)
    const tagRunRegex = /(\{\{([dvb]):[^}]+\}\}(?:\s*[/／]\s*\{\{\2:[^}]+\}\}){2,})/g;
    
    let result = text;
    const runs: { type: string; start: number; end: number; values: string[] }[] = [];
    let m: RegExpExecArray | null;
    
    while ((m = tagRunRegex.exec(text)) !== null) {
        const tagType = m[2];
        const fullMatch = m[1];
        const values = fullMatch.split(/\s*[/／]\s*/).map(s => s.trim());
        runs.push({ type: tagType, start: m.index, end: m.index + fullMatch.length, values });
    }
    
    // Find pairs of consecutive runs (v then b, or d then b)
    for (let i = 0; i < runs.length - 1; i++) {
        const first = runs[i];
        const second = runs[i + 1];
        if (first.values.length !== second.values.length) continue;
        if (!((first.type === 'v' && second.type === 'b') || 
              (first.type === 'd' && second.type === 'b'))) continue;
        
        // Get the text between the two runs
        const between = text.slice(first.end, second.start);
        // Only zip if the gap is short connector text (like "，分别获得" / "，可获得" etc.)
        if (between.length > 30) continue;
        
        // Get prefix (text before the first run, back to newline or start of section)  
        const beforeFirst = text.slice(0, first.start);
        const prefixMatch = beforeFirst.match(/(?:^|[。\n])([^。\n]*)$/);
        const prefix = prefixMatch ? prefixMatch[1].trim() : '';
        const prefixStart = prefixMatch ? first.start - (prefixMatch[1]?.length || 0) : first.start;
        
        // Get suffix after second run
        const afterSecond = text.slice(second.end);
        const suffixMatch = afterSecond.match(/^([^。；\n]*[。]?)/);
        const suffix = suffixMatch ? suffixMatch[1] : '';
        
        // Build zipped lines
        const lines: string[] = [];
        for (let j = 0; j < first.values.length; j++) {
            lines.push(`${prefix}${first.values[j]} → ${second.values[j]}${suffix.replace(/^[，,\s]+/, '')}`);
        }
        const zipped = lines.join('\n');
        
        // Replace the whole segment
        const fullStart = prefixStart;
        const fullEnd = second.end + suffix.length;
        result = text.slice(0, fullStart) + (prefixMatch && !prefixMatch[1] ? '' : '') + zipped + text.slice(fullEnd);
        // Only handle first pair found per call (re-run if needed)
        break;
    }
    
    return result;
}

/** 渲染带标注的文本，所有 tag 内数值都高亮，多档位自动换行 */
function TaggedText({ text }: { text: string }) {
    const parts = useMemo(() => {
        if (!text) return null;
        // Pre-process: zip parallel v/b lists into paired lines
        let processed = zipParallelTiers(text);
        // 1. After ；(Chinese semicolon) add newline if followed by content
        processed = processed.replace(/；\s*/g, '；\n');
        // 2. Before "档位" keyword, add newline
        processed = processed.replace(/([^\n])档位[：:]/g, '$1\n档位：\n');
        // 3. Before repeated deposit patterns
        processed = processed.replace(/([；。\n])\s*(存款|净入金|入金|净存款|充值|首次入金|首存)/g, '$1\n$2');
        // 4. Before user-type / task section separators
        processed = processed.replace(/([。）])\s*(老用户|新用户|任务\d|阶段\d|活动\d|第[一二三四五六七八九十\d]+[阶步])/g, '$1\n$2');
        // 5. After 。followed by section keywords
        processed = processed.replace(/。\s*(新用户|交易量|累计|额外)/g, '。\n$1');
        // 6. Before numbered items: N) / N）/ （N）/ N. patterns
        processed = processed.replace(/([。；\n])\s*(\d+[)）.]|（\d+）)/g, '$1\n$2');
        // Also handle "包含多个任务：1)" at start
        processed = processed.replace(/[：:]\s*(\d+[)）.]|（\d+）)/g, '：\n$1');

        const result: React.ReactNode[] = [];
        let lastIndex = 0;
        let idx = 0;
        const regex = new RegExp(TAG_REGEX.source, "g");
        let m: RegExpExecArray | null;
        while ((m = regex.exec(processed)) !== null) {
            if (m.index > lastIndex) {
                result.push(<span key={`t${idx}`}>{processed.slice(lastIndex, m.index)}</span>);
            }
            const tag = m[1]; // d/v/b
            const value = m[2]; // the value text
            result.push(
                <span key={`v${idx}`} className={TAG_CSS[tag] || "vdiff-other"}>
                    {value}
                </span>
            );
            lastIndex = m.index + m[0].length;
            idx++;
        }
        if (lastIndex < processed.length) {
            result.push(<span key="tail">{processed.slice(lastIndex)}</span>);
        }
        return result;
    }, [text]);

    return (
        <p className="text-sm text-white leading-relaxed whitespace-pre-wrap">
            {parts}
        </p>
    );
}

/** 对比渲染：先清除 tag 提取数值，对比后仅对变化的值施加荧光 */
function ValueDiffText({ thisText, otherText }: { thisText: string; otherText: string }) {
    // 如果文本包含 tag，提取所有 tag 内的值
    const extractTagValues = (t: string) => {
        const vals: string[] = [];
        const regex = new RegExp(TAG_REGEX.source, "g");
        let m: RegExpExecArray | null;
        while ((m = regex.exec(t)) !== null) vals.push(m[2].trim());
        return vals;
    };

    const thisVals = useMemo(() => extractTagValues(thisText || ""), [thisText]);
    const otherVals = useMemo(() => extractTagValues(otherText || ""), [otherText]);
    const changedVals = useMemo(() => {
        const changed = new Set<string>();
        const maxLen = Math.max(thisVals.length, otherVals.length);
        for (let i = 0; i < maxLen; i++) {
            if (thisVals[i] !== otherVals[i] && thisVals[i]) changed.add(thisVals[i]);
        }
        for (const v of thisVals) {
            if (!otherVals.includes(v)) changed.add(v);
        }
        return changed;
    }, [thisVals, otherVals]);

    const parts = useMemo(() => {
        if (!thisText) return null;
        const result: React.ReactNode[] = [];
        let lastIndex = 0;
        let idx = 0;
        const regex = new RegExp(TAG_REGEX.source, "g");
        let m: RegExpExecArray | null;
        while ((m = regex.exec(thisText)) !== null) {
            if (m.index > lastIndex) {
                result.push(<span key={`t${idx}`}>{thisText.slice(lastIndex, m.index)}</span>);
            }
            const tag = m[1];
            const value = m[2];
            const isChanged = changedVals.has(value.trim());
            result.push(
                <span key={`v${idx}`} className={isChanged ? (TAG_CSS[tag] || "vdiff-other") : undefined}>
                    {value}
                </span>
            );
            lastIndex = m.index + m[0].length;
            idx++;
        }
        if (lastIndex < thisText.length) {
            result.push(<span key="tail">{thisText.slice(lastIndex)}</span>);
        }
        return result;
    }, [thisText, changedVals]);

    return (
        <p className="text-sm text-white leading-relaxed whitespace-pre-wrap">
            {parts}
        </p>
    );
}

// ── Original Post Modal ─────────────────────────────────────────────────

interface RawMessage {
    id: number;
    chat_id: number;
    message_id: number;
    sender_name: string | null;
    text: string;
    sent_at: string;
}

function OriginalPostModal({ messages, loading, onClose }: { messages: RawMessage[]; loading: boolean; onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm">
            <div className="absolute inset-0" onClick={onClose} />
            <div className="relative w-full max-w-3xl max-h-[80vh] bg-[#111113] border border-white/10 rounded-2xl shadow-2xl flex flex-col">
                <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <FileText className="w-5 h-5 text-indigo-400" /> TG 原帖内容
                    </h3>
                    <button onClick={onClose} className="p-2 bg-white/5 rounded-full hover:bg-rose-500/20 hover:text-rose-400 text-white transition-colors">
                        <X className="w-4 h-4" />
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <div className="animate-spin w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full" />
                        </div>
                    ) : messages.length === 0 ? (
                        <p className="text-center text-slate-400 py-20">未找到原始消息</p>
                    ) : (
                        messages.map(msg => (
                            <div key={msg.id} className="p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-colors">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs text-indigo-400 font-medium">{msg.sender_name || 'Unknown'}</span>
                                    <span className="text-xs text-slate-500">{msg.sent_at?.slice(0, 16).replace('T', ' ')}</span>
                                </div>
                                <p className="text-sm text-slate-200 whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

// ── Main Dashboard ──────────────────────────────────────────────────────

export default function Dashboard({ events, activeEvents = [], expiredEvents = [] }: { events: CryptoEvent[]; activeEvents?: CryptoEvent[]; expiredEvents?: CryptoEvent[]; summaryText?: string; timeRangeStart?: string; timeRangeEnd?: string; createdAt?: string; }) {
    // 全部事件一起 dedup（保留跨 active/expired 的版本历史），再按 latest 状态拆分
    const activeKeySet = useMemo(() => {
        const s = new Set<string>();
        activeEvents.forEach(ev => s.add(`${(ev.exchange||'').toLowerCase()}::${ev.event_name||''}`));
        return s;
    }, [activeEvents]);
    const allSeries = useMemo(() => deduplicateVersions([...activeEvents, ...expiredEvents]), [activeEvents, expiredEvents]);
    const activeSeries = useMemo(() => allSeries.filter(s => activeKeySet.has(`${(s.latest.exchange||'').toLowerCase()}::${s.latest.event_name||''}`)), [allSeries, activeKeySet]);
    const expiredSeries = useMemo(() => allSeries.filter(s => !activeKeySet.has(`${(s.latest.exchange||'').toLowerCase()}::${s.latest.event_name||''}`)), [allSeries, activeKeySet]);
    
    // States
    const [selectedLossOffset, setSelectedLossOffset] = useState<string | null>(null);
    const [compareSelection, setCompareSelection] = useState<Set<string>>(new Set());
    const [viewingSeries, setViewingSeries] = useState<EventSeries | null>(null);
    const [showCompare, setShowCompare] = useState(false);
    const [originalMessages, setOriginalMessages] = useState<RawMessage[]>([]);
    const [loadingOriginal, setLoadingOriginal] = useState(false);
    const [showOriginalModal, setShowOriginalModal] = useState(false);

    // 审核模式
    const [reviewMode, setReviewMode] = useState(false);
    const [reviewSelected, setReviewSelected] = useState<Set<string>>(new Set());
    const [showMergeDialog, setShowMergeDialog] = useState(false);
    const [merging, setMerging] = useState(false);
    const [mainEventKey, setMainEventKey] = useState<string | null>(null);

    const evKey = (ev: CryptoEvent) => `${(ev.exchange || '').toLowerCase()}::${ev.event_name || ''}`;

    const toggleReviewSelect = (key: string) => {
        setReviewSelected(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const findEventByKey = (key: string) => events.find(e => evKey(e) === key);

    const handleMerge = async () => {
        if (!mainEventKey) return;
        const mainEv = findEventByKey(mainEventKey);
        if (!mainEv) return;
        setMerging(true);
        try {
            const mergeKeys = [...reviewSelected].filter(k => k !== mainEventKey);
            const mergeEvs = mergeKeys.map(k => findEventByKey(k)).filter(Boolean);
            const res = await fetch('/api/merge', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    main_event: { exchange: mainEv.exchange, event_name: mainEv.event_name },
                    merge_events: mergeEvs.map(e => ({ exchange: e!.exchange, event_name: e!.event_name })),
                }),
            });
            const data = await res.json();
            if (data.success) {
                setShowMergeDialog(false);
                setReviewSelected(new Set());
                setMainEventKey(null);
                window.location.reload();
            } else {
                alert('合并失败: ' + (data.error || 'Unknown'));
            }
        } catch (e) {
            alert('合并请求失败');
        } finally {
            setMerging(false);
        }
    };

    const fetchOriginalPosts = useCallback(async (sourceLinks: string[]) => {
        if (!sourceLinks?.length) return;
        setLoadingOriginal(true);
        setShowOriginalModal(true);
        setOriginalMessages([]);
        try {
            const res = await fetch(`/api/messages/by-links?links=${encodeURIComponent(sourceLinks.join(','))}`);
            if (res.ok) {
                const data = await res.json();
                setOriginalMessages(data);
            }
        } catch (e) {
            console.error('Failed to fetch original posts:', e);
        } finally {
            setLoadingOriginal(false);
        }
    }, []);

    // Derived
    const filteredSeries = useMemo(() => {
        return allSeries.filter(s => {
            if (selectedLossOffset) {
                const cat = LOSS_CATEGORIES.find(c => c.id === selectedLossOffset);
                if (cat && !cat.match(s.latest.loss_offset ?? -1)) return false;
            }
            return true;
        });
    }, [allSeries, selectedLossOffset]);

    const isSeriesActive = (s: EventSeries) => {
        const end = parseDate(s.latest.end_date);
        const start = parseDate(s.latest.start_date);
        const now = Date.now();
        // 有 end_date 且已过期
        if (end > 0 && end < now) return false;
        // 没有 end_date，但 start_date 距今超过 30 天 → 视为过期
        if (!end && start > 0 && (now - start) > 30 * 24 * 60 * 60 * 1000) return false;
        // start_date 和 end_date 都没有 → 视为过期
        if (!end && !start) return false;
        return activeSeries.some(as => as.id === s.id);
    };

    const stats = useMemo(() => {
        return {
            activeCount: activeSeries.filter(s => {
                if (!selectedLossOffset) return true;
                const cat = LOSS_CATEGORIES.find(c => c.id === selectedLossOffset);
                return !cat || cat.match(s.latest.loss_offset ?? -1);
            }).length,
        };
    }, [activeSeries, selectedLossOffset]);

    const toggleCompare = (id: string) => {
        setCompareSelection(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else if (next.size < 3) next.add(id); // limit max 3 to compare
            return next;
        });
    };

    return (
        <div className="min-h-screen bg-[#0A0A0B] text-slate-100 font-sans selection:bg-indigo-500/30 font-light">
            {/* Header */}
            <header className="sticky top-0 z-40 backdrop-blur-xl bg-[#0A0A0B]/80 border-b border-white/5 py-4">
                <div className="max-w-[1700px] mx-auto px-6 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 text-white">⚡</div>
                        <h1 className="text-xl font-bold tracking-tight text-white">
                            Activity Intelligence
                        </h1>
                    </div>
                    <div className="flex items-center gap-3">
                        {compareSelection.size > 0 && (
                            <button 
                                onClick={() => setShowCompare(true)}
                                className="flex items-center gap-2 px-4 py-2 bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-medium rounded-full shadow-lg shadow-indigo-500/20 transition-all"
                            >
                                <Columns className="w-4 h-4" />
                                对比选中的 {compareSelection.size} 个活动
                            </button>
                        )}
                        <button 
                            onClick={() => { setReviewMode(!reviewMode); setReviewSelected(new Set()); }}
                            className={cn("flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-full transition-all border", reviewMode ? "bg-amber-500/20 border-amber-500/50 text-amber-300" : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10")}
                        >
                            <ClipboardCheck className="w-4 h-4" />
                            {reviewMode ? '退出审核' : '审核模式'}
                        </button>
                    </div>
                </div>
            </header>

            <main className="max-w-[1700px] mx-auto px-6 py-10 flex flex-col lg:flex-row items-start gap-10">
                {/* ── Left Sidebar: Filters ── */}
                <aside className="w-full lg:w-72 shrink-0 lg:sticky lg:top-28 space-y-10">
                    
                    {/* Stats Module */}
                    <div className="space-y-4">
                        <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-300 flex items-center gap-2">
                            <Activity className="w-4 h-4" /> Market Overview
                        </h3>
                        <div className="grid grid-cols-2 lg:grid-cols-1 gap-3">
                            <div className="p-5 rounded-2xl bg-white/[0.02] border border-white/5 shadow-inner">
                                <p className="text-sm text-slate-100 mb-1">进行中活动</p>
                                <p className="text-3xl font-light text-white">{stats.activeCount} <span className="text-sm text-slate-300">个</span></p>
                            </div>
                        </div>
                    </div>

                    {/* Filter Module */}
                    <div className="space-y-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xs font-semibold uppercase tracking-widest text-slate-300 flex items-center gap-2">
                                <Filter className="w-4 h-4" /> 核心策略库
                            </h3>
                            {selectedLossOffset && (
                                <button onClick={() => setSelectedLossOffset(null)} className="text-[10px] text-indigo-400 hover:underline">
                                    重置
                                </button>
                            )}
                        </div>
                        
                        <div className="space-y-2">
                            {LOSS_CATEGORIES.map(cat => {
                                const Icon = cat.icon;
                                const isActive = selectedLossOffset === cat.id;
                                return (
                                    <button 
                                        key={cat.id}
                                        onClick={() => setSelectedLossOffset(isActive ? null : cat.id)}
                                        className={cn(
                                            "w-full text-left p-4 rounded-xl border transition-all duration-300 group",
                                            isActive 
                                                ? cat.activeBg 
                                                : "bg-white/[0.01] border-white/5 hover:bg-white/[0.03]"
                                        )}
                                    >
                                        <div className="flex items-center gap-3 mb-1">
                                            <Icon className={cn("w-5 h-5", isActive ? cat.color : "text-slate-300 group-hover:text-slate-200")} />
                                            <span className={cn("font-medium", isActive ? "text-white" : "text-slate-100")}>{cat.label}</span>
                                        </div>
                                        <p className="text-sm text-slate-100 pl-8">{cat.desc}</p>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </aside>

                {/* ── Main Content: Event Grid ── */}
                <div className="flex-1 w-full">
                    <div className="flex flex-col gap-6">
                        {/* ── 进行中活动 ── */}
                        {filteredSeries.filter(isSeriesActive).map(series => {
                            const ev = series.latest;
                            const isSelected = compareSelection.has(series.id);
                            const lossCat = LOSS_CATEGORIES.find(c => c.match(ev.loss_offset ?? -1));
                            return (
                                <div key={series.id} className={cn("group flex flex-col xl:flex-row gap-6 p-6 rounded-3xl transition-all duration-500 bg-white/[0.02] border", reviewMode && reviewSelected.has(evKey(ev)) ? "border-amber-500/50 bg-amber-500/[0.05]" : isSelected ? "border-indigo-500/50 shadow-[0_0_30px_rgba(99,102,241,0.1)]" : "border-white/5 hover:border-white/10 hover:bg-white/[0.04]")}>
                                    <div className="xl:w-48 shrink-0 flex xl:flex-col items-center xl:items-start gap-4 xl:gap-2 border-b xl:border-b-0 xl:border-r border-white/5 pb-4 xl:pb-0 pr-4">
                                        {reviewMode && (
                                            <button onClick={() => toggleReviewSelect(evKey(ev))} className={cn("w-6 h-6 rounded border-2 flex items-center justify-center transition-all", reviewSelected.has(evKey(ev)) ? "bg-amber-500 border-amber-500 text-black" : "border-white/20 hover:border-amber-400")}>
                                                {reviewSelected.has(evKey(ev)) && <Check className="w-4 h-4" />}
                                            </button>
                                        )}
                                        <div className="w-12 h-12 rounded-full border border-white/10 flex items-center justify-center bg-white/5 text-xl font-bold text-white shadow-inner">{ev.exchange.charAt(0).toUpperCase()}</div>
                                        <div>
                                            <h2 className="text-lg font-bold text-white tracking-wide">{ev.exchange}</h2>
                                            {lossCat && (<div className={cn("mt-1 inline-flex px-2 py-0.5 rounded text-[10px] font-bold border", lossCat.bg, lossCat.color)}>抵扣 {ev.loss_offset}%</div>)}
                                        </div>
                                    </div>
                                    <div className="flex-1 space-y-4">
                                        <div className="flex items-start justify-between">
                                            <div>
                                                <h3 className="text-xl font-medium text-white mb-1 group-hover:text-indigo-300 transition-colors">{ev.event_name}</h3>
                                                <div className="flex items-center gap-3 text-sm text-white">
                                                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3"/> {(() => {
                                                        if (ev.start_date || ev.end_date) return `${ev.start_date || "?"} ~ ${ev.end_date || "?"}`;
                                                        const rounds = ev.rounds;
                                                        if (rounds && rounds.length > 0) {
                                                            const last = rounds[rounds.length - 1];
                                                            if (last.start || last.end) return `${last.start || "?"} ~ ${last.end || "?"}`;
                                                        }
                                                        return "? ~ ?";
                                                    })()}</span>
                                                    {(ev.rounds?.length ?? 0) > 1 && (<span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 text-[9px] font-bold"><Layers className="w-2.5 h-2.5" />{ev.rounds!.length}轮</span>)}
                                                    {(ev.min_deposit ?? -1) > 0 && <span className="flex items-center gap-1"><DollarSign className="w-3 h-3"/> {ev.min_deposit} 起投</span>}
                                                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                                    {((ev as any).source_links?.[0]) && (<a href={(ev as any).source_links[0]} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-slate-200 hover:text-indigo-300 transition-colors bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded ml-2"><Send className="w-3 h-3" /> <span className="text-[10px]">TG</span></a>)}
                                                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                                    {((ev as any).source_links?.length > 0) && (<button onClick={(e) => { e.stopPropagation(); fetchOriginalPosts((ev as any).source_links); }} className="flex items-center gap-1 text-slate-200 hover:text-indigo-300 transition-colors bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded"><FileText className="w-3 h-3" /> <span className="text-[10px]">原帖</span></button>)}
                                                </div>
                                            </div>
                                            {ev.is_new && <span className="px-2 py-1 rounded bg-indigo-500/20 text-indigo-400 text-xs font-bold border border-indigo-500/30">Nouveau ✨</span>}
                                        </div>
                                        <div className="mt-2">{ev.reward ? (ev.reward.includes("{{") ? <TaggedText text={ev.reward} /> : <RewardBlock text={ev.reward} />) : <p className="text-sm text-white leading-relaxed line-clamp-3">{ev.requirements}</p>}</div>
                                        {ev.tips && (<div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-100 text-sm"><AlertTriangle className="w-3.5 h-3.5" /><span>{ev.tips}</span></div>)}
                                    </div>
                                    <div className="xl:w-48 shrink-0 flex flex-row xl:flex-col justify-end xl:justify-center gap-3 border-t xl:border-t-0 xl:border-l border-white/5 pt-4 xl:pt-0 pl-4">
                                        <button onClick={() => setViewingSeries(series)} className="flex-1 xl:flex-none flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white text-sm font-medium transition-colors border border-white/5"><ExternalLink className="w-4 h-4 text-slate-200" />投研详情</button>
                                        {(() => {
                                            const relatedCount = series.history.length + allSeries.filter(s => s.id !== series.id && s.latest.exchange.toLowerCase() === series.latest.exchange.toLowerCase() && s.latest.type === series.latest.type && s.latest.event_name !== series.latest.event_name).length;
                                            return relatedCount > 0 ? (<button onClick={() => setViewingSeries(series)} className="flex items-center justify-center gap-1.5 rounded-xl text-xs font-medium text-amber-500/80 hover:text-amber-400 transition-colors"><GitCommit className="w-3 h-3" />发现 {relatedCount} 个历史版本</button>) : null;
                                        })()}
                                        <button onClick={() => toggleCompare(series.id)} className={cn("flex-1 xl:flex-none flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors border", isSelected ? "bg-indigo-500/20 text-indigo-400 border-indigo-500/40" : "bg-transparent text-slate-200 border-white/10 hover:border-white/20 hover:text-white")}>{isSelected ? <CheckSquare className="w-4 h-4"/> : <Layers className="w-4 h-4" />}{isSelected ? "已加入对比" : "加入对比"}</button>
                                    </div>
                                </div>
                            );
                        })}
                        {/* ── 已结束活动 ── */}
                        {(() => {
                            // 收集所有已过期的活动：独立的 expired series + 活跃 series 的 history
                            const expiredItems: { series: EventSeries; ev: CryptoEvent; fromHistory?: string; parentSeries?: EventSeries }[] = [];
                            // 1. 独立的 expired series
                            filteredSeries.filter(s => !isSeriesActive(s)).forEach(s => {
                                expiredItems.push({ series: s, ev: s.latest });
                            });
                            // 2. 活跃 series 的 history（已过期的）
                            filteredSeries.filter(isSeriesActive).forEach(s => {
                                s.history.forEach((h, idx) => {
                                    const end = parseDate(h.end_date);
                                    if (end > 0 && end < Date.now()) {
                                        expiredItems.push({
                                            series: { id: `${s.id}_hist_${idx}`, latest: h, history: [] },
                                            ev: h,
                                            fromHistory: s.latest.event_name,
                                            parentSeries: s,
                                        });
                                    }
                                });
                            });
                            // 按结束日期排序（最新的在前）
                            expiredItems.sort((a, b) => (parseDate(b.ev.end_date) || 0) - (parseDate(a.ev.end_date) || 0));

                            return expiredItems.length > 0 ? (<>
                            <div className="flex items-center gap-4 mt-6">
                                <div className="h-px flex-1 bg-white/10" />
                                <span className="text-xs text-slate-100 uppercase tracking-widest font-bold whitespace-nowrap">已结束活动 ({expiredItems.length})</span>
                                <div className="h-px flex-1 bg-white/10" />
                            </div>
                            {expiredItems.map(({ series, ev, fromHistory, parentSeries }) => {
                                const lossCat = LOSS_CATEGORIES.find(c => c.match(ev.loss_offset ?? -1));
                                return (
                                    <div key={series.id} className={cn("group flex flex-col xl:flex-row gap-6 p-6 rounded-3xl transition-all duration-500 bg-white/[0.02] border hover:border-white/10 opacity-60 hover:opacity-90", reviewMode && reviewSelected.has(evKey(ev)) ? "border-amber-500/50 bg-amber-500/[0.05] opacity-90" : "border-white/5")}>
                                        <div className="xl:w-48 shrink-0 flex xl:flex-col items-center xl:items-start gap-4 xl:gap-2 border-b xl:border-b-0 xl:border-r border-white/5 pb-4 xl:pb-0 pr-4">
                                            {reviewMode && (
                                                <button onClick={() => toggleReviewSelect(evKey(ev))} className={cn("w-6 h-6 rounded border-2 flex items-center justify-center transition-all", reviewSelected.has(evKey(ev)) ? "bg-amber-500 border-amber-500 text-black" : "border-white/20 hover:border-amber-400")}>
                                                    {reviewSelected.has(evKey(ev)) && <Check className="w-4 h-4" />}
                                                </button>
                                            )}
                                            <div className="w-12 h-12 rounded-full border border-white/10 flex items-center justify-center bg-white/5 text-xl font-bold text-white shadow-inner">{ev.exchange.charAt(0).toUpperCase()}</div>
                                            <div>
                                                <h2 className="text-lg font-bold text-white tracking-wide">{ev.exchange}</h2>
                                                {lossCat && (<div className={cn("mt-1 inline-flex px-2 py-0.5 rounded text-[10px] font-bold border", lossCat.bg, lossCat.color)}>抵扣 {ev.loss_offset}%</div>)}
                                            </div>
                                        </div>
                                        <div className="flex-1 space-y-4">
                                            <div>
                                                <h3 className="text-xl font-medium text-white mb-1">{ev.event_name} <span className="text-xs text-rose-500/70 ml-2 border border-rose-500/20 px-2 py-0.5 rounded font-bold">已结束</span></h3>
                                                <div className="flex items-center gap-3 text-sm text-white">
                                                    <span className="flex items-center gap-1"><Calendar className="w-3 h-3"/> {(() => {
                                                        if (ev.start_date || ev.end_date) return `${ev.start_date || "?"} ~ ${ev.end_date || "?"}`;
                                                        const rounds = ev.rounds;
                                                        if (rounds && rounds.length > 0) {
                                                            const last = rounds[rounds.length - 1];
                                                            if (last.start || last.end) return `${last.start || "?"} ~ ${last.end || "?"}`;
                                                        }
                                                        return "? ~ ?";
                                                    })()}</span>
                                                    {(ev.rounds?.length ?? 0) > 1 && (<span className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 text-[9px] font-bold"><Layers className="w-2.5 h-2.5" />{ev.rounds!.length}轮</span>)}
                                                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                                    {((ev as any).source_links?.[0]) && (<a href={(ev as any).source_links[0]} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-slate-200 hover:text-indigo-300 transition-colors bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded ml-2"><Send className="w-3 h-3" /> <span className="text-[10px]">TG</span></a>)}
                                                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                                    {((ev as any).source_links?.length > 0) && (<button onClick={(e) => { e.stopPropagation(); fetchOriginalPosts((ev as any).source_links); }} className="flex items-center gap-1 text-slate-200 hover:text-indigo-300 transition-colors bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded"><FileText className="w-3 h-3" /> <span className="text-[10px]">原帖</span></button>)}
                                                </div>
                                            </div>
                                            <div className="mt-2">{ev.reward ? (ev.reward.includes("{{") ? <TaggedText text={ev.reward} /> : <RewardBlock text={ev.reward} />) : <p className="text-sm text-white leading-relaxed line-clamp-3">{ev.requirements}</p>}</div>
                                        </div>
                                        <div className="xl:w-36 shrink-0 flex flex-row xl:flex-col justify-end xl:justify-center gap-3 border-t xl:border-t-0 xl:border-l border-white/5 pt-4 xl:pt-0 pl-4">
                                            <button onClick={() => {
                                                const target = parentSeries
                                                    || filteredSeries.find(s => s.id !== series.id && isSeriesActive(s) && s.latest.exchange.toLowerCase() === ev.exchange.toLowerCase() && s.latest.type === ev.type)
                                                    || series;
                                                setViewingSeries(target);
                                            }} className="flex-1 xl:flex-none flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white text-sm font-medium transition-colors border border-white/5"><ExternalLink className="w-4 h-4 text-slate-200" />详情</button>
                                        </div>
                                    </div>
                                );
                            })}
                        </>) : null;
                        })()}
                    </div>
                </div>
            </main>

            {/* ── Timeline Drawer ── */}
            {viewingSeries && (
                <div className="fixed inset-0 z-[100] flex justify-end bg-black/80 backdrop-blur-sm">
                    <div className="absolute inset-0" onClick={() => setViewingSeries(null)} />
                    <div className="relative w-full max-w-6xl bg-[#0A0A0B] h-full shadow-2xl border-l border-white/10 flex flex-col transform transition-transform duration-500">
                        <div className="p-6 border-b border-white/5 flex items-center justify-between bg-[#0A0A0B] sticky top-0 z-10">
                            <div>
                                <h2 className="text-xl font-bold text-white flex items-center gap-3">
                                    {viewingSeries.latest.exchange} · {viewingSeries.latest.event_name}
                                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                    {((viewingSeries.latest as any).source_links?.[0]) && (
                                        <a 
                                            /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
                                            href={(viewingSeries.latest as any).source_links[0]} 
                                            target="_blank" 
                                            rel="noreferrer"
                                            className="px-2 py-1 rounded-full bg-white/5 hover:bg-indigo-500/20 text-slate-300 hover:text-indigo-400 flex items-center gap-1.5 transition-colors text-xs font-normal"
                                        >
                                            <Send className="w-3 h-3" /> TG 溯源
                                        </a>
                                    )}
                                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                    {((viewingSeries.latest as any).source_links?.length > 0) && (
                                        <button
                                            onClick={() => fetchOriginalPosts((viewingSeries.latest as any).source_links)}
                                            className="px-2 py-1 rounded-full bg-white/5 hover:bg-emerald-500/20 text-slate-300 hover:text-emerald-400 flex items-center gap-1.5 transition-colors text-xs font-normal"
                                        >
                                            <FileText className="w-3 h-3" /> 查看原帖
                                        </button>
                                    )}
                                </h2>
                                <p className="text-sm text-slate-100 mt-1">版本追踪与演进对比分析</p>
                            </div>
                            <button onClick={() => setViewingSeries(null)} className="p-2 bg-white/5 rounded-full hover:bg-rose-500/20 hover:text-rose-400 text-white transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto p-8">
                            <div className="grid grid-cols-1 xl:grid-cols-2 gap-10">
                                
                                {/* ---- LEFT/TOP COLUMN: LATEST VERSION ---- */}
                                <div className="space-y-6">
                                    <div className="flex items-center gap-4 border-b border-indigo-500/20 pb-4">
                                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-indigo-500/20 text-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.2)]">
                                            <Activity className="w-4 h-4" />
                                        </div>
                                        <div>
                                            <h3 className="text-lg font-bold text-white tracking-widest">CURRENT <span className="text-indigo-400 text-sm ml-2">最新生效版本</span></h3>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                <p className="text-sm text-white">
                                                    {(() => {
                                                        const rounds = viewingSeries.latest.rounds;
                                                        if (rounds && rounds.length > 0) {
                                                            const last = rounds[rounds.length - 1];
                                                            return `${last.start || "?"} ~ ${last.end || "至今"}`;
                                                        }
                                                        return `${viewingSeries.latest.start_date || "?"} ~ ${viewingSeries.latest.end_date || "至今"}`;
                                                    })()}
                                                </p>
                                                {(viewingSeries.latest.rounds?.length ?? 0) > 1 && (
                                                    <button
                                                        onClick={() => {
                                                            const el = document.getElementById('rounds-detail');
                                                            if (el) el.classList.toggle('hidden');
                                                        }}
                                                        className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-indigo-400 text-[10px] font-bold hover:bg-indigo-500/25 transition-colors cursor-pointer"
                                                    >
                                                        <Layers className="w-3 h-3" />
                                                        {viewingSeries.latest.rounds!.length}轮合并
                                                    </button>
                                                )}
                                            </div>
                                            {/* Rounds 弹出详情 */}
                                            {(viewingSeries.latest.rounds?.length ?? 0) > 1 && (
                                                <div id="rounds-detail" className="hidden mt-3 p-3 rounded-xl bg-black/40 border border-indigo-500/20 space-y-1.5">
                                                    {viewingSeries.latest.rounds!.map((rd, ri) => (
                                                        <div key={ri} className="flex items-center gap-2 text-xs">
                                                            <span className="w-4 h-4 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-[9px] font-bold shrink-0">{ri + 1}</span>
                                                            <span className="text-slate-300">{rd.start || "?"} ~ {rd.end || "?"}</span>
                                                            {rd.sources && rd.sources.length > 0 && (
                                                                <span className="text-slate-500 text-[10px] truncate max-w-[180px]">[{rd.sources.join(", ")}]</span>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    
                                    {/* Main Card */}
                                    <div className="p-6 rounded-3xl bg-indigo-500/[0.03] border border-indigo-500/30 shadow-[0_0_40px_rgba(99,102,241,0.05)] space-y-6">
                                        <div>
                                            <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-widest mb-3">当期奖励细则</h4>
                                            {/* 如果有历史版本，就把它和最近的一个历史版本 diff */}
                                            {viewingSeries.latest.reward ? (
                                                viewingSeries.history.length > 0 ? (
                                                    <ValueDiffText otherText={viewingSeries.history[0].reward || ""} thisText={viewingSeries.latest.reward} />
                                                ) : viewingSeries.latest.reward.includes("{{") ? <TaggedText text={viewingSeries.latest.reward} /> : <RewardBlock text={viewingSeries.latest.reward} />
                                            ) : <p className="text-sm text-white">未知</p>}
                                        </div>
                                        
                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="p-4 rounded-2xl bg-black/40 border border-white/5">
                                                <p className="text-xs text-slate-100 uppercase tracking-wider mb-2 font-medium">参与门槛</p>
                                                <p className="text-sm text-white">{viewingSeries.latest.requirements}</p>
                                            </div>
                                            <div className="p-4 rounded-2xl bg-black/40 border border-white/5">
                                                <p className="text-xs text-slate-100 uppercase tracking-wider mb-2 font-medium">提现限制</p>
                                                <p className="text-sm text-rose-400">{viewingSeries.latest.withdrawal_condition || "无限制"}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* ---- RIGHT/BOTTOM COLUMN: HISTORICAL VERSIONS + RELATED ---- */}
                                {(() => {
                                    // 合并 series 自带的 history + 同交易所同类型的其他 series 活动
                                    const relatedEvents: CryptoEvent[] = [
                                        ...viewingSeries.history,
                                        ...allSeries
                                            .filter(s => s.id !== viewingSeries.id
                                                && s.latest.exchange.toLowerCase() === viewingSeries.latest.exchange.toLowerCase()
                                                && s.latest.type === viewingSeries.latest.type
                                            )
                                            .map(s => s.latest),
                                    ];
                                    // 按结束日期排序（最新的在前）
                                    relatedEvents.sort((a, b) => (parseDate(b.end_date) || 0) - (parseDate(a.end_date) || 0));
                                    // 去掉当前活动自身
                                    const filtered = relatedEvents.filter(e => e.event_name !== viewingSeries.latest.event_name);

                                    return filtered.length > 0 ? (
                                    <div className="space-y-6">
                                        <div className="flex items-center gap-4 border-b border-white/10 pb-4 opacity-70">
                                            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-white/10 text-slate-200">
                                                <GitCommit className="w-4 h-4" />
                                            </div>
                                            <div>
                                                <h3 className="text-lg font-bold text-slate-100 tracking-widest">HISTORY <span className="text-slate-300 text-sm ml-2">存档版本记录</span></h3>
                                                <p className="text-sm text-white">检测到 {filtered.length} 个关联/历史版本</p>
                                            </div>
                                        </div>
                                        
                                        <div className="space-y-6">
                                            {filtered.map((hist, idx) => (
                                                <div key={idx} className="p-6 rounded-2xl bg-white/[0.01] border border-white/5 opacity-80 hover:opacity-100 transition-opacity space-y-5">
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-xs text-slate-300 font-medium px-2 py-1 rounded bg-white/5 border border-white/10">
                                                                {hist.start_date || "?"} ~ {hist.end_date || "未知"}
                                                            </span>
                                                            {hist.event_name !== viewingSeries.latest.event_name && (
                                                                <span className="text-xs text-indigo-400 px-2 py-0.5 rounded bg-indigo-500/10 border border-indigo-500/20">{hist.event_name}</span>
                                                            )}
                                                        </div>
                                                        <div className="flex items-center gap-2">
                                                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                                            {((hist as any).source_links?.[0]) && (<a href={(hist as any).source_links[0]} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-slate-300 hover:text-indigo-300 transition-colors bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded"><Send className="w-3 h-3" /> <span className="text-[10px]">TG</span></a>)}
                                                            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                                            {((hist as any).source_links?.length > 0) && (<button onClick={() => fetchOriginalPosts((hist as any).source_links)} className="flex items-center gap-1 text-slate-300 hover:text-indigo-300 transition-colors bg-white/5 hover:bg-white/10 px-2 py-0.5 rounded"><FileText className="w-3 h-3" /> <span className="text-[10px]">原帖</span></button>)}
                                                            <span className="text-xs text-rose-500/70 uppercase tracking-widest font-bold border border-rose-500/20 px-2 py-0.5 rounded">
                                                                {parseDate(hist.end_date) && parseDate(hist.end_date)! < Date.now() ? "已过期" : "过期/被替换"}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    
                                                    <div>
                                                        <h4 className="text-xs font-bold text-slate-100 uppercase tracking-widest mb-3">旧版奖励规则</h4>
                                                        {hist.reward ? (
                                                            <ValueDiffText otherText={viewingSeries.latest.reward || ""} thisText={hist.reward} />
                                                        ) : <p className="text-sm text-slate-300 line-through">无明确奖励</p>}
                                                    </div>

                                                    <div className="grid grid-cols-2 gap-4">
                                                        <div className="p-3 rounded-xl bg-black/20 border border-white/5">
                                                            <p className="text-xs text-slate-100 uppercase tracking-wider mb-1 font-medium">旧版入门条件</p>
                                                            <p className="text-xs text-slate-200">{hist.requirements}</p>
                                                        </div>
                                                        <div className="p-3 rounded-xl bg-black/20 border border-white/5">
                                                            <p className="text-xs text-slate-100 uppercase tracking-wider mb-1 font-medium">旧版锁仓/限制</p>
                                                            <p className="text-xs text-amber-500/70">{hist.withdrawal_condition || "无"}</p>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-full min-h-[400px] border border-dashed border-white/10 rounded-3xl bg-white/[0.01]">
                                        <ShieldCheck className="w-12 h-12 text-slate-600 mb-4" />
                                        <h3 className="text-slate-200 font-medium">当前为唯一版本</h3>
                                        <p className="text-sm text-slate-600 mt-2">未发现该活动的历史衰减或变动记录</p>
                                    </div>
                                );
                                })()}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Comparison Matrix Drawer ── */}
            {showCompare && (
                <div className="fixed inset-0 z-[100] flex flex-col justify-end bg-black/80 backdrop-blur-md">
                    <div className="flex-1 w-full" onClick={() => setShowCompare(false)} ></div>
                    <div className="h-[80vh] bg-[#0A0A0B] border-t border-indigo-500/30 shadow-[0_-10px_50px_rgba(99,102,241,0.1)] rounded-t-3xl overflow-hidden flex flex-col transform transition-transform duration-500">
                        <div className="px-8 py-5 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                            <div className="flex items-center gap-3">
                                <Columns className="w-5 h-5 text-indigo-400" />
                                <h2 className="text-lg font-bold text-white">投研对比矩阵 (Comparison Matrix)</h2>
                            </div>
                            <button onClick={() => setShowCompare(false)} className="p-2 bg-white/5 rounded-full hover:bg-white/10 text-white transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        
                        <div className="flex-1 overflow-x-auto p-8">
                            <div className="flex gap-6 min-w-max">
                                {Array.from(compareSelection).map(id => {
                                    const series = allSeries.find(s => s.id === id);
                                    if (!series) return null;
                                    const ev = series.latest;
                                    return (
                                        <div key={id} className="w-80 shrink-0 flex flex-col border border-white/10 rounded-2xl bg-[#111113] overflow-hidden">
                                            <div className="p-5 border-b border-white/5 bg-white/[0.02]">
                                                <h3 className="text-lg font-bold text-white mb-1">{ev.exchange}</h3>
                                                <p className="text-sm text-indigo-300 font-medium line-clamp-1">{ev.event_name}</p>
                                            </div>
                                            <div className="p-5 space-y-5 flex-1 divide-y divide-white/5">
                                                <div className="pb-4">
                                                    <p className="text-[10px] text-slate-100 uppercase tracking-widest mb-1">入门门槛</p>
                                                    <p className="text-sm text-white">{ev.requirements}</p>
                                                    {(ev.min_deposit ?? -1) > 0 && <p className="text-xs text-amber-400 mt-2 font-medium">起投额: {ev.min_deposit} USDT</p>}
                                                </div>
                                                <div className="pt-4 pb-4">
                                                    <p className="text-[10px] text-slate-100 uppercase tracking-widest mb-2">亏损容错/抵扣</p>
                                                    <p className={cn(
                                                        "text-xl font-light",
                                                        (ev.loss_offset??-1) >= 100 ? "text-emerald-400" : (ev.loss_offset??-1) >= 33 ? "text-amber-400" : "text-rose-400"
                                                    )}>{(ev.loss_offset ?? -1) >= 0 ? `${ev.loss_offset}%` : "未知"}</p>
                                                </div>
                                                <div className="pt-4 pb-4">
                                                    <p className="text-[10px] text-slate-100 uppercase tracking-widest mb-1">提现陷阱 (风险点)</p>
                                                    <p className="text-sm text-rose-400">{ev.withdrawal_condition || "未披露"}</p>
                                                </div>
                                                <div className="pt-4 pb-4">
                                                    <p className="text-[10px] text-slate-100 uppercase tracking-widest mb-1">核心奖励档位</p>
                                                    <p className="text-xs text-slate-100 line-clamp-6">{ev.reward}</p>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Original Post Modal ── */}
            {showOriginalModal && (
                <OriginalPostModal
                    messages={originalMessages}
                    loading={loadingOriginal}
                    onClose={() => setShowOriginalModal(false)}
                />
            )}

            {/* ── 审核模式：浮动合并栏 ── */}
            {reviewMode && reviewSelected.size >= 2 && (
                <div className="fixed bottom-0 left-0 right-0 z-50 bg-[#111113]/95 backdrop-blur-xl border-t border-amber-500/30 p-4">
                    <div className="max-w-[1700px] mx-auto flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <span className="text-amber-300 font-medium">已选 {reviewSelected.size} 个活动</span>
                            <span className="text-xs text-slate-400">
                                {[...reviewSelected].map(k => findEventByKey(k)?.event_name).filter(Boolean).join(' + ')}
                            </span>
                        </div>
                        <div className="flex items-center gap-3">
                            <button onClick={() => setReviewSelected(new Set())} className="px-4 py-2 text-sm text-slate-300 hover:text-white border border-white/10 rounded-full transition-all">
                                清除选择
                            </button>
                            <button onClick={() => { setMainEventKey([...reviewSelected][0]); setShowMergeDialog(true); }} className="flex items-center gap-2 px-6 py-2 bg-amber-500 hover:bg-amber-400 text-black text-sm font-bold rounded-full transition-all shadow-lg shadow-amber-500/20">
                                <Merge className="w-4 h-4" />
                                合并为一个
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── 合并确认对话框 ── */}
            {showMergeDialog && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-md">
                    <div className="w-full max-w-lg bg-[#111113] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
                        <div className="px-6 py-4 border-b border-white/5 bg-white/[0.02] flex items-center justify-between">
                            <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                <Merge className="w-5 h-5 text-amber-400" />
                                确认合并
                            </h2>
                            <button onClick={() => setShowMergeDialog(false)} className="p-1 hover:bg-white/10 rounded-full text-white transition-colors">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <p className="text-sm text-slate-300">选择要<span className="text-amber-300 font-bold">保留</span>的主活动（其他活动将合并到这个）：</p>
                            <div className="space-y-2 max-h-60 overflow-y-auto">
                                {[...reviewSelected].map(key => {
                                    const ev = findEventByKey(key);
                                    if (!ev) return null;
                                    const isMain = mainEventKey === key;
                                    return (
                                        <button key={key} onClick={() => setMainEventKey(key)} className={cn("w-full text-left p-3 rounded-xl border transition-all", isMain ? "border-amber-500/50 bg-amber-500/10" : "border-white/5 bg-white/[0.02] hover:bg-white/[0.04]")}>
                                            <div className="flex items-center gap-3">
                                                <div className={cn("w-5 h-5 rounded-full border-2 flex items-center justify-center", isMain ? "border-amber-500 bg-amber-500" : "border-white/20")}>
                                                    {isMain && <Check className="w-3 h-3 text-black" />}
                                                </div>
                                                <div>
                                                    <p className="text-sm text-white font-medium">{ev.exchange} — {ev.event_name}</p>
                                                    <p className="text-xs text-slate-400">{ev.start_date || '?'} ~ {ev.end_date || '?'} | {(ev.reward || '').slice(0, 60)}</p>
                                                </div>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                        <div className="px-6 py-4 border-t border-white/5 flex justify-end gap-3">
                            <button onClick={() => setShowMergeDialog(false)} className="px-4 py-2 text-sm text-slate-300 border border-white/10 rounded-lg hover:bg-white/5 transition-all">取消</button>
                            <button onClick={handleMerge} disabled={merging || mainEventKey === null} className="flex items-center gap-2 px-6 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black text-sm font-bold rounded-lg transition-all">
                                {merging ? '合并中...' : '确认合并'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
