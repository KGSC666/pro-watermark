import { Effect } from 'effect';
import { BinarySurgery } from './binary-engine';

export const processImagePipeline = (file: File, renderFn: () => Promise<Blob>) =>
    Effect.gen(function* (_) {
        // 1. 获取原图二进制
        const arrayBuffer = yield* _(Effect.tryPromise(() => file.arrayBuffer()));
        const originalBuffer = new Uint8Array(arrayBuffer);

        // 2. 提取元数据 (ICC/EXIF)，并把 EXIF 调整为适合导出衍生图的状态：
        //    时间刷新为导出此刻（相册按最新排序）、方向复位为 1（像素已摆正，
        //    避免相册二次旋转）。其余元数据保持无损。
        const rawSegments = yield* _(BinarySurgery.extractMetadataSegments(originalBuffer));
        const now = new Date();
        const metadataSegments = rawSegments.map((seg) =>
            BinarySurgery.sanitizeExifForExport(seg, now),
        );

        // 3. 执行 Canvas 渲染 (需在 UI 线程或 OffscreenCanvas)
        const renderedBlob = yield* _(Effect.tryPromise(() => renderFn()));
        const renderedBuffer = new Uint8Array(
            yield* _(Effect.tryPromise(() => renderedBlob.arrayBuffer())),
        );

        // 4. 二进制缝合
        const finalBuffer = yield* _(BinarySurgery.stitch(renderedBuffer, metadataSegments));

        // 5. 返回带元数据的无损 File
        return new File([finalBuffer as any], file.name, { type: 'image/jpeg' });
    });
