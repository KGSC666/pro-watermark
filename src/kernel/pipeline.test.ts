import { describe, it, expect } from 'vitest';
import { Effect } from 'effect';
import { processImagePipeline } from './pipeline';

const bytes = (...b: number[]) => new Uint8Array(b);
const arr = (u: Uint8Array) => Array.from(u);
// Uint8Array isn't structurally a BlobPart under TS 5.7's stricter typed-array
// generics; cast at the boundary (the app code does the same in pipeline.ts).
const part = (u: Uint8Array) => u as unknown as BlobPart;
const fileOf = (u: Uint8Array, name: string, type: string) => new File([part(u)], name, { type });

const run = async (file: File, rendered: Uint8Array) => {
    const renderFn = async () => new Blob([part(rendered)], { type: 'image/jpeg' });
    const result = await Effect.runPromise(processImagePipeline(file, renderFn));
    return { result, body: new Uint8Array(await result.arrayBuffer()) };
};

describe('processImagePipeline', () => {
    it('stitches the original metadata back onto the rendered canvas output', async () => {
        const original = fileOf(
            bytes(
                0xff,
                0xd8,
                0xff,
                0xe1,
                0x00,
                0x06,
                0x45,
                0x78,
                0x69,
                0x66, // APP1 (EXIF)
                0xff,
                0xda,
                0x00,
                0x00,
                0xff,
                0xd9,
            ),
            'vacation.jpg',
            'image/jpeg',
        );
        const rendered = bytes(0xff, 0xd8, 0xff, 0xda, 0x00, 0x00); // canvas re-encode, metadata stripped

        const { result, body } = await run(original, rendered);

        expect(result).toBeInstanceOf(File);
        expect(result.name).toBe('vacation.jpg');
        expect(result.type).toBe('image/jpeg');
        // SOI + injected APP1 + rendered image data
        expect(arr(body)).toEqual([
            0xff, 0xd8, 0xff, 0xe1, 0x00, 0x06, 0x45, 0x78, 0x69, 0x66, 0xff, 0xda, 0x00, 0x00,
        ]);
    });

    it('returns the rendered output unchanged when the source has no metadata', async () => {
        // PNG-ish source: extractor finds no JPEG segments -> nothing to stitch.
        const original = fileOf(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a), 'shot.png', 'image/png');
        const rendered = bytes(0xff, 0xd8, 0x10, 0x20, 0x30, 0xff, 0xd9);

        const { body } = await run(original, rendered);
        expect(arr(body)).toEqual(arr(rendered));
    });

    it('keeps the original filename so the export naming stays predictable', async () => {
        const original = fileOf(bytes(0xff, 0xd8, 0xff, 0xd9), 'IMG_0001.jpg', 'image/jpeg');
        const { result } = await run(original, bytes(0xff, 0xd8, 0xff, 0xd9));
        expect(result.name).toBe('IMG_0001.jpg');
    });
});
