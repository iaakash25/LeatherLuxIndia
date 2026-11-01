import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, errorMessage } from "@/lib/api";
import { imageUrl } from "@/lib/catalog-live";
import { cn } from "@/lib/utils";
import { Check, Field, fieldErrors, numOrNull, Pill } from "./ui";
import { GENDER_LABEL, REASON_LABEL, type Gender, type InvProduct, type MediaAsset, type Movement } from "./inventory-types";

type Props = { product: InvProduct; types: string[]; onChange: (p: InvProduct) => void };

/** The three things you can do to one product besides its price: edit the details, adjust the stock, manage the photos. */
export function ProductEditor({ product, types, onChange }: Props) {
  return (
    <div className="grid gap-10 border-t border-hairline bg-paper/40 px-4 py-8 lg:px-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <DetailsForm key={product.slug + product.updatedAt} product={product} types={types} onChange={onChange} />
      <div className="space-y-10">
        <StockPanel product={product} onChange={onChange} />
        <PhotosPanel product={product} onChange={onChange} />
      </div>
    </div>
  );
}

// ── Details ──────────────────────────────────────────────────────────────────────────────────
const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);

function DetailsForm({ product: p, types, onChange }: Props) {
  const [f, setF] = useState({
    name: p.name, type: p.type, gender: p.gender, tagline: p.tagline, material: p.material, dimensions: p.dimensions, description: p.description,
    colours: p.colours.join(", "), sizes: (p.sizes ?? []).join(", "), tags: p.tags.join(", "), reorderLevel: String(p.reorderLevel), costInr: p.costInr == null ? "" : String(p.costInr),
    active: p.active, isNew: p.isNew, bestseller: p.bestseller, gift: p.gift, needsReview: p.needsReview,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); setFormError(""); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true); setErrors({}); setFormError("");
    const sizes = list(f.sizes);
    try {
      const r = await api<{ product: InvProduct }>(`/admin/inventory/${p.slug}`, {
        method: "PATCH",
        body: {
          name: f.name, type: f.type, gender: f.gender, tagline: f.tagline, material: f.material, dimensions: f.dimensions, description: f.description,
          colours: list(f.colours), sizes: sizes.length ? sizes : null, tags: list(f.tags), reorderLevel: Number(f.reorderLevel || 0), costInr: numOrNull(f.costInr),
          active: f.active, isNew: f.isNew, bestseller: f.bestseller, gift: f.gift, needsReview: f.needsReview,
        },
      });
      onChange(r.product);
      toast.success("Product saved", { description: r.product.name });
    } catch (err) {
      const x = fieldErrors(err);
      setErrors(x.fields); setFormError(x.general);
    } finally { setSaving(false); }
  };

  const id = (k: string) => `${p.slug}-${k}`;
  return (
    <form onSubmit={submit} noValidate aria-label={`Edit ${p.name}`}>
      <h3 className="eyebrow">Details</h3>
      <div className="mt-5 grid gap-x-6 gap-y-1 sm:grid-cols-2">
        <Field id={id("name")} label="Name" error={errors["name"]} className="sm:col-span-2">
          <input id={id("name")} className="field" value={f.name} maxLength={120} onChange={(e) => set("name", e.target.value)} aria-invalid={!!errors["name"]} aria-describedby={`${id("name")}-err`} />
        </Field>
        <Field id={id("type")} label="Category" error={errors["type"]} hint="Pick one or type a new category.">
          <input id={id("type")} className="field" list={id("types")} value={f.type} maxLength={60} onChange={(e) => set("type", e.target.value)} />
          <datalist id={id("types")}>{types.map((t) => <option key={t} value={t} />)}</datalist>
        </Field>
        <Field id={id("gender")} label="For" error={errors["gender"]}>
          <select id={id("gender")} className="field" value={f.gender} onChange={(e) => set("gender", e.target.value as Gender)}>
            {(Object.keys(GENDER_LABEL) as Gender[]).map((g) => <option key={g} value={g}>{GENDER_LABEL[g]}</option>)}
          </select>
        </Field>
        <Field id={id("tagline")} label="Tagline" error={errors["tagline"]} hint="One line, shown under the name." className="sm:col-span-2">
          <input id={id("tagline")} className="field" value={f.tagline} maxLength={200} onChange={(e) => set("tagline", e.target.value)} />
        </Field>
        <Field id={id("description")} label="Description" error={errors["description"]} hint="Shown on the product page." className="sm:col-span-2">
          <textarea id={id("description")} className="field min-h-28 py-3" value={f.description} maxLength={2000} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <Field id={id("material")} label="Material" error={errors["material"]}>
          <input id={id("material")} className="field" value={f.material} maxLength={200} onChange={(e) => set("material", e.target.value)} />
        </Field>
        <Field id={id("dimensions")} label="Dimensions" error={errors["dimensions"]} hint="Left empty until measured; empty rows are not shown.">
          <input id={id("dimensions")} className="field" value={f.dimensions} maxLength={120} placeholder="e.g. 11 × 9.5 × 1.5 cm" onChange={(e) => set("dimensions", e.target.value)} />
        </Field>
        <Field id={id("colours")} label="Colours" error={errors["colours"]} hint="Separate with commas.">
          <input id={id("colours")} className="field" value={f.colours} onChange={(e) => set("colours", e.target.value)} />
        </Field>
        <Field id={id("sizes")} label="Sizes" error={errors["sizes"]} hint="Only for belts and similar; empty means no size choice.">
          <input id={id("sizes")} className="field" value={f.sizes} onChange={(e) => set("sizes", e.target.value)} />
        </Field>
        <Field id={id("tags")} label="Search tags" error={errors["tags"]} hint="Words shoppers might search for, separated by commas." className="sm:col-span-2">
          <input id={id("tags")} className="field" value={f.tags} onChange={(e) => set("tags", e.target.value)} />
        </Field>
        <Field id={id("costInr")} label="Cost price (₹)" error={errors["costInr"]} hint="What it costs you; gives the margin. Empty if unknown.">
          <input id={id("costInr")} className="field" inputMode="numeric" value={f.costInr} onChange={(e) => set("costInr", e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field id={id("reorderLevel")} label="Reorder level" error={errors["reorderLevel"]} hint="“Few left” shows at or below this many.">
          <input id={id("reorderLevel")} className="field" inputMode="numeric" value={f.reorderLevel} onChange={(e) => set("reorderLevel", e.target.value.replace(/\D/g, ""))} />
        </Field>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Check id={id("active")} checked={f.active} onChange={(v) => set("active", v)} label="Visible in the shop" hint="Untick to hide it without deleting it." />
        <Check id={id("needsReview")} checked={f.needsReview} onChange={(v) => set("needsReview", v)} label="Needs review" hint="Price or stock still to be confirmed." />
        <Check id={id("isNew")} checked={f.isNew} onChange={(v) => set("isNew", v)} label="New arrival" />
        <Check id={id("bestseller")} checked={f.bestseller} onChange={(v) => set("bestseller", v)} label="Bestseller" />
        <Check id={id("gift")} checked={f.gift} onChange={(v) => set("gift", v)} label="In the Gift Edit" />
      </div>
      <p className="mt-5 min-h-5 text-sm text-destructive" role="alert" aria-live="polite">{formError}</p>
      <div className="mt-2 flex items-center gap-4">
        <button type="submit" disabled={saving} className="btn-ink">{saving ? "Saving…" : "Save details"}</button>
        {p.sourceFolder && <span className="text-xs text-muted-foreground">Photographed in “{p.sourceFolder}”</span>}
      </div>
    </form>
  );
}

// ── Stock ────────────────────────────────────────────────────────────────────────────────────
type Mode = "add" | "set";
const ADD_REASONS = ["purchase", "return", "damage", "correction"] as const;
const SET_REASONS = ["count", "correction"] as const;

function StockPanel({ product: p, onChange }: Pick<Props, "product" | "onChange">) {
  const [mode, setMode] = useState<Mode>("add");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState<string>("purchase");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [moves, setMoves] = useState<Movement[] | null>(null);

  const loadMoves = useCallback(async () => {
    try { setMoves((await api<{ movements: Movement[] }>(`/admin/inventory/${p.slug}`)).movements); } catch { setMoves([]); }
  }, [p.slug]);
  useEffect(() => { void loadMoves(); }, [loadMoves]);

  const switchMode = (m: Mode) => { setMode(m); setReason(m === "add" ? "purchase" : "count"); setError(""); };
  const n = Number(qty);
  const valid = qty.trim() !== "" && Number.isInteger(n) && (mode === "set" ? n >= 0 : n !== 0);
  // “Received” always adds and “damaged” always removes, however the number was typed; only a correction keeps its sign.
  const signed = reason === "damage" ? -Math.abs(n) : reason === "purchase" || reason === "return" ? Math.abs(n) : n;
  const result = mode === "set" ? n : p.stockQty + signed;

  const apply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !valid) return;
    if (result < 0) { setError(`That would leave ${result} in stock; there are only ${p.stockQty}.`); return; }
    setBusy(true); setError("");
    try {
      const r = await api<{ product: InvProduct; change: { changed: boolean; before: number; after: number } }>(`/admin/inventory/${p.slug}/stock`, {
        method: "POST", body: { mode, qty: mode === "set" ? n : signed, reason, ...(note.trim() ? { note: note.trim() } : {}) },
      });
      onChange(r.product);
      setQty(""); setNote("");
      toast.success(r.change.changed ? `Stock ${r.change.before} → ${r.change.after}` : "Stock already matches", { description: p.name });
      void loadMoves();
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  const reasons = mode === "add" ? ADD_REASONS : SET_REASONS;
  const sid = (k: string) => `${p.slug}-stock-${k}`;
  return (
    <section aria-label="Stock">
      <h3 className="eyebrow">Stock</h3>
      <p className="mt-3 text-sm">
        <span className="font-display text-3xl tabular-nums">{p.stockQty}</span> <span className="text-muted-foreground">in stock · reorder at {p.reorderLevel}</span>
      </p>
      <form onSubmit={apply} noValidate className="mt-4 space-y-3">
        <div role="radiogroup" aria-label="Kind of change" className="flex gap-5 text-sm">
          {([["add", "Add or remove"], ["set", "Set to a count"]] as const).map(([m, label]) => (
            <label key={m} className="flex cursor-pointer items-center gap-2"><input type="radio" name={sid("mode")} className="accent-ink" checked={mode === m} onChange={() => switchMode(m)} />{label}</label>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id={sid("reason")} label="Reason">
            <select id={sid("reason")} className="field" value={reason} onChange={(e) => setReason(e.target.value)}>
              {reasons.map((r) => <option key={r} value={r}>{REASON_LABEL[r]}</option>)}
            </select>
          </Field>
          <Field id={sid("qty")} label={mode === "set" ? "Counted" : "Units"} hint={mode === "add" && reason === "correction" ? "Use a minus sign to remove." : undefined}>
            <input id={sid("qty")} className="field" inputMode="numeric" value={qty} placeholder={mode === "set" ? String(p.stockQty) : "0"}
              onChange={(e) => { setQty(e.target.value.replace(mode === "add" && reason === "correction" ? /[^\d-]/g : /\D/g, "")); setError(""); }} />
          </Field>
        </div>
        <Field id={sid("note")} label="Note (optional)">
          <input id={sid("note")} className="field" value={note} maxLength={200} placeholder="Supplier invoice, who counted, …" onChange={(e) => setNote(e.target.value)} />
        </Field>
        <p className="min-h-5 text-sm text-destructive" role="alert" aria-live="polite">{error}</p>
        <div className="flex items-center gap-4">
          <button type="submit" disabled={busy || !valid} className="btn-ink">{busy ? "Saving…" : "Apply"}</button>
          {valid && result >= 0 && <span className="text-xs text-muted-foreground">{p.stockQty} → {result}</span>}
        </div>
      </form>

      <h4 className="eyebrow mt-8 text-muted-foreground">Recent changes</h4>
      {moves === null ? <p className="mt-3 text-sm text-muted-foreground" role="status">Loading…</p>
        : moves.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Nothing recorded yet.</p>
        : (
          <ul className="mt-3 max-h-64 divide-y divide-hairline overflow-y-auto border-y border-hairline text-xs">
            {moves.map((m) => (
              <li key={m.id} className="grid grid-cols-[3.5rem_1fr_auto] items-baseline gap-x-3 py-2">
                <span className={cn("tabular-nums", m.delta > 0 ? "text-ink" : "text-oxblood")}>{m.delta > 0 ? "+" : "−"}{Math.abs(m.delta)}</span>
                <span className="min-w-0">
                  {REASON_LABEL[m.reason] ?? m.reason}{m.note && <span className="text-muted-foreground"> · {m.note}</span>}
                  <span className="block text-muted-foreground">{new Date(m.createdAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}{m.by && ` · ${m.by}`}</span>
                </span>
                <span className="tabular-nums text-muted-foreground">→ {m.qtyAfter}</span>
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

// ── Photos ───────────────────────────────────────────────────────────────────────────────────
function PhotosPanel({ product: p, onChange }: Pick<Props, "product" | "onChange">) {
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [spare, setSpare] = useState<MediaAsset[] | null>(null);
  const [label, setLabel] = useState("");

  const run = async (path: string, init: { method: "POST" | "DELETE"; body?: unknown }, done: string) => {
    if (busy) return;
    setBusy(true);
    try { const r = await api<{ product: InvProduct }>(path, init); onChange(r.product); toast.success(done, { description: p.name }); return true; }
    catch (e) { toast.error(errorMessage(e)); return false; }
    finally { setBusy(false); }
  };

  const openPicker = async () => {
    setPicking(true);
    try { setSpare((await api<{ assets: MediaAsset[] }>("/admin/media-library?status=spare&limit=200")).assets.filter((a) => a.webPath)); }
    catch (e) { toast.error(errorMessage(e)); setSpare([]); }
  };
  const add = async (a: MediaAsset) => {
    const ok = await run(`/admin/inventory/${p.slug}/images`, { method: "POST", body: { assetId: a.id, ...(label.trim() ? { label: label.trim() } : {}) } }, "Photo added");
    if (ok) { setSpare((s) => (s ? s.filter((x) => x.id !== a.id) : s)); setLabel(""); }
  };

  return (
    <section aria-label="Photos">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="eyebrow">Photos ({p.images.length})</h3>
        <button type="button" className="text-xs underline underline-offset-4 hover:text-oxblood" onClick={() => (picking ? setPicking(false) : void openPicker())}>
          {picking ? "Close spare photos" : "Add a spare photo"}
        </button>
      </div>
      <ul className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 xl:grid-cols-3">
        {p.images.map((ref, i) => (
          <li key={ref + i} className="min-w-0">
            <div className="relative aspect-[4/5] overflow-hidden bg-chalk ring-1 ring-hairline">
              {imageUrl(ref, "small") ? <img src={imageUrl(ref, "small")} alt={`${p.name}: ${p.imageLabels[i] || `photo ${i + 1}`}`} loading="lazy" className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center text-[10px] text-muted-foreground">No preview</span>}
              {i === 0 && <span className="absolute left-1.5 top-1.5"><Pill tone="live">Cover</Pill></span>}
            </div>
            <p className="mt-1.5 truncate text-xs text-muted-foreground">{p.imageLabels[i] || "—"}</p>
            <p className="flex gap-3 text-[11px]">
              {i > 0 && <button type="button" disabled={busy} className="underline underline-offset-4 hover:text-oxblood" onClick={() => void run(`/admin/inventory/${p.slug}/images/${i}/cover`, { method: "POST", body: {} }, "Cover changed")}>Make cover</button>}
              {p.images.length > 1 && <button type="button" disabled={busy} className="text-muted-foreground underline underline-offset-4 hover:text-oxblood" onClick={() => void run(`/admin/inventory/${p.slug}/images/${i}`, { method: "DELETE" }, "Photo removed")}>Remove</button>}
            </p>
          </li>
        ))}
      </ul>

      {picking && (
        <div className="mt-6 border border-hairline p-4">
          <p className="text-xs text-muted-foreground">Photos from the shoot that are not on any product yet. Click one to add it to {p.name}.</p>
          <Field id={`${p.slug}-photo-label`} label="Label for the photo you add" className="mt-3">
            <input id={`${p.slug}-photo-label`} className="field" value={label} maxLength={40} placeholder="e.g. Inside, Detail, Side view" onChange={(e) => setLabel(e.target.value)} />
          </Field>
          {spare === null ? <p className="mt-4 text-sm text-muted-foreground" role="status">Loading…</p>
            : spare.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">No spare photos left.</p>
            : (
              <ul className="mt-4 grid max-h-72 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-5">
                {spare.map((a) => (
                  <li key={a.id}>
                    <button type="button" disabled={busy} onClick={() => void add(a)} title={a.note} className="block w-full text-left">
                      <img src={a.thumbPath ? imageUrl(a.thumbPath) : undefined} alt={`Spare photo ${a.cameraNo}`} loading="lazy" className="aspect-[4/5] w-full bg-chalk object-cover ring-1 ring-hairline transition hover:ring-ink" />
                      <span className="mt-1 block truncate text-[10px] text-muted-foreground">#{a.cameraNo}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}
      <p className="mt-4 text-xs text-muted-foreground">The cover is the first photo, the one shown on cards. A change reaches the shop within a minute.</p>
    </section>
  );
}
