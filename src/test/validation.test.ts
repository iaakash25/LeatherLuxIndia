import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { INDIAN_STATES } from "@/lib/india";
import { INDIAN_STATES as SERVER_STATES } from "../../server/src/lib/india";
import { cleanPhoneInput, validateAddressLine, validateCity, validateEmail, validateMobile, validatePersonName, validatePincode, validateState } from "@/lib/validation";

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, "../..", rel), "utf8").replace(/\r\n/g, "\n");

describe("the shop and the server use the same rules", () => {
  it("the two copies of validation.ts are identical (change both together)", () => {
    expect(read("src/lib/validation.ts")).toBe(read("server/src/lib/validation.ts"));
  });
  it("both know the same 36 states and union territories", () => {
    expect([...INDIAN_STATES]).toEqual([...SERVER_STATES]);
    expect(INDIAN_STATES).toHaveLength(36);
  });
});

const valid = (r: { ok: boolean }) => r.ok;

describe("mobile number", () => {
  it("accepts a real 10-digit number, however it is written", () => {
    for (const p of ["9845012367", "6123409876", "7000123456", "8123456709", "+91 98450 12367", "+91-98450-12367", "09845012367", "91 9845012367", "(98450) 12367"]) {
      const r = validateMobile(p);
      expect(r, p).toEqual({ ok: true, value: p.replace(/\D/g, "").slice(-10) });
    }
  });
  it("refuses numbers that are too short, too long, not starting with 6-9, or not digits", () => {
    for (const p of ["", "   ", "98450", "984501236", "98450123678", "5845012367", "0845012367", "1234567890", "98450abc67", "9845012367x"]) expect(validateMobile(p).ok, p).toBe(false);
  });
  it("refuses the numbers people type to get past a form", () => {
    for (const p of ["0000000000", "9999999999", "6666666666", "7777777777", "9898989898", "9988998899", "9000000012", "9876543210", "9123456789", "9812345678", "9876598765", "+91 99999 99999"]) expect(validateMobile(p).ok, p).toBe(false);
  });
  it("cleans a phone field as the shopper types or pastes", () => {
    expect(cleanPhoneInput("+91 98450 12367")).toBe("9845012367");
    expect(cleanPhoneInput("098450 12367")).toBe("9845012367");
    expect(cleanPhoneInput("98450-12367")).toBe("9845012367");
    expect(cleanPhoneInput("9845012367999")).toBe("9845012367");
    expect(cleanPhoneInput("98a45b")).toBe("9845");
  });
});

describe("pincode", () => {
  it("accepts 6 digits that do not start with 0", () => {
    for (const p of ["560001", "110001", "682001", " 400001 "]) expect(valid(validatePincode(p)), p).toBe(true);
    expect(validatePincode(" 400001 ")).toEqual({ ok: true, value: "400001" });
  });
  it("refuses short, long, 0-leading, repeated and counting pincodes", () => {
    for (const p of ["", "5600", "5600011", "012345", "000000", "111111", "999999", "123456", "234567", "654321", "56000a"]) expect(valid(validatePincode(p)), p).toBe(false);
  });
});

describe("name, address, city, state", () => {
  it("accepts real names in any script and tidies them", () => {
    for (const n of ["Asha Rao", "A B", "D'Souza", "Ravi Kumar-Singh", "Dr. S. Radhakrishnan", "அருண் குமார்", "José Álvarez", "आशा राव"]) expect(valid(validatePersonName(n)), n).toBe(true);
    expect(validatePersonName("  Asha    Rao ")).toEqual({ ok: true, value: "Asha Rao" });
  });
  it("refuses names with digits or symbols, one letter, or a repeated letter", () => {
    for (const n of ["", "A", "1234", "Asha123", "<script>", "Asha@Rao", "aaaa", "Rahul😀", "-Asha", "x".repeat(81)]) expect(valid(validatePersonName(n)), n).toBe(false);
  });
  it("accepts real address lines and refuses made-up ones", () => {
    for (const a of ["12 MG Road", "Flat 4B, Green Park", "221B Baker St.", "No. 5, 2nd Cross (Behind the temple)"]) expect(valid(validateAddressLine(a, { required: true })), a).toBe(true);
    for (const a of ["", "123", "12345678", ".....", "@@@@ road", "<b>12</b> Road", "aaaaa road", "x".repeat(151)]) expect(valid(validateAddressLine(a, { required: true })), a).toBe(false);
    expect(validateAddressLine("   ", { required: false })).toEqual({ ok: true, value: "" });
  });
  it("accepts real cities and refuses digits and symbols", () => {
    for (const c of ["Bengaluru", "Navi Mumbai", "St. Thomas Mount", "Dehradun", "Port Blair (South Andaman)"]) expect(valid(validateCity(c)), c).toBe(true);
    for (const c of ["", "A", "12345", "Pune1", "!!!", "aaaa"]) expect(valid(validateCity(c)), c).toBe(false);
  });
  it("takes only a state from the list", () => {
    for (const s of INDIAN_STATES) expect(validateState(s)).toEqual({ ok: true, value: s });
    expect(validateState(" Kerala ")).toEqual({ ok: true, value: "Kerala" });
    for (const s of ["", "Atlantis", "kerala", "Orissa"]) expect(valid(validateState(s)), s).toBe(false);
  });
});

describe("email", () => {
  it("accepts ordinary addresses and lower-cases them", () => {
    for (const e of ["a@b.co", "name.surname+tag@example.com", "x_y-z@sub.example.in"]) expect(valid(validateEmail(e)), e).toBe(true);
    expect(validateEmail(" Reader@Example.COM ")).toEqual({ ok: true, value: "reader@example.com" });
  });
  it("refuses malformed addresses", () => {
    for (const e of ["", "a", "a@b", "a@b.c", "a b@c.com", "a..b@c.com", ".a@c.com", "a.@c.com", "a@-b.com", "a@b..com", "@c.com", `${"a".repeat(65)}@c.com`, `a@${"b".repeat(250)}.com`]) expect(valid(validateEmail(e)), e).toBe(false);
  });
});
