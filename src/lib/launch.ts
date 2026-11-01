/**
 * Pre-launch notice. While `enabled` is true the top bar says the boutique is opening by Christmas and the home page shows a short
 * band under the hero. On launch day set `enabled` to false: both disappear and the top bar returns to its shipping message.
 * The wording lives here so the top bar and the band always agree.
 */
export const LAUNCH = {
  enabled: true,
  /** Short form, for the top bar. */
  short: "Opening this Christmas",
  headline: { lead: "The house opens", accent: "by Christmas." },
  intro: "Until then, take your time. Search the collection and add the pieces you like to your bag or wishlist: they will be waiting for you when we open.",
  /** Shown in place of the checkout while the server is not taking orders (ORDERS_OPEN=false). */
  checkout: {
    label: "Checkout opens with the boutique",
    note: "Your bag is saved. You can place your order as soon as we open.",
  },
  points: [
    { label: "From today", text: "Browse, search and save your favourites", accent: false },
    { label: "Christmas & New Year", text: "Premium discounts on selected pieces", accent: true },
  ],
} as const;
