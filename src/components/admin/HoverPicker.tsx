import { HOVER_EFFECTS, HoverImage } from "@/components/site/HoverImage";
import { cn } from "@/lib/utils";
import type { HoverEffect } from "./inventory-types";

/**
 * Chooses what a product card does when a shopper hovers it, and shows it: hover the picture to see the real effect with this
 * product's own photos. An effect that needs a second photo is switched off until there is one.
 */
export function HoverPicker({ id, value, onChange, photos }: { id: string; value: HoverEffect; onChange: (v: HoverEffect) => void; photos: string[] }) {
  const two = photos.length > 1;
  return (
    <fieldset className="grid gap-5 sm:grid-cols-[minmax(0,1fr)_9rem]">
      <legend className="eyebrow text-muted-foreground">On hover</legend>
      <div role="radiogroup" aria-label="Hover effect" className="mt-3 space-y-2.5">
        {HOVER_EFFECTS.map((o) => {
          const off = o.needsSecondPhoto && !two;
          return (
            <label key={o.value} className={cn("flex items-start gap-3 text-sm", off ? "opacity-45" : "cursor-pointer")}>
              <input type="radio" name={`${id}-hover`} className="mt-0.5 accent-ink" checked={value === o.value} disabled={off} onChange={() => onChange(o.value)} />
              <span>{o.label}<span className="block text-xs text-muted-foreground">{off ? "Needs a second photo." : o.hint}</span></span>
            </label>
          );
        })}
      </div>
      <div className="mt-3">
        <div className="group relative aspect-[4/5] overflow-hidden bg-chalk ring-1 ring-hairline" aria-hidden="true">
          {photos[0] ? <HoverImage src={photos[0]} hoverSrc={photos[1]} effect={value} alt="" /> : <span className="grid h-full place-items-center px-2 text-center text-[11px] text-muted-foreground">Add a photo to preview</span>}
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">Hover over the picture to preview.</p>
      </div>
    </fieldset>
  );
}
