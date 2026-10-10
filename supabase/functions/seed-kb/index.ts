/*
# Multi-Agent Support Desk — seed-kb edge function

Embeds the 12 seed KB articles with text-embedding-3-small and upserts them
into kb_articles. In mock mode (or when no OPENAI_API_KEY), falls back to
keyword search — no embeddings stored, retrieval still works.

POST { mock?: boolean, supabase_url, supabase_key }
-> { seeded: number, mode: "live" | "mock" }
*/
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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

function encodeText(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
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

    const { mock, supabase_url, supabase_key, article_id } = await req.json();
    if (!supabase_url || !supabase_key) {
      return new Response(JSON.stringify({ error: "supabase_url and supabase_key are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    const mode = mock === true || !openAiKey ? "mock" : "live";

    const { createClient } = await import("npm:@supabase/supabase-js@2.57.4");
    const supabase = createClient(supabase_url, supabase_key, {
      auth: { persistSession: false },
    });

    let seeded = 0;

    const upsertArticle = async (article: SeedArticle, embedding?: number[]) => {
      const { data: existing } = await supabase
        .from("kb_articles")
        .select("id")
        .eq("title", article.title)
        .eq("department", article.department)
        .maybeSingle();

      if (existing) {
        const { error } = await supabase
          .from("kb_articles")
          .update(embedding ? { body: article.body, embedding } : { body: article.body })
          .eq("id", existing.id);
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase.from("kb_articles").insert({
          department: article.department,
          title: article.title,
          body: article.body,
          ...(embedding ? { embedding } : {}),
        });
        if (error) throw new Error(error.message);
      }
      seeded++;
    };

    if (mode === "live") {
      if (article_id) {
        const { data: row } = await supabase
          .from("kb_articles")
          .select("id, department, title, body")
          .eq("id", article_id)
          .maybeSingle();
        if (!row) throw new Error("article not found");
        const res = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: { Authorization: `Bearer ${openAiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "text-embedding-3-small", input: `${row.title}\n${row.body}` }),
        });
        if (!res.ok) throw new Error(`OpenAI embeddings HTTP ${res.status}`);
        const json = await res.json();
        const { error } = await supabase
          .from("kb_articles")
          .update({ embedding: json.data[0].embedding })
          .eq("id", row.id);
        if (error) throw new Error(error.message);
        return new Response(JSON.stringify({ seeded: 1, mode }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const input = SEED_ARTICLES.map((a) => `${a.title}\n${a.body}`);
      const res = await fetch("https://api.openai.com/v1/embeddings", {
        method: "POST",
        headers: { Authorization: `Bearer ${openAiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: "text-embedding-3-small", input }),
      });
      if (!res.ok) throw new Error(`OpenAI embeddings HTTP ${res.status}`);
      const json = await res.json();

      for (let i = 0; i < SEED_ARTICLES.length; i++) {
        const article = SEED_ARTICLES[i];
        const embedding = json.data[i]?.embedding;
        const { data: existing } = await supabase
          .from("kb_articles")
          .select("id, title, department")
          .eq("title", article.title)
          .eq("department", article.department)
          .maybeSingle();

        if (existing) {
          const { error } = await supabase
            .from("kb_articles")
            .update({ body: article.body, embedding })
            .eq("id", existing.id);
          if (error) throw new Error(error.message);
        } else {
          const { error } = await supabase.from("kb_articles").insert({
            department: article.department,
            title: article.title,
            body: article.body,
            embedding,
          });
          if (error) throw new Error(error.message);
        }
        seeded++;
      }
    } else {
      if (article_id) {
        // Mock mode: nothing to embed; report success.
        return new Response(JSON.stringify({ seeded: 0, mode }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Mock mode: still upsert article text; keyword search works without embeddings.
      for (const article of SEED_ARTICLES) {
        await upsertArticle(article);
      }
    }

    return new Response(JSON.stringify({ seeded, mode }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "seed-kb failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
