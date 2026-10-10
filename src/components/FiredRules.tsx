import { AlertTriangle } from "lucide-react";

interface Props {
  rules: { rule: string; detail: string }[];
}

const RULE_LABELS: Record<string, string> = {
  needs_human: "Human required",
  fury_score: "Fury threshold",
  department: "Department uncertain / low confidence",
};

export default function FiredRules({ rules }: Props) {
  if (rules.length === 0) {
    return (
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-300 inline-flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5" />
        No escalation rules fired — handled by the specialist agent.
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
        <AlertTriangle className="h-3.5 w-3.5" />
        Escalation rules fired ({rules.length})
      </div>
      <ul className="mt-2 space-y-1.5">
        {rules.map((r, i) => (
          <li key={i} className="text-[11px] text-amber-200/90">
            <span className="font-semibold">{RULE_LABELS[r.rule] ?? r.rule}:</span> {r.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}
