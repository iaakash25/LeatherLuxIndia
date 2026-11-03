import { Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useCountUp } from "@/hooks/use-count-up";
import { api, apiEnabled } from "@/lib/api";
import { cn } from "@/lib/utils";

/** The total this browser last saw, so a refresh visibly ticks up from it. (Only a number: nothing that identifies the visitor.) */
const SEEN_KEY = "llx-visitors-seen";
const readSeen = (): number | null => {
  try { const n = Number(localStorage.getItem(SEEN_KEY)); return Number.isInteger(n) && n > 0 ? n : null; } catch { return null; }
};

let counted: Promise<number | null> | undefined;
/**
 * Counts this page load and returns the new total. Every load and every refresh counts once: the answer is kept for the life of the page, so
 * the footer mounting twice (React's development double-run) or the visitor moving between pages without reloading does not count again.
 */
function report(): Promise<number | null> {
  counted ??= api<{ total: number }>("/visits", { method: "POST" })
    .then((r) => r.total)
    .catch(() => null); // counter unavailable: show nothing rather than a wrong number
  return counted;
}

/** "Total visitors" for the footer. It goes up by one every time a page is loaded or refreshed. */
export function VisitorCount() {
  const [total, setTotal] = useState<number | null>(null);
  const [from, setFrom] = useState(0);
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!apiEnabled) return;
    let cancelled = false;
    const seen = readSeen();
    report().then((n) => {
      if (cancelled || n === null) return;
      // Count up from what this browser saw last time; the first time (or after a reset) from one below, so the +1 is still shown.
      setFrom(seen !== null && seen < n ? seen : Math.max(0, n - 1));
      setTotal(n);
      try { localStorage.setItem(SEEN_KEY, String(n)); } catch { /* storage blocked */ }
    });
    return () => { cancelled = true; };
  }, []);

  // Start the count-up when the footer actually scrolls into view, not while it is off-screen.
  useEffect(() => {
    const el = ref.current;
    if (!el || total === null) return;
    const io = new IntersectionObserver(([e]) => { if (e?.isIntersecting) { setInView(true); io.disconnect(); } }, { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
  }, [total]);

  const shown = useCountUp(total, inView, 1400, from);
  if (!apiEnabled) return null;
  const fmt = (n: number) => n.toLocaleString("en-IN");

  return (
    <p ref={ref} className={cn("flex items-center gap-2 transition-opacity duration-700 ease-lux", total === null ? "opacity-0" : "opacity-100")} aria-live="polite">
      <Users className="h-3.5 w-3.5 stroke-[1.3]" aria-hidden="true" />
      <span>Total visitors</span>
      {/* The final number sizes the box (invisible), so the digits can count up without the layout moving. */}
      <span className="relative inline-block text-chalk/80 tabular-nums">
        <span className="invisible">{fmt(total ?? 0)}</span>
        <span className="absolute inset-0 text-right" aria-hidden="true">{fmt(shown)}</span>
        <span className="sr-only">{total === null ? "" : fmt(total)}</span>
      </span>
    </p>
  );
}
