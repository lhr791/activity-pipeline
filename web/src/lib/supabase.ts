import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export interface CryptoEvent {
  exchange: string;
  event_name: string;
  type: string;
  start_date?: string;
  end_date?: string;
  loss_offset?: number;
  commission_rate?: number;
  reward?: string;
  requirements?: string;
  link?: string;
  sources: string[];
  tips?: string;
  bonus_type?: string;
  bonus_validity_days?: number;
  withdrawal_condition?: string;
  leverage_limit?: string;
  min_deposit?: number;
  target_volume?: string;
  max_reward?: number;
  new_users_only?: boolean;
  kyc_required?: boolean | null;
  source_channel?: string;
  source_links?: string[];
  rounds?: { start?: string; end?: string; sources?: string[] }[];
  is_new: boolean;
}

export interface RawMessage {
  id: number;
  chat_id: number;
  message_id: number;
  sender_name: string;
  text: string;
  sent_at: string;
}

export interface Summary {
  id: number;
  chat_id: number;
  summary: string;
  topics: string[];
  message_count: number;
  time_range_start: string;
  time_range_end: string;
  created_at: string;
}

export interface ParsedSummary extends Omit<Summary, "summary"> {
  events: CryptoEvent[];
  activeEvents: CryptoEvent[];
  expiredEvents: CryptoEvent[];
  summaryText: string;
  rawSummary: string;
}

export function parseSummary(row: Summary): ParsedSummary {
  let events: CryptoEvent[] = [];
  let activeEvents: CryptoEvent[] = [];
  let expiredEvents: CryptoEvent[] = [];
  let summaryText = "";

  try {
    const parsed = JSON.parse(row.summary);
    activeEvents = parsed.active_events || [];
    expiredEvents = parsed.expired_events || [];
    events = [...activeEvents, ...expiredEvents, ...(parsed.events || [])];
    summaryText = parsed.summary || "";
  } catch {
    summaryText = row.summary;
  }

  return {
    ...row,
    events,
    activeEvents,
    expiredEvents,
    summaryText,
    rawSummary: row.summary,
  };
}
