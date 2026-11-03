# Leather Lux India: complete database scripts

Everything that creates, changes, seeds, backs up or connects to the Leather Lux India Postgres database, in the order it is used.
Each script below is copied word for word from the project (`server/...` paths are in the repository), so this file can be handed to
a database administrator as it is. Nothing here contains a secret: passwords are placeholders, and the database password, JWT secret
and pepper live only in `server/.env` and in Vercel's Environment Variables.

Up to date as of migration 009 (applied to the live database on 2026-11-03). When a migration or one of these scripts changes, this file is
regenerated from the project files rather than edited by hand.

**This deployment:** Postgres on an EC2 server, database `LLI`, application role `llx_app`. The API needs Postgres 13 or newer
(`gen_random_uuid()` is built in; no extensions are required).

## Contents

1. Order of use
2. One-time server setup (role, database, hardening, network)
3. Schema migrations 001 to 009 (all the tables)
4. Scripts that run the migrations, seed data, create admins, import products and roll photos back
5. Connection, certificate, rate-limit, visit-log and visitor-counter code that talks to the database
6. Backup and restore
7. Everyday SQL
8. Data files that are not inlined

---

## 1. Order of use

| Step | What | How |
| --- | --- | --- |
| 1 | Create the role and database (once) | section 2, as the `postgres` user |
| 2 | Lock the role down, set TLS and network rules (once) | section 2 |
| 3 | Create every table | `npm run db:migrate` in `server/` (runs section 3 in file order, each in its own transaction, recorded in `schema_migrations`) |
| 4 | Check the connection | `npm run db:check` |
| 5 | Load the 22 starter products | `npm run db:seed` |
| 6 | Create the first admin | `npm run admin:create` (own password) or `npm run admin:add -- <email>` (default password, changed at first sign-in) |
| 7 | Import the 76 photographed products | `npm run products:import -- --dry-run`, then `npm run products:import` (flags: `--background=none`, `--images-only`, `--repoint-photos`, see 4.5) |
| 7b | Save or go back to a rollback point for the product photos | `npm run images:rollback -- save <name>` / `restore <name> [--dry-run]` (4.6) |
| 8 | Print the certificate settings for Vercel | `npm run db:ca` |
| 9 | Nightly backup | `deploy/backup-db.sh` from cron on the database server |

Migrations 006 (rate limits, needed by the Vercel deployment), 007 (availability, hover effect and photos uploaded in the admin console), 008 (the footer's page-load counter) and 009 (the visit log: IP address, page, date and time of every page view) are already applied to the live database. The visit log holds IP addresses, which are personal data: see `docs/visit-log.md` in the repository for what it stores, ready-made queries and the privacy checklist.

---

## 2. One-time server setup

Run as the postgres user on the EC2 server (`sudo -u postgres psql`). Replace the placeholder password with 30 or more random characters.

### 2.1 Role and database

````sql
-- The API needs ordinary rights on one database, never a superuser.
CREATE ROLE llx_app LOGIN PASSWORD 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD';
CREATE DATABASE "LLI" OWNER llx_app;
````

(The repository's `server/README.md` shows the database name as `llx`; this deployment uses `LLI`. Any name works as long as
`DB_NAME` in the API's settings matches.)

### 2.2 Lock the role down (from `server/deploy/VERCEL.md`)

````sql
-- the API's role must be a plain role, not a superuser (all three columns must be f):
SELECT rolname, rolsuper, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = 'llx_app';
-- cap its connections, so a flood of serverless instances can never use them all up:
ALTER ROLE llx_app CONNECTION LIMIT 40;
-- change the password (it lives in Vercel and in server/.env):
ALTER ROLE llx_app PASSWORD 'REPLACE_WITH_A_LONG_RANDOM_PASSWORD';
````

### 2.3 Postgres configuration (not SQL; from `server/README.md` and `server/deploy/VERCEL.md`)

````conf
# postgresql.conf
ssl = on                               # with ssl_cert_file / ssl_key_file set to the server certificate and key
listen_addresses = '*'                 # or the interface the API reaches
password_encryption = scram-sha-256    # the default on Postgres 14+

# pg_hba.conf: the only line that lets llx_app in from outside. No plain `host` lines, nothing with `trust`.
hostssl  LLI  llx_app  0.0.0.0/0  scram-sha-256
````

After editing: `sudo systemctl reload postgresql`. The AWS security group must allow TCP 5432 (Vercel has no fixed addresses);
everything else stays closed. Details and alternatives: `server/deploy/VERCEL.md`.

---

## 3. Schema migrations

The runner (section 4.1) applies these in file-name order and records each in `schema_migrations`, so running it again does nothing.
Money is stored as whole rupees (`integer`). Do not edit a migration that has been applied; add a new numbered file instead.

### 001_init.sql

`server/src/db/migrations/001_init.sql` — Users, sessions, products, bag, wishlist, orders, newsletter, audit log

````sql
-- LLX initial schema. Money is stored as whole INR rupees (INTEGER), matching the storefront.

CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text NOT NULL,
  name             text NOT NULL,
  password_hash    text NOT NULL,
  role             text NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin')),
  token_version    integer NOT NULL DEFAULT 0,
  failed_logins    integer NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  last_login_at    timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_lower CHECK (email = lower(email))
);
CREATE UNIQUE INDEX users_email_key ON users (email);

CREATE TABLE refresh_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  family_id    uuid NOT NULL,
  token_hash   text NOT NULL,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  replaced_by  uuid,
  user_agent   text,
  ip           text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX refresh_tokens_hash_key ON refresh_tokens (token_hash);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_expiry_idx ON refresh_tokens (expires_at);

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  user_id     uuid REFERENCES users (id) ON DELETE SET NULL,
  action      text NOT NULL,
  ip          text,
  user_agent  text,
  meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_user_idx ON audit_log (user_id, created_at DESC);

CREATE TABLE products (
  slug         text PRIMARY KEY CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name         text NOT NULL,
  type         text NOT NULL,
  gender       text NOT NULL CHECK (gender IN ('women', 'men', 'unisex')),
  price_inr    integer NOT NULL CHECK (price_inr > 0),
  colours      text[] NOT NULL CHECK (cardinality(colours) > 0),
  images       text[] NOT NULL DEFAULT '{}',
  is_new       boolean NOT NULL DEFAULT false,
  bestseller   boolean NOT NULL DEFAULT false,
  gift         boolean NOT NULL DEFAULT false,
  stock_qty    integer NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  tagline      text NOT NULL DEFAULT '',
  material     text NOT NULL DEFAULT '',
  dimensions   text NOT NULL DEFAULT '',
  sizes        text[],
  rank         integer NOT NULL DEFAULT 0,
  active       boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_rank_idx ON products (rank) WHERE active;
CREATE INDEX products_type_idx ON products (type);

CREATE TABLE cart_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  product_slug  text NOT NULL REFERENCES products (slug) ON DELETE CASCADE,
  colour        text NOT NULL,
  size          text NOT NULL DEFAULT '',
  qty           integer NOT NULL CHECK (qty BETWEEN 1 AND 10),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_slug, colour, size)
);

CREATE TABLE wishlist_items (
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  product_slug  text NOT NULL REFERENCES products (slug) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_slug)
);

CREATE TABLE orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number     text NOT NULL UNIQUE,
  user_id          uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled')),
  payment_status   text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid', 'refunded')),
  subtotal_inr     integer NOT NULL CHECK (subtotal_inr >= 0),
  shipping_inr     integer NOT NULL CHECK (shipping_inr >= 0),
  total_inr        integer NOT NULL CHECK (total_inr >= 0),
  shipping_address jsonb NOT NULL,
  idempotency_key  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX orders_user_idx ON orders (user_id, created_at DESC);
CREATE INDEX orders_status_idx ON orders (status, created_at DESC);
CREATE UNIQUE INDEX orders_idem_key ON orders (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE order_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id       uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_slug   text NOT NULL REFERENCES products (slug) ON DELETE RESTRICT,
  name           text NOT NULL,
  colour         text NOT NULL,
  size           text NOT NULL DEFAULT '',
  qty            integer NOT NULL CHECK (qty > 0),
  unit_price_inr integer NOT NULL CHECK (unit_price_inr > 0)
);
CREATE INDEX order_items_order_idx ON order_items (order_id);

CREATE TABLE newsletter_subscribers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT newsletter_email_lower CHECK (email = lower(email))
);
CREATE UNIQUE INDEX newsletter_email_key ON newsletter_subscribers (email);
````

### 002_roles_and_admin_config.sql

`server/src/db/migrations/002_roles_and_admin_config.sql` — Roles, usernames, branding, offers, loyalty, discount rules

````sql
-- Roles, usernames, and the admin-console configuration (branding, offers, loyalty, discount rules).
-- Money is whole INR rupees, as elsewhere.

-- -- Roles ------------------------------------------------------------------------------------
CREATE TABLE roles (
  name         text PRIMARY KEY CHECK (name ~ '^[a-z][a-z_]{1,31}$'),
  description  text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO roles (name, description) VALUES
  ('admin', 'Full access to the admin console'),
  ('user',  'Shopper account');

-- users.role was a free-text CHECK ('customer' | 'admin'); it now references the roles table.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
UPDATE users SET role = 'user' WHERE role = 'customer';
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user';
ALTER TABLE users
  ADD CONSTRAINT users_role_fkey FOREIGN KEY (role) REFERENCES roles (name) ON UPDATE CASCADE ON DELETE RESTRICT;

-- Optional login name (admins use one; shoppers keep signing in with their email). Always stored lowercase.
ALTER TABLE users ADD COLUMN username text;
ALTER TABLE users ADD CONSTRAINT users_username_format CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,32}$');
CREATE UNIQUE INDEX users_username_key ON users (username) WHERE username IS NOT NULL;

-- -- Branding (single row) --------------------------------------------------------------------
CREATE TABLE site_settings (
  id             boolean PRIMARY KEY DEFAULT true CHECK (id),
  site_name      text NOT NULL CHECK (char_length(site_name) BETWEEN 1 AND 60),
  site_subtitle  text NOT NULL DEFAULT '' CHECK (char_length(site_subtitle) <= 40),
  logo_data      bytea,
  logo_type      text CHECK (logo_type IN ('image/png', 'image/jpeg', 'image/webp')),
  logo_version   integer NOT NULL DEFAULT 0,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  updated_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT site_logo_pair CHECK ((logo_data IS NULL) = (logo_type IS NULL)),
  CONSTRAINT site_logo_size CHECK (logo_data IS NULL OR octet_length(logo_data) <= 1048576)
);
INSERT INTO site_settings (site_name, site_subtitle) VALUES ('Leather Lux', 'India');

-- -- Offers -----------------------------------------------------------------------------------
-- Configuration only: nothing here is applied to orders yet. A row with a `code` is a coupon;
-- without one it is an automatic offer.
CREATE TABLE offers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description     text NOT NULL DEFAULT '' CHECK (char_length(description) <= 300),
  kind            text NOT NULL CHECK (kind IN ('percentage', 'fixed', 'free_shipping')),
  value           integer NOT NULL DEFAULT 0 CHECK (value >= 0),
  code            text CHECK (code ~ '^[A-Z0-9_-]{3,32}$'),
  scope           text NOT NULL DEFAULT 'all' CHECK (scope IN ('all', 'collection', 'product')),
  scope_values    text[] NOT NULL DEFAULT '{}',
  min_order_inr   integer NOT NULL DEFAULT 0 CHECK (min_order_inr >= 0),
  max_discount_inr integer CHECK (max_discount_inr IS NULL OR max_discount_inr > 0),
  starts_at       timestamptz,
  ends_at         timestamptz,
  usage_limit     integer CHECK (usage_limit IS NULL OR usage_limit > 0),
  per_user_limit  integer CHECK (per_user_limit IS NULL OR per_user_limit > 0),
  priority        integer NOT NULL DEFAULT 0 CHECK (priority BETWEEN -1000 AND 1000),
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  CONSTRAINT offers_value_rule CHECK (
    (kind = 'percentage' AND value BETWEEN 1 AND 100)
    OR (kind = 'fixed' AND value >= 1)
    OR (kind = 'free_shipping' AND value = 0)
  ),
  CONSTRAINT offers_scope_rule CHECK (
    (scope = 'all' AND cardinality(scope_values) = 0) OR (scope <> 'all' AND cardinality(scope_values) > 0)
  ),
  CONSTRAINT offers_window CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);
CREATE UNIQUE INDEX offers_code_key ON offers (code) WHERE code IS NOT NULL;
CREATE INDEX offers_active_idx ON offers (active, priority DESC);

-- -- Loyalty ----------------------------------------------------------------------------------
CREATE TABLE loyalty_settings (
  id                         boolean PRIMARY KEY DEFAULT true CHECK (id),
  enabled                    boolean NOT NULL DEFAULT false,
  earn_points_per_100_inr    integer NOT NULL DEFAULT 1 CHECK (earn_points_per_100_inr BETWEEN 0 AND 1000),
  redeem_inr_per_100_points  integer NOT NULL DEFAULT 10 CHECK (redeem_inr_per_100_points BETWEEN 1 AND 10000),
  min_points_to_redeem       integer NOT NULL DEFAULT 100 CHECK (min_points_to_redeem >= 0),
  max_redeem_pct_of_order    integer NOT NULL DEFAULT 50 CHECK (max_redeem_pct_of_order BETWEEN 1 AND 100),
  points_expiry_days         integer CHECK (points_expiry_days IS NULL OR points_expiry_days > 0),
  signup_bonus_points        integer NOT NULL DEFAULT 0 CHECK (signup_bonus_points >= 0),
  updated_at                 timestamptz NOT NULL DEFAULT now(),
  updated_by                 uuid REFERENCES users (id) ON DELETE SET NULL
);
INSERT INTO loyalty_settings DEFAULT VALUES;

CREATE TABLE loyalty_tiers (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  min_lifetime_spend_inr  integer NOT NULL DEFAULT 0 CHECK (min_lifetime_spend_inr >= 0),
  earn_multiplier_pct     integer NOT NULL DEFAULT 100 CHECK (earn_multiplier_pct BETWEEN 50 AND 1000), -- 100 = 1x
  perks                   text NOT NULL DEFAULT '' CHECK (char_length(perks) <= 300),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX loyalty_tiers_name_key ON loyalty_tiers (lower(name));
CREATE UNIQUE INDEX loyalty_tiers_spend_key ON loyalty_tiers (min_lifetime_spend_inr);

-- -- Discount combination rules ---------------------------------------------------------------
-- Kinds: offer (automatic, % or Rs ), coupon (code), loyalty (points redeemed), free_shipping.
CREATE TABLE discount_settings (
  id                      boolean PRIMARY KEY DEFAULT true CHECK (id),
  stacking_mode           text NOT NULL DEFAULT 'best_only' CHECK (stacking_mode IN ('best_only', 'stack')),
  max_total_discount_pct  integer NOT NULL DEFAULT 70 CHECK (max_total_discount_pct BETWEEN 1 AND 100),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  updated_by              uuid REFERENCES users (id) ON DELETE SET NULL
);
INSERT INTO discount_settings DEFAULT VALUES;

CREATE TABLE discount_combinations (
  kind_a   text NOT NULL CHECK (kind_a IN ('coupon', 'free_shipping', 'loyalty', 'offer')),
  kind_b   text NOT NULL CHECK (kind_b IN ('coupon', 'free_shipping', 'loyalty', 'offer')),
  allowed  boolean NOT NULL DEFAULT false,
  PRIMARY KEY (kind_a, kind_b),
  CHECK (kind_a <= kind_b) -- one row per unordered pair
);
-- Conservative starting point: nothing stacks except free shipping and points on top of an offer.
INSERT INTO discount_combinations (kind_a, kind_b, allowed) VALUES
  ('coupon', 'coupon', false),
  ('coupon', 'free_shipping', true),
  ('coupon', 'loyalty', false),
  ('coupon', 'offer', false),
  ('free_shipping', 'free_shipping', false),
  ('free_shipping', 'loyalty', true),
  ('free_shipping', 'offer', true),
  ('loyalty', 'loyalty', false),
  ('loyalty', 'offer', true),
  ('offer', 'offer', false);
````

### 003_site_visitors.sql

`server/src/db/migrations/003_site_visitors.sql` — Anonymous unique-visitor counter

````sql
-- Unique-visitor counter. One row per browser, keyed by a one-way hash of a random id the browser
-- generates for itself. No IP address, user agent or other personal data is stored.

CREATE TABLE site_visitors (
  visitor_hash  text PRIMARY KEY CHECK (char_length(visitor_hash) = 64),
  first_seen    timestamptz NOT NULL DEFAULT now(),
  last_seen     timestamptz NOT NULL DEFAULT now(),
  visits        integer NOT NULL DEFAULT 1 CHECK (visits >= 1)
);
CREATE INDEX site_visitors_first_seen_idx ON site_visitors (first_seen);
````

### 004_must_change_password.sql

`server/src/db/migrations/004_must_change_password.sql` — Forced password change for default-password admins

````sql
-- Accounts created with a shared default password (see `npm run admin:add`) must choose their own before
-- they can use the admin console. Existing accounts are unaffected.
ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
````

### 005_inventory_and_media.sql

`server/src/db/migrations/005_inventory_and_media.sql` — SKU and stock fields, stock ledger, photo library

````sql
-- Inventory: richer product records, a stock ledger, and a library of every product photo.

ALTER TABLE products
  ADD COLUMN sku            text,
  ADD COLUMN description    text NOT NULL DEFAULT '',
  ADD COLUMN tags           text[] NOT NULL DEFAULT '{}',
  -- Same length as `images`: what each photo shows ("Front", "Open view", ...). `images` now holds either a
  -- storefront asset key (the original sample products) or a path under /media/ (photographed products).
  ADD COLUMN image_labels   text[] NOT NULL DEFAULT '{}',
  ADD COLUMN cost_inr       integer CHECK (cost_inr IS NULL OR cost_inr >= 0),
  ADD COLUMN reorder_level  integer NOT NULL DEFAULT 3 CHECK (reorder_level >= 0),
  -- Set on imported products until someone has confirmed the price, stock count and details in the admin console.
  ADD COLUMN needs_review   boolean NOT NULL DEFAULT false,
  ADD COLUMN source_folder  text;
CREATE UNIQUE INDEX products_sku_key ON products (sku) WHERE sku IS NOT NULL;
CREATE INDEX products_review_idx ON products (needs_review) WHERE needs_review;

-- Every change to stock, with who/why, so the number on the shelf can always be explained.
CREATE TABLE inventory_movements (
  id            bigserial PRIMARY KEY,
  product_slug  text NOT NULL REFERENCES products (slug) ON DELETE CASCADE,
  delta         integer NOT NULL CHECK (delta <> 0),
  qty_after     integer NOT NULL CHECK (qty_after >= 0),
  reason        text NOT NULL CHECK (reason IN ('opening_stock', 'purchase', 'sale', 'order_cancelled', 'return', 'damage', 'correction', 'count')),
  note          text NOT NULL DEFAULT '',
  order_id      uuid REFERENCES orders (id) ON DELETE SET NULL,
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_movements_product_idx ON inventory_movements (product_slug, created_at DESC);

-- Every photo from the shoot and what became of it, including the ones not (yet) on a product.
CREATE TABLE media_assets (
  id            bigserial PRIMARY KEY,
  camera_no     integer NOT NULL,
  source_file   text NOT NULL UNIQUE,          -- relative to the photo folder
  content_hash  text NOT NULL,
  status        text NOT NULL CHECK (status IN ('used', 'spare', 'rejected', 'duplicate')),
  note          text NOT NULL DEFAULT '',
  product_slug  text REFERENCES products (slug) ON DELETE SET NULL,
  web_path      text,                          -- optimised full-size image under /media/, when one was made
  thumb_path    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_assets_status_idx ON media_assets (status);
CREATE INDEX media_assets_product_idx ON media_assets (product_slug);
````

### 006_rate_limits.sql

`server/src/db/migrations/006_rate_limits.sql` — Shared request counters for rate limiting on Vercel

````sql
-- Shared request counters for the rate limiters, so a limit holds across every server instance (used when RATE_LIMIT_STORE=postgres).
-- UNLOGGED: much cheaper to write, and losing a few counters in a crash only means a window starts again.
CREATE UNLOGGED TABLE rate_limits (
  key       text PRIMARY KEY,
  hits      integer NOT NULL,
  reset_at  timestamptz NOT NULL
);
CREATE INDEX rate_limits_reset_idx ON rate_limits (reset_at);
````

### 007_availability_hover_photos.sql

`server/src/db/migrations/007_availability_hover_photos.sql` — Active / inactive / coming soon, the card hover effect, photos uploaded in the admin console

````sql
-- Availability ("active" / "inactive" / "coming soon"), the hover effect of a product card, and photos uploaded from the admin console.
--
-- availability is separate from `active` (which hides a product from the shop altogether):
--   active       the product is for sale, as its stock says
--   inactive     the product stays visible but shows as out of stock and cannot be bought, whatever its stock count
--   coming_soon  the product stays visible with a "Coming soon" label and cannot be bought yet
ALTER TABLE products
  ADD COLUMN availability  text NOT NULL DEFAULT 'active' CHECK (availability IN ('active', 'inactive', 'coming_soon')),
  ADD COLUMN hover_effect  text NOT NULL DEFAULT 'swap'   CHECK (hover_effect IN ('swap', 'slide', 'zoom', 'none'));
CREATE INDEX products_availability_idx ON products (availability) WHERE availability <> 'active';

-- A photo uploaded in the admin console, already resized by the browser: a full-size version and a small one for cards. The picture is
-- kept here (like the logo) because the server's disk is read-only on Vercel. A product refers to it as /api/photos/<id> in products.images.
-- The content never changes once saved, so it is served with a one-year cache.
CREATE TABLE product_photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type  text NOT NULL CHECK (content_type IN ('image/webp', 'image/jpeg', 'image/png')),
  full_data     bytea NOT NULL CHECK (octet_length(full_data) BETWEEN 1 AND 1048576),
  thumb_data    bytea NOT NULL CHECK (octet_length(thumb_data) BETWEEN 1 AND 262144),
  created_by    uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_photos_created_idx ON product_photos (created_at);
````

### 008_site_counters.sql

`server/src/db/migrations/008_site_counters.sql` — The footer's "Total visitors" number: one counter that goes up on every page load (replaces the unique-visitor table 003)

````sql
-- Named counters for the site. The first is the footer's "Total visitors": it goes up by one every time a page is loaded or refreshed
-- (before, it counted each browser once, using site_visitors, which is now unused and can be dropped when convenient).
-- It starts from the number the footer showed when this was introduced, so the figure never drops.
CREATE TABLE site_counters (
  name        text PRIMARY KEY CHECK (name ~ '^[a-z][a-z0-9_]{1,40}$'),
  value       bigint NOT NULL DEFAULT 0 CHECK (value >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO site_counters (name, value) SELECT 'page_loads', count(*) FROM site_visitors;
````

### 009_visit_log.sql

`server/src/db/migrations/009_visit_log.sql` — The visit log: the visitor's IP address, the page, the date and time of every page view

````sql
-- The visit log: one row for every page a visitor looks at, with the visitor's IP address and the date and time. Written by POST /api/visits/log,
-- which the storefront calls on every page view. It holds personal data (an IP address is personal data), so it is meant for the shop owner's
-- eyes only and is pruned after VISIT_LOG_RETENTION_DAYS (365 by default, 0 keeps everything). See docs/visit-log.md.
CREATE TABLE visit_log (
  id          bigserial PRIMARY KEY,
  visited_at  timestamptz NOT NULL DEFAULT now(),
  ip          inet NOT NULL,                       -- the visitor's address, IPv4 or IPv6 (the real one, taken from the platform's forwarding header)
  path        text NOT NULL CHECK (left(path, 1) = '/' AND char_length(path) <= 300),  -- the page, e.g. /products/aria-top-handle (no query string)
  referrer    text CHECK (referrer IS NULL OR char_length(referrer) <= 300),           -- the site they came from (its address only), on the first page of a visit
  user_agent  text CHECK (user_agent IS NULL OR char_length(user_agent) <= 400),       -- the browser and device they used
  is_bot      boolean NOT NULL DEFAULT false       -- crawlers and monitors are recorded too, marked, so they can be filtered out
);
CREATE INDEX visit_log_time_idx ON visit_log (visited_at DESC);
CREATE INDEX visit_log_ip_idx   ON visit_log (ip, visited_at DESC);   -- "what did this address look at?"
CREATE INDEX visit_log_path_idx ON visit_log (path, visited_at DESC); -- "who looked at this page?"
````

The runner also creates its own bookkeeping table the first time it runs (shown in 4.1):

````sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())
````

---

## 4. Scripts that change the database

All are TypeScript run from `server/` with the settings in `server/.env` (or the environment). The SQL is inside the template strings.

### 4.1 Migration runner

`server/src/db/migrate.ts` — `npm run db:migrate` (production: `npm run db:migrate:prod`)

````ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, getPool } from "./pool.js";
import { logger } from "../lib/logger.js";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");
const LOCK_ID = 727_001; // arbitrary app-wide advisory lock so two deploys can't migrate at once

export async function migrate(): Promise<string[]> {
  const client = await getPool().connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await client.query<{ id: string }>("SELECT id FROM schema_migrations")).rows.map((r) => r.id));
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
      applied.push(file);
      logger.info({ migration: file }, "migration applied");
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => undefined);
    client.release();
  }
  return applied;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  migrate()
    .then((a) => { logger.info({ applied: a.length }, a.length ? "migrations complete" : "database already up to date"); })
    .catch((err) => { logger.error({ err: err.message }, "migration failed"); process.exitCode = 1; })
    .finally(closePool);
}
````

### 4.2 Seed the 22 starter products

`server/src/db/seed.ts` — `npm run db:seed`. Re-running never resets live stock or the active flag

````ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, getPool } from "./pool.js";
import { SEED_PRODUCTS } from "./seed-data.js";
import { logger } from "../lib/logger.js";

/** Upserts the catalogue. Re-running never resets live stock levels or the active flag. */
export async function seed(): Promise<number> {
  const pool = getPool();
  for (const p of SEED_PRODUCTS) {
    await pool.query(
      `INSERT INTO products (slug, name, type, gender, price_inr, colours, images, is_new, bestseller, gift,
                             stock_qty, tagline, material, dimensions, sizes, rank)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name, type = EXCLUDED.type, gender = EXCLUDED.gender, price_inr = EXCLUDED.price_inr,
         colours = EXCLUDED.colours, images = EXCLUDED.images, is_new = EXCLUDED.is_new,
         bestseller = EXCLUDED.bestseller, gift = EXCLUDED.gift, tagline = EXCLUDED.tagline,
         material = EXCLUDED.material, dimensions = EXCLUDED.dimensions, sizes = EXCLUDED.sizes,
         rank = EXCLUDED.rank, updated_at = now()`,
      [p.slug, p.name, p.type, p.gender, p.priceInr, p.colours, p.images, p.isNew, p.bestseller, p.gift,
        p.stockQty, p.tagline, p.material, p.dimensions, p.sizes, p.rank],
    );
  }
  return SEED_PRODUCTS.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  seed()
    .then((n) => logger.info({ products: n }, "catalogue seeded"))
    .catch((err) => { logger.error({ err: err.message }, "seed failed"); process.exitCode = 1; })
    .finally(closePool);
}
````

### 4.3 Create or promote an admin with your own password

`server/src/db/create-admin.ts` — `npm run admin:create`

````ts
import { z } from "zod";
import { closePool, query } from "./pool.js";
import { hashPassword } from "../lib/passwords.js";

/**
 * Creates (or promotes) an admin account. Credentials come from the environment of this one
 * command so the password never lands in shell history or a committed file:
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_USERNAME=lli_admin ADMIN_PASSWORD='…' npm run admin:create
 *
 * ADMIN_USERNAME is optional (3–32 lowercase letters, digits or _). If the email already exists, that
 * account becomes an admin, its password (and username, when given) is replaced and its sessions are revoked.
 */
const input = z.object({
  ADMIN_EMAIL: z.string().trim().toLowerCase().pipe(z.email()),
  ADMIN_USERNAME: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,32}$/, "ADMIN_USERNAME must be 3–32 lowercase letters, digits or _").optional(),
  ADMIN_PASSWORD: z.string().min(12, "ADMIN_PASSWORD must be at least 12 characters").max(128),
  ADMIN_NAME: z.string().trim().min(1).max(80).default("Administrator"),
}).parse(process.env);

try {
  const hash = await hashPassword(input.ADMIN_PASSWORD);
  const { rows } = await query<{ id: string }>(
    `INSERT INTO users (email, username, name, password_hash, role) VALUES ($1,$2,$3,$4,'admin')
     ON CONFLICT (email) DO UPDATE
       SET role = 'admin', password_hash = EXCLUDED.password_hash, username = COALESCE(EXCLUDED.username, users.username),
           token_version = users.token_version + 1, failed_logins = 0, locked_until = NULL, updated_at = now()
     RETURNING id`,
    [input.ADMIN_EMAIL, input.ADMIN_USERNAME ?? null, input.ADMIN_NAME, hash],
  );
  await query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [rows[0]!.id]);
  console.log(`Admin ready: ${input.ADMIN_USERNAME ?? input.ADMIN_EMAIL}`);
} catch (err) {
  const e = err as { code?: string; constraint?: string; message: string };
  console.error(e.code === "23505" && e.constraint === "users_username_key" ? "Failed: that username is already taken." : `Failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
````

### 4.4 Add an admin with the default password

`server/src/db/add-admin.ts` — `npm run admin:add -- <email> [username] ["Full Name"] [--print-sql] [--promote]`

````ts
import { z } from "zod";
import { closePool, query } from "./pool.js";
import { hashPassword } from "../lib/passwords.js";

/**
 * Adds an admin account by hand. Admins can't be created from the website; this is the only way in.
 *
 *   npm run admin:add -- jane@example.com                          (email only)
 *   npm run admin:add -- jane@example.com jane_admin "Jane Doe"    (email, username, name)
 *   npm run admin:add -- jane@example.com jane_admin "Jane Doe" --print-sql
 *
 * The account gets the default password below and must choose its own at first sign-in (the admin console
 * stays locked until it does). `--print-sql` prints a ready-to-run INSERT for psql instead of touching the
 * database. `--promote` turns an existing shopper account into an admin (and resets it to the default password).
 */
const DEFAULT_PASSWORD = "Admin@2026";

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const [rawEmail, rawUsername, rawName] = args.filter((a) => !a.startsWith("--"));

const input = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email("First argument must be the admin's email address")),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,32}$/, "Username must be 3-32 lowercase letters, digits or _").optional(),
  name: z.string().trim().min(1).max(80).default("Administrator"),
}).safeParse({ email: rawEmail, username: rawUsername || undefined, name: rawName || undefined });

if (!input.success) {
  console.error(input.error.issues.map((i) => i.message).join("\n"));
  console.error('\nUsage: npm run admin:add -- <email> [username] ["Full Name"] [--print-sql] [--promote]');
  process.exit(1);
}
const { email, username, name } = input.data;
const lit = (s: string | undefined) => (s === undefined ? "NULL" : `'${s.replace(/'/g, "''")}'`);

try {
  const hash = await hashPassword(DEFAULT_PASSWORD);

  if (flags.has("--print-sql")) {
    console.log(
      "-- Run in psql against the store database. Default password: " + DEFAULT_PASSWORD + " (changed at first sign-in)\n" +
      "INSERT INTO users (email, username, name, password_hash, role, must_change_password)\n" +
      `VALUES (${lit(email)}, ${lit(username)}, ${lit(name)}, ${lit(hash)}, 'admin', true);`,
    );
  } else {
    const existing = (await query<{ id: string }>("SELECT id FROM users WHERE email = $1 OR ($2::text IS NOT NULL AND username = $2)", [email, username ?? null])).rows[0];
    if (existing && !flags.has("--promote")) {
      console.error("An account with that email or username already exists. Nothing was changed.\nUse --promote to make an existing account an admin (its password is reset to the default).");
      process.exitCode = 1;
    } else if (existing) {
      await query(
        `UPDATE users SET role = 'admin', password_hash = $2, must_change_password = true, token_version = token_version + 1,
                failed_logins = 0, locked_until = NULL, updated_at = now(), username = COALESCE($3, username)
          WHERE id = $1`,
        [existing.id, hash, username ?? null],
      );
      await query("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [existing.id]);
      console.log(`Promoted ${email} to admin. Default password set; they must change it at first sign-in.`);
    } else {
      await query(
        "INSERT INTO users (email, username, name, password_hash, role, must_change_password) VALUES ($1,$2,$3,$4,'admin',true)",
        [email, username ?? null, name, hash],
      );
      console.log(`Admin added: ${username ?? email}\nDefault password: ${DEFAULT_PASSWORD}  (they must change it at first sign-in)`);
    }
  }
} catch (err) {
  const e = err as { code?: string; constraint?: string; message: string };
  console.error(e.code === "23505" ? "Failed: that email or username is already taken." : `Failed: ${e.message}`);
  process.exitCode = 1;
} finally {
  await closePool();
}
````

### 4.5 Import the photographed catalogue

`server/src/db/import-products.ts` — `npm run products:import`

````ts
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp, { type OutputInfo } from "sharp";
import { env } from "../config/env.js";
import { parseColour, STUDIO_BACKGROUND, tintBackdrop, type Rgb } from "../lib/photo-background.js";
import { cleanHaze, type Raw } from "../lib/photo-haze.js";
import { closePool, getPool } from "./pool.js";

/**
 * Imports the photographed catalogue: optimises each photo for the web, creates or updates the products, records
 * opening stock, and registers every photo in the media library.
 *
 *   npm run products:import                 import everything (re-runnable)
 *   npm run products:import -- --dry-run    check the data and photo files, change nothing
 *   npm run products:import -- --skip-images   only the database rows (photos already processed)
 *   npm run products:import -- --force-images  re-process photos that already exist
 *   npm run products:import -- --prune      also delete image files in MEDIA_DIR that no product or library entry uses any more
 *   npm run products:import -- --overwrite-details  also reset names/descriptions/tags/colours from the data file
 *   npm run products:import -- --background=none   keep the white studio backdrop (the default is the storefront's off-white, STUDIO_BACKGROUND)
 *   npm run products:import -- --images-only       make the photo files and stop: no database change (send the files live first, then run --repoint-photos)
 *   npm run products:import -- --repoint-photos    make the photo files if needed, then only swap each product's photo paths for the new files
 *                                                  (keeps whatever order and selection of photos the admin console has set; touches nothing else)
 *
 * Prices, stock levels and the active flag of products that already exist are NEVER overwritten: those belong to
 * the admin console. The backdrop colour is applied to products still awaiting review and to the photo library; a product someone has
 * marked reviewed keeps the photos as they approved them. Data: server/data/catalogue/*.json. Photos: PRODUCT_PHOTOS_DIR (default below).
 */
const PHOTOS_DIR = process.env["PRODUCT_PHOTOS_DIR"] ?? "D:\\Leather Lux India\\DSLR Images\\New Products";
const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/catalogue");
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));
const backgroundFlag = [...flags].find((f) => f.startsWith("--background="))?.slice("--background=".length) ?? STUDIO_BACKGROUND;
const BACKGROUND: Rgb | null = backgroundFlag === "none" ? null : parseColour(backgroundFlag);

type Rect = [number, number, number, number]; // x0, y0, x1, y1 as fractions of the frame
/** `clean`: whiten the pale film the cut-out left behind (see lib/photo-haze.ts); the number is the brightness limit, 170 unless the film is darker. */
type Shot = { file: string; n: number; label: string; md5: string; crop?: Rect; erase?: Rect[]; clean?: number };
type Item = {
  sku: string; slug: string; name: string; type: string; gender: string; colours: string[]; priceInr: number; material: string; tagline: string;
  description: string; tags: string[]; sizes: string[] | null; dimensions: string; stockQty: number; reorderLevel: number; active: boolean;
  needsReview: boolean; isNew: boolean; gift: boolean; bestseller: boolean; sourceFolder: string; images: Shot[];
};
type Media = { n: number; file: string; md5: string; status: "used" | "spare" | "rejected" | "duplicate"; note: string; folders: string[] };

const products: Item[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "products.json"), "utf8"));
const media: Media[] = JSON.parse(fs.readFileSync(path.join(DATA_DIR, "media.json"), "utf8"));
const mediaRoot = env().mediaDir;

// ── image processing ─────────────────────────────────────────────────────────────────────────
// Every photo becomes a 4:5 white canvas with the product centred (so cards and galleries line up and nothing is cropped).
const SIZES = { lg: { w: 1200, h: 1500, q: 82 }, sm: { w: 480, h: 600, q: 76 } } as const;

const rawOf = (r: { data: Buffer; info: OutputInfo }): Raw => ({ data: r.data, width: r.info.width, height: r.info.height, channels: r.info.channels as 3 | 4 });
const fromRaw = (r: Raw) => sharp(r.data, { raw: { width: r.width, height: r.height, channels: r.channels } });

/** Decodes once, already shrunk (JPEG shrink-on-load keeps the 30-megapixel originals cheap) and upright. */
async function decode(input: string, crop: Shot["crop"], erase: Shot["erase"], clean: Shot["clean"]): Promise<Raw> {
  let img = rawOf(await sharp(input, { failOn: "none" }).rotate().resize({ width: 2400, height: 2400, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" }).raw().toBuffer({ resolveWithObject: true }));
  if (erase?.length) {
    const white = (w: number, h: number) => ({ create: { width: Math.max(1, w), height: Math.max(1, h), channels: 3 as const, background: "#ffffff" } });
    img = rawOf(await fromRaw(img).composite(erase.map(([x0, y0, x1, y1]) => ({
      input: white(Math.round((x1 - x0) * img.width), Math.round((y1 - y0) * img.height)), left: Math.round(x0 * img.width), top: Math.round(y0 * img.height),
    }))).raw().toBuffer({ resolveWithObject: true }));
  }
  if (crop) {
    const [x0, y0, x1, y1] = crop;
    const left = Math.max(0, Math.round(x0 * img.width)), top = Math.max(0, Math.round(y0 * img.height));
    const width = Math.min(img.width - left, Math.round((x1 - x0) * img.width)), height = Math.min(img.height - top, Math.round((y1 - y0) * img.height));
    img = rawOf(await fromRaw(img).extract({ left, top, width, height }).raw().toBuffer({ resolveWithObject: true }));
  }
  return clean ? cleanHaze(img, clean) : img;
}

/**
 * Where a photo is stored. The name holds the camera number and a hash of the source photo, plus a short tag for how it was edited
 * (crop, erase, clean). Browsers keep these files for a year, so changing an edit must change the name: they then fetch the new version.
 */
const photoRel = (dir: string, s: Pick<Shot, "n" | "md5" | "crop" | "erase" | "clean">, bg: Rgb | null = null) => {
  // The backdrop colour is part of the tag, so photos made with a different backdrop never overwrite each other; without one the name is what it always was.
  const edits = s.crop || s.erase?.length || s.clean || bg ? `-${crypto.createHash("sha1").update(JSON.stringify([s.crop ?? null, s.erase ?? null, s.clean ?? null, ...(bg ? [bg] : [])])).digest("hex").slice(0, 6)}` : "";
  return `${dir}/${s.n}-${s.md5}${edits}`;
};

/** Trims the studio backdrop, then centres the product on a white canvas of the exact size. */
async function canvas(img: Raw, size: { w: number; h: number }): Promise<Raw> {
  let subject = img;
  try { subject = rawOf(await fromRaw(img).trim({ background: "#ffffff", threshold: 14 }).raw().toBuffer({ resolveWithObject: true })); } catch { /* nothing to trim */ }
  const fitted = rawOf(await fromRaw(subject).resize({ width: Math.round(size.w * 0.9), height: Math.round(size.h * 0.9), fit: "inside" }).raw().toBuffer({ resolveWithObject: true }));
  const padX = size.w - fitted.width, padY = size.h - fitted.height;
  return rawOf(await fromRaw(fitted).extend({
    left: Math.floor(padX / 2), right: Math.ceil(padX / 2), top: Math.floor(padY / 2), bottom: Math.ceil(padY / 2), background: "#ffffff",
  }).raw().toBuffer({ resolveWithObject: true }));
}

/** Written to a temporary name first, so an interrupted run can never leave a half-written image that looks finished. */
function writeAtomic(file: string, data: Buffer) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

async function makeImage(shot: Shot, rel: string, bg: Rgb | null): Promise<{ web: string; thumb: string; made: boolean }> {
  const web = `/media/${rel}.webp`, thumb = `/media/${rel}-sm.webp`;
  const outLg = path.join(mediaRoot, `${rel}.webp`), outSm = path.join(mediaRoot, `${rel}-sm.webp`);
  if (!flags.has("--force-images") && fs.existsSync(outLg) && fs.existsSync(outSm)) return { web, thumb, made: false };
  fs.mkdirSync(path.dirname(outLg), { recursive: true });
  const onWhite = await canvas(await decode(path.join(PHOTOS_DIR, shot.file), shot.crop, shot.erase, shot.clean), SIZES.lg);
  // Photos whose openings were cleaned to white (handles, buckles, key-ring eyes) get those openings recoloured too; wallets and card cases never do.
  const lg = bg ? tintBackdrop(onWhite, bg, { holes: !!shot.clean }) : onWhite;
  writeAtomic(outLg, await fromRaw(lg).webp({ quality: SIZES.lg.q, effort: 4 }).toBuffer());
  writeAtomic(outSm, await fromRaw(lg).resize(SIZES.sm.w, SIZES.sm.h).webp({ quality: SIZES.sm.q, effort: 4 }).toBuffer());
  return { web, thumb, made: true };
}

/** Runs `fn` over `items` with at most `limit` in flight. */
async function pool<T>(items: T[], limit: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => { while (i < items.length) await fn(items[i++]!); }));
}

// ── main ─────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const missing: string[] = [];
  const allShots = [...products.flatMap((p) => p.images), ...media.filter((m) => m.status === "spare").map((m) => ({ file: m.file } as Shot))];
  if (!flags.has("--skip-images")) for (const s of allShots) if (!fs.existsSync(path.join(PHOTOS_DIR, s.file))) missing.push(s.file);
  if (missing.length) {
    console.error(`${missing.length} photo file(s) not found under ${PHOTOS_DIR}, e.g. ${missing.slice(0, 3).join(", ")}\nSet PRODUCT_PHOTOS_DIR to the folder that holds them.`);
    process.exitCode = 1;
    return;
  }
  const dupSku = products.map((p) => p.sku).filter((s, i, a) => a.indexOf(s) !== i);
  if (dupSku.length) throw new Error(`duplicate SKUs in products.json: ${dupSku.join(", ")}`);
  console.log(`${products.length} products, ${media.length} photos, source ${PHOTOS_DIR}`);
  if (flags.has("--dry-run")) { console.log("dry run: all photo files found, data valid. Nothing changed."); return; }

  // 1. photos -> optimised files. Every photo that belongs on a product, or waits in the library, has a fixed place.
  const reviewed = new Set((await getPool().query<{ slug: string }>("SELECT slug FROM products WHERE NOT needs_review")).rows.map((r) => r.slug));
  const backdropFor = (slug: string | null) => (slug && reviewed.has(slug) ? null : BACKGROUND);
  const jobs: { shot: Shot; rel: string; key: number; bg: Rgb | null; was: string }[] = [];
  for (const p of products) {
    const bg = backdropFor(p.slug);
    for (const s of p.images) jobs.push({ shot: s, rel: photoRel(`products/${p.slug}`, s, bg), was: photoRel(`products/${p.slug}`, s), bg, key: s.n });
  }
  for (const m of media.filter((x) => x.status === "spare")) {
    const bg = backdropFor(null), shot = { file: m.file, n: m.n, label: "", md5: m.md5 };
    jobs.push({ shot, rel: photoRel("library", shot, bg), was: photoRel("library", shot), bg, key: m.n });
  }
  const webPaths = new Map(jobs.map((j) => [j.key, { web: `/media/${j.rel}.webp`, thumb: `/media/${j.rel}-sm.webp` }]));
  let made = 0, reused = 0;
  if (!flags.has("--skip-images")) {
    let done = 0;
    await pool(jobs, 4, async (j) => {
      (await makeImage(j.shot, j.rel, j.bg)).made ? made++ : reused++;
      if (++done % 25 === 0 || done === jobs.length) process.stdout.write(`\r  photos ${done}/${jobs.length}`);
    });
    process.stdout.write("\n");
  }
  if (flags.has("--prune")) {
    // Delete image files that no product or library entry points to any more (replaced edits, photos taken off a product).
    const keep = new Set(jobs.flatMap((j) => [`${j.rel}.webp`, `${j.rel}-sm.webp`]));
    let removed = 0;
    for (const dir of ["products", "library"]) {
      const walk = (d: string) => {
        if (!fs.existsSync(d)) return;
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const full = path.join(d, e.name);
          if (e.isDirectory()) walk(full);
          else if (!keep.has(path.relative(mediaRoot, full).split(path.sep).join("/"))) { fs.rmSync(full); removed++; }
        }
      };
      walk(path.join(mediaRoot, dir));
    }
    console.log(`pruned ${removed} unreferenced image file(s)`);
  }

  if (flags.has("--images-only")) {
    console.log(`photos: ${made} processed, ${reused} already done. Database not touched. Send the files live, then run with --repoint-photos.`);
    return;
  }

  if (flags.has("--repoint-photos")) {
    // Swap each photo's old file name for the new one, wherever it is used. Order, selection, prices, stock: all as the admin console left them.
    const swaps = jobs.filter((j) => j.rel !== j.was);
    const client = await getPool().connect();
    let products = 0, library = 0;
    try {
      await client.query("BEGIN");
      for (const j of swaps) {
        const slug = j.rel.startsWith("products/") ? j.rel.split("/")[1]! : null;
        const [oldWeb, oldThumb, web, thumb] = [`/media/${j.was}.webp`, `/media/${j.was}-sm.webp`, `/media/${j.rel}.webp`, `/media/${j.rel}-sm.webp`];
        if (slug) products += (await client.query("UPDATE products SET images = array_replace(images, $2, $3), updated_at = now() WHERE slug = $1 AND $2 = ANY(images)", [slug, oldWeb, web])).rowCount ?? 0;
        library += (await client.query("UPDATE media_assets SET web_path = $3, thumb_path = $4, updated_at = now() WHERE web_path = $1 AND thumb_path = $2", [oldWeb, oldThumb, web, thumb])).rowCount ?? 0;
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    console.log(`photos: ${made} processed, ${reused} already done | repointed ${products} product photos and ${library} library photos to the new files (nothing else changed)`);
    console.log("If the API is running, clear its cache so it shows immediately: POST /api/admin/cache/purge (or wait up to a minute).");
    return;
  }

  // 2. products
  const pg = getPool();
  const client = await pg.connect();
  let inserted = 0, updated = 0;
  try {
    await client.query("BEGIN");
    let rank = 100;
    for (const p of products) {
      const images = p.images.map((s) => webPaths.get(s.n)!.web);
      const labels = p.images.map((s) => s.label);
      const r = await client.query<{ inserted: boolean }>(
        `INSERT INTO products (slug, name, type, gender, price_inr, colours, images, image_labels, is_new, bestseller, gift, stock_qty, tagline, material,
                               dimensions, sizes, rank, active, sku, description, tags, reorder_level, needs_review, source_folder)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
         ON CONFLICT (slug) DO UPDATE SET
           images = EXCLUDED.images, image_labels = EXCLUDED.image_labels, source_folder = EXCLUDED.source_folder,
           sku = COALESCE(products.sku, EXCLUDED.sku), updated_at = now()
           ${flags.has("--overwrite-details")
             ? `, name = EXCLUDED.name, type = EXCLUDED.type, gender = EXCLUDED.gender, colours = EXCLUDED.colours, tagline = EXCLUDED.tagline,
                  material = EXCLUDED.material, dimensions = EXCLUDED.dimensions, sizes = EXCLUDED.sizes, description = EXCLUDED.description,
                  tags = EXCLUDED.tags, is_new = EXCLUDED.is_new, gift = EXCLUDED.gift`
             : ""}
         RETURNING (xmax = 0) AS inserted`,
        [p.slug, p.name, p.type, p.gender, p.priceInr, p.colours, images, labels, p.isNew, p.bestseller, p.gift, p.stockQty, p.tagline, p.material,
          p.dimensions, p.sizes, rank++, p.active, p.sku, p.description, p.tags, p.reorderLevel, p.needsReview, p.sourceFolder],
      );
      if (r.rows[0]!.inserted) {
        inserted++;
        await client.query(
          "INSERT INTO inventory_movements (product_slug, delta, qty_after, reason, note) VALUES ($1,$2,$2,'opening_stock','Placeholder opening stock from the catalogue import: replace with a physical count')",
          [p.slug, p.stockQty],
        );
      } else updated++;
    }

    // Samples that predate SKUs get one too, so every product has an identifier.
    const { rows: bare } = await client.query<{ slug: string }>("SELECT slug FROM products WHERE sku IS NULL ORDER BY rank, slug");
    for (const [i, b] of bare.entries()) await client.query("UPDATE products SET sku = $2 WHERE slug = $1", [b.slug, `LLI-SMP-${String(i + 1).padStart(3, "0")}`]);

    // 3. media library
    const slugOf = new Map<number, string>();
    for (const p of products) for (const s of p.images) slugOf.set(s.n, p.slug);
    for (const m of media) {
      const w = (m.status === "used" || m.status === "spare") ? webPaths.get(m.n) : undefined;
      await client.query(
        `INSERT INTO media_assets (camera_no, source_file, content_hash, status, note, product_slug, web_path, thumb_path)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (source_file) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, product_slug = EXCLUDED.product_slug,
           web_path = EXCLUDED.web_path, thumb_path = EXCLUDED.thumb_path, updated_at = now()`,
        [m.n, m.file, m.md5, m.status, m.note, m.status === "used" ? (slugOf.get(m.n) ?? null) : null, w?.web ?? null, w?.thumb ?? null],
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  console.log(`products: ${inserted} added, ${updated} updated (prices, stock and visibility untouched) | photos: ${made} processed, ${reused} already done`);
  console.log("If the API is running, clear its cache so the new products show immediately: POST /api/admin/cache/purge (or wait for the cache to expire).");
}

main()
  .catch((err) => { console.error(`Import failed: ${(err as Error).message}`); process.exitCode = 1; })
  .finally(closePool);
````

### 4.6 Rollback points for the product photos

`server/src/db/images-rollback.ts` — `npm run images:rollback -- save <name>` / `restore <name> [--dry-run]`

````ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, getPool } from "./pool.js";

/**
 * Rollback points for the product photos. The photo FILES are never overwritten (a changed photo gets a new file name, see
 * import-products.ts), so what has to be remembered is which file each product and library entry pointed at. This saves exactly that
 * as a plain SQL script, and runs it again to go back.
 *
 *   npm run images:rollback -- save <name>                save the current photo paths to data/rollback/<name>/restore-images.sql
 *   npm run images:rollback -- restore <name> [--dry-run]  point every product back at the photos saved under <name>
 *
 * `--dry-run` runs the whole script and then undoes it, reporting how many rows it matched. Prices, stock, names and every other
 * column are left alone. The API keeps the catalogue in memory for up to a minute, so a restore shows on the site within that time.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/rollback");
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const arr = (a: string[]) => (a.length ? `ARRAY[${a.map(lit).join(", ")}]::text[]` : "'{}'::text[]");
const nullable = (s: string | null) => (s === null ? "NULL" : lit(s));

const [, , cmd, name, ...rest] = process.argv;
const dir = name ? path.join(ROOT, name) : "";
const file = path.join(dir, "restore-images.sql");

async function save() {
  const pool = getPool();
  const products = (await pool.query<{ slug: string; images: string[]; image_labels: string[] }>("SELECT slug, images, image_labels FROM products ORDER BY slug")).rows;
  const media = (await pool.query<{ source_file: string; web_path: string | null; thumb_path: string | null }>("SELECT source_file, web_path, thumb_path FROM media_assets ORDER BY source_file")).rows;
  const lines = [
    `-- Rollback point "${name}": the photo paths of ${products.length} products and ${media.length} library photos, saved ${new Date().toISOString()}.`,
    "-- Run with: npm run images:rollback -- restore " + name + "   (add --dry-run first to see what it would do)",
    "-- Only the photo columns are touched: images and image_labels of products, web_path and thumb_path of media_assets.",
    "BEGIN;",
    ...products.map((p) => `UPDATE products SET images = ${arr(p.images)}, image_labels = ${arr(p.image_labels)}, updated_at = now() WHERE slug = ${lit(p.slug)};`),
    ...media.map((m) => `UPDATE media_assets SET web_path = ${nullable(m.web_path)}, thumb_path = ${nullable(m.thumb_path)}, updated_at = now() WHERE source_file = ${lit(m.source_file)};`),
    "COMMIT;",
    "",
  ];
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  console.log(`Saved ${products.length} products and ${media.length} library photos to ${path.relative(process.cwd(), file)}`);
}

async function restore() {
  if (!fs.existsSync(file)) throw new Error(`No rollback point named "${name}" (looked for ${file})`);
  const statements = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.startsWith("UPDATE "));
  const client = await getPool().connect();
  let matched = 0, missed = 0;
  try {
    await client.query("BEGIN");
    for (const sql of statements) {
      const r = await client.query(sql);
      if (r.rowCount) matched++; else missed++;
    }
    await client.query(rest.includes("--dry-run") ? "ROLLBACK" : "COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  console.log(`${rest.includes("--dry-run") ? "Dry run (nothing changed): " : "Restored: "}${matched} rows matched, ${missed} not found (rows added since the rollback point are not touched).`);
}

try {
  if (!name || !/^[a-z0-9][a-z0-9._-]*$/i.test(name) || (cmd !== "save" && cmd !== "restore")) {
    throw new Error("Usage: npm run images:rollback -- save <name>   |   restore <name> [--dry-run]");
  }
  await (cmd === "save" ? save() : restore());
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
} finally {
  await closePool();
}
````

---

## 5. Code that connects to the database

### 5.1 Connection pool and TLS settings

`server/src/db/pool.ts`

````ts
import fs from "node:fs";
import pg from "pg";
import type { QueryResultRow } from "pg";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";

let pool: pg.Pool | undefined;

function sslConfig(): pg.ConnectionConfig["ssl"] {
  const e = env();
  if (e.DB_SSL_MODE === "disable") return false;
  const ca = e.DB_SSL_CA ? e.DB_SSL_CA.replace(/\\n/g, "\n") : e.DB_SSL_CA_PATH ? fs.readFileSync(e.DB_SSL_CA_PATH, "utf8") : undefined;
  return {
    // `require` encrypts but does not authenticate the server (typical self-signed EC2 cert).
    // `verify-full` authenticates the certificate chain and the hostname.
    rejectUnauthorized: e.DB_SSL_MODE === "verify-full",
    ...(ca ? { ca } : {}),
    ...(e.DB_SSL_SERVERNAME ? { servername: e.DB_SSL_SERVERNAME } : {}),
    minVersion: "TLSv1.2",
  };
}

export function getPool(): pg.Pool {
  if (pool) return pool;
  const e = env();
  if (e.DB_SSL_MODE === "require") {
    logger.warn("DB_SSL_MODE=require: traffic to Postgres is encrypted but the server is not verified. Use verify-full with DB_SSL_CA (or DB_SSL_CA_PATH).");
  }
  pool = new pg.Pool({
    host: e.DB_HOST,
    port: e.DB_PORT,
    database: e.DB_NAME,
    user: e.DB_USER,
    password: e.DB_PASSWORD,
    ssl: sslConfig(),
    max: e.DB_POOL_MAX,
    idleTimeoutMillis: e.DB_POOL_IDLE_MS,
    connectionTimeoutMillis: e.DB_CONNECT_TIMEOUT_MS,
    statement_timeout: e.DB_STATEMENT_TIMEOUT_MS,
    query_timeout: e.DB_STATEMENT_TIMEOUT_MS + 2000,
    idle_in_transaction_session_timeout: e.DB_STATEMENT_TIMEOUT_MS * 2,
    application_name: "llx-api",
  });
  // An idle client erroring (e.g. EC2 restarts Postgres) must not crash the process.
  pool.on("error", (err) => logger.error({ err: { message: err.message, code: (err as NodeJS.ErrnoException).code } }, "idle postgres client error"));
  return pool;
}

export type Queryable = Pick<pg.Pool | pg.PoolClient, "query">;

/** Statements issued through `query()` since start. Lets the admin cache report show how many database calls caching avoided. */
export const dbStats = { queries: 0 };

/** Always use parameter placeholders ($1, $2, …); never interpolate user input into `text`. */
export async function query<R extends QueryResultRow = QueryResultRow>(text: string, params: unknown[] = [], q: Queryable = getPool()) {
  dbStats.queries++;
  return q.query<R>(text, params);
}

export async function withTx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (!pool) return;
  const p = pool;
  pool = undefined;
  await p.end();
}
````

### 5.2 Connection check

`server/src/db/check.ts` — `npm run db:check`

````ts
import { env } from "../config/env.js";
import { closePool, getPool } from "./pool.js";

/** `npm run db:check` — verifies .env can reach the EC2 Postgres instance, over TLS, with the right role. */
async function main() {
  const e = env();
  console.log(`Connecting to ${e.DB_HOST}:${e.DB_PORT}/${e.DB_NAME} as ${e.DB_USER} (ssl: ${e.DB_SSL_MODE}) …`);
  const pool = getPool();
  const { rows } = await pool.query<{ version: string; ssl: boolean | null; me: string }>(
    `SELECT version(), (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS ssl, current_user AS me`,
  );
  const r = rows[0]!;
  console.log(`OK  ${r.version.split(",")[0]}`);
  console.log(`    role: ${r.me}   tls: ${r.ssl ? "yes" : "NO"}`);
  if (!r.ssl && e.DB_SSL_MODE !== "disable") console.warn("    warning: connection is not encrypted");
}

main()
  .catch((err: NodeJS.ErrnoException) => {
    // Never print the password; pg errors don't include it, but keep output minimal anyway.
    console.error(`FAILED: ${err.code ?? ""} ${err.message}`);
    console.error("Check DB_HOST/DB_PORT, the EC2 security group (port 5432 from this machine), pg_hba.conf, and DB_SSL_* settings.");
    process.exitCode = 1;
  })
  .finally(closePool);
````

### 5.3 Print the database certificate for pinning

`server/src/db/print-ca.ts` — `npm run db:ca`

````ts
import { env } from "../config/env.js";
import pg from "pg";

/**
 * Prints the certificate the database presents, in the form the API's settings take it (DB_SSL_CA), plus the name to put in
 * DB_SSL_SERVERNAME. With both set and DB_SSL_MODE=verify-full the API accepts only THAT certificate, so nobody sitting between
 * Vercel and the database can pretend to be it.
 *
 *   npm run db:ca
 *
 * This takes the certificate on trust at this moment, as ssh does the first time you connect. For the strongest assurance run it
 * on the database server itself, or compare the fingerprint it prints with `openssl x509 -noout -fingerprint -sha256 -in <ssl_cert_file>` there.
 */
const e = env();
const client = new pg.Client({
  host: e.DB_HOST, port: e.DB_PORT, database: e.DB_NAME, user: e.DB_USER, password: e.DB_PASSWORD,
  ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15_000,
});
try {
  await client.connect();
  const socket = (client as unknown as { connection: { stream: { getPeerCertificate: (detailed: boolean) => { raw: Buffer; subject: { CN?: string }; fingerprint256: string; valid_to: string } } } }).connection.stream;
  const cert = socket.getPeerCertificate(true);
  const pem = `-----BEGIN CERTIFICATE-----\n${cert.raw.toString("base64").replace(/(.{64})/g, "$1\n").trim()}\n-----END CERTIFICATE-----`;
  console.log(`Certificate presented by the database (valid until ${cert.valid_to}):`);
  console.log(`  name (CN)    : ${cert.subject.CN ?? "(none)"}`);
  console.log(`  fingerprint  : ${cert.fingerprint256}\n`);
  console.log("Settings for the API (in Vercel's Environment Variables, or server/.env):\n");
  console.log("DB_SSL_MODE=verify-full");
  console.log(`DB_SSL_SERVERNAME=${cert.subject.CN ?? ""}`);
  console.log("DB_SSL_CA=" + pem.replace(/\n/g, "\\n"));
  console.log("\n(The DB_SSL_CA value is one line with \\n for the line breaks. It is a public certificate, not a secret.)");
} catch (err) {
  console.error(`Could not connect: ${(err as Error).message}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
````

### 5.4 Rate-limit store (SQL on `rate_limits`)

`server/src/middleware/pg-rate-limit-store.ts` — used when `RATE_LIMIT_STORE=postgres`

````ts
import type { ClientRateLimitInfo, Options, Store } from "express-rate-limit";
import { query } from "../db/pool.js";

/**
 * A rate-limit store in Postgres, shared by every server instance (express-rate-limit's default keeps counts in each process's memory).
 * One atomic statement per request: it starts a window on the first hit, counts within it, and starts a fresh one once it has ended.
 * The `prefix` keeps the limiters apart (a login attempt and a newsletter signup from one address are counted separately).
 */
export class PgRateLimitStore implements Store {
  /** Counters are shared between instances, so the library must not assume it can reset them locally. */
  readonly localKeys = false;
  private windowMs = 60_000;
  readonly prefix: string;

  constructor(name: string) { this.prefix = `${name}:`; }

  init(options: Options) { this.windowMs = options.windowMs; }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    const { rows } = await query<{ hits: number; reset_at: Date }>(
      `INSERT INTO rate_limits (key, hits, reset_at) VALUES ($1, 1, now() + ($2 * interval '1 millisecond'))
       ON CONFLICT (key) DO UPDATE SET
         hits     = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.hits + 1 END,
         reset_at = CASE WHEN rate_limits.reset_at <= now() THEN now() + ($2 * interval '1 millisecond') ELSE rate_limits.reset_at END
       RETURNING hits, reset_at`,
      [this.prefix + key, this.windowMs],
    );
    // Housekeeping on about 1 request in 100, so the table never grows without a separate job.
    if (Math.random() < 0.01) void query("DELETE FROM rate_limits WHERE reset_at < now() - interval '1 hour'").catch(() => undefined);
    return { totalHits: rows[0]!.hits, resetTime: rows[0]!.reset_at };
  }

  async decrement(key: string): Promise<void> {
    await query("UPDATE rate_limits SET hits = greatest(hits - 1, 0) WHERE key = $1", [this.prefix + key]);
  }

  async resetKey(key: string): Promise<void> {
    await query("DELETE FROM rate_limits WHERE key = $1", [this.prefix + key]);
  }
}
````

### 5.5 Visit log writer and retention (SQL on `visit_log`)

`server/src/lib/visit-log.ts` — writes one row per page view and deletes entries older than `VISIT_LOG_RETENTION_DAYS` (365)

````ts
import { isIP } from "node:net";
import type { Request } from "express";
import { env } from "../config/env.js";
import { query } from "../db/pool.js";
import { logger } from "./logger.js";

/**
 * The visit log (table visit_log, migration 009): the address, page, date and time of every page view, as reported by the storefront.
 * See docs/visit-log.md for what is stored, why, and how to read it.
 */

/** Crawlers, uptime monitors and link-preview fetchers: logged, but marked so they can be left out of any count. */
export const NOT_A_PERSON = /bot|crawl|spider|slurp|headless|lighthouse|pingdom|uptime|monitor|preview|curl|wget|python|httpclient|axios|node-fetch/i;

/**
 * The visitor's address. Express works it out from the platform's forwarding header (TRUST_PROXY says how many proxies to believe, so a visitor
 * cannot choose their own), and a plain IPv4 address that arrives in IPv6 clothing (::ffff:203.0.113.7) is written as IPv4. Null if it is not an address.
 */
export function clientIp(req: Pick<Request, "ip">): string | null {
  const raw = (req.ip ?? "").replace(/^::ffff:/i, "").trim();
  return isIP(raw) ? raw : null;
}

/** "/products/aria-top-handle?x=1#top" → "/products/aria-top-handle". Null for anything that is not a plain page path. */
export function cleanPath(raw: string): string | null {
  const p = raw.split(/[?#]/)[0] ?? "";
  return p.startsWith("/") && !p.startsWith("//") && p.length <= 300 && !/[\s\u0000-\u001f\u007f]/.test(p) ? p : null;
}

/** The site a visitor came from, reduced to its address ("https://www.google.com"): never the page or the search words in it. Null if not a plain web address. */
export function cleanReferrer(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return (u.protocol === "https:" || u.protocol === "http:") && u.origin.length <= 300 ? u.origin : null;
  } catch {
    return null;
  }
}

export type PageView = { ip: string; path: string; referrer: string | null; userAgent: string | null; at?: Date };

export async function recordPageView(v: PageView): Promise<void> {
  const ua = v.userAgent ? v.userAgent.slice(0, 400) : null;
  await query(
    "INSERT INTO visit_log (visited_at, ip, path, referrer, user_agent, is_bot) VALUES (COALESCE($1, now()), $2, $3, $4, $5, $6)",
    [v.at ?? null, v.ip, v.path, v.referrer, ua, !ua || NOT_A_PERSON.test(ua)],
  );
  // Housekeeping on about 1 request in 200, in small batches, so the table does not grow for ever and no request waits on a big delete.
  if (Math.random() < 1 / 200) void pruneVisitLog().catch((err) => logger.warn({ err: (err as Error).message }, "visit log pruning failed"));
}

/** Deletes entries older than the retention period (VISIT_LOG_RETENTION_DAYS; 0 keeps everything). Returns how many were deleted. */
export async function pruneVisitLog(now = new Date()): Promise<number> {
  const days = env().VISIT_LOG_RETENTION_DAYS;
  if (days <= 0) return 0;
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const r = await query("DELETE FROM visit_log WHERE id IN (SELECT id FROM visit_log WHERE visited_at < $1 ORDER BY visited_at LIMIT 5000)", [cutoff]);
  return r.rowCount ?? 0;
}
````

### 5.6 Visitor counter and visit-log routes (SQL on `site_counters`)

`server/src/routes/visits.ts` — `POST /api/visits` adds one to the counter; `POST /api/visits/log` records a page view

````ts
import { Router } from "express";
import { z } from "zod";
import { query } from "../db/pool.js";
import { visitsCache } from "../lib/caches.js";
import { clientIp, cleanPath, cleanReferrer, NOT_A_PERSON, recordPageView } from "../lib/visit-log.js";
import { pageViewLimiter, visitLimiter } from "../middleware/rate-limit.js";

/**
 * "Total visitors" in the storefront footer: a counter that goes up by one every time a page is loaded or refreshed (the browser reports it
 * once per page load). It does not try to tell people apart, so nothing about the visitor is kept: no id, address or browser details, only the
 * number. (The visit log further down is separate, and does keep the address: that is its job.) It is a simple counter, not analytics.
 */
export const visitsRouter = Router();

// (Crawlers, uptime monitors and link-preview fetchers would otherwise inflate the number: NOT_A_PERSON, in lib/visit-log.ts.)

const total = () => visitsCache.get("total", async () => Number((await query<{ n: string }>("SELECT value AS n FROM site_counters WHERE name = 'page_loads'")).rows[0]?.n ?? 0));

visitsRouter.get("/", async (_req, res) => {
  res.set("Cache-Control", "public, max-age=15");
  res.json({ total: await total() });
});

visitsRouter.post("/", visitLimiter(), async (req, res) => {
  res.set("Cache-Control", "no-store");
  const ua = req.get("user-agent") ?? "";
  if (!ua || NOT_A_PERSON.test(ua)) {
    res.json({ total: await total(), counted: false });
    return;
  }
  // One atomic statement, so many pages loading at the same moment each add exactly one.
  const { rows } = await query<{ value: string }>(
    `INSERT INTO site_counters (name, value) VALUES ('page_loads', 1)
     ON CONFLICT (name) DO UPDATE SET value = site_counters.value + 1, updated_at = now()
     RETURNING value`,
  );
  const value = Number(rows[0]!.value);
  visitsCache.invalidate(); // a later read of the total must not show the number from before this load
  res.json({ total: value, counted: true });
});

/**
 * The visit log: the storefront reports every page view here (the first page of a visit and each page after it), and one row is written with the
 * visitor's IP address, the page, the date and time, their browser and, on the first page, the site they came from. Crawlers are logged too, marked.
 * Nothing is read back through the public API; the table is for the shop owner (docs/visit-log.md).
 */
const pageView = z.object({
  path: z.string().max(400).transform((p, ctx) => {
    const clean = cleanPath(p);
    if (clean) return clean;
    ctx.addIssue({ code: "custom", message: "A page path starts with / and has no spaces" });
    return z.NEVER;
  }),
  referrer: z.string().max(600).optional(),
});

visitsRouter.post("/log", pageViewLimiter(), async (req, res) => {
  const { path, referrer } = pageView.parse(req.body);
  const ip = clientIp(req);
  if (ip) await recordPageView({ ip, path, referrer: cleanReferrer(referrer), userAgent: req.get("user-agent") ?? null });
  res.status(204).end(); // nothing to tell the browser, and nothing it should wait for
});
````

---

## 6. Backup and restore

### 6.1 Nightly backup

`server/deploy/backup-db.sh` — install and schedule as described below

````bash
#!/usr/bin/env bash
# Nightly backup of the LLX Postgres database. Keeps the last 14 days. Install and test: deploy/README.md, "Backups".
#
# Reads the database settings from the API's own .env, so there is no second copy of the password to look after.
# Run it as root (it is installed in root's crontab): root can read the .env, and the dumps are readable by root only.
set -euo pipefail

ENV_FILE="${LLX_ENV_FILE:-/opt/llx/app/server/.env}"
DEST="${LLX_BACKUP_DIR:-/var/backups/llx}"
KEEP_DAYS="${LLX_BACKUP_KEEP_DAYS:-14}"

[ -r "$ENV_FILE" ] || { echo "cannot read $ENV_FILE" >&2; exit 1; }
# One KEY=value from the .env (the production template has no inline comments).
get() { grep -E "^$1=" "$ENV_FILE" | head -n 1 | cut -d= -f2- | tr -d '\r'; }

export PGHOST="$(get DB_HOST)" PGPORT="$(get DB_PORT)" PGDATABASE="$(get DB_NAME)" PGUSER="$(get DB_USER)" PGPASSWORD="$(get DB_PASSWORD)"
export PGSSLMODE="$(get DB_SSL_MODE)"
[ -n "$PGDATABASE" ] && [ -n "$PGUSER" ] && [ -n "$PGPASSWORD" ] || { echo "database settings missing in $ENV_FILE" >&2; exit 1; }

umask 077
mkdir -p "$DEST"
file="$DEST/llx-$(date +%Y-%m-%d_%H%M).dump"
# Written under a temporary name first, so a half-finished dump is never mistaken for a backup.
pg_dump --format=custom --no-owner --file="$file.partial"
mv "$file.partial" "$file"
find "$DEST" -name 'llx-*.dump' -mtime +"$KEEP_DAYS" -delete

echo "$(date -Is) backup written: $file ($(du -h "$file" | cut -f1))"
````

````bash
# install and try once, on the database server
cd /opt/llx/app/server
sudo cp deploy/backup-db.sh /usr/local/bin/llx-backup && sudo chmod 750 /usr/local/bin/llx-backup
sudo /usr/local/bin/llx-backup
sudo crontab -e        # then add this line (2 a.m. every night):
#   0 2 * * * /usr/local/bin/llx-backup >> /var/log/llx-backup.log 2>&1
````

### 6.2 Test restore (do this once; a backup you have never restored is a hope)

````bash
sudo -u postgres createdb llx_restore_test
sudo -u postgres pg_restore --no-owner -d llx_restore_test /var/backups/llx/llx-<date>.dump
sudo -u postgres psql llx_restore_test -c "select count(*) from products"
sudo -u postgres dropdb llx_restore_test
````

---

## 7. Everyday SQL (from `server/README.md`)

````sql
UPDATE products SET price_inr = 2490, needs_review = false WHERE sku = 'LLI-WAL-001';
UPDATE products SET cost_inr = 900 WHERE type = 'Wallets';
UPDATE products SET active = false WHERE sku LIKE 'LLI-SMP-%';        -- hide the 22 starter products
UPDATE products SET availability = 'coming_soon' WHERE sku = 'LLI-WAL-001';   -- or 'inactive' (shows as out of stock) or 'active'
UPDATE products SET hover_effect = 'zoom' WHERE type = 'Belts';              -- swap | slide | zoom | none
````
````sql
-- the visit log (see docs/visit-log.md for more): the latest 50 page views, in Indian time
SELECT visited_at AT TIME ZONE 'Asia/Kolkata' AS time_ist, ip, path, is_bot FROM visit_log ORDER BY visited_at DESC LIMIT 50;
-- everything one address looked at
SELECT visited_at AT TIME ZONE 'Asia/Kolkata' AS time_ist, path FROM visit_log WHERE ip = '203.0.113.7' ORDER BY visited_at;
-- per day: page views and different addresses (people only)
SELECT (visited_at AT TIME ZONE 'Asia/Kolkata')::date AS day, count(*) AS page_views, count(DISTINCT ip) AS addresses
  FROM visit_log WHERE NOT is_bot GROUP BY 1 ORDER BY 1 DESC;
-- remove one address (a deletion request)
DELETE FROM visit_log WHERE ip = '203.0.113.7';
-- the footer number
SELECT value FROM site_counters WHERE name = 'page_loads';
````

A stock count changed with plain SQL is not on the ledger (`inventory_movements`); use the admin console's Inventory page when the
history matters. After any SQL change, `POST /api/admin/cache/purge` (or wait up to a minute) makes it show on the site.

---

## 8. Data files that are not inlined

These feed the scripts above. They are data, not scripts, and are large, so they stay in the repository:

| File | What it is | Used by |
| --- | --- | --- |
| `server/src/db/seed-data.ts` | the 22 starter products (inlined below) | `db:seed` |
| `server/data/catalogue/products.json` (about 105 KB) | the 76 photographed products: SKU, price, colours, copy, photos and their edits | `products:import` |
| `server/data/catalogue/media.json` (about 80 KB) | every photo from the shoot and its status (used, spare, rejected, duplicate) | `products:import` |
| `server/data/catalogue/REPORT.md` | the written summary of the import | reading only |
| `server/data/rollback/<name>/restore-images.sql` (about 130 KB) | one `UPDATE` per product and library photo, written by `images:rollback save`; the first point is `white-backgrounds-2026-11-02` | `images:rollback restore` |

### 8.1 Starter products

`server/src/db/seed-data.ts` — the data `db:seed` loads

````ts
// Generated from src/lib/catalog.ts. `images` are keys of the frontend's `images` map, not URLs.
export type SeedProduct = {
  slug: string; name: string; type: string; gender: "women" | "men" | "unisex"; priceInr: number;
  colours: string[]; images: string[]; isNew: boolean; bestseller: boolean; gift: boolean;
  stockQty: number; tagline: string; material: string; dimensions: string; sizes: string[] | null; rank: number;
};

export const SEED_PRODUCTS: SeedProduct[] = [
  {
    "slug": "aria-top-handle",
    "name": "Aria Top-Handle",
    "type": "Handbags",
    "gender": "women",
    "priceInr": 14990,
    "colours": [
      "Oxblood",
      "Ink",
      "Taupe"
    ],
    "images": [
      "handbag",
      "hero",
      "texture"
    ],
    "isNew": true,
    "bestseller": true,
    "gift": false,
    "stockQty": 25,
    "tagline": "A sculpted top-handle with a brass turn-lock and a detachable strap.",
    "material": "Smooth leather, textile lining, antique brass-tone hardware",
    "dimensions": "24 × 19 × 11 cm",
    "sizes": null,
    "rank": 0
  },
  {
    "slug": "meridian-tote",
    "name": "Meridian Tote",
    "type": "Totes",
    "gender": "women",
    "priceInr": 12490,
    "colours": [
      "Taupe",
      "Ink"
    ],
    "images": [
      "tote",
      "women",
      "texture"
    ],
    "isNew": true,
    "bestseller": false,
    "gift": false,
    "stockQty": 25,
    "tagline": "An open, softly structured tote sized for a working day.",
    "material": "Pebbled leather, unlined interior with zip pocket",
    "dimensions": "38 × 30 × 14 cm",
    "sizes": null,
    "rank": 1
  },
  {
    "slug": "halden-satchel",
    "name": "Halden Saddle Crossbody",
    "type": "Crossbody",
    "gender": "women",
    "priceInr": 8990,
    "colours": [
      "Ink",
      "Cognac"
    ],
    "images": [
      "crossbody",
      "women",
      "texture"
    ],
    "isNew": false,
    "bestseller": true,
    "gift": false,
    "stockQty": 3,
    "tagline": "A rounded saddle shape with a push-lock and adjustable strap.",
    "material": "Smooth leather, microfibre lining, brass-tone hardware",
    "dimensions": "22 × 16 × 7 cm",
    "sizes": null,
    "rank": 2
  },
  {
    "slug": "solenne-mini",
    "name": "Solenne Mini Bag",
    "type": "Handbags",
    "gender": "women",
    "priceInr": 5490,
    "colours": [
      "Oxblood",
      "Porcelain"
    ],
    "images": [
      "handbag",
      "texture",
      "hero"
    ],
    "isNew": true,
    "bestseller": false,
    "gift": true,
    "stockQty": 25,
    "tagline": "The Aria silhouette, reduced to hold the essentials.",
    "material": "Smooth leather, textile lining",
    "dimensions": "16 × 12 × 7 cm",
    "sizes": null,
    "rank": 3
  },
  {
    "slug": "corbel-briefcase",
    "name": "Corbel Slim Briefcase",
    "type": "Laptop & Work",
    "gender": "men",
    "priceInr": 14990,
    "colours": [
      "Ink",
      "Espresso"
    ],
    "images": [
      "brief",
      "men",
      "texture"
    ],
    "isNew": false,
    "bestseller": true,
    "gift": false,
    "stockQty": 25,
    "tagline": "A clean-lined briefcase with a padded sleeve for 14\" laptops.",
    "material": "Grained leather, padded laptop sleeve, gunmetal-tone hardware",
    "dimensions": "39 × 29 × 8 cm",
    "sizes": null,
    "rank": 4
  },
  {
    "slug": "atlas-weekender",
    "name": "Atlas Weekender",
    "type": "Travel",
    "gender": "unisex",
    "priceInr": 21990,
    "colours": [
      "Ink",
      "Cognac"
    ],
    "images": [
      "travel",
      "texture",
      "brief"
    ],
    "isNew": true,
    "bestseller": false,
    "gift": false,
    "stockQty": 3,
    "tagline": "A generous holdall for two nights away, with a detachable strap.",
    "material": "Grained leather, cotton-blend lining, brass-tone hardware",
    "dimensions": "52 × 30 × 26 cm",
    "sizes": null,
    "rank": 5
  },
  {
    "slug": "verso-backpack",
    "name": "Verso Backpack",
    "type": "Backpacks",
    "gender": "unisex",
    "priceInr": 11490,
    "colours": [
      "Espresso",
      "Ink"
    ],
    "images": [
      "backpack",
      "men",
      "texture"
    ],
    "isNew": false,
    "bestseller": true,
    "gift": false,
    "stockQty": 25,
    "tagline": "A rounded city backpack with a front zip pocket and laptop sleeve.",
    "material": "Smooth leather, textile lining",
    "dimensions": "30 × 42 × 14 cm",
    "sizes": null,
    "rank": 6
  },
  {
    "slug": "linea-bifold",
    "name": "Linea Bifold Wallet",
    "type": "Wallets",
    "gender": "men",
    "priceInr": 2490,
    "colours": [
      "Ink",
      "Espresso",
      "Cognac"
    ],
    "images": [
      "wallet",
      "slg",
      "texture"
    ],
    "isNew": false,
    "bestseller": true,
    "gift": true,
    "stockQty": 25,
    "tagline": "Six card slots and a full-length note section in a slim fold.",
    "material": "Smooth leather, leather interior",
    "dimensions": "11 × 9.5 × 1.5 cm",
    "sizes": null,
    "rank": 7
  },
  {
    "slug": "plinth-card-case",
    "name": "Plinth Card Case",
    "type": "Card Cases",
    "gender": "unisex",
    "priceInr": 1790,
    "colours": [
      "Oxblood",
      "Ink",
      "Taupe"
    ],
    "images": [
      "belt",
      "slg",
      "texture"
    ],
    "isNew": false,
    "bestseller": true,
    "gift": true,
    "stockQty": 25,
    "tagline": "Four slots and a centre pocket, cut close to the cards.",
    "material": "Smooth leather, painted edges",
    "dimensions": "10.5 × 8 × 0.6 cm",
    "sizes": null,
    "rank": 8
  },
  {
    "slug": "arc-belt-35",
    "name": "Arc Belt 35mm",
    "type": "Belts",
    "gender": "men",
    "priceInr": 3490,
    "colours": [
      "Ink",
      "Cognac"
    ],
    "images": [
      "belt",
      "slg",
      "texture"
    ],
    "isNew": false,
    "bestseller": false,
    "gift": true,
    "stockQty": 25,
    "tagline": "A 35mm everyday belt with an antique brass-tone buckle.",
    "material": "Smooth leather, brass-tone buckle",
    "dimensions": "Width 3.5 cm",
    "sizes": [
      "80",
      "85",
      "90",
      "95",
      "100",
      "105"
    ],
    "rank": 9
  },
  {
    "slug": "fine-belt-20",
    "name": "Fine Belt 20mm",
    "type": "Belts",
    "gender": "women",
    "priceInr": 2990,
    "colours": [
      "Ink",
      "Oxblood",
      "Taupe"
    ],
    "images": [
      "belt",
      "women",
      "texture"
    ],
    "isNew": true,
    "bestseller": false,
    "gift": false,
    "stockQty": 25,
    "tagline": "A narrow belt for tailoring and knitwear.",
    "material": "Smooth leather, brass-tone buckle",
    "dimensions": "Width 2 cm",
    "sizes": [
      "70",
      "75",
      "80",
      "85",
      "90"
    ],
    "rank": 10
  },
  {
    "slug": "tessera-key-loop",
    "name": "Tessera Key Loop",
    "type": "Key Accessories",
    "gender": "unisex",
    "priceInr": 590,
    "colours": [
      "Cognac",
      "Ink",
      "Oxblood"
    ],
    "images": [
      "slg",
      "texture",
      "wallet"
    ],
    "isNew": false,
    "bestseller": false,
    "gift": true,
    "stockQty": 25,
    "tagline": "A folded leather tab on a solid brass-tone ring.",
    "material": "Smooth leather, brass-tone ring",
    "dimensions": "9 × 3 cm",
    "sizes": null,
    "rank": 11
  },
  {
    "slug": "coin-pouch",
    "name": "Ovale Coin Pouch",
    "type": "Pouches",
    "gender": "unisex",
    "priceInr": 990,
    "colours": [
      "Oxblood",
      "Ink"
    ],
    "images": [
      "slg",
      "texture",
      "belt"
    ],
    "isNew": false,
    "bestseller": false,
    "gift": true,
    "stockQty": 25,
    "tagline": "A small zipped pouch for coins, earphones or keys.",
    "material": "Smooth leather, zip closure",
    "dimensions": "11 × 8 cm",
    "sizes": null,
    "rank": 12
  },
  {
    "slug": "folio-pouch",
    "name": "Folio Document Pouch",
    "type": "Pouches",
    "gender": "unisex",
    "priceInr": 4290,
    "colours": [
      "Ink",
      "Taupe"
    ],
    "images": [
      "brief",
      "texture",
      "men"
    ],
    "isNew": false,
    "bestseller": false,
    "gift": false,
    "stockQty": 25,
    "tagline": "A flat zipped folio for tablets and papers.",
    "material": "Grained leather, textile lining",
    "dimensions": "34 × 25 cm",
    "sizes": null,
    "rank": 13
  },
  {
    "slug": "zip-around-wallet",
    "name": "Linea Zip-Around Wallet",
    "type": "Wallets",
    "gender": "women",
    "priceInr": 3990,
    "colours": [
      "Oxblood",
      "Ink",
      "Porcelain"
    ],
    "images": [
      "wallet",
      "slg",
      "texture"
    ],
    "isNew": true,
    "bestseller": false,
    "gift": true,
    "stockQty": 25,
    "tagline": "Twelve card slots, a coin compartment and a smooth zip.",
    "material": "Smooth leather, leather interior",
    "dimensions": "19 × 10 × 2 cm",
    "sizes": null,
    "rank": 14
  },
  {
    "slug": "travel-card-holder",
    "name": "Transit Card Holder",
    "type": "Card Cases",
    "gender": "men",
    "priceInr": 1290,
    "colours": [
      "Ink",
      "Espresso"
    ],
    "images": [
      "slg",
      "wallet",
      "texture"
    ],
    "isNew": false,
    "bestseller": false,
    "gift": false,
    "stockQty": 0,
    "tagline": "A slim two-slot holder with a thumb cut-out.",
    "material": "Smooth leather",
    "dimensions": "10 × 7 cm",
    "sizes": null,
    "rank": 15
  },
  {
    "slug": "rue-shoulder",
    "name": "Rue Shoulder Bag",
    "type": "Handbags",
    "gender": "women",
    "priceInr": 10990,
    "colours": [
      "Ink",
      "Oxblood"
    ],
    "images": [
      "women",
      "handbag",
      "texture"
    ],
    "isNew": false,
    "bestseller": true,
    "gift": false,
    "stockQty": 25,
    "tagline": "A slouched shoulder bag that sits close under the arm.",
    "material": "Soft leather, suede-effect lining",
    "dimensions": "30 × 18 × 9 cm",
    "sizes": null,
    "rank": 16
  },
  {
    "slug": "nomad-sling",
    "name": "Nomad Sling",
    "type": "Crossbody",
    "gender": "men",
    "priceInr": 4990,
    "colours": [
      "Ink",
      "Espresso"
    ],
    "images": [
      "crossbody",
      "men",
      "texture"
    ],
    "isNew": true,
    "bestseller": false,
    "gift": false,
    "stockQty": 25,
    "tagline": "A compact crossbody for phone, wallet and passport.",
    "material": "Grained leather, textile lining",
    "dimensions": "24 × 15 × 5 cm",
    "sizes": null,
    "rank": 17
  },
  {
    "slug": "ledger-laptop-tote",
    "name": "Ledger Work Tote",
    "type": "Laptop & Work",
    "gender": "women",
    "priceInr": 13490,
    "colours": [
      "Ink",
      "Taupe"
    ],
    "images": [
      "women",
      "tote",
      "texture"
    ],
    "isNew": false,
    "bestseller": false,
    "gift": false,
    "stockQty": 3,
    "tagline": "A structured tote with a padded laptop sleeve and zip top.",
    "material": "Pebbled leather, padded sleeve, textile lining",
    "dimensions": "40 × 30 × 13 cm",
    "sizes": null,
    "rank": 18
  },
  {
    "slug": "dossier-messenger",
    "name": "Dossier Messenger",
    "type": "Laptop & Work",
    "gender": "men",
    "priceInr": 12990,
    "colours": [
      "Espresso",
      "Ink"
    ],
    "images": [
      "men",
      "brief",
      "texture"
    ],
    "isNew": false,
    "bestseller": false,
    "gift": false,
    "stockQty": 25,
    "tagline": "A flapped messenger with magnetic closures.",
    "material": "Grained leather, textile lining",
    "dimensions": "38 × 28 × 9 cm",
    "sizes": null,
    "rank": 19
  },
  {
    "slug": "cabin-duffle",
    "name": "Cabin Duffle",
    "type": "Travel",
    "gender": "unisex",
    "priceInr": 18490,
    "colours": [
      "Ink",
      "Espresso"
    ],
    "images": [
      "travel",
      "brief",
      "texture"
    ],
    "isNew": false,
    "bestseller": false,
    "gift": false,
    "stockQty": 25,
    "tagline": "A cabin-sized duffle with a separate shoe compartment.",
    "material": "Grained leather, textile lining",
    "dimensions": "48 × 27 × 24 cm",
    "sizes": null,
    "rank": 20
  },
  {
    "slug": "washbag",
    "name": "Strata Wash Bag",
    "type": "Travel",
    "gender": "unisex",
    "priceInr": 3290,
    "colours": [
      "Ink",
      "Cognac"
    ],
    "images": [
      "slg",
      "travel",
      "texture"
    ],
    "isNew": false,
    "bestseller": false,
    "gift": true,
    "stockQty": 25,
    "tagline": "A wipe-clean lined wash bag with a wide opening.",
    "material": "Smooth leather, coated lining",
    "dimensions": "25 × 14 × 12 cm",
    "sizes": null,
    "rank": 21
  }
];
````

