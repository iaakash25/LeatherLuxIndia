import { Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useCountUp } from "@/hooks/use-count-up";
import { api, apiEnabled } from "@/lib/api";
import { cn } from "@/lib/utils";

const ID_KEY = "llx-visitor-id";
const SENT_KEY = "llx-visit-sent";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A random id this browser makes up for itself and keeps. null when storage is blocked (then we only read the total). */
function browserId(): string | null {
  try {
    let id = localStorage.getItem(ID_KEY);
    if (!id || !UUID.test(id)) {
      id = crypto.randomUUID();
      localStorage.setItem(ID_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

let inflight: Promise<number | null> | null = null;
/** Registers this browser (once per tab session) and returns the total. One shared request, however many times it is asked. */
function report(): Promise<number | null> {
  inflight ??= (async () => {
    try {
      const id = browserId();
      let alreadySent = false;
      try { alreadySent = sessionStorage.getItem(SENT_KEY) === "1"; } catch { /* storage blocked */ }
      const counting = !!id && !alreadySent;
      const r = counting
        ? await api<{ total: number }>("/visits", { method: "POST", body: { visitorId: id } })
        : await api<{ total: number }>("/visits");
      if (counting) { try { sessionStorage.setItem(SENT_KEY, "1"); } catch { /* storage blocked */ } }
      return r.total;
    } catch {
      return null; // counter unavailable: show nothing rather than a wrong number
    }
  })().finally(() => { inflight = null; });
  return inflight;
}

/**
 * "Total visitors" for the footer. Each browser is counted once (the server stores only a hash of its id and
 * honours Do Not Track); a repeat visit in the same tab session doesn't even call the server to count again.
 */
export function VisitorCount() {
  const [total, setTotal] = useState<number | null>(null);
  const [inView, setInView] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (!apiEnabled) return;
    let cancelled = false;
    report().then((n) => { if (!cancelled && n !== null) setTotal(n); });
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

  const shown = useCountUp(total, inView);
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
