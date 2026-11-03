import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { validatePincode } from "./validation";

/** The place a pincode belongs to, as the shop's server reads it from India Post (server/src/lib/pincode.ts). */
export type PincodeInfo = { pincode: string; city: string; state: string; district: string; areas: string[] };

/**
 *  - idle: nothing to look up yet (the pincode is not complete or not plausible)
 *  - loading: asking the server
 *  - found: the city and state are known
 *  - not_found: there is no such pincode
 *  - unavailable: the lookup could not be done right now; the shopper types the city and state
 */
export type Lookup =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "found"; info: PincodeInfo }
  | { status: "not_found" }
  | { status: "unavailable" };

/** Answers already received during this visit (null = no such pincode). The server keeps them for a day; this saves the round trip. */
const seen = new Map<string, PincodeInfo | null>();

/**
 * Looks the pincode up as soon as it is a complete, plausible 6 digits. `lookup.pincode`-style staleness is handled here: while a new
 * pincode is being asked about, the answer for the previous one is never shown.
 */
export function usePincodeLookup(pin: string): Lookup {
  const valid = validatePincode(pin).ok;
  const [answer, setAnswer] = useState<{ pin: string; lookup: Lookup }>({ pin: "", lookup: { status: "idle" } });

  useEffect(() => {
    if (!valid) return;
    if (seen.has(pin)) { const hit = seen.get(pin)!; setAnswer({ pin, lookup: hit ? { status: "found", info: hit } : { status: "not_found" } }); return; }
    let current = true;
    setAnswer({ pin, lookup: { status: "loading" } });
    api<PincodeInfo>(`/pincode/${pin}`, { timeoutMs: 9000 })
      .then((info) => { seen.set(pin, info); if (current) setAnswer({ pin, lookup: { status: "found", info } }); })
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) { seen.set(pin, null); if (current) setAnswer({ pin, lookup: { status: "not_found" } }); return; }
        if (current) setAnswer({ pin, lookup: { status: "unavailable" } });
      });
    return () => { current = false; };
  }, [pin, valid]);

  if (!valid) return { status: "idle" };
  return answer.pin === pin ? answer.lookup : { status: "loading" };
}
