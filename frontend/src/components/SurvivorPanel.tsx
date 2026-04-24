import { useState } from "react";
import { User } from "lucide-react";
import { useMissionStore, type SurvivorRecord } from "@/stores/missionStore";
import SurvivorReportCard from "./SurvivorReportCard";

const PRIORITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MODERATE: 2,
  LOW: 3,
};

const PRIORITY_COLOR: Record<string, string> = {
  CRITICAL: "text-red-400 border-red-500/50",
  HIGH:     "text-orange-400 border-orange-500/50",
  MODERATE: "text-yellow-400 border-yellow-500/50",
  LOW:      "text-green-400 border-green-500/50",
};

const SurvivorPanel = () => {
  const survivorsFoundList = useMissionStore((s) => s.survivorsFoundList);
  const [selected, setSelected] = useState<SurvivorRecord | null>(null);

  const sorted = [...survivorsFoundList].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.survivor_profile?.medical_priority] ?? 4;
    const pb = PRIORITY_ORDER[b.survivor_profile?.medical_priority] ?? 4;
    return pa !== pb ? pa - pb : a.round - b.round;
  });

  return (
    <>
      <div className="border border-border bg-card/50">
        <div className="px-4 py-2.5 border-b border-border bg-secondary/30">
          <h3 className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
            Survivors Found
          </h3>
        </div>

        {sorted.length === 0 ? (
          <div className="px-4 py-3 flex items-center gap-2">
            <User size={11} className="text-muted-foreground" />
            <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-wider">
              None detected
            </span>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {sorted.map((rec, i) => {
              const priority = rec.survivor_profile?.medical_priority ?? "UNKNOWN";
              const colorClass = PRIORITY_COLOR[priority] ?? "text-muted-foreground border-border";
              const numPeople = rec.survivor_profile?.num_people ?? 1;

              return (
                <button
                  key={i}
                  onClick={() => setSelected(rec)}
                  className="w-full text-left px-4 py-2.5 hover:bg-secondary/30 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`font-mono text-[8px] tracking-[0.15em] uppercase border px-1.5 py-0.5 ${colorClass}`}>
                        {priority}
                      </span>
                      <span className="font-mono text-[10px] text-foreground">
                        {rec.cell_id}
                      </span>
                    </div>
                    <span className="font-mono text-[9px] text-muted-foreground">
                      {numPeople}p
                    </span>
                  </div>
                  <div className="mt-0.5 pl-0 flex items-center gap-2">
                    <span className="font-mono text-[8px] text-muted-foreground">
                      R{rec.round}
                    </span>
                    {rec.drone_id && (
                      <span className="font-mono text-[8px] text-muted-foreground">
                        · {rec.drone_id}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
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

export default SurvivorPanel;
