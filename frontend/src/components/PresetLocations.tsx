// frontend/src/components/PresetLocations.tsx

import { useState } from 'react';
import { PRESET_LOCATIONS, type PresetLocation } from '@/lib/geoGrid';
import { useMissionStore } from '@/stores/missionStore';

interface Props {
  // Called when a preset is selected — parent updates the map camera
  onFlyTo: (lat: number, lng: number, zoom: number, pitch: number) => void;
}

export function PresetLocations({ onFlyTo }: Props) {
  const [open, setOpen] = useState(false);
  const missionLaunched = useMissionStore((s) => s.missionLaunched);

  if (missionLaunched) return null;  // hide during active mission

  const handleSelect = (preset: PresetLocation) => {
    // Fly camera to the preset location
    onFlyTo(preset.anchor.lat, preset.anchor.lng, preset.initialZoom, preset.initialPitch);
    setOpen(false);
  };

  return (
    <div className="absolute top-4 left-4 z-10">
      <button
        onClick={() => setOpen(!open)}
        className="bg-slate-900/90 border border-teal-500/40 text-teal-400 text-xs font-mono px-3 py-1.5 rounded hover:border-teal-400/70 transition-colors"
      >
        📍 PRESET LOCATIONS
      </button>

      {open && (
        <div className="mt-1 w-72 bg-slate-900/95 border border-teal-500/30 rounded shadow-xl">
          {PRESET_LOCATIONS.map((preset, i) => (
            <button
              key={i}
              onClick={() => handleSelect(preset)}
              className="w-full text-left px-3 py-2 hover:bg-teal-500/10 transition-colors border-b border-slate-700/50 last:border-b-0"
            >
              <div className="text-xs text-teal-300 font-mono font-semibold">{preset.name}</div>
              <div className="text-[10px] text-slate-400 mt-0.5 leading-tight">{preset.description}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
