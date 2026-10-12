import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase, type Ticket, type TriageRecord, type Reply, type Department, type KbArticle } from "./supabase";
import { DEFAULT_POLICY, type RoutingPolicy, type RoutingDecision } from "./routing";

// Mirrors the bounds enforced by the Edge Functions.
export const LIMITS = {
  subject: 200,
  ticketBody: 4000,
  priorContacts: 1000,
  reply: 8000,
  kbTitle: 200,
  kbBody: 8000,
};

export async function invokeFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let message = error.message;
    if (error instanceof FunctionsHttpError) {
      try {
        const payload = await error.context.json();
        if (payload && typeof payload.error === "string") message = payload.error;
      } catch {
        // keep the generic message
      }
    }
    throw new Error(message);
  }
  return data as T;
}

export interface NewTicket {
  subject: string;
  body: string;
  customer_tier: string;
  prior_contacts_7d: number;
}

export async function createTickets(tickets: NewTicket[]): Promise<Ticket[]> {
  const result = await invokeFn<{ tickets: Ticket[] }>("triage", { action: "create_tickets", tickets });
  return result.tickets;
}

export async function approveReply(ticketId: string, body: string): Promise<void> {
  await invokeFn("agent-reply", { action: "approve", ticket_id: ticketId, body });
}

export async function reassignTicket(ticketId: string, department: Department): Promise<void> {
  await invokeFn("agent-reply", { action: "reassign", ticket_id: ticketId, department });
}

export async function resolveTicket(ticketId: string): Promise<void> {
  await invokeFn("agent-reply", { action: "resolve", ticket_id: ticketId });
}

export async function addKbArticle(
  article: Pick<KbArticle, "department" | "title" | "body">
): Promise<{ id: string; embedded: boolean; mode: string; warning?: string }> {
  return invokeFn("seed-kb", { action: "add_article", ...article });
}

export interface ProcessResult {
  ticket: Ticket;
  triageRecord: TriageRecord | null;
  reply: Reply | null;
  error?: string;
}

export async function processTicket(
  ticket: Ticket,
  policy: RoutingPolicy,
  mockAgents: boolean
): Promise<ProcessResult> {
  try {
    // 1. Jev triage (always live). The Edge Function routes the ticket with
    // this policy and stores the ticket's route/priority and the triage record.
    const triageResult = await invokeFn<{
      answers: TriageRecord["jev_response"];
      model: string;
      usage: { input_tokens: number };
      latency_ms: number;
      cost_usd: number;
      decision: RoutingDecision;
      ticket: Ticket;
      triage_record: TriageRecord;
    }>("triage", { action: "triage", ticket_id: ticket.id, policy });

    const triageRecord = triageResult.triage_record;
    const updatedTicket = triageResult.ticket;

    if (triageResult.decision.route === "human") {
      return { ticket: updatedTicket, triageRecord, reply: null };
    }

    // 2. Specialist agent reply. The Edge Function applies the reply check
    // (self-confidence and citations) and stores the draft and new status.
    const agentResult = await invokeFn<{
      reply: string;
      cited_article_ids: string[];
      self_confidence: number;
      used_mock?: boolean;
      ticket: Ticket;
      reply_record: Reply;
    }>("agent-reply", {
      action: "draft",
      ticket_id: ticket.id,
      mock: mockAgents,
      agent_min_confidence: policy.agentMinConfidence,
    });

    return { ticket: agentResult.ticket, triageRecord, reply: agentResult.reply_record };
  } catch (err) {
    return {
      ticket,
      triageRecord: null,
      reply: null,
      error: err instanceof Error ? err.message : "processing failed",
    };
  }
}

export const PRESETS: Record<string, Partial<RoutingPolicy>> = {
  Cautious: {
    humanThreshold: 0.3,
    furyScore: 1.5,
    minDeptConfidence: 0.8,
    urgentThreshold: 0.5,
    agentMinConfidence: 0.7,
  },
  Balanced: { ...DEFAULT_POLICY },
  "Aggressive automation": {
    humanThreshold: 0.7,
    furyScore: 3.0,
    minDeptConfidence: 0.45,
    urgentThreshold: 0.8,
    agentMinConfidence: 0.3,
  },
};
