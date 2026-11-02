import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AddProduct } from "@/components/admin/AddProduct";
import { GENDER_LABEL, STATUS_LABEL, STATUS_OPTIONS, statusOf, statusPatch, type Gender, type InvList, type InvProduct, type InvSummary, type ShopStatus } from "@/components/admin/inventory-types";
import { ProductEditor } from "@/components/admin/ProductEditor";
import { LoadState, Pill, Section, useLoad } from "@/components/admin/ui";
import { api, errorMessage } from "@/lib/api";
import { formatINR } from "@/lib/catalog";
import { imageUrl } from "@/lib/catalog-live";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/inventory")({ component: Inventory });

type Status = "all" | "active" | "hidden" | "inactive" | "coming_soon" | "low" | "out" | "review";
type Sort = "rank" | "name" | "price-asc" | "price-desc" | "stock-asc" | "updated";
const SORTS: [Sort, string][] = [["rank", "Shop order"], ["name", "Name"], ["price-asc", "Price: low to high"], ["price-desc", "Price: high to low"], ["stock-asc", "Stock: lowest first"], ["updated", "Recently changed"]];
const COLUMNS = "lg:grid-cols-[3.25rem_minmax(0,1fr)_6.5rem_6.5rem_3.5rem_6rem_11rem]";
/** The most the API accepts for one product (STOCK_MAX in server/src/lib/inventory.ts). */
const STOCK_MAX = 100_000;

function Inventory() {
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [type, setType] = useState("");
  const [gender, setGender] = useState<"" | Gender>("");
  const [sort, setSort] = useState<Sort>("rank");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => { const t = setTimeout(() => setSearch(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const path = useMemo(() => {
    const p = new URLSearchParams({ status, sort, limit: "500" });
    if (search) p.set("q", search);
    if (type) p.set("type", type);
    if (gender) p.set("gender", gender);
    return `/admin/inventory?${p}`;
  }, [status, sort, search, type, gender]);
  const { data, error, reload, setData } = useLoad<InvList>(path);

  const replace = useCallback((p: InvProduct) => setData((d) => (d ? { ...d, products: d.products.map((x) => (x.slug === p.slug ? p : x)) } : d)), [setData]);
  /** A saved product replaces its row at once; the totals above are refreshed from the server. */
  const saved = useCallback((p: InvProduct) => { replace(p); void reload(); }, [replace, reload]);

  const s = data?.summary;
  const filtered = status !== "all" || !!search || !!type || !!gender;
  const types = data?.types.map((t) => t.type) ?? [];

  return (
    <div className="space-y-8">
      {s && <Totals s={s} status={status} onStatus={(v) => setStatus((cur) => (cur === v ? "all" : v))} />}
      {s && s.needsReview > 0 && (
        <p className="border border-hairline bg-paper px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          <strong className="font-medium text-ink">{s.needsReview} products need review.</strong> They were added from the photo shoot with a proposed price and a placeholder stock count.
          Check each price and count against your real figures, then press <em>Reviewed</em> on the row.{" "}
          <button className="underline underline-offset-4 hover:text-oxblood" onClick={() => setStatus("review")}>Show them</button>
        </p>
      )}

      <Section
        title="Inventory"
        hint="Edit a price, cost or stock count right in the row, and choose what shoppers see. Open a product to change its details, adjust its stock with a reason, and manage its photos."
        action={!adding && <button type="button" className="btn-ink" onClick={() => setAdding(true)}>Add product</button>}
      >
        {adding && <AddProduct types={types} onClose={() => setAdding(false)} onCreated={() => { setAdding(false); void reload(); }} />}
        <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
          <input className="field" type="search" placeholder="Search name, style no., tag…" aria-label="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="field" aria-label="Category" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All categories</option>
            {data?.types.map((t) => <option key={t.type} value={t.type}>{t.type} ({t.count})</option>)}
          </select>
          <select className="field" aria-label="Gender" value={gender} onChange={(e) => setGender(e.target.value as "" | Gender)}>
            <option value="">All genders</option>
            {(Object.keys(GENDER_LABEL) as Gender[]).map((g) => <option key={g} value={g}>{GENDER_LABEL[g]}</option>)}
          </select>
          <select className="field" aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            {SORTS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
          </select>
        </div>

        <LoadState error={error} ready={!!data} reload={() => void reload()}>
          {data && (
            <>
              <p className="mb-3 flex flex-wrap items-center gap-x-4 text-xs text-muted-foreground" aria-live="polite">
                <span>Showing {data.products.length}{data.total > data.products.length ? ` of ${data.total}` : ""} product{data.total === 1 ? "" : "s"}</span>
                {filtered && <button className="underline underline-offset-4 hover:text-oxblood" onClick={() => { setQ(""); setSearch(""); setStatus("all"); setType(""); setGender(""); }}>Clear filters</button>}
              </p>
              <div className={cn("hidden border-b border-ink pb-2 text-[10px] tracking-[0.12em] text-muted-foreground uppercase lg:grid lg:gap-4", COLUMNS)}>
                <span /><span>Product</span><span>Price ₹</span><span>Cost ₹</span><span>Margin</span><span>Stock</span><span />
              </div>
              {data.products.length === 0 ? (
                <p className="py-10 text-sm text-muted-foreground">No products match these filters.</p>
              ) : (
                <ul className="divide-y divide-hairline">
                  {data.products.map((p) => (
                    <Row key={p.slug} p={p} types={types} open={open === p.slug} onToggle={() => setOpen((cur) => (cur === p.slug ? null : p.slug))} onSaved={saved} />
                  ))}
                </ul>
              )}
            </>
          )}
        </LoadState>
      </Section>
    </div>
  );
}

// ── Totals ───────────────────────────────────────────────────────────────────────────────────
function Totals({ s, status, onStatus }: { s: InvSummary; status: Status; onStatus: (s: Status) => void }) {
  const tile = "border border-hairline p-4 text-left";
  const filterTile = (v: Status, label: string, value: number | string, tone?: "bad" | "warn") => (
    <button type="button" aria-pressed={status === v} onClick={() => onStatus(v)} className={cn(tile, "transition-colors hover:border-ink", status === v && "border-ink bg-paper")}>
      <span className="eyebrow block text-[10px] text-muted-foreground">{label}</span>
      <span className={cn("font-display mt-1 block text-3xl tabular-nums", tone === "bad" && Number(value) > 0 && "text-oxblood", tone === "warn" && Number(value) > 0 && "text-brass")}>{value}</span>
    </button>
  );
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {filterTile("active", "In the shop", `${s.active}`)}
      {filterTile("hidden", "Hidden", s.hidden)}
      {filterTile("inactive", "Inactive", s.inactive)}
      {filterTile("coming_soon", "Coming soon", s.comingSoon)}
      {filterTile("low", "Low stock", s.lowStock, "warn")}
      {filterTile("out", "Out of stock", s.outOfStock, "bad")}
      {filterTile("review", "Need review", s.needsReview, "warn")}
      <div className={tile}><span className="eyebrow block text-[10px] text-muted-foreground">Units on hand</span><span className="font-display mt-1 block text-3xl tabular-nums">{s.units.toLocaleString("en-IN")}</span></div>
      <div className={tile}><span className="eyebrow block text-[10px] text-muted-foreground">Stock at shop price</span><span className="font-display mt-1 block text-3xl tabular-nums">{formatINR(s.retailValueInr)}</span></div>
      <div className={tile}>
        <span className="eyebrow block text-[10px] text-muted-foreground">Stock at cost</span>
        {s.missingCost >= s.products ? <span className="mt-2 block text-xs text-muted-foreground">Add cost prices to see this</span>
          : <><span className="font-display mt-1 block text-3xl tabular-nums">{formatINR(s.costValueInr)}</span>{s.missingCost > 0 && <span className="block text-[11px] text-muted-foreground">{s.missingCost} without a cost</span>}</>}
      </div>
    </div>
  );
}

// ── One product ──────────────────────────────────────────────────────────────────────────────
type RowProps = { p: InvProduct; types: string[]; open: boolean; onToggle: () => void; onSaved: (p: InvProduct) => void };

function Row({ p, types, open, onToggle, onSaved }: RowProps) {
  const [busy, setBusy] = useState(false);
  const cover = p.images[0] ? imageUrl(p.images[0], "small") : undefined;

  const patch = async (body: Record<string, unknown>, okMessage?: string): Promise<boolean> => {
    setBusy(true);
    try {
      const r = await api<{ product: InvProduct }>(`/admin/inventory/${p.slug}`, { method: "PATCH", body });
      onSaved(r.product);
      if (okMessage) toast.success(okMessage, { description: p.name });
      return true;
    } catch (e) { toast.error(errorMessage(e), { description: p.name }); return false; }
    finally { setBusy(false); }
  };

  /** Sets the count through the stock history (as a correction), never by overwriting the number silently. */
  const setStock = async (qty: number): Promise<boolean> => {
    setBusy(true);
    try {
      const r = await api<{ product: InvProduct; change: { changed: boolean; before: number; after: number } }>(`/admin/inventory/${p.slug}/stock`, {
        method: "POST", body: { mode: "set", qty, reason: "correction", note: "Edited in the inventory list" },
      });
      onSaved(r.product);
      toast.success(r.change.changed ? `Stock ${r.change.before} → ${r.change.after}` : "Stock already matches", { description: p.name });
      return true;
    } catch (e) { toast.error(errorMessage(e), { description: p.name }); return false; }
    finally { setBusy(false); }
  };

  return (
    <li>
      <div className={cn("grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-x-4 gap-y-3 py-4", COLUMNS)}>
        <div className="aspect-[4/5] overflow-hidden bg-chalk ring-1 ring-hairline">
          {cover ? <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" /> : null}
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {p.active
              ? <Link to="/products/$slug" params={{ slug: p.slug }} target="_blank" rel="noopener" className="link-line truncate text-sm">{p.name}</Link>
              : <span className="truncate text-sm">{p.name}</span>}
            {!p.active ? <Pill>Hidden</Pill> : p.availability === "inactive" ? <Pill tone="bad">Inactive</Pill> : p.availability === "coming_soon" ? <Pill tone="warn">Coming soon</Pill> : null}
            {p.needsReview && <Pill tone="warn">Review</Pill>}
            {p.isNew && <Pill tone="live">New</Pill>}
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground">{p.sku ?? "No style no."} · {p.type} · {GENDER_LABEL[p.gender]} · {p.images.length} photo{p.images.length === 1 ? "" : "s"}</p>
        </div>

        <div className="col-span-2 grid grid-cols-3 items-end gap-3 lg:contents">
          <MoneyCell label="Price ₹" value={p.priceInr} min={1} onCommit={(v) => patch({ priceInr: v }, "Price saved")} />
          <MoneyCell label="Cost ₹" value={p.costInr} min={0} nullable onCommit={(v) => patch({ costInr: v }, "Cost saved")} />
          <p className="text-sm tabular-nums" title="Worked out from the price and the cost">
            <span className="eyebrow mb-1 block text-[10px] text-muted-foreground lg:hidden">Margin</span>
            {p.marginPct == null ? <span className="text-muted-foreground">—</span> : <span className={p.marginPct < 30 ? "text-oxblood" : undefined}>{p.marginPct}%</span>}
          </p>
          <StockCell p={p} onCommit={setStock} />
          <div className="col-span-3 space-y-2 lg:col-span-1">
            <select
              className="field h-9 w-full px-1.5 text-xs" aria-label={`What shoppers see for ${p.name}`} title={STATUS_OPTIONS.find((o) => o.value === statusOf(p))?.hint}
              value={statusOf(p)} disabled={busy}
              onChange={(e) => { const v = e.target.value as ShopStatus; void patch(statusPatch(v), `${STATUS_LABEL[v]}: ${STATUS_OPTIONS.find((o) => o.value === v)!.hint}`); }}
            >
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{STATUS_LABEL[o.value]}</option>)}
            </select>
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <button type="button" onClick={onToggle} aria-expanded={open} className="underline underline-offset-4 hover:text-oxblood">{open ? "Close" : "Open"}</button>
              {p.needsReview && <button type="button" disabled={busy} onClick={() => void patch({ needsReview: false }, "Marked as reviewed")} className="underline underline-offset-4 hover:text-oxblood">Reviewed</button>}
            </p>
          </div>
        </div>
      </div>
      {open && <ProductEditor product={p} types={types} onChange={onSaved} />}
    </li>
  );
}

/**
 * The stock count, editable in the row like the price and cost. The change is a "set to this count" that is written to the stock history as a
 * correction; open the product to give another reason (stock received, damaged, a physical count) or to add or remove units.
 */
function StockCell({ p, onCommit }: { p: InvProduct; onCommit: (qty: number) => Promise<boolean> }) {
  const [text, setText] = useState(String(p.stockQty));
  useEffect(() => setText(String(p.stockQty)), [p.stockQty]);
  const commit = async () => {
    const t = text.trim();
    if (t === String(p.stockQty)) return;
    const next = Number(t);
    if (t === "" || !Number.isInteger(next) || next < 0 || next > STOCK_MAX) {
      toast.error(`Enter a whole number from 0 to ${STOCK_MAX.toLocaleString("en-IN")}.`);
      setText(String(p.stockQty));
      return;
    }
    if (!(await onCommit(next))) setText(String(p.stockQty));
  };
  return (
    <div className="col-span-3 lg:col-span-1">
      <label className="block max-w-40 lg:max-w-none">
        <span className="eyebrow mb-1 block text-[10px] text-muted-foreground lg:sr-only">Stock</span>
        <input
          className="field h-10 w-full px-2 text-sm tabular-nums" inputMode="numeric" value={text} aria-label={`Stock count for ${p.name}`}
          onChange={(e) => setText(e.target.value.replace(/\D/g, ""))} onBlur={() => void commit()}
          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setText(String(p.stockQty)); e.currentTarget.blur(); } }}
        />
      </label>
      {p.stockStatus === "out" ? <span className="mt-1 inline-block"><Pill tone="bad">Out</Pill></span> : p.stockStatus === "low" ? <span className="mt-1 inline-block"><Pill tone="warn">Low</Pill></span> : null}
    </div>
  );
}

function MoneyCell({ label, value, min, nullable, onCommit }: { label: string; value: number | null; min: number; nullable?: boolean; onCommit: (v: number | null) => Promise<boolean> }) {
  const show = (v: number | null) => (v == null ? "" : String(v));
  const [text, setText] = useState(show(value));
  useEffect(() => setText(show(value)), [value]);
  const commit = async () => {
    const t = text.trim();
    const next = t === "" ? null : Number(t);
    if (next === value) return;
    if ((next === null && !nullable) || (next !== null && (!Number.isInteger(next) || next < min))) {
      toast.error(nullable ? "Enter a whole number of rupees, or leave it empty." : `Enter a whole number of rupees, at least ${min}.`);
      setText(show(value));
      return;
    }
    if (!(await onCommit(next))) setText(show(value));
  };
  return (
    <label className="block">
      <span className="eyebrow mb-1 block text-[10px] text-muted-foreground lg:sr-only">{label}</span>
      <input
        className="field h-10 w-full px-2 text-sm tabular-nums" inputMode="numeric" value={text} placeholder={nullable ? "—" : undefined}
        onChange={(e) => setText(e.target.value.replace(/\D/g, ""))} onBlur={() => void commit()} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setText(show(value)); e.currentTarget.blur(); } }}
      />
    </label>
  );
}
