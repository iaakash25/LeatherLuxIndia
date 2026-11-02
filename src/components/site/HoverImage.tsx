import { cn } from "@/lib/utils";
import { Img } from "./Reveal";

export type HoverEffect = "swap" | "slide" | "zoom" | "none";

export const HOVER_EFFECTS: { value: HoverEffect; label: string; hint: string; needsSecondPhoto: boolean }[] = [
  { value: "swap", label: "Swap to the second photo", hint: "The second photo fades in over the first.", needsSecondPhoto: true },
  { value: "slide", label: "Slide in the second photo", hint: "The second photo slides in from the right.", needsSecondPhoto: true },
  { value: "zoom", label: "Slow zoom", hint: "The first photo slowly zooms in.", needsSecondPhoto: false },
  { value: "none", label: "No animation", hint: "The card stays still.", needsSecondPhoto: false },
];

// Whole class names, so the stylesheet generator can see them. The surrounding element must be a `group` that clips (overflow-hidden).
const BASE = "absolute inset-0 h-full w-full object-cover";
const FIRST: Record<HoverEffect, string> = {
  swap: `${BASE} transition-[transform,opacity] duration-[900ms] ease-lux group-hover:scale-[1.03] group-hover:opacity-0`,
  slide: `${BASE} transition-transform duration-[900ms] ease-lux group-hover:-translate-x-[6%]`,
  zoom: `${BASE} transition-transform duration-[1400ms] ease-lux group-hover:scale-[1.08]`,
  none: BASE,
};
const SECOND: Record<"swap" | "slide", string> = {
  swap: `${BASE} scale-[1.03] opacity-0 transition-[transform,opacity] duration-[900ms] ease-lux group-hover:scale-100 group-hover:opacity-100`,
  slide: `${BASE} translate-x-full transition-transform duration-[900ms] ease-lux group-hover:translate-x-0`,
};

/**
 * A product photo that reacts when its `group` parent is hovered. `swap` and `slide` bring in `hoverSrc` (the product's second photo); a
 * product with only one photo falls back to the slow zoom, so a card never animates towards nothing.
 */
export function HoverImage({ src, hoverSrc, effect = "swap", alt, className }: { src: string; hoverSrc?: string | undefined; effect?: HoverEffect | undefined; alt: string; className?: string }) {
  const kind: HoverEffect = (effect === "swap" || effect === "slide") && !hoverSrc ? "zoom" : effect;
  return (
    <>
      <Img src={src} alt={alt} width={1024} height={1280} className={cn(FIRST[kind], className)} />
      {(kind === "swap" || kind === "slide") && hoverSrc && <Img src={hoverSrc} alt="" width={1024} height={1280} className={SECOND[kind]} />}
    </>
  );
}
