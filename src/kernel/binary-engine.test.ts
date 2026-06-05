import { describe, it, expect } from "vitest";
import { Effect } from "effect";
import { BinarySurgery } from "./binary-engine";

const bytes = (...b: number[]) => new Uint8Array(b);
const arr = (u: Uint8Array) => Array.from(u);

const extract = (buf: Uint8Array) => Effect.runSync(BinarySurgery.extractMetadataSegments(buf));
const stitch = (pure: Uint8Array, segs: Uint8Array[]) => Effect.runSync(BinarySurgery.stitch(pure, segs));

describe("extractMetadataSegments", () => {
  it("returns nothing for a non-JPEG buffer (tolerant, no throw)", () => {
    expect(extract(bytes(0x89, 0x50, 0x4e, 0x47))).toEqual([]); // PNG header
  });

  it("returns nothing for a too-short buffer", () => {
    expect(extract(bytes(0xff))).toEqual([]);
  });

  it("extracts a single APP1 segment (the verify-logic mock)", () => {
    const mock = bytes(
      0xff, 0xd8,                         // SOI
      0xff, 0xe1, 0x00, 0x06, 0x45, 0x78, 0x69, 0x66, // APP1 "Exif"
      0xff, 0xda, 0x00, 0x00,             // SOS
      0xff, 0xd9                          // EOI
    );
    const segs = extract(mock);
    expect(segs).toHaveLength(1);
    expect(arr(segs[0])).toEqual([0xff, 0xe1, 0x00, 0x06, 0x45, 0x78, 0x69, 0x66]);
  });

  it("extracts every APPn segment, skips other markers (DQT), and stops at SOS", () => {
    const buf = bytes(
      0xff, 0xd8,                          // SOI
      0xff, 0xe0, 0x00, 0x04, 0xaa, 0xbb,  // APP0 (JFIF)
      0xff, 0xe1, 0x00, 0x05, 0x11, 0x22, 0x33, // APP1 (EXIF)
      0xff, 0xdb, 0x00, 0x03, 0xcc,        // DQT (must be skipped, not captured)
      0xff, 0xe2, 0x00, 0x04, 0xdd, 0xee,  // APP2 (ICC)
      0xff, 0xda, 0x00, 0x02,              // SOS -> stop
      0xff, 0xd9                           // EOI
    );
    const segs = extract(buf);
    expect(segs).toHaveLength(3);
    expect(arr(segs[0])).toEqual([0xff, 0xe0, 0x00, 0x04, 0xaa, 0xbb]);
    expect(arr(segs[1])).toEqual([0xff, 0xe1, 0x00, 0x05, 0x11, 0x22, 0x33]);
    expect(arr(segs[2])).toEqual([0xff, 0xe2, 0x00, 0x04, 0xdd, 0xee]);
  });
});

describe("stitch", () => {
  it("returns the rendered buffer untouched when there are no segments", () => {
    const pure = bytes(0xff, 0xd8, 0x12, 0x34);
    expect(stitch(pure, [])).toBe(pure); // same reference, no copy
  });

  it("inserts segments right after SOI, before the rendered image data", () => {
    const pure = bytes(0xff, 0xd8, 0x12, 0x34);     // SOI + 2 bytes "image data"
    const seg = bytes(0xff, 0xe1, 0x00, 0x04, 0x99, 0x88);
    const out = stitch(pure, [seg]);
    expect(arr(out)).toEqual([
      0xff, 0xd8,                         // SOI (from pure)
      0xff, 0xe1, 0x00, 0x04, 0x99, 0x88, // injected metadata
      0x12, 0x34,                         // rest of pure
    ]);
  });

  it("preserves segment order for multiple segments", () => {
    const pure = bytes(0xff, 0xd8, 0xff, 0xda);
    const a = bytes(0xff, 0xe0, 0x00, 0x03, 0x01);
    const b = bytes(0xff, 0xe1, 0x00, 0x03, 0x02);
    const out = stitch(pure, [a, b]);
    expect(arr(out)).toEqual([0xff, 0xd8, ...arr(a), ...arr(b), 0xff, 0xda]);
  });
});

describe("extract -> stitch round trip", () => {
  it("re-extracts exactly the segments that were stitched in", () => {
    const original = bytes(
      0xff, 0xd8,
      0xff, 0xe1, 0x00, 0x06, 0x45, 0x78, 0x69, 0x66, // APP1
      0xff, 0xda, 0x00, 0x00,
      0xff, 0xd9
    );
    const segs = extract(original);

    const rendered = bytes(0xff, 0xd8, 0xff, 0xda, 0x00, 0x00); // canvas output, no metadata
    const stitched = stitch(rendered, segs);

    expect(extract(stitched)).toEqual(segs);
  });
});
