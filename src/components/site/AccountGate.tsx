import type { ReactNode } from "react";
import { apiEnabled, type ApiUser } from "@/lib/api";
import { useStore } from "@/lib/store";

/** Renders `children` only for a signed-in shopper; otherwise explains why and offers to sign in. */
export function AccountGate({ title, signInOnly = false, children }: { title: string; /** No "create an account" option (admin area). */ signInOnly?: boolean; children: (user: ApiUser) => ReactNode }) {
  const { user, authReady, setPanel, promptSignIn } = useStore();

  let body: ReactNode;
  if (!authReady) {
    body = <p className="mt-6 text-sm text-muted-foreground" role="status">Loading…</p>;
  } else if (!apiEnabled) {
    body = <p className="mt-6 max-w-md text-sm text-muted-foreground">The store server isn't connected to this site yet, so accounts and orders are unavailable.</p>;
  } else if (!user) {
    body = (
      <div className="mt-6">
        <p className="max-w-md text-sm text-muted-foreground">
          {signInOnly ? "Admin accounts are added by the site owner. Sign in with yours to continue." : "Please sign in to continue. Anything already in your bag will be kept."}
        </p>
        {signInOnly
          ? <button className="btn-ink mt-8" onClick={() => promptSignIn(undefined, { signInOnly: true })}>Sign in</button>
          : <button className="btn-ink mt-8" onClick={() => setPanel("account")}>Sign in or create account</button>}
      </div>
    );
  } else {
    return <>{children(user)}</>;
  }

  return (
    <div className="mx-auto max-w-[1600px] px-5 py-16 lg:px-10 lg:py-24">
      <h1 className="font-display text-4xl lg:text-6xl">{title}</h1>
      {body}
    </div>
  );
}
