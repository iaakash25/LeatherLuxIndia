import { useEffect, useState } from "react";

/** Eases a number up from 0 to `target` once `start` is true. Jumps straight to it if the visitor prefers reduced motion. */
export function useCountUp(target: number | null, start: boolean, duration = 1400): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (target === null || !start) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setValue(target); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      setValue(Math.round(target * (1 - Math.pow(1 - p, 4)))); // ease-out quart
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, start, duration]);
  return value;
}
