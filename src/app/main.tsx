import React, { useState, useRef, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { EditorLayout } from '../features/EditorLayout';
import { CanvasEditor, type CanvasEditorRef } from '../features/CanvasEditor';
import { processImagePipeline } from '../kernel/pipeline';
import type { WatermarkConfig, Placement, Placements } from '../entities/watermark/types';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence, MotionConfig } from 'framer-motion';
import { X, Pipette, AlertTriangle, Info, Trash2 } from 'lucide-react';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { ErrorBoundary } from '../shared/ui/ErrorBoundary';
import { Fader } from '../shared/ui/Fader';
import { AnimatedNumber } from '../shared/ui/AnimatedNumber';
import * as Toast from '@radix-ui/react-toast';
import * as AlertDialog from '@radix-ui/react-alert-dialog';

// A snappy spring used for the sliding selection pills (tabs, position grid).
const PILL_SPRING = { type: 'spring', stiffness: 500, damping: 35 } as const;

// Power-on cascade: the inspector's panels rise in sequence when it mounts
// (page load on desktop, every drawer-open on mobile) instead of all at once.
const PANEL_CONTAINER = {
    hidden: {},
    show: { transition: { staggerChildren: 0.055, delayChildren: 0.04 } },
} as const;
const PANEL_ITEM = {
    hidden: { opacity: 0, y: 14 },
    show: {
        opacity: 1,
        y: 0,
        transition: { type: 'spring', stiffness: 440, damping: 34 },
    },
} as const;

type ToastItem = {
    id: number;
    message: string;
    type: 'warn' | 'error' | 'info';
    title?: string;
    open: boolean;
};
const TOAST_TTL_MS = 4200;

// Export is near-instant, so a progress overlay tied to real work just flashes.
// Instead the ring fills over a deliberate minimum, then a checkmark confirms —
// a designed micro-moment. The actual save still fires ASAP (see handleExportAll)
// so it never delays iOS's share-sheet user-activation window.
const EXPORT_FILL_MS = 900;
// Hold long enough after the checkmark for the dimensions readout to be read.
const EXPORT_DONE_HOLD_MS = 950;
import ExifReader from 'exifreader';
import { heicTo, isHeic as isHeicContent } from 'heic-to';
import '../shared/lib/i18n'; // 初始化 i18n
import './globals.css';

const COLOR_PRESETS = ['#FFFFFF', '#000000', '#FF3B30'];

/** The full, independent watermark state for a single image. */
interface WatermarkState {
    config: WatermarkConfig;
    placements: Placements;
}

const makeDefaultState = (): WatermarkState => ({
    config: {
        type: 'text',
        text: 'PRO WATERMARK',
        image: null,
        opacity: 0.8,
        color: '#FFFFFF',
        sizePct: 5,
    },
    placements: {
        text: { preset: 5, rel: null, angle: 0 },
        image: { preset: 5, rel: null, angle: 0 },
    },
});

const App = () => {
    const { t } = useTranslation();
    const [sourceFiles, setSourceFiles] = useState<File[]>([]);
    const [originalNames, setOriginalNames] = useState<string[]>([]);
    const [previews, setPreviews] = useState<string[]>([]);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [exportComplete, setExportComplete] = useState(false);
    const [metadata, setMetadata] = useState<any>(null);
    // Each source image owns an independent watermark state, so editing one image
    // never touches another. New images clone the current settings as a starting
    // point (see ingestFiles). `draft` is what you edit before any image exists,
    // and it seeds the first images you add.
    const [draft, setDraft] = useState<WatermarkState>(makeDefaultState);
    const [states, setStates] = useState<WatermarkState[]>([]);

    const hasImages = sourceFiles.length > 0;
    const active = (hasImages && states[currentIndex]) || draft;
    const config = active.config;
    const placements = active.placements;
    const activePlacement = placements[config.type];
    const isCustomColor = !COLOR_PRESETS.includes(config.color.toUpperCase());

    const updateActive = (updater: (s: WatermarkState) => WatermarkState) => {
        if (hasImages)
            setStates((prev) => prev.map((s, i) => (i === currentIndex ? updater(s) : s)));
        else setDraft((prev) => updater(prev));
    };
    // Accepts either a full config object ({...config, x}) or an updater, matching
    // both call styles used throughout the panel below.
    const setConfig = (next: WatermarkConfig | ((prev: WatermarkConfig) => WatermarkConfig)) =>
        updateActive((s) => ({ ...s, config: typeof next === 'function' ? next(s.config) : next }));
    const setActivePlacement = (p: Placement) =>
        updateActive((s) => ({ ...s, placements: { ...s.placements, [s.config.type]: p } }));

    const [isExporting, setIsExporting] = useState(false);
    // A precise, instrument-style readout shown the instant export completes —
    // the actual output dimensions + count, decoded from the real output file so
    // it never lies about what was produced (null until measured).
    const [exportReadout, setExportReadout] = useState<{ w: number; h: number; n: number } | null>(
        null,
    );
    const [toasts, setToasts] = useState<ToastItem[]>([]);
    // Index of the image awaiting delete confirmation (null = no dialog open).
    const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(null);
    // Whether the source-archive panel shows the full raw EXIF dump or just the
    // few key specs.
    const [showAllMeta, setShowAllMeta] = useState(false);

    // Notifications via Radix Toast (accessible: aria-live, swipe-to-dismiss,
    // pause-on-hover). Radix owns the auto-dismiss timer (per-toast `duration`);
    // errors use Infinity so they stay until dismissed.
    const showToast = (message: string, type: ToastItem['type'] = 'warn', title?: string) => {
        const id = Date.now() + Math.random();
        setToasts((prev) => [...prev, { id, message, type, title, open: true }]);
    };
    // Close (animate out) then remove from the list after the exit animation.
    const dismissToast = (id: number) => {
        setToasts((prev) => prev.map((x) => (x.id === id ? { ...x, open: false } : x)));
        setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 220);
    };
    const editorRef = useRef<CanvasEditorRef>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const logoInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const loadMetadata = async () => {
            if (sourceFiles[currentIndex]) {
                try {
                    const tags = await ExifReader.load(sourceFiles[currentIndex]);
                    // 过滤掉一些过大的二进制数据，只保留可展示的文本信息
                    const displayTags: any = {};
                    for (const [key, value] of Object.entries(tags)) {
                        if (value && typeof value.description === 'string') {
                            displayTags[key] = value.description;
                        }
                    }
                    setMetadata(displayTags);
                } catch (err) {
                    console.warn('Failed to load metadata', err);
                    setMetadata(null);
                }
            }
        };
        loadMetadata();
    }, [sourceFiles, currentIndex]);

    // Keep thumbnail object URLs in sync with the source files, revoking old ones.
    useEffect(() => {
        const urls = sourceFiles.map((f) => URL.createObjectURL(f));
        setPreviews(urls);
        return () =>
            urls.forEach((u) => {
                URL.revokeObjectURL(u);
            });
    }, [sourceFiles]);

    // Hand finished images to the OS. On mobile, the native share sheet lets the
    // user tap "Save to Photos" → straight into the camera roll (web pages can't
    // write the photo library directly). On desktop, fall back to downloads.
    const saveFiles = async (files: File[]) => {
        // canShare() is true on desktop Safari/Chrome too, so it isn't a "mobile"
        // signal — gate on the actual device. iPadOS 13+ spoofs a Mac UA, so a real
        // touchscreen (maxTouchPoints > 1) tells the iPad apart from a desktop Mac.
        const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
        const isMobile =
            /Android|iPhone|iPod/.test(ua) ||
            (/iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
        const canShareFiles =
            isMobile && typeof navigator.canShare === 'function' && navigator.canShare({ files });

        if (canShareFiles) {
            try {
                await navigator.share({ files, title: 'Pro Watermark' });
                return;
            } catch (err) {
                if (err instanceof Error && err.name === 'AbortError') return; // user closed the sheet
                // e.g. activation expired on a large batch — fall through to download.
                console.warn('Share failed, downloading instead:', err);
            }
        }

        for (const file of files) {
            const url = URL.createObjectURL(file);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.name;
            a.click();
            URL.revokeObjectURL(url);
        }
    };

    const handleExportAll = async () => {
        if (sourceFiles.length === 0) {
            showToast(t('add_images_first'), 'warn');
            return;
        }
        const startedAt = performance.now();
        setExportComplete(false);
        setExportReadout(null);
        setIsExporting(true);

        // Snapshot the image currently on screen FIRST, before any other image is
        // loaded into the canvas. This preserves a watermark the user dragged into
        // a custom position (that position only lives on the live Fabric object,
        // not in config). null = current image isn't ready, fall back to a reload.
        const currentSnapshot = await editorRef.current!.exportBlob().catch(() => null);
        let canvasDisturbed = false;
        const outFiles: File[] = [];
        const failed: string[] = [];

        try {
            for (let i = 0; i < sourceFiles.length; i++) {
                const file = sourceFiles[i];
                // The on-screen image exports as-is (keeps manual position). Every
                // other image must be loaded fresh — fully awaited, so no race — and
                // gets the preset position since it was never positioned by hand.
                let renderToBlob: () => Promise<Blob>;
                if (i === currentIndex && currentSnapshot) {
                    renderToBlob = async () => currentSnapshot;
                } else {
                    // Render each image with ITS OWN watermark state, not the active one.
                    canvasDisturbed = true;
                    const st = states[i];
                    renderToBlob = () =>
                        editorRef.current!.exportFileBlob(
                            file,
                            st.config,
                            st.placements[st.config.type],
                        );
                }
                const name = `pro_${file.name.replace(/\.(heic|heif)$/i, '.jpg')}`;
                // Each image is isolated: a failure becomes a typed value, so one bad
                // file no longer aborts the rest of the batch — we just note it.
                const result = await processImagePipeline(file, renderToBlob);
                result.match(
                    (finalFile) =>
                        outFiles.push(new File([finalFile], name, { type: 'image/jpeg' })),
                    (e) => {
                        console.error('Export failed:', e);
                        failed.push(file.name);
                    },
                );
            }
        } finally {
            // Only repaint if the loop actually overwrote the canvas with other
            // images; otherwise leave the user's dragged watermark untouched.
            if (canvasDisturbed) {
                const current = sourceFiles[currentIndex];
                if (current) editorRef.current?.restoreView(current).catch(console.error);
            }
        }

        // Save FIRST, while we're still inside the click's user-activation window —
        // iOS only lets navigator.share open from a fresh gesture. The overlay
        // timing below must never gate this.
        if (outFiles.length > 0) await saveFiles(outFiles);

        // Decode the real output to report its true pixel dimensions — proof the
        // export kept full resolution. Falls back to a plain confirmation if the
        // decode fails (e.g. an exotic codec), never a fabricated number.
        if (outFiles.length > 0) {
            try {
                const bmp = await createImageBitmap(outFiles[0]);
                setExportReadout({ w: bmp.width, h: bmp.height, n: outFiles.length });
                bmp.close?.();
            } catch {
                setExportReadout({ w: 0, h: 0, n: outFiles.length });
            }
        }

        // Turn the overlay into a deliberate moment instead of a flash: let the ring
        // finish filling, then confirm with a checkmark, then dismiss.
        const elapsed = performance.now() - startedAt;
        if (elapsed < EXPORT_FILL_MS)
            await new Promise((r) => setTimeout(r, EXPORT_FILL_MS - elapsed));
        setExportComplete(true);
        await new Promise((r) => setTimeout(r, EXPORT_DONE_HOLD_MS));
        setIsExporting(false);

        // Surface failures only after the overlay is gone, on the clean screen, so
        // the (now sticky) message isn't hidden behind it or missed.
        if (failed.length > 0) {
            showToast(
                t('export_partial', { names: failed.join(', ') }),
                'error',
                t('export_failed_title'),
            );
        }
    };

    const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (f) =>
                setConfig({ ...config, type: 'image', image: f.target?.result as string });
            reader.readAsDataURL(file);
        }
    };

    // Quick sync guess by extension/MIME, for the initial file filter.
    const looksLikeHeic = (f: File) =>
        /\.(heic|heif)$/i.test(f.name) || /image\/hei[cf]/i.test(f.type);

    const ingestFiles = async (files: File[]) => {
        const imageFiles = files.filter((f) => f.type.startsWith('image/') || looksLikeHeic(f));
        if (imageFiles.length === 0) return;

        const accepted: File[] = [];
        const acceptedNames: string[] = [];
        const failed: string[] = [];

        // Convert sequentially (one libheif decode at a time keeps memory sane on
        // a big "select all photos" batch).
        for (const file of imageFiles) {
            // Trust the extension/MIME first; otherwise sniff the actual bytes.
            let heic = looksLikeHeic(file);
            if (!heic) {
                try {
                    heic = await isHeicContent(file);
                } catch {
                    /* not heic */
                }
            }

            if (heic) {
                try {
                    // High quality on purpose: this JPEG is a throwaway working copy fed
                    // straight into the canvas and re-encoded on export, so its file size
                    // is irrelevant — only its fidelity as canvas input matters. A low
                    // value here would bake in a first-generation loss before the photo is
                    // even drawn.
                    const blob = await heicTo({ blob: file, type: 'image/jpeg', quality: 0.95 });
                    const name = /\.(heic|heif)$/i.test(file.name)
                        ? file.name.replace(/\.(heic|heif)$/i, '.jpg')
                        : `${file.name}.jpg`;
                    accepted.push(new File([blob], name, { type: 'image/jpeg' }));
                    acceptedNames.push(file.name);
                } catch (e) {
                    // Skip it rather than injecting an unrenderable HEIC that crashes the canvas.
                    console.error('HEIC conversion failed:', file.name, e);
                    failed.push(file.name);
                }
            } else {
                accepted.push(file);
                acceptedNames.push(file.name);
            }
        }

        if (failed.length > 0) showToast(t('heic_failed', { names: failed.join(', ') }), 'error');
        if (accepted.length === 0) return;

        // Give each new image its own independent state, cloned from whatever is
        // currently being edited (the active image, or the draft if none yet).
        const template = active;
        const newStates = accepted.map(() => structuredClone(template));

        setOriginalNames((prev) => [...prev, ...acceptedNames]);
        setCurrentIndex(sourceFiles.length); // jump to the first newly added image
        setStates((prev) => [...prev, ...newStates]);
        setSourceFiles((prev) => [...prev, ...accepted]);
    };

    const handleFilesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        await ingestFiles(Array.from(e.target.files || []));
        e.target.value = ''; // allow re-selecting the same file
    };

    // Remove one image (and its independent watermark state) from the queue.
    const removeImage = (index: number) => {
        const drop = <T,>(arr: T[]) => arr.filter((_, i) => i !== index);
        setSourceFiles((prev) => drop(prev));
        setOriginalNames((prev) => drop(prev));
        setStates((prev) => drop(prev));
        setCurrentIndex((prev) => {
            const newLen = sourceFiles.length - 1;
            if (newLen <= 0) return 0;
            // Shift selection left if we removed something at/ before it, then clamp.
            const next = index < prev ? prev - 1 : prev;
            return Math.min(next, newLen - 1);
        });
        showToast(t('image_removed'), 'info');
    };

    // Pull the most useful specs to the top of the source-archive panel; the raw
    // EXIF dump stays available behind a toggle. Tag names vary by camera, so each
    // spec tries a few common aliases and is dropped if none are present.
    const metaPick = (...names: string[]): string | null => {
        if (!metadata) return null;
        for (const n of names) if (metadata[n]) return String(metadata[n]);
        return null;
    };
    const keySpecs: [string, string][] = metadata
        ? (
              [
                  ['CAPTURED', metaPick('DateTimeOriginal', 'CreateDate', 'DateTime')],
                  [
                      'CAMERA',
                      [metaPick('Make'), metaPick('Model')].filter(Boolean).join(' ') || null,
                  ],
                  ['LENS', metaPick('LensModel', 'Lens', 'LensType')],
                  ['COLOR', metaPick('ColorSpace', 'Color Space', 'ProfileDescription')],
              ] as [string, string | null][]
          ).filter((e): e is [string, string] => !!e[1])
        : [];

    return (
        <>
            <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                multiple
                accept="image/*,.heic,.heif"
                onChange={handleFilesChange}
            />
            <input
                type="file"
                ref={logoInputRef}
                className="hidden"
                accept="image/png,image/svg+xml"
                onChange={handleLogoUpload}
            />

            <EditorLayout
                onAdd={() => fileInputRef.current?.click()}
                onExport={handleExportAll}
                onDropFiles={ingestFiles}
                canvas={
                    <CanvasEditor
                        ref={editorRef}
                        file={sourceFiles[currentIndex] || null}
                        config={config}
                        placement={activePlacement}
                        onConfigChange={(newFields) =>
                            setConfig((prev) => ({ ...prev, ...newFields }))
                        }
                        onPlacementChange={setActivePlacement}
                        onImageLoad={(f) => {
                            if (!sourceFiles.find((sf) => sf === f))
                                setSourceFiles((p) => [...p, f]);
                        }}
                    />
                }
                controls={
                    <motion.div
                        variants={PANEL_CONTAINER}
                        initial="hidden"
                        animate="show"
                        className="flex flex-col gap-6"
                    >
                        {/* 状态行：让面板读起来像仪表盘——当前正在编辑第几张 / 共几张 + 文件名。 */}
                        <motion.div
                            variants={PANEL_ITEM}
                            className="flex items-center justify-between gap-3 font-data text-[10px] uppercase tracking-wider -mb-1"
                        >
                            <span className="text-white/40">
                                {hasImages
                                    ? `EDITING ${String(currentIndex + 1).padStart(2, '0')} / ${String(sourceFiles.length).padStart(2, '0')}`
                                    : 'DRAFT MODE'}
                            </span>
                            <span className="truncate max-w-[150px] text-[#FFB020]/70">
                                {hasImages
                                    ? (originalNames[currentIndex] ??
                                      sourceFiles[currentIndex].name)
                                    : '—'}
                            </span>
                        </motion.div>

                        {sourceFiles.length > 0 && (
                            <motion.div
                                variants={PANEL_ITEM}
                                className="p-3 bg-white/5 rounded-2xl border border-white/5 mb-2"
                            >
                                <p className="font-data text-[10px] font-semibold text-neutral-500 uppercase mb-2 tracking-widest">
                                    {t('batch_queue')} ({sourceFiles.length})
                                </p>
                                <div className="flex gap-2.5 overflow-x-auto pb-2 pt-2.5 px-2.5 scrollbar-hide">
                                    <AnimatePresence initial={false} mode="popLayout">
                                        {sourceFiles.map((f, i) => (
                                            <motion.div
                                                key={`${f.name}-${f.lastModified}-${f.size}`}
                                                layout
                                                initial={{ opacity: 0, scale: 0.5 }}
                                                animate={{ opacity: 1, scale: 1 }}
                                                exit={{ opacity: 0, scale: 0.5 }}
                                                transition={PILL_SPRING}
                                                className="relative shrink-0"
                                            >
                                                <button
                                                    onClick={() => setCurrentIndex(i)}
                                                    className={`w-10 h-10 rounded-lg block border-2 overflow-hidden transition-all ${currentIndex === i ? 'border-[#FFB020] shadow-[0_0_10px_rgba(255,176,32,0.45)]' : 'border-transparent opacity-40 hover:opacity-70'}`}
                                                >
                                                    {previews[i] ? (
                                                        <img
                                                            src={previews[i]}
                                                            alt=""
                                                            className="w-full h-full object-cover"
                                                        />
                                                    ) : (
                                                        <div className="w-full h-full bg-neutral-800 flex items-center justify-center text-[8px]">
                                                            {i + 1}
                                                        </div>
                                                    )}
                                                </button>
                                                <button
                                                    onClick={() => setConfirmDeleteIndex(i)}
                                                    title={t('remove')}
                                                    className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-neutral-900 border border-white/20 flex items-center justify-center text-white/60 hover:bg-red-500 hover:text-white hover:border-red-500 transition-colors active:scale-90 shadow-md"
                                                >
                                                    <X size={9} strokeWidth={2.5} />
                                                </button>
                                            </motion.div>
                                        ))}
                                    </AnimatePresence>
                                </div>
                            </motion.div>
                        )}

                        <motion.div
                            variants={PANEL_ITEM}
                            className="flex p-1 bg-white/5 rounded-xl border border-white/5"
                        >
                            {(['text', 'image'] as const).map((tp) => (
                                <button
                                    key={tp}
                                    onClick={() => setConfig({ ...config, type: tp })}
                                    className={`relative flex-1 py-2 rounded-lg font-data text-xs font-semibold uppercase tracking-wider transition-colors ${config.type === tp ? 'text-[#FFB020]' : 'text-neutral-500 hover:text-neutral-300'}`}
                                >
                                    {config.type === tp && (
                                        <motion.span
                                            layoutId="tab-pill"
                                            transition={PILL_SPRING}
                                            className="absolute inset-0 bg-[#FFB020]/12 border border-[#FFB020]/40 rounded-lg"
                                        />
                                    )}
                                    <span className="relative z-10">
                                        {tp === 'text' ? t('type_text') : t('type_logo')}
                                    </span>
                                </button>
                            ))}
                        </motion.div>

                        <motion.div variants={PANEL_ITEM}>
                            <AnimatePresence mode="wait" initial={false}>
                                <motion.section
                                    key={config.type}
                                    initial={{ opacity: 0, y: 8, filter: 'blur(6px)' }}
                                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                                    exit={{ opacity: 0, y: -8, filter: 'blur(6px)' }}
                                    transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
                                >
                                    {config.type === 'text' ? (
                                        <div className="space-y-5">
                                            <div>
                                                <label className="font-data text-[10px] font-semibold text-neutral-500 uppercase block mb-2 tracking-widest">
                                                    {t('watermark_text')}
                                                </label>
                                                <input
                                                    type="text"
                                                    value={config.text}
                                                    onChange={(e) =>
                                                        setConfig({
                                                            ...config,
                                                            text: e.target.value,
                                                        })
                                                    }
                                                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-white/30 focus:ring-2 focus:ring-white/10 focus:bg-white/[0.07] transition-[border-color,box-shadow,background-color] duration-200"
                                                    placeholder={t('placeholder')}
                                                />
                                            </div>
                                            <Fader
                                                label={t('size')}
                                                value={config.sizePct}
                                                min={1}
                                                max={25}
                                                step={0.5}
                                                onChange={(v) =>
                                                    setConfig({ ...config, sizePct: v })
                                                }
                                                format={(v) => `${v.toFixed(1)}%`}
                                            />
                                            <div>
                                                <div className="flex justify-between items-center mb-3">
                                                    <label className="font-data text-[10px] font-semibold text-neutral-500 uppercase tracking-widest">
                                                        {t('color')}
                                                    </label>
                                                    <span className="font-data text-[10px] uppercase tracking-wider text-[#FFB020]/80">
                                                        {config.color.toUpperCase()}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {COLOR_PRESETS.map((c) => {
                                                        const selected =
                                                            config.color.toUpperCase() === c;
                                                        return (
                                                            <button
                                                                key={c}
                                                                onClick={() =>
                                                                    setConfig({
                                                                        ...config,
                                                                        color: c,
                                                                    })
                                                                }
                                                                className={`h-8 w-8 rounded-md transition-all active:scale-90 ${selected ? 'p-[3px] ring-2 ring-inset ring-[#FFB020]' : 'ring-1 ring-inset ring-white/15 hover:ring-white/40'}`}
                                                            >
                                                                <span
                                                                    className="block w-full h-full rounded-[3px]"
                                                                    style={{ backgroundColor: c }}
                                                                />
                                                            </button>
                                                        );
                                                    })}
                                                    <label
                                                        title={t('custom_color')}
                                                        className={`relative h-8 w-8 rounded-md cursor-pointer flex items-center justify-center transition-all active:scale-90 ${isCustomColor ? 'p-[3px] ring-2 ring-inset ring-[#FFB020]' : 'ring-1 ring-inset ring-white/15 hover:ring-white/40'}`}
                                                    >
                                                        <span
                                                            className="block w-full h-full rounded-[3px]"
                                                            style={{
                                                                backgroundColor: isCustomColor
                                                                    ? config.color
                                                                    : 'rgba(255,255,255,0.06)',
                                                            }}
                                                        />
                                                        <Pipette
                                                            size={12}
                                                            strokeWidth={2}
                                                            className="absolute text-white mix-blend-difference pointer-events-none"
                                                        />
                                                        <input
                                                            type="color"
                                                            value={config.color}
                                                            onChange={(e) =>
                                                                setConfig({
                                                                    ...config,
                                                                    color: e.target.value,
                                                                })
                                                            }
                                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer rounded-md"
                                                        />
                                                    </label>
                                                    <div className="ml-auto h-8 flex-1 max-w-[96px] rounded-md border border-white/10 flex items-center justify-center bg-black/20">
                                                        <span
                                                            className="block h-3.5 w-[80%] rounded-sm"
                                                            style={{
                                                                backgroundColor: config.color,
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <div>
                                            <label className="font-data text-[10px] font-semibold text-neutral-500 uppercase block mb-2 tracking-widest">
                                                {t('upload_logo')}
                                            </label>
                                            <div className="relative">
                                                <button
                                                    onClick={() => logoInputRef.current?.click()}
                                                    className="w-full py-8 border-2 border-dashed border-white/10 rounded-2xl flex flex-col items-center gap-2 hover:bg-white/5 transition-all"
                                                >
                                                    {config.image ? (
                                                        <img
                                                            src={config.image}
                                                            className="h-12 object-contain"
                                                            alt="Logo"
                                                        />
                                                    ) : (
                                                        <>
                                                            <div className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center text-neutral-500">
                                                                +
                                                            </div>
                                                            <span className="text-xs text-neutral-600">
                                                                {t('click_to_select')}
                                                            </span>
                                                        </>
                                                    )}
                                                </button>
                                                {config.image && (
                                                    <button
                                                        onClick={() =>
                                                            setConfig({ ...config, image: null })
                                                        }
                                                        className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 backdrop-blur border border-white/10 flex items-center justify-center text-white/70 hover:text-white hover:bg-red-500/80 transition-all active:scale-90"
                                                    >
                                                        <X size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </motion.section>
                            </AnimatePresence>
                        </motion.div>

                        <motion.section
                            variants={PANEL_ITEM}
                            className="border-t border-white/[0.06] pt-5"
                        >
                            <Fader
                                label={t('opacity')}
                                value={config.opacity}
                                min={0}
                                max={1}
                                step={0.01}
                                onChange={(v) => setConfig({ ...config, opacity: v })}
                                format={(v) => `${Math.round(v * 100)}%`}
                            />
                        </motion.section>

                        <motion.section
                            variants={PANEL_ITEM}
                            className="border-t border-white/[0.06] pt-5"
                        >
                            <div className="flex justify-between items-center mb-4">
                                <label className="font-data text-[10px] font-semibold text-neutral-500 uppercase tracking-widest">
                                    {t('position')}
                                </label>
                                {activePlacement.preset === null && (
                                    <span className="font-data text-[10px] text-[#FFB020]/80">
                                        {t('position_custom')}
                                    </span>
                                )}
                            </div>
                            <div className="relative rounded-2xl border border-white/5 bg-white/5 overflow-hidden">
                                {hasImages && previews[currentIndex] && (
                                    <img
                                        src={previews[currentIndex]}
                                        alt=""
                                        className="absolute inset-0 w-full h-full object-cover opacity-[0.18]"
                                    />
                                )}
                                <div className="relative grid grid-cols-3 gap-2 p-2">
                                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => {
                                        const selected = activePlacement.preset === i;
                                        return (
                                            <button
                                                key={i}
                                                onClick={() =>
                                                    setActivePlacement({
                                                        ...activePlacement,
                                                        preset: i,
                                                        rel: null,
                                                    })
                                                }
                                                className="relative aspect-square rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors"
                                            >
                                                {selected && (
                                                    <motion.div
                                                        layoutId="preset-sel"
                                                        transition={PILL_SPRING}
                                                        className="absolute inset-0 bg-[#FFB020]/10 border border-[#FFB020]/50 rounded-lg shadow-lg"
                                                    />
                                                )}
                                                <motion.div
                                                    animate={{ scale: selected ? 1.4 : 1 }}
                                                    transition={PILL_SPRING}
                                                    className={`relative w-1.5 h-1.5 rounded-full ${selected ? 'bg-[#FFB020] shadow-[0_0_8px_rgba(255,176,32,0.8)]' : 'bg-neutral-700'}`}
                                                />
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </motion.section>

                        {sourceFiles.length > 0 && (
                            <motion.div
                                variants={PANEL_ITEM}
                                className="mt-2 rounded-2xl border border-white/[0.07] bg-white/[0.02] overflow-hidden"
                            >
                                {/* 仪表盘式"原片档案"：绿色 LED 表示元数据完整性已锁定，
                                    下方按规格表排版逐项读出 EXIF/ICC。 */}
                                <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.07] bg-emerald-500/[0.06]">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]" />
                                    <span className="font-data text-[10px] font-semibold uppercase tracking-[0.22em] text-emerald-400">
                                        {t('source_verified')}
                                    </span>
                                </div>
                                <div className="px-4 py-3 font-data text-[10px]">
                                    {/* 关键规格置顶：文件名 + 拍摄时间 / 相机 / 镜头 / 色彩空间。 */}
                                    <div className="space-y-1.5">
                                        <div className="flex justify-between gap-4">
                                            <span className="text-white/30 shrink-0">NAME</span>
                                            <span className="truncate text-white/85">
                                                {originalNames[currentIndex] ??
                                                    sourceFiles[currentIndex].name}
                                            </span>
                                        </div>
                                        {keySpecs.map(([label, val]) => (
                                            <div key={label} className="flex justify-between gap-4">
                                                <span className="text-white/30 shrink-0">
                                                    {label}
                                                </span>
                                                <span className="truncate text-white/85">
                                                    {val}
                                                </span>
                                            </div>
                                        ))}
                                    </div>

                                    {/* 其余原始 EXIF/ICC 折叠，避免长列表喧宾夺主。 */}
                                    {metadata && Object.keys(metadata).length > 0 && (
                                        <>
                                            <button
                                                onClick={() => setShowAllMeta((v) => !v)}
                                                className="mt-3 flex w-full items-center justify-between border-t border-white/[0.06] pt-2.5 text-white/40 hover:text-white/70 transition-colors"
                                            >
                                                <span className="uppercase tracking-wider">
                                                    {t('meta_all')} ({Object.keys(metadata).length})
                                                </span>
                                                <span
                                                    className={`transition-transform duration-200 ${showAllMeta ? 'rotate-180' : ''}`}
                                                >
                                                    ▾
                                                </span>
                                            </button>
                                            <AnimatePresence initial={false}>
                                                {showAllMeta && (
                                                    <motion.div
                                                        initial={{ height: 0, opacity: 0 }}
                                                        animate={{ height: 'auto', opacity: 1 }}
                                                        exit={{ height: 0, opacity: 0 }}
                                                        transition={{
                                                            duration: 0.25,
                                                            ease: [0.32, 0.72, 0, 1],
                                                        }}
                                                        className="overflow-hidden"
                                                    >
                                                        <div className="mt-2 max-h-[220px] overflow-y-auto scrollbar-hide divide-y divide-white/[0.05]">
                                                            {Object.entries(metadata).map(
                                                                ([key, val]) => (
                                                                    <p
                                                                        key={key}
                                                                        className="flex justify-between gap-4 py-1"
                                                                    >
                                                                        <span className="text-white/30 shrink-0 uppercase">
                                                                            {key}
                                                                        </span>
                                                                        <span className="truncate text-white/60">
                                                                            {val as string}
                                                                        </span>
                                                                    </p>
                                                                ),
                                                            )}
                                                        </div>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </>
                                    )}
                                </div>
                            </motion.div>
                        )}
                    </motion.div>
                }
            />

            <AnimatePresence>
                {isExporting && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.25 }}
                        className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-md flex flex-col items-center justify-center text-center p-8 overflow-hidden"
                    >
                        {/* 影院黑边：开场从中间合拢成上下条幅，收场再打开。 */}
                        <motion.div
                            className="absolute inset-x-0 top-0 bg-black z-[1]"
                            initial={{ height: '50%' }}
                            animate={{ height: '13%' }}
                            exit={{ height: '50%' }}
                            transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
                        />
                        <motion.div
                            className="absolute inset-x-0 bottom-0 bg-black z-[1]"
                            initial={{ height: '50%' }}
                            animate={{ height: '13%' }}
                            exit={{ height: '50%' }}
                            transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
                        />
                        {/* 处理中：一道琥珀扫描带循环掠过，像正在逐行读取。 */}
                        {!exportComplete && (
                            <motion.div
                                aria-hidden
                                className="pointer-events-none absolute inset-x-0 h-40 z-[2]"
                                style={{
                                    background:
                                        'linear-gradient(to bottom, transparent, rgba(255,176,32,0.10) 50%, transparent)',
                                }}
                                initial={{ top: '-20%' }}
                                animate={{ top: '110%' }}
                                transition={{
                                    duration: 1.2,
                                    repeat: Number.POSITIVE_INFINITY,
                                    ease: 'linear',
                                }}
                            />
                        )}
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 8 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            transition={{ delay: 0.35, ...PILL_SPRING }}
                            className="relative z-[3] flex flex-col items-center"
                        >
                            <div className="relative w-24 h-24 mb-5">
                                <svg className="w-24 h-24 -rotate-90" viewBox="0 0 80 80">
                                    <defs>
                                        <linearGradient id="exportRing" x1="0" y1="0" x2="1" y2="1">
                                            <stop offset="0%" stopColor="#FFD27A" />
                                            <stop offset="100%" stopColor="#FFB020" />
                                        </linearGradient>
                                    </defs>
                                    <circle
                                        cx="40"
                                        cy="40"
                                        r="34"
                                        fill="none"
                                        stroke="rgba(255,255,255,0.1)"
                                        strokeWidth="5"
                                    />
                                    {/* Simulated fill: creeps to ~94% over EXPORT_FILL_MS, snaps to 100% on completion. */}
                                    <motion.circle
                                        cx="40"
                                        cy="40"
                                        r="34"
                                        fill="none"
                                        stroke="url(#exportRing)"
                                        strokeWidth="5"
                                        strokeLinecap="round"
                                        strokeDasharray={2 * Math.PI * 34}
                                        initial={{ strokeDashoffset: 2 * Math.PI * 34 }}
                                        animate={{
                                            strokeDashoffset: exportComplete
                                                ? 0
                                                : 2 * Math.PI * 34 * 0.06,
                                        }}
                                        transition={{
                                            duration: exportComplete ? 0.3 : EXPORT_FILL_MS / 1000,
                                            ease: [0.32, 0.72, 0, 1],
                                        }}
                                        style={{
                                            filter: 'drop-shadow(0 0 5px rgba(255,176,32,0.6))',
                                        }}
                                    />
                                </svg>
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <AnimatePresence>
                                        {exportComplete && (
                                            <motion.svg
                                                key="check"
                                                viewBox="0 0 24 24"
                                                className="w-9 h-9"
                                                initial={{ scale: 0.4, opacity: 0 }}
                                                animate={{ scale: 1, opacity: 1 }}
                                                exit={{ scale: 0.4, opacity: 0 }}
                                                transition={PILL_SPRING}
                                                style={{
                                                    filter: 'drop-shadow(0 0 5px rgba(255,176,32,0.55))',
                                                }}
                                            >
                                                <motion.path
                                                    d="M5 13l4 4L19 7"
                                                    fill="none"
                                                    stroke="url(#exportRing)"
                                                    strokeWidth={3}
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    initial={{ pathLength: 0 }}
                                                    animate={{ pathLength: 1 }}
                                                    transition={{
                                                        duration: 0.35,
                                                        ease: 'easeOut',
                                                        delay: 0.05,
                                                    }}
                                                />
                                            </motion.svg>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </div>
                            <p className="font-display text-xl font-bold tracking-tight bg-gradient-to-b from-white to-white/55 bg-clip-text text-transparent">
                                {exportComplete ? t('export_done') : t('processing')}
                            </p>
                            <div className="h-5 mt-2">
                                <AnimatePresence>
                                    {exportComplete && exportReadout && (
                                        <motion.p
                                            initial={{ opacity: 0, y: 4 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0 }}
                                            transition={{ delay: 0.1, duration: 0.25 }}
                                            className="font-data text-[11px] tracking-wider text-[#FFB020]/90 tabular-nums"
                                        >
                                            {exportReadout.w > 0 && (
                                                <>
                                                    <AnimatedNumber
                                                        value={exportReadout.w}
                                                        startFrom={0}
                                                        duration={0.8}
                                                    />
                                                    <span className="text-[#FFB020]/40"> × </span>
                                                    <AnimatedNumber
                                                        value={exportReadout.h}
                                                        startFrom={0}
                                                        duration={0.8}
                                                    />
                                                    <span className="text-[#FFB020]/50">
                                                        {' '}
                                                        px ·{' '}
                                                    </span>
                                                </>
                                            )}
                                            {exportReadout.n > 1 &&
                                                `${exportReadout.n} ${t('imgs')} · `}
                                            {t('meta_intact')}
                                        </motion.p>
                                    )}
                                </AnimatePresence>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Delete confirmation — Radix AlertDialog (focus trap, Escape, a11y).
                pointer-events-auto on overlay+content overrides the `pointer-events:
                none` vaul's modal drawer puts on <body> (the × that opens this lives
                inside the mobile drawer). */}
            <AlertDialog.Root
                open={confirmDeleteIndex !== null}
                onOpenChange={(open) => {
                    if (!open) setConfirmDeleteIndex(null);
                }}
            >
                <AlertDialog.Portal>
                    <AlertDialog.Overlay className="fixed inset-0 z-[105] bg-black/70 backdrop-blur-md pointer-events-auto data-[state=open]:animate-[fadeIn_0.18s_ease-out] data-[state=closed]:animate-[fadeOut_0.15s_ease-in]" />
                    <AlertDialog.Content className="fixed inset-0 z-[106] flex items-center justify-center p-6 pointer-events-auto outline-none">
                        <div className="w-full max-w-xs rounded-3xl border border-white/10 bg-neutral-900 p-6 text-center shadow-2xl animate-[dialogPop_0.2s_cubic-bezier(0.32,0.72,0,1)]">
                            <div className="w-12 h-12 mx-auto rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
                                <Trash2 size={22} className="text-red-400" />
                            </div>
                            <AlertDialog.Title className="text-base font-bold tracking-tight">
                                {t('confirm_delete_title')}
                            </AlertDialog.Title>
                            <AlertDialog.Description className="text-sm text-neutral-500 mt-2 leading-relaxed">
                                {t('confirm_delete_desc')}
                            </AlertDialog.Description>
                            <div className="flex gap-2 mt-6">
                                <AlertDialog.Cancel asChild>
                                    <button className="flex-1 py-2.5 rounded-xl bg-white/5 border border-white/10 text-sm font-semibold text-white/80 hover:bg-white/10 active:scale-95 transition-all">
                                        {t('cancel')}
                                    </button>
                                </AlertDialog.Cancel>
                                <AlertDialog.Action asChild>
                                    <button
                                        onClick={() => {
                                            if (confirmDeleteIndex !== null)
                                                removeImage(confirmDeleteIndex);
                                        }}
                                        className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-sm font-semibold hover:bg-red-600 active:scale-95 transition-all"
                                    >
                                        {t('remove')}
                                    </button>
                                </AlertDialog.Action>
                            </div>
                        </div>
                    </AlertDialog.Content>
                </AlertDialog.Portal>
            </AlertDialog.Root>

            {/* Accessible toasts via Radix. Mobile: bottom-center (thumb reach).
                Desktop: top-right of the canvas, tucked left of the 320px inspector
                — more prominent for sticky errors. */}
            <Toast.Provider swipeDirection="right" duration={TOAST_TTL_MS}>
                {toasts.map((toast) => {
                    const isError = toast.type === 'error';
                    return (
                        <Toast.Root
                            key={toast.id}
                            open={toast.open}
                            duration={isError ? Number.POSITIVE_INFINITY : TOAST_TTL_MS}
                            onOpenChange={(open) => {
                                if (!open) dismissToast(toast.id);
                            }}
                            className={`pointer-events-auto flex w-full items-start gap-3 rounded-2xl px-4 py-3 backdrop-blur-xl shadow-2xl lg:w-[360px] data-[state=open]:animate-[toastIn_0.25s_cubic-bezier(0.32,0.72,0,1)] data-[state=closed]:animate-[toastOut_0.18s_ease-in] data-[swipe=move]:[transform:translateX(var(--radix-toast-swipe-move-x))] data-[swipe=cancel]:translate-x-0 data-[swipe=end]:animate-[toastSwipeOut_0.2s_ease-out] ${
                                isError
                                    ? 'border border-red-500/30 border-l-2 border-l-red-500 bg-red-950/50'
                                    : 'border border-white/10 bg-neutral-900/80'
                            }`}
                        >
                            {isError ? (
                                <AlertTriangle size={18} className="text-red-400 shrink-0 mt-0.5" />
                            ) : toast.type === 'info' ? (
                                <Trash2 size={18} className="text-white/50 shrink-0 mt-0.5" />
                            ) : (
                                <Info size={18} className="text-amber-300 shrink-0 mt-0.5" />
                            )}
                            <div className="min-w-0 flex-1">
                                {toast.title ? (
                                    <>
                                        <Toast.Title
                                            className={`text-sm font-bold tracking-tight ${isError ? 'text-red-200' : 'text-white'}`}
                                        >
                                            {toast.title}
                                        </Toast.Title>
                                        <Toast.Description className="block text-sm text-white/90 leading-snug">
                                            {toast.message}
                                        </Toast.Description>
                                    </>
                                ) : (
                                    <Toast.Title className="block text-sm text-white/90 leading-snug">
                                        {toast.message}
                                    </Toast.Title>
                                )}
                            </div>
                            <Toast.Close
                                aria-label="Close"
                                className="-mr-1 text-white/30 hover:text-white/80 transition-colors shrink-0"
                            >
                                <X size={15} />
                            </Toast.Close>
                        </Toast.Root>
                    );
                })}
                <Toast.Viewport className="pointer-events-none fixed z-[110] flex flex-col gap-2 outline-none bottom-8 left-1/2 w-full max-w-md -translate-x-1/2 items-center px-4 lg:bottom-auto lg:left-auto lg:right-[336px] lg:top-6 lg:w-auto lg:max-w-sm lg:translate-x-0 lg:items-end lg:px-0" />
            </Toast.Provider>
        </>
    );
};

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <ErrorBoundary>
            <MotionConfig reducedMotion="user">
                <App />
            </MotionConfig>
        </ErrorBoundary>
        <Analytics />
        <SpeedInsights />
    </React.StrictMode>,
);
