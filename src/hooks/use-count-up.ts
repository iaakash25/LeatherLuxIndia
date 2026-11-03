import { useEffect, useState } from "react";

/**
 * Eases a number from `from` (0 unless given) up to `target` once `start` is true. Jumps straight to it if the visitor prefers reduced motion.
 * Until it starts, the number shown is `from`.
 */
export function useCountUp(target: number | null, start: boolean, duration = 1400, from = 0): number {
  const [value, setValue] = useState(from);
  // `from` arrives later than the first render (it depends on the server's answer): show it while waiting to start
  useEffect(() => { if (!start) setValue(from); }, [from, start]);
  useEffect(() => {
    if (target === null || !start) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setValue(target); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      setValue(Math.round(from + (target - from) * (1 - Math.pow(1 - p, 4)))); // ease-out quart
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, start, duration, from]);
  return value;
}
