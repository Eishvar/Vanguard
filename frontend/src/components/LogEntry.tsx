import { Info, AlertTriangle, XCircle, CheckCircle, Terminal } from "lucide-react";
import type { LogEntry } from "@/stores/missionStore";

const SOURCE_COLOR: Record<string, string> = {
  SUPERVISOR: "text-teal-400",
  DRONE_A:    "text-red-400",
  DRONE_B:    "text-purple-400",
  DRONE_C:    "text-cyan-400",
  SYSTEM:     "text-muted-foreground/60",
};

const TYPE_ICON: Record<string, React.ReactNode> = {
  info:    <Info          size={12} className="shrink-0" />,
  warning: <AlertTriangle size={12} className="shrink-0" />,
  error:   <XCircle       size={12} className="shrink-0" />,
  success: <CheckCircle   size={12} className="shrink-0" />,
  phase:   <Terminal      size={12} className="shrink-0" />,
};

export function LogEntryRow({ entry }: { entry: LogEntry }) {
  const color = (entry.source && SOURCE_COLOR[entry.source])
    ?? (entry.droneId && SOURCE_COLOR[entry.droneId])
    ?? "text-foreground/75";

  return (
    <div
      className={`flex items-start gap-2.5 py-1.5 px-2.5 rounded-sm transition-colors
        ${entry.type === "error"   ? "bg-destructive/8 border-l-2 border-destructive"
        : entry.type === "warning" ? "bg-yellow-500/5 border-l-2 border-yellow-500/40"
        : entry.type === "success" ? "bg-emerald-500/5"
        : "hover:bg-muted/5"}`}
    >
      <span className={`shrink-0 mt-0.5 ${color}`}>
        {TYPE_ICON[entry.type] ?? TYPE_ICON.info}
      </span>
      <span className="text-muted-foreground/40 shrink-0 tabular-nums w-[68px] text-[9px]">
        {entry.timestamp}
      </span>
      <span className={`leading-relaxed whitespace-pre-wrap break-words ${color}`}>
        {entry.message}
      </span>
    </div>
  );
}
