import { useState } from "react";
import { Users, Send, Pencil, CheckCircle2, RotateCcw } from "lucide-react";
import type { Ticket, Reply, KbArticle, Department, TriageRecord } from "@/lib/supabase";
import { supabase, DEPT_COLORS, FRUSTRATION_EMOJI } from "@/lib/supabase";

interface Props {
  tickets: Ticket[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  triage: Record<string, TriageRecord>;
  replies: Record<string, Reply>;
  kb: KbArticle[];
  onRefresh: () => void;
}

const ASSIGNABLE: Department[] = ["billing", "technical", "account"];

export default function HumanQueue({ tickets, selectedId, onSelect, triage, replies, onRefresh }: Props) {
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const saveReply = async (t: Ticket) => {
    const text = editing[t.id] ?? "";
    if (!text.trim()) return;
    setBusy(t.id);
    try {
      if (replies[t.id]) {
        await supabase.from("replies").update({ body: text, approved_by_human: true }).eq("id", replies[t.id].id);
      } else {
        await supabase.from("replies").insert({
          ticket_id: t.id,
          department: t.route ?? "billing",
          body: text,
          cited_article_ids: [],
          self_confidence: 1,
          approved_by_human: true,
        });
      }
      await supabase.from("tickets").update({ status: "auto_replied" }).eq("id", t.id);
      setEditing((e) => {
        const c = { ...e };
        delete c[t.id];
        return c;
      });
      onRefresh();
    } finally {
      setBusy(null);
    }
  };

  const reassign = async (t: Ticket, dept: Department) => {
    setBusy(t.id);
    try {
      await supabase.from("tickets").update({ route: dept, status: "open" }).eq("id", t.id);
      onRefresh();
    } finally {
      setBusy(null);
    }
  };

  const resolve = async (t: Ticket) => {
    setBusy(t.id);
    try {
      await supabase.from("tickets").update({ status: "resolved" }).eq("id", t.id);
      onRefresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-xl border border-amber-500/25 bg-zinc-900/50 overflow-hidden lg:h-[calc(100vh-320px)] flex flex-col">
      <div className="flex items-center gap-1.5 border-b border-zinc-800 px-4 py-3 text-sm font-medium text-amber-300">
        <Users className="h-4 w-4" />
        Human queue <span className="ml-1 text-xs text-zinc-500">({tickets.length})</span>
      </div>
      <div className="overflow-y-auto flex-1 p-2 space-y-2">
        {tickets.length === 0 && (
          <div className="px-4 py-8 text-sm text-zinc-500 text-center">
            Nothing escalated. Tickets land here when Jev flags a human requirement, high fury, or low confidence.
          </div>
        )}
        {tickets.map((t) => {
          const tr = triage[t.id];
          const draft = replies[t.id];
          const isEditing = editing[t.id] !== undefined;
          return (
            <div
              key={t.id}
              className={`rounded-lg border p-3 transition-colors ${
                selectedId === t.id ? "border-sky-500/40 bg-sky-500/5" : "border-zinc-800 bg-zinc-950/60"
              }`}
            >
              <button onClick={() => onSelect(t.id)} className="w-full text-left">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${DEPT_COLORS[(t.route ?? "human") as Department].dot}`} />
                  <span className="text-xs font-medium text-zinc-200 truncate flex-1">{t.subject}</span>
                  {tr && <span className="text-[11px]">{FRUSTRATION_EMOJI(tr.jev_response.frustration.score)}</span>}
                </div>
                {tr && tr.fired_rules.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5">
                    {tr.fired_rules.map((r, i) => (
                      <li key={i} className="text-[10px] text-amber-200/80">• {r.detail}</li>
                    ))}
                  </ul>
                )}
              </button>

              {draft && !isEditing && (
                <p className="mt-2 text-[11px] leading-relaxed text-zinc-400 line-clamp-4">{draft.body}</p>
              )}
              {isEditing && (
                <textarea
                  value={editing[t.id]}
                  onChange={(e) => setEditing((prev) => ({ ...prev, [t.id]: e.target.value }))}
                  rows={6}
                  placeholder="Write the reply to send…"
                  className="mt-2 w-full rounded-md border border-zinc-700 bg-zinc-900 p-2 text-[11px] text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-sky-500/50"
                />
              )}

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {!isEditing && (
                  <button
                    onClick={() => setEditing((prev) => ({ ...prev, [t.id]: draft?.body ?? "" }))}
                    className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800 transition-colors"
                  >
                    <Pencil className="h-3 w-3" />
                    {draft ? "Edit draft" : "Write reply"}
                  </button>
                )}
                {isEditing && (
                  <>
                    <button
                      onClick={() => saveReply(t)}
                      disabled={busy === t.id || !editing[t.id].trim()}
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/20 px-2 py-1 text-[10px] text-emerald-300 hover:bg-emerald-500/30 transition-colors disabled:opacity-50"
                    >
                      <Send className="h-3 w-3" /> Approve & send
                    </button>
                    <button
                      onClick={() =>
                        setEditing((prev) => {
                          const c = { ...prev };
                          delete c[t.id];
                          return c;
                        })
                      }
                      className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800 transition-colors"
                    >
                      <RotateCcw className="h-3 w-3" /> Cancel
                    </button>
                  </>
                )}
                <select
                  value=""
                  onChange={(e) => e.target.value && reassign(t, e.target.value as Department)}
                  className="rounded-md border border-zinc-700 bg-zinc-900 px-1.5 py-1 text-[10px] text-zinc-400"
                >
                  <option value="">Reassign…</option>
                  {ASSIGNABLE.map((d) => (
                    <option key={d} value={d}>
                      {DEPT_COLORS[d].label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => resolve(t)}
                  disabled={busy === t.id}
                  className="ml-auto inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800 transition-colors disabled:opacity-50"
                >
                  <CheckCircle2 className="h-3 w-3" /> Resolve
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
