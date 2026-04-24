// frontend/src/components/DroneDetailCard.tsx

import { Popup } from 'react-map-gl/maplibre';
import { X } from 'lucide-react';
import type { Drone } from '@/stores/missionStore';
import { BatteryIcon } from '@/components/BatteryIcon';

interface DroneDetailCardProps {
  drone:     Drone;
  longitude: number;
  latitude:  number;
  reasoning: string;
  heading:   number;
  onClose:   () => void;
}

const STATUS_STYLE: Record<string, string> = {
  active:      'text-teal-400 border-teal-400/50',
  low_battery: 'text-amber-400 border-amber-400/50',
  offline:     'text-red-400 border-red-400/50',
  rtb:         'text-orange-400 border-orange-400/50',
};

const STATUS_LABEL: Record<string, string> = {
  active:      'ACTIVE',
  low_battery: 'LOW BATT',
  offline:     'OFFLINE',
  rtb:         'RTB',
};

const DRONE_DOT: Record<string, string> = {
  DRONE_A: 'bg-red-400',
  DRONE_B: 'bg-purple-400',
  DRONE_C: 'bg-cyan-400',
};

export const DroneDetailCard = ({
  drone,
  longitude,
  latitude,
  reasoning,
  heading,
  onClose,
}: DroneDetailCardProps) => {
  const snippet     = reasoning ? reasoning.slice(-120) : 'No reasoning yet.';
  const statusStyle = STATUS_STYLE[drone.status] ?? STATUS_STYLE.active;
  const statusLabel = STATUS_LABEL[drone.status] ?? drone.status.toUpperCase();
  const dotColor    = DRONE_DOT[drone.id] ?? 'bg-slate-400';

  // Derive wind effect from heading:
  // Eastward  (45°–135°)  → +5% speed, +5% battery efficiency
  // Westward (225°–315°)  → -5% speed, -5% battery efficiency
  // North/South           → no effect, show nothing
  const h = ((heading % 360) + 360) % 360;
  const isEast = h >= 45 && h <= 135;
  const isWest = h >= 225 && h <= 315;

  return (
    <Popup
      longitude={longitude}
      latitude={latitude}
      anchor="bottom"
      closeButton={false}
      closeOnClick={false}
      maxWidth="none"
      className="drone-detail-popup"
    >
      {/* Override MapLibre popup default white background / padding */}
      <style>{`
        .drone-detail-popup .maplibregl-popup-content {
          padding: 0;
          background: transparent;
          box-shadow: none;
          border-radius: 0;
        }
        .drone-detail-popup.maplibregl-popup-anchor-bottom .maplibregl-popup-tip {
          border-top-color: #0d1520;
        }
      `}</style>

      <div className="bg-[#0d1520] border border-teal-900/60 font-mono text-[10px] w-[240px] shadow-xl shadow-black/60">
        {/* ── Header ───────────────────────────────── */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-teal-900/40">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
            <span className="text-slate-100 tracking-[0.15em] text-[11px] uppercase">
              {drone.id}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-200 transition-colors p-0.5"
            aria-label="Close"
          >
            <X size={11} />
          </button>
        </div>

        {/* ── Body ─────────────────────────────────── */}
        <div className="px-3 py-2.5 space-y-2.5">
          {/* Sector + GPS */}
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 uppercase tracking-[0.12em]">Sector</span>
              <span className="text-slate-200">{drone.sectorId >= 0 ? drone.sectorId : "—"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500 uppercase tracking-[0.12em]">GPS</span>
              <span className="text-slate-400 tabular-nums">
                {latitude.toFixed(4)}°, {longitude.toFixed(4)}°
              </span>
            </div>
          </div>

          {/* Battery + Status badge */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-slate-400">
              <BatteryIcon percent={Math.round(drone.battery)} />
              <span className={drone.battery < 20 ? 'text-red-400' : 'text-slate-200'}>
                {Math.round(drone.battery)}%
              </span>
            </div>
            <span
              className={`border px-1.5 py-0.5 uppercase tracking-[0.12em] text-[9px] ${statusStyle}`}
            >
              {statusLabel}
            </span>
          </div>

          {/* Wind effect — only shown when moving east or west */}
          {(isEast || isWest) && (
            <div className={`flex items-center justify-between border rounded px-2 py-1
              ${isEast
                ? 'border-teal-500/30 bg-teal-500/5'
                : 'border-red-500/30 bg-red-500/5'}`}
            >
              <span className="text-slate-500 uppercase tracking-[0.12em]">Wind</span>
              <div className={`flex flex-col items-end gap-0.5 ${isEast ? 'text-teal-400' : 'text-red-400'}`}>
                <span>{isEast ? '▶ EASTWARD' : '◀ WESTWARD'}</span>
                <span className="text-[9px]">
                  {isEast ? '+5% speed  +5% batt efficiency' : '-5% speed  -5% batt efficiency'}
                </span>
              </div>
            </div>
          )}

          {/* Last reasoning */}
          <div className="border-t border-teal-900/30 pt-2">
            <div className="text-slate-500 uppercase tracking-[0.12em] mb-1">
              Last Reasoning
            </div>
            <p className="text-slate-400 leading-relaxed break-words">{snippet}</p>
          </div>
        </div>
      </div>
    </Popup>
  );
};
