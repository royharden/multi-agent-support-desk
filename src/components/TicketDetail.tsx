import { Ticket, TriageRecord, Reply, KbArticle } from "@/lib/supabase";
import { RoutingPolicy } from "@/lib/routing";
import JevPanel from "./JevPanel";
import ReplyDraft from "./ReplyDraft";
import FiredRules from "./FiredRules";
import PolicySliders from "./PolicySliders";

interface Props {
  ticket: Ticket | null;
  triage: TriageRecord | null;
  reply: Reply | null;
  kb: KbArticle[];
  policy: RoutingPolicy;
  onPolicyChange: (p: RoutingPolicy) => void;
  onRefresh: () => void;
}

export default function TicketDetail({ ticket, triage, reply, kb, policy, onPolicyChange, onRefresh }: Props) {
  if (!ticket) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 text-center text-sm text-zinc-500 lg:h-[calc(100vh-320px)] flex flex-col items-center justify-center">
        Select a ticket from the inbox to see the Jev triage and agent draft.
      </div>
    );
  }
  return (
    <div className="space-y-4 overflow-y-auto lg:h-[calc(100vh-320px)] pr-1">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
        <div className="text-sm font-medium text-zinc-200">{ticket.subject}</div>
        <div className="mt-1 text-[11px] text-zinc-500">
          Tier: {ticket.customer_tier} · Prior contacts (7d): {ticket.prior_contacts_7d}
        </div>
        <p className="mt-3 text-sm leading-relaxed text-zinc-300 whitespace-pre-wrap">{ticket.body}</p>
      </div>

      {triage ? (
        <>
          <FiredRules rules={triage.fired_rules} />
          <JevPanel triage={triage} reply={reply} kb={kb} />
        </>
      ) : (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 text-sm text-zinc-500">
          No Jev triage recorded for this ticket yet.
        </div>
      )}

      {reply && <ReplyDraft reply={reply} kb={kb} />}

      <PolicySliders policy={policy} onChange={onPolicyChange} />
    </div>
  );
}
