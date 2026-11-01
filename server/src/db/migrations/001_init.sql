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
