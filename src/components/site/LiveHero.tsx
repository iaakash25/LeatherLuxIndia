import type { ReactNode } from "react";
import { useHeroMotion } from "@/lib/hero-motion";
import { cn } from "@/lib/utils";

/**
 * A hero banner with a live photo: it drifts slowly, a band of light crosses it, and with a mouse it follows the pointer (see
 * src/lib/hero-motion.ts and the `.anim-hero-*` rules in src/styles.css). Every hero on the site is one of these, so they all move alike.
 *
 *  - `media`: the photo, an <img> (or <Img>) that fills its frame, e.g. className="h-full w-full object-cover".
 *  - `scrim`: dark gradients that keep the text readable. They stay still, over the moving photo.
 *  - `className` sizes the section; `copyClassName` lays out its text (children), which moves a little against the photo.
 *  - `overlay` is anything pinned to the section itself, such as a caption in a corner; it stays still.
 */
export function LiveHero({
  media,
  scrim,
  overlay,
  className,
  copyClassName,
  children,
}: {
  media: ReactNode;
  scrim?: ReactNode;
  overlay?: ReactNode;
  className?: string;
  copyClassName?: string;
  children: ReactNode;
}) {
  const hero = useHeroMotion();
  return (
    <section
      ref={hero.host}
      className={cn("relative overflow-hidden bg-ink text-chalk", className)}
    >
      {/* The frame is a little larger than the hero so that movement never shows an edge. The photo's own drift is one level in, so that
          nothing the photo component does to itself (such as fading in) can cancel it. */}
      <div ref={hero.media} className="absolute -inset-[3%] will-change-transform">
        <div className="anim-hero-img h-full w-full">{media}</div>
      </div>
      <div
        ref={hero.glow}
        aria-hidden="true"
        className="hero-glow pointer-events-none absolute left-0 top-0 h-[720px] w-[720px] rounded-full opacity-0"
      />
      <div
        aria-hidden="true"
        className="hero-sheen anim-hero-sheen pointer-events-none absolute inset-y-0 left-0 w-[38%]"
      />
      {scrim}
      <div ref={hero.copy} className={copyClassName}>
        {children}
      </div>
      {overlay}
    </section>
  );
}
