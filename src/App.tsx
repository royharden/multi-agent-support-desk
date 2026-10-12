import { useState, useCallback, useEffect } from "react";
import { Loader2, Inbox, BarChart3, BookOpen, Users, AlertTriangle } from "lucide-react";
import { supabase, type Ticket, type TriageRecord, type Reply, type KbArticle } from "@/lib/supabase";
import { DEFAULT_POLICY, type RoutingPolicy } from "@/lib/routing";
import { DEMO_TICKETS } from "@/lib/demoTickets";
import { processTicket, createTickets, PRESETS } from "@/lib/workflow";
import Header from "@/components/Header";
import ArchitectureStrip from "@/components/ArchitectureStrip";
import TicketList from "@/components/TicketList";
import TicketDetail from "@/components/TicketDetail";
import HumanQueue from "@/components/HumanQueue";
import StatsPage from "@/components/StatsPage";
import KbPage from "@/components/KbPage";
import NewTicketModal from "@/components/NewTicketModal";

export default function App() {
  const [page, setPage] = useState<"desk" | "stats" | "kb">("desk");
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [triage, setTriage] = useState<Record<string, TriageRecord>>({});
  const [replies, setReplies] = useState<Record<string, Reply>>({});
  const [kb, setKb] = useState<KbArticle[]>([]);
  const [policy, setPolicy] = useState<RoutingPolicy>(DEFAULT_POLICY);
  const [mockAgents, setMockAgents] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNewTicket, setShowNewTicket] = useState(false);
  const [queueFilter, setQueueFilter] = useState(false);

  const fetchTickets = useCallback(async () => {
    const { data, error } = await supabase
      .from("tickets")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else setTickets(data as Ticket[]);
  }, []);

  const fetchTriage = useCallback(async () => {
    const { data } = await supabase.from("triage").select("*").order("created_at", { ascending: false });
    if (data) {
      const map: Record<string, TriageRecord> = {};
      for (const row of data as unknown as TriageRecord[]) {
        if (!map[row.ticket_id]) map[row.ticket_id] = row;
      }
      setTriage(map);
    }
  }, []);

  const fetchReplies = useCallback(async () => {
    const { data } = await supabase.from("replies").select("*").order("created_at", { ascending: false });
    if (data) {
      const map: Record<string, Reply> = {};
      for (const row of data as unknown as Reply[]) {
        if (!map[row.ticket_id]) map[row.ticket_id] = row;
      }
      setReplies(map);
    }
  }, []);

  const fetchKb = useCallback(async () => {
    const { data } = await supabase.from("kb_articles").select("id, department, title, body").order("department");
    if (data) setKb(data as KbArticle[]);
  }, []);

  useEffect(() => {
    fetchTickets();
    fetchTriage();
    fetchReplies();
    fetchKb();
  }, [fetchTickets, fetchTriage, fetchReplies, fetchKb]);

  const loadDemoInbox = async () => {
    setLoading(true);
    setError(null);
    try {
      const inserts = DEMO_TICKETS.map((t) => ({
        subject: t.subject,
        body: t.body,
        customer_tier: t.customer_tier,
        prior_contacts_7d: t.prior_contacts_7d,
      }));
      const created = await createTickets(inserts);

      for (const ticket of created) {
        const result = await processTicket(ticket, policy, mockAgents);
        if (result.error) setError(result.error);
      }
      await refreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to load demo inbox");
    } finally {
      setLoading(false);
    }
  };

  const refreshAll = useCallback(async () => {
    await fetchTickets();
    await fetchTriage();
    await fetchReplies();
  }, [fetchTickets, fetchTriage, fetchReplies]);

  const selected = tickets.find((t) => t.id === selectedId) ?? null;
  const escalated = tickets.filter((t) => t.status === "escalated" || t.route === "human");
  const visibleTickets = queueFilter ? escalated : tickets;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <Header
        mockAgents={mockAgents}
        onToggleMock={() => setMockAgents((m) => !m)}
        page={page}
        onNavigate={setPage}
      />
      <ArchitectureStrip />

      <main className="max-w-[1600px] mx-auto px-4 lg:px-6 pb-12">
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-red-400 hover:text-red-300">
              Dismiss
            </button>
          </div>
        )}

        {page === "desk" && (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <button
                onClick={loadDemoInbox}
                disabled={loading}
                className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-400 disabled:opacity-50 transition-colors"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Inbox className="h-4 w-4" />}
                Load demo inbox
              </button>
              <button
                onClick={() => setShowNewTicket(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium text-zinc-200 hover:bg-zinc-800 transition-colors"
              >
                New ticket
              </button>
              <button
                onClick={() => setQueueFilter((q) => !q)}
                className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  queueFilter
                    ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                    : "border-zinc-700 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                }`}
              >
                <Users className="h-4 w-4" />
                {queueFilter ? "Showing escalations" : "Show escalations only"}
              </button>
              <div className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
                {Object.entries(PRESETS).map(([name, p]) => (
                  <button
                    key={name}
                    onClick={() => setPolicy({ ...DEFAULT_POLICY, ...p })}
                    className="rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 hover:bg-zinc-800 transition-colors"
                  >
                    {name}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)_320px] gap-4">
              <TicketList
                tickets={visibleTickets}
                selectedId={selectedId}
                onSelect={setSelectedId}
                triage={triage}
              />
              <TicketDetail
                ticket={selected}
                triage={triage[selectedId ?? ""] ?? null}
                reply={replies[selectedId ?? ""] ?? null}
                kb={kb}
                policy={policy}
                onPolicyChange={setPolicy}
                onRefresh={refreshAll}
              />
              <HumanQueue
                tickets={escalated}
                selectedId={selectedId}
                onSelect={setSelectedId}
                triage={triage}
                replies={replies}
                kb={kb}
                onRefresh={refreshAll}
              />
            </div>
          </>
        )}

        {page === "stats" && (
          <StatsPage tickets={tickets} triage={Object.values(triage)} judgeCostsEditable />
        )}

        {page === "kb" && <KbPage articles={kb} onRefresh={fetchKb} />}
      </main>

      {showNewTicket && (
        <NewTicketModal
          onClose={() => setShowNewTicket(false)}
          onCreated={refreshAll}
          policy={policy}
          mockAgents={mockAgents}
        />
      )}
    </div>
  );
}
