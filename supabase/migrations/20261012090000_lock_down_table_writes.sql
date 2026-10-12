/*
# Security hardening: browser is read-only, writes go through Edge Functions

1. App tables (tickets, triage, replies, kb_articles)
- Drop every anon/authenticated INSERT, UPDATE, DELETE (and ALL) policy.
  The SELECT policies stay, so the browser can still read with the anon key.
- Revoke all table privileges from anon/authenticated and grant back SELECT only.
- All writes (creating tickets, triage results, agent drafts, human
  approve/reassign/resolve, adding KB articles) now happen in the triage,
  agent-reply and seed-kb Edge Functions with the service-role client,
  whitelisted columns, bounded payloads and the daily cap.

2. usage_counters
- RLS stays on with no policies at all; revoke every table privilege from
  PUBLIC, anon and authenticated.
- Re-assert that increment_usage_counter(text) is executable by service_role only.

3. match_kb_articles
- No longer callable by anon/authenticated; only the agent-reply Edge Function
  (service role) runs vector retrieval.
*/

-- 1. App tables: remove every non-SELECT policy (known names first, then any stragglers).
DROP POLICY IF EXISTS "anon_insert_tickets" ON tickets;
DROP POLICY IF EXISTS "anon_update_tickets" ON tickets;
DROP POLICY IF EXISTS "anon_delete_tickets" ON tickets;

DROP POLICY IF EXISTS "anon_insert_triage" ON triage;
DROP POLICY IF EXISTS "anon_update_triage" ON triage;
DROP POLICY IF EXISTS "anon_delete_triage" ON triage;

DROP POLICY IF EXISTS "anon_insert_replies" ON replies;
DROP POLICY IF EXISTS "anon_update_replies" ON replies;
DROP POLICY IF EXISTS "anon_delete_replies" ON replies;

DROP POLICY IF EXISTS "anon_insert_kb" ON kb_articles;
DROP POLICY IF EXISTS "anon_update_kb" ON kb_articles;
DROP POLICY IF EXISTS "anon_delete_kb" ON kb_articles;

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        (tablename IN ('tickets', 'triage', 'replies', 'kb_articles') AND cmd <> 'SELECT')
        OR tablename = 'usage_counters'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);
  END LOOP;
END $$;

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE triage ENABLE ROW LEVEL SECURITY;
ALTER TABLE replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE kb_articles ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE tickets, triage, replies, kb_articles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE tickets, triage, replies, kb_articles TO anon, authenticated;

-- 2. usage_counters: no client access at all.
ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE usage_counters FROM PUBLIC, anon, authenticated;

ALTER FUNCTION increment_usage_counter(text) SET search_path = public;
REVOKE EXECUTE ON FUNCTION increment_usage_counter(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_usage_counter(text) TO service_role;

-- 3. match_kb_articles: service role only.
REVOKE EXECUTE ON FUNCTION match_kb_articles(text, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION match_kb_articles(text, text, int) TO service_role;
