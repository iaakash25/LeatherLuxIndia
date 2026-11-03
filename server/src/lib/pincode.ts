import { logger } from "./logger.js";
import { AppError } from "./errors.js";
import { TtlCache } from "./cache.js";
import { INDIAN_STATES } from "./india.js";

/**
 * Turns a pincode into the city and state it belongs to, for the checkout form to fill in. The data is India Post's, read from the free
 * public service at api.postalpincode.in. The browser never calls it (the site's security policy only lets pages talk to the shop's own
 * address); this server does, and keeps every answer for a day, because a pincode's place does not change.
 *
 * It is a convenience, not a gate: if the service is down the shopper is told to type the city and state, and an order never waits on it.
 */
export type PincodeInfo = { pincode: string; city: string; state: string; district: string; areas: string[] };

const UPSTREAM = "https://api.postalpincode.in/pincode/";
const TIMEOUT_MS = 4500;

/** The spellings the service uses, and older names, mapped to the shop's list of states (lower-case, "&" written as "and"). */
const STATE_ALIASES: Record<string, string> = {
  "andaman and nicobar": "Andaman and Nicobar Islands",
  "dadra and nagar haveli": "Dadra and Nagar Haveli and Daman and Diu",
  "daman and diu": "Dadra and Nagar Haveli and Daman and Diu",
  "dadra and nagar haveli and daman and diu": "Dadra and Nagar Haveli and Daman and Diu",
  orissa: "Odisha",
  uttaranchal: "Uttarakhand",
  pondicherry: "Puducherry",
  "nct of delhi": "Delhi",
  chattisgarh: "Chhattisgarh",
  telengana: "Telangana",
  tamilnadu: "Tamil Nadu",
};
const key = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
const STATE_BY_KEY = new Map<string, string>([...INDIAN_STATES.map((s) => [key(s), s] as const), ...Object.entries(STATE_ALIASES)]);

/** Districts whose pincodes the service still lists under Jammu and Kashmir, although they have been Ladakh since 2019. */
const LADAKH_DISTRICTS = new Set(["leh", "kargil"]);
/** Places whose name has changed. */
const CITY_ALIASES: Record<string, string> = { bangalore: "Bengaluru", gurgaon: "Gurugram", allahabad: "Prayagraj" };

type Office = { Name?: string; District?: string; State?: string };

/**
 * Reads the service's answer: null when it says the pincode does not exist, the place when it does, and an error when the answer is not
 * one we understand (so a changed or broken service is never mistaken for "no such pincode").
 */
export function readLookup(pincode: string, body: unknown): PincodeInfo | null {
  const first = Array.isArray(body) ? (body[0] as { Status?: string; Message?: string; PostOffice?: Office[] | null } | undefined) : undefined;
  if (!first || typeof first !== "object") throw new Error("unexpected reply");
  const offices = (first.PostOffice ?? []).filter((o) => o && typeof o.District === "string" && typeof o.State === "string");
  if (!offices.length) {
    if (/no records found/i.test(first.Message ?? "")) return null;
    throw new Error(`unexpected reply: ${first.Status ?? "?"} ${first.Message ?? ""}`.trim());
  }

  // Several districts can share one pincode; the one most post offices are in is the place people mean.
  const counts = new Map<string, number>();
  for (const o of offices) counts.set(o.District!.replace(/\s*\([^)]*\)/g, "").trim(), (counts.get(o.District!.replace(/\s*\([^)]*\)/g, "").trim()) ?? 0) + 1);
  const district = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];

  let state = STATE_BY_KEY.get(key(offices[0]!.State!)) ?? "";
  if (state === "Jammu and Kashmir" && LADAKH_DISTRICTS.has(district.toLowerCase())) state = "Ladakh";
  // Every Delhi pincode is "New Delhi" to its residents, whatever the post office district (Central Delhi, South West Delhi, …).
  const city = state === "Delhi" ? "New Delhi" : (CITY_ALIASES[district.toLowerCase()] ?? district);

  const areas = [...new Set(offices.map((o) => (o.Name ?? "").trim()).filter(Boolean))].slice(0, 6);
  return { pincode, city, state, district, areas };
}

async function fetchLookup(pincode: string): Promise<PincodeInfo | null> {
  let body: unknown;
  try {
    const res = await fetch(`${UPSTREAM}${pincode}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = await res.json();
    return readLookup(pincode, body);
  } catch (err) {
    logger.warn({ pincode, err: (err as Error).message }, "pincode lookup failed");
    throw new AppError(503, "lookup_unavailable", "We couldn't look this pincode up right now. Please fill in the city and state yourself.");
  }
}

// A day, and many entries: there are only about 19,000 pincodes, so one instance soon holds the ones its visitors use.
// (A failed lookup throws, and a thrown lookup is not stored, so a bad moment at the service is not remembered.)
const lookups = new TtlCache<PincodeInfo | null>({ name: "pincodes", ttlMs: 24 * 60 * 60 * 1000, staleMs: 0, maxEntries: 2000 });

export const lookupPincode = (pincode: string) => lookups.get(pincode, () => fetchLookup(pincode));
/** Forgets every stored answer (for tests). */
export const resetPincodeCache = () => { lookups.invalidate(); };
