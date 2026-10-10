import { useMemo, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";
import { Clock, Zap, Coins, TrendingUp } from "lucide-react";
import type { Ticket, TriageRecord } from "@/lib/supabase";
import { DEPT_COLORS, LLM_JUDGE_COSTS } from "@/lib/supabase";
import type { Department } from "@/lib/supabase";

interface Props {
  tickets: Ticket[];
  triage: TriageRecord[];
  judgeCostsEditable?: boolean;
}

export default function StatsPage({ tickets, triage, judgeCostsEditable }: Props) {
  const [judgeInput, setJudgeInput] = useState(LLM_JUDGE_COSTS.inputPerMillion);
  const [judgeOutput, setJudgeOutput] = useState(LLM_JUDGE_COSTS.outputPerMillion);

  const routeDist = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of tickets) {
      const r = t.route ?? "unrouted";
      counts[r] = (counts[r] ?? 0) + 1;
    }
    return Object.entries(counts).map(([name, value]) => ({
      name: DEPT_COLORS[name as Department]?.label ?? "Unrouted",
      value,
      color:
        name === "billing" ? "#34d399"
        : name === "technical" ? "#38bdf8"
        : name === "account" ? "#a78bfa"
        : name === "human" ? "#fbbf24"
        : "#52525b",
    }));
  }, [tickets]);

  const avgLatency = triage.length
    ? Math.round(triage.reduce((s, t) => s + t.latency_ms, 0) / triage.length)
    : 0;
  const totalCost = triage.reduce((s, t) => s + Number(t.cost_usd), 0);
  const autoReplied = tickets.filter((t) => t.status === "auto_replied").length;
  const automationRate = tickets.length ? Math.round((autoReplied / tickets.length) * 100) : 0;
  const p1Count = tickets.filter((t) => t.priority === "P1").length;

  const judgeCostUsd = useMemo(() => {
    // Assume a judge LLM reads ticket + full context and writes a full evaluation per ticket.
    const tokensPerTicket = 1200;
    const inputCost = (tickets.length * tokensPerTicket * judgeInput) / 1_000_000;
    const outputCost = (tickets.length * 300 * judgeOutput) / 1_000_000;
    return inputCost + outputCost;
  }, [tickets.length, judgeInput, judgeOutput]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Zap} label="P1 tickets" value={String(p1Count)} accent="text-red-300" />
        <StatCard icon={Clock} label="Avg Jev latency" value={`${avgLatency} ms`} accent="text-sky-300" />
        <StatCard icon={TrendingUp} label="Automation rate" value={`${automationRate}%`} accent="text-emerald-300" />
        <StatCard icon={Coins} label="Total Jev cost" value={`$${totalCost.toFixed(6)}`} accent="text-violet-300" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="text-sm font-medium text-zinc-200 mb-2">Route distribution</div>
          {routeDist.length === 0 ? (
            <div className="py-12 text-center text-sm text-zinc-500">No tickets yet.</div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={routeDist} dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={3}>
                    {routeDist.map((d) => (
                      <Cell key={d.name} fill={d.color} stroke="#18181b" />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }}
                    itemStyle={{ color: "#e4e4e7" }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12, color: "#a1a1aa" }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
          <div className="flex items-center gap-1.5 text-sm font-medium text-zinc-200 mb-2">
            <Coins className="h-4 w-4 text-violet-400" />
            Jev cost vs. LLM-judge estimate
          </div>
          <div className="mt-4 space-y-3">
            <CostRow label="Jev triage (actual)" value={totalCost} highlight />
            <CostRow label={`LLM judge (${tickets.length} tickets)`} value={judgeCostUsd} />
            {tickets.length > 0 && (
              <div className="text-[11px] text-zinc-500">
                Jev used {(triage.reduce((s, t) => s + t.input_tokens, 0)).toLocaleString()} input tokens across {triage.length} triage runs.
                The judge estimate assumes ~1,200 input tokens and 300 output tokens per ticket.
              </div>
            )}
          </div>
          {judgeCostsEditable && (
            <div className="mt-5 border-t border-zinc-800 pt-4 space-y-3">
              <div className="text-xs font-medium text-zinc-400">Judge cost constants (per million tokens)</div>
              <label className="flex items-center justify-between text-xs text-zinc-300">
                Input
                <input
                  type="number"
                  step={0.5}
                  min={0}
                  value={judgeInput}
                  onChange={(e) => setJudgeInput(parseFloat(e.target.value) || 0)}
                  className="w-24 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-right tabular-nums text-zinc-200"
                />
              </label>
              <label className="flex items-center justify-between text-xs text-zinc-300">
                Output
                <input
                  type="number"
                  step={1}
                  min={0}
                  value={judgeOutput}
                  onChange={(e) => setJudgeOutput(parseFloat(e.target.value) || 0)}
                  className="w-24 rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-right tabular-nums text-zinc-200"
                />
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, accent }: { icon: typeof Zap; label: string; value: string; accent: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className={`mt-1.5 text-xl font-semibold ${accent}`}>{value}</div>
    </div>
  );
}

function CostRow({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <div className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${
      highlight ? "border-sky-500/30 bg-sky-500/10 text-sky-200" : "border-zinc-800 bg-zinc-950/60 text-zinc-300"
    }`}>
      <span>{label}</span>
      <span className="tabular-nums font-semibold">${value.toFixed(6)}</span>
    </div>
  );
}
