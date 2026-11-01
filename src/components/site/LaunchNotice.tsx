import { Link } from "@tanstack/react-router";
import { LAUNCH } from "@/lib/launch";
import { useStore } from "@/lib/store";
import { Reveal } from "./Reveal";

/** In the bag drawer, where the Checkout button would be, while orders are not open yet. */
export function ClosedCheckoutNote() {
  return (
    <div className="mt-5 border border-hairline bg-paper px-4 py-4">
      <p className="eyebrow text-[10px] text-oxblood">{LAUNCH.checkout.label}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{LAUNCH.checkout.note}</p>
    </div>
  );
}

/** The /checkout page while orders are not open yet: the bag is safe, and there is somewhere to go. */
export function CheckoutClosedPage() {
  const { setPanel } = useStore();
  return (
    <div className="mx-auto max-w-[1600px] px-5 py-16 lg:px-10 lg:py-24">
      <p className="eyebrow text-oxblood">{LAUNCH.checkout.label}</p>
      <h1 className="font-display mt-4 text-4xl lg:text-6xl">
        {LAUNCH.enabled ? <>{LAUNCH.headline.lead} <em>{LAUNCH.headline.accent}</em></> : <>Checkout is <em>not open yet.</em></>}
      </h1>
      <p className="mt-6 max-w-md text-sm leading-relaxed text-muted-foreground">{LAUNCH.checkout.note}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <button type="button" className="btn-ink" onClick={() => setPanel("cart")}>View your bag</button>
        <Link to="/collections/$slug" params={{ slug: "all" }} className="btn-outline">Keep browsing</Link>
      </div>
    </div>
  );
}

/** The pre-launch band on the home page, under the hero. Switched off in src/lib/launch.ts. */
export function LaunchBand() {
  const { setPanel } = useStore();
  if (!LAUNCH.enabled) return null;
  return (
    <section id="opening" aria-labelledby="opening-title" className="scroll-mt-28 border-b border-hairline bg-paper">
      <div className="mx-auto grid max-w-[1600px] gap-10 px-5 py-14 lg:grid-cols-12 lg:items-end lg:gap-16 lg:px-10 lg:py-20">
        <Reveal className="lg:col-span-6">
          <p className="eyebrow text-oxblood">{LAUNCH.short}</p>
          <h2 id="opening-title" className="font-display mt-4 text-[38px] leading-[1.02] lg:text-[60px]">
            {LAUNCH.headline.lead} <em>{LAUNCH.headline.accent}</em>
          </h2>
        </Reveal>

        <Reveal delay={100} className="lg:col-span-6">
          <p className="max-w-lg text-[15px] leading-relaxed text-muted-foreground">{LAUNCH.intro}</p>
          <dl className="mt-8 grid gap-6 border-t border-hairline pt-6 text-sm sm:grid-cols-2 sm:gap-10">
            {LAUNCH.points.map((p) => (
              <div key={p.label}>
                <dt className={`eyebrow text-[10px] ${p.accent ? "text-oxblood" : "text-muted-foreground"}`}>{p.label}</dt>
                <dd className="mt-2">{p.text}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/collections/$slug" params={{ slug: "all" }} className="btn-ink">Browse the collection</Link>
            <button type="button" className="btn-outline" onClick={() => setPanel("search")}>Search</button>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
