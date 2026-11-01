import type { ApiOrder } from "@/lib/api";
import { formatINR, productThumb } from "@/lib/catalog";
import { useCatalog } from "@/lib/catalog-live";
import { cn } from "@/lib/utils";

const STATUS: Record<ApiOrder["status"], string> = {
  pending: "Received",
  confirmed: "Confirmed",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled",
};
const PAYMENT: Record<ApiOrder["paymentStatus"], string> = { unpaid: "Payment pending", paid: "Paid", refunded: "Refunded" };

export const formatDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function StatusBadges({ order }: { order: ApiOrder }) {
  return (
    <div className="flex flex-wrap gap-2">
      <span className={cn("border px-2.5 py-1 text-[11px] tracking-[0.12em] uppercase", order.status === "cancelled" ? "border-destructive text-destructive" : "border-ink")}>{STATUS[order.status]}</span>
      {/* Nothing is owed on an order cancelled before payment, so "payment pending" would mislead. */}
      {!(order.status === "cancelled" && order.paymentStatus === "unpaid") && (
        <span className="border border-hairline px-2.5 py-1 text-[11px] tracking-[0.12em] text-muted-foreground uppercase">{PAYMENT[order.paymentStatus]}</span>
      )}
    </div>
  );
}

export function OrderItems({ items }: { items: ApiOrder["items"] }) {
  const { findAny } = useCatalog();
  return (
    <ul className="divide-y divide-hairline">
      {items.map((i) => {
        const p = findAny(i.slug);
        return (
          <li key={`${i.slug}-${i.colour}-${i.size ?? ""}`} className="flex gap-4 py-4">
            <div className="w-16 shrink-0 bg-paper">{p && <img src={productThumb(p)} alt="" className="aspect-[4/5] w-full object-cover" />}</div>
            <div className="flex min-w-0 flex-1 justify-between gap-3">
              <div>
                <p className="text-sm">{i.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">{i.colour}{i.size ? ` · ${i.size} cm` : ""} · Qty {i.qty}</p>
              </div>
              <p className="text-sm tabular-nums">{formatINR(i.unitPrice * i.qty)}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function Totals({ subtotal, shipping, total }: { subtotal: number; shipping: number; total: number }) {
  return (
    <dl className="space-y-2 text-sm">
      <div className="flex justify-between"><dt className="text-muted-foreground">Subtotal</dt><dd className="tabular-nums">{formatINR(subtotal)}</dd></div>
      <div className="flex justify-between"><dt className="text-muted-foreground">Shipping</dt><dd className="tabular-nums">{shipping === 0 ? "Complimentary" : formatINR(shipping)}</dd></div>
      <div className="flex justify-between border-t border-hairline pt-3 text-base"><dt>Total</dt><dd className="tabular-nums">{formatINR(total)}</dd></div>
      <p className="text-xs text-muted-foreground">Taxes included.</p>
    </dl>
  );
}

export function AddressBlock({ a }: { a: ApiOrder["shippingAddress"] }) {
  return (
    <address className="text-sm leading-relaxed not-italic">
      {a.name}<br />
      {a.line1}<br />
      {a.line2 && <>{a.line2}<br /></>}
      {a.city}, {a.state} {a.pincode}<br />
      {a.phone}
    </address>
  );
}
