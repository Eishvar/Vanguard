// frontend/src/components/DroneHoverCard.tsx

import { Popup } from 'react-map-gl/maplibre';
import type { Drone } from '@/stores/missionStore';

interface DroneHoverCardProps {
  drone:     Drone;
  longitude: number;
  latitude:  number;
  isIsolated: boolean;
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  active:      { label: 'ACTIVE',    cls: 'text-teal-400 border-teal-400/50' },
  low_battery: { label: 'LOW BATT',  cls: 'text-amber-400 border-amber-400/50' },
  offline:     { label: 'OFFLINE',   cls: 'text-red-400 border-red-400/50' },
  rtb:         { label: 'RTB',       cls: 'text-orange-400 border-orange-400/50' },
};

function BatterySmartphone({ percent }: { percent: number }) {
  const clamped   = Math.max(0, Math.min(100, percent));
  const fillWidth = Math.round(16 * clamped / 100);
  const color     = clamped <= 20 ? '#f87171' : '#2dd4bf';  // red-400 / teal-400

  return (
    <svg
      width="22"
      height="11"
      viewBox="0 0 22 11"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-label={`Battery ${percent}%`}
    >
      {/* Battery body outline */}
      <rect x="0.5" y="0.5" width="18" height="10" rx="2" stroke="currentColor" strokeOpacity="0.5" />
      {/* Terminal nub */}
      <rect x="19" y="3.5" width="2.5" height="4" rx="1" fill="currentColor" fillOpacity="0.5" />
      {/* Fill */}
      {fillWidth > 0 && (
        <rect x="1.5" y="1.5" width={fillWidth} height="8" rx="1" fill={color} />
      )}
    </svg>
  );
}

export function DroneHoverCard({ drone, longitude, latitude, isIsolated }: DroneHoverCardProps) {
  const name        = drone.id.replace('DRONE_', 'DRONE ');
  const battery     = Math.round(drone.battery);
  const battColor   = battery <= 20 ? 'text-red-400' : 'text-teal-400';
  const badge       = STATUS_BADGE[drone.status] ?? STATUS_BADGE.active;
  const sectorLabel = drone.sectorId >= 0 ? `SECTOR ${drone.sectorId}` : 'UNASSIGNED';
  const signalLabel = isIsolated ? 'ISOLATED' : 'CONNECTED';
  const signalCls   = isIsolated ? 'text-red-400' : 'text-teal-400';

  return (
    <Popup
      longitude={longitude}
      latitude={latitude}
      anchor="bottom"
      closeButton={false}
      closeOnClick={false}
      maxWidth="none"
      className="drone-hover-popup"
    >
      <style>{`
        .drone-hover-popup .maplibregl-popup-content {
          padding: 0;
          background: transparent;
          box-shadow: none;
          border-radius: 0;
        }
        .drone-hover-popup.maplibregl-popup-anchor-bottom .maplibregl-popup-tip {
          border-top-color: rgba(13,21,32,0.92);
        }
      `}</style>

      <div className="bg-card/90 backdrop-blur border border-border font-mono text-[10px] w-[190px] shadow-xl shadow-black/60 pointer-events-none">
        {/* Header */}
        <div className="px-2.5 py-1.5 border-b border-border flex items-center justify-between">
          <span className="text-slate-100 tracking-[0.15em] text-[10px] uppercase">{name}</span>
          <span className={`border px-1.5 py-0.5 text-[9px] tracking-[0.1em] uppercase ${badge.cls}`}>
            {badge.label}
          </span>
        </div>

        {/* Body */}
        <div className="px-2.5 py-2 space-y-1.5">
          {/* Battery */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 uppercase tracking-[0.1em] w-12 shrink-0">Batt</span>
            <span className={`flex items-center gap-1 ${battColor}`}>
              <BatterySmartphone percent={battery} />
              {battery}%
            </span>
          </div>

          {/* GPS */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 uppercase tracking-[0.1em] w-12 shrink-0">GPS</span>
            <span className="text-slate-300 tabular-nums">
              {latitude.toFixed(5)}, {longitude.toFixed(5)}
            </span>
          </div>

          {/* Sector */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 uppercase tracking-[0.1em] w-12 shrink-0">Sector</span>
            <span className="text-slate-300">{sectorLabel}</span>
          </div>

          {/* Signal */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-500 uppercase tracking-[0.1em] w-12 shrink-0">Signal</span>
            <span className={signalCls}>{signalLabel}</span>
          </div>
        </div>
      </div>
    </Popup>
  );
}
