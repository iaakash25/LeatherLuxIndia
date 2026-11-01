import { useCallback, useEffect, useState, type ReactNode } from "react";
import { api, ApiError, errorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";

/** GET a path once on mount; `reload` refetches, `setData` lets a page apply a server reply directly. */
export function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try { setData(await api<T>(path)); setError(""); } catch (e) { setError(errorMessage(e)); }
  }, [path]);
  useEffect(() => { void reload(); }, [reload]);
  return { data, error, reload, setData };
}

/** Field-level messages from a 400 validation reply (keyed by the request field), plus a general one. */
export function fieldErrors(err: unknown): { fields: Record<string, string>; general: string } {
  const fields: Record<string, string> = {};
  if (err instanceof ApiError && err.code === "validation_failed" && err.details?.length) {
    for (const d of err.details) fields[d.path.split(".")[0] ?? ""] ??= d.message;
    return { fields, general: "Please fix the highlighted fields." };
  }
  return { fields, general: errorMessage(err) };
}

export function Section({ title, hint, action, children }: { title: string; hint?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border border-hairline p-6 lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl">
          <h2 className="eyebrow">{title}</h2>
          {hint && <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      <div className="mt-6">{children}</div>
    </section>
  );
}

export function Field({ id, label, hint, error, children, className }: { id: string; label: string; hint?: ReactNode; error?: string | undefined; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="eyebrow text-muted-foreground">{label}</label>
      <div className="mt-2">{children}</div>
      {hint && !error && <p className="mt-1.5 text-xs text-muted-foreground">{hint}</p>}
      <p id={`${id}-err`} className={cn("text-xs text-destructive", error ? "mt-1.5" : "hidden")} aria-live="polite">{error}</p>
    </div>
  );
}

export function Check({ id, checked, onChange, label, hint, disabled }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  return (
    <label htmlFor={id} className={cn("flex items-start gap-3 text-sm", disabled ? "opacity-50" : "cursor-pointer")}>
      <input id={id} type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-ink" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}{hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}</span>
    </label>
  );
}

const TONES = {
  live: "border-ink text-ink",
  muted: "border-hairline text-muted-foreground",
  warn: "border-brass text-brass",
  bad: "border-destructive text-destructive",
} as const;
export function Pill({ tone = "muted", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={cn("inline-block border px-2 py-0.5 text-[10px] tracking-[0.12em] uppercase", TONES[tone])}>{children}</span>;
}

/** Said on every page that edits pricing rules: the settings are stored, but checkout doesn't use them yet. */
export function NotAppliedNotice() {
  return (
    <p className="border border-hairline bg-paper px-4 py-3 text-xs leading-relaxed text-muted-foreground">
      These settings are saved for the store, but they are not applied to orders at checkout yet — that comes in a later step.
    </p>
  );
}

export function LoadState({ error, ready, reload, children }: { error: string; ready: boolean; reload: () => void; children: ReactNode }) {
  if (error) return <p className="text-sm text-destructive" role="alert">{error} <button className="underline underline-offset-4" onClick={reload}>Retry</button></p>;
  if (!ready) return <p className="text-sm text-muted-foreground" role="status">Loading…</p>;
  return <>{children}</>;
}

/** An ISO timestamp as the value of a <input type="datetime-local"> (in the admin's own time zone). */
export function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export const fromLocalInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);

/** "" → null, otherwise the number (NaN is passed through so the server rejects it). */
export const numOrNull = (v: string): number | null => (v.trim() === "" ? null : Number(v));
