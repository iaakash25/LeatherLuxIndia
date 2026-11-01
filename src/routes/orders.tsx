import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AccountGate } from "@/components/site/AccountGate";
import { AddressBlock, formatDate, OrderItems, StatusBadges, Totals } from "@/components/site/OrderParts";
import { api, errorMessage, type ApiOrder } from "@/lib/api";
import { brandFromMatches, brandTitle } from "@/lib/brand";

export const Route = createFileRoute("/orders")({
  head: ({ matches }) => ({ meta: [{ title: `Your orders — ${brandTitle(brandFromMatches(matches))}` }, { name: "robots", content: "noindex" }] }),
  component: () => <AccountGate title="Your orders">{() => <Orders />}</AccountGate>,
});

function Orders() {
  const [orders, setOrders] = useState<ApiOrder[] | null>(null);
  const [err, setErr] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = () => api<{ orders: ApiOrder[] }>("/orders?limit=50").then((r) => { setOrders(r.orders); setErr(""); }).catch((e) => setErr(errorMessage(e)));
  useEffect(() => { void load(); }, []);

  const cancel = async (id: string) => {
    setCancelling(id);
    try {
      const { order } = await api<{ order: ApiOrder }>(`/orders/${id}/cancel`, { method: "POST" });
      setOrders((list) => list?.map((o) => (o.id === id ? order : o)) ?? null);
      toast("Order cancelled", { description: order.orderNumber });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setCancelling(null);
      setConfirming(null);
    }
  };

  return (
    <div className="mx-auto max-w-[1100px] px-5 py-12 lg:px-10 lg:py-20">
      <p className="eyebrow text-muted-foreground">Account</p>
      <h1 className="font-display mt-3 text-4xl lg:text-6xl">Your orders</h1>

      {err ? (
        <p className="mt-10 text-sm text-destructive" role="alert">{err} <button className="underline underline-offset-4" onClick={() => void load()}>Retry</button></p>
      ) : orders === null ? (
        <p className="mt-10 text-sm text-muted-foreground" role="status">Loading…</p>
      ) : orders.length === 0 ? (
        <div className="mt-10">
          <p className="text-sm text-muted-foreground">You haven't placed an order yet.</p>
          <Link to="/collections/$slug" params={{ slug: "all" }} className="btn-ink mt-8">Explore the collection</Link>
        </div>
      ) : (
        <ul className="mt-10 space-y-8">
          {orders.map((o) => (
            <li key={o.id} className="border border-hairline p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm tabular-nums">{o.orderNumber}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Placed {formatDate(o.createdAt)}</p>
                </div>
                <StatusBadges order={o} />
              </div>
              <div className="mt-4"><OrderItems items={o.items} /></div>
              <div className="mt-4 grid gap-8 border-t border-hairline pt-5 sm:grid-cols-[1fr_280px]">
                <div>
                  <p className="eyebrow text-muted-foreground">Delivering to</p>
                  <div className="mt-3"><AddressBlock a={o.shippingAddress} /></div>
                </div>
                <Totals subtotal={o.subtotal} shipping={o.shipping} total={o.total} />
              </div>
              {(o.status === "pending" || o.status === "confirmed") && (
                <div className="mt-5 flex items-center gap-4 text-xs">
                  {confirming === o.id ? (
                    <>
                      <span className="text-muted-foreground">Cancel this order?</span>
                      <button disabled={cancelling === o.id} onClick={() => void cancel(o.id)} className="underline underline-offset-4 hover:text-oxblood disabled:opacity-50">{cancelling === o.id ? "Cancelling…" : "Yes, cancel"}</button>
                      <button onClick={() => setConfirming(null)} className="text-muted-foreground underline underline-offset-4">Keep order</button>
                    </>
                  ) : (
                    <button onClick={() => setConfirming(o.id)} className="text-muted-foreground underline underline-offset-4 hover:text-oxblood">Cancel order</button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
