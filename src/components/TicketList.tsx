import type { Ticket, TriageRecord, Department } from "@/lib/supabase";
import { DEPT_COLORS, PRIORITY_STYLES, FRUSTRATION_EMOJI } from "@/lib/supabase";

interface Props {
  tickets: Ticket[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  triage: Record<string, TriageRecord>;
}

export default function TicketList({ tickets, selectedId, onSelect, triage }: Props) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden lg:h-[calc(100vh-320px)] flex flex-col">
      <div className="border-b border-zinc-800 px-4 py-3 text-sm font-medium text-zinc-300">
        Inbox <span className="ml-1 text-xs text-zinc-500">({tickets.length})</span>
      </div>
      <div className="overflow-y-auto flex-1 divide-y divide-zinc-800/60">
        {tickets.length === 0 && (
          <div className="px-4 py-8 text-sm text-zinc-500 text-center">
            No tickets yet. Click "Load demo inbox" to simulate 8 tickets through Jev triage.
          </div>
        )}
        {tickets.map((t) => {
          const tr = triage[t.id];
          const dept = (t.route ?? "human") as Department;
          const c = DEPT_COLORS[dept] ?? DEPT_COLORS.human;
          return (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              className={`w-full text-left px-4 py-3 transition-colors ${
                selectedId === t.id ? "bg-sky-500/10" : "hover:bg-zinc-900"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${c.dot}`} />
                <span className="text-xs font-medium text-zinc-300 truncate flex-1">{t.subject}</span>
                {t.priority && (
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${PRIORITY_STYLES[t.priority]}`}>
                    {t.priority}
                  </span>
                )}
              </div>
              <div className="mt-1.5 flex items-center gap-2 text-[11px] text-zinc-500">
                <span>{c.label}</span>
                {tr && <span title="Frustration">{FRUSTRATION_EMOJI(tr.jev_response.frustration.score)}</span>}
                <span className="ml-auto uppercase tracking-wide">{t.status.replace("_", " ")}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
