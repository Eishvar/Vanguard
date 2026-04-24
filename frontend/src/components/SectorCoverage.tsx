import { useMissionStore } from "@/stores/missionStore";

const SectorCoverage = () => {
  const sweptSectors   = useMissionStore((s) => s.sweptSectors);
  const totalSectors   = useMissionStore((s) => s.totalSectors);
  const sectorsGeoJSON = useMissionStore((s) => s.sectorsGeoJSON);

  const pct = totalSectors > 0
    ? Math.round((sweptSectors.length / totalSectors) * 100)
    : 0;

  const sectorRows = sectorsGeoJSON?.features
    .filter((f) => !f.properties?.is_obstacle)
    .map((f) => ({
      id:      f.properties?.sector_id as number,
      swept:   sweptSectors.includes(f.properties?.sector_id),
      areakm2: (f.properties?.area_km2 as number)?.toFixed(2),
    })) ?? [];

  return (
    <div className="border border-border bg-card/50">
      <div className="px-4 py-2.5 border-b border-border bg-secondary/30">
        <h3 className="font-mono text-[10px] tracking-[0.2em] uppercase text-muted-foreground">
          Sector Coverage
        </h3>
      </div>
      <div className="p-4 space-y-2">
        {/* Overall progress bar */}
        <div className="flex justify-between items-center mb-1">
          <span className="font-mono text-[10px] text-muted-foreground">
            OVERALL — {sweptSectors.length} / {totalSectors} SECTORS
          </span>
          <span className="font-mono text-[10px] text-primary">{pct}%</span>
        </div>
        <div className="h-1.5 bg-muted/50 overflow-hidden mb-3">
          <div
            className="h-full bg-primary transition-all duration-700 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        {/* Per-sector status pills */}
        <div className="flex flex-wrap gap-1.5">
          {sectorRows.map((s) => (
            <div
              key={s.id}
              className={`font-mono text-[9px] px-2 py-0.5 border transition-colors ${
                s.swept
                  ? "border-primary/60 bg-primary/15 text-primary"
                  : "border-border bg-secondary/20 text-muted-foreground"
              }`}
            >
              S{s.id} {s.swept ? "✓" : "○"} {s.areakm2}km²
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default SectorCoverage;
