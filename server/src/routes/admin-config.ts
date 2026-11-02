import express, { Router } from "express";
import { z } from "zod";
import { dbStats, query, withTx } from "../db/pool.js";
import { COLLECTIONS } from "../lib/catalog.js";
import { allCaches, invalidateBranding, purgeAll } from "../lib/caches.js";
import { AppError, badRequest, conflict, notFound } from "../lib/errors.js";
import { IMAGE_TYPES, sniffImage } from "../lib/image-type.js";
import { audit } from "../lib/session.js";
import { me } from "../middleware/auth.js";

/**
 * Admin console configuration: branding, offers, loyalty and discount-combination rules.
 * Mounted inside adminRouter, so requireAuth + requireAdmin already ran.
 * These are settings only — nothing here changes how an order is priced yet.
 */
export const adminConfigRouter = Router();

const uuid = z.uuid();
const slug = z.string().min(1).max(80).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const int = (min: number, max: number) => z.number().int().min(min).max(max);
const clean = (max: number) => z.string().trim().max(max).refine((s) => !/[\u0000-\u001f<>]/.test(s), "Remove control characters and < >");
const dbError = (err: unknown) => err as { code?: string; constraint?: string };

// ── Roles ────────────────────────────────────────────────────────────────────────────────────
adminConfigRouter.get("/roles", async (_req, res) => {
  const { rows } = await query<{ name: string; description: string; users: number }>(
    `SELECT r.name, r.description, count(u.id)::int AS users
       FROM roles r LEFT JOIN users u ON u.role = r.name GROUP BY r.name, r.description ORDER BY r.name`,
  );
  res.json({ roles: rows });
});

// ── Cache ────────────────────────────────────────────────────────────────────────────────────
adminConfigRouter.get("/cache", (_req, res) => {
  res.json({ caches: allCaches.map((c) => c.stats()), dbQueriesSinceStart: dbStats.queries });
});

/** After changing data outside the API (straight SQL, a seed run) this makes it show up immediately. */
adminConfigRouter.post("/cache/purge", async (req, res) => {
  purgeAll();
  await audit(req, "admin_cache_purge", me(req).id);
  res.json({ purged: true });
});

// ── Branding ─────────────────────────────────────────────────────────────────────────────────
type BrandRow = { site_name: string; site_subtitle: string; logo_version: number; has_logo: boolean; logo_type: string | null; updated_at: Date };
const brandSql = "SELECT site_name, site_subtitle, logo_version, (logo_data IS NOT NULL) AS has_logo, logo_type, updated_at FROM site_settings";
const brandShape = (r: BrandRow) => ({
  siteName: r.site_name,
  siteSubtitle: r.site_subtitle,
  logoUrl: r.has_logo ? `/api/branding/logo?v=${r.logo_version}` : null,
  logoType: r.logo_type,
  updatedAt: r.updated_at,
});

adminConfigRouter.get("/branding", async (_req, res) => {
  res.json({ branding: brandShape((await query<BrandRow>(brandSql)).rows[0]!) });
});

adminConfigRouter.put("/branding", async (req, res) => {
  const b = z.object({ siteName: clean(60).pipe(z.string().min(1, "Enter a name")), siteSubtitle: clean(40).default("") }).parse(req.body);
  await query("UPDATE site_settings SET site_name = $1, site_subtitle = $2, updated_at = now(), updated_by = $3", [b.siteName, b.siteSubtitle, me(req).id]);
  invalidateBranding();
  await audit(req, "admin_branding_update", me(req).id, b);
  res.json({ branding: brandShape((await query<BrandRow>(brandSql)).rows[0]!) });
});

const LOGO_TYPES = IMAGE_TYPES;

// Raw bytes, PNG/JPEG/WebP only, 1 MB max. SVG is deliberately not accepted: it can carry scripts.
adminConfigRouter.put("/branding/logo", express.raw({ type: [...LOGO_TYPES], limit: "1mb" }), async (req, res) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
    throw new AppError(415, "unsupported_media_type", "Send the logo as a PNG, JPEG or WebP image (Content-Type image/png, image/jpeg or image/webp).");
  }
  const real = sniffImage(req.body);
  if (!real) throw badRequest("That file isn't a valid PNG, JPEG or WebP image.");
  if (real !== req.get("content-type")?.split(";")[0]?.trim()) throw badRequest("The file contents don't match its declared type.");
  await query("UPDATE site_settings SET logo_data = $1, logo_type = $2, logo_version = logo_version + 1, updated_at = now(), updated_by = $3", [req.body, real, me(req).id]);
  invalidateBranding();
  await audit(req, "admin_logo_update", me(req).id, { type: real, bytes: req.body.length });
  res.json({ branding: brandShape((await query<BrandRow>(brandSql)).rows[0]!) });
});

adminConfigRouter.delete("/branding/logo", async (req, res) => {
  await query("UPDATE site_settings SET logo_data = NULL, logo_type = NULL, logo_version = logo_version + 1, updated_at = now(), updated_by = $1", [me(req).id]);
  invalidateBranding();
  await audit(req, "admin_logo_remove", me(req).id);
  res.json({ branding: brandShape((await query<BrandRow>(brandSql)).rows[0]!) });
});

// ── Offers ───────────────────────────────────────────────────────────────────────────────────
type OfferRow = {
  id: string; name: string; description: string; kind: "percentage" | "fixed" | "free_shipping"; value: number; code: string | null;
  scope: "all" | "collection" | "product"; scope_values: string[]; min_order_inr: number; max_discount_inr: number | null;
  starts_at: Date | null; ends_at: Date | null; usage_limit: number | null; per_user_limit: number | null; priority: number;
  active: boolean; created_at: Date; updated_at: Date;
};

const offerState = (o: OfferRow, now = new Date()) =>
  !o.active ? "disabled" : o.ends_at && o.ends_at < now ? "expired" : o.starts_at && o.starts_at > now ? "scheduled" : "live";

const offerShape = (o: OfferRow) => ({
  id: o.id, name: o.name, description: o.description, kind: o.kind, value: o.value, code: o.code,
  // Which discount-combination rule applies to this offer (see /admin/discounts).
  combinesAs: o.kind === "free_shipping" ? "free_shipping" : o.code ? "coupon" : "offer",
  scope: o.scope, scopeValues: o.scope_values, minOrderInr: o.min_order_inr, maxDiscountInr: o.max_discount_inr,
  startsAt: o.starts_at, endsAt: o.ends_at, usageLimit: o.usage_limit, perUserLimit: o.per_user_limit, priority: o.priority,
  active: o.active, state: offerState(o), createdAt: o.created_at, updatedAt: o.updated_at,
});

const dateOrNull = z.iso.datetime().nullable().default(null);
const offerInput = z.object({
  name: clean(80).pipe(z.string().min(1, "Give the offer a name")),
  description: clean(300).default(""),
  kind: z.enum(["percentage", "fixed", "free_shipping"]),
  value: int(0, 10_000_000).default(0),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,32}$/, "Use 3–32 letters, numbers, - or _").nullable().default(null),
  scope: z.enum(["all", "collection", "product"]).default("all"),
  scopeValues: z.array(slug).max(100).default([]),
  minOrderInr: int(0, 10_000_000).default(0),
  maxDiscountInr: int(1, 10_000_000).nullable().default(null),
  startsAt: dateOrNull,
  endsAt: dateOrNull,
  usageLimit: int(1, 10_000_000).nullable().default(null),
  perUserLimit: int(1, 10_000).nullable().default(null),
  priority: int(-1000, 1000).default(0),
  active: z.boolean().default(true),
}).superRefine((o, ctx) => {
  const bad = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if (o.kind === "percentage" && (o.value < 1 || o.value > 100)) bad("value", "A percentage must be between 1 and 100");
  if (o.kind === "fixed" && o.value < 1) bad("value", "Enter an amount of at least ₹1");
  if (o.kind === "free_shipping" && o.value !== 0) bad("value", "Free shipping has no value");
  if (o.kind !== "percentage" && o.maxDiscountInr !== null) bad("maxDiscountInr", "A maximum discount only applies to percentage offers");
  if (o.scope === "all" && o.scopeValues.length) bad("scopeValues", "Choose collections or products, or set the scope to everything");
  if (o.scope !== "all" && !o.scopeValues.length) bad("scopeValues", "Pick at least one collection or product");
  if (o.startsAt && o.endsAt && new Date(o.endsAt) <= new Date(o.startsAt)) bad("endsAt", "The end must be after the start");
});

async function checkScope(o: z.infer<typeof offerInput>) {
  if (o.scope === "collection") {
    const known = new Set(COLLECTIONS.map((c) => c.slug));
    const unknown = o.scopeValues.filter((s) => !known.has(s));
    if (unknown.length) throw badRequest(`Unknown collection: ${unknown.join(", ")}`);
  } else if (o.scope === "product") {
    const { rows } = await query<{ slug: string }>("SELECT slug FROM products WHERE slug = ANY($1)", [o.scopeValues]);
    const found = new Set(rows.map((r) => r.slug));
    const unknown = o.scopeValues.filter((s) => !found.has(s));
    if (unknown.length) throw badRequest(`Unknown product: ${unknown.join(", ")}`);
  }
}

const offerCols = (o: z.infer<typeof offerInput>) => [
  o.name, o.description, o.kind, o.kind === "free_shipping" ? 0 : o.value, o.code, o.scope, o.scopeValues,
  o.minOrderInr, o.maxDiscountInr, o.startsAt, o.endsAt, o.usageLimit, o.perUserLimit, o.priority, o.active,
];

function offerConflict(err: unknown): never {
  if (dbError(err).code === "23505") throw conflict("That coupon code is already used by another offer", "code_taken");
  throw err;
}

adminConfigRouter.get("/offers", async (_req, res) => {
  const { rows } = await query<OfferRow>("SELECT * FROM offers ORDER BY priority DESC, created_at DESC");
  res.json({ offers: rows.map(offerShape) });
});

adminConfigRouter.post("/offers", async (req, res) => {
  const o = offerInput.parse(req.body);
  await checkScope(o);
  try {
    const { rows } = await query<OfferRow>(
      `INSERT INTO offers (name, description, kind, value, code, scope, scope_values, min_order_inr, max_discount_inr,
                           starts_at, ends_at, usage_limit, per_user_limit, priority, active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
      [...offerCols(o), me(req).id],
    );
    await audit(req, "admin_offer_create", me(req).id, { offerId: rows[0]!.id, name: o.name });
    res.status(201).json({ offer: offerShape(rows[0]!) });
  } catch (err) { offerConflict(err); }
});

adminConfigRouter.get("/offers/:id", async (req, res) => {
  const row = (await query<OfferRow>("SELECT * FROM offers WHERE id = $1", [uuid.parse(req.params.id)])).rows[0];
  if (!row) throw notFound("Offer not found");
  res.json({ offer: offerShape(row) });
});

adminConfigRouter.put("/offers/:id", async (req, res) => {
  const id = uuid.parse(req.params.id);
  const o = offerInput.parse(req.body);
  await checkScope(o);
  try {
    const { rows } = await query<OfferRow>(
      `UPDATE offers SET name=$2, description=$3, kind=$4, value=$5, code=$6, scope=$7, scope_values=$8, min_order_inr=$9,
              max_discount_inr=$10, starts_at=$11, ends_at=$12, usage_limit=$13, per_user_limit=$14, priority=$15, active=$16,
              updated_at = now()
        WHERE id = $1 RETURNING *`,
      [id, ...offerCols(o)],
    );
    if (!rows[0]) throw notFound("Offer not found");
    await audit(req, "admin_offer_update", me(req).id, { offerId: id });
    res.json({ offer: offerShape(rows[0]) });
  } catch (err) { offerConflict(err); }
});

adminConfigRouter.patch("/offers/:id", async (req, res) => {
  const { active } = z.object({ active: z.boolean() }).parse(req.body);
  const { rows } = await query<OfferRow>("UPDATE offers SET active = $2, updated_at = now() WHERE id = $1 RETURNING *", [uuid.parse(req.params.id), active]);
  if (!rows[0]) throw notFound("Offer not found");
  await audit(req, "admin_offer_toggle", me(req).id, { offerId: rows[0].id, active });
  res.json({ offer: offerShape(rows[0]) });
});

adminConfigRouter.delete("/offers/:id", async (req, res) => {
  const r = await query("DELETE FROM offers WHERE id = $1", [uuid.parse(req.params.id)]);
  if (!r.rowCount) throw notFound("Offer not found");
  await audit(req, "admin_offer_delete", me(req).id, { offerId: req.params["id"] });
  res.status(204).end();
});

// ── Loyalty ──────────────────────────────────────────────────────────────────────────────────
type LoyaltyRow = {
  enabled: boolean; earn_points_per_100_inr: number; redeem_inr_per_100_points: number; min_points_to_redeem: number;
  max_redeem_pct_of_order: number; points_expiry_days: number | null; signup_bonus_points: number; updated_at: Date;
};
type TierRow = { id: string; name: string; min_lifetime_spend_inr: number; earn_multiplier_pct: number; perks: string; created_at: Date; updated_at: Date };

const loyaltyShape = (r: LoyaltyRow) => ({
  enabled: r.enabled, earnPointsPer100Inr: r.earn_points_per_100_inr, redeemInrPer100Points: r.redeem_inr_per_100_points,
  minPointsToRedeem: r.min_points_to_redeem, maxRedeemPctOfOrder: r.max_redeem_pct_of_order,
  pointsExpiryDays: r.points_expiry_days, signupBonusPoints: r.signup_bonus_points, updatedAt: r.updated_at,
});
const tierShape = (t: TierRow) => ({ id: t.id, name: t.name, minLifetimeSpendInr: t.min_lifetime_spend_inr, earnMultiplierPct: t.earn_multiplier_pct, perks: t.perks });

async function loadLoyalty() {
  const settings = (await query<LoyaltyRow>("SELECT * FROM loyalty_settings")).rows[0]!;
  const tiers = (await query<TierRow>("SELECT * FROM loyalty_tiers ORDER BY min_lifetime_spend_inr")).rows;
  return { settings: loyaltyShape(settings), tiers: tiers.map(tierShape) };
}

adminConfigRouter.get("/loyalty", async (_req, res) => { res.json(await loadLoyalty()); });

adminConfigRouter.put("/loyalty", async (req, res) => {
  const s = z.object({
    enabled: z.boolean(),
    earnPointsPer100Inr: int(0, 1000),
    redeemInrPer100Points: int(1, 10_000),
    minPointsToRedeem: int(0, 10_000_000),
    maxRedeemPctOfOrder: int(1, 100),
    pointsExpiryDays: int(1, 3650).nullable().default(null),
    signupBonusPoints: int(0, 1_000_000),
  }).parse(req.body);
  await query(
    `UPDATE loyalty_settings SET enabled=$1, earn_points_per_100_inr=$2, redeem_inr_per_100_points=$3, min_points_to_redeem=$4,
            max_redeem_pct_of_order=$5, points_expiry_days=$6, signup_bonus_points=$7, updated_at=now(), updated_by=$8`,
    [s.enabled, s.earnPointsPer100Inr, s.redeemInrPer100Points, s.minPointsToRedeem, s.maxRedeemPctOfOrder, s.pointsExpiryDays, s.signupBonusPoints, me(req).id],
  );
  await audit(req, "admin_loyalty_update", me(req).id, s);
  res.json(await loadLoyalty());
});

const tierInput = z.object({
  name: clean(40).pipe(z.string().min(1, "Give the tier a name")),
  minLifetimeSpendInr: int(0, 1_000_000_000),
  earnMultiplierPct: int(50, 1000),
  perks: clean(300).default(""),
});
function tierConflict(err: unknown): never {
  const e = dbError(err);
  if (e.code === "23505") {
    throw conflict(e.constraint === "loyalty_tiers_spend_key" ? "Another tier already starts at that spend" : "A tier with that name already exists", "tier_conflict");
  }
  throw err;
}

adminConfigRouter.post("/loyalty/tiers", async (req, res) => {
  const t = tierInput.parse(req.body);
  try {
    const { rows } = await query<TierRow>(
      "INSERT INTO loyalty_tiers (name, min_lifetime_spend_inr, earn_multiplier_pct, perks) VALUES ($1,$2,$3,$4) RETURNING *",
      [t.name, t.minLifetimeSpendInr, t.earnMultiplierPct, t.perks],
    );
    await audit(req, "admin_tier_create", me(req).id, { name: t.name });
    res.status(201).json({ tier: tierShape(rows[0]!) });
  } catch (err) { tierConflict(err); }
});

adminConfigRouter.put("/loyalty/tiers/:id", async (req, res) => {
  const t = tierInput.parse(req.body);
  try {
    const { rows } = await query<TierRow>(
      `UPDATE loyalty_tiers SET name=$2, min_lifetime_spend_inr=$3, earn_multiplier_pct=$4, perks=$5, updated_at=now()
        WHERE id = $1 RETURNING *`,
      [uuid.parse(req.params.id), t.name, t.minLifetimeSpendInr, t.earnMultiplierPct, t.perks],
    );
    if (!rows[0]) throw notFound("Tier not found");
    await audit(req, "admin_tier_update", me(req).id, { tierId: rows[0].id });
    res.json({ tier: tierShape(rows[0]) });
  } catch (err) { tierConflict(err); }
});

adminConfigRouter.delete("/loyalty/tiers/:id", async (req, res) => {
  const r = await query("DELETE FROM loyalty_tiers WHERE id = $1", [uuid.parse(req.params.id)]);
  if (!r.rowCount) throw notFound("Tier not found");
  await audit(req, "admin_tier_delete", me(req).id, { tierId: req.params["id"] });
  res.status(204).end();
});

// ── Discount combinations ────────────────────────────────────────────────────────────────────
export const DISCOUNT_KINDS = ["offer", "coupon", "loyalty", "free_shipping"] as const;
const kind = z.enum(DISCOUNT_KINDS);
/** One row per unordered pair: store the alphabetically smaller kind first. */
const pairKey = (a: string, b: string): [string, string] => (a <= b ? [a, b] : [b, a]);

async function loadDiscounts() {
  const s = (await query<{ stacking_mode: "best_only" | "stack"; max_total_discount_pct: number; updated_at: Date }>("SELECT * FROM discount_settings")).rows[0]!;
  const rows = (await query<{ kind_a: string; kind_b: string; allowed: boolean }>("SELECT kind_a, kind_b, allowed FROM discount_combinations ORDER BY kind_a, kind_b")).rows;
  return {
    stackingMode: s.stacking_mode,
    maxTotalDiscountPct: s.max_total_discount_pct,
    kinds: DISCOUNT_KINDS,
    combinations: rows.map((r) => ({ a: r.kind_a, b: r.kind_b, allowed: r.allowed })),
    updatedAt: s.updated_at,
  };
}

adminConfigRouter.get("/discounts", async (_req, res) => { res.json(await loadDiscounts()); });

adminConfigRouter.put("/discounts", async (req, res) => {
  const b = z.object({
    stackingMode: z.enum(["best_only", "stack"]),
    maxTotalDiscountPct: int(1, 100),
    combinations: z.array(z.object({ a: kind, b: kind, allowed: z.boolean() })).max(20),
  }).parse(req.body);

  const seen = new Set<string>();
  for (const c of b.combinations) {
    const key = pairKey(c.a, c.b).join("+");
    if (seen.has(key)) throw badRequest(`The combination ${key} is listed twice`);
    seen.add(key);
  }
  await withTx(async (db) => {
    await db.query("UPDATE discount_settings SET stacking_mode=$1, max_total_discount_pct=$2, updated_at=now(), updated_by=$3", [b.stackingMode, b.maxTotalDiscountPct, me(req).id]);
    for (const c of b.combinations) {
      const [ka, kb] = pairKey(c.a, c.b);
      await db.query(
        "INSERT INTO discount_combinations (kind_a, kind_b, allowed) VALUES ($1,$2,$3) ON CONFLICT (kind_a, kind_b) DO UPDATE SET allowed = EXCLUDED.allowed",
        [ka, kb, c.allowed],
      );
    }
  });
  await audit(req, "admin_discounts_update", me(req).id, { stackingMode: b.stackingMode, maxTotalDiscountPct: b.maxTotalDiscountPct });
  res.json(await loadDiscounts());
});
