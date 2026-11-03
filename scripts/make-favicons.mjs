// Makes the site's icons from the logo: public/favicon.ico (16, 32 and 48 px), favicon-96x96.png and apple-touch-icon.png (180 px).
//
//   node scripts/make-favicons.mjs [logo.png]      (default: scripts/favicon-source.png, a copy of the logo uploaded in the admin console)
//
// Why files and not the logo itself: search engines only accept a SQUARE icon whose side is a multiple of 48 px, and the logo (wordmark and
// tagline) is wide and unreadable at 16 px. So the icon is the three letters of the logo, centred on the shop's off-white. Run this again
// whenever the logo changes, and look at the result: the crop below (the top part of the logo, without the tagline) suits the current logo.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sharp = createRequire(path.join(root, "server", "package.json"))("sharp"); // the server's image library; the storefront has none of its own
const source = path.resolve(process.argv[2] ?? path.join(root, "scripts", "favicon-source.png"));
const BACKGROUND = "#f4f2ed"; // --chalk in src/styles.css
const MARK_HEIGHT = 0.8;      // keep the top 80% of the logo: the letters, without the tagline under them
const MARGIN = 0.07;          // empty space around the mark, as a fraction of the icon (search results may round the corners)

const meta = await sharp(source).metadata();
const top = await sharp(source).extract({ left: 0, top: 0, width: meta.width, height: Math.round(meta.height * MARK_HEIGHT) }).ensureAlpha().png().toBuffer();

/** The smallest box around everything that is not transparent, so the mark fills the icon whatever empty margin the logo file has. */
async function visibleBox(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] > 24) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  }
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
const mark = await sharp(top).extract(await visibleBox(top)).png().toBuffer();

/**
 * The first letter on its own, for the 16 px icon (three thin letters turn to mush at that size; one letter stays a letter). Found by
 * looking at the top rows only, above the tagline band that crosses the letters, where the letters are separate: the first letter runs
 * from the left edge to where the second one starts.
 */
async function firstLetter(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rows = Math.max(4, Math.round(info.height * 0.12));
  const filled = Array.from({ length: info.width }, (_, x) => { for (let y = 0; y < rows; y++) if (data[(y * info.width + x) * 4 + 3] > 24) return true; return false; });
  let x = filled.indexOf(true);
  while (x < info.width && filled[x]) x++;      // the first letter's top serif
  while (x < info.width && !filled[x]) x++;     // the gap
  const end = Math.max(8, x - 2);               // where the second letter starts
  return sharp(png).extract({ left: 0, top: 0, width: end, height: info.height }).png().toBuffer();
}
const letter = await sharp(await firstLetter(mark)).extract(await visibleBox(await firstLetter(mark))).png().toBuffer();

/** The icon at `size` px: the mark centred on a solid square (the single letter at 16 px). Drawn from the logo at full size so every size is sharp. */
async function icon(size) {
  const inner = Math.round(size * (1 - 2 * (size <= 16 ? 0.14 : MARGIN)));
  const fitted = await sharp(size <= 16 ? letter : mark).resize({ width: inner, height: inner, fit: "inside", kernel: "lanczos3" }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: BACKGROUND } }).composite([{ input: fitted, gravity: "centre" }]).png({ compressionLevel: 9 }).toBuffer();
}

const out = (name, data) => { fs.writeFileSync(path.join(root, "public", name), data); console.log(`public/${name}  ${(data.length / 1024).toFixed(1)} KB`); };
out("favicon-96x96.png", await icon(96));
out("apple-touch-icon.png", await icon(180));

// favicon.ico: a container holding PNG pictures of 16, 32 and 48 px (every browser since 2012 reads PNG inside an .ico)
const sizes = [16, 32, 48];
const pngs = await Promise.all(sizes.map(icon));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const at = 6 + 16 * i;
  header.writeUInt8(s, at); header.writeUInt8(s, at + 1); header.writeUInt8(0, at + 2); header.writeUInt8(0, at + 3);
  header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(pngs[i].length, at + 8); header.writeUInt32LE(offset, at + 12);
  offset += pngs[i].length;
});
out("favicon.ico", Buffer.concat([header, ...pngs]));
