import request from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { query } from "../src/db/pool.js";
import { migrate } from "../src/db/migrate.js";
import { seed } from "../src/db/seed.js";
import { readLookup, resetPincodeCache } from "../src/lib/pincode.js";

const ORIGIN = "https://shop.example.com";
const PASSWORD = "a-long-test-passphrase";
const app = createApp();
const address = { name: "Asha Rao", phone: "9845012367", line1: "12 MG Road", city: "Bengaluru", state: "Karnataka", pincode: "560001" };

function client() {
  const agent = request.agent(app);
  const wrap = (m: "get" | "post") => (url: string) => agent[m](url).set("Origin", ORIGIN);
  return { agent, get: wrap("get"), post: wrap("post") };
}
type Details = { path: string; message: string }[];
const detailsOf = (r: { body: { error?: { details?: Details } } }) => Object.fromEntries((r.body.error?.details ?? []).map((d) => [d.path, d.message]));

let shopper: ReturnType<typeof client>;
let n = 0;

beforeAll(async () => {
  await migrate();
  await seed();
  shopper = client();
  expect((await shopper.post("/api/auth/register").send({ name: "Val Idator", email: "validation-shopper@example.com", password: PASSWORD })).status).toBe(201);
});

describe("the delivery address at checkout", () => {
  /** Orders with the bag empty answer 400 "bag is empty" only AFTER the address passed, so a 400 with field details means the address was refused. */
  const order = (shippingAddress: Record<string, unknown>) => shopper.post("/api/orders").set("Idempotency-Key", `val-key-${++n}-aaaa`).send({ shippingAddress });

  it("refuses made-up mobile numbers, with a reason for each", async () => {
    const cases: [string, RegExp][] = [
      ["", /10-digit/], ["12345", /all 10 digits/], ["98450123678", /10 digits/], ["1234567890", /starts with 6, 7, 8 or 9/], ["0000000000", /starts with 6/],
      ["9999999999", /repeats one digit/], ["6666666666", /repeats one digit/], ["9898989898", /real mobile/], ["9000000012", /repeats a digit/],
      ["9876543210", /counting sequence/], ["9123456789", /counting sequence/], ["9876598765", /same five digits/], ["98450abc67", /digits only/],
    ];
    for (const [phone, why] of cases) {
      const r = await order({ ...address, phone });
      expect(r.status, phone).toBe(400);
      expect(detailsOf(r)["shippingAddress.phone"], phone).toMatch(why);
    }
  });

  it("refuses made-up pincodes, names, address lines, cities and states", async () => {
    const bad: [Record<string, unknown>, string, RegExp][] = [
      [{ pincode: "000000" }, "pincode", /can't start with 0/], [{ pincode: "111111" }, "pincode", /real/], [{ pincode: "123456" }, "pincode", /real/], [{ pincode: "56001" }, "pincode", /6 digits/],
      [{ name: "1234" }, "name", /at least 2 letters/], [{ name: "<script>alert(1)</script>" }, "name", /letters only/], [{ name: "A" }, "name", /at least 2 letters/], [{ name: "aaaa" }, "name", /real name/],
      [{ line1: "12" }, "line1", /too short/], [{ line1: "123456789" }, "line1", /letters/], [{ line1: "<b>12</b> Road" }, "line1", /letters, numbers/], [{ line1: "aaaaaaa" }, "line1", /real address/],
      [{ city: "12345" }, "city", /at least 2 letters/], [{ city: "Pune1" }, "city", /letters only/],
      [{ state: "Atlantis" }, "state", /from the list/], [{ state: "karnataka" }, "state", /from the list/], [{ state: "" }, "state", /Choose your state/],
    ];
    for (const [patch, field, why] of bad) {
      const r = await order({ ...address, ...patch });
      expect(r.status, JSON.stringify(patch)).toBe(400);
      expect(detailsOf(r)[`shippingAddress.${field}`], JSON.stringify(patch)).toMatch(why);
    }
  });

  it("reports every wrong field at once", async () => {
    const r = await order({ name: "1", phone: "9999999999", line1: "x", city: "9", state: "Mars", pincode: "000000" });
    expect(Object.keys(detailsOf(r)).sort()).toEqual(["shippingAddress.city", "shippingAddress.line1", "shippingAddress.name", "shippingAddress.phone", "shippingAddress.pincode", "shippingAddress.state"]);
  });

  it("accepts good details and stores them cleaned (phone as 10 digits, spaces tidied)", async () => {
    expect((await shopper.post("/api/cart/items").send({ slug: "aria-top-handle", colour: "Oxblood", qty: 1 })).status).toBeLessThan(300);
    const r = await order({ name: "  Asha   Rao ", phone: "+91 98450-12367", line1: "  12   MG  Road ", line2: "  ", city: " Bengaluru ", state: "Karnataka", pincode: "560001" });
    expect(r.status).toBe(201);
    expect(r.body.order.shippingAddress).toEqual({ name: "Asha Rao", phone: "9845012367", line1: "12 MG Road", city: "Bengaluru", state: "Karnataka", pincode: "560001" });
  });

  it("takes 0-prefixed and 91-prefixed numbers as the same 10 digits", async () => {
    for (const phone of ["09845012367", "919845012367", "+919845012367", "98450 12367"]) {
      expect((await shopper.post("/api/cart/items").send({ slug: "aria-top-handle", colour: "Oxblood", qty: 1 })).status, phone).toBeLessThan(300);
      const r = await order({ ...address, phone });
      expect(r.status, phone).toBe(201);
      expect(r.body.order.shippingAddress.phone).toBe("9845012367");
    }
  });
});

describe("sign-up, newsletter and the delivery estimate", () => {
  it("sign-up refuses a name with digits or symbols, and tidies a good one", async () => {
    const bad = await client().post("/api/auth/register").send({ name: "R2D2 <b>", email: "name-bad@example.com", password: PASSWORD });
    expect(bad.status).toBe(400);
    expect(detailsOf(bad)["name"]).toMatch(/letters/i);
    const good = await client().post("/api/auth/register").send({ name: "  Meera   Iyer ", email: "name-good@example.com", password: PASSWORD });
    expect(good.status).toBe(201);
    expect(good.body.user.name).toBe("Meera Iyer");
  });

  it("the newsletter only takes a proper email address", async () => {
    for (const email of ["", "nope", "a@b", "a b@c.com", "a..b@c.com"]) expect((await client().post("/api/newsletter").send({ email })).status, email).toBe(400);
    expect((await client().post("/api/newsletter").send({ email: "Reader@Example.com" })).status).toBe(202);
    expect((await query("SELECT 1 FROM newsletter_subscribers WHERE email = 'reader@example.com'")).rowCount).toBe(1);
  });

  it("the delivery estimate refuses a pincode that cannot be real", async () => {
    for (const p of ["000000", "111111", "123456", "5600", "abcdef"]) expect((await request(app).get(`/api/delivery/estimate?pincode=${p}`)).status, p).toBe(400);
    expect((await request(app).get("/api/delivery/estimate?pincode=560001")).status).toBe(200);
  });
});

describe("pincode lookup", () => {
  const office = (District: string, State: string, Name = "Somewhere") => ({ Name, District, State });
  const reply = (...offices: ReturnType<typeof office>[]) => [{ Message: "Number of pincode(s) found:" + offices.length, Status: "Success", PostOffice: offices }];
  const NONE = [{ Message: "No records found", Status: "Error", PostOffice: null }];
  const upstream = (body: unknown, status = 200) => vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

  afterEach(() => { vi.unstubAllGlobals(); resetPincodeCache(); });

  it("reads the city and state, in the shop's spelling", () => {
    expect(readLookup("682001", reply(office("Ernakulam", "Kerala", "Kochi")))).toMatchObject({ city: "Ernakulam", state: "Kerala", district: "Ernakulam", areas: ["Kochi"] });
    expect(readLookup("744101", reply(office("South Andaman", "Andaman & Nicobar")))?.state).toBe("Andaman and Nicobar Islands");
    expect(readLookup("396210", reply(office("Dadra & Nagar Haveli", "Dadra & Nagar Haveli")))?.state).toBe("Dadra and Nagar Haveli and Daman and Diu");
    expect(readLookup("751001", reply(office("Khordha", "Orissa")))?.state).toBe("Odisha");
    expect(readLookup("605001", reply(office("Pondicherry", "Pondicherry")))?.state).toBe("Puducherry");
  });

  it("puts Leh and Kargil in Ladakh, calls every Delhi pincode New Delhi, and uses today's city names", () => {
    expect(readLookup("194101", reply(office("Leh", "Jammu & Kashmir")))).toMatchObject({ state: "Ladakh", city: "Leh" });
    expect(readLookup("110001", reply(office("Central Delhi", "Delhi"), office("New Delhi", "Delhi"), office("Central Delhi", "Delhi")))).toMatchObject({ state: "Delhi", city: "New Delhi" });
    expect(readLookup("560001", reply(office("Bangalore", "Karnataka")))?.city).toBe("Bengaluru");
    expect(readLookup("122001", reply(office("Gurgaon", "Haryana")))?.city).toBe("Gurugram");
  });

  it("takes the district most post offices are in, ignoring bracketed notes", () => {
    const r = readLookup("400001", reply(office("Mumbai", "Maharashtra"), office("Mumbai", "Maharashtra"), office("Raigarh(MH)", "Maharashtra"), office("Mumbai", "Maharashtra")));
    expect(r?.district).toBe("Mumbai");
    expect(readLookup("400002", reply(office("Raigarh(MH)", "Maharashtra")))?.district).toBe("Raigarh");
  });

  it("says null for a pincode that does not exist, and throws when the reply is not understood", () => {
    expect(readLookup("999999", NONE)).toBeNull();
    expect(() => readLookup("560001", { oops: true })).toThrow();
    expect(() => readLookup("560001", [{ Status: "Error", Message: "Rate limit exceeded", PostOffice: null }])).toThrow();
  });

  it("GET /api/pincode/:pin gives the place, caches it, and sends cache headers", async () => {
    const fetchMock = upstream(reply(office("Ernakulam", "Kerala", "Kochi")));
    vi.stubGlobal("fetch", fetchMock);
    const a = await request(app).get("/api/pincode/682001");
    expect(a.status).toBe(200);
    expect(a.body).toEqual({ pincode: "682001", city: "Ernakulam", state: "Kerala", district: "Ernakulam", areas: ["Kochi"] });
    expect(a.headers["cache-control"]).toContain("max-age=86400");
    await request(app).get("/api/pincode/682001");
    expect(fetchMock).toHaveBeenCalledTimes(1); // the second answer came from memory
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.postalpincode.in/pincode/682001");
  });

  it("answers 404 for no such pincode, 503 when the service is down, and 400 before asking anyone about a fake one", async () => {
    vi.stubGlobal("fetch", upstream(NONE));
    const missing = await request(app).get("/api/pincode/560099");
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("pincode_not_found");

    resetPincodeCache();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    const down = await request(app).get("/api/pincode/560001");
    expect(down.status).toBe(503);
    expect(down.body.error.code).toBe("lookup_unavailable");
    vi.stubGlobal("fetch", upstream({ oops: true }, 500));
    expect((await request(app).get("/api/pincode/560002")).status).toBe(503);

    const asked = vi.fn();
    vi.stubGlobal("fetch", asked);
    for (const p of ["111111", "000001", "12345", "abcdef"]) expect((await request(app).get(`/api/pincode/${p}`)).status, p).toBe(400);
    expect(asked).not.toHaveBeenCalled();
  });

  it("a failed lookup is not remembered: the next try asks again", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("blip"); }));
    expect((await request(app).get("/api/pincode/560003")).status).toBe(503);
    vi.stubGlobal("fetch", upstream(reply(office("Bangalore", "Karnataka"))));
    const again = await request(app).get("/api/pincode/560003");
    expect(again.status).toBe(200);
    expect(again.body.city).toBe("Bengaluru");
  });
});
