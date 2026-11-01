import { describe, expect, it } from "vitest";
import { TtlCache } from "../src/lib/cache.js";

/** A cache on a clock the test controls, and a loader that counts how often it really runs. */
function setup(opts: { ttl?: number; stale?: number; max?: number } = {}) {
  let t = 1_000_000;
  const cache = new TtlCache<string>({ name: "t", ttlMs: opts.ttl ?? 1000, staleMs: opts.stale ?? 0, maxEntries: opts.max ?? 100, now: () => t });
  let n = 0;
  const loader = (label = "v") => async () => `${label}${++n}`;
  return { cache, advance: (ms: number) => { t += ms; }, loads: () => n, loader };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("TtlCache", () => {
  it("serves from memory until the time-to-live passes, then loads again", async () => {
    const { cache, advance, loads, loader } = setup({ ttl: 1000 });
    expect(await cache.get("k", loader())).toBe("v1");
    expect(await cache.get("k", loader())).toBe("v1");
    advance(999);
    expect(await cache.get("k", loader())).toBe("v1");
    expect(loads()).toBe(1);
    advance(2);
    expect(await cache.get("k", loader())).toBe("v2");
    expect(loads()).toBe(2);
  });

  it("keeps keys apart", async () => {
    const { cache, loader } = setup();
    expect(await cache.get("a", loader("a"))).toBe("a1");
    expect(await cache.get("b", loader("b"))).toBe("b2");
    expect(await cache.get("a", loader("a"))).toBe("a1");
  });

  it("shares one load between everyone asking at the same moment", async () => {
    const { cache } = setup();
    let runs = 0;
    const slow = async () => { runs++; await new Promise((r) => setTimeout(r, 20)); return "value"; };
    const results = await Promise.all(Array.from({ length: 50 }, () => cache.get("k", slow)));
    expect(runs).toBe(1);
    expect(new Set(results)).toEqual(new Set(["value"]));
  });

  it("never caches a failure, and the next caller retries", async () => {
    const { cache } = setup();
    let calls = 0;
    const flaky = async () => { if (++calls === 1) throw new Error("db down"); return "ok"; };
    await expect(cache.get("k", flaky)).rejects.toThrow("db down");
    expect(await cache.get("k", flaky)).toBe("ok");
    expect(await cache.get("k", flaky)).toBe("ok");
    expect(calls).toBe(2);
    expect(cache.stats().errors).toBe(1);
  });

  describe("stale-while-revalidate", () => {
    it("serves the old value instantly after expiry while refreshing in the background", async () => {
      const { cache, advance, loads, loader } = setup({ ttl: 1000, stale: 5000 });
      expect(await cache.get("k", loader())).toBe("v1");
      advance(1500); // expired, but inside the stale window
      expect(await cache.get("k", loader())).toBe("v1"); // answered without waiting for the load
      await tick();
      expect(loads()).toBe(2); // refresh ran
      expect(await cache.get("k", loader())).toBe("v2");
      expect(loads()).toBe(2);
      expect(cache.stats().staleHits).toBe(1);
    });

    it("keeps serving the old value if the background refresh fails", async () => {
      const { cache, advance, loader } = setup({ ttl: 1000, stale: 5000 });
      await cache.get("k", loader());
      advance(1500);
      expect(await cache.get("k", async () => { throw new Error("db down"); })).toBe("v1");
      await tick();
      expect(await cache.get("k", async () => { throw new Error("still down"); })).toBe("v1");
    });

    it("loads and waits once the stale window is over", async () => {
      const { cache, advance, loader } = setup({ ttl: 1000, stale: 2000 });
      await cache.get("k", loader());
      advance(3500);
      expect(await cache.get("k", loader())).toBe("v2");
    });
  });

  describe("invalidation", () => {
    it("drops everything, or only keys with a prefix", async () => {
      const { cache, loader } = setup();
      await cache.get("list:a", loader("a"));
      await cache.get("list:b", loader("b"));
      await cache.get("product:x", loader("x"));
      expect(cache.invalidate("list:")).toBe(2);
      expect(await cache.get("product:x", loader("x"))).toBe("x3"); // untouched
      expect(await cache.get("list:a", loader("a"))).toBe("a4"); // reloaded
      expect(cache.invalidate()).toBe(2);
      expect(cache.stats().entries).toBe(0);
    });

    it("does not let a load that started before a write put pre-write data back", async () => {
      const { cache } = setup();
      let release!: () => void;
      const gate = new Promise<void>((r) => { release = r; });
      const readBeforeWrite = cache.get("k", async () => { await gate; return "OLD (read before the write)"; });
      await tick();
      cache.invalidate(); // the write happens while that read is still running
      release();
      expect(await readBeforeWrite).toBe("OLD (read before the write)"); // its own caller still gets what it read
      expect(await cache.get("k", async () => "NEW (read after the write)")).toBe("NEW (read after the write)");
      expect(await cache.get("k", async () => "should not load")).toBe("NEW (read after the write)");
    });
  });

  it("is bounded: the least recently used entry goes first", async () => {
    const { cache, loader } = setup({ max: 2 });
    await cache.get("a", loader("a")); // a1
    await cache.get("b", loader("b")); // b2
    await cache.get("a", loader("a")); // use a, so b is now the oldest
    await cache.get("c", loader("c")); // c3 evicts b
    expect(cache.stats().entries).toBe(2);
    expect(await cache.get("a", loader("a"))).toBe("a1"); // still cached
    expect(await cache.get("b", loader("b"))).toBe("b4"); // had to reload
  });

  it("does nothing when the time-to-live is 0 (caching off)", async () => {
    const { cache, loads, loader } = setup({ ttl: 0 });
    expect(cache.enabled).toBe(false);
    await cache.get("k", loader());
    await cache.get("k", loader());
    expect(loads()).toBe(2);
    expect(cache.stats().entries).toBe(0);
  });

  it("reports hits, misses and the hit rate", async () => {
    const { cache, loader } = setup();
    await cache.get("k", loader()); // miss
    await cache.get("k", loader()); // hit
    await cache.get("k", loader()); // hit
    await cache.get("j", loader()); // miss
    expect(cache.stats()).toMatchObject({ name: "t", hits: 2, misses: 2, loads: 2, entries: 2, hitRate: 0.5, ttlSeconds: 1 });
  });
});
