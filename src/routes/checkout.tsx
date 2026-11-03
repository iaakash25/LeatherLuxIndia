import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { AccountGate } from "@/components/site/AccountGate";
import { CheckoutClosedPage } from "@/components/site/LaunchNotice";
import { Select } from "@/components/ui/select-menu";
import { AddressBlock, OrderItems, StatusBadges, Totals } from "@/components/site/OrderParts";
import { api, ApiError, errorMessage, type ApiCart, type ApiOrder } from "@/lib/api";
import { formatINR, productThumb } from "@/lib/catalog";
import { useCatalog } from "@/lib/catalog-live";
import { INDIAN_STATES, normalisePhone, PHONE_RE, PINCODE_RE } from "@/lib/india";
import { useOrdersOpen } from "@/lib/store-status";
import { brandFromMatches, brandTitle } from "@/lib/brand";
import { useStore } from "@/lib/store";

export const Route = createFileRoute("/checkout")({
  head: ({ matches }) => ({ meta: [{ title: `Checkout — ${brandTitle(brandFromMatches(matches))}` }, { name: "robots", content: "noindex" }] }),
  component: CheckoutPage,
});

type Form = { name: string; phone: string; line1: string; line2: string; city: string; state: string; pincode: string };
type Errors = { [K in keyof Form]?: string | undefined };

const newKey = () => globalThis.crypto?.randomUUID?.() ?? `k-${Date.now()}-${Math.random().toString(36).slice(2)}`;

function validate(f: Form): Errors {
  const e: Errors = {};
  if (!f.name.trim()) e.name = "Please enter the recipient's name.";
  if (!PHONE_RE.test(normalisePhone(f.phone))) e.phone = "Enter a valid 10-digit mobile number.";
  if (!f.line1.trim()) e.line1 = "Please enter an address.";
  if (!f.city.trim()) e.city = "Please enter a city.";
  if (!f.state) e.state = "Please choose a state.";
  if (!PINCODE_RE.test(f.pincode.trim())) e.pincode = "Enter a valid 6-digit pincode.";
  return e;
}

function CheckoutPage() {
  const { ordersOpen, settled } = useOrdersOpen();
  // Wait for the server's answer rather than flash "not open yet" at a shopper who arrives when it is open.
  if (!settled) return <p role="status" className="px-5 py-40 text-center text-sm text-muted-foreground">Loading…</p>;
  if (!ordersOpen) return <CheckoutClosedPage />;
  return <AccountGate title="Checkout">{(user) => <Checkout userName={user.name} />}</AccountGate>;
}

function Field({ id, label, error, children, className }: { id: string; label: string; error: string | undefined; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="eyebrow text-muted-foreground">{label}</label>
      <div className="mt-2">{children}</div>
      <p id={`${id}-err`} className="mt-1.5 min-h-4 text-xs text-destructive" aria-live="polite">{error}</p>
    </div>
  );
}

function Checkout({ userName }: { userName: string }) {
  const { cart, setPanel, refreshBag } = useStore();
  const { findAny } = useCatalog();
  const [summary, setSummary] = useState<ApiCart | null>(null);
  const [loadErr, setLoadErr] = useState("");
  const [form, setForm] = useState<Form>({ name: userName, phone: "", line1: "", line2: "", city: "", state: "", pincode: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState("");
  const [busy, setBusy] = useState(false);
  const [placed, setPlaced] = useState<ApiOrder | null>(null);
  // One key per attempt: a retry after a dropped connection can never create a second order.
  const idemKey = useRef<string | null>(null);

  const loadSummary = useCallback(async () => {
    try { setSummary(await api<ApiCart>("/cart")); setLoadErr(""); } catch (err) { setLoadErr(errorMessage(err)); }
  }, []);
  // Re-read whenever the bag changes (e.g. quantities edited in the drawer) so totals are always the server's.
  useEffect(() => { void loadSummary(); }, [loadSummary, cart]);

  const set = (k: keyof Form) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [k]: value }));
    setErrors((x) => ({ ...x, [k]: undefined }));
    setFormError("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const errs = validate(form);
    setErrors(errs);
    if (Object.keys(errs).length) { setFormError("Please check the highlighted fields."); return; }
    setFormError("");
    setBusy(true);
    idemKey.current ??= newKey();
    try {
      const line2 = form.line2.trim();
      const { order } = await api<{ order: ApiOrder }>("/orders", {
        method: "POST",
        headers: { "Idempotency-Key": idemKey.current },
        body: {
          shippingAddress: {
            name: form.name.trim(), phone: normalisePhone(form.phone), line1: form.line1.trim(),
            ...(line2 ? { line2 } : {}),
            city: form.city.trim(), state: form.state, pincode: form.pincode.trim(),
          },
        },
      });
      idemKey.current = null;
      setPlaced(order);
      void refreshBag();
      window.scrollTo({ top: 0 });
      toast.success("Order placed", { description: order.orderNumber });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setFormError("Your session has expired. Please sign in again.");
        setPanel("account");
      } else if (err instanceof ApiError && err.code === "validation_failed" && err.details) {
        const mapped: Errors = {};
        for (const d of err.details) {
          const key = d.path.replace(/^shippingAddress\./, "");
          if (key in form) mapped[key as keyof Form] = d.message;
        }
        setErrors(mapped);
        setFormError(Object.keys(mapped).length ? "Please check the highlighted fields." : errorMessage(err));
      } else {
        setFormError(errorMessage(err));
        // A definite rejection (stock, validation) means the next attempt is a new order; a network drop keeps the key.
        if (err instanceof ApiError && err.status >= 400 && err.status < 500) { idemKey.current = null; void loadSummary(); }
      }
    } finally {
      setBusy(false);
    }
  };

  if (placed) return <Confirmation order={placed} />;

  const items = summary?.items ?? [];
  const unavailable = items.filter((i) => !i.available);
  const empty = summary !== null && items.length === 0;

  if (empty) {
    return (
      <div className="mx-auto max-w-[1600px] px-5 py-16 lg:px-10 lg:py-24">
        <h1 className="font-display text-4xl lg:text-6xl">Your bag is empty</h1>
        <p className="mt-4 text-sm text-muted-foreground">Add a piece to your bag to check out.</p>
        <Link to="/collections/$slug" params={{ slug: "all" }} className="btn-ink mt-8">Explore the collection</Link>
      </div>
    );
  }

  const input = (id: keyof Form, extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input id={id} className="field" value={form[id]} onChange={set(id)} aria-invalid={!!errors[id]} aria-describedby={`${id}-err`} {...extra} />
  );

  return (
    <div className="mx-auto max-w-[1600px] px-5 py-12 lg:px-10 lg:py-20">
      <p className="eyebrow text-muted-foreground">Secure checkout</p>
      <h1 className="font-display mt-3 text-4xl lg:text-6xl">Checkout</h1>

      <div className="mt-10 grid gap-12 lg:grid-cols-[1fr_440px] lg:gap-20">
        <form onSubmit={submit} noValidate aria-label="Delivery details">
          <h2 className="eyebrow">Delivery address</h2>
          <div className="mt-6 grid gap-x-5 sm:grid-cols-2">
            <Field id="name" label="Full name" error={errors.name}>{input("name", { autoComplete: "name", maxLength: 100 })}</Field>
            <Field id="phone" label="Mobile number" error={errors.phone}>{input("phone", { type: "tel", inputMode: "tel", autoComplete: "tel", maxLength: 16, placeholder: "10-digit mobile number" })}</Field>
            <Field id="line1" label="Address" error={errors.line1} className="sm:col-span-2">{input("line1", { autoComplete: "address-line1", maxLength: 150 })}</Field>
            <Field id="line2" label="Apartment, landmark (optional)" error={errors.line2} className="sm:col-span-2">{input("line2", { autoComplete: "address-line2", maxLength: 150 })}</Field>
            <Field id="city" label="City" error={errors.city}>{input("city", { autoComplete: "address-level2", maxLength: 80 })}</Field>
            <Field id="pincode" label="Pincode" error={errors.pincode}>
              {input("pincode", { inputMode: "numeric", autoComplete: "postal-code", maxLength: 6, placeholder: "6 digits", onChange: (e) => { e.target.value = e.target.value.replace(/\D/g, ""); set("pincode")(e); } })}
            </Field>
            <Field id="state" label="State" error={errors.state} className="sm:col-span-2">
              <Select
                id="state" value={form.state} placeholder="Choose a state" aria-invalid={!!errors.state} aria-describedby="state-err"
                onChange={(v) => { setForm((f) => ({ ...f, state: v })); setErrors((x) => ({ ...x, state: undefined })); setFormError(""); }}
                options={INDIAN_STATES.map((s) => ({ value: s, label: s }))}
              />
            </Field>
          </div>

          <div className="mt-6 border border-hairline bg-paper p-5 text-sm leading-relaxed">
            <p className="eyebrow">Payment</p>
            <p className="mt-2 text-muted-foreground">No payment is taken yet. Online payment will be arranged once our payment partner is confirmed — your order is held for you until then.</p>
          </div>

          <p className="mt-6 min-h-5 text-sm text-destructive" role="alert" aria-live="polite">{formError}</p>
          <button type="submit" disabled={busy || !summary || items.length === 0 || unavailable.length > 0} className="btn-ink mt-2 w-full sm:w-auto">
            {busy ? "Placing order…" : <>Place order <ArrowRight className="h-4 w-4" /></>}
          </button>
        </form>

        <aside aria-label="Order summary" className="h-fit border border-hairline p-6 lg:sticky lg:top-40">
          <div className="flex items-baseline justify-between">
            <h2 className="eyebrow">Your bag</h2>
            <button type="button" onClick={() => setPanel("cart")} className="text-xs text-muted-foreground underline underline-offset-4 hover:text-oxblood">Edit</button>
          </div>
          {loadErr ? (
            <p className="mt-6 text-sm text-destructive" role="alert">{loadErr} <button type="button" className="underline underline-offset-4" onClick={() => void loadSummary()}>Retry</button></p>
          ) : !summary ? (
            <p className="mt-6 text-sm text-muted-foreground" role="status">Loading your bag…</p>
          ) : (
            <>
              <ul className="mt-2 divide-y divide-hairline">
                {items.map((i) => {
                  const p = findAny(i.slug);
                  return (
                    <li key={i.id} className="flex gap-4 py-4">
                      <div className="w-16 shrink-0 bg-paper">{p && <img src={productThumb(p)} alt="" className="aspect-[4/5] w-full object-cover" />}</div>
                      <div className="flex min-w-0 flex-1 justify-between gap-3">
                        <div>
                          <p className="text-sm">{p?.name ?? i.slug}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{i.colour}{i.size ? ` · ${i.size} cm` : ""} · Qty {i.qty}</p>
                          {!i.available && <p className="mt-1 text-xs text-destructive">{i.stock === "out" ? "No longer available" : "Not enough in stock — lower the quantity"}</p>}
                        </div>
                        <p className="text-sm tabular-nums">{formatINR(i.unitPrice * i.qty)}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-4 border-t border-hairline pt-5"><Totals subtotal={summary.subtotal} shipping={summary.shipping} total={summary.total} /></div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

function Confirmation({ order }: { order: ApiOrder }) {
  return (
    <div className="mx-auto max-w-[1100px] px-5 py-16 lg:px-10 lg:py-24">
      <p className="eyebrow text-oxblood">Order received</p>
      <h1 className="font-display mt-3 text-4xl lg:text-6xl">Thank you.</h1>
      <p className="mt-5 max-w-xl text-sm leading-relaxed text-muted-foreground">
        Your order <span className="text-ink tabular-nums">{order.orderNumber}</span> is with us. No payment has been taken — we'll arrange it with you once our payment partner is confirmed.
      </p>
      <div className="mt-6"><StatusBadges order={order} /></div>

      <div className="mt-12 grid gap-12 lg:grid-cols-[1fr_320px]">
        <div>
          <OrderItems items={order.items} />
          <div className="mt-4 max-w-sm border-t border-hairline pt-5"><Totals subtotal={order.subtotal} shipping={order.shipping} total={order.total} /></div>
        </div>
        <div>
          <h2 className="eyebrow">Delivering to</h2>
          <div className="mt-4"><AddressBlock a={order.shippingAddress} /></div>
        </div>
      </div>

      <div className="mt-12 flex flex-wrap gap-4">
        <Link to="/orders" className="btn-ink">View my orders</Link>
        <Link to="/collections/$slug" params={{ slug: "all" }} className="btn-outline">Continue shopping</Link>
      </div>
    </div>
  );
}
