import { useMissionStore } from "@/stores/missionStore";
import { Shield, ClipboardCheck, FileCheck } from "lucide-react";

type ReportBlock =
  | { kind: "heading"; text: string; level: number }
  | { kind: "bullet"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "spacer" };

const parseReport = (md: string): ReportBlock[] => {
  const blocks: ReportBlock[] = [];
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) { blocks.push({ kind: "spacer" }); continue; }
    if (line.startsWith("### ")) { blocks.push({ kind: "heading", text: line.slice(4).replace(/\*\*/g, ""), level: 3 }); continue; }
    if (line.startsWith("## "))  { blocks.push({ kind: "heading", text: line.slice(3).replace(/\*\*/g, ""), level: 2 }); continue; }
    if (line.startsWith("# "))   { blocks.push({ kind: "heading", text: line.slice(2).replace(/\*\*/g, ""), level: 1 }); continue; }
    if (/^[-•*]\s/.test(line) || /^\d+\.\s/.test(line)) {
      blocks.push({ kind: "bullet", text: line.replace(/^[-•*]\s*/, "").replace(/^\d+\.\s*/, "") }); continue;
    }
    blocks.push({ kind: "paragraph", text: line });
  }
  return blocks;
};

const InlineBold = ({ text }: { text: string }) => {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1
          ? <span key={i} className="text-foreground/95 font-semibold">{part}</span>
          : <span key={i}>{part}</span>
      )}
    </>
  );
};

export function MissionReportView() {
  const commanderReport = useMissionStore((s) => s.commanderReport);

  const now = new Date();
  const docId   = "SAR-" + Math.floor(Date.now() / 1000 / 3600).toString(16).toUpperCase().slice(-4);
  const docDate = now.toISOString().slice(0, 10).replace(/-/g, "/");
  const docTime = now.toTimeString().slice(0, 8) + "Z";
  let sectionCounter = 0;

  if (!commanderReport) {
    return (
      <div className="text-muted-foreground/40 text-center py-12">
        <FileCheck size={24} className="mx-auto mb-3 opacity-30" />
        <div>Mission report will appear here after completion.</div>
      </div>
    );
  }

  sectionCounter = 0;
  const blocks = parseReport(commanderReport);

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <ClipboardCheck size={14} className="text-emerald-400" />
        <h3 className="text-[11px] font-semibold tracking-[0.15em] uppercase text-emerald-400">
          SAR Mission Completion Report
        </h3>
      </div>

      <div className="space-y-0">
        {/* Report header */}
        <div className="border border-emerald-500/30 bg-emerald-500/5 p-4 mb-4 rounded-sm">
          <div className="flex items-center justify-between border-b border-emerald-500/20 pb-2 mb-3">
            <div className="flex items-center gap-2">
              <Shield size={12} className="text-emerald-400" />
              <span className="text-[10px] tracking-[0.2em] text-emerald-400 font-bold uppercase">
                Official SAR Summary
              </span>
            </div>
            <span className="text-[9px] font-bold text-emerald-500/60 px-2 py-0.5 bg-emerald-500/10 rounded-full">
              COMPLETED
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-[8px]">
            {[
              { label: "Report Ref",     value: docId },
              { label: "Authority",       value: "VANGUARD SAR Unit" },
              { label: "Deployment Date", value: docDate },
              { label: "Timestamp",       value: docTime },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between border-b border-white/5 pb-0.5">
                <span className="text-muted-foreground/50 uppercase tracking-tighter shrink-0">{label}:</span>
                <span className="text-emerald-50/80 font-semibold">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Markdown body */}
        <div className="space-y-1 bg-white/2 p-2 rounded-sm border border-white/5">
          {blocks.map((block, i) => {
            if (block.kind === "spacer") return <div key={i} className="h-2" />;
            if (block.kind === "heading") {
              if (block.level === 1) return (
                <div key={i} className="pt-4 pb-2 text-center">
                  <span className="text-[12px] font-bold tracking-[0.3em] uppercase text-emerald-300">
                    — {block.text} —
                  </span>
                </div>
              );
              if (block.level === 2) {
                sectionCounter++;
                return (
                  <div key={i} className="pt-4 pb-1 flex items-center gap-3">
                    <span className="text-[8px] bg-emerald-500/20 text-emerald-300 px-1.5 py-0.5 rounded font-bold">
                      {String(sectionCounter).padStart(2, "0")}
                    </span>
                    <span className="text-[10px] font-bold tracking-[0.1em] uppercase text-foreground/90">
                      {block.text}
                    </span>
                    <div className="h-px flex-1 bg-emerald-500/10" />
                  </div>
                );
              }
              return (
                <div key={i} className="pt-2 pb-0.5">
                  <span className="text-[9px] font-semibold text-emerald-200/60 uppercase">{block.text}</span>
                </div>
              );
            }
            if (block.kind === "bullet") return (
              <div key={i} className="flex items-start gap-2 pl-4 py-1 border-l border-white/5 ml-1">
                <span className="text-emerald-500/40 mt-1">●</span>
                <span className="text-foreground/75 leading-relaxed text-[11px]">
                  <InlineBold text={block.text} />
                </span>
              </div>
            );
            if (block.kind === "paragraph") return (
              <div key={i} className="text-foreground/60 leading-relaxed text-[11px] pl-1">
                <InlineBold text={block.text} />
              </div>
            );
            return null;
          })}
        </div>
      </div>
    </div>
  );
}
