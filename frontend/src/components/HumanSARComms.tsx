import { useState } from "react";
import { Radio, Send, CheckCircle2 } from "lucide-react";
import { useMissionStore } from "@/stores/missionStore";

interface SARTeam {
  id: string;
  callsign: string;
  sector: string;
  status: "STANDBY" | "ACTIVE" | "RESTING" | "EVACUATING";
  personnel: number;
  lastContact: string;
}

const SAR_TEAMS: SARTeam[] = [
  { id: "ALPHA",   callsign: "TEAM ALPHA",   sector: "Sector 4",  status: "ACTIVE",     personnel: 6, lastContact: "2m ago" },
  { id: "BRAVO",   callsign: "TEAM BRAVO",   sector: "Sector 9",  status: "ACTIVE",     personnel: 5, lastContact: "5m ago" },
  { id: "CHARLIE", callsign: "TEAM CHARLIE", sector: "Sector 12", status: "STANDBY",    personnel: 4, lastContact: "12m ago" },
  { id: "DELTA",   callsign: "TEAM DELTA",   sector: "Sector 7",  status: "EVACUATING", personnel: 6, lastContact: "1m ago" },
];

const STATUS_STYLE: Record<SARTeam["status"], string> = {
  STANDBY:    "text-muted-foreground border-border",
  ACTIVE:     "text-teal-400 border-teal-500/40 bg-teal-500/10",
  RESTING:    "text-blue-400 border-blue-500/40",
  EVACUATING: "text-amber-400 border-amber-500/40 bg-amber-500/10 animate-pulse",
};

const HumanSARComms = () => {
  const commanderReport = useMissionStore((s) => s.commanderReport);
  const [sent, setSent] = useState<Record<string, boolean>>({});

  const sendReport = (teamId: string) => {
    setSent((prev) => ({ ...prev, [teamId]: true }));
    // In a real system this would POST to a comms API
  };

  return (
    <div className="h-full flex flex-col bg-card/30">
      {/* Header */}
      <div className="px-4 py-2 border-b border-border bg-secondary/30 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Radio size={11} className="text-cyan-400" />
          <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
            Human SAR Teams
          </span>
        </div>
        <span className="font-mono text-[8px] text-muted-foreground/40 uppercase tracking-wider">
          {SAR_TEAMS.filter((t) => t.status === "ACTIVE" || t.status === "EVACUATING").length} / {SAR_TEAMS.length} Deployed
        </span>
      </div>

      {/* Team cards */}
      <div className="flex-1 overflow-y-auto p-3 grid grid-cols-2 gap-2 content-start">
        {SAR_TEAMS.map((team) => (
          <div
            key={team.id}
            className="border border-border bg-card/50 p-3 flex flex-col gap-2"
          >
            {/* Team name + status */}
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] text-foreground font-bold tracking-wider">
                {team.callsign}
              </span>
              <span className={`font-mono text-[7px] tracking-[0.15em] uppercase border px-1.5 py-0.5 ${STATUS_STYLE[team.status]}`}>
                {team.status}
              </span>
            </div>

            {/* Details */}
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
              <DetailRow label="Location"   value={team.sector} />
              <DetailRow label="Personnel"  value={`${team.personnel} PAX`} />
              <DetailRow label="Last Ping"  value={team.lastContact} />
            </div>

            {/* Send mission report button */}
            <button
              onClick={() => sendReport(team.id)}
              disabled={!commanderReport || sent[team.id]}
              className={`mt-1 w-full flex items-center justify-center gap-1.5 px-2 py-1.5
                font-mono text-[8px] tracking-wider uppercase border transition-colors
                ${sent[team.id]
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400 cursor-default"
                  : !commanderReport
                  ? "border-border text-muted-foreground/30 cursor-not-allowed"
                  : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 hover:border-primary/60"
                }`}
            >
              {sent[team.id] ? (
                <>
                  <CheckCircle2 size={10} />
                  Report Sent
                </>
              ) : (
                <>
                  <Send size={10} />
                  Send Mission Report
                </>
              )}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

const DetailRow = ({ label, value }: { label: string; value: string }) => (
  <div>
    <span className="font-mono text-[7px] text-muted-foreground/40 uppercase tracking-wider block">
      {label}
    </span>
    <span className="font-mono text-[9px] text-foreground/80">
      {value}
    </span>
  </div>
);

export default HumanSARComms;
