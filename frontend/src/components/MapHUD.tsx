// frontend/src/components/MapHUD.tsx

import { useMissionStore } from "@/stores/missionStore";

interface Props {
  pitch: number;
  onSetPitch: (p: number) => void;
  showNetwork: boolean;
  onToggleNetwork: () => void;
  measureActive: boolean;
  onToggleMeasure: () => void;
  onFlyToBase: () => void;
}

export function MapHUD({
  pitch, onSetPitch,
  showNetwork, onToggleNetwork,
  measureActive, onToggleMeasure, onFlyToBase,
}: Props) {
  const mapMode       = useMissionStore((s) => s.mapMode);
  const setMapMode    = useMissionStore((s) => s.setMapMode);
  const showSectors   = useMissionStore((s) => s.showSectorOverlay);
  const toggleSectors = useMissionStore((s) => s.toggleSectorOverlay);
  const showPaths      = useMissionStore((s) => s.showDronePaths);
  const togglePaths    = useMissionStore((s) => s.toggleDronePaths);
  const showNodes          = useMissionStore((s) => s.showNodes);
  const toggleNodes        = useMissionStore((s) => s.toggleNodes);
  const showTransitPaths   = useMissionStore((s) => s.showTransitPaths);
  const toggleTransitPaths = useMissionStore((s) => s.toggleTransitPaths);
  const terrainReady   = useMissionStore((s) => s.terrainReady);
  const terrainConfig  = useMissionStore((s) => s.terrainConfig);

  return (
    <>
      {/* Top-right: View controls */}
      <div className="absolute top-4 right-4 z-10 flex flex-col gap-1.5">
        <div className="flex gap-1">
          <button
            onClick={() => onSetPitch(0)}
            className={`px-2 py-1 text-[10px] font-mono border rounded transition-colors
              ${pitch === 0
                ? 'bg-teal-500/20 border-teal-400 text-teal-300'
                : 'bg-slate-900/80 border-slate-600 text-slate-400 hover:border-teal-500/50'}`}
          >
            2D
          </button>
          <button
            onClick={() => onSetPitch(45)}
            className={`px-2 py-1 text-[10px] font-mono border rounded transition-colors
              ${pitch > 0
                ? 'bg-teal-500/20 border-teal-400 text-teal-300'
                : 'bg-slate-900/80 border-slate-600 text-slate-400 hover:border-teal-500/50'}`}
          >
            3D
          </button>
        </div>

        <button
          onClick={onFlyToBase}
          title="Center map on base station"
          disabled={!terrainConfig}
          className={`px-2 py-1 text-[10px] font-mono border rounded transition-colors
            ${!terrainConfig
              ? 'bg-slate-900/50 border-slate-700 text-slate-600 cursor-not-allowed'
              : 'bg-slate-900/80 border-slate-600 text-slate-400 hover:border-amber-500/50'}`}
        >
          🎯 HOME
        </button>

        <button
          onClick={onToggleNetwork}
          className={`px-2 py-1 text-[10px] font-mono border rounded transition-colors
            ${showNetwork
              ? 'bg-cyan-500/20 border-cyan-400 text-cyan-300'
              : 'bg-slate-900/80 border-slate-600 text-slate-400 hover:border-cyan-500/50'}`}
        >
          📡 NETWORK
        </button>

        <button
          onClick={onToggleMeasure}
          className={`px-2 py-1 text-[10px] font-mono border rounded transition-colors
            ${measureActive
              ? 'bg-amber-500/20 border-amber-400 text-amber-300'
              : 'bg-slate-900/80 border-slate-600 text-slate-400 hover:border-amber-500/50'}`}
          title="Measure real-world distance between points"
        >
          📏 MEASURE
        </button>

        <button
          disabled={!terrainReady}
          onClick={() => setMapMode(mapMode === "elevation" ? "none" : "elevation")}
          className={`px-2 py-1 text-[10px] font-mono border rounded transition-colors
            ${!terrainReady
              ? 'bg-slate-900/50 border-slate-700 text-slate-600 cursor-not-allowed'
              : mapMode === "elevation"
                ? 'bg-yellow-500/20 border-yellow-400 text-yellow-300'
                : 'bg-slate-900/80 border-slate-600 text-slate-400 hover:border-yellow-500/50'}`}
          title="Show elevation heatmap"
        >
          🏔 ELEVATION
        </button>

        <button
          disabled={!terrainReady}
          onClick={() => setMapMode(mapMode === "density" ? "none" : "density")}
          className={`px-2 py-1 text-[10px] font-mono border rounded transition-colors
            ${!terrainReady
              ? 'bg-slate-900/50 border-slate-700 text-slate-600 cursor-not-allowed'
              : mapMode === "density"
                ? 'bg-blue-500/20 border-blue-400 text-blue-300'
                : 'bg-slate-900/80 border-slate-600 text-slate-400 hover:border-blue-500/50'}`}
          title="Show building density heatmap"
        >
          🏘 DENSITY
        </button>

        <button
          disabled={!terrainReady}
          onClick={() => toggleSectors()}
          className={`px-2 py-1 text-[10px] font-mono border rounded transition-colors
            ${!terrainReady
              ? 'bg-slate-900/50 border-slate-700 text-slate-600 cursor-not-allowed'
              : showSectors
                ? 'bg-violet-500/20 border-violet-400 text-violet-300'
                : 'bg-slate-900/80 border-slate-600 text-slate-400 hover:border-violet-500/50'}`}
          title="Toggle sector polygon overlay"
        >
          ⬡ SECTORS
        </button>

        <button
          disabled={!terrainReady}
          onClick={() => togglePaths()}
          className={`px-2 py-1 text-[10px] font-mono border rounded transition-colors
            ${!terrainReady
              ? 'bg-slate-900/50 border-slate-700 text-slate-600 cursor-not-allowed'
              : showPaths
                ? 'bg-indigo-500/20 border-indigo-400 text-indigo-300'
                : 'bg-slate-900/80 border-slate-600 text-slate-400 hover:border-indigo-500/50'}`}
          title="Toggle drone lawnmower paths"
        >
          〰 PATHS
        </button>

        <button
          disabled={!terrainReady}
          onClick={() => toggleNodes()}
          className={`px-2 py-1 text-[10px] font-mono border rounded transition-colors
            ${!terrainReady
              ? 'bg-slate-900/50 border-slate-700 text-slate-600 cursor-not-allowed'
              : showNodes
                ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                : 'bg-slate-900/80 border-slate-600 text-slate-400 hover:border-emerald-500/50'}`}
          title="Toggle sweep node dots"
        >
          ● NODES
        </button>

        <button
          disabled={!terrainReady}
          onClick={() => toggleTransitPaths()}
          className={`px-2 py-1 text-[10px] font-mono border rounded transition-colors
            ${!terrainReady
              ? 'bg-slate-900/50 border-slate-700 text-slate-600 cursor-not-allowed'
              : showTransitPaths
                ? 'bg-orange-500/20 border-orange-400 text-orange-300'
                : 'bg-slate-900/80 border-slate-600 text-slate-400 hover:border-orange-500/50'}`}
          title="Toggle sector-to-sector transit paths"
        >
          ➜ TRANSIT
        </button>

      </div>

    </>
  );
}
