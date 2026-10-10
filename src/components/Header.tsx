import { Radio, BarChart3, BookOpen, Bot, Zap } from "lucide-react";

interface Props {
  mockAgents: boolean;
  onToggleMock: () => void;
  page: "desk" | "stats" | "kb";
  onNavigate: (page: "desk" | "stats" | "kb") => void;
}

export default function Header({ mockAgents, onToggleMock, page, onNavigate }: Props) {
  return (
    <header className="border-b border-zinc-800 bg-zinc-900/60 backdrop-blur sticky top-0 z-20">
      <div className="max-w-[1600px] mx-auto px-4 lg:px-6 py-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-500/15 border border-sky-500/30">
              <Radio className="h-5 w-5 text-sky-400" />
            </div>
            <div>
              <h1 className="text-base lg:text-lg font-semibold leading-tight text-zinc-50">
                Multi-Agent Support Desk: <span className="text-zinc-400 font-normal">Jev triages, specialists answer, humans handle the hard ones.</span>
              </h1>
              <div className="mt-1 flex items-center gap-2 text-[11px] text-zinc-500">
                <Zap className="h-3 w-3 text-sky-400" />
                TypeSafe <span className="font-mono">jev-1.13.0</span> · System 1 triage → System 2 specialists
              </div>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              onClick={onToggleMock}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                mockAgents
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15"
                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15"
              }`}
              title="Jev triage always runs live; this toggles the specialist LLM agents"
            >
              <Bot className="h-4 w-4" />
              {mockAgents ? "Mock agents" : "Live LLM"}
            </button>
            <nav className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-950 p-1">
              {(
                [
                  ["desk", "Desk", Radio],
                  ["stats", "Stats", BarChart3],
                  ["kb", "Knowledge base", BookOpen],
                ] as const
              ).map(([key, label, Icon]) => (
                <button
                  key={key}
                  onClick={() => onNavigate(key)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    page === key
                      ? "bg-sky-500/15 text-sky-300"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      </div>
    </header>
  );
}
