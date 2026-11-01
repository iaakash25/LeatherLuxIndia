import { describe, expect, it } from "vitest";
import { securityHeaders } from "@/lib/security-headers";

const directives = (csp: string) => Object.fromEntries(csp.split("; ").map((d) => { const [name, ...rest] = d.split(" "); return [name, rest]; })) as Record<string, string[]>;

describe("securityHeaders", () => {
  const h = securityHeaders("https://api.leatherluxindia.com");
  const csp = directives(h["Content-Security-Policy"]!);

  it("lets the browser talk to the site and the API, and nothing else", () => {
    expect(csp["connect-src"]).toEqual(["'self'", "https://api.leatherluxindia.com"]);
    expect(csp["img-src"]).toEqual(expect.arrayContaining(["'self'", "https://api.leatherluxindia.com"]));
    expect(csp["default-src"]).toEqual(["'self'"]);
  });

  it("forbids framing, plugins, other form targets, base-tag tricks and eval", () => {
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["form-action"]).toEqual(["'self'"]);
    expect(csp["base-uri"]).toEqual(["'self'"]);
    expect(h["Content-Security-Policy"]).not.toMatch(/unsafe-eval|\*/);
    expect(csp["script-src"]).toEqual(["'self'", "'unsafe-inline'"]); // inline only because the framework's hydration scripts are; no other origin
    expect(h["X-Frame-Options"]).toBe("DENY");
  });

  it("allows only the font host the site uses", () => {
    expect(csp["style-src"]).toContain("https://fonts.googleapis.com");
    expect(csp["font-src"]).toContain("https://fonts.gstatic.com");
  });

  it("forces https and sends the browser hardening headers", () => {
    expect(csp["upgrade-insecure-requests"]).toBeDefined();
    expect(h["Strict-Transport-Security"]).toMatch(/max-age=\d{8,}/);
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Permissions-Policy"]).toMatch(/camera=\(\)/);
  });

  it("does not force https for a local http API, and copes with no API at all", () => {
    expect(directives(securityHeaders("http://localhost:4000")["Content-Security-Policy"]!)["upgrade-insecure-requests"]).toBeUndefined();
    const guest = directives(securityHeaders("")["Content-Security-Policy"]!);
    expect(guest["connect-src"]).toEqual(["'self'"]);
  });
});
