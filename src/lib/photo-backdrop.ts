/**
 * Turns the white studio backdrop of a photo into the shop's off-white, in the browser, before a photo is uploaded. This is the same
 * algorithm as server/src/lib/photo-background.ts (which `npm run products:import` uses for the photographed range), so photos added
 * in the admin console look like the rest of the shop. Keep the two in step.
 *
 * By default only white that is connected to the photo's edge counts as backdrop, so white that belongs to the product (a card slip, an ID
 * window) is left alone. With `holes`, white inside the product counts too (the openings of handles, buckles and key rings), which is wrong
 * for wallets and card holders, whose white parts are real. The product's soft outline is blended a few pixels in, so no pale halo is left around it.
 */
export type Rgb = [number, number, number];

/** The storefront's own off-white (`--chalk` in src/styles.css). */
export const STUDIO_BACKGROUND: Rgb = [244, 242, 237];

const LIGHT_MIN = 235, CHROMA_MAX = 14;
const FRINGE = 3, FRINGE_LO = 200;

/** Recolours the backdrop of RGBA pixels in place (the format of canvas ImageData). */
export function tintBackdrop(px: Uint8ClampedArray, width: number, height: number, colour: Rgb, { holes = false }: { holes?: boolean } = {}): void {
  const n = width * height;
  const factor = colour.map((v) => v / 255);

  const light = new Uint8Array(n);
  const lowest = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = px[i * 4]!, g = px[i * 4 + 1]!, b = px[i * 4 + 2]!;
    const lo = Math.min(r, g, b);
    lowest[i] = lo;
    if (lo >= LIGHT_MIN && Math.max(r, g, b) - lo <= CHROMA_MAX) light[i] = 1;
  }

  // The backdrop: light pixels reachable from the photo's border through light pixels (or every light pixel, with `holes`).
  let region = light;
  if (!holes) {
    region = new Uint8Array(n);
    const queue = new Int32Array(n);
    let tail = 0;
    const seed = (i: number) => { if (light[i] && !region[i]) { region[i] = 1; queue[tail++] = i; } };
    for (let x = 0; x < width; x++) { seed(x); seed((height - 1) * width + x); }
    for (let y = 0; y < height; y++) { seed(y * width); seed(y * width + width - 1); }
    for (let head = 0; head < tail; head++) {
      const i = queue[head]!, x = i % width;
      if (x > 0) seed(i - 1);
      if (x < width - 1) seed(i + 1);
      if (i >= width) seed(i - width);
      if (i < n - width) seed(i + width);
    }
  }

  // weight 0..255: 255 on the backdrop, fading with how light the pixel is within FRINGE pixels of it.
  const weight = new Uint8Array(n);
  let frontier: number[] = [];
  for (let i = 0; i < n; i++) if (region[i]) { weight[i] = 255; frontier.push(i); }
  const seen = Uint8Array.from(region);
  for (let step = 0; step < FRINGE && frontier.length; step++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % width;
      for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i >= width ? i - width : -1, i < n - width ? i + width : -1]) {
        if (j < 0 || seen[j]) continue;
        seen[j] = 1;
        weight[j] = Math.round(255 * Math.min(1, Math.max(0, (lowest[j]! - FRINGE_LO) / (LIGHT_MIN - FRINGE_LO))));
        next.push(j);
      }
    }
    frontier = next;
  }

  for (let i = 0; i < n; i++) {
    const k = weight[i]! / 255;
    if (!k) continue;
    for (let j = 0; j < 3; j++) px[i * 4 + j] = Math.round(px[i * 4 + j]! * (1 - k * (1 - factor[j]!)));
  }
}
