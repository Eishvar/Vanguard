// frontend/src/components/BatteryIcon.tsx

interface BatteryIconProps {
  percent: number;
  className?: string;
}

export const BatteryIcon = ({ percent, className = "" }: BatteryIconProps) => {
  const clamped   = Math.max(0, Math.min(100, percent));
  const fillColor = clamped < 20 ? "#f87171" : "#2dd4bf"; // red-400 / teal-400
  const fillWidth = (clamped / 100) * 16;                  // inner bar: 0–16px

  return (
    <svg
      width="24"
      height="12"
      viewBox="0 0 24 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label={`Battery ${clamped}%`}
    >
      {/* Outer body */}
      <rect x="0.5" y="0.5" width="20" height="11" rx="1.5" stroke="currentColor" strokeWidth="1" />
      {/* Terminal nub */}
      <rect x="21.5" y="3.5" width="2" height="5" rx="0.5" fill="currentColor" />
      {/* Fill level */}
      {fillWidth > 0 && (
        <rect x="2" y="2" width={fillWidth} height="8" rx="0.5" fill={fillColor} />
      )}
    </svg>
  );
};
