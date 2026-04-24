import { useMissionStore } from "@/stores/missionStore";
import { BrainCircuit } from "lucide-react";

const DRONE_IDS = ["DRONE_A", "DRONE_B", "DRONE_C"] as const;

const DRONE_LABEL: Record<string, string> = {
  DRONE_A: "A",
  DRONE_B: "B",
  DRONE_C: "C",
};

const DRONE_BORDER: Record<string, string> = {
  DRONE_A: "border-red-400/40",
  DRONE_B: "border-purple-400/40",
  DRONE_C: "border-cyan-400/40",
};

const DRONE_TEXT: Record<string, string> = {
  DRONE_A: "text-red-400",
  DRONE_B: "text-purple-400",
  DRONE_C: "text-cyan-400",
};

export function LiveCotPanel() {
  const lastReasoning = useMissionStore((s) => s.lastReasoningByDrone);
  const active = DRONE_IDS.filter((id) => lastReasoning[id]);
  if (active.length === 0) return null;

  return (
    <div className="border border-primary/15 bg-primary/3 rounded-sm p-2 mb-3 space-y-1.5">
      <div className="flex items-center gap-1.5 mb-1">
        <BrainCircuit size={11} className="text-primary animate-pulse" />
        <span className="text-[8px] tracking-[0.25em] font-bold text-primary/60 uppercase">
          Live Agent Reasoning
        </span>
      </div>
      {DRONE_IDS.map((id) => {
        const reasoning = lastReasoning[id];
        if (!reasoning) return null;
        return (
          <div
            key={id}
            className={`flex items-start gap-2 border-l-2 pl-2 ${DRONE_BORDER[id]}`}
          >
            <span className={`text-[9px] font-bold shrink-0 mt-0.5 ${DRONE_TEXT[id]}`}>
              {DRONE_LABEL[id]}
            </span>
            <span className="text-[10px] text-foreground/60 leading-relaxed line-clamp-2">
              {reasoning}
            </span>
          </div>
        );
      })}
    </div>
  );
}
