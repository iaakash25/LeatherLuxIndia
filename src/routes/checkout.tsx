import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Check as CheckIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { AccountGate } from "@/components/site/AccountGate";
import { CheckoutClosedPage } from "@/components/site/LaunchNotice";
import { Select } from "@/components/ui/select-menu";
import { AddressBlock, OrderItems, StatusBadges, Totals } from "@/components/site/OrderParts";
import { api, ApiError, errorMessage, type ApiCart, type ApiOrder } from "@/lib/api";
import { formatINR, productThumb } from "@/lib/catalog";
import { useCatalog } from "@/lib/catalog-live";
import { INDIAN_STATES } from "@/lib/india";
import { usePincodeLookup, type Lookup } from "@/lib/pincode";
import { cleanPhoneInput, validateAddressLine, validateCity, validateMobile, validatePersonName, validatePincode, validateState, type Check } from "@/lib/validation";
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

/**
 * Every field judged by the shared rules (src/lib/validation.ts, the same ones the server enforces). `values` is what to send: trimmed, the
 * phone as 10 digits. A pincode the lookup says does not exist is refused here too.
 */
function check(f: Form, lookup: Lookup): { values: Form; errors: Errors } {
  const errors: Errors = {};
  const values: Form = { ...f };
  const run = (k: keyof Form, r: Check) => { if (r.ok) values[k] = r.value; else errors[k] = r.message; };
  run("name", validatePersonName(f.name));
  run("phone", validateMobile(f.phone));
  run("line1", validateAddressLine(f.line1, { required: true }));
  run("line2", validateAddressLine(f.line2, { required: false }));
  run("city", validateCity(f.city));
  run("state", validateState(f.state));
  run("pincode", validatePincode(f.pincode));
  if (!errors.pincode && lookup.status === "not_found") errors.pincode = "We couldn't find this pincode. Please check it.";
  return { values, errors };
}

function CheckoutPage() {
  const { ordersOpen, settled } = useOrdersOpen();
  // Wait for the server's answer rather than flash "not open yet" at a shopper who arrives when it is open.
  if (!settled) return <p role="status" className="px-5 py-40 text-center text-sm text-muted-foreground">Loading…</p>;
  if (!ordersOpen) return <CheckoutClosedPage />;
  return <AccountGate title="Checkout">{(user) => <Checkout userName={user.name} />}</AccountGate>;
}

function Field({ id, label, error, note, children, className }: { id: string; label: string; error: string | undefined; note?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="eyebrow text-muted-foreground">{label}</label>
      <div className="mt-2">{children}</div>
      <p id={`${id}-err`} className="mt-1.5 min-h-4 text-xs text-destructive" aria-live="polite">{error}</p>
      {note && !error && <div className="-mt-0.5 mb-1 text-xs">{note}</div>}
    </div>
  );
}

/** What the pincode lookup found, shown under the pincode field. */
function PincodeNote({ lookup }: { lookup: Lookup }) {
  if (lookup.status === "loading") return <span className="text-muted-foreground" role="status">Finding your area…</span>;
  if (lookup.status === "found") return <span className="inline-flex items-center gap-1.5 text-ink" role="status"><CheckIcon className="h-3.5 w-3.5 stroke-[1.6] text-oxblood" aria-hidden="true" />{lookup.info.city}{lookup.info.state ? `, ${lookup.info.state}` : ""}</span>;
  if (lookup.status === "unavailable") return <span className="text-muted-foreground" role="status">We couldn't look this up just now. Please fill in your city and state.</span>;
  return null;
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
  // The pincode tells the city and state: as soon as a real one is typed they are filled in (and can still be corrected).
  const lookup = usePincodeLookup(form.pincode);

  const loadSummary = useCallback(async () => {
    try { setSummary(await api<ApiCart>("/cart")); setLoadErr(""); } catch (err) { setLoadErr(errorMessage(err)); }
  }, []);
  // Re-read whenever the bag changes (e.g. quantities edited in the drawer) so totals are always the server's.
  useEffect(() => { void loadSummary(); }, [loadSummary, cart]);

  useEffect(() => {
    if (lookup.status !== "found") return;
    const { pincode, city, state } = lookup.info;
    setForm((f) => (f.pincode === pincode ? { ...f, city, ...(state ? { state } : {}) } : f));
    setErrors((x) => ({ ...x, city: undefined, state: state ? undefined : x.state, pincode: undefined }));
  }, [lookup]);

  const set = (k: keyof Form) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = e.target.value;
    setForm((f) => ({ ...f, [k]: value }));
    setErrors((x) => ({ ...x, [k]: undefined }));
    setFormError("");
  };
  /** Judges one field when the shopper leaves it, so a mistake is shown at once, not only after pressing Place order. */
  const blur = (k: keyof Form) => () => {
    if (!form[k]) return; // an empty field is not scolded when the shopper tabs past it; Place order lists every missing one
    const e = check(form, lookup).errors[k];
    setErrors((x) => ({ ...x, [k]: e }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (lookup.status === "loading") { setFormError("One moment: we're still checking your pincode."); return; }
    const { values, errors: errs } = check(form, lookup);
    setErrors(errs);
    if (Object.keys(errs).length) { setFormError("Please check the highlighted fields."); return; }
    setForm(values);
    setFormError("");
    setBusy(true);
    idemKey.current ??= newKey();
    try {
      const line2 = values.line2;
      const { order } = await api<{ order: ApiOrder }>("/orders", {
        method: "POST",
        headers: { "Idempotency-Key": idemKey.current },
        body: {
          shippingAddress: {
            name: values.name, phone: values.phone, line1: values.line1,
            ...(line2 ? { line2 } : {}),
            city: values.city, state: values.state, pincode: values.pincode,
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
            <Field id="name" label="Full name" error={errors.name}>{input("name", { autoComplete: "name", maxLength: 80, onBlur: blur("name") })}</Field>
            <Field id="phone" label="Mobile number" error={errors.phone}>
              {input("phone", {
                type: "tel", inputMode: "numeric", autoComplete: "tel-national", maxLength: 16, placeholder: "10-digit mobile number", onBlur: blur("phone"),
                // digits only; a pasted "+91 98765 43210" or "098765 43210" becomes the 10 digits
                onChange: (e) => { e.target.value = cleanPhoneInput(e.target.value); set("phone")(e); },
              })}
            </Field>
            <Field id="pincode" label="Pincode" error={errors.pincode} note={<PincodeNote lookup={lookup} />}>
              {input("pincode", { inputMode: "numeric", autoComplete: "postal-code", maxLength: 6, placeholder: "6 digits", onBlur: blur("pincode"), onChange: (e) => { e.target.value = e.target.value.replace(/\D/g, ""); set("pincode")(e); } })}
            </Field>
            <Field id="city" label="City" error={errors.city}>{input("city", { autoComplete: "address-level2", maxLength: 60, onBlur: blur("city") })}</Field>
            <Field id="state" label="State" error={errors.state} className="sm:col-span-2" note={lookup.status === "found" && form.state && lookup.info.state && form.state !== lookup.info.state ? <span className="text-brass">This pincode is usually in {lookup.info.state}. Please double-check your state.</span> : null}>
              <Select
                id="state" value={form.state} placeholder="Choose a state" aria-invalid={!!errors.state} aria-describedby="state-err"
                onChange={(v) => { setForm((f) => ({ ...f, state: v })); setErrors((x) => ({ ...x, state: undefined })); setFormError(""); }}
                options={INDIAN_STATES.map((s) => ({ value: s, label: s }))}
              />
            </Field>
            <Field id="line1" label="House / flat number and street" error={errors.line1} className="sm:col-span-2">{input("line1", { autoComplete: "address-line1", maxLength: 150, onBlur: blur("line1") })}</Field>
            <Field id="line2" label="Apartment, landmark (optional)" error={errors.line2} className="sm:col-span-2">{input("line2", { autoComplete: "address-line2", maxLength: 150, onBlur: blur("line2") })}</Field>
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
