import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const SLIDE_MS = 700; // keep in step with `duration-700` on the panel below

/**
 * Slide-in panel shared by the bag, wishlist, search, menu, account and filter drawers.
 * While closed it is `inert` (no focus, no clicks, hidden from screen readers) and, once its slide-out
 * finishes, `visibility: hidden` — so the closing animation plays out instead of the panel vanishing.
 */
export function Drawer({ open, side = "right", label, onClose, children, className }: { open: boolean; side?: "right" | "left" | "top"; label: string; onClose: () => void; children: ReactNode; className?: string }) {
  const pos = side === "right" ? "right-0 top-0 h-full w-full max-w-[460px]" : side === "left" ? "left-0 top-0 h-full w-full max-w-[420px]" : "inset-x-0 top-0 max-h-[100dvh]";
  const hidden = side === "right" ? "translate-x-full" : side === "left" ? "-translate-x-full" : "-translate-y-full";
  return (
    <div
      className="fixed inset-0 z-50"
      style={{ visibility: open ? "visible" : "hidden", transition: open ? "none" : `visibility 0s linear ${SLIDE_MS}ms` }}
      aria-hidden={!open}
      inert={!open}
    >
      <div onClick={onClose} className={cn("absolute inset-0 bg-ink/40 transition-opacity duration-500 ease-lux", open ? "opacity-100" : "opacity-0")} />
      <aside role="dialog" aria-modal="true" aria-label={label} className={cn("absolute flex flex-col bg-chalk transition-transform duration-700 ease-lux will-change-transform", pos, open ? "translate-0 shadow-drawer" : hidden, className)}>
        {children}
      </aside>
    </div>
  );
}

export function DrawerHead({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex h-16 shrink-0 items-center justify-between border-b border-hairline px-6">
      <p className="eyebrow">{title}</p>
      <button onClick={onClose} aria-label="Close" className="-mr-2 grid h-10 w-10 place-items-center transition-colors hover:text-oxblood"><X className="h-5 w-5 stroke-[1.3]" /></button>
    </div>
  );
}
