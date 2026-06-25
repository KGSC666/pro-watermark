import { describe, it, expect } from "vitest";
import { BinarySurgery } from "./binary-engine";

const bytes = (...b: number[]) => new Uint8Array(b);
const arr = (u: Uint8Array) => Array.from(u);

const extract = (buf: Uint8Array) => BinarySurgery.extractMetadataSegments(buf);
const stitch = (pure: Uint8Array, segs: Uint8Array[]) => BinarySurgery.stitch(pure, segs);

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

describe("sanitizeExifForExport", () => {
  const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
  const readStr = (seg: Uint8Array, off: number, len: number) =>
    String.fromCharCode(...seg.slice(off, off + len));

  // Minimal little-endian EXIF APP1: IFD0 (Orientation + ExifIFD ptr) -> ExifIFD
  // (DateTimeOriginal ASCII[20]). The 19-char date string lives at segment offset 66.
  const buildExif = (dateStr: string, orientation = 6) => {
    const str20 = [...ascii(dateStr), ...new Array(20 - dateStr.length).fill(0)];
    return new Uint8Array([
      0xff, 0xe1, 0x00, 0x54,                         // APP1 + length
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00,             // "Exif\0\0"
      0x49, 0x49, 0x2a, 0x00,                         // TIFF: "II", magic 0x002A
      0x08, 0x00, 0x00, 0x00,                         // IFD0 at rel offset 8
      0x02, 0x00,                                     // IFD0: 2 entries
      0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, // tag 0x0112 (Orientation), SHORT[1]
      orientation, 0x00, 0x00, 0x00,                  //   inline value
      0x69, 0x87, 0x04, 0x00, 0x01, 0x00, 0x00, 0x00, // tag 0x8769 (ExifIFD ptr), LONG
      0x26, 0x00, 0x00, 0x00,                         //   -> ExifIFD at rel 38
      0x00, 0x00, 0x00, 0x00,                         // next IFD = 0
      0x01, 0x00,                                     // ExifIFD: 1 entry
      0x03, 0x90, 0x02, 0x00, 0x14, 0x00, 0x00, 0x00, // tag 0x9003 (DateTimeOriginal), ASCII[20]
      0x38, 0x00, 0x00, 0x00,                         //   -> string at rel 56
      0x00, 0x00, 0x00, 0x00,                         // next IFD = 0
      ...str20,                                       // the date string (seg offset 66)
    ]);
  };

  it("overwrites the EXIF date with the given time, in place", () => {
    const seg = buildExif("2001:01:01 00:00:00");
    const out = BinarySurgery.sanitizeExifForExport(seg, new Date(2026, 5, 6, 13, 45, 7));
    expect(readStr(out, 66, 19)).toBe("2026:06:06 13:45:07");
    expect(out[66 + 19]).toBe(0); // null terminator kept
  });

  it("resets a rotated Orientation tag to 1 (upright)", () => {
    const seg = buildExif("2001:01:01 00:00:00", 6); // 6 = rotate 90° CW
    const out = BinarySurgery.sanitizeExifForExport(seg, new Date());
    // Orientation inline value sits at segment offset 28 (IFD0 entry start 20 + 8)
    expect(out[28]).toBe(1);
    expect(out[29]).toBe(0);
  });

  it("does not mutate the input segment", () => {
    const seg = buildExif("2001:01:01 00:00:00");
    const before = arr(seg);
    BinarySurgery.sanitizeExifForExport(seg, new Date(2026, 0, 1, 0, 0, 0));
    expect(arr(seg)).toEqual(before);
  });

  it("leaves non-APP1 segments untouched (same reference)", () => {
    const icc = bytes(0xff, 0xe2, 0x00, 0x04, 0xdd, 0xee); // APP2 / ICC
    expect(BinarySurgery.sanitizeExifForExport(icc, new Date())).toBe(icc);
  });

  it("leaves APP1 segments that are not EXIF untouched (e.g. XMP)", () => {
    const xmp = bytes(0xff, 0xe1, 0x00, 0x08, 0x68, 0x74, 0x74, 0x70, 0x00, 0x00); // "http"
    expect(BinarySurgery.sanitizeExifForExport(xmp, new Date())).toBe(xmp);
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
