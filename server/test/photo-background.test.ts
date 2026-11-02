import { describe, expect, it } from "vitest";
import { parseColour, STUDIO_BACKGROUND, tintBackdrop } from "../src/lib/photo-background.js";
import type { Raw } from "../src/lib/photo-haze.js";

const W = 200, H = 150;
type Rgb = [number, number, number];
const WHITE: Rgb = [255, 255, 255], LEATHER: Rgb = [90, 45, 40], CREAM = parseColour(STUDIO_BACKGROUND);

/** A white 200x150 photo; `paint` draws rectangles on it. */
function photo(paint: (rect: (x0: number, y0: number, x1: number, y1: number, c: Rgb) => void) => void): Raw {
  const data = Buffer.alloc(W * H * 3, 255);
  paint((x0, y0, x1, y1, c) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set(c, (y * W + x) * 3);
  });
  return { data, width: W, height: H, channels: 3 };
}
const at = (img: Raw, x: number, y: number): Rgb => [img.data[(y * W + x) * 3]!, img.data[(y * W + x) * 3 + 1]!, img.data[(y * W + x) * 3 + 2]!];

// a leather frame (a handle loop) with the backdrop showing through its opening, and a white card slip enclosed inside a leather block
const frame = () => photo((rect) => {
  rect(30, 30, 110, 120, LEATHER);
  rect(50, 50, 90, 100, WHITE); // opening: enclosed backdrop
  rect(130, 30, 180, 120, LEATHER);
  rect(140, 60, 170, 90, WHITE); // card slip: part of the product
});

describe("tintBackdrop", () => {
  it("turns the backdrop into exactly the studio colour and leaves the product alone", () => {
    const out = tintBackdrop(frame(), CREAM);
    expect(at(out, 5, 5)).toEqual(CREAM);
    expect(at(out, 195, 145)).toEqual(CREAM);
    expect(at(out, 70, 40)).toEqual(LEATHER);
    expect(at(out, 150, 40)).toEqual(LEATHER);
  });

  it("by default keeps white that the product encloses (card slips, and the openings of handles)", () => {
    const out = tintBackdrop(frame(), CREAM);
    expect(at(out, 150, 75)).toEqual(WHITE);
    expect(at(out, 70, 75)).toEqual(WHITE);
  });

  it("with holes: true also tints the openings, which is how the cleaned handle photos are done", () => {
    const out = tintBackdrop(frame(), CREAM, { holes: true });
    expect(at(out, 70, 75)).toEqual(CREAM);
    expect(at(out, 70, 40)).toEqual(LEATHER);
  });

  it("keeps a soft shadow proportionally darker than the backdrop", () => {
    const img = photo((rect) => { rect(60, 100, 140, 110, [240, 240, 240]); });
    const out = tintBackdrop(img, CREAM);
    const [r, g, b] = at(out, 100, 105);
    expect(r).toBeLessThan(CREAM[0]);
    expect(r).toBe(Math.round((240 * CREAM[0]) / 255));
    expect(b).toBeLessThan(g);
  });

  it("blends the pale outline of the product so no white halo is left", () => {
    // one pixel of anti-aliasing (light grey) between the backdrop and the leather
    const img = photo((rect) => { rect(60, 40, 140, 110, LEATHER); rect(59, 40, 60, 110, [236, 232, 231]); });
    const out = tintBackdrop(img, CREAM);
    const edge = at(out, 59, 70);
    expect(edge[0]).toBeLessThan(236);
    expect(edge[0]).toBeGreaterThan(200);
    expect(at(out, 61, 70)).toEqual(LEATHER);
  });

  it("does not modify its input, and a photo with no white is returned unchanged", () => {
    const img = frame();
    const before = Buffer.from(img.data);
    tintBackdrop(img, CREAM);
    expect(img.data.equals(before)).toBe(true);
    const dark = photo((rect) => rect(0, 0, W, H, LEATHER));
    expect(tintBackdrop(dark, CREAM).data.equals(dark.data)).toBe(true);
  });
});

describe("parseColour", () => {
  it("reads #rrggbb and refuses anything else", () => {
    expect(parseColour("#f4f2ed")).toEqual([244, 242, 237]);
    expect(parseColour("F4F2ED")).toEqual([244, 242, 237]);
    expect(() => parseColour("cream")).toThrow(/not a colour/);
  });
});
