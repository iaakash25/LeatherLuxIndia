import { Link } from "@tanstack/react-router";
import { Heart, Plus } from "lucide-react";
import { useState } from "react";
import { COLOURS, formatINR, productThumb, type Product } from "@/lib/catalog";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { HoverImage } from "./HoverImage";

export function ProductCard({ p, className, tone = "paper" }: { p: Product; className?: string; tone?: "paper" | "chalk" }) {
  const { wishlist, toggleWish, addToCart } = useStore();
  const [colour, setColour] = useState(p.colours[0]!);
  const wished = wishlist.includes(p.slug);
  return (
    <article className={cn("group relative", className)}>
      <div className={cn("relative aspect-[4/5] overflow-hidden", tone === "paper" ? "bg-paper" : "bg-chalk")}>
        <Link to="/products/$slug" params={{ slug: p.slug }} aria-label={p.name} className="absolute inset-0 block">
          <HoverImage src={productThumb(p)} hoverSrc={p.images.length > 1 ? productThumb(p, 1) : undefined} effect={p.hoverEffect} alt={p.name} />
        </Link>
        <div className="pointer-events-none absolute left-3 top-3 flex gap-1.5">
          {p.isNew && <span className="eyebrow bg-paper/90 px-2 py-1 text-[10px] text-ink">New</span>}
          {p.stock === "low" && <span className="eyebrow bg-oxblood px-2 py-1 text-[10px] text-chalk">Few left</span>}
          {p.availability === "coming_soon"
            ? <span className="eyebrow bg-brass px-2 py-1 text-[10px] text-ink">Coming soon</span>
            : p.stock === "out" && <span className="eyebrow bg-ink px-2 py-1 text-[10px] text-chalk">Sold out</span>}
        </div>
        <button
          type="button"
          onClick={() => toggleWish(p.slug)}
          aria-pressed={wished}
          aria-label={wished ? `Remove ${p.name} from wishlist` : `Save ${p.name} to wishlist`}
          className="absolute right-2 top-2 grid h-10 w-10 place-items-center text-ink transition-colors hover:text-oxblood"
        >
          <Heart className={cn("h-[18px] w-[18px] stroke-[1.4]", wished && "fill-oxblood text-oxblood")} />
        </button>
        <button
          type="button"
          disabled={p.stock === "out"}
          onClick={() => addToCart({ slug: p.slug, colour, size: p.sizes?.[2] })}
          className="absolute inset-x-0 bottom-0 flex h-12 items-center justify-center gap-2 bg-ink text-chalk eyebrow transition-[transform,background-color,color] duration-500 ease-lux hover:bg-oxblood disabled:bg-muted disabled:text-muted-foreground lg:translate-y-full lg:group-hover:translate-y-0 lg:group-focus-within:translate-y-0 max-lg:right-auto max-lg:w-12 max-lg:bg-paper/90 max-lg:text-ink"
          aria-label={`Quick add ${p.name} in ${colour}`}
        >
          <Plus className="h-4 w-4 stroke-[1.5]" /><span className="max-lg:hidden">{p.availability === "coming_soon" ? "Coming soon" : p.stock === "out" ? "Sold out" : "Quick add"}</span>
        </button>
      </div>
      <div className="flex items-start justify-between gap-3 pt-4">
        <div className="min-w-0">
          <p className="eyebrow text-[10px] text-muted-foreground">{p.type}</p>
          <h3 className="mt-1.5 truncate text-[15px] leading-snug">
            <Link to="/products/$slug" params={{ slug: p.slug }} className="link-line">{p.name}</Link>
          </h3>
        </div>
        <p className="shrink-0 pt-[18px] text-[14px] tabular-nums">{formatINR(p.price)}</p>
      </div>
      <div className="mt-2.5 flex items-center gap-2" role="radiogroup" aria-label="Colour">
        {p.colours.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={c === colour} aria-label={c} title={c} onClick={() => setColour(c)}
            className={cn("h-3.5 w-3.5 rounded-full ring-offset-2 ring-offset-background transition", c === colour ? "ring-1 ring-ink" : "ring-1 ring-transparent hover:ring-hairline")}
            style={{ background: COLOURS[c]?.swatch }} />
        ))}
        <span className="ml-1 text-xs text-muted-foreground">{colour}</span>
      </div>
    </article>
  );
}
