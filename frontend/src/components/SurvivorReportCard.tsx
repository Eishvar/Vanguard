// frontend/src/components/SurvivorReportCard.tsx

import { useState } from "react";
import { X, User, ArrowRight } from "lucide-react";
import { type SurvivorRecord, useMissionStore } from "@/stores/missionStore";
import { tileCenter } from "@/lib/geoGrid";
import { baseStationLatLng } from "@/lib/terrainGeo";

interface Props {
  record?: SurvivorRecord;
  onClose?: () => void;
  inline?: boolean;
}

const PRIORITY_BADGE: Record<string, string> = {
  CRITICAL: "bg-red-500/20 text-red-400 border border-red-500/50",
  HIGH:     "bg-orange-500/20 text-orange-400 border border-orange-500/50",
  MODERATE: "bg-yellow-500/20 text-yellow-400 border border-yellow-500/50",
  LOW:      "bg-green-500/20 text-green-400 border border-green-500/50",
};

const PRIORITY_LEFT_BORDER: Record<string, string> = {
  CRITICAL: "border-l-red-500",
  HIGH:     "border-l-orange-500",
  MODERATE: "border-l-yellow-500",
  LOW:      "border-l-green-500",
};

const PRIORITY_ORDER: Record<string, number> = {
  CRITICAL: 0, HIGH: 1, MODERATE: 2, LOW: 3,
};

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toMYT(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  });
}

const DetailOverlay = ({ record, onClose }: { record: SurvivorRecord; onClose: () => void }) => {
  const cfg        = useMissionStore((s) => s.terrainConfig);
  const priority   = record.survivor_profile?.medical_priority ?? "UNKNOWN";
  const badgeClass = PRIORITY_BADGE[priority] ?? "bg-muted text-muted-foreground border border-border";
  const tileMatch  = record.tile_id?.match(/^r(\d+)_c(\d+)$/);
  const coords     = (cfg && tileMatch) ? tileCenter(parseInt(tileMatch[1]), parseInt(tileMatch[2]), cfg) : null;
  const baseLatlng = cfg ? baseStationLatLng(cfg) : null;
  const distKm     = (coords && baseLatlng) ? haversineKm(coords.lat, coords.lng, baseLatlng[0], baseLatlng[1]) : null;
  const detectedTime = record.timestamp ? toMYT(record.timestamp) : "—";
  const thermalPct   = typeof record.thermal_reading === "number" ? `${(record.thermal_reading * 100).toFixed(0)}%` : "—";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[60vw] h-[70vh] bg-card border border-border shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-secondary/40 shrink-0">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] tracking-[0.2em] uppercase text-muted-foreground">
              Survivor Report
            </span>
            <span className={`font-mono text-[9px] tracking-[0.15em] uppercase px-2 py-0.5 ${badgeClass}`}>
              {priority}
            </span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors p-1">
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">

          {/* Profile row */}
          <div className="flex gap-4 items-center">
            <div className="w-16 h-16 shrink-0 bg-muted/30 border border-border flex items-center justify-center">
              <User size={28} className="text-muted-foreground" />
            </div>
            <div className="flex items-center gap-2">
              <span className={`font-mono text-[9px] tracking-[0.15em] uppercase px-2 py-0.5 ${badgeClass}`}>
                {priority}
              </span>
              <span className="font-mono text-[9px] text-muted-foreground">
                {record.survivor_profile?.num_people ?? 1} person{(record.survivor_profile?.num_people ?? 1) !== 1 ? "s" : ""} detected
              </span>
            </div>
          </div>

          {/* Data grid */}
          <div className="grid grid-cols-3 gap-4 border border-border p-4 bg-secondary/10">
            <DataRow label="Latitude"        value={coords ? `${coords.lat.toFixed(5)}°` : "—"} />
            <DataRow label="Longitude"       value={coords ? `${coords.lng.toFixed(5)}°` : "—"} />
            <DataRow label="Dist. from base" value={distKm !== null ? `${distKm.toFixed(2)} km` : "—"} />
            <DataRow label="People detected" value={String(record.survivor_profile?.num_people ?? 1)} />
            <DataRow label="Detected by"     value={record.drone_id ?? "—"} />
            <DataRow label="Time (MYT)"      value={detectedTime} />
            <DataRow label="Thermal reading" value={thermalPct} />
            <DataRow label="Criticality"     value={priority} />
          </div>

          {/* Description */}
          {record.survivor_profile?.description && (
            <div className="border border-border p-4">
              <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-wider block mb-2">
                Description
              </span>
              <p className="font-mono text-[10px] text-foreground leading-relaxed">
                {record.survivor_profile.description}
              </p>
            </div>
          )}

          {/* Extraction notes */}
          {record.survivor_profile?.extraction_notes && (
            <div className="border border-border p-4">
              <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-wider block mb-2">
                Extraction Notes
              </span>
              <p className="font-mono text-[10px] text-foreground leading-relaxed">
                {record.survivor_profile.extraction_notes}
              </p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
};

const SurvivorMiniCard = ({ record, onClick }: { record: SurvivorRecord; onClick: () => void }) => {
  const priority   = record.survivor_profile?.medical_priority ?? "UNKNOWN";
  const badgeClass = PRIORITY_BADGE[priority] ?? "bg-muted text-muted-foreground border border-border";
  const leftBorder = PRIORITY_LEFT_BORDER[priority] ?? "border-l-border";

  return (
    <button
      onClick={onClick}
      className={`w-full text-left flex items-center gap-3 px-3 py-2.5
        border-l-2 ${leftBorder}
        hover:bg-secondary/40 active:bg-secondary/60 transition-colors
        border-b border-border last:border-b-0`}
    >
      <div className="w-8 h-8 shrink-0 bg-muted/30 border border-border flex items-center justify-center">
        <User size={14} className="text-muted-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`font-mono text-[8px] tracking-[0.12em] uppercase px-1.5 py-0.5 ${badgeClass}`}>
            {priority}
          </span>
          <span className="font-mono text-[8px] text-muted-foreground">
            {record.survivor_profile?.num_people ?? 1}p · {record.drone_id ?? "—"}
          </span>
        </div>
        <p className="font-mono text-[8px] text-muted-foreground">
          Click for more info
        </p>
      </div>
      <ArrowRight size={10} className="text-muted-foreground shrink-0" />
    </button>
  );
};

const SurvivorReportCard = ({ inline = false }: Props) => {
  const survivorsFoundList = useMissionStore((s) => s.survivorsFoundList);
  const [selected, setSelected] = useState<SurvivorRecord | null>(null);

  const sorted = [...survivorsFoundList].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.survivor_profile?.medical_priority] ?? 4;
    const pb = PRIORITY_ORDER[b.survivor_profile?.medical_priority] ?? 4;
    return pa !== pb ? pa - pb : 0;
  });

  if (!inline) return null;

  return (
    <>
      <div className="relative w-full h-full flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b border-border bg-secondary/30 shrink-0">
          <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
            Survivor Reports{sorted.length > 0 ? ` · ${sorted.length} found` : ""}
          </span>
        </div>
        {sorted.length === 0 ? (
          <div className="flex-1 flex items-center justify-center">
            <span className="font-mono text-[9px] text-muted-foreground uppercase tracking-widest">
              No Survivors Detected
            </span>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {sorted.map((rec, i) => (
              <SurvivorMiniCard key={i} record={rec} onClick={() => setSelected(rec)} />
            ))}
          </div>
        )}
      </div>

      {selected && (
        <DetailOverlay record={selected} onClose={() => setSelected(null)} />
      )}
    </>
  );
};

const DataRow = ({ label, value }: { label: string; value: string }) => (
  <div>
    <span className="font-mono text-[8px] text-muted-foreground uppercase tracking-wider block mb-0.5">
      {label}
    </span>
    <span className="font-mono text-[10px] text-foreground">
      {value}
    </span>
  </div>
);

export default SurvivorReportCard;
