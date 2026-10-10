/*
# Create usage_counters table with SECURITY DEFINER increment function

1. New Tables
- `usage_counters`: tracks daily call counts per edge function for rate limiting.
  Columns: id (uuid pk), day (date, not null), fn (text, not null), calls (int, default 1),
  created_at (timestamptz). Unique constraint on (day, fn) for upsert.

2. New Functions
- `increment_usage_counter(p_fn text)`: atomically increments the call count for
  (today, p_fn) using INSERT ... ON CONFLICT DO UPDATE. Returns the new call count.
  SECURITY DEFINER, search_path pinned to public. Executable ONLY by service_role.

3. Security
- RLS enabled on `usage_counters` with NO policies for anon or authenticated.
  Only the service_role (which bypasses RLS) can read or write.
- EXECUTE on `increment_usage_counter` is REVOKE'd from PUBLIC, anon, authenticated
  and GRANT'd only to service_role.
*/

CREATE TABLE IF NOT EXISTS usage_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day date NOT NULL,
  fn text NOT NULL,
  calls int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usage_counters_day_fn_unique UNIQUE (day, fn)
);

CREATE INDEX IF NOT EXISTS idx_usage_counters_day_fn ON usage_counters(day, fn);

ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;

-- No policies: table is locked to anon/authenticated. Only service_role bypasses RLS.

CREATE OR REPLACE FUNCTION increment_usage_counter(p_fn text)
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO usage_counters (day, fn, calls)
  VALUES (CURRENT_DATE, p_fn, 1)
  ON CONFLICT (day, fn) DO UPDATE SET calls = usage_counters.calls + 1
  RETURNING calls;
$$;

REVOKE EXECUTE ON FUNCTION increment_usage_counter(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION increment_usage_counter(text) TO service_role;
