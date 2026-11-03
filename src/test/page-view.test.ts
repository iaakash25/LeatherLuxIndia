import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("@/lib/api", () => ({ api, apiEnabled: true }));

// The module keeps "the last page" and "is this the first page of the visit" between calls, so each test gets a fresh copy.
async function fresh() {
  vi.resetModules();
  return (await import("@/lib/page-view")).logPageView;
}
const sent = () => api.mock.calls.map((c) => c[1] as { body: { path: string; referrer?: string } }).map((o) => o.body);

beforeEach(() => { api.mockClear(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-03T10:00:00Z")); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("reporting page views to the visit log", () => {
  it("reports each page the visitor opens, to /visits/log, with only the path", async () => {
    const logPageView = await fresh();
    logPageView("/");
    vi.advanceTimersByTime(5000);
    logPageView("/collections/women");
    vi.advanceTimersByTime(5000);
    logPageView("/products/aria-top-handle");
    expect(api.mock.calls.every((c) => c[0] === "/visits/log" && (c[1] as { method: string }).method === "POST")).toBe(true);
    expect(sent().map((b) => b.path)).toEqual(["/", "/collections/women", "/products/aria-top-handle"]);
  });

  it("counts the same page opened again later, but not twice in the same moment", async () => {
    const logPageView = await fresh();
    logPageView("/collections/men");
    logPageView("/collections/men"); // a double run of the effect, 0 ms later
    expect(sent().length).toBe(1);
    vi.advanceTimersByTime(10_000);
    logPageView("/collections/men"); // the visitor came back to it
    expect(sent().length).toBe(2);
  });

  it("never reports the admin console", async () => {
    const logPageView = await fresh();
    logPageView("/admin");
    logPageView("/admin/inventory");
    expect(api).not.toHaveBeenCalled();
  });

  it("sends the site the visitor came from (its address only) with the first page, and not with the next ones", async () => {
    Object.defineProperty(document, "referrer", { value: "https://www.google.com/search?q=leather+lux+india", configurable: true });
    const logPageView = await fresh();
    logPageView("/");
    vi.advanceTimersByTime(5000);
    logPageView("/collections/all");
    const [first, second] = sent();
    expect(first).toEqual({ path: "/", referrer: "https://www.google.com" });
    expect(second).toEqual({ path: "/collections/all" });
  });

  it("does not send our own address as a referrer, or a referrer that is not an address", async () => {
    Object.defineProperty(document, "referrer", { value: `${location.origin}/products/x`, configurable: true });
    let logPageView = await fresh();
    logPageView("/");
    expect(sent()[0]).toEqual({ path: "/" });
    api.mockClear();
    Object.defineProperty(document, "referrer", { value: "not a url", configurable: true });
    logPageView = await fresh();
    logPageView("/a");
    expect(sent()[0]).toEqual({ path: "/a" });
  });

  it("a failure to log is ignored: the page carries on", async () => {
    api.mockRejectedValueOnce(new Error("offline"));
    const logPageView = await fresh();
    expect(() => logPageView("/")).not.toThrow();
    await vi.runAllTimersAsync();
  });
});
