import { Effect } from "effect";
import { BinarySurgery } from "./binary-engine";

export const processImagePipeline = (file: File, renderFn: () => Promise<Blob>) => 
  Effect.gen(function* (_) {
    // 1. 获取原图二进制
    const arrayBuffer = yield* _(Effect.tryPromise(() => file.arrayBuffer()));
    const originalBuffer = new Uint8Array(arrayBuffer);

    // 2. 提取元数据 (ICC/EXIF)
    const metadataSegments = yield* _(BinarySurgery.extractMetadataSegments(originalBuffer));

    // 3. 执行 Canvas 渲染 (需在 UI 线程或 OffscreenCanvas)
    const renderedBlob = yield* _(Effect.tryPromise(() => renderFn()));
    const renderedBuffer = new Uint8Array(yield* _(Effect.tryPromise(() => renderedBlob.arrayBuffer())));

    // 4. 二进制缝合
    const finalBuffer = yield* _(BinarySurgery.stitch(renderedBuffer, metadataSegments));

    // 5. 返回带元数据的无损 File
    return new File([finalBuffer as any], file.name, { type: "image/jpeg" });
  });
