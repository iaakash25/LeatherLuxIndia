import { api } from "./api";
import { STUDIO_BACKGROUND, tintBackdrop } from "./photo-backdrop";

/**
 * Getting a photo from the admin's computer into the shop. A camera original is far bigger than the server accepts (Vercel limits a
 * request to 4.5 MB), so the browser does the work first: it reads the file, fits it on a 4:5 canvas the way every shop photo is
 * shown (1200×1500, plus a 480×600 small version for cards), optionally recolours a white backdrop to the shop's off-white, and
 * saves both as WebP. The server checks what it receives; it never trusts this.
 */
export const PHOTO_LIMITS = { fileBytes: 30 * 1024 * 1024, fullBytes: 1024 * 1024, thumbBytes: 256 * 1024 } as const;
const FULL = { w: 1200, h: 1500 }, THUMB = { w: 480, h: 600 };
const ACCEPTED = ["image/jpeg", "image/png", "image/webp"];
export const PHOTO_ACCEPT = ACCEPTED.join(",");

export class PhotoError extends Error {}

async function decode(file: File): Promise<ImageBitmap> {
  try {
    // "from-image" applies the camera's rotation, so a portrait photo is not sideways.
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new PhotoError("That file could not be read as a photo. Use a JPG, PNG or WebP image.");
  }
}

const canvasOf = (w: number, h: number) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };

const toBlob = (c: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new PhotoError("Your browser could not prepare the photo."))), type, quality));

/** WebP where the browser can make it, otherwise JPEG; the quality is lowered until the file fits `limit`. */
async function encode(c: HTMLCanvasElement, limit: number): Promise<Blob> {
  for (const quality of [0.84, 0.74, 0.64, 0.54]) {
    let b = await toBlob(c, "image/webp", quality);
    if (b.type !== "image/webp") b = await toBlob(c, "image/jpeg", quality);
    if (b.size <= limit) return b;
  }
  throw new PhotoError("That photo is still too large after shrinking. Try a simpler or smaller picture.");
}

export type Prepared = { full: Blob; thumb: Blob; preview: string };

/**
 * @param matchBackdrop recolour a white studio backdrop to the shop's off-white (leave off for photos taken on location).
 * @param holes also recolour the white inside the product (openings of handles, buckles, key rings); not for wallets and card holders.
 */
export async function preparePhoto(file: File, { matchBackdrop, holes = false }: { matchBackdrop: boolean; holes?: boolean }): Promise<Prepared> {
  if (!ACCEPTED.includes(file.type)) throw new PhotoError("Use a JPG, PNG or WebP photo.");
  if (file.size > PHOTO_LIMITS.fileBytes) throw new PhotoError("That file is over 30 MB. Choose a smaller photo.");
  const bitmap = await decode(file);
  try {
    const [r, g, b] = STUDIO_BACKGROUND;
    const full = canvasOf(FULL.w, FULL.h);
    const ctx = full.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new PhotoError("Your browser could not prepare the photo.");
    // White first, so a transparent PNG does not turn black; the shop's off-white goes on afterwards if asked for.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, FULL.w, FULL.h);
    const scale = Math.min((FULL.w * 0.94) / bitmap.width, (FULL.h * 0.94) / bitmap.height);
    const w = Math.round(bitmap.width * scale), h = Math.round(bitmap.height * scale);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bitmap, Math.round((FULL.w - w) / 2), Math.round((FULL.h - h) / 2), w, h);
    if (matchBackdrop) {
      const pixels = ctx.getImageData(0, 0, FULL.w, FULL.h);
      tintBackdrop(pixels.data, FULL.w, FULL.h, [r, g, b], { holes });
      ctx.putImageData(pixels, 0, 0);
    } else {
      // Keep the picture exactly as it is; only the border around a photo that is not 4:5 takes the shop's colour.
      const keep = ctx.getImageData(Math.round((FULL.w - w) / 2), Math.round((FULL.h - h) / 2), w, h);
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, 0, FULL.w, FULL.h);
      ctx.putImageData(keep, Math.round((FULL.w - w) / 2), Math.round((FULL.h - h) / 2));
    }
    const small = canvasOf(THUMB.w, THUMB.h);
    const sctx = small.getContext("2d");
    if (!sctx) throw new PhotoError("Your browser could not prepare the photo.");
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(full, 0, 0, THUMB.w, THUMB.h);
    const [fullBlob, thumbBlob] = [await encode(full, PHOTO_LIMITS.fullBytes), await encode(small, PHOTO_LIMITS.thumbBytes)];
    // The small version must be the same kind of file as the big one (the server insists).
    const thumbSameType = thumbBlob.type === fullBlob.type ? thumbBlob : await toBlob(small, fullBlob.type, 0.7);
    return { full: fullBlob, thumb: thumbSameType, preview: URL.createObjectURL(thumbSameType) };
  } finally {
    bitmap.close();
  }
}

/** [4 bytes: size of the full-size file][full-size file][small file], as server/src/routes/admin-inventory.ts expects. */
export async function uploadPhoto(p: Prepared): Promise<{ id: string; url: string }> {
  const head = new Uint8Array(4);
  new DataView(head.buffer).setUint32(0, p.full.size);
  const body = new Blob([head, p.full, p.thumb], { type: "application/octet-stream" });
  const r = await api<{ photo: { id: string; url: string } }>("/admin/photos", { method: "POST", file: body, timeoutMs: 60_000 });
  return r.photo;
}
