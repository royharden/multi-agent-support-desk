import { useState } from "react";
import { Loader2, X } from "lucide-react";
import type { Ticket } from "@/lib/supabase";
import { supabase } from "@/lib/supabase";
import { processTicket } from "@/lib/workflow";
import { RoutingPolicy } from "@/lib/routing";

interface Props {
  onClose: () => void;
  onCreated: () => void;
  policy: RoutingPolicy;
  mockAgents: boolean;
}

export default function NewTicketModal({ onClose, onCreated, policy, mockAgents }: Props) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [tier, setTier] = useState("pro");
  const [prior, setPrior] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!subject.trim() || !body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const { data, error } = await supabase
        .from("tickets")
        .insert({ subject, body, customer_tier: tier, prior_contacts_7d: prior })
        .select()
        .single();
      if (error) throw new Error(error.message);
      const ticket = data as unknown as Ticket;
      await processTicket(ticket, policy, mockAgents);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to create ticket");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-zinc-800 bg-zinc-900 p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-zinc-100">New ticket</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300">
            <X className="h-4 w-4" />
          </button>
        </div>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="Subject"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Customer message"
          rows={5}
          className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500"
        />
        <div className="flex gap-3">
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
          >
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Enterprise</option>
          </select>
          <input
            type="number"
            min={0}
            value={prior}
            onChange={(e) => setPrior(parseInt(e.target.value) || 0)}
            className="w-32 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200"
            title="Prior contacts in last 7 days"
          />
        </div>
        {error && <div className="text-xs text-red-300">{error}</div>}
        <button
          onClick={submit}
          disabled={busy || !subject.trim() || !body.trim()}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400 transition-colors disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Create & triage
        </button>
      </div>
    </div>
  );
}
