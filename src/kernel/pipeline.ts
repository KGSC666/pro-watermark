import { ResultAsync } from 'neverthrow';
import { BinarySurgery } from './binary-engine';

/** Typed failures for a single image's export, so the caller can report which
 *  step failed for which file instead of catching an opaque `unknown`. */
export type ExportError =
    | { _tag: 'ReadError'; file: string; cause: unknown }
    | { _tag: 'RenderError'; file: string; cause: unknown };

/**
 * Render one image and stitch the original metadata (EXIF/ICC) back onto the
 * re-encoded JPEG, adjusting only capture time + orientation. Returns a
 * `ResultAsync` so a single bad file surfaces as a typed error value rather than
 * a thrown exception — the batch loop handles each result independently.
 */
export const processImagePipeline = (
    file: File,
    renderFn: () => Promise<Blob>,
): ResultAsync<File, ExportError> => {
    const now = new Date();

    return ResultAsync.fromPromise(
        file.arrayBuffer(),
        (cause): ExportError => ({ _tag: 'ReadError', file: file.name, cause }),
    )
        .map((buf) => {
            // Extract metadata, then refresh EXIF date + reset orientation for the
            // exported derivative. All other metadata is preserved byte-for-byte.
            const original = new Uint8Array(buf);
            return BinarySurgery.extractMetadataSegments(original).map((seg) =>
                BinarySurgery.sanitizeExifForExport(seg, now),
            );
        })
        .andThen((segments) =>
            ResultAsync.fromPromise(
                renderFn().then((blob) => blob.arrayBuffer()),
                (cause): ExportError => ({ _tag: 'RenderError', file: file.name, cause }),
            ).map((renderedBuf) => {
                const rendered = new Uint8Array(renderedBuf);
                const finalBuffer = BinarySurgery.stitch(rendered, segments);
                return new File([finalBuffer as unknown as BlobPart], file.name, {
                    type: 'image/jpeg',
                });
            }),
        );
};
