import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type ElementType } from "react";
import { cn } from "@/lib/utils";

// One observer shared by every <Reveal> (dozens per page) instead of one each.
const waiting = new WeakMap<Element, () => void>();
let shared: IntersectionObserver | null = null;
function reveal(el: Element, show: () => void): () => void {
  shared ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const show = waiting.get(e.target);
        waiting.delete(e.target);
        shared?.unobserve(e.target);
        show?.();
      }
    },
    { rootMargin: "0px 0px -8% 0px" },
  );
  waiting.set(el, show);
  shared.observe(el);
  return () => { waiting.delete(el); shared?.unobserve(el); };
}

export function Reveal({ children, className, delay = 0, as: Tag = "div" }: { children: ReactNode; className?: string; delay?: number; as?: ElementType }) {
  const ref = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    return el ? reveal(el, () => setVisible(true)) : undefined;
  }, []);
  return (
    <Tag ref={ref} className={cn("reveal", visible && "is-visible", className)} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </Tag>
  );
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Image that fades in once it has loaded, instead of popping in mid-decode. Images already on screen when the
 * page hydrates (server-rendered or cached) are left alone, so nothing flashes; a broken source falls back to a block.
 */
export function Img({ src, alt, className, eager, ...rest }: { src: string; alt: string; className?: string; eager?: boolean; width?: number; height?: number }) {
  const ref = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<"ready" | "loading" | "loaded" | "failed">("ready");
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setState(!el.complete ? "loading" : el.naturalWidth === 0 ? "failed" : "ready");
  }, [src]);
  if (state === "failed") return <div role="img" aria-label={alt} className={cn("bg-muted flex items-center justify-center", className)}><span className="font-display text-2xl text-muted-foreground italic">LLI</span></div>;
  return (
    <img
      ref={ref}
      src={src}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onLoad={() => setState((s) => (s === "loading" ? "loaded" : s))}
      onError={() => setState("failed")}
      className={cn(className, state === "loading" && "opacity-0", state === "loaded" && "anim-img-in")}
      {...rest}
    />
  );
}
