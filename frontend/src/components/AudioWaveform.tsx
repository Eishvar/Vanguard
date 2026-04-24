// Renders a CSS-animated waveform bar chart.
// Only r14_c2 (distressed) and r0_c3 (regular calls) have audio. Tile IDs are r{row}_c{col} format.
// r8_c16 and r0_c14 are silent — this component returns null for them.

interface Props {
  tileId: string;
}

const WAVEFORM_PATTERNS: Record<string, { bars: number[]; durationMs: number }> = {
  // Distressed — irregular amplitudes, faster cycle
  r14_c2: {
    bars: [3, 10, 5, 16, 4, 14, 6, 18, 3, 14, 8, 16, 4, 12, 6, 18, 3, 10, 7, 14],
    durationMs: 600,
  },
  // Regular calls — even pattern, slower cycle
  r0_c3: {
    bars: [5, 10, 7, 12, 9, 12, 7, 10, 5, 10, 7, 12, 9, 12, 7, 10, 5, 10, 7, 12],
    durationMs: 1200,
  },
};

const MAX_BAR_HEIGHT = 18; // px, matches largest value in bars arrays
const CONTAINER_HEIGHT = 24; // px

const AudioWaveform = ({ tileId }: Props) => {
  const pattern = WAVEFORM_PATTERNS[tileId];
  if (!pattern) return null;

  return (
    <div
      className="flex items-end gap-[2px]"
      style={{ height: `${CONTAINER_HEIGHT}px` }}
      aria-label="Audio waveform"
    >
      {pattern.bars.map((h, i) => (
        <div
          key={i}
          className="w-[2px] bg-primary rounded-[1px] animate-waveform-pulse"
          style={{
            height: `${Math.round((h / MAX_BAR_HEIGHT) * CONTAINER_HEIGHT)}px`,
            animationDuration: `${pattern.durationMs}ms`,
            animationDelay: `${Math.round((i / pattern.bars.length) * pattern.durationMs)}ms`,
            transformOrigin: "bottom",
          }}
        />
      ))}
    </div>
  );
};

export default AudioWaveform;
