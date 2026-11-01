import sharp from "sharp";

/** Raw pixels, as sharp hands them over (8 bits per channel, no padding). */
export type Raw = { data: Buffer; width: number; height: number; channels: 3 | 4 };

/**
 * Some studio photos were cut out from their background by hand, and the cut-out left a pale lavender film behind: inside strap loops,
 * through belt buckles and coils, under bags, in key-ring eyes. `cleanHaze` turns those regions white.
 *
 * A pixel is "light" when its darkest channel is at least `lightMin` and it is not strongly coloured. A light region is cleaned only when it
 * is WIDE: it must survive an erosion of RADIUS pixels. That is what keeps the thin, light protective film on a bag strap, a silver
 * clip or a highlight on glossy leather (all of which are light too) from being erased. Edges are feathered so the product outline
 * keeps its anti-aliasing. It is meant for photos of products on a white backdrop, and only for photos someone has checked.
 */
export const HAZE = { chromaMax: 45, radius: 7, minArea: 0.0002, featherLo: 190, featherHi: 235, work: 700, lightMin: 170 } as const;

const erode4 = (src: Uint8Array, w: number, h: number) => {
  const out = new Uint8Array(src.length);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (src[i] && src[i - 1] && src[i + 1] && src[i - w] && src[i + w]) out[i] = 1;
    }
  }
  return out;
};

const dilate4 = (src: Uint8Array, w: number, h: number) => {
  const out = new Uint8Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (src[i] || (x > 0 && src[i - 1]) || (x < w - 1 && src[i + 1]) || (y > 0 && src[i - w]) || (y < h - 1 && src[i + w])) out[i] = 1;
    }
  }
  return out;
};

/** The 4-connected regions of `mask` that hold at least `minArea` pixels. */
function largeRegions(mask: Uint8Array, w: number, h: number, minArea: number) {
  const seen = new Uint8Array(mask.length), keep = new Uint8Array(mask.length), queue = new Int32Array(mask.length);
  let tail = 0;
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    const start = tail;
    queue[tail++] = s;
    seen[s] = 1;
    for (let head = start; head < tail; head++) {
      const i = queue[head]!, x = i % w, y = (i - x) / w;
      const next = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of next) if (j >= 0 && mask[j] && !seen[j]) { seen[j] = 1; queue[tail++] = j; }
    }
    if (tail - start >= minArea) for (let k = start; k < tail; k++) keep[queue[k]!] = 1;
  }
  return keep;
}

/** Returns a copy of `img` with the haze whitened. The work is done on a small copy (so sizes are in the same units for every photo) and the result is scaled back up. */
export async function cleanHaze(img: Raw, lightMin: number = HAZE.lightMin): Promise<Raw> {
  const { data: px, info } = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: img.channels } })
    .resize({ width: HAZE.work, height: HAZE.work, fit: "inside", withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = info.width, h = info.height, ch = info.channels, n = w * h;

  const lowest = new Uint8Array(n), light = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = px[i * ch]!, g = px[i * ch + 1]!, b = px[i * ch + 2]!;
    const lo = Math.min(r, g, b);
    lowest[i] = lo;
    if (lo >= lightMin && Math.max(r, g, b) - lo <= HAZE.chromaMax) light[i] = 1;
  }

  let core: Uint8Array = light;
  for (let k = 0; k < HAZE.radius; k++) core = erode4(core, w, h);
  let region: Uint8Array = largeRegions(core, w, h, Math.max(1, Math.round(HAZE.minArea * n)));
  for (let k = 0; k <= HAZE.radius; k++) region = dilate4(region, w, h);
  for (let i = 0; i < n; i++) if (!light[i]) region[i] = 0;
  if (!region.some(Boolean)) return img;

  // Inside the region: fully white. Within 3 px of it: blended by how light the pixel is, so the outline keeps its softness.
  let near: Uint8Array = region;
  for (let k = 0; k < 3; k++) near = dilate4(near, w, h);
  const weight = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (region[i]) weight[i] = 255;
    else if (near[i]) weight[i] = Math.round(255 * Math.min(1, Math.max(0, (lowest[i]! - HAZE.featherLo) / (HAZE.featherHi - HAZE.featherLo))));
  }
  // sharp may return the grey weights with 3 channels, so read the channel count it reports instead of assuming one.
  const scaled = await sharp(weight, { raw: { width: w, height: h, channels: 1 } }).resize({ width: img.width, height: img.height, fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  const full = scaled.data, fc = scaled.info.channels;

  const out = Buffer.from(img.data);
  const c = img.channels, total = img.width * img.height;
  for (let i = 0; i < total; i++) {
    const k = full[i * fc]!;
    if (!k) continue;
    for (let j = 0; j < 3; j++) {
      const v = out[i * c + j]!;
      out[i * c + j] = Math.round(v + ((255 - v) * k) / 255);
    }
  }
  return { ...img, data: out };
}
