import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { AccountGate } from "@/components/site/AccountGate";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { brandFromMatches, brandTitle } from "@/lib/brand";

export const Route = createFileRoute("/admin")({
  head: ({ matches }) => ({ meta: [{ title: `Admin console — ${brandTitle(brandFromMatches(matches))}` }, { name: "robots", content: "noindex" }] }),
  component: AdminLayout,
});

const TABS = [
  { to: "/admin/inventory", label: "Inventory" },
  { to: "/admin/branding", label: "Branding" },
  { to: "/admin/offers", label: "Offers" },
  { to: "/admin/loyalty", label: "Loyalty" },
  { to: "/admin/discounts", label: "Discount rules" },
] as const;

function AdminLayout() {
  // The inventory table has columns to fit; the settings pages read better narrow.
  const wide = useRouterState({ select: (s) => s.location.pathname.startsWith("/admin/inventory") });
  return (
    <AccountGate title="Admin console" signInOnly>
      {(user) =>
        user.role !== "admin" ? (
          <div className="mx-auto max-w-[1600px] px-5 py-16 lg:px-10 lg:py-24">
            <h1 className="font-display text-4xl lg:text-6xl">Admin console</h1>
            <p className="mt-6 max-w-md text-sm text-muted-foreground">Your account doesn't have access to this area.</p>
            <Link to="/" className="btn-outline mt-8">Back to the store</Link>
          </div>
        ) : user.mustChangePassword ? (
          <PasswordChangeRequired />
        ) : (
          <div className={cn("mx-auto px-5 py-12 lg:px-10 lg:py-20", wide ? "max-w-[1500px]" : "max-w-[1100px]")}>
            <p className="eyebrow text-muted-foreground">Admin console</p>
            <h1 className="font-display mt-3 text-4xl lg:text-6xl">Store settings</h1>
            <nav aria-label="Admin sections" className="mt-8 flex flex-wrap gap-x-8 gap-y-2 border-b border-hairline">
              {TABS.map((t) => (
                <Link
                  key={t.to}
                  to={t.to}
                  className="-mb-px border-b border-transparent pb-3 text-sm text-muted-foreground hover:text-ink"
                  activeProps={{ className: "-mb-px border-b border-ink pb-3 text-sm text-ink", "aria-current": "page" }}
                >
                  {t.label}
                </Link>
              ))}
            </nav>
            <div className="mt-10"><Outlet /></div>
          </div>
        )
      }
    </AccountGate>
  );
}

/** A new admin signs in with the shared default password; the console stays locked until they replace it. */
function PasswordChangeRequired() {
  const { setPanel } = useStore();
  return (
    <div className="mx-auto max-w-[1600px] px-5 py-16 lg:px-10 lg:py-24">
      <h1 className="font-display text-4xl lg:text-6xl">Admin console</h1>
      <p className="mt-6 max-w-md text-sm leading-relaxed text-muted-foreground">You're signed in with the default password. Choose your own to unlock the admin console.</p>
      <button className="btn-ink mt-8" onClick={() => setPanel("account")}>Choose a new password</button>
    </div>
  );
}
