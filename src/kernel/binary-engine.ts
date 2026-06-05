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
