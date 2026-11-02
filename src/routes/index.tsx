import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useEffect, useRef } from "react";
import { images, formatINR } from "@/lib/catalog";
import { useCatalog } from "@/lib/catalog-live";
import { LaunchBand } from "@/components/site/LaunchNotice";
import { ProductCard } from "@/components/site/ProductCard";
import { Img, Reveal } from "@/components/site/Reveal";
import { Newsletter, Reassurance } from "@/components/site/Footer";
import { brandFromMatches, brandTitle } from "@/lib/brand";
import { absoluteUrl, jsonLd, SITE_ORIGIN } from "@/lib/seo";
import { LiveHero } from "@/components/site/LiveHero";

export const Route = createFileRoute("/")({
  head: ({ matches }) => {
    const brand = brandFromMatches(matches);
    const site = brandTitle(brand);
    return {
    meta: [
      { title: `${site} — Bags, Wallets & Small Leather Goods` },
      { name: "description", content: "A contemporary leather house. Shop sculpted handbags, totes, briefcases, weekenders, wallets and belts, from ₹590." },
      { property: "og:title", content: `${site} — The Autumn Collection` },
      { property: "og:description", content: "Sculpted handbags, work bags, travel pieces and small leather goods." },
    ],
    // Tells Google the shop's name and logo, which is what a search for the brand name is matched against.
    scripts: [
      {
        type: "application/ld+json",
        children: jsonLd([
          { "@context": "https://schema.org", "@type": "WebSite", name: site, url: `${SITE_ORIGIN}/` },
          {
            "@context": "https://schema.org",
            "@type": "Organization",
            name: site,
            url: `${SITE_ORIGIN}/`,
            ...(brand.logoUrl ? { logo: absoluteUrl(brand.logoUrl) } : {}),
          },
        ]),
      },
    ],
    };
  },
  component: Home,
});

function useParallax<T extends HTMLElement>(strength = 0.12) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    let raf = 0;
    let listening = false;
    const update = () => {
      const r = host.getBoundingClientRect();
      el.style.transform = `translate3d(0, ${(r.top + r.height / 2 - window.innerHeight / 2) * -strength}px, 0) scale(1.12)`;
    };
    const on = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); };
    // Listen to scroll only while the section is near the viewport; off-screen it costs nothing.
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting && !listening) {
        listening = true;
        on();
        window.addEventListener("scroll", on, { passive: true });
        window.addEventListener("resize", on);
      } else if (!e?.isIntersecting && listening) {
        listening = false;
        window.removeEventListener("scroll", on);
        window.removeEventListener("resize", on);
      }
    }, { rootMargin: "25% 0px" });
    io.observe(host);
    return () => { io.disconnect(); window.removeEventListener("scroll", on); window.removeEventListener("resize", on); cancelAnimationFrame(raf); };
  }, [strength]);
  return ref;
}

function SectionHead({ eyebrow, title, link, slug }: { eyebrow: string; title: React.ReactNode; link?: string; slug?: string }) {
  return (
    <Reveal className="flex items-end justify-between gap-6">
      <div>
        <p className="eyebrow text-muted-foreground">{eyebrow}</p>
        <h2 className="font-display mt-4 text-[40px] leading-[1] lg:text-[64px]">{title}</h2>
      </div>
      {link && slug && <Link to="/collections/$slug" params={{ slug }} className="mb-2 hidden shrink-0 items-center gap-2 text-sm link-line md:inline-flex">{link}<ArrowRight className="h-3.5 w-3.5" /></Link>}
    </Reveal>
  );
}

function Home() {
  const craftImg = useParallax<HTMLImageElement>(0.08);
  const { products } = useCatalog();
  const signature = products.filter((p) => p.isNew).slice(0, 4);
  const best = products.filter((p) => p.bestseller).slice(0, 8);
  const gifts = products.filter((p) => p.gift).sort((a, b) => a.price - b.price).slice(0, 4);

  return (
    <>
      {/* HERO */}
      <LiveHero
        className="h-[calc(100svh-100px)] lg:h-[calc(100svh-156px)] min-h-[560px] lg:min-h-[680px]"
        copyClassName="relative mx-auto flex h-full max-w-[1600px] flex-col justify-end px-5 pb-12 lg:justify-center lg:px-10 lg:pb-0"
        media={<img src={images.hero} alt="The Aria Top-Handle in oxblood on a concrete plinth" width={1920} height={1088} fetchPriority="high" className="h-full w-full object-cover object-[65%_center]" />}
        scrim={<><div className="absolute inset-0 scrim-hero max-lg:hidden" /><div className="absolute inset-0 scrim-bottom lg:hidden" /></>}
        overlay={
          <div className="absolute bottom-6 right-10 hidden items-center gap-3 text-[11px] tracking-[0.18em] text-chalk/60 uppercase lg:flex">
            <span>Aria Top-Handle · Oxblood</span><span className="h-px w-10 bg-chalk/40" /><span>{formatINR(14990)}</span>
          </div>
        }
      >
        <p className="anim-rise eyebrow text-brass" style={{ animationDelay: "200ms" }}>Autumn / Winter 2026</p>
        <h1 className="anim-rise font-display mt-5 max-w-[11ch] text-[56px] leading-[0.92] tracking-[-0.01em] sm:text-[80px] lg:text-[120px]" style={{ animationDelay: "350ms" }}>
          Form, <em className="font-normal">held</em> close.
        </h1>
        <p className="anim-rise mt-6 max-w-sm text-[15px] leading-relaxed text-chalk/80" style={{ animationDelay: "500ms" }}>
          The Aria Top-Handle leads a season of sculpted shapes, softened totes and quiet brass.
        </p>
        <div className="anim-rise mt-9 flex flex-wrap gap-3" style={{ animationDelay: "650ms" }}>
          <Link to="/products/$slug" params={{ slug: "aria-top-handle" }} className="btn-chalk">Discover the Aria</Link>
          <Link to="/collections/$slug" params={{ slug: "new-in" }} className="btn-outline border-chalk/60 hover:!bg-chalk hover:!text-ink">Shop New In</Link>
        </div>
      </LiveHero>

      <LaunchBand />

      {/* CATEGORIES */}
      <section className="mx-auto max-w-[1600px] px-5 py-20 lg:px-10 lg:py-32">
        <SectionHead eyebrow="Shop by category" title={<>The <em>wardrobe</em> of objects</>} />
        <div className="mt-12 grid grid-cols-2 gap-3 lg:mt-16 lg:grid-cols-12 lg:gap-5">
          {[
            { slug: "women", label: "Women", img: images.women, cls: "col-span-2 lg:col-span-5 lg:row-span-2 aspect-[4/5] lg:aspect-auto" },
            { slug: "men", label: "Men", img: images.men, cls: "lg:col-span-4 aspect-[3/4]" },
            { slug: "small-leather-goods", label: "Small Leather Goods", img: images.slg, cls: "lg:col-span-3 aspect-[3/4]" },
            { slug: "work-travel", label: "Work & Travel", img: images.travel, cls: "col-span-2 lg:col-span-7 aspect-[16/10] lg:aspect-[16/8]" },
          ].map((c, i) => (
            <Reveal key={c.slug} delay={i * 90} className={c.cls}>
              <Link to="/collections/$slug" params={{ slug: c.slug }} className="group relative block h-full w-full overflow-hidden bg-muted">
                <Img src={c.img} alt={c.label} className="absolute inset-0 h-full w-full object-cover transition-transform duration-[1000ms] ease-lux group-hover:scale-[1.05]" />
                <span className="absolute inset-0 scrim-bottom opacity-80" />
                <span className="absolute inset-x-0 bottom-0 flex items-end justify-between p-4 text-chalk lg:p-7">
                  <span className="font-display text-2xl leading-none lg:text-4xl">{c.label}</span>
                  <span className="eyebrow hidden items-center gap-2 sm:flex">Shop <ArrowRight className="h-3.5 w-3.5 transition-transform duration-500 group-hover:translate-x-1" /></span>
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      {/* SIGNATURE EDIT */}
      <section className="bg-paper py-20 lg:py-32">
        <div className="mx-auto max-w-[1600px] px-5 lg:px-10">
          <SectionHead eyebrow="New season" title={<>The signature <em>edit</em></>} link="View all new in" slug="new-in" />
          <div className="no-scrollbar -mx-5 mt-12 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 lg:mx-0 lg:mt-16 lg:grid lg:grid-cols-4 lg:gap-6 lg:overflow-visible lg:px-0">
            {signature.map((p, i) => (
              <Reveal key={p.slug} delay={i * 80} className="w-[72vw] shrink-0 snap-start sm:w-[44vw] lg:w-auto">
                <ProductCard p={p} tone="chalk" />
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* CAMPAIGN 2-COL */}
      <section className="grid bg-ink text-chalk lg:grid-cols-2">
        <div className="relative aspect-[4/5] overflow-hidden lg:aspect-auto lg:min-h-[860px]">
          <img ref={craftImg} src={images.texture} alt="Close-up of stitched leather edge" loading="lazy" className="absolute inset-0 h-full w-full object-cover will-change-transform" />
        </div>
        <div className="flex flex-col justify-between px-5 py-16 lg:px-20 lg:py-24">
          <Reveal>
            <p className="eyebrow text-brass">Material study No. 04</p>
            <h2 className="font-display mt-6 text-[44px] leading-[0.98] lg:text-[76px]">The edge<br />is the <em>detail.</em></h2>
          </Reveal>
          <Reveal delay={120} className="mt-12 max-w-md">
            <p className="text-[15px] leading-relaxed text-chalk/75">
              Each edge is trimmed, painted and polished in layers until it reads as a single line. Stitching is set tight and even, so the shape holds as the leather softens with use.
            </p>
            <dl className="mt-10 grid grid-cols-3 border-t border-chalk/15 pt-6 text-sm">
              {[["Layers", "Edge paint"], ["Stitch", "Tight, even"], ["Hardware", "Brass-tone"]].map(([a, b]) => (
                <div key={a}><dt className="eyebrow text-[10px] text-chalk/50">{a}</dt><dd className="mt-2">{b}</dd></div>
              ))}
            </dl>
            <Link to="/collections/$slug" params={{ slug: "bags" }} className="btn-chalk mt-12">Explore the bags</Link>
          </Reveal>
        </div>
      </section>

      {/* BESTSELLERS */}
      <section className="mx-auto max-w-[1600px] px-5 py-20 lg:px-10 lg:py-32">
        <SectionHead eyebrow="Most chosen" title={<>Bestsellers</>} link="Shop all" slug="all" />
        <div className="mt-12 grid grid-cols-2 gap-x-3 gap-y-12 lg:mt-16 lg:grid-cols-4 lg:gap-x-6 lg:gap-y-16">
          {best.map((p, i) => <Reveal key={p.slug} delay={(i % 4) * 70}><ProductCard p={p} /></Reveal>)}
        </div>
      </section>

      {/* GIFT EDIT */}
      <section className="border-t border-hairline">
        <div className="mx-auto grid max-w-[1600px] lg:grid-cols-12">
          <div className="relative aspect-square overflow-hidden lg:col-span-5 lg:aspect-auto">
            <Img src={images.slg} alt="Wallet, card case, key loop and belt" className="absolute inset-0 h-full w-full object-cover" />
          </div>
          <div className="px-5 py-16 lg:col-span-7 lg:px-16 lg:py-24">
            <Reveal>
              <p className="eyebrow text-oxblood">The gift edit</p>
              <h2 className="font-display mt-4 text-[40px] leading-[1] lg:text-[60px]">Small things,<br /><em>well made.</em></h2>
              <p className="mt-5 max-w-sm text-sm text-muted-foreground">Key loops from ₹590, card cases from ₹1,290. Every order arrives boxed.</p>
            </Reveal>
            <div className="mt-12 grid grid-cols-2 gap-x-3 gap-y-10 md:grid-cols-4 lg:gap-x-5">
              {gifts.map((p, i) => <Reveal key={p.slug} delay={i * 70}><ProductCard p={p} /></Reveal>)}
            </div>
            <Link to="/collections/$slug" params={{ slug: "gifts" }} className="btn-outline mt-12">Shop gifts</Link>
          </div>
        </div>
      </section>

      {/* HOUSE / CRAFT */}
      <section id="house" className="scroll-mt-28 bg-chalk py-20 lg:py-36">
        <div className="mx-auto max-w-[1600px] px-5 lg:px-10">
          <Reveal className="mx-auto max-w-4xl text-center">
            <p className="eyebrow text-muted-foreground">The House</p>
            <p className="font-display mt-8 text-[30px] leading-[1.15] lg:text-[52px]">
              We make fewer things, and we make them to be <em className="text-oxblood">carried every day</em> — through offices, airports and years.
            </p>
          </Reveal>
          <div className="mt-16 grid gap-3 md:grid-cols-3 lg:mt-24 lg:gap-5">
            {[
              { img: images.texture, t: "Selection", d: "Hides are chosen for an even grain and a supple hand." },
              { img: images.handbag, t: "Pattern", d: "Shapes are drafted to hold their line without heavy stiffeners." },
              { img: images.travel, t: "Finish", d: "Edges, stitching and hardware are checked piece by piece." },
            ].map((c, i) => (
              <Reveal key={c.t} delay={i * 110}>
                <figure>
                  <div className="aspect-[4/5] overflow-hidden bg-muted"><Img src={c.img} alt="" className="h-full w-full object-cover transition-transform duration-[1000ms] ease-lux hover:scale-105" /></div>
                  <figcaption className="mt-5 flex gap-5 border-t border-hairline pt-5">
                    <span className="font-display text-sm text-brass">0{i + 1}</span>
                    <span><span className="block text-[15px]">{c.t}</span><span className="mt-1 block text-sm text-muted-foreground">{c.d}</span></span>
                  </figcaption>
                </figure>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <Reassurance />
      <Newsletter />
    </>
  );
}
