import { MessageSquare, Sparkles, GitBranch, Bot, Users, FileText } from "lucide-react";

export default function ArchitectureStrip() {
  const steps = [
    { icon: MessageSquare, label: "Ticket", detail: "Customer message" },
    { icon: Sparkles, label: "Jev fan-out", detail: "4 questions · 1 request" },
    { icon: GitBranch, label: "Routing code", detail: "Thresholds in code" },
  ];
  return (
    <div className="border-b border-zinc-800/60 bg-zinc-900/30">
      <div className="max-w-[1600px] mx-auto px-4 lg:px-6 py-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {steps.map((s, i) => (
            <div key={s.label} className="flex items-center gap-2">
              {i > 0 && <span className="text-zinc-600">→</span>}
              <div className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5">
                <s.icon className="h-3.5 w-3.5 text-sky-400" />
                <span className="font-medium text-zinc-200">{s.label}</span>
                <span className="hidden sm:inline text-zinc-500">· {s.detail}</span>
              </div>
            </div>
          ))}
          <span className="text-zinc-600">→</span>
          <div className="flex items-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5">
            <Bot className="h-3.5 w-3.5 text-emerald-400" />
            <span className="font-medium text-emerald-300">Billing</span>
            <span className="text-zinc-500">RAG agent</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-md border border-sky-500/30 bg-sky-500/10 px-2.5 py-1.5">
            <Bot className="h-3.5 w-3.5 text-sky-400" />
            <span className="font-medium text-sky-300">Technical</span>
            <span className="text-zinc-500">RAG agent</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-md border border-violet-500/30 bg-violet-500/10 px-2.5 py-1.5">
            <Bot className="h-3.5 w-3.5 text-violet-400" />
            <span className="font-medium text-violet-300">Account</span>
            <span className="text-zinc-500">RAG agent</span>
          </div>
          <span className="text-zinc-500">or</span>
          <div className="flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5">
            <Users className="h-3.5 w-3.5 text-amber-400" />
            <span className="font-medium text-amber-300">Human queue</span>
          </div>
          <span className="text-zinc-600">→</span>
          <div className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1.5">
            <FileText className="h-3.5 w-3.5 text-zinc-400" />
            <span className="font-medium text-zinc-200">Reply draft</span>
          </div>
        </div>
      </div>
    </div>
  );
}
