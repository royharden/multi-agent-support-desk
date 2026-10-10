/*
# Multi-Agent Support Desk schema

1. New Tables
- `tickets`: customer support tickets (simulated customers). Columns: id (uuid pk), subject, body, customer_tier, prior_contacts_7d, status (open|auto_replied|escalated|resolved), route, priority, created_at.
- `triage`: one Jev System-1 triage result per ticket. Columns: id (uuid pk), ticket_id (fk -> tickets), jev_request (jsonb), jev_response (jsonb), model, latency_ms, input_tokens, cost_usd, fired_rules (jsonb), policy (jsonb), created_at.
- `replies`: specialist agent draft replies. Columns: id (uuid pk), ticket_id (fk), department, body, cited_article_ids (jsonb), self_confidence, approved_by_human, created_at.
- `kb_articles`: knowledge base articles for RAG. Columns: id (uuid pk), department, title, body, embedding (vector 1536).

2. Extensions
- Enable `pgvector` extension for the embedding column and similarity search.

3. Security
- Enable RLS on all four tables.
- Add permissive anon + authenticated CRUD policies — this is a single public demo workspace with no sign-in, so the data is intentionally shared.
*/

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  body text NOT NULL,
  customer_tier text NOT NULL DEFAULT 'pro',
  prior_contacts_7d int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','auto_replied','escalated','resolved')),
  route text,
  priority text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS triage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  jev_request jsonb NOT NULL,
  jev_response jsonb NOT NULL,
  model text NOT NULL,
  latency_ms int NOT NULL,
  input_tokens int NOT NULL DEFAULT 0,
  cost_usd numeric NOT NULL DEFAULT 0,
  fired_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS replies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  department text NOT NULL,
  body text NOT NULL,
  cited_article_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  self_confidence numeric NOT NULL DEFAULT 0.5,
  approved_by_human boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kb_articles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  embedding vector(1536)
);

CREATE INDEX IF NOT EXISTS idx_triage_ticket ON triage(ticket_id);
CREATE INDEX IF NOT EXISTS idx_replies_ticket ON replies(ticket_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_created ON tickets(created_at DESC);

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE triage ENABLE ROW LEVEL SECURITY;
ALTER TABLE replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_articles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_tickets" ON tickets;
CREATE POLICY "anon_read_tickets" ON tickets FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_tickets" ON tickets;
CREATE POLICY "anon_insert_tickets" ON tickets FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_tickets" ON tickets;
CREATE POLICY "anon_update_tickets" ON tickets FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_tickets" ON tickets;
CREATE POLICY "anon_delete_tickets" ON tickets FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_read_triage" ON triage;
CREATE POLICY "anon_read_triage" ON triage FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_triage" ON triage;
CREATE POLICY "anon_insert_triage" ON triage FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_triage" ON triage;
CREATE POLICY "anon_update_triage" ON triage FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_triage" ON triage;
CREATE POLICY "anon_delete_triage" ON triage FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_read_replies" ON replies;
CREATE POLICY "anon_read_replies" ON replies FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_replies" ON replies;
CREATE POLICY "anon_insert_replies" ON replies FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_replies" ON replies;
CREATE POLICY "anon_update_replies" ON replies FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_replies" ON replies;
CREATE POLICY "anon_delete_replies" ON replies FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_read_kb" ON kb_articles;
CREATE POLICY "anon_read_kb" ON kb_articles FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "anon_insert_kb" ON kb_articles;
CREATE POLICY "anon_insert_kb" ON kb_articles FOR INSERT TO anon, authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "anon_update_kb" ON kb_articles;
CREATE POLICY "anon_update_kb" ON kb_articles FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "anon_delete_kb" ON kb_articles;
CREATE POLICY "anon_delete_kb" ON kb_articles FOR DELETE TO anon, authenticated USING (true);
