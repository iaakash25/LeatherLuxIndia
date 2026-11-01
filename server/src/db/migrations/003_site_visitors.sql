-- Unique-visitor counter. One row per browser, keyed by a one-way hash of a random id the browser
-- generates for itself. No IP address, user agent or other personal data is stored.

CREATE TABLE site_visitors (
  visitor_hash  text PRIMARY KEY CHECK (char_length(visitor_hash) = 64),
  first_seen    timestamptz NOT NULL DEFAULT now(),
  last_seen     timestamptz NOT NULL DEFAULT now(),
  visits        integer NOT NULL DEFAULT 1 CHECK (visits >= 1)
);
CREATE INDEX site_visitors_first_seen_idx ON site_visitors (first_seen);
