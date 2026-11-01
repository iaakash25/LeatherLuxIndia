export const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana",
  "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur",
  "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana",
  "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi",
  "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
] as const;

// Mirror the server's rules (server/src/lib/orders.ts) so shoppers see errors before submitting.
export const PHONE_RE = /^(\+91[\s-]?)?[6-9]\d{9}$/;
/** "+91 98765-43210", "098765 43210", "(98765) 43210" → "9876543210". Anything else is returned stripped, for validation to reject. */
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/[\s\-().]/g, "");
  const m = /^(?:\+91|91|0)?([6-9]\d{9})$/.exec(digits);
  return m?.[1] ?? digits;
}
export const PINCODE_RE = /^[1-9]\d{5}$/;
