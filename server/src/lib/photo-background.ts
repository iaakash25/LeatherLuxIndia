import type { Raw } from "./photo-haze.js";

export type Rgb = [number, number, number];

/** The storefront's own off-white (`--chalk` in src/styles.css), which is also the backdrop of the 22 starter photos. */
export const STUDIO_BACKGROUND = "#f4f2ed";

export function parseColour(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`"${hex}" is not a colour like #f4f2ed`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A pixel is backdrop-white when its darkest channel is this light and it is hardly coloured. */
const LIGHT_MIN = 235, CHROMA_MAX = 14;
/** Beyond the backdrop, this many pixels of the product's soft outline are blended too (so no pale halo is left around it). */
const FRINGE = 3, FRINGE_LO = 200;

/**
 * Turns the white studio backdrop of a photo into `colour`, leaving the product as it is.
 *
 * The backdrop is multiplied by the colour (white becomes exactly `colour`; a light grey stays proportionally darker, so soft
 * shadows and sensor noise survive). Which pixels count as backdrop depends on `holes`:
 *  - false (the default): only the white that is connected to the photo's edge. White that belongs to the product, such as the card
 *    slips inside a wallet, is enclosed by it and is not touched.
 *  - true: every backdrop-white pixel, including the openings of handles, belt buckles and key-ring eyes. Use it for photos where
 *    those openings have been cleaned to white (see photo-haze.ts), never for wallets and card cases.
 * The product's outline (a few pixels of anti-aliasing next to the backdrop) is blended by how light each pixel is.
 */
export function tintBackdrop(img: Raw, colour: Rgb, { holes = false }: { holes?: boolean } = {}): Raw {
  const { width: w, height: h, channels: c, data } = img;
  const n = w * h;
  const factor = colour.map((v) => v / 255);

  const light = new Uint8Array(n);
  const lowest = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = data[i * c]!, g = data[i * c + 1]!, b = data[i * c + 2]!;
    const lo = Math.min(r, g, b);
    lowest[i] = lo;
    if (lo >= LIGHT_MIN && Math.max(r, g, b) - lo <= CHROMA_MAX) light[i] = 1;
  }

  // region: 1 = backdrop. Either all light pixels, or only those reachable from the photo's border through light pixels.
  let region = light;
  if (!holes) {
    region = new Uint8Array(n);
    const queue = new Int32Array(n);
    let tail = 0;
    const seed = (i: number) => { if (light[i] && !region[i]) { region[i] = 1; queue[tail++] = i; } };
    for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
    for (let head = 0; head < tail; head++) {
      const i = queue[head]!, x = i % w;
      if (x > 0) seed(i - 1);
      if (x < w - 1) seed(i + 1);
      if (i >= w) seed(i - w);
      if (i < n - w) seed(i + w);
    }
  }

  // weight 0..255 per pixel: 255 on the backdrop, fading with how light the pixel is within FRINGE pixels of it.
  const weight = new Uint8Array(n);
  let frontier: number[] = [];
  for (let i = 0; i < n; i++) if (region[i]) { weight[i] = 255; frontier.push(i); }
  const seen = Uint8Array.from(region);
  for (let step = 0; step < FRINGE && frontier.length; step++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < n - w ? i + w : -1]) {
        if (j < 0 || seen[j]) continue;
        seen[j] = 1;
        weight[j] = Math.round(255 * Math.min(1, Math.max(0, (lowest[j]! - FRINGE_LO) / (LIGHT_MIN - FRINGE_LO))));
        next.push(j);
      }
    }
    frontier = next;
  }

  const out = Buffer.from(data);
  for (let i = 0; i < n; i++) {
    const k = weight[i]! / 255;
    if (!k) continue;
    for (let j = 0; j < 3; j++) out[i * c + j] = Math.round(data[i * c + j]! * (1 - k * (1 - factor[j]!)));
  }
  return { ...img, data: out };
}
