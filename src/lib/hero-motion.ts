import { useEffect, useRef } from "react";

/**
 * Makes the home hero feel alive without a video. Two things happen:
 *  - always (pure CSS, `.anim-hero-*` in styles.css): the photo drifts very slowly and a soft band of light crosses it every few seconds;
 *  - while a mouse is over the hero (this hook): the photo moves a little against the pointer, the text moves a little with it, and a
 *    warm light follows the pointer across the leather. The movement eases towards the pointer, so it glides instead of tracking.
 * Touch screens and visitors who ask for reduced motion get a still page (the CSS drift is switched off there too). Everything moves with
 * transforms and opacity only, nothing is laid out again, and the animation frame loop sleeps whenever the pointer is still.
 */
export function useHeroMotion() {
  const host = useRef<HTMLElement>(null);
  const media = useRef<HTMLDivElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const calm = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mouse = window.matchMedia("(hover: hover) and (pointer: fine)");

    // The CSS drift and sheen pause while the hero is off screen or the tab is hidden.
    let offscreen = false;
    const syncPaused = () => el.classList.toggle("is-paused", offscreen || document.hidden);
    const io = new IntersectionObserver(([e]) => {
      offscreen = !e?.isIntersecting;
      syncPaused();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", syncPaused);

    // target = where the pointer is; drawn = what is on screen now. Pointer position is -1..1 across the hero; the glow is in pixels.
    const target = { x: 0, y: 0, gx: 0, gy: 0, light: 0 };
    const drawn = { ...target };
    const CATCH_UP_MS = 240;
    let raf = 0,
      last = 0;

    const draw = () => {
      if (media.current)
        media.current.style.transform = `translate3d(${(-drawn.x * 22).toFixed(2)}px, ${(-drawn.y * 14).toFixed(2)}px, 0)`;
      if (copy.current)
        copy.current.style.transform = `translate3d(${(drawn.x * 8).toFixed(2)}px, ${(drawn.y * 5).toFixed(2)}px, 0)`;
      const g = glow.current;
      if (g) {
        const r = g.offsetWidth / 2;
        g.style.transform = `translate3d(${(drawn.gx - r).toFixed(1)}px, ${(drawn.gy - r).toFixed(1)}px, 0)`;
        g.style.opacity = drawn.light.toFixed(3);
      }
    };
    const tick = (now: number) => {
      const k = 1 - Math.exp(-Math.min(64, now - (last || now - 16)) / CATCH_UP_MS);
      last = now;
      let moving = false;
      for (const key of Object.keys(target) as (keyof typeof target)[]) {
        const gap = target[key] - drawn[key];
        if (Math.abs(gap) > 0.002) {
          drawn[key] += gap * k;
          moving = true;
        } else drawn[key] = target[key];
      }
      draw();
      if (moving) raf = requestAnimationFrame(tick);
      else {
        raf = 0;
        last = 0;
      }
    };
    const wake = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };

    const enabled = () => mouse.matches && !calm.matches;
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch" || !enabled()) return;
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left,
        py = e.clientY - r.top;
      target.x = (px / r.width) * 2 - 1;
      target.y = (py / r.height) * 2 - 1;
      target.gx = px;
      target.gy = py;
      target.light = 1;
      wake();
    };
    // Back to rest. The light stays where it was and fades out in place.
    const rest = () => {
      target.x = 0;
      target.y = 0;
      target.light = 0;
      wake();
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerleave", rest);
    calm.addEventListener("change", rest);

    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", syncPaused);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerleave", rest);
      calm.removeEventListener("change", rest);
      cancelAnimationFrame(raf);
    };
  }, []);

  return { host, media, copy, glow };
}
