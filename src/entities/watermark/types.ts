export type WatermarkType = 'text' | 'image';

export interface WatermarkConfig {
    type: WatermarkType;
    text: string;
    image: string | null; // DataURL
    opacity: number;
    color: string;
    /** Text size as a percentage of the image's shorter side (window-independent). */
    sizePct: number;
}

/**
 * Where a watermark sits. Tracked per type (text / image) so the two never
 * clobber each other's position.
 */
export interface Placement {
    /** 1..9 preset grid slot, or null when the user has dragged it freely. */
    preset: number | null;
    /**
     * Manual center position as fractions of the image box ([0,1], 0,0 = top-left
     * corner). Used when preset is null; kept relative so it survives switching
     * to a different-sized image and exports identically. Null until first drag.
     */
    rel: { x: number; y: number } | null;
    /** Rotation in degrees. Persisted per type so it survives a tab switch. */
    angle: number;
}

export type Placements = Record<WatermarkType, Placement>;

export interface ProcessingJob {
    file: File;
    config: WatermarkConfig;
}
