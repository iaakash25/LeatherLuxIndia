import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useState } from "react";
import { z } from "zod";
import { images, ALL_TYPES, applyFilters, COLLECTIONS, COLOURS, formatINR, getCollection, PRICE_MAX, PRICE_MIN, searchProducts, type Filters, type SortKey } from "@/lib/catalog";
import { useCatalog } from "@/lib/catalog-live";
import { Select } from "@/components/ui/select-menu";
import { Drawer } from "@/components/site/Drawer";
import { ProductCard } from "@/components/site/ProductCard";
import { LiveHero } from "@/components/site/LiveHero";
import { Img, Reveal } from "@/components/site/Reveal";
import { brandFromMatches, brandTitle } from "@/lib/brand";
import { cn } from "@/lib/utils";

const searchSchema = z.object({ q: z.string().optional() });

export const Route = createFileRoute("/collections/$slug")({
  validateSearch: (s) => searchSchema.parse(s),
  loader: ({ params }) => {
    const c = getCollection(params.slug);
    if (!c) throw notFound();
    return { slug: c.slug, title: c.title, intro: c.intro };
  },
  head: ({ loaderData, matches }) => {
    const site = brandTitle(brandFromMatches(matches));
    return {
    meta: loaderData
      ? [
          { title: `${loaderData.title} — ${site}` },
          { name: "description", content: loaderData.intro },
          { property: "og:title", content: `${loaderData.title} — ${site}` },
          { property: "og:description", content: loaderData.intro },
        ]
      : [{ title: `Collection not found — ${site}` }, { name: "robots", content: "noindex" }],
    };
  },
  notFoundComponent: () => (
    <div className="mx-auto max-w-xl px-5 py-40 text-center">
      <p className="font-display text-5xl">Collection not found</p>
      <Link to="/collections/$slug" params={{ slug: "all" }} className="btn-ink mt-10">View all pieces</Link>
    </div>
  ),
  component: CollectionPage,
});

const EMPTY: Filters = { types: [], colours: [], min: PRICE_MIN, max: PRICE_MAX, inStock: false };
const SORTS: { k: SortKey; l: string }[] = [
  { k: "featured", l: "Featured" }, { k: "new", l: "Newest" }, { k: "price-asc", l: "Price: low to high" }, { k: "price-desc", l: "Price: high to low" },
];

function CollectionPage() {
  const { slug } = Route.useParams();
  const { q } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const c = getCollection(slug)!;
  const { products } = useCatalog();
  const [f, setF] = useState<Filters>(EMPTY);
  const [sort, setSort] = useState<SortKey>("featured");
  const [panel, setPanel] = useState(false);
  const [lastSlug, setLastSlug] = useState(slug);
  if (lastSlug !== slug) { setLastSlug(slug); setF(EMPTY); }

  const base = useMemo(() => searchProducts(q ?? "", products.filter(c.filter)), [c, q, products]);
  const results = useMemo(() => applyFilters(base, f, sort), [base, f, sort]);
  const availTypes = ALL_TYPES.filter((t) => base.some((p) => p.type === t));
  const availColours = Object.keys(COLOURS).filter((k) => base.some((p) => p.colours.includes(k)));

  const chips: { label: string; clear: () => void }[] = [
    ...f.types.map((t) => ({ label: t, clear: () => setF((s) => ({ ...s, types: s.types.filter((x) => x !== t) })) })),
    ...f.colours.map((t) => ({ label: t, clear: () => setF((s) => ({ ...s, colours: s.colours.filter((x) => x !== t) })) })),
    ...(f.min > PRICE_MIN || f.max < PRICE_MAX ? [{ label: `${formatINR(f.min)} – ${f.max >= PRICE_MAX ? formatINR(PRICE_MAX) + "+" : formatINR(f.max)}`, clear: () => setF((s) => ({ ...s, min: PRICE_MIN, max: PRICE_MAX })) }] : []),
    ...(f.inStock ? [{ label: "In stock", clear: () => setF((s) => ({ ...s, inStock: false })) }] : []),
  ];
  const toggle = (key: "types" | "colours", v: string) => setF((s) => ({ ...s, [key]: s[key].includes(v) ? s[key].filter((x) => x !== v) : [...s[key], v] }));
  const clearAll = () => setF(EMPTY);

  return (
    <>
      {/* Banner */}
      <LiveHero
        copyClassName="relative mx-auto flex min-h-[340px] max-w-[1600px] flex-col justify-end px-5 py-10 lg:min-h-[440px] lg:px-10 lg:py-14"
        media={<Img src={c.image} alt="" eager className="h-full w-full object-cover opacity-70" />}
        scrim={<div className="absolute inset-0 scrim-hero" />}
      >
        <nav aria-label="Breadcrumb" className="text-xs text-chalk/60"><Link to="/" className="hover:text-chalk">Home</Link> <span className="mx-2">/</span> <span className="text-chalk">{c.title}</span></nav>
        <p className="anim-rise eyebrow mt-8 text-brass">{c.eyebrow}</p>
        <h1 className="anim-rise font-display mt-3 text-[52px] leading-[0.95] lg:text-[96px]">{c.title}</h1>
        <div className="mt-5 flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <p className="max-w-md text-sm text-chalk/75">{c.intro}</p>
          <p className="text-xs tracking-[0.14em] uppercase text-chalk/60" aria-live="polite">{results.length} {results.length === 1 ? "piece" : "pieces"}</p>
        </div>
      </LiveHero>

      {/* Sub-collections */}
      <div className="no-scrollbar overflow-x-auto border-b border-hairline">
        <ul className="mx-auto flex max-w-[1600px] gap-7 px-5 lg:px-10">
          {/* The Coming Soon tab only appears while something is coming soon (or when you are on it). */}
          {COLLECTIONS.filter((x) => x.slug !== "coming-soon" || slug === "coming-soon" || products.some((p) => p.availability === "coming_soon")).map((x) => (
            <li key={x.slug}><Link to="/collections/$slug" params={{ slug: x.slug }} className={cn("block whitespace-nowrap border-b py-4 text-[13px] transition-colors", x.slug === slug ? "border-ink" : "border-transparent text-muted-foreground hover:text-ink")}>{x.title}</Link></li>
          ))}
        </ul>
      </div>

      {/* Toolbar */}
      <div className="sticky top-[100px] z-30 border-b border-hairline bg-chalk/95 lg:top-[156px]">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-4 px-5 lg:px-10">
          <button onClick={() => setPanel(true)} className="flex items-center gap-2 text-[13px] hover:text-oxblood" aria-haspopup="dialog">
            <SlidersHorizontal className="h-4 w-4 stroke-[1.3]" /> Filter {chips.length > 0 && <span className="grid h-5 min-w-5 place-items-center bg-ink px-1 text-[10px] text-chalk">{chips.length}</span>}
          </button>
          {q && (
            <div className="flex min-w-0 items-center gap-2 text-[13px]">
              <Search className="h-3.5 w-3.5 shrink-0" /><span className="truncate">“{q}”</span>
              <button aria-label="Clear search" onClick={() => navigate({ search: {} })} className="hover:text-oxblood"><X className="h-3.5 w-3.5" /></button>
            </div>
          )}
          <Select<SortKey> variant="text" align="end" prefix="Sort:" aria-label="Sort" value={sort} onChange={setSort} menuClassName="w-56"
            options={SORTS.map((x) => ({ value: x.k, label: x.l }))} />
        </div>
        {chips.length > 0 && (
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-5 pb-3 lg:px-10">
            {chips.map((ch) => (
              <button key={ch.label} onClick={ch.clear} className="flex items-center gap-2 border border-input px-3 py-1.5 text-xs hover:border-ink" aria-label={`Remove filter ${ch.label}`}>{ch.label}<X className="h-3 w-3" /></button>
            ))}
            <button onClick={clearAll} className="ml-1 text-xs underline underline-offset-4 hover:text-oxblood">Clear all</button>
          </div>
        )}
      </div>

      {/* Grid */}
      <section className="mx-auto max-w-[1600px] px-5 pb-28 pt-10 lg:px-10 lg:pt-14">
        {results.length === 0 ? (
          <div className="mx-auto max-w-md py-24 text-center">
            <p className="font-display text-4xl">Nothing matches — yet.</p>
            <p className="mt-4 text-sm text-muted-foreground">Try widening the price range or removing a colour.</p>
            <div className="mt-8 flex justify-center gap-3">
              <button onClick={clearAll} className="btn-ink">Clear filters</button>
              {q && <button onClick={() => navigate({ search: {} })} className="btn-outline">Clear search</button>}
            </div>
          </div>
        ) : (
          <ul className="grid grid-cols-2 gap-x-3 gap-y-12 md:grid-cols-3 lg:gap-x-6 lg:gap-y-16 xl:grid-cols-4">
            {results.flatMap((p, i) => {
              const card = <li key={p.slug}><Reveal delay={(i % 4) * 60}><ProductCard p={p} /></Reveal></li>;
              if (i !== 3 || results.length < 8) return [card];
              return [card, (
                <li key="campaign" className="col-span-2">
                  <Reveal className="h-full">
                    <Link to="/collections/$slug" params={{ slug: "work-travel" }} className="group relative block h-full min-h-[420px] overflow-hidden bg-ink text-chalk">
                      <Img src={images.travel} alt="" className="absolute inset-0 h-full w-full object-cover opacity-85 transition-transform duration-[1000ms] ease-lux group-hover:scale-105" />
                      <span className="absolute inset-0 scrim-bottom" />
                      <span className="absolute bottom-0 p-6 lg:p-8">
                        <span className="eyebrow text-brass">Campaign</span>
                        <span className="font-display mt-3 block text-4xl leading-none lg:text-5xl">Built for <em>movement</em></span>
                        <span className="mt-4 block w-fit text-sm link-line">Shop Work &amp; Travel</span>
                      </span>
                    </Link>
                  </Reveal>
                </li>
              )];
            })}
          </ul>
        )}
      </section>

      {/* Filter drawer */}
      <Drawer open={panel} side="left" label="Filters" onClose={() => setPanel(false)}>
          <div className="flex h-16 shrink-0 items-center justify-between border-b border-hairline px-6">
            <p className="eyebrow">Filter</p>
            <button onClick={() => setPanel(false)} aria-label="Close filters" className="-mr-2 grid h-10 w-10 place-items-center"><X className="h-5 w-5 stroke-[1.3]" /></button>
          </div>
          <div className="flex-1 divide-y divide-hairline overflow-y-auto px-6">
            <fieldset className="py-6">
              <legend className="eyebrow mb-4 text-muted-foreground">Category</legend>
              <div className="space-y-1">
                {availTypes.map((t) => {
                  const n = base.filter((p) => p.type === t).length;
                  return (
                    <label key={t} className="flex cursor-pointer items-center gap-3 py-1.5 text-sm">
                      <input type="checkbox" checked={f.types.includes(t)} onChange={() => toggle("types", t)} className="h-4 w-4 accent-[var(--ink)]" />
                      <span className="flex-1">{t}</span><span className="text-xs text-muted-foreground">{n}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <fieldset className="py-6">
              <legend className="eyebrow mb-5 text-muted-foreground">Price</legend>
              <PriceRange min={f.min} max={f.max} onChange={(min, max) => setF((s) => ({ ...s, min, max }))} />
            </fieldset>
            <fieldset className="py-6">
              <legend className="eyebrow mb-4 text-muted-foreground">Colour</legend>
              <div className="grid grid-cols-2 gap-2">
                {availColours.map((k) => (
                  <button key={k} type="button" aria-pressed={f.colours.includes(k)} onClick={() => toggle("colours", k)} className={cn("flex items-center gap-3 border px-3 py-2.5 text-sm transition-colors", f.colours.includes(k) ? "border-ink" : "border-input hover:border-ink/50")}>
                    <span className="h-4 w-4 rounded-full ring-1 ring-hairline" style={{ background: COLOURS[k]?.swatch }} />{k}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset className="py-6">
              <legend className="eyebrow mb-4 text-muted-foreground">Availability</legend>
              <label className="flex cursor-pointer items-center justify-between text-sm">
                In stock only
                <input type="checkbox" role="switch" checked={f.inStock} onChange={(e) => setF((s) => ({ ...s, inStock: e.target.checked }))} className="h-4 w-4 accent-[var(--ink)]" />
              </label>
            </fieldset>
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-hairline p-6">
            <button onClick={clearAll} className="btn-outline px-0">Clear all</button>
            <button onClick={() => setPanel(false)} className="btn-ink px-0">Show {results.length}</button>
          </div>
      </Drawer>
    </>
  );
}

function PriceRange({ min, max, onChange }: { min: number; max: number; onChange: (a: number, b: number) => void }) {
  const pct = (v: number) => ((v - PRICE_MIN) / (PRICE_MAX - PRICE_MIN)) * 100;
  const presets: [number, number, string][] = [[PRICE_MIN, 2000, "Under ₹2,000"], [2000, 6000, "₹2,000–6,000"], [6000, 15000, "₹6,000–15,000"], [15000, PRICE_MAX, "₹15,000+"]];
  return (
    <div>
      <div className="flex justify-between text-sm tabular-nums"><span>{formatINR(min)}</span><span>{max >= PRICE_MAX ? `${formatINR(PRICE_MAX)}+` : formatINR(max)}</span></div>
      <div className="relative mt-4 h-4">
        <div className="absolute top-1/2 h-px w-full -translate-y-1/2 bg-input" />
        <div className="absolute top-1/2 h-[2px] -translate-y-1/2 bg-ink" style={{ left: `${pct(min)}%`, right: `${100 - pct(max)}%` }} />
        <input aria-label="Minimum price" type="range" className="range" min={PRICE_MIN} max={PRICE_MAX} step={500} value={min} onChange={(e) => onChange(Math.min(Number(e.target.value), max - 500), max)} />
        <input aria-label="Maximum price" type="range" className="range" min={PRICE_MIN} max={PRICE_MAX} step={500} value={max} onChange={(e) => onChange(min, Math.max(Number(e.target.value), min + 500))} />
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {presets.map(([a, b, l]) => (
          <button key={l} type="button" onClick={() => onChange(a, b)} className={cn("border px-3 py-1.5 text-xs", min === a && max === b ? "border-ink" : "border-input hover:border-ink/50")}>{l}</button>
        ))}
      </div>
    </div>
  );
}
