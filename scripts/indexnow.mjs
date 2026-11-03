// Tells Bing and the other IndexNow search engines (Yandex, Naver, Seznam) which pages exist, so they crawl them now instead of whenever
// they happen to find the site. Google does not use IndexNow: it learns from Search Console and the sitemap.
//
//   node scripts/indexnow.mjs            sends every page of the sitemap to https://api.indexnow.org/IndexNow
//   node scripts/indexnow.mjs --dry-run  shows what would be sent, sends nothing
//
// The key is a public password: the file public/<key>.txt, served at https://leatherluxindia.com/<key>.txt, proves the site is ours.
// Run it after new products or pages go live (the sitemap is read from the live site, so deploy first). At most 10,000 addresses a time.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE = "https://leatherluxindia.com";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const keyFile = fs.readdirSync(path.join(root, "public")).find((f) => /^[0-9a-f]{32}\.txt$/.test(f));
if (!keyFile) throw new Error("No IndexNow key file in public/ (a 32-character hex name ending in .txt)");
const key = keyFile.replace(".txt", "");

const sitemap = await (await fetch(`${SITE}/sitemap.xml`)).text();
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
if (!urlList.length) throw new Error("The sitemap lists no pages");

// The key file must already be live, or the search engines will refuse the list.
const live = (await (await fetch(`${SITE}/${keyFile}`)).text()).trim();
if (live !== key) throw new Error(`${SITE}/${keyFile} does not show the key yet. Deploy first.`);

console.log(`${urlList.length} pages from ${SITE}/sitemap.xml, key ${key.slice(0, 6)}…`);
if (process.argv.includes("--dry-run")) {
  console.log(urlList.slice(0, 5).join("\n"), "\n…");
} else {
  const res = await fetch("https://api.indexnow.org/IndexNow", {
    method: "POST", headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: new URL(SITE).host, key, keyLocation: `${SITE}/${keyFile}`, urlList }),
  });
  console.log(`IndexNow answered ${res.status} ${res.statusText} (200 and 202 both mean accepted)`);
}
