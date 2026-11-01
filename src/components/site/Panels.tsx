import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowRight, Minus, Plus, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { apiEnabled, errorMessage } from "@/lib/api";
import { formatINR, productThumb, searchProducts, type Product } from "@/lib/catalog";
import { useCatalog } from "@/lib/catalog-live";
import { useOrdersOpen } from "@/lib/store-status";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { Drawer, DrawerHead } from "./Drawer";
import { NAV } from "./Header";
import { ClosedCheckoutNote } from "./LaunchNotice";

export function CartDrawer() {
  const { panel, setPanel, promptSignIn, cart, setQty, removeLine, subtotal, count, user, authReady } = useStore();
  const navigate = useNavigate();
  const { getProduct } = useCatalog();
  const { ordersOpen } = useOrdersOpen();
  const close = () => setPanel(null);
  const free = 2500;
  const checkout = () => {
    if (apiEnabled && authReady && !user) {
      toast("Sign in to check out", { description: "Your bag will be kept." });
      promptSignIn("/checkout");
      return;
    }
    close();
    void navigate({ to: "/checkout" });
  };
  return (
    <Drawer open={panel === "cart"} label="Shopping bag" onClose={close}>
      <DrawerHead title={`Your bag (${count})`} onClose={close} />
      {cart.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-10 text-center">
          <p className="font-display text-3xl">Your bag is empty</p>
          <p className="mt-3 text-sm text-muted-foreground">Begin with something small — card cases start at ₹1,290.</p>
          <Link to="/collections/$slug" params={{ slug: "new-in" }} onClick={close} className="btn-ink mt-8">Shop new in</Link>
        </div>
      ) : (
        <>
          <div className="border-b border-hairline px-6 py-4 text-xs text-muted-foreground">
            {subtotal >= free ? "Your order qualifies for complimentary shipping." : `Add ${formatINR(free - subtotal)} for complimentary shipping.`}
            <div className="mt-2 h-px bg-hairline"><div className="h-px bg-oxblood transition-[width] duration-700 ease-lux" style={{ width: `${Math.min(100, (subtotal / free) * 100)}%` }} /></div>
          </div>
          <ul className="flex-1 divide-y divide-hairline overflow-y-auto px-6">
            {cart.map((l, i) => {
              const p = getProduct(l.slug);
              if (!p) return null;
              return (
                <li key={`${l.slug}-${l.colour}-${l.size}`} className="flex gap-4 py-5">
                  <Link to="/products/$slug" params={{ slug: p.slug }} onClick={close} className="w-24 shrink-0 bg-paper"><img src={productThumb(p)} alt={p.name} className="aspect-[4/5] w-full object-cover" /></Link>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex justify-between gap-3">
                      <p className="text-sm">{p.name}</p>
                      <p className="text-sm tabular-nums">{formatINR((l.unitPrice ?? p.price) * l.qty)}</p>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{l.colour}{l.size ? ` · ${l.size} cm` : ""}</p>
                    <div className="mt-auto flex items-center justify-between">
                      <div className="flex h-9 items-center border border-input">
                        <button aria-label="Decrease quantity" onClick={() => setQty(i, l.qty - 1)} disabled={l.qty <= 1} className="grid h-full w-9 place-items-center disabled:opacity-30"><Minus className="h-3 w-3" /></button>
                        <span className="w-6 text-center text-sm tabular-nums" aria-live="polite">{l.qty}</span>
                        <button aria-label="Increase quantity" onClick={() => setQty(i, l.qty + 1)} disabled={l.qty >= 10} className="grid h-full w-9 place-items-center disabled:opacity-30"><Plus className="h-3 w-3" /></button>
                      </div>
                      <button onClick={() => { removeLine(i); toast(`${p.name} removed`); }} className="text-xs text-muted-foreground underline underline-offset-4 hover:text-oxblood">Remove</button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="border-t border-hairline px-6 py-6">
            <div className="flex justify-between text-sm"><span>Subtotal</span><span className="tabular-nums">{formatINR(subtotal)}</span></div>
            <p className="mt-1 text-xs text-muted-foreground">Taxes included. Shipping calculated at checkout.</p>
            {apiEnabled && authReady && !user && (
              <p className="mt-3 text-xs text-muted-foreground">
                <button onClick={() => setPanel("account")} className="underline underline-offset-4 hover:text-oxblood">Sign in</button> to keep your bag on every device.
              </p>
            )}
            {ordersOpen ? (
              <button className="btn-ink mt-5 w-full" onClick={checkout}>Checkout <ArrowRight className="h-4 w-4" /></button>
            ) : (
              <>
                <ClosedCheckoutNote />
                <Link to="/collections/$slug" params={{ slug: "all" }} onClick={close} className="btn-outline mt-3 w-full">Keep browsing</Link>
              </>
            )}
          </div>
        </>
      )}
    </Drawer>
  );
}

export function WishlistDrawer() {
  const { panel, setPanel, wishlist, toggleWish, addToCart } = useStore();
  const { getProduct } = useCatalog();
  const close = () => setPanel(null);
  const items = wishlist.map(getProduct).filter((p): p is Product => !!p);
  return (
    <Drawer open={panel === "wishlist"} label="Wishlist" onClose={close}>
      <DrawerHead title={`Wishlist (${items.length})`} onClose={close} />
      {items.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-10 text-center">
          <p className="font-display text-3xl">Nothing saved yet</p>
          <p className="mt-3 text-sm text-muted-foreground">Tap the heart on any piece to keep it here.</p>
          <Link to="/collections/$slug" params={{ slug: "all" }} onClick={close} className="btn-outline mt-8">Explore the collection</Link>
        </div>
      ) : (
        <ul className="flex-1 divide-y divide-hairline overflow-y-auto px-6">
          {items.map((p) => (
            <li key={p.slug} className="flex gap-4 py-5">
              <Link to="/products/$slug" params={{ slug: p.slug }} onClick={close} className="w-20 shrink-0 bg-paper"><img src={productThumb(p)} alt={p.name} className="aspect-[4/5] w-full object-cover" /></Link>
              <div className="flex flex-1 flex-col">
                <p className="text-sm">{p.name}</p>
                <p className="mt-1 text-sm tabular-nums text-muted-foreground">{formatINR(p.price)}</p>
                <div className="mt-auto flex gap-4 text-xs">
                  <button className="underline underline-offset-4 hover:text-oxblood" onClick={() => addToCart({ slug: p.slug, colour: p.colours[0]!, size: p.sizes?.[2] })}>Add to bag</button>
                  <button className="text-muted-foreground underline underline-offset-4 hover:text-oxblood" onClick={() => toggleWish(p.slug)}>Remove</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}

export function SearchOverlay() {
  const { panel, setPanel } = useStore();
  const [q, setQ] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const open = panel === "search";
  useEffect(() => { if (open) setTimeout(() => ref.current?.focus(), 150); }, [open]);
  const close = () => setPanel(null);
  const { products } = useCatalog();
  const matches = q.trim() ? searchProducts(q, products) : [];
  const results = matches.slice(0, 8);
  const suggestions = ["Tote", "Wallet", "Oxblood", "Briefcase", "Belt", "Weekender"];
  return (
    <Drawer open={open} side="top" label="Search" onClose={close} className="overflow-y-auto">
      <div className="mx-auto w-full max-w-[1600px] px-5 pb-10 pt-6 lg:px-10">
        <form className="flex items-center gap-4 border-b border-ink pb-3" role="search"
          onSubmit={(e) => { e.preventDefault(); if (!q.trim()) return; close(); navigate({ to: "/collections/$slug", params: { slug: "all" }, search: { q: q.trim() } }); }}>
          <Search className="h-5 w-5 shrink-0 stroke-[1.3]" />
          <label htmlFor="site-search" className="sr-only">Search the collection</label>
          <input id="site-search" ref={ref} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search bags, wallets, colours…" className="font-display w-full bg-transparent text-2xl outline-none placeholder:text-muted-foreground/60 lg:text-4xl" />
          <button type="button" onClick={close} aria-label="Close search" className="grid h-10 w-10 shrink-0 place-items-center hover:text-oxblood"><X className="h-5 w-5 stroke-[1.3]" /></button>
        </form>
        {!q.trim() ? (
          <div className="mt-8">
            <p className="eyebrow text-muted-foreground">Popular searches</p>
            <div className="mt-4 flex flex-wrap gap-2">{suggestions.map((s) => <button key={s} onClick={() => setQ(s)} className="border border-input px-4 py-2 text-sm hover:border-ink">{s}</button>)}</div>
          </div>
        ) : results.length === 0 ? (
          <div className="py-16 text-center">
            <p className="font-display text-3xl">No pieces match “{q}”</p>
            <p className="mt-3 text-sm text-muted-foreground">Try a shape (tote, wallet) or a colour (ink, oxblood).</p>
          </div>
        ) : (
          <>
            <div className="mt-6 flex items-baseline justify-between">
              <p className="eyebrow text-muted-foreground">{matches.length} results</p>
              <Link to="/collections/$slug" params={{ slug: "all" }} search={{ q: q.trim() }} onClick={close} className="text-sm link-line">View all results</Link>
            </div>
            <ul className="mt-5 grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-4 lg:grid-cols-8">
              {results.map((p) => (
                <li key={p.slug}>
                  <Link to="/products/$slug" params={{ slug: p.slug }} onClick={close} className="group block">
                    <div className="overflow-hidden bg-paper"><img src={productThumb(p)} alt="" className="aspect-[4/5] w-full object-cover transition-transform duration-700 group-hover:scale-105" /></div>
                    <p className="mt-2 text-[13px]">{p.name}</p>
                    <p className="text-xs text-muted-foreground tabular-nums">{formatINR(p.price)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Drawer>
  );
}

export function MobileMenu() {
  const { panel, setPanel } = useStore();
  const close = () => setPanel(null);
  const [sub, setSub] = useState<string | null>(null);
  return (
    <Drawer open={panel === "menu"} side="left" label="Menu" onClose={close}>
      <DrawerHead title="Menu" onClose={close} />
      <nav className="flex-1 overflow-y-auto px-6 py-4" aria-label="Mobile">
        <ul>
          {NAV.map((n) => (
            <li key={n.slug} className="border-b border-hairline">
              <button className="flex w-full items-center justify-between py-4 text-left font-display text-2xl" aria-expanded={sub === n.slug} onClick={() => setSub(sub === n.slug ? null : n.slug)}>
                {n.label}<Plus className={cn("h-4 w-4 stroke-[1.3] transition-transform duration-500", sub === n.slug && "rotate-45")} />
              </button>
              <div className={cn("grid transition-[grid-template-rows,padding] duration-500 ease-lux", sub === n.slug ? "grid-rows-[1fr] pb-5" : "grid-rows-[0fr]")}>
                <div className="overflow-hidden">
                  <Link to="/collections/$slug" params={{ slug: n.slug }} onClick={close} className="relative mb-4 block aspect-[16/9] overflow-hidden">
                    <img src={n.image} alt="" className="h-full w-full object-cover" />
                    <span className="absolute inset-0 scrim-bottom" />
                    <span className="absolute bottom-3 left-3 eyebrow text-chalk">Shop all {n.label}</span>
                  </Link>
                  {n.cols.flatMap((c) => c.links).map((l) => (
                    <Link key={l.label} to="/collections/$slug" params={{ slug: l.slug }} onClick={close} className="block py-2 text-[15px] text-muted-foreground hover:text-ink">{l.label}</Link>
                  ))}
                </div>
              </div>
            </li>
          ))}
          <li className="border-b border-hairline"><Link to="/" hash="house" onClick={close} className="block py-4 font-display text-2xl">The House</Link></li>
        </ul>
        <div className="mt-8 space-y-3 text-sm">
          <button className="block" onClick={() => { close(); setTimeout(() => setPanel("wishlist"), 50); }}>Wishlist</button>
          <button className="block" onClick={() => { close(); setTimeout(() => setPanel("account"), 50); }}>Account</button>
          <button className="block" onClick={() => toast("Client care: sample contact details to be supplied")}>Client care</button>
        </div>
      </nav>
    </Drawer>
  );
}

export function AccountDrawer() {
  const { panel, setPanel, user, signIn, signUp, signOut, signInOnly } = useStore();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const open = panel === "account";
  const close = () => setPanel(null);
  useEffect(() => { if (!open) { setPassword(""); setErr(""); } }, [open]);
  useEffect(() => { if (signInOnly) setMode("in"); }, [signInOnly, open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (mode === "up" && !name.trim()) { setErr("Please enter your name."); return; }
    if (mode === "in" ? !email.trim() : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) { setErr(mode === "in" ? "Please enter your email or username." : "Please enter a valid email address."); return; }
    if (mode === "up" && password.length < 10) { setErr("Use at least 10 characters for your password."); return; }
    if (!password) { setErr("Please enter your password."); return; }
    setErr(""); setBusy(true);
    try {
      const u = mode === "in" ? await signIn(email.trim(), password) : await signUp(name.trim(), email.trim(), password);
      setPassword("");
      if (!u.mustChangePassword) close(); // a default password has to be replaced first, so stay open for that
    } catch (error) {
      setErr(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open={open} label="Account" onClose={close}>
      <DrawerHead title={user ? "Your account" : signInOnly ? "Admin sign in" : mode === "in" ? "Sign in" : "Create account"} onClose={close} />
      {!apiEnabled ? (
        <div className="flex flex-1 flex-col items-center justify-center px-10 text-center">
          <p className="font-display text-3xl">Accounts unavailable</p>
          <p className="mt-3 text-sm text-muted-foreground">The store server isn't connected to this site yet.</p>
        </div>
      ) : user ? (
        <div className="flex flex-1 flex-col px-6 py-8">
          <p className="font-display text-3xl">{user.name}</p>
          <p className="mt-1 text-sm text-muted-foreground">{user.email}</p>
          {user.role === "admin" && <p className="mt-3"><span className="border border-ink px-2 py-0.5 text-[10px] tracking-[0.12em] uppercase">Admin{user.username ? ` · ${user.username}` : ""}</span></p>}
          {user.mustChangePassword ? (
            <div className="mt-6">
              <p className="font-display text-2xl">Choose your own password</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">You're signed in with the default password. Set a new one to continue{user.role === "admin" ? " to the admin console" : ""}.</p>
              <PasswordForm forced />
            </div>
          ) : (
            <>
              <p className="mt-6 text-sm leading-relaxed text-muted-foreground">Your bag and wishlist are saved to this account and follow you across devices.</p>
              <Link to="/orders" onClick={close} className="btn-ink mt-8 w-full">Your orders</Link>
              {user.role === "admin" && <Link to="/admin" onClick={close} className="btn-outline mt-3 w-full">Admin console</Link>}
              <details className="group mt-6 border-t border-hairline pt-4">
                <summary className="cursor-pointer list-none text-sm text-muted-foreground transition-colors hover:text-oxblood">Change password</summary>
                <PasswordForm />
              </details>
            </>
          )}
          <div className="mt-auto space-y-3 pt-8">
            <button className="btn-outline w-full" onClick={() => { void signOut(); close(); }}>Sign out</button>
            <button className="block w-full text-center text-xs text-muted-foreground underline underline-offset-4 hover:text-oxblood" onClick={() => { void signOut(true); close(); }}>Sign out on all devices</button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-1 flex-col overflow-y-auto px-6 py-8">
          <p className="font-display text-3xl">{signInOnly ? "Admin console" : mode === "in" ? "Welcome back" : "Join the house"}</p>
          <p className="mt-2 text-sm text-muted-foreground">{signInOnly ? "Sign in with your admin account." : mode === "in" ? "Sign in to see your saved bag and wishlist." : "Keep your bag and wishlist on every device."}</p>
          <div className="mt-8 space-y-4">
            {mode === "up" && (
              <div>
                <label htmlFor="acc-name" className="eyebrow text-muted-foreground">Name</label>
                <input id="acc-name" className="field mt-2" autoComplete="name" maxLength={80} value={name} onChange={(e) => { setName(e.target.value); setErr(""); }} />
              </div>
            )}
            <div>
              <label htmlFor="acc-email" className="eyebrow text-muted-foreground">{mode === "in" ? "Email or username" : "Email"}</label>
              <input id="acc-email" type={mode === "in" ? "text" : "email"} className="field mt-2" autoComplete={mode === "in" ? "username" : "email"} autoCapitalize="none" spellCheck={false} maxLength={254} value={email} onChange={(e) => { setEmail(e.target.value); setErr(""); }} />
            </div>
            <div>
              <label htmlFor="acc-password" className="eyebrow text-muted-foreground">Password</label>
              <input id="acc-password" type="password" className="field mt-2" autoComplete={mode === "in" ? "current-password" : "new-password"} maxLength={128} value={password} onChange={(e) => { setPassword(e.target.value); setErr(""); }} aria-describedby="acc-hint" />
              {mode === "up" && <p id="acc-hint" className="mt-2 text-xs text-muted-foreground">At least 10 characters.</p>}
            </div>
          </div>
          <p className="mt-4 min-h-5 text-xs text-destructive" role="alert" aria-live="polite">{err}</p>
          <button type="submit" disabled={busy} className="btn-ink mt-4 w-full">{busy ? "Please wait…" : mode === "in" ? "Sign in" : "Create account"}</button>
          {signInOnly ? (
            <p className="mt-6 text-center text-xs leading-relaxed text-muted-foreground">Admin accounts are added by the site owner and can't be created here.</p>
          ) : (
            <button type="button" className="mt-6 text-center text-sm text-muted-foreground underline underline-offset-4 hover:text-oxblood" onClick={() => { setMode(mode === "in" ? "up" : "in"); setErr(""); }}>
              {mode === "in" ? "New here? Create an account" : "Already have an account? Sign in"}
            </button>
          )}
        </form>
      )}
    </Drawer>
  );
}

function PasswordForm({ forced = false }: { forced?: boolean }) {
  const { changePassword } = useStore();
  const [f, setF] = useState({ current: "", next: "", again: "" });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => { setF((x) => ({ ...x, [k]: e.target.value })); setErr(""); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!f.current) { setErr("Enter your current password."); return; }
    if (f.next.length < 10) { setErr("Use at least 10 characters for the new password."); return; }
    if (f.next === f.current) { setErr("The new password must be different from the current one."); return; }
    if (f.next !== f.again) { setErr("The two new passwords don't match."); return; }
    setBusy(true);
    try {
      await changePassword(f.current, f.next);
      setF({ current: "", next: "", again: "" });
    } catch (error) {
      setErr(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const id = forced ? "pw-forced" : "pw";
  return (
    <form onSubmit={submit} noValidate className="mt-4 space-y-4">
      <div>
        <label htmlFor={`${id}-current`} className="eyebrow text-muted-foreground">Current password</label>
        <input id={`${id}-current`} type="password" className="field mt-2" autoComplete="current-password" maxLength={128} value={f.current} onChange={set("current")} />
      </div>
      <div>
        <label htmlFor={`${id}-next`} className="eyebrow text-muted-foreground">New password</label>
        <input id={`${id}-next`} type="password" className="field mt-2" autoComplete="new-password" maxLength={128} value={f.next} onChange={set("next")} aria-describedby={`${id}-hint`} />
        <p id={`${id}-hint`} className="mt-2 text-xs text-muted-foreground">At least 10 characters.</p>
      </div>
      <div>
        <label htmlFor={`${id}-again`} className="eyebrow text-muted-foreground">Repeat new password</label>
        <input id={`${id}-again`} type="password" className="field mt-2" autoComplete="new-password" maxLength={128} value={f.again} onChange={set("again")} />
      </div>
      <p className="min-h-5 text-xs text-destructive" role="alert" aria-live="polite">{err}</p>
      <button type="submit" disabled={busy} className="btn-ink w-full">{busy ? "Please wait…" : "Change password"}</button>
    </form>
  );
}
