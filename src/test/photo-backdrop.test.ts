import { describe, expect, it } from "vitest";
import { STUDIO_BACKGROUND, tintBackdrop, type Rgb } from "@/lib/photo-backdrop";

const W = 120, H = 90;
const WHITE: Rgb = [255, 255, 255], LEATHER: Rgb = [90, 45, 40];

/** A white RGBA photo; `paint` draws rectangles on it. */
function photo(paint: (rect: (x0: number, y0: number, x1: number, y1: number, c: Rgb) => void) => void) {
  const px = new Uint8ClampedArray(W * H * 4).fill(255);
  paint((x0, y0, x1, y1, c) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px.set([...c, 255], (y * W + x) * 4);
  });
  return px;
}
const at = (px: Uint8ClampedArray, x: number, y: number) => [px[(y * W + x) * 4]!, px[(y * W + x) * 4 + 1]!, px[(y * W + x) * 4 + 2]!, px[(y * W + x) * 4 + 3]!];

describe("tintBackdrop (the browser's copy of the importer's backdrop recolour)", () => {
  it("turns the white backdrop into the shop's off-white and leaves the product and its alpha alone", () => {
    const px = photo((rect) => { rect(30, 20, 90, 70, LEATHER); });
    tintBackdrop(px, W, H, STUDIO_BACKGROUND);
    expect(at(px, 3, 3)).toEqual([...STUDIO_BACKGROUND, 255]);
    expect(at(px, 60, 40)).toEqual([...LEATHER, 255]);
  });

  it("keeps white that the product encloses, such as a card slip", () => {
    const px = photo((rect) => { rect(20, 10, 100, 80, LEATHER); rect(45, 30, 75, 55, WHITE); });
    tintBackdrop(px, W, H, STUDIO_BACKGROUND);
    expect(at(px, 60, 42)).toEqual([...WHITE, 255]);
    expect(at(px, 2, 2)).toEqual([...STUDIO_BACKGROUND, 255]);
  });

  it("with holes: true also recolours the white openings, such as inside a handle", () => {
    const px = photo((rect) => { rect(20, 10, 100, 80, LEATHER); rect(45, 30, 75, 55, WHITE); });
    tintBackdrop(px, W, H, STUDIO_BACKGROUND, { holes: true });
    expect(at(px, 60, 42)).toEqual([...STUDIO_BACKGROUND, 255]);
    expect(at(px, 30, 20)).toEqual([...LEATHER, 255]);
  });

  it("blends the pale outline of the product so no white halo is left", () => {
    const px = photo((rect) => { rect(40, 20, 100, 70, LEATHER); rect(39, 20, 40, 70, [236, 232, 231]); });
    tintBackdrop(px, W, H, STUDIO_BACKGROUND);
    const edge = at(px, 39, 40);
    expect(edge[0]).toBeLessThan(236);
    expect(edge[0]).toBeGreaterThan(200);
  });
});
