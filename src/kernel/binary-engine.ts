import { Effect } from "effect";

export class BinarySurgery {
  static readonly SOI = 0xFFD8;
  static readonly SOS = 0xFFDA;

  /**
   * 提取元数据段 - 增加容错逻辑
   */
  static extractMetadataSegments(buffer: Uint8Array) {
    return Effect.sync(() => {
      const segments: Uint8Array[] = [];
      const view = new DataView(buffer.buffer);
      
      // 容错：如果不是 JPEG，直接返回空段，不报错
      if (buffer.length < 2 || view.getUint16(0) !== BinarySurgery.SOI) {
        return segments;
      }

      let offset = 2;
      while (offset < buffer.length - 2) {
        const marker = view.getUint16(offset);
        
        // APP0 - APP15 标记位
        if (marker >= 0xFFE0 && marker <= 0xFFEF) {
          const length = view.getUint16(offset + 2) + 2;
          if (offset + length <= buffer.length) {
            segments.push(buffer.slice(offset, offset + length));
          }
          offset += length;
        } else if (marker === BinarySurgery.SOS) {
          break; // 图像数据开始，停止
        } else if (marker === 0xFFD9) {
          break; // EOI
        } else {
          // 跳过其他段 (如 DQT, DHT 等)
          offset += 2;
          if (offset + 2 <= buffer.length) {
            const length = view.getUint16(offset);
            offset += length;
          } else {
            break;
          }
        }
      }
      return segments;
    });
  }

  /**
   * 把 EXIF 里的拍摄时间改写为指定时间（默认导出此刻）。
   *
   * 原因：iOS/相册按 EXIF DateTimeOriginal 排序。无损保留原图元数据时，
   * 会把原图的拍摄时间一起带回去，导致加了水印的图被归档到原图当年的位置，
   * 用户在相册最新处找不到它。这里只覆盖日期字段（定长 19 字节 ASCII，原地覆盖、
   * 不改动任何偏移），其余元数据（ICC、GPS、机型等）全部保持无损。
   *
   * 非 APP1/EXIF 段或解析失败时原样返回。
   */
  static refreshExifTimestamp(segment: Uint8Array, date: Date): Uint8Array {
    if (segment.length < 14) return segment;
    const head = new DataView(segment.buffer, segment.byteOffset, segment.byteLength);
    if (head.getUint16(0) !== 0xFFE1) return segment; // 仅处理 APP1

    // "Exif\0\0"
    const isExif =
      segment[4] === 0x45 && segment[5] === 0x78 && segment[6] === 0x69 &&
      segment[7] === 0x66 && segment[8] === 0x00 && segment[9] === 0x00;
    if (!isExif) return segment;

    // 在副本上修改，避免污染原始段
    const out = segment.slice();
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

    const tiffStart = 10;
    const bo = view.getUint16(tiffStart);
    let little: boolean;
    if (bo === 0x4949) little = true;       // "II" 小端
    else if (bo === 0x4D4D) little = false; // "MM" 大端
    else return segment;

    const u16 = (o: number) => view.getUint16(o, little);
    const u32 = (o: number) => view.getUint32(o, little);

    if (u16(tiffStart + 2) !== 0x002A) return segment; // TIFF 魔数

    const pad2 = (n: number) => String(n).padStart(2, "0");
    const dateStr =
      `${date.getFullYear()}:${pad2(date.getMonth() + 1)}:${pad2(date.getDate())} ` +
      `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;

    const writeAt = (relOff: number, count: number) => {
      const base = tiffStart + relOff;
      if (base < 0 || base + count > out.length) return;
      for (let i = 0; i < count; i++) {
        out[base + i] = i < dateStr.length ? dateStr.charCodeAt(i) : 0x00;
      }
    };

    // 0x0132 DateTime, 0x9003 DateTimeOriginal, 0x9004 DateTimeDigitized
    const dateTags = new Set([0x0132, 0x9003, 0x9004]);

    const walkIfd = (ifdRelOff: number): number => {
      const base = tiffStart + ifdRelOff;
      if (base + 2 > out.length || base < tiffStart) return 0;
      const n = u16(base);
      let exifPtr = 0;
      for (let i = 0; i < n; i++) {
        const entry = base + 2 + i * 12;
        if (entry + 12 > out.length) break;
        const tag = u16(entry);
        const type = u16(entry + 2);
        const count = u32(entry + 4);
        // ASCII(type=2) 且长度 >= 19 时，4 字节值域是指向字符串的偏移
        if (dateTags.has(tag) && type === 2 && count >= 19) {
          writeAt(u32(entry + 8), count);
        } else if (tag === 0x8769) {
          exifPtr = u32(entry + 8); // ExifIFD 指针
        }
      }
      return exifPtr;
    };

    const exifPtr = walkIfd(u32(tiffStart + 4)); // IFD0
    if (exifPtr) walkIfd(exifPtr);               // ExifIFD

    return out;
  }

  static stitch(pureBuffer: Uint8Array, segments: Uint8Array[]) {
    return Effect.sync(() => {
      // 如果没有元数据段可缝合，直接返回原图
      if (segments.length === 0) return pureBuffer;

      const totalMetadataLength = segments.reduce((acc, s) => acc + s.length, 0);
      const result = new Uint8Array(pureBuffer.length + totalMetadataLength);
      
      result.set(pureBuffer.slice(0, 2), 0); // SOI
      
      let currentOffset = 2;
      for (const seg of segments) {
        result.set(seg, currentOffset);
        currentOffset += seg.length;
      }
      
      result.set(pureBuffer.slice(2), currentOffset);
      return result;
    });
  }
}
