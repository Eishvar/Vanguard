import { useMissionStore } from "@/stores/missionStore";

export function TerrainLegend() {
  const mode = useMissionStore((s) => s.mapMode);
  const cfg  = useMissionStore((s) => s.terrainConfig);
  if (mode === "none" || !cfg) return null;

  if (mode === "elevation") {
    const lo  = cfg.obstacleElev * 0.70;
    const hi  = cfg.obstacleElev;
    const max = cfg.obstacleElev * 1.15;

    const stops = [
      { pct: "0%",   color: "#1e3a1e" },
      { pct: "33%",  color: "#8bb84b" },
      { pct: "60%",  color: "#f2c94c" },
      { pct: "75%",  color: "#f28c28" },
      { pct: "100%", color: "#6c1a1a" },
    ];
    const gradient = `linear-gradient(to right, ${stops.map(s => `${s.color} ${s.pct}`).join(", ")})`;

    return (
      <div className="absolute bottom-16 left-4 z-10 bg-slate-900/90 border border-slate-700 rounded px-3 py-2 font-mono text-[11px] text-slate-100 pointer-events-none select-none">
        <div className="mb-1 text-slate-400 tracking-wider">ELEVATION ASL</div>
        <div className="h-2.5 w-40 rounded" style={{ background: gradient }} />
        <div className="flex justify-between mt-0.5 text-slate-400">
          <span>{Math.round(lo)}m</span>
          <span>{Math.round(max)}m</span>
        </div>
        <div className="mt-1 text-[10px] text-amber-400">
          Obstacle threshold: {Math.round(hi)}m
        </div>
      </div>
    );
  }

  return (
    <div className="absolute bottom-16 left-4 z-10 bg-slate-900/90 border border-slate-700 rounded px-3 py-2 font-mono text-[11px] text-slate-100 pointer-events-none select-none">
      <div className="mb-1 text-slate-400 tracking-wider">BUILDING DENSITY</div>
      <div className="h-2.5 w-40 rounded"
           style={{ background: "linear-gradient(to right, rgba(79,195,247,0.35) 0%, rgba(33,150,243,0.60) 40%, rgba(21,101,192,0.85) 75%, rgba(13,71,161,0.95) 100%)" }} />
      <div className="flex justify-between mt-0.5 text-slate-400">
        <span>low</span><span>high</span>
      </div>
    </div>
  );
}
