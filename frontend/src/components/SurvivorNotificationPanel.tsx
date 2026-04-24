import { useState } from "react";
import { User, AlertTriangle } from "lucide-react";
import { useMissionStore, type SurvivorRecord } from "@/stores/missionStore";
import SurvivorReportCard from "./SurvivorReportCard";

const PRIORITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  HIGH:     1,
  MODERATE: 2,
  LOW:      3,
};

const PRIORITY_STYLE: Record<string, string> = {
  CRITICAL: "text-red-400 border-red-500/50 bg-red-500/10",
  HIGH:     "text-orange-400 border-orange-500/50 bg-orange-500/10",
  MODERATE: "text-yellow-400 border-yellow-500/50 bg-yellow-500/10",
  LOW:      "text-green-400 border-green-500/50 bg-green-500/10",
};

const SurvivorNotificationPanel = () => {
  const survivorsFoundList = useMissionStore((s) => s.survivorsFoundList);
  const [selected, setSelected] = useState<SurvivorRecord | null>(null);

  const sorted = [...survivorsFoundList].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.survivor_profile?.medical_priority] ?? 4;
    const pb = PRIORITY_ORDER[b.survivor_profile?.medical_priority] ?? 4;
    return pa !== pb ? pa - pb : a.round - b.round;
  });

  return (
    <>
      <div className="flex-1 flex flex-col overflow-hidden bg-card/30 border-t border-border">
        {/* Header */}
        <div className="px-4 py-2 border-b border-border bg-secondary/30 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <User size={11} className="text-amber-400" />
            <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
              Survivor Notifications
            </span>
          </div>
          {sorted.length > 0 && (
            <span className="font-mono text-[9px] text-amber-400 border border-amber-400/30 px-1.5 py-0.5">
              {sorted.length} FOUND
            </span>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground/30">
              <User size={28} className="opacity-30" />
              <span className="font-mono text-[9px] uppercase tracking-wider">None detected</span>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {sorted.map((rec, i) => {
                const priority = rec.survivor_profile?.medical_priority ?? "UNKNOWN";
                const style    = PRIORITY_STYLE[priority] ?? "text-muted-foreground border-border bg-muted/10";
                const numPpl   = rec.survivor_profile?.num_people ?? 1;

                return (
                  <button
                    key={i}
                    onClick={() => setSelected(rec)}
                    className="w-full text-left px-4 py-3 hover:bg-secondary/30 transition-colors flex items-center gap-3"
                  >
                    {/* Priority pulse dot */}
                    <div className={`relative shrink-0 ${priority === "CRITICAL" ? "animate-pulse" : ""}`}>
                      <AlertTriangle size={14} className={priority === "CRITICAL" ? "text-red-400" : "text-muted-foreground/40"} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={`font-mono text-[8px] tracking-[0.15em] uppercase border px-1.5 py-0.5 shrink-0 ${style}`}>
                          {priority}
                        </span>
                        <span className="font-mono text-[10px] text-foreground truncate">
                          {rec.tile_id ?? "—"}
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-[8px] text-muted-foreground">
                          {numPpl} person{numPpl !== 1 ? "s" : ""}
                        </span>
                        <span className="font-mono text-[8px] text-muted-foreground">
                          Tick {rec.round}
                        </span>
                        {rec.drone_id && (
                          <span className="font-mono text-[8px] text-muted-foreground">
                            {rec.drone_id}
                          </span>
                        )}
                      </div>
                    </div>

                    <span className="font-mono text-[9px] text-muted-foreground/50 shrink-0">›</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {selected && (
        <SurvivorReportCard
          record={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
};

export default SurvivorNotificationPanel;
