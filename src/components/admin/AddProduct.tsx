import { useState } from "react";
import { toast } from "sonner";
import { Combobox, Select } from "@/components/ui/select-menu";
import { api } from "@/lib/api";
import { Check, Field, fieldErrors, numOrNull } from "./ui";
import { HoverPicker } from "./HoverPicker";
import { PhotoUploader, type PhotoItem } from "./PhotoUploader";
import { GENDER_LABEL, STATUS_OPTIONS, statusPatch, type Gender, type HoverEffect, type InvProduct, type ShopStatus } from "./inventory-types";

const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
const EMPTY = {
  name: "", sku: "", type: "", gender: "women" as Gender, priceInr: "", costInr: "", stockQty: "", reorderLevel: "3",
  colours: "", sizes: "", tagline: "", description: "", material: "", dimensions: "", tags: "",
  isNew: true, bestseller: false, gift: false, status: "active" as ShopStatus, hoverEffect: "swap" as HoverEffect,
};

/** The form for a product that is not in the inventory yet: every detail, an opening stock count, 1 to 4 photos and the hover effect. */
export function AddProduct({ types, onCreated, onClose }: { types: string[]; onCreated: (p: InvProduct) => void; onClose: () => void }) {
  const [f, setF] = useState(EMPTY);
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); setFormError(""); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const local: Record<string, string> = {};
    if (!f.name.trim()) local["name"] = "Enter a name.";
    if (!f.type.trim()) local["type"] = "Enter or pick a category.";
    if (!/^\d+$/.test(f.priceInr) || Number(f.priceInr) < 1) local["priceInr"] = "Enter the price in whole rupees.";
    if (!list(f.colours).length) local["colours"] = "Add at least one colour.";
    if (photos.length < 1) local["photos"] = "Add at least one photo.";
    if (Object.keys(local).length) { setErrors(local); setFormError("Please fix the highlighted fields."); return; }

    setSaving(true); setErrors({}); setFormError("");
    const sizes = list(f.sizes);
    try {
      const r = await api<{ product: InvProduct }>("/admin/inventory", {
        method: "POST",
        body: {
          name: f.name.trim(), ...(f.sku.trim() ? { sku: f.sku.trim() } : {}), type: f.type.trim(), gender: f.gender,
          priceInr: Number(f.priceInr), costInr: numOrNull(f.costInr), stockQty: Number(f.stockQty || 0), reorderLevel: Number(f.reorderLevel || 0),
          colours: list(f.colours), sizes: sizes.length ? sizes : null, tagline: f.tagline, material: f.material, dimensions: f.dimensions,
          description: f.description, tags: list(f.tags), isNew: f.isNew, bestseller: f.bestseller, gift: f.gift,
          ...statusPatch(f.status), hoverEffect: f.hoverEffect,
          photos: photos.map((p) => ({ id: p.id, label: p.label.trim() })),
        },
      });
      toast.success("Product added", { description: `${r.product.name} · ${r.product.sku}` });
      photos.forEach((p) => URL.revokeObjectURL(p.preview));
      onCreated(r.product);
    } catch (err) {
      const x = fieldErrors(err);
      setErrors(x.fields); setFormError(x.general);
    } finally { setSaving(false); }
  };

  const id = (k: string) => `add-${k}`;
  return (
    <form onSubmit={submit} noValidate aria-label="Add a product" className="mb-10 border border-ink p-6 lg:p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="eyebrow">Add a product</h3>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Fill in what you know; you can change anything later by opening the product. It goes into the shop as soon as you save, unless you set it to Hidden.</p>
        </div>
        <button type="button" onClick={onClose} className="text-sm underline underline-offset-4 hover:text-oxblood">Cancel</button>
      </div>

      <div className="mt-8 grid gap-x-6 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
        <Field id={id("name")} label="Name *" error={errors["name"]} className="sm:col-span-2 xl:col-span-2">
          <input id={id("name")} className="field" value={f.name} maxLength={120} onChange={(e) => set("name", e.target.value)} aria-invalid={!!errors["name"]} aria-describedby={`${id("name")}-err`} />
        </Field>
        <Field id={id("sku")} label="Style no." error={errors["sku"]} hint="Leave empty for an automatic one (LLI-NEW-001, …).">
          <input id={id("sku")} className="field" value={f.sku} maxLength={40} onChange={(e) => set("sku", e.target.value)} />
        </Field>
        <Field id={id("type")} label="Category *" error={errors["type"]} hint="Pick one or type a new category.">
          <Combobox id={id("type")} value={f.type} maxLength={60} onChange={(v) => set("type", v)} options={types.map((t) => ({ value: t, label: t }))} aria-invalid={!!errors["type"]} aria-describedby={`${id("type")}-err`} />
        </Field>
        <Field id={id("gender")} label="For" error={errors["gender"]}>
          <Select<Gender> id={id("gender")} value={f.gender} onChange={(v) => set("gender", v)} options={(Object.keys(GENDER_LABEL) as Gender[]).map((g) => ({ value: g, label: GENDER_LABEL[g] }))} />
        </Field>
        <Field id={id("status")} label="Shown in the shop as" error={errors["active"] ?? errors["availability"]} hint={STATUS_OPTIONS.find((o) => o.value === f.status)?.hint}>
          <Select<ShopStatus> id={id("status")} value={f.status} onChange={(v) => set("status", v)} options={STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} />
        </Field>

        <Field id={id("priceInr")} label="Price (₹) *" error={errors["priceInr"]}>
          <input id={id("priceInr")} className="field" inputMode="numeric" value={f.priceInr} onChange={(e) => set("priceInr", e.target.value.replace(/\D/g, ""))} aria-invalid={!!errors["priceInr"]} aria-describedby={`${id("priceInr")}-err`} />
        </Field>
        <Field id={id("costInr")} label="Cost price (₹)" error={errors["costInr"]} hint="Gives the margin. Empty if unknown.">
          <input id={id("costInr")} className="field" inputMode="numeric" value={f.costInr} onChange={(e) => set("costInr", e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field id={id("stockQty")} label="Opening stock" error={errors["stockQty"]} hint="Units on the shelf now; it is recorded in the stock history.">
          <input id={id("stockQty")} className="field" inputMode="numeric" value={f.stockQty} placeholder="0" onChange={(e) => set("stockQty", e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field id={id("reorderLevel")} label="Reorder level" error={errors["reorderLevel"]} hint="“Few left” shows at or below this many.">
          <input id={id("reorderLevel")} className="field" inputMode="numeric" value={f.reorderLevel} onChange={(e) => set("reorderLevel", e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field id={id("colours")} label="Colours *" error={errors["colours"]} hint="Separate with commas, e.g. Tan, Ink.">
          <input id={id("colours")} className="field" value={f.colours} onChange={(e) => set("colours", e.target.value)} aria-invalid={!!errors["colours"]} aria-describedby={`${id("colours")}-err`} />
        </Field>
        <Field id={id("sizes")} label="Sizes" error={errors["sizes"]} hint="Only for belts and similar; empty means no size choice.">
          <input id={id("sizes")} className="field" value={f.sizes} onChange={(e) => set("sizes", e.target.value)} />
        </Field>

        <Field id={id("tagline")} label="Tagline" error={errors["tagline"]} hint="One line, shown under the name." className="sm:col-span-2 xl:col-span-3">
          <input id={id("tagline")} className="field" value={f.tagline} maxLength={200} onChange={(e) => set("tagline", e.target.value)} />
        </Field>
        <Field id={id("description")} label="Description" error={errors["description"]} hint="Shown on the product page." className="sm:col-span-2 xl:col-span-3">
          <textarea id={id("description")} className="field min-h-28 py-3" value={f.description} maxLength={2000} onChange={(e) => set("description", e.target.value)} />
        </Field>
        <Field id={id("material")} label="Material" error={errors["material"]}>
          <input id={id("material")} className="field" value={f.material} maxLength={200} onChange={(e) => set("material", e.target.value)} />
        </Field>
        <Field id={id("dimensions")} label="Dimensions" error={errors["dimensions"]}>
          <input id={id("dimensions")} className="field" value={f.dimensions} maxLength={120} placeholder="e.g. 11 × 9.5 × 1.5 cm" onChange={(e) => set("dimensions", e.target.value)} />
        </Field>
        <Field id={id("tags")} label="Search tags" error={errors["tags"]} hint="Words shoppers might search for, separated by commas.">
          <input id={id("tags")} className="field" value={f.tags} onChange={(e) => set("tags", e.target.value)} />
        </Field>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <Check id={id("isNew")} checked={f.isNew} onChange={(v) => set("isNew", v)} label="New arrival" />
        <Check id={id("bestseller")} checked={f.bestseller} onChange={(v) => set("bestseller", v)} label="Bestseller" />
        <Check id={id("gift")} checked={f.gift} onChange={(v) => set("gift", v)} label="In the Gift Edit" />
      </div>

      <div className="mt-10 grid gap-10 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-label="Photos">
          <h4 className="eyebrow">Photos *</h4>
          <div className="mt-4">
            <PhotoUploader id={id("photos")} photos={photos} onChange={(v) => { setPhotos(v); setErrors((e) => ({ ...e, photos: "" })); }} />
          </div>
          <p className="min-h-5 text-xs text-destructive" role="alert" aria-live="polite">{errors["photos"]}</p>
        </section>
        <section aria-label="Hover effect">
          <HoverPicker id={id("hover")} value={f.hoverEffect} onChange={(v) => set("hoverEffect", v)} photos={photos.map((p) => p.preview)} />
        </section>
      </div>

      <p className="mt-6 min-h-5 text-sm text-destructive" role="alert" aria-live="polite">{formError}</p>
      <div className="mt-2 flex flex-wrap items-center gap-4">
        <button type="submit" disabled={saving} className="btn-ink">{saving ? "Adding…" : "Add product"}</button>
        <button type="button" onClick={onClose} className="btn-outline">Cancel</button>
      </div>
    </form>
  );
}
