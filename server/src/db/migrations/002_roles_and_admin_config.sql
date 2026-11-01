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
