import { describe, expect, it } from "vitest";
import { cleanHaze, type Raw } from "../src/lib/photo-haze.js";

const W = 400, H = 300;
type Rgb = [number, number, number];
const WHITE: Rgb = [255, 255, 255], LEATHER: Rgb = [90, 45, 40], LAVENDER: Rgb = [214, 214, 241], FILM: Rgb = [205, 205, 212];

/** A white 400x300 photo; `paint` draws rectangles on it. */
function photo(paint: (rect: (x0: number, y0: number, x1: number, y1: number, c: Rgb) => void) => void): Raw {
  const data = Buffer.alloc(W * H * 3, 255);
  paint((x0, y0, x1, y1, c) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data.set(c, (y * W + x) * 3);
  });
  return { data, width: W, height: H, channels: 3 };
}
const at = (img: Raw, x: number, y: number): Rgb => [img.data[(y * W + x) * 3]!, img.data[(y * W + x) * 3 + 1]!, img.data[(y * W + x) * 3 + 2]!];

describe("cleanHaze", () => {
  it("whitens the lavender film left inside a strap loop and leaves the leather alone", async () => {
    // a leather frame (a handle loop) with the cut-out's lavender film inside it
    const img = photo((rect) => {
      rect(100, 60, 300, 220, LEATHER);
      rect(124, 84, 276, 196, LAVENDER);
    });
    const out = await cleanHaze(img);
    expect(at(out, 200, 140)).toEqual(WHITE);
    expect(at(out, 130, 90)).toEqual(WHITE); // right up to the leather
    expect(at(out, 110, 140)).toEqual(LEATHER);
    expect(at(out, 200, 70)).toEqual(LEATHER);
    expect(at(out, 20, 20)).toEqual(WHITE); // the backdrop stays white
    expect(img.data.equals(out.data)).toBe(false);
  });

  it("keeps a thin light strip, like the protective film on a strap or a highlight", async () => {
    const img = photo((rect) => {
      rect(60, 100, 340, 130, LEATHER);
      rect(60, 130, 340, 138, FILM); // 8 px of pale film between two bands of leather
      rect(60, 138, 340, 170, LEATHER);
    });
    const out = await cleanHaze(img);
    for (const x of [70, 130, 200, 270, 330]) expect(at(out, x, 134)).toEqual(FILM); // the whole strip, not just its middle
    expect(at(out, 200, 110)).toEqual(LEATHER);
    expect(at(out, 200, 150)).toEqual(LEATHER);
  });

  it("does nothing to a photo with no pale regions inside the product", async () => {
    const img = photo((rect) => rect(80, 60, 320, 240, LEATHER));
    const out = await cleanHaze(img);
    expect(out.data.equals(img.data)).toBe(true);
  });

  it("only cleans regions brighter than the limit it is given", async () => {
    const dull: Rgb = [150, 150, 175]; // a grey-lavender island, darker than the default limit
    const img = photo((rect) => {
      rect(100, 60, 300, 220, LEATHER);
      rect(124, 84, 276, 196, dull);
    });
    expect(at(await cleanHaze(img), 200, 140)).toEqual(dull);
    expect(at(await cleanHaze(img, 135), 200, 140)).toEqual(WHITE);
  });
});
