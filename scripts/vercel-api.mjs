// Adds the API to a Vercel build, so the storefront and the API ship as ONE deployment on one domain.
//
// The framework build (`vite build`, run with VERCEL=1) writes Vercel's Build Output to .vercel/output with the server-rendered site as a
// function. This script then bundles server/src/vercel.ts (the same Express app that `npm run dev` in server/ runs) into a second function,
// `api`, and routes /api/* to it ahead of everything else. It does nothing outside Vercel, so Lovable and local builds are unaffected.
//
//   node scripts/vercel-api.mjs            on Vercel (VERCEL is set) or
//   node scripts/vercel-api.mjs --force    to try it locally after `VERCEL=1 npm run build`
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.VERCEL && !process.argv.includes("--force")) {
  console.log("vercel-api: not a Vercel build, nothing to add");
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, ".vercel", "output");
const configPath = path.join(out, "config.json");
if (!fs.existsSync(configPath) || !fs.existsSync(path.join(out, "functions", "__server.func"))) {
  throw new Error("vercel-api: .vercel/output was not produced by the framework build. Run `vite build` with VERCEL=1 first.");
}

// 1. The server has its own dependencies (express, pg, ...), and Vercel's install step only covers the root package.json.
const require = createRequire(path.join(root, "server", "package.json"));
const resolvable = () => { try { require.resolve("esbuild"); require.resolve("express"); return true; } catch { return false; } };
if (!resolvable()) {
  console.log("vercel-api: installing the server's dependencies");
  execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["ci", "--prefix", "server", "--no-audit", "--no-fund"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
}
const { build } = require("esbuild");

// 2. One self-contained file. `pg-native` is an optional extra that `pg` only uses when present.
const fn = path.join(out, "functions", "api.func");
fs.rmSync(fn, { recursive: true, force: true });
fs.mkdirSync(fn, { recursive: true });
const result = await build({
  entryPoints: [path.join(root, "server", "src", "vercel.ts")],
  outfile: path.join(fn, "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["pg-native"],
  // The bundled CommonJS packages (express, pg, ...) call require(), which an ES module does not have.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  legalComments: "none",
  logLevel: "warning",
  metafile: true,
});
const size = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0);

// 3. Same runtime as the server-rendered site, so there is one Node version to reason about.
const ssr = JSON.parse(fs.readFileSync(path.join(out, "functions", "__server.func", ".vc-config.json"), "utf8"));
fs.writeFileSync(path.join(fn, ".vc-config.json"), JSON.stringify({ handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false, supportsResponseStreaming: false, runtime: ssr.runtime }, null, 2));

// 4. Routing: /api/* goes to the function, before the static files and the server-rendered pages. Product photos are static files with
//    content-hashed names, so browsers may keep them for a year.
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
config.routes = (config.routes ?? []).filter((r) => r.dest !== "/api" && !(r.src ?? "").startsWith("/media/"));
config.routes.unshift(
  { src: "/api/(.*)", dest: "/api" },
  { headers: { "cache-control": "public, max-age=31536000, immutable" }, src: "/media/(.*)" },
);
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

console.log(`vercel-api: added the API function (${(size / 1024).toFixed(0)} KB, runtime ${ssr.runtime}) and routed /api/* to it`);
