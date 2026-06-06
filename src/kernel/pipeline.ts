import { Effect } from "effect";
import { BinarySurgery } from "./binary-engine";

export const processImagePipeline = (file: File, renderFn: () => Promise<Blob>) => 
  Effect.gen(function* (_) {
    // 1. 获取原图二进制
    const arrayBuffer = yield* _(Effect.tryPromise(() => file.arrayBuffer()));
    const originalBuffer = new Uint8Array(arrayBuffer);

    // 2. 提取元数据 (ICC/EXIF)，并把 EXIF 拍摄时间刷新为导出此刻，
    //    使成品图在相册按最新时间排序（其余元数据保持无损）
    const rawSegments = yield* _(BinarySurgery.extractMetadataSegments(originalBuffer));
    const now = new Date();
    const metadataSegments = rawSegments.map((seg) =>
      BinarySurgery.refreshExifTimestamp(seg, now)
    );

    // 3. 执行 Canvas 渲染 (需在 UI 线程或 OffscreenCanvas)
    const renderedBlob = yield* _(Effect.tryPromise(() => renderFn()));
    const renderedBuffer = new Uint8Array(yield* _(Effect.tryPromise(() => renderedBlob.arrayBuffer())));

    // 4. 二进制缝合
    const finalBuffer = yield* _(BinarySurgery.stitch(renderedBuffer, metadataSegments));

    // 5. 返回带元数据的无损 File
    return new File([finalBuffer as any], file.name, { type: "image/jpeg" });
  });
