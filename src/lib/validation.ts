import { INDIAN_STATES } from "./india.js";

/**
 * Rules for the details a shopper types: name, mobile number, pincode, address, city, state and email.
 *
 * THIS FILE EXISTS TWICE, with identical contents: server/src/lib/validation.ts (the rules the API enforces, so nobody can get round
 * them by calling it directly) and src/lib/validation.ts (the same rules in the browser, so shoppers see a message before they
 * submit). src/test/validation.test.ts fails if the two copies drift apart. Change both together, and add a case to that test.
 *
 * Each check returns the cleaned value to store (spaces tidied, phone digits only, email lower-case) or a message for the shopper.
 */
export type Check<T extends string = string> = { ok: true; value: T } | { ok: false; message: string };
const ok = <T extends string>(value: T): Check<T> => ({ ok: true, value });
const fail = (message: string): Check<never> => ({ ok: false, message });

/** Trims, joins runs of spaces, and uses one form for accented letters. */
export const tidy = (s: string) => s.normalize("NFC").replace(/\s+/g, " ").trim();

const letters = (s: string) => (s.match(/\p{L}/gu) ?? []).length;
/** The longest run of one repeated character (case ignored). */
const longestRepeat = (s: string) => { let best = 0, run = 0, prev = ""; for (const c of s.toLowerCase()) { run = c === prev ? run + 1 : 1; prev = c; best = Math.max(best, run); } return best; };
/** The longest run of digits going 1,2,3… or 9,8,7… (wrapping 9→0 and 0→9). */
function longestSequence(d: string): number {
  let best = 1, up = 1, down = 1;
  for (let i = 1; i < d.length; i++) {
    const step = (Number(d[i]) - Number(d[i - 1]) + 10) % 10;
    up = step === 1 ? up + 1 : 1;
    down = step === 9 ? down + 1 : 1;
    best = Math.max(best, up, down);
  }
  return best;
}

// ── Mobile number ───────────────────────────────────────────────────────────────────────────────

/**
 * "+91 98765-43210", "91 9876543210" and "09876543210" all mean 9876543210. Anything else is returned as bare digits, for the checks to
 * judge. (Unlike {@link cleanPhoneInput} this does not cut the number to 10 digits, so a too-long number is still refused.)
 */
export function normalisePhone(raw: string): string {
  const plus = raw.trim().startsWith("+");
  let d = raw.replace(/\D/g, "");
  if (plus && d.startsWith("91") && d.length > 10) d = d.slice(2);
  else if (!plus && d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d;
}
/** For a phone field while the shopper types or pastes: digits only, a pasted +91 / 0 prefix removed, at most 10 digits. */
export const cleanPhoneInput = (raw: string) => normalisePhone(raw).slice(0, 10);

/**
 * An Indian mobile number: exactly 10 digits, starting with 6, 7, 8 or 9, and not one of the made-up numbers people type to get past a
 * form: the same digit over and over (9999999999), too few different digits (9898989898), a run of the same digit (9000000012), a
 * counting sequence (9876543210, 9812345678) or a 5-digit half said twice (9876598765).
 */
export function validateMobile(raw: string): Check {
  if (!raw.trim()) return fail("Enter your 10-digit mobile number.");
  if (/[^\d\s\-().+]/.test(raw)) return fail("A mobile number has digits only.");
  const d = normalisePhone(raw);
  if (d.length !== 10) return fail(d.length < 10 ? "Enter all 10 digits of your mobile number." : "A mobile number has 10 digits. Remove the extra digits.");
  if (!/^[6-9]/.test(d)) return fail("A mobile number starts with 6, 7, 8 or 9.");
  if (new Set(d).size === 1) return fail("That number repeats one digit. Please enter your real mobile number.");
  if (new Set(d).size <= 2) return fail("That doesn't look like a real mobile number. Please check it.");
  if (longestRepeat(d) >= 7) return fail("That number repeats a digit too many times. Please check it.");
  if (longestSequence(d) >= 8) return fail("That number is a counting sequence (like 9876543210). Please enter your real mobile number.");
  if (d.slice(0, 5) === d.slice(5)) return fail("That number repeats the same five digits. Please check it.");
  return ok(d);
}

// ── Pincode ─────────────────────────────────────────────────────────────────────────────────────

/** A 6-digit Indian pincode: it cannot start with 0, and 111111 or 123456 are not real. (Whether it exists is checked by the lookup.) */
export function validatePincode(raw: string): Check {
  const p = raw.trim();
  if (!p) return fail("Enter your 6-digit pincode.");
  if (!/^\d{6}$/.test(p)) return fail("A pincode has 6 digits.");
  if (p[0] === "0") return fail("A pincode can't start with 0.");
  if (new Set(p).size === 1 || longestSequence(p) >= 6) return fail("That pincode doesn't look real. Please check it.");
  return ok(p);
}

// ── Names, addresses, cities, states ────────────────────────────────────────────────────────────

/** A person's name: letters (any script), spaces, apostrophes, hyphens and full stops; at least 2 letters; no digits or symbols. */
export function validatePersonName(raw: string): Check {
  const n = tidy(raw);
  if (!n) return fail("Enter the full name.");
  if (n.length > 80) return fail("Use at most 80 characters for the name.");
  if (letters(n) < 2) return fail("A name needs at least 2 letters.");
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'’-]*$/u.test(n)) return fail("Use letters only in the name (spaces, ' - and . are fine).");
  if (longestRepeat(n.replace(/[ .'’-]/g, "")) >= 4) return fail("That doesn't look like a real name. Please check it.");
  return ok(n);
}

const ADDRESS_CHARS = /^[\p{L}\p{M}\p{N} ,.\-/#()&'’:;]+$/u;

/** A line of the delivery address. The first line is required (at least 5 characters, with a letter in it); the second may be empty. */
export function validateAddressLine(raw: string, { required }: { required: boolean }): Check {
  const a = tidy(raw);
  if (!a) return required ? fail("Enter the house or flat number and street.") : ok("");
  if (a.length > 150) return fail("Use at most 150 characters.");
  if (required && a.length < 5) return fail("That address is too short. Add the house or flat number and the street.");
  if (!ADDRESS_CHARS.test(a)) return fail("Use letters, numbers and , . - / # ( ) & only.");
  if (letters(a) < 1) return fail("The address needs a place name with letters, not only numbers.");
  if (longestRepeat(a) >= 5) return fail("That doesn't look like a real address. Please check it.");
  return ok(a);
}

/** A city or town: letters, spaces, full stops, apostrophes, hyphens and brackets; no digits. */
export function validateCity(raw: string): Check {
  const c = tidy(raw);
  if (!c) return fail("Enter your city or town.");
  if (c.length > 60) return fail("Use at most 60 characters for the city.");
  if (letters(c) < 2) return fail("A city needs at least 2 letters.");
  if (!/^[\p{L}\p{M}][\p{L}\p{M} .'’()-]*$/u.test(c)) return fail("Use letters only for the city (no digits or symbols).");
  if (longestRepeat(c.replace(/[ .'’()-]/g, "")) >= 4) return fail("That doesn't look like a real city. Please check it.");
  return ok(c);
}

/** One of the 28 states and 8 union territories, spelled as in the list. */
export function validateState(raw: string): Check {
  const s = raw.trim();
  if (!s) return fail("Choose your state.");
  const found = (INDIAN_STATES as readonly string[]).find((x) => x === s);
  return found ? ok(found) : fail("Choose a state from the list.");
}

// ── Email ───────────────────────────────────────────────────────────────────────────────────────

const EMAIL = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

/** An email address of the usual shape: one @, a dotted domain ending in letters, no spaces, no ".." and no leading or trailing dot. */
export function validateEmail(raw: string): Check {
  const e = raw.trim().toLowerCase();
  if (!e) return fail("Enter your email address.");
  if (e.length > 254) return fail("That email address is too long.");
  const [local = ""] = e.split("@");
  if (!EMAIL.test(e) || e.includes("..") || local.startsWith(".") || local.endsWith(".") || local.length > 64) return fail("Enter a valid email address, like name@example.com.");
  return ok(e);
}
