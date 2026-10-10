/*
# Multi-Agent Support Desk — agent-reply edge function

Specialist LLM agent (Billing / Technical / Account) that:
1. Embeds the ticket text with text-embedding-3-small
2. Retrieves top 3 KB articles per department via pgvector cosine similarity
3. Calls an OpenAI-compatible /chat/completions endpoint with a department-specific prompt
4. Returns { reply, cited_article_ids, self_confidence }

Secrets: OPENAI_API_KEY, optional OPENAI_BASE_URL, OPENAI_MODEL.
If no key, or mock=true, returns canned replies citing real KB ids.
*/
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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

const DEPARTMENT_LABELS: Record<string, string> = {
  billing: "Billing",
  technical: "Technical Support",
  account: "Account Management",
};

const SYSTEM_PROMPTS: Record<string, string> = {
  billing:
    "You are a Billing specialist for Lumen Analytics, a fictional SaaS. Draft a short, empathetic reply to the customer. ONLY use the provided knowledge base articles. Cite the article titles you used. You must NOT approve refunds over $500 or offer refunds beyond the policy — if the request exceeds what the policy allows, say a specialist will follow up. End with a clear next step.",
  technical:
    "You are a Technical Support specialist for Lumen Analytics, a fictional SaaS. Draft a short, empathetic, technically precise reply to the customer. ONLY use the provided knowledge base articles. Cite the article titles you used. Include concrete troubleshooting steps from the articles. End with a clear next step.",
  account:
    "You are an Account Management specialist for Lumen Analytics, a fictional SaaS. Draft a short, empathetic reply to the customer. ONLY use the provided knowledge base articles. Cite the article titles you used. Never perform account deletion or security changes yourself — point to the documented process. End with a clear next step.",
};

function encodeText(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

async function embed(text: string, apiKey: string, baseUrl: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text }),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

interface SupabaseClient {
  from(table: string): {
    select(cols: string): {
      eq(col: string, val: unknown): PromiseLike<{ data: KbArticle[] | null; error: { message: string } | null }>;
    };
  };
}

async function vectorSearch(
  supabase: SupabaseClient,
  department: string,
  ticketEmbedding: number[],
  apiKey: string,
  baseUrl: string
): Promise<KbArticle[]> {
  const embeddingStr = `[${ticketEmbedding.join(",")}]`;
  const { data, error } = await supabase.rpc("match_kb_articles", {
    p_department: department,
    p_embedding: embeddingStr,
    p_limit: 3,
  });
  if (error || !data) {
    console.error("vector search failed, falling back to all dept articles:", error?.message);
    const all = await supabase.from("kb_articles").select("id, department, title, body");
    return (all.data ?? []).filter((a) => a.department === department).slice(0, 3);
  }
  return data as unknown as KbArticle[];
}

async function keywordSearch(
  supabase: SupabaseClient,
  department: string,
  ticketText: string
): Promise<{ id: string; title: string; body: string; score: number }[]> {
  const { data } = await supabase.from("kb_articles").select("id, department, title, body");
  const articles = (data ?? []).filter((a) => a.department === department);
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

async function llmReply(
  department: string,
  ticket: { subject: string; body: string; customer_tier: string },
  articles: { id: string; title: string; body: string }[],
  apiKey: string,
  baseUrl: string,
  model: string
): Promise<AgentOutput> {
  const kbContext = articles
    .map((a, i) => `[Article ${i + 1}] id=${a.id}\nTitle: ${a.title}\n${a.body}`)
    .join("\n\n");

  const userPrompt = `Customer tier: ${ticket.customer_tier}
Subject: ${ticket.subject}
Message: ${ticket.body}

Knowledge base articles:
${kbContext}

Draft the reply. After the reply, on a new line, output "CONFIDENCE: <0-1>" indicating how confident you are that your reply fully resolves the issue within policy. List the article ids you used on a line "CITED: <id1, id2>"`;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPTS[department] ?? SYSTEM_PROMPTS.technical },
        { role: "user", content: userPrompt },
      ],
    }),
  });
  if (!res.ok) {
    throw new Error(`LLM HTTP ${res.status}`);
  }
  const json = await res.json();
  const content: string = json.choices?.[0]?.message?.content ?? "";

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

  const confidence = confidenceMatch ? Math.min(1, Math.max(0, parseFloat(confidenceMatch[1]))) : 0.5;

  return {
    reply: replyBody,
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
  const cited = articles.slice(0, 2).map((a) => a.id);
  const list = cited.map((id) => {
    const a = articles.find((x) => x.id === id)!;
    return `- ${a.title}`;
  }).join("\n");

  const reply = `Hi,

Thanks for reaching out about "${ticket.subject}". Here's what I can share based on our knowledge base:

${list}

${primary ? `In short: ${primary.title}.` : ""}${secondary ? ` This is covered in more detail in "${secondary.title}" as well.` : ""}

A member of our team will confirm this resolves your question. If anything in the above doesn't match what you're seeing, just reply and we'll pick it up from there.

Best,
Lumen Analytics ${DEPARTMENT_LABELS.technical ? "Support" : "Support"}`;

  return {
    reply,
    cited_article_ids: cited,
    self_confidence: 0.62,
    retrieved: articles.map((a, i) => ({ id: a.id, title: a.title, score: 1 - i * 0.1 })),
    used_mock: true,
  };
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

    const {
      department,
      ticket,
      mock,
      supabase_url,
      supabase_key,
    } = await req.json();

    if (!department || !ticket) {
      return new Response(JSON.stringify({ error: "department and ticket are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const openAiKey = Deno.env.get("OPENAI_API_KEY");
    const baseUrl = Deno.env.get("OPENAI_BASE_URL") ?? "https://api.openai.com/v1";
    const openAiModel = Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini";

    if (!supabase_url || !supabase_key) {
      return new Response(JSON.stringify({ error: "supabase_url and supabase_key are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { createClient } = await import("npm:@supabase/supabase-js@2.57.4");
    const supabase = createClient(supabase_url, supabase_key, {
      auth: { persistSession: false },
    });

    const ticketText = `${ticket.subject}\n${ticket.body}`;
    let articles: { id: string; title: string; body: string }[] = [];
    let usedMock = mock === true || !openAiKey;

    if (!usedMock) {
      const embedding = await embed(ticketText, openAiKey!, baseUrl);
      if (embedding) {
        articles = await vectorSearch(supabase as unknown as SupabaseClient, department, embedding, openAiKey!, baseUrl);
      }
      if (!articles || articles.length === 0) {
        articles = await keywordSearch(supabase as unknown as SupabaseClient, department, ticketText);
      }
    } else {
      articles = await keywordSearch(supabase as unknown as SupabaseClient, department, ticketText);
      if (articles.length === 0) {
        const all = await supabase.from("kb_articles").select("id, department, title, body");
        articles = (all.data ?? []).filter((a) => a.department === department).slice(0, 3);
      }
    }

    if (articles.length === 0) {
      return new Response(
        JSON.stringify({ error: "no knowledge base articles found for this department" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let result: AgentOutput;
    if (usedMock) {
      result = mockReply(ticket, articles);
    } else {
      try {
        result = await llmReply(department, ticket, articles, openAiKey!, baseUrl, openAiModel);
      } catch (llmErr) {
        console.error("LLM call failed, falling back to mock:", llmErr);
        result = mockReply(ticket, articles);
      }
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "agent-reply failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
