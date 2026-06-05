// Pure geometry for watermark placement & sizing.
//
// These functions are intentionally DOM-free so they can be unit tested and
// so the "window size must not affect the exported result" guarantee lives in
// one verifiable place. All inputs/outputs are in the canvas display space;
// because export scales the whole canvas uniformly, a value expressed as a
// fraction of the displayed image is the same fraction of the exported image.

/** Preset padding as a fraction of the image's shorter side. */
export const PRESET_PADDING_RATIO = 0.05;

/** Padding (display px) used between a corner/edge watermark and the image edge. */
export function presetPadding(bgWidth: number, bgHeight: number): number {
  return Math.min(bgWidth, bgHeight) * PRESET_PADDING_RATIO;
}

export interface PresetPositionInput {
  /** 1..9, laid out as a 3x3 grid (1 = top-left, 5 = center, 9 = bottom-right). */
  position: number;
  /** Center of the background image (Fabric uses center origin). */
  bgCenterX: number;
  bgCenterY: number;
  /** Displayed size of the background image. */
  bgWidth: number;
  bgHeight: number;
  /** Displayed size of the watermark object. */
  wmWidth: number;
  wmHeight: number;
}

/** Center point for the watermark given a 3x3 preset slot. */
export function presetPosition(input: PresetPositionInput): { left: number; top: number } {
  const padding = presetPadding(input.bgWidth, input.bgHeight);
  let left = input.bgCenterX;
  let top = input.bgCenterY;

  const col = (input.position - 1) % 3;
  const row = Math.floor((input.position - 1) / 3);

  if (col === 0) left = input.bgCenterX - input.bgWidth / 2 + input.wmWidth / 2 + padding;
  else if (col === 2) left = input.bgCenterX + input.bgWidth / 2 - input.wmWidth / 2 - padding;

  if (row === 0) top = input.bgCenterY - input.bgHeight / 2 + input.wmHeight / 2 + padding;
  else if (row === 2) top = input.bgCenterY + input.bgHeight / 2 - input.wmHeight / 2 - padding;

  return { left, top };
}

export interface BgBox {
  /** Center of the background image (Fabric center origin). */
  centerX: number;
  centerY: number;
  width: number;
  height: number;
}

/** Map a relative position ([0,1] of the image box) to a canvas center point. */
export function relToPoint(rel: { x: number; y: number }, bg: BgBox): { left: number; top: number } {
  return {
    left: bg.centerX - bg.width / 2 + rel.x * bg.width,
    top: bg.centerY - bg.height / 2 + rel.y * bg.height,
  };
}

/** Inverse of relToPoint: a canvas center point back to a relative position. */
export function pointToRel(point: { left: number; top: number }, bg: BgBox): { x: number; y: number } {
  return {
    x: bg.width === 0 ? 0.5 : (point.left - (bg.centerX - bg.width / 2)) / bg.width,
    y: bg.height === 0 ? 0.5 : (point.top - (bg.centerY - bg.height / 2)) / bg.height,
  };
}

/** Convert a "% of image short side" size into a display-px font size. */
export function sizePctToPx(baseDim: number, pct: number): number {
  return (baseDim * pct) / 100;
}

/** Inverse of sizePctToPx: turn a measured display-px size back into a percentage. */
export function pxToSizePct(baseDim: number, px: number): number {
  if (baseDim === 0) return 0;
  return (px / baseDim) * 100;
}
