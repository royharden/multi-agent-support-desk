import type { Reply, KbArticle } from "@/lib/supabase";

interface Props {
  reply: Reply;
  kb: KbArticle[];
}

export default function ReplyDraft({ reply, kb }: Props) {
  const cited = kb.filter((a) => reply.cited_article_ids.includes(a.id));
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-zinc-200">Agent draft reply</span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400 capitalize">{reply.department}</span>
        <span className="rounded-full border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-[10px] text-zinc-400">
          self-confidence {(reply.self_confidence * 100).toFixed(0)}%
        </span>
        {reply.approved_by_human && (
          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">
            approved by human
          </span>
        )}
      </div>
      <p className="mt-3 text-sm leading-relaxed text-zinc-300 whitespace-pre-wrap">{reply.body}</p>
      {cited.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {cited.map((a) => (
            <span key={a.id} className="rounded border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-300">
              {a.title}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
