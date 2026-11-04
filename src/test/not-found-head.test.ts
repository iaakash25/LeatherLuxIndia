import { describe, expect, it } from "vitest";
import { Route } from "@/routes/__root";

type Tag = Record<string, string>;
type Head = { meta: Tag[]; links: Tag[] };
const head = Route.options.head as unknown as (a: unknown) => Head;
const brand = { name: "Leather Lux India" };
const run = (matches: object[]) => head({ loaderData: { brand }, matches });
const metaNamed = (h: Head, key: string) => h.meta.find((m) => m["name"] === key || m["property"] === key);

// Search Console listed pages that do not exist (/blogs/news, /pages/contact ...). They answer 404, but their head used to say "I am the
// home page": canonical https://leatherluxindia.com/, the home title and description, no noindex.
describe("the head of a page that does not exist", () => {
  const missing: [string, object[]][] = [
    ["an address no route matches (/blogs/news)", [{ pathname: "/", status: "success", _notFound: true }]],
    ["a missing product or collection (a child route is not found)", [{ pathname: "/", status: "success" }, { pathname: "/products/nope", status: "notFound" }]],
  ];

  for (const [what, matches] of missing) {
    it(`for ${what}: noindex, its own title, no canonical address, nothing borrowed from the home page`, () => {
      const h = run(matches);
      expect(metaNamed(h, "robots")?.["content"]).toBe("noindex");
      expect(h.meta.some((m) => "title" in m && /^Page not found/.test(m["title"]!))).toBe(true);
      expect(h.links.some((l) => l["rel"] === "canonical")).toBe(false);
      expect(metaNamed(h, "description")).toBeUndefined();
      expect(metaNamed(h, "og:url")).toBeUndefined();
      expect(metaNamed(h, "og:image")).toBeUndefined();
      expect(h.links.some((l) => l["rel"] === "stylesheet")).toBe(true); // the 404 page is still styled
    });
  }

  it("leaves a real page alone: canonical address, description, no noindex", () => {
    const h = run([{ pathname: "/collections/all", status: "success" }]);
    expect(h.links.find((l) => l["rel"] === "canonical")?.["href"]).toBe("https://leatherluxindia.com/collections/all");
    expect(metaNamed(h, "description")).toBeDefined();
    expect(metaNamed(h, "robots")).toBeUndefined();
  });
});
