/*
# Multi-Agent Support Desk — triage edge function

Calls the TypeSafe System-1 model (Jev) with all 4 questions in ONE request,
routes the ticket with the caller's policy and persists the result.
Secret: TYPESAFE_API_KEY. Optional: DAILY_CALL_LIMIT (default 200/day).
Uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from env (never from the request).

POST { action: "create_tickets", tickets: [{ subject, body, customer_tier?, prior_contacts_7d? }] }
  -> { tickets: Ticket[] }
POST { action: "triage", ticket_id, policy }
  -> { answers, model, usage, latency_ms, cost_usd, decision, ticket, triage_record }

Every TypeSafe fetch (including retries) and every created ticket is counted
against the daily cap. The cap fails closed: an RPC error or a null/non-integer
counter is a 503, over the cap is a 429 { error: "daily_limit" }.
*/
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-1.13.0";
const COST_PER_TOKEN_USD = 0.042 / 1_000_000;
const TYPESAFE_TIMEOUT_MS = 20_000;

const FN_NAME = "triage";
const PAID_COUNTER = FN_NAME; // one unit per TypeSafe fetch, retries included
const WRITE_COUNTER = `${FN_NAME}:write`; // one unit per ticket created

const DEFAULT_DAILY_LIMIT = 200;
const MAX_UPSTREAM_ATTEMPTS = 2;
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_TICKETS_PER_REQUEST = 20;
const MAX_SUBJECT_CHARS = 200;
const MAX_BODY_CHARS = 4000;
const MAX_PRIOR_CONTACTS = 1000;
const MAX_POLICY_VALUE = 10;
const CUSTOMER_TIERS = ["free", "pro", "enterprise"];
const DEPARTMENTS = ["billing", "technical", "account", "uncertain"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface TypeSafeQuestion {
  type: "choice" | "score" | "noul";
  instructions: string;
  criteria: unknown;
}
interface TypeSafeResponse {
  answers?: Record<
    string,
    { choice?: string; score?: number; noul?: number; confidence?: number; probabilities?: Record<string, number>; legend?: string[] }
  >;
  model?: string;
  usage?: { input_tokens?: number };
}

/* ---------- Routing: mirror of route() in src/lib/routing.ts — keep in sync ---------- */

type Department = "billing" | "technical" | "account" | "uncertain";
type Route = "billing" | "technical" | "account" | "human";
type Priority = "P1" | "P2" | "P3";

interface RoutingPolicy {
  humanThreshold: number;
  furyScore: number;
  minDeptConfidence: number;
  urgentThreshold: number;
  agentMinConfidence: number;
}
const POLICY_KEYS: (keyof RoutingPolicy)[] = [
  "humanThreshold",
  "furyScore",
  "minDeptConfidence",
  "urgentThreshold",
  "agentMinConfidence",
];

interface TriageLike {
  needs_human: number;
  frustrationScore: number;
  department: Department;
  departmentConfidence: number;
}
interface FiredRule {
  rule: string;
  detail: string;
}
interface RoutingDecision {
  route: Route;
  priority: Priority;
  firedRules: FiredRule[];
}

export function route(answers: TriageLike, policy: RoutingPolicy): RoutingDecision {
  const firedRules: FiredRule[] = [];

  if (answers.needs_human >= policy.humanThreshold) {
    firedRules.push({
      rule: "needs_human",
      detail: `needs_human ${answers.needs_human.toFixed(2)} >= threshold ${policy.humanThreshold}`,
    });
  }
  if (answers.frustrationScore >= policy.furyScore) {
    firedRules.push({
      rule: "fury_score",
      detail: `frustration ${answers.frustrationScore.toFixed(1)} >= fury threshold ${policy.furyScore}`,
    });
  }
  if (
    answers.department === "uncertain" ||
    answers.departmentConfidence < policy.minDeptConfidence
  ) {
    firedRules.push({
      rule: "department",
      detail:
        answers.department === "uncertain"
          ? "department is uncertain"
          : `department confidence ${answers.departmentConfidence.toFixed(2)} < minimum ${policy.minDeptConfidence}`,
    });
  }

  const route: Route =
    firedRules.length > 0 ? "human" : (answers.department as Exclude<Department, "uncertain">);

  const priority: Priority =
    answers.needs_human >= policy.urgentThreshold
      ? "P1"
      : answers.frustrationScore >= 1.5
        ? "P2"
        : "P3";

  return { route, priority, firedRules };
}

/* ---------- Shared helpers ---------- */

class HttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

function json(status: number, payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Service-role client built only from env; null when either variable is missing.
function adminClient(): SupabaseClient | null {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function dailyLimit(): number {
  const raw = Deno.env.get("DAILY_CALL_LIMIT");
  if (raw === undefined || raw.trim() === "") return DEFAULT_DAILY_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    console.error("invalid DAILY_CALL_LIMIT, using default");
    return DEFAULT_DAILY_LIMIT;
  }
  return n;
}

type CapResult = "ok" | "daily_limit" | "unavailable";

// Atomically bumps today's counter and checks it against the limit. Fails
// closed: an RPC error or a null/non-integer result is "unavailable".
async function consumeCap(admin: SupabaseClient, counter: string): Promise<CapResult> {
  try {
    const { data, error } = await admin.rpc("increment_usage_counter", { p_fn: counter });
    if (error) {
      console.error(`cap check failed for ${counter}:`, error.message);
      return "unavailable";
    }
    if (typeof data !== "number" || !Number.isInteger(data)) {
      console.error(`cap check returned a non-integer for ${counter}:`, data);
      return "unavailable";
    }
    return data <= dailyLimit() ? "ok" : "daily_limit";
  } catch (err) {
    console.error(`cap check threw for ${counter}:`, err);
    return "unavailable";
  }
}

function capFailure(result: Exclude<CapResult, "ok">): Response {
  return result === "daily_limit"
    ? json(429, { error: "daily_limit" })
    : json(503, { error: "service_unavailable" });
}

async function readJsonBody(req: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new HttpError(413, "payload_too_large");
  if (!req.body) throw new HttpError(400, "invalid_json");

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new HttpError(413, "payload_too_large");
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

type UpstreamFailure = "daily_limit" | "unavailable" | "upstream_error";
type UpstreamResult<T> = { ok: true; data: T; elapsedMs: number } | { ok: false; reason: UpstreamFailure };

// Paid upstream call. The cap is consumed right before every attempt; retries
// only on 429/529/network errors, at most MAX_UPSTREAM_ATTEMPTS, and never
// after a daily_limit. Upstream error bodies are logged, never returned.
async function paidFetchJson<T>(
  admin: SupabaseClient,
  counter: string,
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<UpstreamResult<T>> {
  let elapsedMs = 0;
  for (let attempt = 1; attempt <= MAX_UPSTREAM_ATTEMPTS; attempt++) {
    const cap = await consumeCap(admin, counter);
    if (cap !== "ok") return { ok: false, reason: cap };

    const startedAt = performance.now();
    let res: Response;
    try {
      res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      elapsedMs += performance.now() - startedAt;
      console.error(`${counter}: network error on attempt ${attempt}:`, err);
      if (attempt < MAX_UPSTREAM_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
        continue;
      }
      return { ok: false, reason: "upstream_error" };
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      elapsedMs += performance.now() - startedAt;
      console.error(`${counter}: upstream HTTP ${res.status} on attempt ${attempt}: ${detail.slice(0, 500)}`);
      if ((res.status === 429 || res.status === 529) && attempt < MAX_UPSTREAM_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
        continue;
      }
      return { ok: false, reason: "upstream_error" };
    }

    try {
      const data = (await res.json()) as T;
      elapsedMs += performance.now() - startedAt;
      return { ok: true, data, elapsedMs };
    } catch (err) {
      console.error(`${counter}: invalid JSON from upstream:`, err);
      return { ok: false, reason: "upstream_error" };
    }
  }
  return { ok: false, reason: "upstream_error" };
}

function upstreamFailure(reason: UpstreamFailure): Response {
  return reason === "upstream_error" ? json(502, { error: "upstream_error" }) : capFailure(reason);
}

/* ---------- Input validation ---------- */

function parseUuid(v: unknown): string {
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new HttpError(400, "invalid_ticket_id");
  return v;
}

function parseNewTicket(raw: unknown) {
  if (!isRecord(raw)) throw new HttpError(400, "invalid_ticket");
  const { subject, body } = raw;
  if (typeof subject !== "string" || typeof body !== "string" || !subject.trim() || !body.trim()) {
    throw new HttpError(400, "ticket.subject and ticket.body are required");
  }
  if (subject.length > MAX_SUBJECT_CHARS || body.length > MAX_BODY_CHARS) {
    throw new HttpError(422, "ticket_too_long");
  }
  const tier = raw.customer_tier ?? "pro";
  if (typeof tier !== "string" || !CUSTOMER_TIERS.includes(tier)) {
    throw new HttpError(422, "invalid_customer_tier");
  }
  const prior = raw.prior_contacts_7d ?? 0;
  if (typeof prior !== "number" || !Number.isInteger(prior) || prior < 0 || prior > MAX_PRIOR_CONTACTS) {
    throw new HttpError(422, "invalid_prior_contacts_7d");
  }
  return { subject, body, customer_tier: tier, prior_contacts_7d: prior };
}

function parsePolicy(raw: unknown): RoutingPolicy {
  if (!isRecord(raw)) throw new HttpError(422, "invalid_policy");
  const policy = {} as RoutingPolicy;
  for (const key of POLICY_KEYS) {
    const v = raw[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > MAX_POLICY_VALUE) {
      throw new HttpError(422, "invalid_policy");
    }
    policy[key] = v;
  }
  return policy;
}

/* ---------- TypeSafe ---------- */

function buildRequest(ticketBody: string, customerTier: string, priorContacts: number) {
  return {
    model: MODEL,
    state: {
      customer_message: ticketBody,
      customer_tier: customerTier,
      prior_contacts_7d: priorContacts,
    },
    questions: {
      department: {
        type: "choice",
        instructions: "Which team should handle `customer_message`?",
        criteria: {
          billing: "Charges, refunds, invoices, plans, or payment methods.",
          technical: "Bugs, errors, outages, integrations, or how-to questions about the product.",
          account: "Login, password, profile, security, or account deletion.",
          uncertain: "The message does not clearly fit one team.",
        },
      },
      frustration: {
        type: "score",
        instructions: "How frustrated is the customer in `customer_message`?",
        criteria: [
          "Calm: neutral or positive tone.",
          "Mildly annoyed: some impatience.",
          "Frustrated: clear anger or repeated complaints.",
          "Furious: hostile, threatening to leave, or demanding a manager.",
        ],
      },
      urgent: {
        type: "noul",
        instructions:
          "Does `customer_message` describe a problem that blocks the customer right now or risks money, data, or security?",
        criteria: {
          true: "The customer is blocked now, or money, data, or security is at risk.",
          false: "The issue can wait for a normal reply.",
        },
      },
      needs_human: {
        type: "noul",
        instructions:
          "Does `customer_message` ask for something an automated agent must not do alone, such as a legal threat, a refund over $500, account deletion, or a request for a human?",
        criteria: {
          true: "A human must handle or approve this.",
          false: "An automated agent may handle this.",
        },
      },
    } as Record<string, TypeSafeQuestion>,
  };
}

function parseAnswers(raw: TypeSafeResponse) {
  const a = raw.answers ?? {};
  const dep = a.department ?? {};
  const fr = a.frustration ?? {};
  const urgent = typeof a.urgent?.noul === "number" ? a.urgent.noul : 0;
  const needsHuman = typeof a.needs_human?.noul === "number" ? a.needs_human.noul : 0;

  return {
    answers: {
      department: {
        choice: (typeof dep.choice === "string" && DEPARTMENTS.includes(dep.choice)
          ? dep.choice
          : "uncertain") as Department,
        confidence: typeof dep.confidence === "number" ? dep.confidence : 0,
        probabilities: dep.probabilities ?? {},
      },
      frustration: {
        score: typeof fr.score === "number" ? fr.score : 0,
        confidence: typeof fr.confidence === "number" ? fr.confidence : 0,
        legend: fr.legend ?? [],
        probabilities: fr.probabilities ?? {},
      },
      urgent,
      needs_human: needsHuman,
    },
    model: typeof raw.model === "string" ? raw.model : MODEL,
    usage: { input_tokens: typeof raw.usage?.input_tokens === "number" ? raw.usage.input_tokens : 0 },
  };
}

/* ---------- Actions ---------- */

async function createTickets(admin: SupabaseClient, input: Record<string, unknown>): Promise<Response> {
  const list = input.tickets;
  if (!Array.isArray(list) || list.length === 0) throw new HttpError(400, "tickets are required");
  if (list.length > MAX_TICKETS_PER_REQUEST) throw new HttpError(422, "too_many_tickets");
  const rows = list.map(parseNewTicket);

  for (let i = 0; i < rows.length; i++) {
    const cap = await consumeCap(admin, WRITE_COUNTER);
    if (cap !== "ok") return capFailure(cap);
  }

  const { data, error } = await admin.from("tickets").insert(rows).select("*");
  if (error) throw new Error(`ticket insert failed: ${error.message}`);
  return json(200, { tickets: data ?? [] });
}

async function triageTicket(admin: SupabaseClient, input: Record<string, unknown>): Promise<Response> {
  const ticketId = parseUuid(input.ticket_id);
  const policy = parsePolicy(input.policy);

  const apiKey = Deno.env.get("TYPESAFE_API_KEY");
  if (!apiKey) return json(503, { error: "triage_not_configured" });

  const { data: ticket, error: ticketErr } = await admin
    .from("tickets")
    .select("*")
    .eq("id", ticketId)
    .maybeSingle();
  if (ticketErr) throw new Error(`ticket lookup failed: ${ticketErr.message}`);
  if (!ticket) return json(404, { error: "ticket_not_found" });

  const { data: existing, error: existingErr } = await admin
    .from("triage")
    .select("id")
    .eq("ticket_id", ticketId)
    .limit(1);
  if (existingErr) throw new Error(`triage lookup failed: ${existingErr.message}`);
  if (existing && existing.length > 0) return json(409, { error: "already_triaged" });

  const jevRequest = buildRequest(
    String(ticket.body).slice(0, MAX_BODY_CHARS),
    CUSTOMER_TIERS.includes(ticket.customer_tier) ? ticket.customer_tier : "pro",
    Number.isInteger(ticket.prior_contacts_7d) ? ticket.prior_contacts_7d : 0
  );

  const result = await paidFetchJson<TypeSafeResponse>(
    admin,
    PAID_COUNTER,
    TYPESAFE_URL,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(jevRequest),
    },
    TYPESAFE_TIMEOUT_MS
  );
  if (!result.ok) return upstreamFailure(result.reason);
  const latency_ms = Math.round(result.elapsedMs);

  const out = parseAnswers(result.data);
  const inputTokens = out.usage.input_tokens;
  const cost_usd = inputTokens * COST_PER_TOKEN_USD;

  console.log(JSON.stringify({ model: out.model, latency_ms, input_tokens: inputTokens, cost_usd }));

  const answers = out.answers;
  const decision = route(
    {
      needs_human: answers.needs_human,
      frustrationScore: answers.frustration.score,
      department: answers.department.choice,
      departmentConfidence: answers.department.confidence,
    },
    policy
  );
  const status = decision.route === "human" ? "escalated" : "open";

  const { data: updatedTicket, error: updateErr } = await admin
    .from("tickets")
    .update({ route: decision.route, priority: decision.priority, status })
    .eq("id", ticketId)
    .select("*")
    .single();
  if (updateErr) throw new Error(`ticket update failed: ${updateErr.message}`);

  const { data: triageRecord, error: triageErr } = await admin
    .from("triage")
    .insert({
      ticket_id: ticketId,
      jev_request: { questions: Object.keys(answers) },
      jev_response: answers,
      model: out.model,
      latency_ms,
      input_tokens: inputTokens,
      cost_usd,
      fired_rules: decision.firedRules,
      policy,
    })
    .select("*")
    .single();
  if (triageErr) throw new Error(`triage insert failed: ${triageErr.message}`);

  return json(200, {
    answers,
    model: out.model,
    usage: { input_tokens: inputTokens },
    latency_ms,
    cost_usd,
    decision,
    ticket: updatedTicket,
    triage_record: triageRecord,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") return json(405, { error: "POST required" });

    const input = await readJsonBody(req, MAX_REQUEST_BYTES);
    if (!isRecord(input)) throw new HttpError(400, "invalid_json");

    const admin = adminClient();
    if (!admin) {
      console.error("missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      return json(503, { error: "service_unavailable" });
    }

    switch (input.action) {
      case "create_tickets":
        return await createTickets(admin, input);
      case "triage":
        return await triageTicket(admin, input);
      default:
        throw new HttpError(400, "unknown_action");
    }
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.code });
    console.error("triage failed:", err);
    return json(500, { error: "internal_error" });
  }
});
