import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Field, fieldErrors, fromLocalInput, LoadState, NotAppliedNotice, numOrNull, Pill, Section, toLocalInput, useLoad } from "@/components/admin/ui";
import { api, errorMessage } from "@/lib/api";
import { COLLECTIONS, formatINR } from "@/lib/catalog";
import { useCatalog } from "@/lib/catalog-live";

export const Route = createFileRoute("/admin/offers")({ component: Offers });

type Offer = {
  id: string; name: string; description: string; kind: "percentage" | "fixed" | "free_shipping"; value: number; code: string | null;
  combinesAs: "offer" | "coupon" | "free_shipping"; scope: "all" | "collection" | "product"; scopeValues: string[];
  minOrderInr: number; maxDiscountInr: number | null; startsAt: string | null; endsAt: string | null;
  usageLimit: number | null; perUserLimit: number | null; priority: number; active: boolean; state: "live" | "scheduled" | "expired" | "disabled";
};

const STATE_TONE = { live: "live", scheduled: "warn", expired: "muted", disabled: "muted" } as const;
const describeValue = (o: Offer) => (o.kind === "percentage" ? `${o.value}% off` : o.kind === "fixed" ? `${formatINR(o.value)} off` : "Free shipping");
const describeScope = (o: Offer) =>
  o.scope === "all" ? "Everything" : `${o.scopeValues.length} ${o.scope === "collection" ? "collection" : "product"}${o.scopeValues.length === 1 ? "" : "s"}`;
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

function Offers() {
  const { data, error, reload, setData } = useLoad<{ offers: Offer[] }>("/admin/offers");
  const [editing, setEditing] = useState<Offer | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const patch = (o: Offer) => setData((d) => (d ? { offers: d.offers.map((x) => (x.id === o.id ? o : x)) } : d));

  const toggle = async (o: Offer) => {
    setBusy(o.id);
    try { patch((await api<{ offer: Offer }>(`/admin/offers/${o.id}`, { method: "PATCH", body: { active: !o.active } })).offer); }
    catch (e) { toast.error(errorMessage(e)); }
    finally { setBusy(null); }
  };
  const remove = async (o: Offer) => {
    setBusy(o.id);
    try {
      await api(`/admin/offers/${o.id}`, { method: "DELETE" });
      setData((d) => (d ? { offers: d.offers.filter((x) => x.id !== o.id) } : d));
      toast("Offer deleted", { description: o.name });
    } catch (e) { toast.error(errorMessage(e)); }
    finally { setBusy(null); setConfirmDelete(null); }
  };

  return (
    <div className="space-y-8">
      <NotAppliedNotice />
      <Section
        title="Offers"
        hint="Automatic offers apply without a code; give an offer a code to make it a coupon. Higher priority wins when several offers could apply."
        action={editing ? null : <button className="btn-ink" onClick={() => setEditing("new")}>New offer</button>}
      >
        {editing && (
          <OfferForm
            key={editing === "new" ? "new" : editing.id}
            initial={editing === "new" ? null : editing}
            onCancel={() => setEditing(null)}
            onSaved={(o, created) => {
              setData((d) => (d ? { offers: created ? [o, ...d.offers] : d.offers.map((x) => (x.id === o.id ? o : x)) } : d));
              setEditing(null);
              void reload();
              toast.success(created ? "Offer created" : "Offer saved", { description: o.name });
            }}
          />
        )}
        <LoadState error={error} ready={!!data} reload={() => void reload()}>
          {data && data.offers.length === 0 && !editing ? (
            <p className="text-sm text-muted-foreground">No offers yet. Create one to get started.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {data?.offers.map((o) => (
                <li key={o.id} className="py-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm">{o.name}</p>
                        <Pill tone={STATE_TONE[o.state]}>{o.state}</Pill>
                        {o.code && <Pill tone="live">Code {o.code}</Pill>}
                      </div>
                      {o.description && <p className="mt-1 text-xs text-muted-foreground">{o.description}</p>}
                      <p className="mt-2 text-xs text-muted-foreground">
                        {describeValue(o)} · {describeScope(o)}
                        {o.minOrderInr > 0 && ` · min order ${formatINR(o.minOrderInr)}`}
                        {o.maxDiscountInr && ` · up to ${formatINR(o.maxDiscountInr)}`}
                        {o.startsAt && ` · from ${fmtDate(o.startsAt)}`}
                        {o.endsAt && ` · until ${fmtDate(o.endsAt)}`}
                        {o.usageLimit && ` · ${o.usageLimit} uses`}
                        {o.perUserLimit && ` · ${o.perUserLimit} per shopper`}
                        {o.priority !== 0 && ` · priority ${o.priority}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      {confirmDelete === o.id ? (
                        <>
                          <span className="text-muted-foreground">Delete this offer?</span>
                          <button disabled={busy === o.id} onClick={() => void remove(o)} className="underline underline-offset-4 hover:text-oxblood">Yes, delete</button>
                          <button onClick={() => setConfirmDelete(null)} className="text-muted-foreground underline underline-offset-4">Keep</button>
                        </>
                      ) : (
                        <>
                          <button disabled={busy === o.id} onClick={() => void toggle(o)} className="underline underline-offset-4 hover:text-oxblood">{o.active ? "Disable" : "Enable"}</button>
                          <button onClick={() => setEditing(o)} className="underline underline-offset-4 hover:text-oxblood">Edit</button>
                          <button onClick={() => setConfirmDelete(o.id)} className="text-muted-foreground underline underline-offset-4 hover:text-oxblood">Delete</button>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </LoadState>
      </Section>
    </div>
  );
}

function OfferForm({ initial, onCancel, onSaved }: { initial: Offer | null; onCancel: () => void; onSaved: (o: Offer, created: boolean) => void }) {
  const { products } = useCatalog();
  const [f, setF] = useState({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    kind: initial?.kind ?? ("percentage" as Offer["kind"]),
    value: initial ? String(initial.value) : "10",
    code: initial?.code ?? "",
    scope: initial?.scope ?? ("all" as Offer["scope"]),
    scopeValues: initial?.scopeValues ?? ([] as string[]),
    minOrderInr: initial ? String(initial.minOrderInr) : "0",
    maxDiscountInr: initial?.maxDiscountInr ? String(initial.maxDiscountInr) : "",
    startsAt: toLocalInput(initial?.startsAt ?? null),
    endsAt: toLocalInput(initial?.endsAt ?? null),
    usageLimit: initial?.usageLimit ? String(initial.usageLimit) : "",
    perUserLimit: initial?.perUserLimit ? String(initial.perUserLimit) : "",
    priority: initial ? String(initial.priority) : "0",
    active: initial?.active ?? true,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); setFormError(""); };
  const collections = COLLECTIONS.filter((c) => c.slug !== "all");
  const shownProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => !q || `${p.name} ${p.type}`.toLowerCase().includes(q));
  }, [products, search]);
  const toggleValue = (slug: string) => set("scopeValues", f.scopeValues.includes(slug) ? f.scopeValues.filter((s) => s !== slug) : [...f.scopeValues, slug]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true); setErrors({}); setFormError("");
    const body = {
      name: f.name, description: f.description, kind: f.kind,
      value: f.kind === "free_shipping" ? 0 : Number(f.value),
      code: f.code.trim() === "" ? null : f.code,
      scope: f.scope, scopeValues: f.scope === "all" ? [] : f.scopeValues,
      minOrderInr: Number(f.minOrderInr || 0),
      maxDiscountInr: f.kind === "percentage" ? numOrNull(f.maxDiscountInr) : null,
      startsAt: fromLocalInput(f.startsAt), endsAt: fromLocalInput(f.endsAt),
      usageLimit: numOrNull(f.usageLimit), perUserLimit: numOrNull(f.perUserLimit),
      priority: Number(f.priority || 0), active: f.active,
    };
    try {
      const r = initial
        ? await api<{ offer: Offer }>(`/admin/offers/${initial.id}`, { method: "PUT", body })
        : await api<{ offer: Offer }>("/admin/offers", { method: "POST", body });
      onSaved(r.offer, !initial);
    } catch (err) {
      const x = fieldErrors(err);
      setErrors(x.fields); setFormError(x.general);
      setSaving(false);
    }
  };

  const num = (id: keyof typeof f, label: string, hint?: string) => (
    <Field id={id} label={label} hint={hint} error={errors[id]}>
      <input id={id} className="field" inputMode="numeric" value={String(f[id])} onChange={(e) => set(id, e.target.value.replace(/[^\d-]/g, "") as never)} aria-invalid={!!errors[id]} aria-describedby={`${id}-err`} />
    </Field>
  );

  return (
    <form onSubmit={submit} noValidate className="mb-8 border border-ink p-6" aria-label={initial ? "Edit offer" : "New offer"}>
      <h3 className="eyebrow">{initial ? "Edit offer" : "New offer"}</h3>
      <div className="mt-5 grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <Field id="name" label="Name" error={errors["name"]}>
          <input id="name" className="field" value={f.name} maxLength={80} onChange={(e) => set("name", e.target.value)} aria-invalid={!!errors["name"]} aria-describedby="name-err" />
        </Field>
        <Field id="code" label="Coupon code (optional)" hint="Leave empty for an automatic offer." error={errors["code"]}>
          <input id="code" className="field uppercase" value={f.code} maxLength={32} onChange={(e) => set("code", e.target.value.toUpperCase())} aria-invalid={!!errors["code"]} aria-describedby="code-err" />
        </Field>
        <Field id="description" label="Description (optional)" className="sm:col-span-2" error={errors["description"]}>
          <input id="description" className="field" value={f.description} maxLength={300} onChange={(e) => set("description", e.target.value)} />
        </Field>

        <Field id="kind" label="Discount" error={errors["kind"]}>
          <select id="kind" className="field" value={f.kind} onChange={(e) => set("kind", e.target.value as Offer["kind"])}>
            <option value="percentage">Percentage off</option>
            <option value="fixed">Fixed amount off (₹)</option>
            <option value="free_shipping">Free shipping</option>
          </select>
        </Field>
        {f.kind !== "free_shipping" ? num("value", f.kind === "percentage" ? "Percent (1–100)" : "Amount (₹)") : <div />}

        <Field id="scope" label="Applies to" error={errors["scope"]}>
          <select id="scope" className="field" value={f.scope} onChange={(e) => { set("scope", e.target.value as Offer["scope"]); set("scopeValues", []); }}>
            <option value="all">Everything</option>
            <option value="collection">Selected collections</option>
            <option value="product">Selected products</option>
          </select>
        </Field>
        {num("minOrderInr", "Minimum order (₹)", "0 for no minimum.")}

        {f.scope !== "all" && (
          <div className="sm:col-span-2">
            <p className="eyebrow text-muted-foreground">{f.scope === "collection" ? "Collections" : "Products"} ({f.scopeValues.length} selected)</p>
            {f.scope === "product" && <input className="field mt-2" placeholder="Search products…" aria-label="Search products" value={search} onChange={(e) => setSearch(e.target.value)} />}
            <div className="mt-2 grid max-h-56 gap-2 overflow-y-auto border border-hairline p-3 sm:grid-cols-2">
              {(f.scope === "collection" ? collections.map((c) => ({ slug: c.slug, label: c.title })) : shownProducts.map((p) => ({ slug: p.slug, label: `${p.name} · ${formatINR(p.price)}` }))).map((o) => (
                <Check key={o.slug} id={`scope-${o.slug}`} checked={f.scopeValues.includes(o.slug)} onChange={() => toggleValue(o.slug)} label={o.label} />
              ))}
            </div>
            <p className={errors["scopeValues"] ? "mt-1.5 text-xs text-destructive" : "hidden"} aria-live="polite">{errors["scopeValues"]}</p>
          </div>
        )}

        {f.kind === "percentage" && num("maxDiscountInr", "Maximum discount (₹, optional)", "Caps a percentage offer.")}
        {num("priority", "Priority", "Higher numbers win. Use 0 if unsure.")}
        <Field id="startsAt" label="Starts (optional)" error={errors["startsAt"]}>
          <input id="startsAt" type="datetime-local" className="field" value={f.startsAt} onChange={(e) => set("startsAt", e.target.value)} />
        </Field>
        <Field id="endsAt" label="Ends (optional)" error={errors["endsAt"]}>
          <input id="endsAt" type="datetime-local" className="field" value={f.endsAt} onChange={(e) => set("endsAt", e.target.value)} />
        </Field>
        {num("usageLimit", "Total uses (optional)", "Empty for unlimited.")}
        {num("perUserLimit", "Uses per shopper (optional)", "Empty for unlimited.")}
      </div>
      <div className="mt-3"><Check id="active" checked={f.active} onChange={(v) => set("active", v)} label="Active" hint="Inactive offers are kept but never applied." /></div>

      <p className="mt-5 min-h-5 text-sm text-destructive" role="alert" aria-live="polite">{formError}</p>
      <div className="mt-2 flex gap-3">
        <button type="submit" disabled={saving} className="btn-ink">{saving ? "Saving…" : initial ? "Save changes" : "Create offer"}</button>
        <button type="button" onClick={onCancel} className="btn-outline">Cancel</button>
      </div>
    </form>
  );
}
