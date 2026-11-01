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
