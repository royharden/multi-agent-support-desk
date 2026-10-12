import { useState } from "react";
import { BookOpen, Plus, RefreshCw, Loader2 } from "lucide-react";
import type { KbArticle } from "@/lib/supabase";
import { DEPT_COLORS } from "@/lib/supabase";
import { invokeFn, addKbArticle, LIMITS } from "@/lib/workflow";

interface Props {
  articles: KbArticle[];
  onRefresh: () => void;
}

export default function KbPage({ articles, onRefresh }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [department, setDepartment] = useState<KbArticle["department"]>("billing");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const addArticle = async () => {
    if (!title.trim() || !body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      // seed-kb stores the article and embeds it (mock-safe fallback included).
      const result = await addKbArticle({ department, title, body });
      if (result.warning) setError(`Article saved without an embedding (${result.warning}).`);
      setTitle("");
      setBody("");
      setShowForm(false);
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to add article");
    } finally {
      setBusy(false);
    }
  };

  const reseed = async () => {
    setBusy(true);
    setError(null);
    try {
      await invokeFn<{ seeded: number; mode: string }>("seed-kb", { action: "seed" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "reseed failed");
    } finally {
      // Seeding saves article by article, so refresh even after a partial run.
      onRefresh();
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => setShowForm((s) => !s)}
          className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400 transition-colors"
        >
          <Plus className="h-4 w-4" /> Add article
        </button>
        <button
          onClick={reseed}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800 transition-colors disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Re-embed knowledge base
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
      )}

      {showForm && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
          <div className="flex flex-wrap gap-3">
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value as KbArticle["department"])}
              className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
            >
              <option value="billing">Billing</option>
              <option value="technical">Technical</option>
              <option value="account">Account</option>
            </select>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              maxLength={LIMITS.kbTitle}
              className="flex-1 min-w-48 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500"
            />
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Article body"
            maxLength={LIMITS.kbBody}
            rows={5}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500"
          />
          <button
            onClick={addArticle}
            disabled={busy || !title.trim() || !body.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-400 transition-colors disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BookOpen className="h-4 w-4" />}
            Save & embed
          </button>
        </div>
      )}

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 divide-y divide-zinc-800/60">
        {articles.length === 0 && (
          <div className="px-4 py-8 text-sm text-zinc-500 text-center">
            No articles yet. Use "Re-embed knowledge base" to seed the 12 starter articles.
          </div>
        )}
        {articles.map((a) => (
          <div key={a.id} id={`kb-${a.id}`}>
            <button
              onClick={() => setOpenId(openId === a.id ? null : a.id)}
              className="w-full text-left px-4 py-3 hover:bg-zinc-900 transition-colors flex items-center gap-2"
            >
              <span className={`h-2 w-2 rounded-full ${DEPT_COLORS[a.department].dot}`} />
              <span className="text-sm font-medium text-zinc-200">{a.title}</span>
              <span className="ml-auto text-[11px] text-zinc-500 capitalize">{a.department}</span>
            </button>
            {openId === a.id && (
              <p className="px-4 pb-4 text-sm leading-relaxed text-zinc-400 whitespace-pre-wrap">{a.body}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
