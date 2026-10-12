/*
# Multi-Agent Support Desk — agent-reply edge function

Specialist LLM agent (Billing / Technical / Account) that:
1. Embeds the ticket text with text-embedding-3-small
2. Retrieves top 3 KB articles per department via pgvector cosine similarity
3. Calls an OpenAI-compatible /chat/completions endpoint with a department-specific prompt
4. Applies the reply check and persists the draft

Also performs the human-queue writes (approve & send, reassign, resolve), so
the browser never writes to the tables directly.

Secrets: OPENAI_API_KEY, optional OPENAI_BASE_URL, OPENAI_MODEL, DAILY_CALL_LIMIT.
Uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from env (never from the request).
If no key, or mock=true, drafts canned replies citing real KB ids.

POST { action: "draft", ticket_id, mock?, agent_min_confidence }
  -> { reply, cited_article_ids, self_confidence, retrieved, used_mock, ticket, reply_record }
POST { action: "approve", ticket_id, body }        -> { ok: true }
POST { action: "reassign", ticket_id, department } -> { ok: true }
POST { action: "resolve", ticket_id }              -> { ok: true }

Every OpenAI fetch (embeddings and chat, including retries) and every write
request is counted against the daily cap. The cap fails closed: an RPC error
or a null/non-integer counter is a 503, over the cap is a 429 { error: "daily_limit" }.
*/
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const FN_NAME = "agent-reply";
const PAID_COUNTER = FN_NAME; // one unit per OpenAI fetch, retries included
const WRITE_COUNTER = `${FN_NAME}:write`; // one unit per write request

const DEFAULT_DAILY_LIMIT = 200;
const MAX_UPSTREAM_ATTEMPTS = 2;
const EMBEDDING_TIMEOUT_MS = 20_000;
const CHAT_TIMEOUT_MS = 45_000;
const CHAT_MAX_TOKENS = 800;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_REPLY_CHARS = 8000;
const MAX_TICKET_PROMPT_CHARS = 4200;
const MAX_ARTICLE_PROMPT_CHARS = 4000;
const MAX_KB_SCAN = 200;
const MAX_POLICY_VALUE = 10;
const AGENT_DEPARTMENTS = ["billing", "technical", "account"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface KbArticle {
  id: string;
  department: string;
  title: string;
  body: string;
}
interface AgentOutput {
  reply: string;
  cited_article_ids: string[];
  self_confidence: number;
  retrieved: { id: string; title: string; score: number }[];
  used_mock: boolean;
}
interface TicketRow {
  id: string;
  subject: string;
  body: string;
  customer_tier: string;
  route: string | null;
}

const SYSTEM_PROMPTS: Record<string, string> = {
  billing:
    "You are a Billing specialist for Lumen Analytics, a fictional SaaS. Draft a short, empathetic reply to the customer. ONLY use the provided knowledge base articles. Cite the article titles you used. You must NOT approve refunds over $500 or offer refunds beyond the policy — if the request exceeds what the policy allows, say a specialist will follow up. End with a clear next step.",
  technical:
    "You are a Technical Support specialist for Lumen Analytics, a fictional SaaS. Draft a short, empathetic, technically precise reply to the customer. ONLY use the provided knowledge base articles. Cite the article titles you used. Include concrete troubleshooting steps from the articles. End with a clear next step.",
  account:
    "You are an Account Management specialist for Lumen Analytics, a fictional SaaS. Draft a short, empathetic reply to the customer. ONLY use the provided knowledge base articles. Cite the article titles you used. Never perform account deletion or security changes yourself — point to the documented process. End with a clear next step.",
};

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

function parseThreshold(v: unknown): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > MAX_POLICY_VALUE) {
    throw new HttpError(422, "invalid_agent_min_confidence");
  }
  return v;
}

function parseDepartment(v: unknown): string {
  if (typeof v !== "string" || !AGENT_DEPARTMENTS.includes(v)) throw new HttpError(422, "invalid_department");
  return v;
}

async function loadTicket(admin: SupabaseClient, ticketId: string): Promise<TicketRow> {
  const { data, error } = await admin
    .from("tickets")
    .select("id, subject, body, customer_tier, route")
    .eq("id", ticketId)
    .maybeSingle();
  if (error) throw new Error(`ticket lookup failed: ${error.message}`);
  if (!data) throw new HttpError(404, "ticket_not_found");
  return data as TicketRow;
}

/* ---------- Retrieval + drafting ---------- */

async function deptArticles(admin: SupabaseClient, department: string): Promise<KbArticle[]> {
  const { data, error } = await admin
    .from("kb_articles")
    .select("id, department, title, body")
    .eq("department", department)
    .limit(MAX_KB_SCAN);
  if (error) console.error("kb lookup failed:", error.message);
  return (data ?? []) as KbArticle[];
}

async function vectorSearch(
  admin: SupabaseClient,
  department: string,
  ticketEmbedding: number[]
): Promise<KbArticle[]> {
  const embeddingStr = `[${ticketEmbedding.join(",")}]`;
  const { data, error } = await admin.rpc("match_kb_articles", {
    p_department: department,
    p_embedding: embeddingStr,
    p_limit: 3,
  });
  if (error || !data) {
    console.error("vector search failed, falling back to all dept articles:", error?.message);
    return (await deptArticles(admin, department)).slice(0, 3);
  }
  return data as KbArticle[];
}

async function keywordSearch(
  admin: SupabaseClient,
  department: string,
  ticketText: string
): Promise<KbArticle[]> {
  const articles = await deptArticles(admin, department);
  const words = ticketText.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  const scored = articles.map((a) => {
    const hay = (a.title + " " + a.body).toLowerCase();
    let score = 0;
    for (const w of words) if (hay.includes(w)) score++;
    return { ...a, score };
  });
  scored.sort((x, y) => y.score - x.score);
  return scored.slice(0, 3);
}

function buildUserPrompt(ticket: TicketRow, articles: KbArticle[]): string {
  const kbContext = articles
    .map((a, i) => `[Article ${i + 1}] id=${a.id}\nTitle: ${a.title}\n${a.body.slice(0, MAX_ARTICLE_PROMPT_CHARS)}`)
    .join("\n\n");

  return `Customer tier: ${ticket.customer_tier}
Subject: ${ticket.subject}
Message: ${ticket.body}

Knowledge base articles:
${kbContext}

Draft the reply. After the reply, on a new line, output "CONFIDENCE: <0-1>" indicating how confident you are that your reply fully resolves the issue within policy. List the article ids you used on a line "CITED: <id1, id2>"`;
}

function parseLlmReply(content: string, articles: KbArticle[]): AgentOutput {
  const confidenceMatch = content.match(/CONFIDENCE:\s*([0-9.]+)/i);
  const citedMatch = content.match(/CITED:\s*(.+)/i);
  const replyBody = content
    .replace(/CONFIDENCE:.*$/im, "")
    .replace(/CITED:.*$/im, "")
    .trim();

  let cited = citedMatch
    ? citedMatch[1].split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  if (cited.length === 0) cited = articles.map((a) => a.id);

  const parsed = confidenceMatch ? parseFloat(confidenceMatch[1]) : NaN;
  const confidence = Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.5;

  return {
    reply: replyBody.slice(0, MAX_REPLY_CHARS),
    cited_article_ids: cited.filter((id) => articles.some((a) => a.id === id)),
    self_confidence: confidence,
    retrieved: articles.map((a) => ({ id: a.id, title: a.title, score: 1 })),
    used_mock: false,
  };
}

function mockReply(
  ticket: { subject: string; body: string },
  articles: { id: string; title: string }[]
): AgentOutput {
  const primary = articles[0];
  const secondary = articles[1];
  const cited = articles.slice(0, 2);
  const list = cited.map((a) => `- ${a.title}`).join("\n");

  const reply = `Hi,

Thanks for reaching out about "${ticket.subject}". Here's what I can share based on our knowledge base:

${list}

${primary ? `In short: ${primary.title}.` : ""}${secondary ? ` This is covered in more detail in "${secondary.title}" as well.` : ""}

A member of our team will confirm this resolves your question. If anything in the above doesn't match what you're seeing, just reply and we'll pick it up from there.

Best,
Lumen Analytics Support`;

  return {
    reply,
    cited_article_ids: cited.map((a) => a.id),
    self_confidence: 0.62,
    retrieved: articles.map((a, i) => ({ id: a.id, title: a.title, score: 1 - i * 0.1 })),
    used_mock: true,
  };
}

/* ---------- Actions ---------- */

async function draftReply(admin: SupabaseClient, input: Record<string, unknown>): Promise<Response> {
  const ticketId = parseUuid(input.ticket_id);
  const agentMinConfidence = parseThreshold(input.agent_min_confidence);
  const mock = input.mock === true;

  const writeCap = await consumeCap(admin, WRITE_COUNTER);
  if (writeCap !== "ok") return capFailure(writeCap);

  const ticket = await loadTicket(admin, ticketId);
  const department = ticket.route ?? "";
  if (!AGENT_DEPARTMENTS.includes(department)) return json(409, { error: "ticket_not_routed_to_agent" });

  const openAiKey = Deno.env.get("OPENAI_API_KEY");
  const baseUrl = Deno.env.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1";
  const openAiModel = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";
  const usedMock = mock || !openAiKey;

  const ticketText = `${ticket.subject}\n${ticket.body}`.slice(0, MAX_TICKET_PROMPT_CHARS);
  let articles: KbArticle[] = [];

  if (!usedMock) {
    const emb = await paidFetchJson<{ data?: { embedding?: number[] }[] }>(
      admin,
      PAID_COUNTER,
      `${baseUrl}/embeddings`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${openAiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "text-embedding-3-small", input: ticketText }),
      },
      EMBEDDING_TIMEOUT_MS
    );
    if (!emb.ok && emb.reason !== "upstream_error") return upstreamFailure(emb.reason);
    const embedding = emb.ok ? emb.data.data?.[0]?.embedding : undefined;
    if (Array.isArray(embedding) && embedding.length > 0) {
      articles = await vectorSearch(admin, department, embedding);
    }
    if (articles.length === 0) {
      articles = await keywordSearch(admin, department, ticketText);
    }
  } else {
    articles = await keywordSearch(admin, department, ticketText);
  }

  if (articles.length === 0) {
    return json(404, { error: "no knowledge base articles found for this department" });
  }

  let result: AgentOutput;
  if (usedMock) {
    result = mockReply(ticket, articles);
  } else {
    const promptTicket = {
      ...ticket,
      subject: ticket.subject.slice(0, 200),
      body: ticket.body.slice(0, MAX_TICKET_PROMPT_CHARS),
    };
    const chat = await paidFetchJson<{ choices?: { message?: { content?: string } }[] }>(
      admin,
      PAID_COUNTER,
      `${baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${openAiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: openAiModel,
          max_tokens: CHAT_MAX_TOKENS,
          messages: [
            { role: "system", content: SYSTEM_PROMPTS[department] ?? SYSTEM_PROMPTS.technical },
            { role: "user", content: buildUserPrompt(promptTicket, articles) },
          ],
        }),
      },
      CHAT_TIMEOUT_MS
    );
    if (chat.ok) {
      result = parseLlmReply(chat.data.choices?.[0]?.message?.content ?? "", articles);
    } else if (chat.reason === "upstream_error") {
      console.error("LLM call failed, falling back to mock");
      result = mockReply(ticket, articles);
    } else {
      return upstreamFailure(chat.reason);
    }
  }

  // Reply check: low self-confidence or no citations go to the human queue.
  const needsReview =
    result.self_confidence < agentMinConfidence || result.cited_article_ids.length === 0;
  const status = needsReview ? "escalated" : "auto_replied";
  const newRoute = needsReview ? "human" : department;

  const { data: updatedTicket, error: updateErr } = await admin
    .from("tickets")
    .update({ status, route: newRoute })
    .eq("id", ticketId)
    .select("*")
    .single();
  if (updateErr) throw new Error(`ticket update failed: ${updateErr.message}`);

  const { data: replyRecord, error: replyErr } = await admin
    .from("replies")
    .insert({
      ticket_id: ticketId,
      department,
      body: result.reply,
      cited_article_ids: result.cited_article_ids,
      self_confidence: result.self_confidence,
      approved_by_human: false,
    })
    .select("*")
    .single();
  if (replyErr) throw new Error(`reply insert failed: ${replyErr.message}`);

  return json(200, { ...result, ticket: updatedTicket, reply_record: replyRecord });
}

async function approveReply(admin: SupabaseClient, input: Record<string, unknown>): Promise<Response> {
  const ticketId = parseUuid(input.ticket_id);
  const body = input.body;
  if (typeof body !== "string" || !body.trim()) throw new HttpError(400, "body is required");
  if (body.length > MAX_REPLY_CHARS) throw new HttpError(422, "reply_too_long");

  const cap = await consumeCap(admin, WRITE_COUNTER);
  if (cap !== "ok") return capFailure(cap);

  const ticket = await loadTicket(admin, ticketId);

  const { data: latest, error: latestErr } = await admin
    .from("replies")
    .select("id")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (latestErr) throw new Error(`reply lookup failed: ${latestErr.message}`);

  if (latest && latest.length > 0) {
    const { error } = await admin
      .from("replies")
      .update({ body, approved_by_human: true })
      .eq("id", latest[0].id);
    if (error) throw new Error(`reply update failed: ${error.message}`);
  } else {
    const { error } = await admin.from("replies").insert({
      ticket_id: ticketId,
      department: ticket.route ?? "billing",
      body,
      cited_article_ids: [],
      self_confidence: 1,
      approved_by_human: true,
    });
    if (error) throw new Error(`reply insert failed: ${error.message}`);
  }

  const { error: ticketErr } = await admin
    .from("tickets")
    .update({ status: "auto_replied" })
    .eq("id", ticketId);
  if (ticketErr) throw new Error(`ticket update failed: ${ticketErr.message}`);

  return json(200, { ok: true });
}

async function updateTicket(
  admin: SupabaseClient,
  ticketId: string,
  patch: { route?: string; status: string }
): Promise<Response> {
  const cap = await consumeCap(admin, WRITE_COUNTER);
  if (cap !== "ok") return capFailure(cap);

  const { data, error } = await admin.from("tickets").update(patch).eq("id", ticketId).select("id");
  if (error) throw new Error(`ticket update failed: ${error.message}`);
  if (!data || data.length === 0) return json(404, { error: "ticket_not_found" });
  return json(200, { ok: true });
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
      case "draft":
        return await draftReply(admin, input);
      case "approve":
        return await approveReply(admin, input);
      case "reassign":
        return await updateTicket(admin, parseUuid(input.ticket_id), {
          route: parseDepartment(input.department),
          status: "open",
        });
      case "resolve":
        return await updateTicket(admin, parseUuid(input.ticket_id), { status: "resolved" });
      default:
        throw new HttpError(400, "unknown_action");
    }
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.code });
    console.error("agent-reply failed:", err);
    return json(500, { error: "internal_error" });
  }
});
