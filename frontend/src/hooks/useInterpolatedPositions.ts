// frontend/src/hooks/useInterpolatedPositions.ts

import { useEffect, useRef, useState } from "react";

interface LatLngMap { [droneId: string]: [number, number] }

/**
 * Smoothly interpolate drone positions toward the latest target from the store.
 * When targets change, we tween from the current displayed position to the new
 * target over `durationMs` using linear interpolation (geographically accurate
 * enough for distances under 500m; precise shortest-path geodesic isn't
 * worth the complexity for this use case).
 */
export function useInterpolatedPositions(
  targets: LatLngMap,
  durationMs: number = 450,
): LatLngMap {
  const [displayed, setDisplayed] = useState<LatLngMap>({});
  const animationRef = useRef<{
    startMs: number;
    fromMap: LatLngMap;
    toMap: LatLngMap;
  } | null>(null);

  // When targets change, kick off a new interpolation from current displayed -> new targets
  useEffect(() => {
    if (Object.keys(targets).length === 0) return;
    const now = performance.now();
    animationRef.current = {
      startMs: now,
      fromMap: { ...displayed },
      toMap: { ...targets },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets]);

  // Animation loop
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const anim = animationRef.current;
      if (!anim) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const t = Math.min(1, (performance.now() - anim.startMs) / durationMs);
      const eased = 1 - Math.pow(1 - t, 2);  // easeOutQuad
      const next: LatLngMap = {};
      for (const id in anim.toMap) {
        const to = anim.toMap[id];
        const from = anim.fromMap[id] ?? to;
        next[id] = [
          from[0] + (to[0] - from[0]) * eased,
          from[1] + (to[1] - from[1]) * eased,
        ];
      }
      // Include drones that haven't received a new target but were displayed before
      for (const id in anim.fromMap) {
        if (!(id in next)) next[id] = anim.fromMap[id];
      }
      setDisplayed(next);
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        // Fully reached targets — stop animating until targets change
        animationRef.current = null;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [durationMs]);

  return displayed;
}
