import { useMissionStore } from "@/stores/missionStore";
import { User } from "lucide-react";

const MissionIntel = () => {
  const { survivorsFound } = useMissionStore();

  return (
    <div className="border border-border bg-card/50">
      <div className="px-4 py-2.5 border-b border-border bg-secondary/30">
        <h3 className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
          Mission Intel
        </h3>
      </div>
      <div className="p-6 flex flex-col items-center">
        <User size={24} className="text-warning mb-2" />
        <div className="font-display text-4xl font-bold text-warning">
          {survivorsFound}
        </div>
        <span className="font-mono text-[9px] text-muted-foreground tracking-wider mt-1 uppercase">
          Survivors Found
        </span>
      </div>
    </div>
  );
};

export default MissionIntel;
