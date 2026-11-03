-- Named counters for the site. The first is the footer's "Total visitors": it goes up by one every time a page is loaded or refreshed
-- (before, it counted each browser once, using site_visitors, which is now unused and can be dropped when convenient).
-- It starts from the number the footer showed when this was introduced, so the figure never drops.
CREATE TABLE site_counters (
  name        text PRIMARY KEY CHECK (name ~ '^[a-z][a-z0-9_]{1,40}$'),
  value       bigint NOT NULL DEFAULT 0 CHECK (value >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO site_counters (name, value) SELECT 'page_loads', count(*) FROM site_visitors;
