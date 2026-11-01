import { useNavigate } from "@tanstack/react-router";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { api, apiEnabled, ApiError, errorMessage, type ApiCart, type ApiCartItem, type ApiUser, type ApiWishlist } from "./api";
import { useCatalog } from "./catalog-live";

export type CartLine = {
  /** Server id; only present for lines that live in a signed-in user's bag. */
  id?: string | undefined;
  slug: string;
  colour: string;
  size?: string | undefined;
  qty: number;
  /** Price the server will charge, when known. */
  unitPrice?: number | undefined;
};
type Panel = null | "cart" | "search" | "menu" | "wishlist" | "account";

type Store = {
  cart: CartLine[];
  wishlist: string[];
  panel: Panel;
  setPanel: (p: Panel) => void;
  /** Opens the sign-in drawer; once the shopper signs in or up they are taken to `next`. */
  /** `signInOnly` hides the "create an account" option (used by the admin console, whose accounts are added by hand). */
  promptSignIn: (next?: "/checkout", opts?: { signInOnly?: boolean }) => void;
  signInOnly: boolean;
  /** Resolves true once the piece is in the bag (server-confirmed when signed in). */
  addToCart: (line: Pick<CartLine, "slug" | "colour" | "size">, qty?: number, open?: boolean) => Promise<boolean>;
  setQty: (i: number, qty: number) => void;
  removeLine: (i: number) => void;
  toggleWish: (slug: string) => void;
  count: number;
  subtotal: number;
  /** Signed-in shopper, or null for a guest (guests keep their bag in localStorage). */
  user: ApiUser | null;
  /** False until the first session check finishes. */
  authReady: boolean;
  /** `identifier` is an email address or a username. */
  signIn: (identifier: string, password: string) => Promise<ApiUser>;
  signUp: (name: string, email: string, password: string) => Promise<ApiUser>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  signOut: (everywhere?: boolean) => Promise<void>;
  /** Re-read the signed-in shopper's bag from the server (e.g. after an order empties it). */
  refreshBag: () => Promise<void>;
};

const Ctx = createContext<Store | null>(null);
const CART_KEY = "llx-demo-cart";
const WISH_KEY = "llx-demo-wishlist";

const toLine = (i: ApiCartItem): CartLine => ({ id: i.id, slug: i.slug, colour: i.colour, size: i.size, qty: i.qty, unitPrice: i.unitPrice });
const clampQty = (q: number) => Math.max(1, Math.min(10, q));

function readGuest(): { cart: CartLine[]; wishlist: string[] } {
  try {
    const cart = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    const wishlist = JSON.parse(localStorage.getItem(WISH_KEY) || "[]");
    return { cart: Array.isArray(cart) ? cart : [], wishlist: Array.isArray(wishlist) ? wishlist : [] };
  } catch { return { cart: [], wishlist: [] }; /* ignore corrupt guest data */ }
}
function clearGuest() {
  try { localStorage.removeItem(CART_KEY); localStorage.removeItem(WISH_KEY); } catch { /* storage unavailable */ }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [wishlist, setWishlist] = useState<string[]>([]);
  const [panel, setPanelState] = useState<Panel>(null);
  const navigate = useNavigate();
  // Where to go after the next successful sign-in (set by promptSignIn, dropped by any other panel change).
  const nextRef = useRef<"/checkout" | null>(null);
  const [signInOnly, setSignInOnly] = useState(false);
  const setPanel = useCallback((p: Panel) => { nextRef.current = null; setSignInOnly(false); setPanelState(p); }, []);
  const promptSignIn = useCallback((next?: "/checkout", opts?: { signInOnly?: boolean }) => {
    nextRef.current = next ?? null;
    setSignInOnly(!!opts?.signInOnly);
    setPanelState("account");
  }, []);
  const [loaded, setLoaded] = useState(false);
  const [user, setUser] = useState<ApiUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const { getProduct } = useCatalog();
  // Each bag mutation takes a number; only the newest one may apply the server's reply, so two quick
  // clicks can't be overwritten by the older (slower) response.
  const cartSeq = useRef(0);

  /** Signed in: the server owns the bag and wishlist. Pull them, merging in anything saved as a guest. */
  const adopt = useCallback(async (u: ApiUser, guest: { cart: CartLine[]; wishlist: string[] }) => {
    setUser(u);
    try {
      const [c, w] = await Promise.all([
        guest.cart.length
          ? api<ApiCart>("/cart/merge", { method: "POST", body: { items: guest.cart.map(({ slug, colour, size, qty }) => ({ slug, colour, size, qty })) } })
          : api<ApiCart>("/cart"),
        guest.wishlist.length
          ? api<ApiWishlist>("/wishlist/merge", { method: "POST", body: { slugs: guest.wishlist } })
          : api<ApiWishlist>("/wishlist"),
      ]);
      setCart(c.items.map(toLine));
      setWishlist(w.slugs);
      clearGuest();
      if (c.skipped?.length) toast("Some pieces in your bag are no longer available and were left out.");
    } catch (err) {
      toast.error(errorMessage(err), { description: "We couldn't load your saved bag and wishlist." });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const guest = readGuest();
    setCart(guest.cart);
    setWishlist(guest.wishlist);
    (async () => {
      if (apiEnabled) {
        try {
          const { user: u } = await api<{ user: ApiUser }>("/auth/me");
          if (!cancelled) await adopt(u, guest);
        } catch { /* no session, or the server is unreachable: carry on as a guest */ }
      }
      if (!cancelled) { setLoaded(true); setAuthReady(true); }
    })();
    return () => { cancelled = true; };
  }, [adopt]);

  // Guests persist locally. Signed-in shoppers don't: their data lives on the server, not on this device.
  useEffect(() => { if (loaded && !user) try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch { /* storage unavailable */ } }, [cart, loaded, user]);
  useEffect(() => { if (loaded && !user) try { localStorage.setItem(WISH_KEY, JSON.stringify(wishlist)); } catch { /* storage unavailable */ } }, [wishlist, loaded, user]);

  useEffect(() => {
    document.body.style.overflow = panel ? "hidden" : "";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPanel(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel]);

  const endSession = useCallback(() => { setUser(null); setCart([]); setWishlist([]); }, []);

  /** Shows a server error. A 401 here means the session could not be renewed. */
  const fail = useCallback((err: unknown) => {
    if (err instanceof ApiError && err.status === 401) { endSession(); toast.error("Your session has expired", { description: "Please sign in again." }); return; }
    toast.error(errorMessage(err));
  }, [endSession]);

  /** After a failed optimistic update, put the screen back in step with the server. */
  const resync = useCallback(async () => {
    try {
      const [c, w] = await Promise.all([api<ApiCart>("/cart"), api<ApiWishlist>("/wishlist")]);
      setCart(c.items.map(toLine));
      setWishlist(w.slugs);
    } catch { /* the original error has already been shown */ }
  }, []);

  const addToCart = useCallback(async (line: Pick<CartLine, "slug" | "colour" | "size">, qty = 1, open = true): Promise<boolean> => {
    const p = getProduct(line.slug);
    if (!p) { toast.error("This piece is no longer available"); return false; }
    if (p.stock === "out") { toast.error("This piece is currently unavailable"); return false; }
    const done = () => {
      toast.success(`${p.name} added to bag`, { description: `${line.colour}${line.size ? ` · ${line.size} cm` : ""} · Qty ${qty}` });
      if (open) setPanel("cart");
    };
    if (user) {
      const mine = ++cartSeq.current;
      try {
        const c = await api<ApiCart>("/cart/items", { method: "POST", body: { slug: line.slug, colour: line.colour, size: line.size, qty } });
        if (mine === cartSeq.current) setCart(c.items.map(toLine));
        done();
        return true;
      } catch (err) {
        fail(err);
        return false;
      }
    }
    setCart((c) => {
      const i = c.findIndex((l) => l.slug === line.slug && l.colour === line.colour && l.size === line.size);
      if (i >= 0) return c.map((l, j) => (j === i ? { ...l, qty: clampQty(l.qty + qty) } : l));
      return [...c, { slug: line.slug, colour: line.colour, size: line.size, qty }];
    });
    done();
    return true;
  }, [user, fail, getProduct]);

  const setQty = useCallback((i: number, qty: number) => {
    const next = clampQty(qty);
    const line = cart[i];
    setCart((c) => c.map((l, j) => (j === i ? { ...l, qty: next } : l)));
    if (user && line?.id) {
      const mine = ++cartSeq.current;
      api<ApiCart>(`/cart/items/${line.id}`, { method: "PATCH", body: { qty: next } })
        .then((c) => { if (mine === cartSeq.current) setCart(c.items.map(toLine)); })
        .catch((err) => { fail(err); void resync(); });
    }
  }, [cart, user, fail, resync]);

  const removeLine = useCallback((i: number) => {
    const line = cart[i];
    setCart((c) => c.filter((_, j) => j !== i));
    if (user && line?.id) {
      const mine = ++cartSeq.current;
      api<ApiCart>(`/cart/items/${line.id}`, { method: "DELETE" })
        .then((c) => { if (mine === cartSeq.current) setCart(c.items.map(toLine)); })
        .catch((err) => { fail(err); void resync(); });
    }
  }, [cart, user, fail, resync]);

  const toggleWish = useCallback((slug: string) => {
    const has = wishlist.includes(slug);
    const name = getProduct(slug)?.name ?? "Item";
    setWishlist((w) => (has ? w.filter((s) => s !== slug) : [...w, slug]));
    toast(has ? `${name} removed from wishlist` : `${name} saved to wishlist`);
    if (user) {
      api<ApiWishlist>(`/wishlist/${encodeURIComponent(slug)}`, { method: has ? "DELETE" : "PUT" })
        .then((w) => setWishlist(w.slugs))
        .catch((err) => { fail(err); void resync(); });
    }
  }, [wishlist, user, fail, resync, getProduct]);

  const refreshBag = useCallback(async () => {
    if (!user) return;
    try { setCart((await api<ApiCart>("/cart")).items.map(toLine)); } catch (err) { fail(err); }
  }, [user, fail]);

  const continueAfterAuth = useCallback(() => {
    const next = nextRef.current;
    nextRef.current = null;
    if (next) void navigate({ to: next });
  }, [navigate]);

  const signIn = useCallback(async (identifier: string, password: string) => {
    const { user: u } = await api<{ user: ApiUser }>("/auth/login", { method: "POST", body: { identifier, password } });
    await adopt(u, { cart, wishlist });
    toast.success(`Welcome back, ${u.name.split(" ")[0]}`);
    continueAfterAuth();
    return u;
  }, [cart, wishlist, adopt, continueAfterAuth]);

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    const { user: u } = await api<{ user: ApiUser }>("/auth/register", { method: "POST", body: { name, email, password } });
    await adopt(u, { cart, wishlist });
    toast.success(`Welcome, ${u.name.split(" ")[0]}`, { description: "Your bag and wishlist are now saved to your account." });
    continueAfterAuth();
    return u;
  }, [cart, wishlist, adopt, continueAfterAuth]);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string) => {
    const { user: u } = await api<{ user: ApiUser }>("/auth/change-password", { method: "POST", body: { currentPassword, newPassword } });
    setUser(u);
    toast.success("Password changed", { description: "You've been signed out on your other devices." });
  }, []);

  const signOut = useCallback(async (everywhere = false) => {
    try { await api(everywhere ? "/auth/logout-all" : "/auth/logout", { method: "POST" }); } catch { /* clear this device regardless */ }
    endSession();
    toast(everywhere ? "Signed out on all devices" : "Signed out");
  }, [endSession]);

  const value = useMemo<Store>(() => ({
    cart, wishlist, panel, setPanel, promptSignIn, addToCart, setQty, removeLine, toggleWish,
    count: cart.reduce((a, l) => a + l.qty, 0),
    subtotal: cart.reduce((a, l) => a + (l.unitPrice ?? getProduct(l.slug)?.price ?? 0) * l.qty, 0),
    signInOnly, user, authReady, signIn, signUp, changePassword, signOut, refreshBag,
  }), [cart, wishlist, panel, setPanel, promptSignIn, signInOnly, changePassword, addToCart, setQty, removeLine, toggleWish, user, authReady, signIn, signUp, signOut, refreshBag, getProduct]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}
