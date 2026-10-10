import { useMemo } from "react";
import {
  Sparkles,
  Scale,
  Zap,
  ShieldCheck,
  Clock,
  Coins,
  MessageSquare,
  FileSearch,
  PenLine,
  CheckCircle2,
} from "lucide-react";
import type { TriageRecord, Reply, KbArticle } from "@/lib/supabase";

interface Props {
  triage: TriageRecord;
  reply: Reply | null;
  kb: KbArticle[];
}

function ProbBar({ label, value, color }: { label: string; value: number; color: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-24 shrink-0 truncate text-zinc-400">{label}</span>
      <div className="h-2 flex-1 rounded-full bg-zinc-800 overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-10 text-right tabular-nums text-zinc-400">{pct}%</span>
    </div>
  );
}

function ConfidenceChip({ value }: { value: number | null }) {
  if (value === null || value === undefined) return null;
  const high = value >= 0.7;
  const mid = value >= 0.5;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
        high
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          : mid
            ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
            : "border-red-500/40 bg-red-500/10 text-red-300"
      }`}
    >
      <ShieldCheck className="h-3 w-3" />
      confidence {(value * 100).toFixed(0)}%
    </span>
  );
}

const DEPT_COLORS_MAP: Record<string, string> = {
  billing: "bg-emerald-400",
  technical: "bg-sky-400",
  account: "bg-violet-400",
  uncertain: "bg-amber-400",
};
const DEPT_TEXT_MAP: Record<string, string> = {
  billing: "text-emerald-300",
  technical: "text-sky-300",
  account: "text-violet-300",
  uncertain: "text-amber-300",
};

export default function JevPanel({ triage, reply, kb }: Props) {
  const resp = triage.jev_response;
  const cited = useMemo(() => {
    if (!reply) return [];
    return kb.filter((a) => reply.cited_article_ids.includes(a.id));
  }, [reply, kb]);

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Sparkles className="h-4 w-4 text-sky-400" />
        <span className="text-sm font-medium text-zinc-200">Jev triage</span>
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">{triage.model}</span>
        {resp.department.confidence !== undefined && (
          <ConfidenceChip value={resp.department.confidence} />
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
        <section>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
            <Scale className="h-3.5 w-3.5" /> Department (choice)
          </div>
          <div className={`mb-2 text-sm font-semibold ${DEPT_TEXT_MAP[resp.department.choice] ?? "text-zinc-300"}`}>
            {resp.department.choice}
          </div>
          {Object.entries(resp.department.probabilities).map(([k, v]) => (
            <div key={k} className="mb-1">
              <ProbBar label={k} value={v} color={DEPT_COLORS_MAP[k] ?? "bg-zinc-400"} />
            </div>
          ))}
        </section>

        <section>
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
            <Zap className="h-3.5 w-3.5" /> Frustration (score)
          </div>
          <div className="mb-2 text-sm font-semibold text-zinc-200">
            {resp.frustration.score.toFixed(2)}
            {resp.frustration.legend.length > 0 && (
              <span className="ml-2 text-[11px] font-normal text-zinc-500">
                {resp.frustration.legend[resp.frustration.legend.length - 1]}
              </span>
            )}
          </div>
          {Object.entries(resp.frustration.probabilities).map(([k, v], i) => (
            <div key={k} className="mb-1">
              <ProbBar label={k} value={v} color={["bg-zinc-400", "bg-amber-400", "bg-orange-400", "bg-red-400"][i] ?? "bg-zinc-400"} />
            </div>
          ))}
        </section>

        <section className="grid grid-cols-2 gap-4 md:col-span-2">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
              <Clock className="h-3.5 w-3.5" /> Urgent (noul)
            </div>
            <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
              <div className="h-full bg-sky-400 rounded-full transition-all duration-500" style={{ width: `${Math.round(resp.urgent * 100)}%` }} />
            </div>
            <div className="mt-1.5 text-[11px] tabular-nums text-zinc-500">{(resp.urgent * 100).toFixed(0)}%</div>
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> Needs human (noul)
            </div>
            <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
              <div className="h-full bg-amber-400 rounded-full transition-all duration-500" style={{ width: `${Math.round(resp.needs_human * 100)}%` }} />
            </div>
            <div className="mt-1.5 text-[11px] tabular-nums text-zinc-500">{(resp.needs_human * 100).toFixed(0)}%</div>
          </div>
        </section>

        <section className="flex flex-wrap items-center gap-4 text-[11px] text-zinc-500 md:col-span-2">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" /> {triage.latency_ms} ms
          </span>
          <span>{triage.input_tokens.toLocaleString()} input tokens</span>
          <span className="inline-flex items-center gap-1">
            <Coins className="h-3.5 w-3.5" /> ${triage.cost_usd.toFixed(6)}
          </span>
        </section>
      </div>

      {/* Thinking timeline */}
      <div className="mt-5 border-t border-zinc-800 pt-4">
        <div className="text-xs font-medium text-zinc-400 mb-2">Agent thinking timeline</div>
        <ol className="space-y-1.5 text-[11px]">
          {[
            { icon: Sparkles, label: "Triage", detail: `Jev fan-out · ${triage.latency_ms} ms` },
            { icon: FileSearch, label: "Retrieve", detail: reply ? `${reply.cited_article_ids.length} KB article(s)` : reply === null && triage.fired_rules.length > 0 ? "skipped — escalated" : "—" },
            { icon: PenLine, label: "Draft", detail: reply ? "reply drafted" : "—" },
            { icon: CheckCircle2, label: "Check", detail: reply ? `self-confidence ${(reply.self_confidence * 100).toFixed(0)}%` : "—" },
          ].map((s) => (
            <li key={s.label} className="flex items-center gap-2 text-zinc-400">
              <s.icon className="h-3.5 w-3.5 text-sky-400" />
              <span className="font-medium text-zinc-300">{s.label}</span>
              <span className="text-zinc-500">· {s.detail}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Cited KB articles */}
      {cited.length > 0 && (
        <div className="mt-5 border-t border-zinc-800 pt-4">
          <div className="text-xs font-medium text-zinc-400 mb-2">Cited knowledge base articles</div>
          <div className="flex flex-wrap gap-2">
            {cited.map((a) => (
              <button
                key={a.id}
                onClick={() => document.getElementById(`kb-${a.id}`)?.scrollIntoView({ behavior: "smooth" })}
                className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-300 hover:border-sky-500/50 hover:text-sky-300 transition-colors"
                title={a.title}
              >
                <MessageSquare className="mr-1 inline h-3 w-3" />
                {a.title}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
