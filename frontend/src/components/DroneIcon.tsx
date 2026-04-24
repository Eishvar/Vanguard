// frontend/src/components/DroneIcon.tsx

interface Props {
  droneId: string;
  isOffline: boolean;
  isIsolated?: boolean;    // red ring if no comms path to base
  zoom: number;
}

// Zoom threshold: above this, use perspective SVG (simulated 3D)
const ZOOM_3D_THRESHOLD = 16;

// Color per drone — matches existing DRONE_COLORS in missionStore
const DRONE_HEX: Record<string, string> = {
  DRONE_A: '#f87171',  // red-400
  DRONE_B: '#c084fc',  // purple-400
  DRONE_C: '#22d3ee',  // cyan-400
};

export function DroneIcon({ droneId, isOffline, isIsolated, zoom }: Props) {
  const color = isOffline ? '#ef4444' : (DRONE_HEX[droneId] ?? '#94a3b8');
  const is3D  = zoom >= ZOOM_3D_THRESHOLD;

  return (
    <div className="relative cursor-pointer select-none" style={{ width: 32, height: 32 }}>
      {/* Isolated warning ring */}
      {isIsolated && !isOffline && (
        <div
          className="absolute inset-0 rounded-full animate-ping"
          style={{ border: '2px solid #ef4444', opacity: 0.6 }}
        />
      )}

      {/* 2D top-down drone SVG */}
      {!is3D && (
        <svg viewBox="0 0 32 32" width={32} height={32} xmlns="http://www.w3.org/2000/svg">
          {/* Drone body — central circle */}
          <circle cx="16" cy="16" r="5" fill={color} opacity={isOffline ? 0.5 : 1} />
          {/* Arms — 4 diagonal lines to rotors */}
          {[[6, 6], [26, 6], [6, 26], [26, 26]].map(([rx, ry], i) => (
            <g key={i}>
              <line x1="16" y1="16" x2={rx} y2={ry} stroke={color} strokeWidth="1.5" opacity={isOffline ? 0.4 : 0.8} />
              <circle cx={rx} cy={ry} r="4" fill="none" stroke={color} strokeWidth="1.5" opacity={isOffline ? 0.4 : 0.9} />
            </g>
          ))}
          {/* Offline X */}
          {isOffline && (
            <>
              <line x1="13" y1="13" x2="19" y2="19" stroke="#ef4444" strokeWidth="2" />
              <line x1="19" y1="13" x2="13" y2="19" stroke="#ef4444" strokeWidth="2" />
            </>
          )}
          {/* Ping animation dot — only when active */}
          {!isOffline && (
            <circle cx="16" cy="16" r="5" fill={color} opacity="0.4">
              <animate attributeName="r" values="5;10;5" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.4;0;0.4" dur="2s" repeatCount="indefinite" />
            </circle>
          )}
        </svg>
      )}

      {/* Perspective/angled drone SVG (high zoom) */}
      {is3D && (
        <svg viewBox="0 0 32 32" width={40} height={40} xmlns="http://www.w3.org/2000/svg"
             style={{ transform: 'perspective(80px) rotateX(30deg)' }}>
          {/* Same drone but slightly larger and tilted via CSS transform */}
          <circle cx="16" cy="16" r="5" fill={color} />
          {[[6, 6], [26, 6], [6, 26], [26, 26]].map(([rx, ry], i) => (
            <g key={i}>
              <line x1="16" y1="16" x2={rx} y2={ry} stroke={color} strokeWidth="2" />
              <circle cx={rx} cy={ry} r="5" fill="none" stroke={color} strokeWidth="2" />
            </g>
          ))}
          {isOffline && (
            <>
              <line x1="13" y1="13" x2="19" y2="19" stroke="#ef4444" strokeWidth="2.5" />
              <line x1="19" y1="13" x2="13" y2="19" stroke="#ef4444" strokeWidth="2.5" />
            </>
          )}
        </svg>
      )}

      {/* Drone ID label below icon */}
      <div
        className="absolute -bottom-4 left-1/2 -translate-x-1/2 font-mono text-[9px] whitespace-nowrap"
        style={{ color, textShadow: '0 0 4px rgba(0,0,0,0.9)' }}
      >
        {droneId.replace('DRONE_', '')}
      </div>
    </div>
  );
}
