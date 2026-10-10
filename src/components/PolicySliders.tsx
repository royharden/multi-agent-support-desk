import { SlidersHorizontal } from "lucide-react";
import { RoutingPolicy } from "@/lib/routing";

interface Props {
  policy: RoutingPolicy;
  onChange: (p: RoutingPolicy) => void;
}

const FIELDS: { key: keyof RoutingPolicy; label: string; hint: string }[] = [
  { key: "humanThreshold", label: "Human threshold", hint: "needs_human ≥ → human" },
  { key: "furyScore", label: "Fury score", hint: "frustration ≥ → human" },
  { key: "minDeptConfidence", label: "Min dept confidence", hint: "below → human" },
  { key: "urgentThreshold", label: "Urgent threshold", hint: "≥ → P1" },
  { key: "agentMinConfidence", label: "Agent min confidence", hint: "below → human review" },
];

export default function PolicySliders({ policy, onChange }: Props) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center gap-1.5 text-sm font-medium text-zinc-200">
        <SlidersHorizontal className="h-4 w-4 text-sky-400" />
        Routing policy (persisted with each triage)
      </div>
      <div className="mt-4 space-y-4">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <div className="flex items-center justify-between text-xs">
              <span className="text-zinc-300">
                {f.label} <span className="ml-1 text-[10px] text-zinc-500">{f.hint}</span>
              </span>
              <span className="tabular-nums text-zinc-400">{policy[f.key].toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={policy[f.key]}
              onChange={(e) => onChange({ ...policy, [f.key]: parseFloat(e.target.value) })}
              className="mt-1.5 w-full accent-sky-400"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
