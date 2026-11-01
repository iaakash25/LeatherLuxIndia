/**
 * Remembers an async function's result for `ttlMs`. Concurrent callers share one in-flight call, and a failure is
 * never remembered (the next caller just tries again). Used on the server render path so a burst of page views
 * triggers one API request instead of one each.
 */
export function memoTtl<T>(fn: () => Promise<T>, ttlMs: number, now: () => number = Date.now): () => Promise<T> {
  let value: { v: T; at: number } | undefined;
  let inflight: Promise<T> | null = null;
  return () => {
    if (value && now() - value.at < ttlMs) return Promise.resolve(value.v);
    inflight ??= fn()
      .then((v) => { value = { v, at: now() }; return v; })
      .finally(() => { inflight = null; });
    return inflight;
  };
}
