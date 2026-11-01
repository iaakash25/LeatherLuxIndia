import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Field, fieldErrors, LoadState, NotAppliedNotice, numOrNull, Section, useLoad } from "@/components/admin/ui";
import { api, errorMessage } from "@/lib/api";
import { formatINR } from "@/lib/catalog";

export const Route = createFileRoute("/admin/loyalty")({ component: Loyalty });

type Settings = {
  enabled: boolean; earnPointsPer100Inr: number; redeemInrPer100Points: number; minPointsToRedeem: number;
  maxRedeemPctOfOrder: number; pointsExpiryDays: number | null; signupBonusPoints: number;
};
type Tier = { id: string; name: string; minLifetimeSpendInr: number; earnMultiplierPct: number; perks: string };
type Reply = { settings: Settings; tiers: Tier[] };

function Loyalty() {
  const { data, error, reload, setData } = useLoad<Reply>("/admin/loyalty");
  return (
    <div className="space-y-8">
      <NotAppliedNotice />
      <LoadState error={error} ready={!!data} reload={() => void reload()}>
        {data && (
          <>
            <SettingsForm settings={data.settings} onSaved={(r) => setData(r)} />
            <Tiers tiers={data.tiers} onChanged={() => void reload()} />
          </>
        )}
      </LoadState>
    </div>
  );
}

function SettingsForm({ settings, onSaved }: { settings: Settings; onSaved: (r: Reply) => void }) {
  const init = (s: Settings) => ({
    enabled: s.enabled, earn: String(s.earnPointsPer100Inr), redeem: String(s.redeemInrPer100Points), min: String(s.minPointsToRedeem),
    maxPct: String(s.maxRedeemPctOfOrder), expiry: s.pointsExpiryDays ? String(s.pointsExpiryDays) : "", bonus: String(s.signupBonusPoints),
  });
  const [f, setF] = useState(init(settings));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => setF(init(settings)), [settings]);

  const dirty = JSON.stringify(f) !== JSON.stringify(init(settings));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setErrors((e) => ({ ...e, [k]: "" })); setFormError(""); };
  const digits = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => set(k, e.target.value.replace(/\D/g, "") as never);

  const earn = Number(f.earn) || 0;
  const redeem = Number(f.redeem) || 0;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true); setErrors({}); setFormError("");
    try {
      const r = await api<Reply>("/admin/loyalty", {
        method: "PUT",
        body: {
          enabled: f.enabled, earnPointsPer100Inr: Number(f.earn), redeemInrPer100Points: Number(f.redeem), minPointsToRedeem: Number(f.min),
          maxRedeemPctOfOrder: Number(f.maxPct), pointsExpiryDays: numOrNull(f.expiry), signupBonusPoints: Number(f.bonus),
        },
      });
      onSaved(r);
      toast.success("Loyalty settings saved");
    } catch (err) {
      const x = fieldErrors(err);
      setErrors(x.fields); setFormError(x.general);
    } finally {
      setSaving(false);
    }
  };

  const num = (k: keyof typeof f, apiKey: string, label: string, hint?: string) => (
    <Field id={k} label={label} hint={hint} error={errors[k] ?? errors[apiKey]}>
      <input id={k} className="field" inputMode="numeric" value={String(f[k])} onChange={digits(k)} aria-invalid={!!(errors[k] ?? errors[apiKey])} aria-describedby={`${k}-err`} />
    </Field>
  );

  return (
    <Section title="Loyalty programme" hint="Points shoppers earn on what they spend, and what those points are worth when redeemed.">
      <form onSubmit={save} noValidate>
        <Check id="enabled" checked={f.enabled} onChange={(v) => set("enabled", v)} label="Programme enabled" hint="When off, no points are earned or redeemed." />
        <div className="mt-6 grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {num("earn", "earnPointsPer100Inr", "Points earned per ₹100 spent")}
          {num("redeem", "redeemInrPer100Points", "Value of 100 points (₹)")}
          {num("min", "minPointsToRedeem", "Minimum points to redeem")}
          {num("maxPct", "maxRedeemPctOfOrder", "Max share of an order payable with points (%)")}
          {num("expiry", "pointsExpiryDays", "Points expire after (days, optional)", "Empty means points never expire.")}
          {num("bonus", "signupBonusPoints", "Sign-up bonus (points)")}
        </div>

        <p className="mt-4 border border-hairline bg-paper px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          Example: a {formatINR(1000)} order earns <span className="text-ink">{earn * 10} points</span>; 100 points are worth <span className="text-ink">{formatINR(redeem)}</span>
          {earn > 0 && redeem > 0 && <>, so you give back about <span className="text-ink">{((earn * redeem) / 100).toFixed(2).replace(/\.?0+$/, "")}%</span> of spend as points</>}.
        </p>

        <p className="mt-4 min-h-5 text-sm text-destructive" role="alert" aria-live="polite">{formError}</p>
        <button type="submit" disabled={saving || !dirty} className="btn-ink mt-2">{saving ? "Saving…" : "Save settings"}</button>
      </form>
    </Section>
  );
}

function Tiers({ tiers, onChanged }: { tiers: Tier[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<Tier | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const remove = async (t: Tier) => {
    try { await api(`/admin/loyalty/tiers/${t.id}`, { method: "DELETE" }); toast("Tier deleted", { description: t.name }); onChanged(); }
    catch (e) { toast.error(errorMessage(e)); }
    finally { setConfirmDelete(null); }
  };

  return (
    <Section
      title="Tiers"
      hint="Shoppers move up a tier as their lifetime spend grows, and earn points faster. 100% is the normal rate; 150% earns one and a half times as many points."
      action={editing ? null : <button className="btn-ink" onClick={() => setEditing("new")}>Add tier</button>}
    >
      {editing && (
        <TierForm
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChanged(); }}
        />
      )}
      {tiers.length === 0 && !editing ? (
        <p className="text-sm text-muted-foreground">No tiers yet — every shopper earns at the normal rate.</p>
      ) : (
        <ul className="divide-y divide-hairline">
          {tiers.map((t) => (
            <li key={t.id} className="flex flex-wrap items-start justify-between gap-4 py-4">
              <div>
                <p className="text-sm">{t.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  From {formatINR(t.minLifetimeSpendInr)} lifetime spend · {t.earnMultiplierPct}% points rate{t.perks && ` · ${t.perks}`}
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs">
                {confirmDelete === t.id ? (
                  <>
                    <span className="text-muted-foreground">Delete this tier?</span>
                    <button onClick={() => void remove(t)} className="underline underline-offset-4 hover:text-oxblood">Yes, delete</button>
                    <button onClick={() => setConfirmDelete(null)} className="text-muted-foreground underline underline-offset-4">Keep</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => setEditing(t)} className="underline underline-offset-4 hover:text-oxblood">Edit</button>
                    <button onClick={() => setConfirmDelete(t.id)} className="text-muted-foreground underline underline-offset-4 hover:text-oxblood">Delete</button>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function TierForm({ initial, onCancel, onSaved }: { initial: Tier | null; onCancel: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    name: initial?.name ?? "", spend: initial ? String(initial.minLifetimeSpendInr) : "0",
    mult: initial ? String(initial.earnMultiplierPct) : "100", perks: initial?.perks ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof f, v: string) => { setF((x) => ({ ...x, [k]: v })); setErrors({}); setFormError(""); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true); setErrors({}); setFormError("");
    const body = { name: f.name, minLifetimeSpendInr: Number(f.spend), earnMultiplierPct: Number(f.mult), perks: f.perks };
    try {
      if (initial) await api(`/admin/loyalty/tiers/${initial.id}`, { method: "PUT", body });
      else await api("/admin/loyalty/tiers", { method: "POST", body });
      toast.success(initial ? "Tier saved" : "Tier added", { description: f.name });
      onSaved();
    } catch (err) {
      const x = fieldErrors(err);
      setErrors(x.fields); setFormError(x.general);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="mb-6 border border-ink p-6" aria-label={initial ? "Edit tier" : "New tier"}>
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-3">
        <Field id="tier-name" label="Name" error={errors["name"]}>
          <input id="tier-name" className="field" maxLength={40} value={f.name} onChange={(e) => set("name", e.target.value)} aria-invalid={!!errors["name"]} aria-describedby="tier-name-err" />
        </Field>
        <Field id="tier-spend" label="From lifetime spend (₹)" error={errors["minLifetimeSpendInr"]}>
          <input id="tier-spend" className="field" inputMode="numeric" value={f.spend} onChange={(e) => set("spend", e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field id="tier-mult" label="Points rate (%)" hint="100 = normal." error={errors["earnMultiplierPct"]}>
          <input id="tier-mult" className="field" inputMode="numeric" value={f.mult} onChange={(e) => set("mult", e.target.value.replace(/\D/g, ""))} />
        </Field>
        <Field id="tier-perks" label="Perks (optional)" className="sm:col-span-3" error={errors["perks"]}>
          <input id="tier-perks" className="field" maxLength={300} value={f.perks} onChange={(e) => set("perks", e.target.value)} />
        </Field>
      </div>
      <p className="mt-3 min-h-5 text-sm text-destructive" role="alert" aria-live="polite">{formError}</p>
      <div className="mt-2 flex gap-3">
        <button type="submit" disabled={saving} className="btn-ink">{saving ? "Saving…" : initial ? "Save tier" : "Add tier"}</button>
        <button type="button" onClick={onCancel} className="btn-outline">Cancel</button>
      </div>
    </form>
  );
}
