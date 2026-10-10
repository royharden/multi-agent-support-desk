/*
# Multi-Agent Support Desk — triage edge function

Calls the TypeSafe System-1 model (Jev) with all 4 questions in ONE request.
Secret: TYPESAFE_API_KEY. Returns { answers, model, usage, latency_ms, cost_usd }.
Checks the daily call cap before calling TypeSafe. Fails closed (503) if the
cap is exceeded or the cap check itself errors.
*/
const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-1.13.0";
const COST_PER_TOKEN_USD = 0.042 / 1_000_000;
const DEFAULT_DAILY_LIMIT = 200;
const FN_NAME = "triage";

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
interface TriageOutput {
  answers: {
    department: { choice: string; confidence: number; probabilities: Record<string, number> };
    frustration: { score: number; confidence: number; legend: string[]; probabilities: Record<string, number> };
    urgent: number;
    needs_human: number;
  };
  model: string;
  usage: { input_tokens: number };
  latency_ms: number;
  cost_usd: number;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function checkCap(): Promise<{ allowed: boolean; calls: number; limit: number }> {
  const limit = parseInt(Deno.env.get("DAILY_CALL_LIMIT") ?? String(DEFAULT_DAILY_LIMIT), 10);
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for cap check");
  }
  const { createClient } = await import("npm:@supabase/supabase-js@2.57.4");
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc("increment_usage_counter", { p_fn: FN_NAME });
  if (error) throw new Error(`cap check failed: ${error.message}`);
  const calls = typeof data === "number" ? data : 0;
  return { allowed: calls <= limit, calls, limit };
}

async function callTypeSafe(body: unknown, apiKey: string): Promise<TypeSafeResponse> {
  let lastError = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(TYPESAFE_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (res.status === 429 || res.status === 529) {
        lastError = `HTTP ${res.status}`;
        if (attempt < 3) {
          await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
          continue;
        }
        throw new Error(lastError);
      }
      if (!res.ok) {
        throw new Error(`TypeSafe HTTP ${res.status}`);
      }
      return (await res.json()) as TypeSafeResponse;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < 3 && /429|529|timeout|network/i.test(lastError)) {
        await new Promise((r) => setTimeout(r, 500 * Math.pow(2, attempt - 1)));
        continue;
      }
      throw new Error(lastError);
    }
  }
  throw new Error(lastError);
}

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
        choice: typeof dep.choice === "string" ? dep.choice : "uncertain",
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
    model: raw.model ?? MODEL,
    usage: { input_tokens: raw.usage?.input_tokens ?? 0 },
  };
}

function failClosed(message: string): Response {
  return new Response(
    JSON.stringify({ error: message }),
    { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "POST required" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("TYPESAFE_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "TYPESAFE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { ticket } = await req.json();
    if (!ticket?.body || !ticket?.subject) {
      return new Response(JSON.stringify({ error: "ticket.subject and ticket.body are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cap check — fail closed if the check itself errors.
    let cap;
    try {
      cap = await checkCap();
    } catch (capErr) {
      return failClosed(
        `daily call cap check failed: ${capErr instanceof Error ? capErr.message : "unknown error"}`
      );
    }
    if (!cap.allowed) {
      return failClosed(
        `daily call limit reached for ${FN_NAME} (${cap.calls}/${cap.limit})`
      );
    }

    const jevRequest = buildRequest(
      ticket.body,
      ticket.customer_tier ?? "pro",
      ticket.prior_contacts_7d ?? 0
    );

    const startedAt = performance.now();
    const raw = await callTypeSafe(jevRequest, apiKey);
    const latency_ms = Math.round(performance.now() - startedAt);

    const out = parseAnswers(raw);
    const inputTokens = out.usage.input_tokens;
    const cost_usd = inputTokens * COST_PER_TOKEN_USD;

    console.log(
      JSON.stringify({
        model: out.model,
        latency_ms,
        input_tokens: inputTokens,
        cost_usd,
      })
    );

    const payload: TriageOutput = {
      answers: out.answers,
      model: out.model,
      usage: { input_tokens: inputTokens },
      latency_ms,
      cost_usd,
    };
    return new Response(JSON.stringify(payload), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "triage failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
