/*
# Multi-Agent Support Desk — seed-kb edge function

Seeds the 12 starter KB articles and adds new articles from the KB page,
embedding them with text-embedding-3-small when OPENAI_API_KEY is set.
In mock mode (or when no OPENAI_API_KEY) articles are stored without embeddings
and agents fall back to keyword search.
Uses SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from env (never from the request).

POST { action?: "seed", mock?: boolean }
  -> { seeded, skipped, mode: "live" | "mock" }
  Idempotent: only inserts missing starter articles and embeds starter articles
  that have no embedding yet. Already-embedded articles are skipped.
POST { action: "add_article", department, title, body, mock?: boolean }
  -> { id, seeded, embedded, mode, warning? }

One embeddings fetch per article. Every fetch (including retries) and every row
written is counted against the daily cap (default 200/day, DAILY_CALL_LIMIT).
The cap fails closed: an RPC error or a null/non-integer counter is a 503, over
the cap is a 429 { error: "daily_limit" }.
*/
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const FN_NAME = "seed-kb";
const PAID_COUNTER = FN_NAME; // one unit per embeddings fetch, retries included
const WRITE_COUNTER = `${FN_NAME}:write`; // one unit per row written

const DEFAULT_DAILY_LIMIT = 200;
const MAX_UPSTREAM_ATTEMPTS = 2;
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_TIMEOUT_MS = 20_000;
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_ARTICLES_PER_REQUEST = 12;
const MAX_TITLE_CHARS = 200;
const MAX_ARTICLE_BODY_CHARS = 8000;
const KB_DEPARTMENTS = ["billing", "technical", "account"];

interface SeedArticle {
  department: "billing" | "technical" | "account";
  title: string;
  body: string;
}

export const SEED_ARTICLES: SeedArticle[] = [
  // Billing
  {
    department: "billing",
    title: "Refund policy",
    body: "Lumen Analytics offers a full refund within 14 days of a charge. Refunds between $0 and $500 can be issued automatically by the billing agent. Refunds over $500 always require human approval from a billing manager before being promised to the customer. Annual plans are refunded pro-rata for unused months. To request a refund, the customer must reply from the account's primary email.",
  },
  {
    department: "billing",
    title: "Changing your plan",
    body: "Plan changes take effect immediately. Upgrades are prorated on the next invoice; downgrades take effect at the end of the current billing cycle to preserve the remaining term. To change a plan, go to Settings > Billing > Plan and select the new tier. If a prorated charge looks wrong, compare the invoice line items against the plan change date.",
  },
  {
    department: "billing",
    title: "Failed card / payment retry",
    body: "When a card fails, we retry the charge three times over 10 days: day 0, day 4, and day 9. After the third failure the account is paused and dashboards become read-only. Update the payment method under Settings > Billing > Payment methods. Once a valid card is saved, the outstanding charge is captured immediately and access is restored.",
  },
  {
    department: "billing",
    title: "Invoices and receipts",
    body: "Invoices are generated on the billing anniversary date and emailed to the account's primary contact. You can download any invoice from Settings > Billing > Invoices as PDF. Each invoice shows the plan line item, seat count, prorated adjustments, taxes, and the payment method used. Receipts for one-off charges (e.g. extra seats) are separate documents.",
  },
  // Technical
  {
    department: "technical",
    title: "Dashboard not loading / 500 errors",
    body: "If the dashboard returns 500 errors or a blank page: 1) Check the Lumen status page for an active incident. 2) Hard-refresh with Ctrl+Shift+R to clear a stale asset bundle. 3) Confirm the workspace has not hit its query concurrency limit — heavy scheduled reports can block interactive queries. 4) If only one dashboard fails, re-save it to rebuild its query plan. Persistence beyond 15 minutes should be reported to technical support with the dashboard URL and timestamp.",
  },
  {
    department: "technical",
    title: "API rate limits",
    body: "The Lumen API allows 120 requests per minute per workspace and 20 concurrent requests. When exceeded, the API returns HTTP 429 with a Retry-After header. Batch endpoints accept up to 500 rows per call and are the recommended way to bulk-insert events. If you need a higher limit, the workspace can be upgraded; permanent limit increases are handled by the account team.",
  },
  {
    department: "technical",
    title: "CSV import errors",
    body: "CSV imports fail with row-level errors when: the header row doesn't match the expected schema (column names are case-sensitive), date fields aren't ISO 8601 (YYYY-MM-DD), numbers contain thousand separators, or the file exceeds 100 MB. The import preview shows the first 20 failing rows with reasons. Re-export from the source system with UTF-8 encoding and ISO dates to resolve most failures.",
  },
  {
    department: "technical",
    title: "Setting up webhooks",
    body: "Webhooks deliver events to your endpoint over HTTPS with a 10-second timeout and automatic retries at 1, 5, and 30 minutes. Configure the URL and secret under Settings > Integrations > Webhooks. Every delivery is signed in the X-Lumen-Signature header (HMAC-SHA256 of the raw body with your secret). Endpoints must respond 2xx within 10 seconds; failing endpoints are disabled after 48 hours of continuous failures.",
  },
  // Account
  {
    department: "account",
    title: "Password reset",
    body: "Use Forgot password on the sign-in page; the reset link is valid for 60 minutes and can be used once. If the email doesn't arrive, check spam and confirm you used the account's primary email. Admins can also trigger a reset for workspace members under Settings > Members. After 5 failed sign-ins the account is locked for 15 minutes before a reset can be attempted.",
  },
  {
    department: "account",
    title: "Two-factor lockout",
    body: "If you lose your 2FA device: use one of your saved backup codes on the sign-in screen. If no backup codes are available, a workspace owner can verify your identity and reset your 2FA from Settings > Members > Security. Accounts without an available owner must go through identity verification with the account team, which typically completes within one business day. 2FA resets are never done automatically by the support agent.",
  },
  {
    department: "account",
    title: "Inviting team members",
    body: "Owners and admins can invite members under Settings > Members > Invite. Enter the email, choose a role (Viewer, Editor, Admin), and send. Invitations expire after 7 days and can be resent. Seat count updates immediately; if the workspace is at its seat limit, the invite will fail until seats are added or a member is removed. Guests are limited to Viewer role and cannot see billing.",
  },
  {
    department: "account",
    title: "Deleting an account",
    body: "Account deletion is permanent and removes all dashboards, data sources, and history. Deletion requests must be made by the account owner from the account's primary email and always require human confirmation by the account team — the automated agent must never perform or promise deletion on its own. After verification, deletion completes within 30 days, with a 7-day grace period during which deletion can be cancelled by contacting support.",
  },
];

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

const FAILURE_STATUS: Record<UpstreamFailure, number> = {
  daily_limit: 429,
  unavailable: 503,
  upstream_error: 502,
};
const FAILURE_CODE: Record<UpstreamFailure, string> = {
  daily_limit: "daily_limit",
  unavailable: "service_unavailable",
  upstream_error: "upstream_error",
};

// Bulk seeding persists each article as it goes, so failures report progress.
function seedFailure(reason: UpstreamFailure, seeded: number): Response {
  return json(FAILURE_STATUS[reason], { error: FAILURE_CODE[reason], seeded });
}

/* ---------- Embeddings ---------- */

function openAiBaseUrl(): string {
  return Deno.env.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1";
}

async function embedArticle(
  admin: SupabaseClient,
  apiKey: string,
  title: string,
  body: string
): Promise<{ ok: true; embedding: number[] } | { ok: false; reason: UpstreamFailure }> {
  const res = await paidFetchJson<{ data?: { embedding?: number[] }[] }>(
    admin,
    PAID_COUNTER,
    `${openAiBaseUrl()}/embeddings`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: `${title}\n${body}` }),
    },
    EMBEDDING_TIMEOUT_MS
  );
  if (!res.ok) return res;
  const embedding = res.data.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    console.error("embeddings response contained no vector");
    return { ok: false, reason: "upstream_error" };
  }
  return { ok: true, embedding };
}

/* ---------- Actions ---------- */

async function seed(admin: SupabaseClient, input: Record<string, unknown>): Promise<Response> {
  const apiKey = input.mock === true ? undefined : Deno.env.get("OPENAI_API_KEY");
  const mode = apiKey ? "live" : "mock";

  const articles = SEED_ARTICLES.slice(0, MAX_ARTICLES_PER_REQUEST).filter(
    (a) => a.title.length <= MAX_TITLE_CHARS && a.body.length <= MAX_ARTICLE_BODY_CHARS
  );
  const titles = articles.map((a) => a.title);

  const { data: rows, error: rowsErr } = await admin
    .from("kb_articles")
    .select("id, department, title")
    .in("title", titles);
  if (rowsErr) throw new Error(`kb lookup failed: ${rowsErr.message}`);

  const { data: unembedded, error: unembeddedErr } = await admin
    .from("kb_articles")
    .select("id")
    .in("title", titles)
    .is("embedding", null);
  if (unembeddedErr) throw new Error(`kb lookup failed: ${unembeddedErr.message}`);
  const missingEmbedding = new Set((unembedded ?? []).map((r: { id: string }) => r.id));

  let seeded = 0;
  let skipped = 0;

  for (const article of articles) {
    const existing = (rows ?? []).find(
      (r: { department: string; title: string }) =>
        r.department === article.department && r.title === article.title
    ) as { id: string } | undefined;

    // Mock mode only fills in missing starter articles; live mode also embeds
    // starter articles that have no embedding yet.
    if (existing && (!apiKey || !missingEmbedding.has(existing.id))) {
      skipped++;
      continue;
    }

    const writeCap = await consumeCap(admin, WRITE_COUNTER);
    if (writeCap !== "ok") return seedFailure(writeCap, seeded);

    let embedding: number[] | null = null;
    if (apiKey) {
      const emb = await embedArticle(admin, apiKey, article.title, article.body);
      if (!emb.ok) return seedFailure(emb.reason, seeded);
      embedding = emb.embedding;
    }

    if (existing) {
      const { error } = await admin
        .from("kb_articles")
        .update({ body: article.body, embedding })
        .eq("id", existing.id);
      if (error) throw new Error(`kb update failed: ${error.message}`);
    } else {
      const { error } = await admin.from("kb_articles").insert({
        department: article.department,
        title: article.title,
        body: article.body,
        embedding,
      });
      if (error) throw new Error(`kb insert failed: ${error.message}`);
    }
    seeded++;
  }

  return json(200, { seeded, skipped, mode });
}

async function addArticle(admin: SupabaseClient, input: Record<string, unknown>): Promise<Response> {
  const { department, title, body } = input;
  if (typeof department !== "string" || !KB_DEPARTMENTS.includes(department)) {
    throw new HttpError(422, "invalid_department");
  }
  if (typeof title !== "string" || typeof body !== "string" || !title.trim() || !body.trim()) {
    throw new HttpError(400, "title and body are required");
  }
  if (title.length > MAX_TITLE_CHARS || body.length > MAX_ARTICLE_BODY_CHARS) {
    throw new HttpError(422, "article_too_long");
  }

  const writeCap = await consumeCap(admin, WRITE_COUNTER);
  if (writeCap !== "ok") return capFailure(writeCap);

  const apiKey = input.mock === true ? undefined : Deno.env.get("OPENAI_API_KEY");
  const mode = apiKey ? "live" : "mock";

  // If the embedding can't be made (cap reached, cap check failed, upstream
  // error) the article is still saved without one, like in mock mode.
  let embedding: number[] | null = null;
  let warning: string | undefined;
  if (apiKey) {
    const emb = await embedArticle(admin, apiKey, title, body);
    if (emb.ok) embedding = emb.embedding;
    else warning = FAILURE_CODE[emb.reason];
  }

  const { data, error } = await admin
    .from("kb_articles")
    .insert({ department, title, body, embedding })
    .select("id")
    .single();
  if (error) throw new Error(`kb insert failed: ${error.message}`);

  return json(200, {
    id: (data as { id: string }).id,
    seeded: embedding ? 1 : 0,
    embedded: embedding !== null,
    mode,
    ...(warning ? { warning } : {}),
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

    switch (input.action ?? "seed") {
      case "seed":
        return await seed(admin, input);
      case "add_article":
        return await addArticle(admin, input);
      default:
        throw new HttpError(400, "unknown_action");
    }
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.code });
    console.error("seed-kb failed:", err);
    return json(500, { error: "internal_error" });
  }
});
