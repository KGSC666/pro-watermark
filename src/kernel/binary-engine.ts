export class BinarySurgery {
    static readonly SOI = 0xffd8;
    static readonly SOS = 0xffda;

    /**
     * 提取元数据段 - 增加容错逻辑
     */
    static extractMetadataSegments(buffer: Uint8Array): Uint8Array[] {
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
            if (marker >= 0xffe0 && marker <= 0xffef) {
                const length = view.getUint16(offset + 2) + 2;
                if (offset + length <= buffer.length) {
                    segments.push(buffer.slice(offset, offset + length));
                }
                offset += length;
            } else if (marker === BinarySurgery.SOS) {
                break; // 图像数据开始，停止
            } else if (marker === 0xffd9) {
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
    }

    /**
     * 把 EXIF 调整成适合「导出衍生图」的状态，其余元数据（ICC、GPS、机型等）保持无损。
     * 做两件事，都在原地覆盖、不改动任何 TIFF 偏移：
     *
     * 1) 时间改写：把拍摄时间字段改为指定时间（默认导出此刻）。iOS/相册按
     *    DateTimeOriginal 排序，原样保留原图时间会让加水印的图被归档回原图当年的位置，
     *    在相册最新处找不到。
     *
     * 2) 方向复位：把 Orientation 置 1。浏览器加载 <img> 时已按 EXIF 方向自动旋转，
     *    画到画布上的像素是「摆正」的；若再缝回原图带旋转的 Orientation，相册会二次旋转
     *    导致方向错乱。像素已正，标记必须复位。
     *
     * 非 APP1/EXIF 段或解析失败时原样返回。
     */
    static sanitizeExifForExport(segment: Uint8Array, date: Date): Uint8Array {
        if (segment.length < 14) return segment;
        const head = new DataView(segment.buffer, segment.byteOffset, segment.byteLength);
        if (head.getUint16(0) !== 0xffe1) return segment; // 仅处理 APP1

        // "Exif\0\0"
        const isExif =
            segment[4] === 0x45 &&
            segment[5] === 0x78 &&
            segment[6] === 0x69 &&
            segment[7] === 0x66 &&
            segment[8] === 0x00 &&
            segment[9] === 0x00;
        if (!isExif) return segment;

        // 在副本上修改，避免污染原始段
        const out = segment.slice();
        const view = new DataView(out.buffer, out.byteOffset, out.byteLength);

        const tiffStart = 10;
        const bo = view.getUint16(tiffStart);
        let little: boolean;
        if (bo === 0x4949)
            little = true; // "II" 小端
        else if (bo === 0x4d4d)
            little = false; // "MM" 大端
        else return segment;

        const u16 = (o: number) => view.getUint16(o, little);
        const u32 = (o: number) => view.getUint32(o, little);

        if (u16(tiffStart + 2) !== 0x002a) return segment; // TIFF 魔数

        const pad2 = (n: number) => String(n).padStart(2, '0');
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
                } else if (tag === 0x0112 && type === 3) {
                    // Orientation 是 SHORT，值内联在 4 字节值域的前 2 字节，复位为 1
                    view.setUint16(entry + 8, 1, little);
                    out[entry + 10] = 0;
                    out[entry + 11] = 0;
                } else if (tag === 0x8769) {
                    exifPtr = u32(entry + 8); // ExifIFD 指针
                }
            }
            return exifPtr;
        };

        const exifPtr = walkIfd(u32(tiffStart + 4)); // IFD0
        if (exifPtr) walkIfd(exifPtr); // ExifIFD

        return out;
    }

    static stitch(pureBuffer: Uint8Array, segments: Uint8Array[]): Uint8Array {
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
    }
}
