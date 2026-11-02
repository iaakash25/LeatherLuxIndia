import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { Heart, Minus, Plus, Star, Truck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api, apiEnabled, errorMessage } from "@/lib/api";
import { COLOURS, formatINR, type Product } from "@/lib/catalog";
import { brandFromMatches, brandTitle } from "@/lib/brand";
import { loadCatalog, useCatalog } from "@/lib/catalog-live";
import { LAUNCH } from "@/lib/launch";
import { useOrdersOpen } from "@/lib/store-status";
import { useStore } from "@/lib/store";
import { ProductCard } from "@/components/site/ProductCard";
import { Img, Reveal } from "@/components/site/Reveal";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/products/$slug")({
  loader: async ({ params, context }) => {
    const p = (await loadCatalog(context.queryClient)).find((x) => x.slug === params.slug);
    if (!p) throw notFound();
    return { name: p.name, tagline: p.tagline };
  },
  head: ({ loaderData, matches }) => {
    const site = brandTitle(brandFromMatches(matches));
    return {
    meta: loaderData
      ? [
          { title: `${loaderData.name} — ${site}` },
          { name: "description", content: loaderData.tagline },
          { property: "og:title", content: `${loaderData.name} — ${site}` },
          { property: "og:description", content: loaderData.tagline },
          { property: "og:type", content: "product" },
        ]
      : [{ title: `Unavailable — ${site}` }, { name: "robots", content: "noindex" }],
    };
  },
  notFoundComponent: ProductUnavailable,
  component: ProductPage,
});

function ProductUnavailable() {
  return (
    <div className="mx-auto max-w-xl px-5 py-40 text-center">
      <p className="font-display text-5xl">This piece is unavailable</p>
      <Link to="/collections/$slug" params={{ slug: "all" }} className="btn-ink mt-10">Browse the collection</Link>
    </div>
  );
}

const REVIEWS = [
  { n: "Ananya R.", c: "Mumbai", r: 5, t: "Holds its shape beautifully", b: "Structured without feeling stiff. The strap length works over a coat." },
  { n: "Karan M.", c: "Bengaluru", r: 4, t: "Quietly smart", b: "Exactly the understated look I wanted. Would love one more inner pocket." },
  { n: "Meera S.", c: "Delhi", r: 5, t: "Gift that landed", b: "The box and card made it feel special. Colour is richer in person." },
];

function ProductPage() {
  const { slug } = Route.useParams();
  const { getProduct, settled } = useCatalog();
  const p = getProduct(slug);
  // Until the live list arrives we render from the built-in catalogue; a product that only exists in
  // the database waits here instead of flashing "unavailable".
  if (!p) return settled ? <ProductUnavailable /> : <p role="status" className="px-5 py-40 text-center text-sm text-muted-foreground">Loading…</p>;
  return <ProductView p={p} slug={slug} />;
}

function ProductView({ p, slug }: { p: Product; slug: string }) {
  const { products } = useCatalog();
  const { addToCart, toggleWish, wishlist, user, promptSignIn } = useStore();
  const { ordersOpen } = useOrdersOpen();
  const navigate = useNavigate();
  const [active, setActive] = useState(0);
  const [colour, setColour] = useState(p.colours[0]!);
  const [size, setSize] = useState<string | undefined>(undefined);
  const [qty, setQty] = useState(1);
  const [pin, setPin] = useState("");
  const [pinMsg, setPinMsg] = useState<{ ok: boolean; m: string } | null>(null);
  const [key, setKey] = useState(slug);
  if (key !== slug) { setKey(slug); setActive(0); setColour(p.colours[0]!); setSize(undefined); setQty(1); setPinMsg(null); }

  const wished = wishlist.includes(p.slug);
  const out = p.stock === "out";
  const needsSize = !!p.sizes && !size;
  const related = products.filter((x) => x.slug !== p.slug && (x.type === p.type || x.gender === p.gender)).slice(0, 4);
  // The sample products have three photos and get a zoomed crop as a fourth view; photographed products show their real angles.
  const photographed = !!p.imageLabels?.some(Boolean);
  const smalls = p.thumbs ?? p.images;
  const gallery: string[] = photographed ? p.images : [...p.images, p.images[0]!];
  const galleryThumbs: string[] = photographed ? smalls : [...smalls, smalls[0] ?? p.images[0]!];
  const zoomed = (i: number) => !photographed && i === 3;
  const viewName = (i: number) => (photographed && p.imageLabels?.[i] ? p.imageLabels[i]! : `view ${i + 1}`);
  const dimensions = p.dimensions.trim();

  const add = async (buy = false) => {
    if (needsSize) { toast.error("Please select a size"); return; }
    const added = await addToCart({ slug: p.slug, colour, size }, qty, !buy);
    if (!buy || !added) return;
    if (apiEnabled && !user) {
      // The piece is already in the (guest) bag; signing in merges it into the account.
      toast("Sign in to complete your purchase", { description: "Your bag will be kept." });
      promptSignIn("/checkout");
      return;
    }
    void navigate({ to: "/checkout" });
  };
  const checkPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^[1-9]\d{5}$/.test(pin)) { setPinMsg({ ok: false, m: "Enter a valid 6-digit pincode." }); return; }
    try {
      const r = await api<{ minDays: number; maxDays: number }>(`/delivery/estimate?pincode=${pin}`);
      setPinMsg({ ok: true, m: `Sample estimate: delivery in ${r.minDays}–${r.maxDays} working days.` });
    } catch (error) {
      setPinMsg({ ok: false, m: errorMessage(error) });
    }
  };

  return (
    <>
      <div className="mx-auto max-w-[1600px] px-5 pt-5 lg:px-10">
        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
          <Link to="/" className="hover:text-ink">Home</Link><span className="mx-2">/</span>
          <Link to="/collections/$slug" params={{ slug: "all" }} className="hover:text-ink">{p.type}</Link><span className="mx-2">/</span>
          <span className="text-ink">{p.name}</span>
        </nav>
      </div>

      <section className="mx-auto grid max-w-[1600px] gap-8 px-0 pb-16 pt-5 lg:grid-cols-12 lg:gap-12 lg:px-10 lg:pb-28">
        {/* Gallery */}
        <div className="lg:col-span-7 lg:flex lg:gap-4">
          <ul className="hidden w-20 shrink-0 flex-col gap-3 lg:flex" aria-label="Gallery thumbnails">
            {gallery.map((_, i) => (
              <li key={i}><button onClick={() => setActive(i)} aria-label={`View image ${i + 1}: ${viewName(i)}`} aria-current={active === i} className={cn("block w-full overflow-hidden bg-paper ring-offset-2 ring-offset-chalk transition", active === i ? "ring-1 ring-ink" : "opacity-60 hover:opacity-100")}><img src={galleryThumbs[i]} alt="" loading="lazy" className={cn("aspect-[4/5] w-full object-cover", zoomed(i) && "scale-150")} /></button></li>
            ))}
          </ul>
          <div className="relative flex-1">
            <div className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto lg:block lg:overflow-hidden"
              onScroll={(e) => { const el = e.currentTarget; if (window.innerWidth < 1024) setActive(Math.round(el.scrollLeft / el.clientWidth)); }}>
              {gallery.map((src, i) => (
                <div key={i} className={cn("aspect-[4/5] w-full shrink-0 snap-center overflow-hidden bg-paper", "lg:absolute lg:inset-0 lg:transition-opacity lg:duration-700", active === i ? "lg:relative lg:opacity-100" : "lg:pointer-events-none lg:opacity-0")}>
                  <Img src={src} alt={`${p.name} — ${viewName(i)}`} eager={i === 0} className={cn("h-full w-full object-cover", zoomed(i) && "scale-[1.6] object-[50%_60%]")} />
                </div>
              ))}
            </div>
            <div className="mt-3 flex justify-center gap-1.5 lg:hidden">{gallery.map((_, i) => <span key={i} className={cn("h-px w-6 transition-colors", active === i ? "bg-ink" : "bg-input")} />)}</div>
            <span className="eyebrow absolute left-4 top-4 bg-paper/90 px-2 py-1 text-[10px]">{active + 1} / {gallery.length}</span>
          </div>
        </div>

        {/* Info */}
        <div className="px-5 lg:col-span-5 lg:px-0">
          <div className="lg:sticky lg:top-44">
            <p className="eyebrow text-muted-foreground">{p.type}{p.isNew && <span className="ml-3 text-oxblood">New season</span>}</p>
            <h1 className="font-display mt-3 text-[40px] leading-[1] lg:text-[56px]">{p.name}</h1>
            <div className="mt-4 flex items-center justify-between">
              <p className="text-lg tabular-nums">{formatINR(p.price)} <span className="ml-1 text-xs text-muted-foreground">incl. taxes</span></p>
              <a href="#reviews" className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-ink">
                <span className="flex">{[0, 1, 2, 3, 4].map((i) => <Star key={i} className={cn("h-3 w-3", i < 5 ? "fill-ink text-ink" : "")} />)}</span>4.7 · Demo reviews
              </a>
            </div>
            <p className="mt-6 text-[15px] leading-relaxed text-muted-foreground">{p.tagline}</p>

            <div className="mt-8 border-t border-hairline pt-6">
              <p className="text-sm"><span className="text-muted-foreground">Colour:</span> {colour}</p>
              <div className="mt-3 flex gap-3" role="radiogroup" aria-label="Colour">
                {p.colours.map((c) => (
                  <button key={c} role="radio" aria-checked={c === colour} aria-label={c} onClick={() => setColour(c)} className={cn("h-9 w-9 rounded-full ring-offset-[3px] ring-offset-chalk transition", c === colour ? "ring-1 ring-ink" : "ring-1 ring-hairline hover:ring-ink/40")} style={{ background: COLOURS[c]?.swatch }} />
                ))}
              </div>
            </div>

            {p.sizes && (
              <div className="mt-6">
                <div className="flex justify-between text-sm"><span><span className="text-muted-foreground">Size (cm):</span> {size ?? "Select"}</span><button className="text-xs underline underline-offset-4" onClick={() => toast("Size guide: measure from buckle to the hole you use most (sample guidance)")}>Size guide</button></div>
                <div className="mt-3 grid grid-cols-6 gap-2">
                  {p.sizes.map((s) => <button key={s} onClick={() => setSize(s)} aria-pressed={size === s} className={cn("h-11 border text-sm transition-colors", size === s ? "border-ink bg-ink text-chalk" : "border-input hover:border-ink")}>{s}</button>)}
                </div>
              </div>
            )}

            <div className="mt-6 flex items-center gap-3 text-sm">
              <span className={cn("h-1.5 w-1.5 rounded-full", out ? "bg-muted-foreground" : p.stock === "low" ? "bg-brass" : "bg-oxblood")} />
              {out ? "Currently unavailable (sample status)" : p.stock === "low" ? "Only a few left (sample status)" : "In stock (sample status)"}
            </div>

            <div className="mt-6 flex gap-3">
              <div className="flex h-[52px] items-center border border-input">
                <button aria-label="Decrease quantity" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1} className="grid h-full w-11 place-items-center disabled:opacity-30"><Minus className="h-3.5 w-3.5" /></button>
                <span className="w-6 text-center tabular-nums" aria-live="polite">{qty}</span>
                <button aria-label="Increase quantity" onClick={() => setQty((q) => Math.min(10, q + 1))} disabled={qty >= 10} className="grid h-full w-11 place-items-center disabled:opacity-30"><Plus className="h-3.5 w-3.5" /></button>
              </div>
              <button onClick={() => add()} disabled={out} className="btn-ink flex-1">{out ? "Sold out" : "Add to bag"}</button>
              <button onClick={() => toggleWish(p.slug)} aria-pressed={wished} aria-label={wished ? "Remove from wishlist" : "Save to wishlist"} className="grid h-[52px] w-[52px] place-items-center border border-input hover:border-ink"><Heart className={cn("h-[18px] w-[18px] stroke-[1.3]", wished && "fill-oxblood text-oxblood")} /></button>
            </div>
            {ordersOpen
              ? <button onClick={() => add(true)} disabled={out} className="btn-outline mt-3 w-full">Buy now</button>
              : <p className="mt-3 text-center text-xs leading-relaxed text-muted-foreground">{LAUNCH.checkout.label}. Add it to your bag and it will be waiting.</p>}

            <form onSubmit={checkPin} className="mt-8 border border-hairline bg-paper p-4">
              <label htmlFor="pin" className="flex items-center gap-2 text-sm"><Truck className="h-4 w-4 stroke-[1.3]" /> Check delivery (demo)</label>
              <div className="mt-3 flex">
                <input id="pin" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); setPinMsg(null); }} placeholder="6-digit pincode" className="field h-11" />
                <button className="h-11 border border-l-0 border-ink bg-ink px-5 text-xs tracking-[0.14em] text-chalk uppercase hover:bg-oxblood">Check</button>
              </div>
              {pinMsg && <p className={cn("mt-2 text-xs", pinMsg.ok ? "text-ink" : "text-destructive")} aria-live="polite">{pinMsg.m}</p>}
            </form>

            <div className="mt-8 border-t border-hairline">
              {[
                ...(p.description ? [{ t: "About this piece", b: <p>{p.description}</p> }] : []),
              { t: "Details", b: <dl className="grid grid-cols-[110px_1fr] gap-y-2"><dt className="text-muted-foreground">Material</dt><dd>{p.material}</dd>{dimensions && <><dt className="text-muted-foreground">Dimensions</dt><dd>{dimensions}</dd></>}<dt className="text-muted-foreground">Colours</dt><dd>{p.colours.join(", ")}</dd>{p.sku && <><dt className="text-muted-foreground">Style no.</dt><dd>{p.sku}</dd></>}</dl> },
                { t: "Shipping", b: <p>Complimentary shipping on orders over ₹2,500 (sample policy). Dispatch timelines are placeholders for review.</p> },
                { t: "Returns", b: <p>Return window and conditions to be confirmed. Items should be unused with original packaging.</p> },
                { t: "Care", b: <p>Keep away from prolonged moisture and direct heat. Store stuffed in the dust bag. Wipe gently with a dry, soft cloth.</p> },
              ].map((a, i) => <Accordion key={a.t} title={a.t} defaultOpen={i === 0}>{a.b}</Accordion>)}
            </div>
          </div>
        </div>
      </section>

      {/* Story */}
      <section className="grid bg-ink text-chalk lg:grid-cols-2">
        <div className="flex flex-col justify-center px-5 py-16 lg:px-20 lg:py-24">
          <Reveal>
            <p className="eyebrow text-brass">The story</p>
            <h2 className="font-display mt-5 text-[40px] leading-[1] lg:text-[64px]">Drawn once,<br /><em>refined often.</em></h2>
            <p className="mt-8 max-w-md text-[15px] leading-relaxed text-chalk/75">The {p.name} began as a single line — the curve of a handle, the fall of a flap. Prototypes were carried, adjusted and carried again until the proportions settled. Editable sample copy.</p>
          </Reveal>
        </div>
        <div className={cn("relative aspect-square overflow-hidden lg:aspect-auto lg:min-h-[640px]", photographed && "bg-chalk")}><Img src={p.images[1] ?? p.images[0]!} alt="" className={cn("absolute inset-0 h-full w-full", photographed ? "object-contain" : "object-cover")} /></div>
      </section>

      {/* Specs + Reviews */}
      <section className="mx-auto grid max-w-[1600px] gap-16 px-5 py-20 lg:grid-cols-12 lg:px-10 lg:py-28">
        <Reveal className="lg:col-span-4">
          <p className="eyebrow text-muted-foreground">Specifications</p>
          <dl className="mt-6 divide-y divide-hairline border-y border-hairline text-sm">
            {[["Category", p.type], ["Material", p.material], ...(dimensions ? [["Dimensions", dimensions]] : []), ["Colours", p.colours.join(", ")], ["For", p.gender === "unisex" ? "Everyone" : p.gender === "women" ? "Women" : "Men"]].map(([a, b]) => (
              <div key={a} className="grid grid-cols-[110px_1fr] gap-4 py-3.5"><dt className="text-muted-foreground">{a}</dt><dd>{b}</dd></div>
            ))}
          </dl>
        </Reveal>
        <div id="reviews" className="scroll-mt-32 lg:col-span-7 lg:col-start-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="eyebrow text-muted-foreground">Reviews <span className="ml-2 border border-brass px-1.5 py-0.5 text-[9px] text-oxblood">Demo content</span></p>
              <p className="font-display mt-4 text-5xl">4.7 <span className="text-xl text-muted-foreground">/ 5</span></p>
            </div>
            <button className="btn-outline h-11" onClick={() => toast("Writing reviews is disabled in this preview")}>Write a review</button>
          </div>
          <ul className="mt-8 divide-y divide-hairline border-t border-hairline">
            {REVIEWS.map((r) => (
              <li key={r.n} className="py-6">
                <div className="flex items-center justify-between"><span className="flex">{Array.from({ length: 5 }).map((_, i) => <Star key={i} className={cn("h-3 w-3 text-ink", i < r.r && "fill-ink")} />)}</span><span className="text-xs text-muted-foreground">{r.n} · {r.c} · Sample</span></div>
                <p className="mt-3 text-[15px]">{r.t}</p>
                <p className="mt-1.5 text-sm text-muted-foreground">{r.b}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Related */}
      <section className="border-t border-hairline bg-paper py-20 lg:py-28">
        <div className="mx-auto max-w-[1600px] px-5 lg:px-10">
          <Reveal><p className="eyebrow text-muted-foreground">Complete the look</p><h2 className="font-display mt-4 text-[40px] leading-none lg:text-[56px]">You may also <em>consider</em></h2></Reveal>
          <div className="mt-12 grid grid-cols-2 gap-x-3 gap-y-12 lg:grid-cols-4 lg:gap-x-6">
            {related.map((r, i) => <Reveal key={r.slug} delay={i * 70}><ProductCard p={r} tone="chalk" /></Reveal>)}
          </div>
        </div>
      </section>

      {/* Mobile sticky bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-3 border-t border-hairline bg-chalk/95 px-4 py-3 lg:hidden">
        <div className="min-w-0 flex-1"><p className="truncate text-sm">{p.name}</p><p className="text-xs tabular-nums text-muted-foreground">{formatINR(p.price)} · {colour}</p></div>
        <button onClick={() => add()} disabled={out} className="btn-ink h-12 px-6">{out ? "Sold out" : "Add to bag"}</button>
      </div>
      <div className="h-20 lg:hidden" />
    </>
  );
}

function Accordion({ title, children, defaultOpen }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const id = `acc-${title}`;
  return (
    <div className="border-b border-hairline">
      <h3><button aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between py-4 text-left text-sm">{title}<Plus className={cn("h-4 w-4 stroke-[1.3] transition-transform duration-500", open && "rotate-45")} /></button></h3>
      <div id={id} className={cn("grid text-sm leading-relaxed text-muted-foreground transition-[grid-template-rows,padding] duration-500 ease-lux", open ? "grid-rows-[1fr] pb-5" : "grid-rows-[0fr]")}><div className="overflow-hidden">{children}</div></div>
    </div>
  );
}
