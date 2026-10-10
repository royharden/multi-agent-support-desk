import { supabase, type Ticket, type TriageRecord, type Reply, type Department, type TicketStatus } from "./supabase";
import { route, DEFAULT_POLICY, type RoutingPolicy, type Department as PolicyDepartment } from "./routing";

export async function invokeFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw new Error(error.message);
  return data as T;
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
    // 1. Jev triage (always live)
    const triageResult = await invokeFn<{
      answers: TriageRecord["jev_response"];
      model: string;
      usage: { input_tokens: number };
      latency_ms: number;
      cost_usd: number;
    }>("triage", { ticket });

    const answers = triageResult.answers;
    const decision = route(
      {
        needs_human: answers.needs_human,
        frustrationScore: answers.frustration.score,
        department: answers.department.choice as PolicyDepartment,
        departmentConfidence: answers.department.confidence,
      },
      policy
    );

    let status: Ticket["status"];
    if (decision.route === "human") {
      status = "escalated";
    } else {
      status = "open";
    }

    await supabase
      .from("tickets")
      .update({ route: decision.route, priority: decision.priority, status })
      .eq("id", ticket.id);

    const { data: triageRow, error: triageErr } = await supabase
      .from("triage")
      .insert({
        ticket_id: ticket.id,
        jev_request: { questions: Object.keys(triageResult.answers) },
        jev_response: answers,
        model: triageResult.model,
        latency_ms: triageResult.latency_ms,
        input_tokens: triageResult.usage.input_tokens,
        cost_usd: triageResult.cost_usd,
        fired_rules: decision.firedRules,
        policy,
      })
      .select()
      .single();
    if (triageErr) throw new Error(triageErr.message);
    const triageRecord = triageRow as unknown as TriageRecord;

    const updatedTicket: Ticket = {
      ...ticket,
      route: decision.route as Department,
      priority: decision.priority,
      status,
    };

    if (decision.route === "human") {
      return { ticket: updatedTicket, triageRecord, reply: null };
    }

    // 2. Specialist agent reply
    const agentResult = await invokeFn<{
      reply: string;
      cited_article_ids: string[];
      self_confidence: number;
      used_mock?: boolean;
    }>("agent-reply", {
      department: decision.route,
      ticket,
      mock: mockAgents,
    });

    const needsReview =
      agentResult.self_confidence < policy.agentMinConfidence ||
      agentResult.cited_article_ids.length === 0;

    const replyStatus: TicketStatus = needsReview ? "escalated" : "auto_replied";
    await supabase
      .from("tickets")
      .update({ status: replyStatus, route: needsReview ? "human" : decision.route })
      .eq("id", ticket.id);

    const { data: replyRow, error: replyErr } = await supabase
      .from("replies")
      .insert({
        ticket_id: ticket.id,
        department: decision.route,
        body: agentResult.reply,
        cited_article_ids: agentResult.cited_article_ids,
        self_confidence: agentResult.self_confidence,
        approved_by_human: false,
      })
      .select()
      .single();
    if (replyErr) throw new Error(replyErr.message);

    const finalTicket: Ticket = {
      ...updatedTicket,
      status: replyStatus,
      route: needsReview ? "human" : (decision.route as Department),
    };

    return { ticket: finalTicket, triageRecord, reply: replyRow as unknown as Reply };
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
