import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Field, fieldErrors, LoadState, NotAppliedNotice, Section, useLoad } from "@/components/admin/ui";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/discounts")({ component: Discounts });

type Kind = "offer" | "coupon" | "loyalty" | "free_shipping";
type Reply = {
  stackingMode: "best_only" | "stack"; maxTotalDiscountPct: number; kinds: Kind[];
  combinations: { a: Kind; b: Kind; allowed: boolean }[];
};

// Display order. (The server stores each unordered pair once, alphabetically.)
const KINDS: { kind: Kind; label: string; help: string }[] = [
  { kind: "offer", label: "Automatic offer", help: "A percentage or ₹ discount applied without a code." },
  { kind: "coupon", label: "Coupon code", help: "An offer the shopper unlocks by entering a code." },
  { kind: "loyalty", label: "Loyalty points", help: "Points the shopper chooses to redeem." },
  { kind: "free_shipping", label: "Free shipping", help: "Shipping waived by an offer." },
];
const labelOf = (k: Kind) => KINDS.find((x) => x.kind === k)!.label;
const key = (a: Kind, b: Kind) => (a <= b ? `${a}+${b}` : `${b}+${a}`);

function Discounts() {
  const { data, error, reload, setData } = useLoad<Reply>("/admin/discounts");
  return (
    <div className="space-y-8">
      <NotAppliedNotice />
      <LoadState error={error} ready={!!data} reload={() => void reload()}>
        {data && <Rules data={data} onSaved={setData} />}
      </LoadState>
    </div>
  );
}

function Rules({ data, onSaved }: { data: Reply; onSaved: (r: Reply) => void }) {
  const init = (d: Reply) => ({ mode: d.stackingMode, cap: String(d.maxTotalDiscountPct), allowed: Object.fromEntries(d.combinations.map((c) => [key(c.a, c.b), c.allowed])) as Record<string, boolean> });
  const [f, setF] = useState(init(data));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => setF(init(data)), [data]);

  const dirty = JSON.stringify(f) !== JSON.stringify(init(data));
  const stacking = f.mode === "stack";

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true); setErrors({}); setFormError("");
    const combinations = KINDS.flatMap((r, i) => KINDS.slice(0, i + 1).map((c) => {
      const [a, b] = key(r.kind, c.kind).split("+") as [Kind, Kind];
      return { a, b, allowed: !!f.allowed[key(r.kind, c.kind)] };
    }));
    try {
      onSaved(await api<Reply>("/admin/discounts", { method: "PUT", body: { stackingMode: f.mode, maxTotalDiscountPct: Number(f.cap), combinations } }));
      toast.success("Discount rules saved");
    } catch (err) {
      const x = fieldErrors(err);
      setErrors(x.fields); setFormError(x.general);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} noValidate className="space-y-8">
      <Section title="How discounts combine" hint="Decide whether a shopper can use more than one discount on the same order.">
        <fieldset>
          <legend className="sr-only">Stacking mode</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {([
              ["best_only", "Best discount only", "Only the single biggest discount applies to an order. Simple and predictable."],
              ["stack", "Allow combinations", "Discounts can stack, but only the pairs ticked below, and never beyond the cap."],
            ] as const).map(([value, title, text]) => (
              <label key={value} className={cn("flex cursor-pointer items-start gap-3 border p-4 text-sm", f.mode === value ? "border-ink" : "border-hairline")}>
                <input type="radio" name="mode" className="mt-0.5 accent-ink" checked={f.mode === value} onChange={() => { setF((x) => ({ ...x, mode: value })); setFormError(""); }} />
                <span>{title}<span className="mt-1 block text-xs text-muted-foreground">{text}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-6 max-w-xs">
          <Field id="cap" label="Maximum total discount (%)" hint="No order can be discounted by more than this share of its value." error={errors["maxTotalDiscountPct"]}>
            <input id="cap" className="field" inputMode="numeric" value={f.cap} onChange={(e) => { setF((x) => ({ ...x, cap: e.target.value.replace(/\D/g, "") })); setErrors({}); }} aria-invalid={!!errors["maxTotalDiscountPct"]} aria-describedby="cap-err" />
          </Field>
        </div>
      </Section>

      <Section
        title="Which discounts can be combined"
        hint={stacking ? "Tick a box to let those two kinds of discount apply to the same order." : "Not used while “Best discount only” is selected — switch to “Allow combinations” to edit."}
      >
        <div className={cn("overflow-x-auto", !stacking && "opacity-50")}>
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <caption className="sr-only">Which kinds of discount can be combined</caption>
            <thead>
              <tr>
                <td />
                {KINDS.map((c) => <th key={c.kind} scope="col" className="px-3 pb-3 text-left text-xs font-normal text-muted-foreground">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {KINDS.map((r, i) => (
                <tr key={r.kind} className="border-t border-hairline">
                  <th scope="row" className="py-3 pr-4 text-left text-xs font-normal text-muted-foreground">{r.label}</th>
                  {KINDS.map((c, j) => (
                    <td key={c.kind} className="px-3 py-3">
                      {j <= i ? (
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-ink"
                          disabled={!stacking}
                          checked={!!f.allowed[key(r.kind, c.kind)]}
                          onChange={(e) => setF((x) => ({ ...x, allowed: { ...x.allowed, [key(r.kind, c.kind)]: e.target.checked } }))}
                          aria-label={`${labelOf(r.kind)} together with ${labelOf(c.kind)}`}
                        />
                      ) : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="mt-6 grid gap-3 text-xs text-muted-foreground sm:grid-cols-2">
          {KINDS.map((k) => <div key={k.kind}><dt className="text-ink">{k.label}</dt><dd>{k.help}</dd></div>)}
        </dl>
      </Section>

      <div>
        <p className="min-h-5 text-sm text-destructive" role="alert" aria-live="polite">{formError}</p>
        <button type="submit" disabled={saving || !dirty} className="btn-ink mt-2">{saving ? "Saving…" : "Save rules"}</button>
      </div>
    </form>
  );
}
