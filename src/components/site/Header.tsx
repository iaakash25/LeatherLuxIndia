import { Link } from "@tanstack/react-router";
import { Heart, Menu, Search, ShoppingBag, User, ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useBrand, brandTitle } from "@/lib/brand";
import { useCatalog } from "@/lib/catalog-live";
import { images } from "@/lib/catalog";
import { LAUNCH } from "@/lib/launch";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";

type NavItem = { label: string; slug: string; cols: { title: string; links: { label: string; slug: string }[] }[]; image: string; caption: string };

export const NAV: NavItem[] = [
  { label: "New In", slug: "new-in", image: images.hero, caption: "The Aria, in oxblood", cols: [{ title: "This season", links: [{ label: "All new arrivals", slug: "new-in" }, { label: "The Gift Edit", slug: "gifts" }, { label: "Bestsellers", slug: "all" }] }] },
  { label: "Women", slug: "women", image: images.women, caption: "The Meridian Tote", cols: [{ title: "Bags", links: [{ label: "Top-handle & shoulder", slug: "women" }, { label: "Totes", slug: "women" }, { label: "Crossbody", slug: "women" }] }, { title: "Accessories", links: [{ label: "Wallets", slug: "small-leather-goods" }, { label: "Belts", slug: "small-leather-goods" }, { label: "Gifts", slug: "gifts" }] }] },
  { label: "Men", slug: "men", image: images.men, caption: "Corbel Slim Briefcase", cols: [{ title: "Bags", links: [{ label: "Briefcases", slug: "work-travel" }, { label: "Backpacks", slug: "men" }, { label: "Crossbody", slug: "men" }] }, { title: "Accessories", links: [{ label: "Wallets & cards", slug: "small-leather-goods" }, { label: "Belts", slug: "men" }, { label: "Key loops", slug: "small-leather-goods" }] }] },
  { label: "Bags", slug: "bags", image: images.handbag, caption: "Every shape, every distance", cols: [{ title: "Shop by shape", links: [{ label: "All bags", slug: "bags" }, { label: "Handbags", slug: "women" }, { label: "Laptop & work", slug: "work-travel" }, { label: "Travel", slug: "work-travel" }] }] },
  { label: "Small Leather Goods", slug: "small-leather-goods", image: images.slg, caption: "From ₹590", cols: [{ title: "Objects", links: [{ label: "Wallets", slug: "small-leather-goods" }, { label: "Card cases", slug: "small-leather-goods" }, { label: "Belts", slug: "small-leather-goods" }, { label: "Pouches & keys", slug: "small-leather-goods" }] }] },
  { label: "Work & Travel", slug: "work-travel", image: images.travel, caption: "The Atlas Weekender", cols: [{ title: "In transit", links: [{ label: "Laptop bags", slug: "work-travel" }, { label: "Weekenders", slug: "work-travel" }, { label: "Backpacks", slug: "work-travel" }] }] },
];

export function Header() {
  const { count, wishlist, setPanel, user } = useStore();
  const brand = useBrand();
  const [open, setOpen] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on(); window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const hasComingSoon = useCatalog().products.some((p) => p.availability === "coming_soon");
  const active = NAV.find((n) => n.slug === open);
  // Keep showing the last menu while it fades out, instead of an empty box.
  const lastActive = useRef(active);
  if (active) lastActive.current = active;
  const shown = active ?? lastActive.current;

  return (
    <header className="site-header sticky top-0 z-40" onMouseLeave={() => setOpen(null)}>
      <div className="bg-ink text-chalk">
        <div className="mx-auto flex h-9 max-w-[1600px] items-center justify-center px-5 text-[11px] tracking-[0.14em] uppercase">
          {LAUNCH.enabled ? (
            <span className="truncate opacity-90">
              <span className="max-sm:hidden">Complimentary shipping across India on orders over ₹2,500 · </span>
              <Link to="/" hash="opening" className="text-brass underline-offset-4 hover:underline">{LAUNCH.short}</Link>
            </span>
          ) : (
            <span className="truncate opacity-90"><span className="max-sm:hidden">Complimentary shipping across India on orders over ₹2,500</span><span className="sm:hidden">Free shipping over ₹2,500</span></span>
          )}
        </div>
      </div>
      <div className={cn("border-b bg-chalk/95 transition-[border-color] duration-500 ease-lux", scrolled ? "border-hairline" : "border-transparent")}>
        <div className="mx-auto grid h-16 max-w-[1600px] grid-cols-[1fr_auto_1fr] items-center px-5 lg:h-[72px] lg:px-10">
          <div className="hidden lg:block" />
          <div className="flex items-center gap-1 lg:hidden">
            <button className="-ml-2 grid h-10 w-10 place-items-center" aria-label="Open menu" onClick={() => setPanel("menu")}><Menu className="h-5 w-5 stroke-[1.3]" /></button>
            <button className="grid h-10 w-10 place-items-center" aria-label="Search" onClick={() => setPanel("search")}><Search className="h-[18px] w-[18px] stroke-[1.3]" /></button>
          </div>
          <Link to="/" className="flex flex-col items-center leading-none" aria-label={`${brandTitle(brand)} — home`}>
            {brand.logoUrl ? (
              <img src={brand.logoUrl} alt={brandTitle(brand)} className="h-9 w-auto max-w-[200px] object-contain lg:h-11 lg:max-w-[260px]" />
            ) : (
              <>
                <span className="font-display text-[19px] tracking-[0.16em] uppercase sm:text-[22px] lg:text-[26px] lg:tracking-[0.2em]">{brand.siteName}</span>
                {brand.siteSubtitle && <span className="mt-1 text-[8.5px] tracking-[0.6em] text-muted-foreground uppercase">{brand.siteSubtitle}</span>}
              </>
            )}
          </Link>
          <div className="flex items-center justify-end gap-0.5 lg:gap-2">
            <button className="hidden h-10 items-center gap-2 px-2 text-[12.5px] lg:flex hover:text-oxblood" onClick={() => setPanel("search")}><Search className="h-[17px] w-[17px] stroke-[1.3]" />Search</button>
            <button className="relative hidden h-10 w-10 place-items-center sm:grid hover:text-oxblood" aria-label={user ? `Account, signed in as ${user.name}` : "Sign in"} onClick={() => setPanel("account")}>
              <User className="h-[18px] w-[18px] stroke-[1.3]" />
              {user && <span className="absolute right-1 top-1.5 h-1.5 w-1.5 rounded-full bg-oxblood" />}
            </button>
            <button className="relative grid h-10 w-10 place-items-center hover:text-oxblood" aria-label={`Wishlist, ${wishlist.length} items`} onClick={() => setPanel("wishlist")}>
              <Heart className="h-[18px] w-[18px] stroke-[1.3]" />
              {wishlist.length > 0 && <span className="absolute right-1 top-1.5 h-1.5 w-1.5 rounded-full bg-oxblood" />}
            </button>
            <button className="relative -mr-2 grid h-10 w-10 place-items-center hover:text-oxblood" aria-label={`Bag, ${count} items`} onClick={() => setPanel("cart")}>
              <ShoppingBag className="h-[18px] w-[18px] stroke-[1.3]" />
              {count > 0 && <span className="absolute -right-0 top-1 grid h-4 min-w-4 place-items-center bg-oxblood px-1 text-[9px] text-chalk tabular-nums">{count}</span>}
            </button>
          </div>
        </div>
          <nav aria-label="Primary" className="hidden border-t border-hairline lg:block">
            <ul className="mx-auto flex h-12 max-w-[1600px] items-center justify-center gap-9 px-10">
              {NAV.map((n) => (
                <li key={n.slug} onMouseEnter={() => setOpen(n.slug)}>
                  <Link to="/collections/$slug" params={{ slug: n.slug }} onFocus={() => setOpen(n.slug)} onClick={() => setOpen(null)}
                    className={cn("py-4 text-[12.5px] tracking-[0.04em] transition-colors whitespace-nowrap", open === n.slug ? "text-oxblood" : "hover:text-oxblood")}
                    aria-expanded={open === n.slug}>{n.label}</Link>
                </li>
              ))}
              {hasComingSoon && <li onMouseEnter={() => setOpen(null)}><Link to="/collections/$slug" params={{ slug: "coming-soon" }} className="text-[12.5px] tracking-[0.04em] hover:text-oxblood whitespace-nowrap">Coming Soon</Link></li>}
              <li onMouseEnter={() => setOpen(null)}><Link to="/" hash="house" className="text-[12.5px] tracking-[0.04em] hover:text-oxblood whitespace-nowrap">The House</Link></li>
            </ul>
          </nav>
        {/* Mega menu */}
        <div className={cn("absolute inset-x-0 top-full hidden overflow-hidden border-b border-hairline bg-chalk transition-[opacity,transform,visibility] duration-500 ease-lux lg:block", active ? "visible translate-y-0 opacity-100" : "invisible -translate-y-2 opacity-0")}>
          {shown && (
            <div key={shown.slug} className="anim-fade mx-auto grid max-w-[1600px] grid-cols-12 gap-10 px-10 py-12">
              <div className="col-span-3">
                <p className="eyebrow text-muted-foreground">{shown.label}</p>
                <p className="font-display mt-4 text-4xl leading-[1.05]">{shown.caption}</p>
                <Link to="/collections/$slug" params={{ slug: shown.slug }} onClick={() => setOpen(null)} className="mt-8 inline-flex items-center gap-2 text-sm link-line">Shop {shown.label} <ArrowRight className="h-3.5 w-3.5" /></Link>
              </div>
              {shown.cols.map((c) => (
                <div key={c.title} className="col-span-2">
                  <p className="eyebrow text-muted-foreground">{c.title}</p>
                  <ul className="mt-5 space-y-3">
                    {c.links.map((l) => (
                      <li key={l.label}><Link to="/collections/$slug" params={{ slug: l.slug }} onClick={() => setOpen(null)} className="text-[15px] link-line">{l.label}</Link></li>
                    ))}
                  </ul>
                </div>
              ))}
              <Link to="/collections/$slug" params={{ slug: shown.slug }} onClick={() => setOpen(null)} className="group col-span-4 col-start-9 relative aspect-[16/10] overflow-hidden bg-muted">
                <img src={shown.image} alt="" className="h-full w-full object-cover transition-transform duration-[900ms] ease-lux group-hover:scale-105" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
