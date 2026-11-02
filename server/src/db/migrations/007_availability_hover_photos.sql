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
