/**
 * A small in-process cache for data that is read far more often than it changes.
 *
 *  - TTL:                a value is served from memory until `ttlMs` has passed.
 *  - Single-flight:      many requests missing at the same moment share ONE load (no stampede on the database).
 *  - Stale-while-revalidate: for `staleMs` after expiry the old value is still served instantly while a fresh one is
 *                        loaded in the background, so nobody waits on the database. If that refresh fails, the old
 *                        value keeps being served instead of an error.
 *  - Invalidation:       writers call `invalidate()`. A load that was already running when that happens is
 *                        not stored, so it can never put pre-write data back into the cache.
 *  - Bounded:            least-recently-used entries are dropped past `maxEntries`.
 *
 * It lives in one process's memory. With several API instances each has its own copy, so a change can take up to
 * `ttlMs` (plus `staleMs`) to reach instances other than the one that handled the write.
 */
export type CacheOptions = {
  name: string;
  /** Freshness window. 0 disables the cache (every call loads). */
  ttlMs: number;
  /** Extra time during which an expired value may still be served while it refreshes. */
  staleMs?: number;
  maxEntries?: number;
  now?: () => number;
};

type Entry<V> = { value: V; freshUntil: number; staleUntil: number };

export type CacheStats = {
  name: string;
  entries: number;
  hits: number;
  staleHits: number;
  misses: number;
  loads: number;
  errors: number;
  hitRate: number;
  ttlSeconds: number;
  staleSeconds: number;
};

export class TtlCache<V> {
  readonly name: string;
  private readonly entries = new Map<string, Entry<V>>();
  private readonly inflight = new Map<string, Promise<V>>();
  private readonly ttlMs: number;
  private readonly staleMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private generation = 0;
  private counters = { hits: 0, staleHits: 0, misses: 0, loads: 0, errors: 0 };

  constructor(o: CacheOptions) {
    this.name = o.name;
    this.ttlMs = Math.max(0, o.ttlMs);
    this.staleMs = Math.max(0, o.staleMs ?? 0);
    this.maxEntries = o.maxEntries ?? 1000;
    this.now = o.now ?? Date.now;
  }

  get enabled(): boolean { return this.ttlMs > 0; }

  /** The cached value for `key`, loading it with `load` when missing. A failed load is never cached. */
  async get(key: string, load: () => Promise<V>): Promise<V> {
    if (!this.enabled) { this.counters.misses++; return load(); }
    const t = this.now();
    const e = this.entries.get(key);
    if (e && t < e.freshUntil) {
      this.counters.hits++;
      this.touch(key, e);
      return e.value;
    }
    if (e && t < e.staleUntil) {
      this.counters.staleHits++;
      this.touch(key, e);
      void this.refresh(key, load).catch(() => undefined); // keep the old value if the refresh fails
      return e.value;
    }
    this.counters.misses++;
    return this.refresh(key, load);
  }

  /** Drops every entry whose key starts with `prefix` (all of them by default). Returns how many were dropped. */
  invalidate(prefix = ""): number {
    this.generation++; // loads already under way started before this write: don't let them store their result
    let n = 0;
    for (const k of [...this.entries.keys()]) if (k.startsWith(prefix)) { this.entries.delete(k); n++; }
    for (const k of [...this.inflight.keys()]) if (k.startsWith(prefix)) this.inflight.delete(k);
    return n;
  }

  stats(): CacheStats {
    const { hits, staleHits, misses } = this.counters;
    const total = hits + staleHits + misses;
    return {
      name: this.name, entries: this.entries.size, ...this.counters,
      hitRate: total ? Math.round(((hits + staleHits) / total) * 1000) / 1000 : 0,
      ttlSeconds: this.ttlMs / 1000, staleSeconds: this.staleMs / 1000,
    };
  }

  private refresh(key: string, load: () => Promise<V>): Promise<V> {
    const running = this.inflight.get(key);
    if (running) return running; // single-flight
    const gen = this.generation;
    this.counters.loads++;
    const p: Promise<V> = load()
      .then((value) => { if (gen === this.generation) this.store(key, value); return value; })
      .catch((err) => { this.counters.errors++; throw err; })
      .finally(() => { if (this.inflight.get(key) === p) this.inflight.delete(key); });
    this.inflight.set(key, p);
    return p;
  }

  private store(key: string, value: V) {
    const t = this.now();
    this.entries.delete(key);
    this.entries.set(key, { value, freshUntil: t + this.ttlMs, staleUntil: t + this.ttlMs + this.staleMs });
    while (this.entries.size > this.maxEntries) this.entries.delete(this.entries.keys().next().value as string);
  }

  /** Mark as most recently used (Map keeps insertion order, so re-inserting moves it to the end). */
  private touch(key: string, e: Entry<V>) {
    this.entries.delete(key);
    this.entries.set(key, e);
  }
}
