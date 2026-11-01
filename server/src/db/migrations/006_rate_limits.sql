-- Shared request counters for the rate limiters, so a limit holds across every server instance (used when RATE_LIMIT_STORE=postgres).
-- UNLOGGED: much cheaper to write, and losing a few counters in a crash only means a window starts again.
CREATE UNLOGGED TABLE rate_limits (
  key       text PRIMARY KEY,
  hits      integer NOT NULL,
  reset_at  timestamptz NOT NULL
);
CREATE INDEX rate_limits_reset_idx ON rate_limits (reset_at);
