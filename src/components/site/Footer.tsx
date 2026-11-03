import { Link } from "@tanstack/react-router";
import { ArrowRight, Package, RefreshCcw, ShieldCheck, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { brandTitle, useBrand } from "@/lib/brand";
import { validateEmail } from "@/lib/validation";
import { VisitorCount } from "./VisitorCount";

export function Reassurance() {
  const items = [
    { icon: Package, t: "Complimentary shipping", d: "On orders over ₹2,500 (sample policy)" },
    { icon: RefreshCcw, t: "Easy returns", d: "Return window to be confirmed" },
    { icon: ShieldCheck, t: "Secure checkout", d: "Payment partner to be confirmed" },
    { icon: Sparkles, t: "Gift presentation", d: "Boxed with a handwritten card" },
  ];
  return (
    <section aria-label="Service" className="border-y border-hairline bg-paper">
      <ul className="mx-auto grid max-w-[1600px] grid-cols-2 lg:grid-cols-4">
        {items.map(({ icon: I, t, d }, i) => (
          <li key={t} className={`flex items-start gap-4 px-5 py-7 lg:px-10 lg:py-9 ${i % 2 ? "border-l border-hairline" : ""} ${i > 1 ? "max-lg:border-t border-hairline" : ""} ${i === 2 ? "lg:border-l" : ""}`}>
            <I className="mt-0.5 h-5 w-5 shrink-0 stroke-[1.2] text-oxblood" />
            <div><p className="text-sm">{t}</p><p className="mt-1 text-xs text-muted-foreground">{d}</p></div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Newsletter() {
  const [email, setEmail] = useState("");
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const mail = validateEmail(email);
    if (!mail.ok) { setErr(mail.message); return; }
    setErr(""); setBusy(true);
    try {
      await api("/newsletter", { method: "POST", body: { email: mail.value } });
      setDone(true);
      toast.success("You're on the list");
    } catch (error) {
      setErr(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="bg-oxblood text-chalk">
      <div className="mx-auto grid max-w-[1600px] gap-10 px-5 py-20 lg:grid-cols-2 lg:px-10 lg:py-28">
        <div>
          <p className="eyebrow text-brass">Correspondence</p>
          <h2 className="font-display mt-5 text-4xl leading-[1.05] lg:text-6xl">Letters from<br /><em>the house.</em></h2>
        </div>
        <div className="lg:pt-10">
          <p className="max-w-md text-sm leading-relaxed opacity-80">New shapes, care notes and early access to seasonal edits. Four letters a year, never more.</p>
          {done ? (
            <p className="mt-8 font-display text-2xl italic" role="status">Thank you — we'll write soon.</p>
          ) : (
            <form onSubmit={submit} noValidate className="mt-8 max-w-lg">
              <label htmlFor="nl-email" className="sr-only">Email address</label>
              <div className="flex border-b border-chalk/50 focus-within:border-chalk">
                <input id="nl-email" type="email" maxLength={254} value={email} onChange={(e) => { setEmail(e.target.value); setErr(""); }} placeholder="Your email address" aria-invalid={!!err} aria-describedby="nl-err" className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-chalk/50" />
                <button type="submit" disabled={busy} className="flex items-center gap-2 eyebrow hover:text-brass disabled:opacity-50">{busy ? "Sending…" : "Subscribe"} <ArrowRight className="h-4 w-4" /></button>
              </div>
              <p id="nl-err" className="mt-3 min-h-5 text-xs text-brass" aria-live="polite">{err}</p>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  const brand = useBrand();
  const cols = [
    { t: "Shop", l: [["New In", "new-in"], ["Women", "women"], ["Men", "men"], ["Bags", "bags"], ["Small Leather Goods", "small-leather-goods"], ["Gifts", "gifts"]] },
    { t: "Client care", l: [["Shipping"], ["Returns"], ["Care guide"], ["Contact"]] },
    { t: "The House", l: [["Our approach"], ["Materials"], ["Stores"], ["Careers"]] },
  ];
  return (
    <footer className="bg-ink text-chalk">
      <div className="mx-auto max-w-[1600px] px-5 pb-10 pt-20 lg:px-10">
        <div className="grid gap-12 lg:grid-cols-12">
          <div className="lg:col-span-5">
            {brand.logoUrl ? (
              // Logos are usually drawn for light backgrounds, so give it one on the dark footer.
              <span className="inline-block bg-chalk px-4 py-3"><img src={brand.logoUrl} alt={brandTitle(brand)} className="h-10 w-auto max-w-[220px] object-contain" /></span>
            ) : (
              <>
                <p className="font-display text-3xl tracking-[0.2em] uppercase">{brand.siteName}</p>
                {brand.siteSubtitle && <p className="mt-1 text-[9px] tracking-[0.6em] text-chalk/50 uppercase">{brand.siteSubtitle}</p>}
              </>
            )}
            <p className="mt-8 max-w-sm text-sm leading-relaxed text-chalk/60">A contemporary leather house. Considered shapes for daily carry, work and travel.</p>
          </div>
          {cols.map((c) => (
            <div key={c.t} className="lg:col-span-2">
              <p className="eyebrow text-brass">{c.t}</p>
              <ul className="mt-5 space-y-3 text-sm text-chalk/75">
                {c.l.map(([label, slug]) => (
                  <li key={label}>
                    {slug ? <Link to="/collections/$slug" params={{ slug }} className="link-line hover:text-chalk">{label}</Link>
                      : <button onClick={() => toast(`${label}: page not included in this preview`)} className="link-line hover:text-chalk">{label}</button>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-20 flex flex-col gap-3 border-t border-chalk/15 pt-6 text-xs text-chalk/50 lg:flex-row lg:justify-between">
          <p>© 2026 {brandTitle(brand)} · Design concept prototype — sample content only</p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <VisitorCount />
            <p>India (INR ₹) · English</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
