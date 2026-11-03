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
