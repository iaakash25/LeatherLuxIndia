import { describe, expect, it } from "vitest";
import { memoTtl } from "@/lib/ttl-memo";

describe("memoTtl", () => {
  it("calls the function once per time-to-live window", async () => {
    let t = 0, calls = 0;
    const get = memoTtl(async () => ++calls, 1000, () => t);
    expect(await get()).toBe(1);
    t = 999;
    expect(await get()).toBe(1);
    t = 1001;
    expect(await get()).toBe(2);
    expect(calls).toBe(2);
  });

  it("shares one call between simultaneous callers", async () => {
    let calls = 0;
    const get = memoTtl(async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return "x"; }, 1000);
    expect(await Promise.all(Array.from({ length: 20 }, get))).toEqual(Array(20).fill("x"));
    expect(calls).toBe(1);
  });

  it("does not remember a failure", async () => {
    let calls = 0;
    const get = memoTtl(async () => { if (++calls === 1) throw new Error("api down"); return "ok"; }, 1000);
    await expect(get()).rejects.toThrow("api down");
    expect(await get()).toBe("ok");
    expect(await get()).toBe("ok");
    expect(calls).toBe(2);
  });
});
