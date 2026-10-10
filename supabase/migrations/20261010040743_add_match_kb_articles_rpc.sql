/*
# Add match_kb_articles RPC for pgvector similarity search

1. New Functions
- `match_kb_articles(p_department text, p_embedding text, p_limit int)`: returns
  the top-N kb_articles rows for a department ordered by cosine similarity
  between the stored embedding and the query embedding.

2. Security
- The function is SECURITY DEFINER so anon-key clients can run retrieval;
  it only reads kb_articles and requires no auth. Search path is pinned.
*/

CREATE OR REPLACE FUNCTION match_kb_articles(
  p_department text,
  p_embedding text,
  p_limit int DEFAULT 3
)
RETURNS TABLE (id uuid, department text, title text, body text, score float)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.id,
    a.department,
    a.title,
    a.body,
    1 - (a.embedding <=> p_embedding::vector) AS score
  FROM kb_articles a
  WHERE a.department = p_department
    AND a.embedding IS NOT NULL
  ORDER BY a.embedding <=> p_embedding::vector
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION match_kb_articles(text, text, int) TO anon, authenticated;
