import { describe, it, expect } from "vitest";
import {
  presetPadding,
  presetPosition,
  relToPoint,
  pointToRel,
  sizePctToPx,
  pxToSizePct,
  PRESET_PADDING_RATIO,
} from "./geometry";

describe("presetPadding", () => {
  it("is 5% of the shorter side", () => {
    expect(presetPadding(1000, 600)).toBe(600 * PRESET_PADDING_RATIO);
    expect(presetPadding(600, 1000)).toBe(600 * PRESET_PADDING_RATIO);
  });
});

describe("presetPosition", () => {
  // A 1000x600 image centered at (500, 300); 100x40 watermark.
  const base = {
    bgCenterX: 500,
    bgCenterY: 300,
    bgWidth: 1000,
    bgHeight: 600,
    wmWidth: 100,
    wmHeight: 40,
  };
  const padding = presetPadding(base.bgWidth, base.bgHeight); // 30

  it("slot 5 keeps the watermark centered on the image", () => {
    expect(presetPosition({ ...base, position: 5 })).toEqual({ left: 500, top: 300 });
  });

  it("slot 1 pins to the top-left inside the padding", () => {
    const { left, top } = presetPosition({ ...base, position: 1 });
    // left edge of image = 0; offset by half watermark + padding
    expect(left).toBe(0 + base.wmWidth / 2 + padding);
    expect(top).toBe(0 + base.wmHeight / 2 + padding);
  });

  it("slot 9 pins to the bottom-right inside the padding", () => {
    const { left, top } = presetPosition({ ...base, position: 9 });
    // right edge = 1000, bottom edge = 600
    expect(left).toBe(1000 - base.wmWidth / 2 - padding);
    expect(top).toBe(600 - base.wmHeight / 2 - padding);
  });

  it("slot 3 (top-right) and slot 7 (bottom-left) mirror across center", () => {
    const tr = presetPosition({ ...base, position: 3 });
    const bl = presetPosition({ ...base, position: 7 });
    expect(tr.left).toBeCloseTo(2 * base.bgCenterX - bl.left);
    expect(tr.top).toBeCloseTo(2 * base.bgCenterY - bl.top);
  });

  it("keeps the same image-relative margin regardless of display scale (the #10 fix)", () => {
    // Same photo (2:1 aspect, top-left slot) shown at two window sizes.
    const small = presetPosition({
      position: 1, bgCenterX: 400, bgCenterY: 240, bgWidth: 800, bgHeight: 480, wmWidth: 80, wmHeight: 32,
    });
    const large = presetPosition({
      position: 1, bgCenterX: 600, bgCenterY: 360, bgWidth: 1200, bgHeight: 720, wmWidth: 120, wmHeight: 48,
    });
    // Distance from the image's top-left corner, normalized by image width,
    // must match across the two display sizes.
    const smallMargin = (small.left - (400 - 800 / 2)) / 800;
    const largeMargin = (large.left - (600 - 1200 / 2)) / 1200;
    expect(smallMargin).toBeCloseTo(largeMargin);
  });
});

describe("relToPoint / pointToRel", () => {
  // 1000x600 image centered at (500, 300) → top-left corner at (0, 0).
  const bg = { centerX: 500, centerY: 300, width: 1000, height: 600 };

  it("maps center fraction (0.5, 0.5) to the image center", () => {
    expect(relToPoint({ x: 0.5, y: 0.5 }, bg)).toEqual({ left: 500, top: 300 });
  });

  it("maps (0,0) to the top-left corner and (1,1) to the bottom-right", () => {
    expect(relToPoint({ x: 0, y: 0 }, bg)).toEqual({ left: 0, top: 0 });
    expect(relToPoint({ x: 1, y: 1 }, bg)).toEqual({ left: 1000, top: 600 });
  });

  it("round-trips an arbitrary point", () => {
    const point = { left: 730, top: 215 };
    const rel = pointToRel(point, bg);
    expect(relToPoint(rel, bg)).toEqual(point);
  });

  it("keeps the same relative spot across different image sizes (per-type persistence)", () => {
    const rel = { x: 0.8, y: 0.25 };
    const small = relToPoint(rel, { centerX: 400, centerY: 240, width: 800, height: 480 });
    const large = relToPoint(rel, { centerX: 600, centerY: 360, width: 1200, height: 720 });
    // Normalized back, both are the same fraction of their image.
    expect(pointToRel(small, { centerX: 400, centerY: 240, width: 800, height: 480 })).toEqual(rel);
    expect(pointToRel(large, { centerX: 600, centerY: 360, width: 1200, height: 720 })).toEqual(rel);
  });

  it("guards against a zero-sized image", () => {
    expect(pointToRel({ left: 0, top: 0 }, { centerX: 0, centerY: 0, width: 0, height: 0 })).toEqual({ x: 0.5, y: 0.5 });
  });
});

describe("sizePctToPx / pxToSizePct", () => {
  it("round-trips", () => {
    const baseDim = 720;
    expect(sizePctToPx(baseDim, 5)).toBe(36);
    expect(pxToSizePct(baseDim, 36)).toBeCloseTo(5);
  });

  it("yields the same percentage of the photo across window sizes (the font-size fix)", () => {
    // 5% on a photo displayed at short-side 480 vs 960.
    const pct = 5;
    const pxSmall = sizePctToPx(480, pct);
    const pxLarge = sizePctToPx(960, pct);
    expect(pxToSizePct(480, pxSmall)).toBeCloseTo(pct);
    expect(pxToSizePct(960, pxLarge)).toBeCloseTo(pct);
    // The display px differ, but each is the same fraction of its display.
    expect(pxSmall / 480).toBeCloseTo(pxLarge / 960);
  });

  it("guards against divide-by-zero", () => {
    expect(pxToSizePct(0, 100)).toBe(0);
  });
});
