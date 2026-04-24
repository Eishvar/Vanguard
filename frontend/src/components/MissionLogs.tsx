import { useRef, useEffect, useState, useMemo } from "react";
import { useMissionStore } from "@/stores/missionStore";
import { Zap, Search, Pin } from "lucide-react";
import { LogEntryRow } from "./LogEntry";
import { LiveCotPanel } from "./LiveCotPanel";

type LogFilter = "all" | "drones" | "supervisor" | "critical";

const FILTER_LABELS: { id: LogFilter; label: string }[] = [
  { id: "all",        label: "ALL" },
  { id: "drones",     label: "DRONES" },
  { id: "supervisor", label: "SUPV" },
  { id: "critical",   label: "CRITICAL" },
];

const MissionLogs = () => {
  const phaseLogs = useMissionStore((s) => s.phaseLogs);
  const execEndRef = useRef<HTMLDivElement>(null);

  const [filter, setFilter]           = useState<LogFilter>("all");
  const [search, setSearch]           = useState("");
  const [pinToBottom, setPinToBottom] = useState(true);

  // Auto-scroll on new log entries
  useEffect(() => {
    if (pinToBottom) {
      execEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [phaseLogs[2]?.length, pinToBottom]);

  const filtered = useMemo(() => {
    const logs = phaseLogs[2] ?? [];
    return logs.filter((e) => {
      if (filter === "drones"     && !e.source?.startsWith("DRONE_"))   return false;
      if (filter === "supervisor" && e.source !== "SUPERVISOR")          return false;
      if (filter === "critical"   && e.type !== "error" && e.type !== "warning") return false;
      if (search && !e.message.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [phaseLogs[2], filter, search]);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-card/30">

      {/* Header */}
      <div className="px-4 py-2.5 border-b border-border bg-secondary/30 shrink-0">
        <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
          Chain of Thought Stream
        </span>
      </div>

      {/* Filter / search toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0 flex-wrap">
        {/* Filter pills */}
        <div className="flex items-center gap-1">
          {FILTER_LABELS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={`px-2 py-0.5 font-mono text-[8px] tracking-wider uppercase rounded-sm transition-colors
                ${filter === id
                  ? "bg-primary/20 text-primary border border-primary/40"
                  : "text-muted-foreground/60 hover:text-foreground border border-transparent hover:border-border"
                }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Search input */}
        <div className="flex items-center gap-1 flex-1 min-w-[120px] border border-border rounded-sm px-2 py-0.5 bg-muted/10">
          <Search size={10} className="text-muted-foreground/40 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="search logs..."
            className="flex-1 bg-transparent font-mono text-[10px] text-foreground/80
              placeholder:text-muted-foreground/30 outline-none min-w-0"
          />
        </div>

        {/* Pin-to-bottom toggle */}
        <button
          onClick={() => setPinToBottom((p) => !p)}
          title={pinToBottom ? "Unpin (stop auto-scroll)" : "Pin to bottom (auto-scroll)"}
          className={`flex items-center gap-1 px-2 py-0.5 font-mono text-[8px] tracking-wider
            uppercase rounded-sm border transition-colors
            ${pinToBottom
              ? "bg-primary/15 border-primary/40 text-primary"
              : "border-border text-muted-foreground/50 hover:text-foreground"
            }`}
        >
          <Pin size={9} className={pinToBottom ? "fill-primary" : ""} />
          PIN
        </button>
      </div>

      <div className="flex-1 overflow-y-auto font-mono text-xs">
        <div className="p-4 space-y-0.5">
          <LiveCotPanel />

          {filtered.length === 0 ? (
            <div className="text-muted-foreground/40 text-center py-12">
              <Zap size={24} className="mx-auto mb-3 opacity-30" />
              <div>
                {phaseLogs[2]?.length > 0
                  ? "No entries match the current filter."
                  : "Awaiting execution..."}
              </div>
            </div>
          ) : (
            filtered.map((entry, i) => (
              <LogEntryRow key={i} entry={entry} />
            ))
          )}
          <div ref={execEndRef} />
        </div>
      </div>
    </div>
  );
};

export default MissionLogs;
