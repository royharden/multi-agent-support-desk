import { createClient } from "@supabase/supabase-js";
import type { JevAnswers } from "./routing";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export type Department = "billing" | "technical" | "account" | "human";
export type Priority = "P1" | "P2" | "P3";
export type TicketStatus = "open" | "auto_replied" | "escalated" | "resolved";

export interface Ticket {
  id: string;
  subject: string;
  body: string;
  customer_tier: string;
  prior_contacts_7d: number;
  status: TicketStatus;
  route: Department | null;
  priority: Priority | null;
  created_at: string;
}

export interface TriageRecord {
  id: string;
  ticket_id: string;
  jev_request: unknown;
  jev_response: JevAnswers;
  model: string;
  latency_ms: number;
  input_tokens: number;
  cost_usd: number;
  fired_rules: { rule: string; detail: string }[];
  policy: Record<string, number>;
  created_at: string;
}

export interface Reply {
  id: string;
  ticket_id: string;
  department: string;
  body: string;
  cited_article_ids: string[];
  self_confidence: number;
  approved_by_human: boolean;
  created_at: string;
}

export interface KbArticle {
  id: string;
  department: "billing" | "technical" | "account";
  title: string;
  body: string;
}

export const DEPT_COLORS: Record<Department, { dot: string; text: string; bg: string; border: string; label: string }> = {
  billing: {
    dot: "bg-emerald-400",
    text: "text-emerald-300",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    label: "Billing",
  },
  technical: {
    dot: "bg-sky-400",
    text: "text-sky-300",
    bg: "bg-sky-500/10",
    border: "border-sky-500/30",
    label: "Technical",
  },
  account: {
    dot: "bg-violet-400",
    text: "text-violet-300",
    bg: "bg-violet-500/10",
    border: "border-violet-500/30",
    label: "Account",
  },
  human: {
    dot: "bg-amber-400",
    text: "text-amber-300",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    label: "Human queue",
  },
};

export const PRIORITY_STYLES: Record<Priority, string> = {
  P1: "bg-red-500/15 text-red-300 border-red-500/30",
  P2: "bg-orange-500/15 text-orange-300 border-orange-500/30",
  P3: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
};

export const FRUSTRATION_EMOJI = (score: number): string => {
  if (score >= 2.5) return "😡";
  if (score >= 1.5) return "😠";
  if (score >= 0.75) return "😐";
  return "🙂";
};

export const LLM_JUDGE_COSTS = {
  inputPerMillion: 2.5,
  outputPerMillion: 10,
};
