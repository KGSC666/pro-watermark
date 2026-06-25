import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { motion } from 'framer-motion';
import { Canvas, FabricImage, IText, type FabricObject } from 'fabric';
import { AnimatedNumber } from '../shared/ui/AnimatedNumber';
import { ScrambleText } from '../shared/ui/ScrambleText';
import type { WatermarkConfig, Placement } from '../entities/watermark/types';
import {
    presetPosition,
    relToPoint,
    pointToRel,
    sizePctToPx,
    pxToSizePct,
} from '../entities/watermark/geometry';
import { useTranslation } from 'react-i18next';

// Fabric easing signature (t=elapsed, b=begin, c=change, d=duration).
const easeOutCubic = (t: number, b: number, c: number, d: number) => {
    const x = t / d - 1;
    return c * (x * x * x + 1) + b;
};

// Each line of the empty-state boot hero rises + un-blurs as it powers on.
const BOOT_ITEM = {
    hidden: { opacity: 0, y: 16, filter: 'blur(6px)' },
    show: {
        opacity: 1,
        y: 0,
        filter: 'blur(0px)',
        transition: { type: 'spring', stiffness: 320, damping: 30 },
    },
} as const;

interface CanvasEditorProps {
    file: File | null;
    config: WatermarkConfig;
    /** Position state for the *active* watermark type (text or image). */
    placement: Placement;
    onImageLoad: (file: File) => void;
    onConfigChange: (newConfig: Partial<WatermarkConfig>) => void;
    onPlacementChange: (placement: Placement) => void;
}

export interface CanvasEditorRef {
    exportBlob: () => Promise<Blob>;
    exportFileBlob: (file: File, config: WatermarkConfig, placement: Placement) => Promise<Blob>;
    restoreView: (file: File) => Promise<void>;
}

const CanvasEditor = forwardRef<CanvasEditorRef, CanvasEditorProps>(
    ({ file, config, placement, onImageLoad, onConfigChange, onPlacementChange }, ref) => {
        const { t } = useTranslation();
        const containerRef = useRef<HTMLDivElement>(null);
        const canvasRef = useRef<HTMLCanvasElement>(null);
        const fabricCanvas = useRef<Canvas | null>(null);
        const watermarkRef = useRef<FabricObject | null>(null);

        const [hasImage, setHasImage] = useState(false);
        // Bumped on every successful image load so the "metadata sealed" scan +
        // seal animation replays for each photo (including batch selection switches).
        const [sealKey, setSealKey] = useState(0);
        // The loaded photo's native pixel size, shown as an instrument readout in
        // the viewfinder frame — counted up from 0 like a measurement.
        const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
        // Bumped whenever the container resizes, so the watermark re-fits to the new
        // canvas box (the [config…] effect below depends on it).
        const [resizeTick, setResizeTick] = useState(0);

        // The canvas event handlers below are registered once on mount, so they would
        // otherwise close over stale props (e.g. the watermark type at first render).
        // This ref always holds the latest callbacks so a drag updates the *current*
        // type's placement, not whatever was active when the canvas was created.
        const latest = useRef({ onConfigChange, onPlacementChange });
        latest.current = { onConfigChange, onPlacementChange };

        // The displayed length of the background image's shorter side. Text size is
        // stored as a percentage of this, so the exported size is the same fraction
        // of the photo no matter how big the browser window is.
        const getBgBox = () => {
            const canvas = fabricCanvas.current;
            const bg = canvas?.getObjects().find((o) => (o as any).isBackground) as
                | FabricImage
                | undefined;
            if (!bg) return null;
            const box = bg.getBoundingRect();
            return { centerX: bg.left!, centerY: bg.top!, width: box.width, height: box.height };
        };
        const getBgBaseDim = (): number | null => {
            const box = getBgBox();
            return box ? Math.min(box.width, box.height) : null;
        };
        const pctToPx = (pct: number) => sizePctToPx(getBgBaseDim() ?? 800, pct);

        const exportCurrentBlob = async (): Promise<Blob> => {
            if (!fabricCanvas.current) throw new Error('Canvas not initialized');
            const canvas = fabricCanvas.current;
            const bgImg = canvas
                .getObjects()
                .find((obj) => (obj as any).isBackground) as FabricImage;
            if (!bgImg) throw new Error('No image loaded');

            canvas.discardActiveObject();
            canvas.renderAll();

            // Export ONLY the image region, at the photo's native resolution. The editor
            // canvas is sized to the viewport and the image sits inside it with padding;
            // capturing the whole canvas would bake that padding in as black bars (JPEG
            // has no transparency) and yield viewport-shaped, oversized output. Cropping
            // to the background's bounding box and scaling by 1/scale gives exactly the
            // source's pixel dimensions with no letterboxing.
            const rect = bgImg.getBoundingRect();
            const multiplier = 1 / bgImg.scaleX;

            const dataUrl = canvas.toDataURL({
                format: 'jpeg',
                quality: 0.95,
                multiplier,
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
                enableRetinaScaling: false,
            });
            const res = await fetch(dataUrl);
            return await res.blob();
        };

        useImperativeHandle(ref, () => ({
            exportBlob: exportCurrentBlob,
            // Deterministically render a specific file before exporting, fully awaited.
            // This is what batch export uses, so it no longer races against React
            // re-rendering the canvas with a setTimeout guess.
            exportFileBlob: async (target: File, cfg: WatermarkConfig, plc: Placement) => {
                await loadFileOnCanvas(target);
                await createOrUpdateWatermark(cfg, plc);
                return await exportCurrentBlob();
            },
            // Repaint the on-screen canvas back to a given file (e.g. after a batch run).
            restoreView: async (target: File) => {
                await loadFileOnCanvas(target);
                await createOrUpdateWatermark();
            },
        }));

        useEffect(() => {
            if (!canvasRef.current || !containerRef.current) return;

            const canvas = new Canvas(canvasRef.current, {
                width: containerRef.current.clientWidth,
                height: containerRef.current.clientHeight,
                backgroundColor: 'transparent',
                selection: false,
                enableRetinaScaling: true,
                imageSmoothingEnabled: true,
            });
            fabricCanvas.current = canvas;

            // A finished drag/resize commits to state. Position becomes a "custom"
            // placement (clears the preset selection) stored relative to the image, and
            // a handle-resize folds the dragged display size back into sizePct. Both go
            // through `latest` so they target the watermark type that's active *now*.
            canvas.on('object:modified', (e) => {
                const target = e.target;
                if (!target) return;
                const box = getBgBox();
                if (!box) return;

                const rel = pointToRel({ left: target.left!, top: target.top! }, box);
                latest.current.onPlacementChange({ preset: null, rel, angle: target.angle ?? 0 });

                if (target instanceof IText) {
                    const baseDim = Math.min(box.width, box.height);
                    const px = target.fontSize * target.scaleX;
                    latest.current.onConfigChange({
                        sizePct: Math.round(pxToSizePct(baseDim, px) * 10) / 10,
                    });
                }
            });
            canvas.on('text:changed', (e) => {
                const target = e.target as IText;
                if (target) latest.current.onConfigChange({ text: target.text });
            });

            const handleResize = () => {
                const c = fabricCanvas.current;
                const container = containerRef.current;
                if (!c || !container) return;
                c.setDimensions({
                    width: container.clientWidth,
                    height: container.clientHeight,
                });
                // Re-fit the background image to the new canvas box so it never
                // overflows when the container shrinks (mobile address-bar collapse,
                // sidebar toggle, rotation…). The watermark re-fits via resizeTick.
                const bg = c.getObjects().find((o) => (o as any).isBackground) as
                    | FabricImage
                    | undefined;
                if (bg?.width && bg?.height) {
                    const scale = Math.min(c.width! / bg.width, c.height! / bg.height) * 0.95;
                    bg.set({
                        left: c.width! / 2,
                        top: c.height! / 2,
                        scaleX: scale,
                        scaleY: scale,
                    });
                    bg.setCoords();
                }
                c.requestRenderAll();
                setResizeTick((n) => n + 1);
            };
            window.addEventListener('resize', handleResize);
            // Layout-driven size changes (padding, sidebar toggle, font load) don't
            // fire window 'resize'; observe the container directly so the canvas
            // always matches its box.
            const ro = new ResizeObserver(() => handleResize());
            ro.observe(containerRef.current);

            return () => {
                window.removeEventListener('resize', handleResize);
                ro.disconnect();
                canvas.dispose();
            };
        }, []);

        // Load a file onto the canvas as the background, fully awaitable.
        const loadFileOnCanvas = (target: File): Promise<void> => {
            return new Promise((resolve, reject) => {
                const canvas = fabricCanvas.current;
                if (!canvas) return reject(new Error('Canvas not ready'));
                const reader = new FileReader();
                reader.onload = async (f) => {
                    try {
                        const data = f.target?.result as string;
                        const img = await FabricImage.fromURL(data);

                        // Set high quality scaling filters
                        img.set({ imageSmoothing: true });

                        canvas.clear();
                        watermarkRef.current = null;
                        const scale =
                            Math.min(canvas.width! / img.width!, canvas.height! / img.height!) *
                            0.95;
                        (img as any).isBackground = true;
                        img.set({
                            left: canvas.width! / 2,
                            top: canvas.height! / 2,
                            originX: 'center',
                            originY: 'center',
                            scaleX: scale,
                            scaleY: scale,
                            selectable: false,
                            evented: false,
                        });
                        canvas.add(img);
                        resolve();
                    } catch (e) {
                        reject(e);
                    }
                };
                reader.onerror = () => reject(reader.error);
                reader.readAsDataURL(target);
            });
        };

        useEffect(() => {
            if (!fabricCanvas.current) return;
            // No file (e.g. the last queued image was removed) — wipe the canvas
            // instead of leaving the previous image on screen.
            if (!file) {
                fabricCanvas.current.clear();
                watermarkRef.current = null;
                fabricCanvas.current.requestRenderAll();
                setHasImage(false);
                setDims(null);
                return;
            }
            let cancelled = false;
            loadFileOnCanvas(file)
                .then(async () => {
                    if (cancelled) return;
                    setHasImage(true);
                    setSealKey((k) => k + 1);
                    const bg = fabricCanvas.current
                        ?.getObjects()
                        .find((o) => (o as any).isBackground) as FabricImage | undefined;
                    setDims(bg?.width && bg?.height ? { w: bg.width, h: bg.height } : null);
                    onImageLoad(file);
                    // Re-apply the watermark for the freshly loaded image. The [config]
                    // effect won't fire on its own when only the image changes.
                    await createOrUpdateWatermark(config, placement, true);
                })
                .catch((err) => console.error('Failed to load image', err));
            return () => {
                cancelled = true;
            };
        }, [file]);

        // Defaults to the live props, but batch export passes each image's own state
        // explicitly so it renders that image's watermark rather than the active one.
        const createOrUpdateWatermark = async (
            cfg: WatermarkConfig = config,
            plc: Placement = placement,
            // Only the live, on-screen view animates the watermark in. Batch export
            // must NOT — it reads the canvas immediately, so a mid-fade opacity would
            // be baked into the output.
            animateIn = false,
        ) => {
            const canvas = fabricCanvas.current;
            if (!canvas) return;
            // Gate on the actual background object rather than the React `hasImage`
            // state, which hasn't flushed yet during the load → render sequence.
            const bg = canvas.getObjects().find((o) => (o as any).isBackground);
            if (!bg) return;

            // What the watermark should be right now. The image type shows nothing
            // until a logo has actually been uploaded.
            const wantText = cfg.type === 'text';
            const wantImage = cfg.type === 'image' && !!cfg.image;

            if (!wantText && !wantImage) {
                // e.g. image tab with no logo yet — make sure no stale watermark lingers.
                if (watermarkRef.current) {
                    canvas.remove(watermarkRef.current);
                    watermarkRef.current = null;
                    canvas.requestRenderAll();
                }
                return;
            }

            const isText = watermarkRef.current instanceof IText;
            const isImage = watermarkRef.current instanceof FabricImage;
            const currentLogoSrc = (watermarkRef.current as any)?._logoSrc;
            const shouldRecreate =
                !watermarkRef.current ||
                (wantText && !isText) ||
                (wantImage && (!isImage || currentLogoSrc !== cfg.image));

            if (shouldRecreate) {
                if (watermarkRef.current) {
                    canvas.remove(watermarkRef.current);
                    watermarkRef.current = null;
                }
                if (wantText) {
                    watermarkRef.current = new IText(cfg.text, {
                        fontFamily: 'Inter, system-ui, sans-serif',
                        originX: 'center',
                        originY: 'center',
                        fontSize: pctToPx(cfg.sizePct),
                        fill: cfg.color,
                        opacity: cfg.opacity,
                    });
                } else if (wantImage) {
                    const img = await FabricImage.fromURL(cfg.image!);
                    const logoScale = (canvas.width! * 0.15) / img.width!;
                    img.set({
                        scaleX: logoScale,
                        scaleY: logoScale,
                        originX: 'center',
                        originY: 'center',
                        opacity: cfg.opacity,
                    });
                    (img as any)._logoSrc = cfg.image;
                    watermarkRef.current = img;
                }
                if (watermarkRef.current) canvas.add(watermarkRef.current);
            }

            const w = watermarkRef.current;
            if (w) {
                if (w instanceof IText && !w.isEditing) {
                    // scaleX/Y reset to 1: a prior handle-drag is already folded into
                    // sizePct, so the font size alone carries the dimension.
                    w.set({
                        text: cfg.text,
                        fill: cfg.color,
                        fontSize: pctToPx(cfg.sizePct),
                        scaleX: 1,
                        scaleY: 1,
                    });
                }
                w.set({ opacity: cfg.opacity });
                applyPlacement(w, plc);
                w.setCoords();

                // Entrance: when a watermark is freshly created on the live canvas,
                // let it materialize — fade up + a slight scale settle from its anchor
                // — instead of snapping in. Skipped during export (see animateIn).
                if (animateIn && shouldRecreate) {
                    const fx = w.scaleX ?? 1;
                    const fy = w.scaleY ?? 1;
                    const fo = cfg.opacity;
                    w.set({ opacity: 0, scaleX: fx * 0.8, scaleY: fy * 0.8 });
                    w.animate(
                        { opacity: fo, scaleX: fx, scaleY: fy },
                        {
                            duration: 460,
                            easing: easeOutCubic,
                            onChange: () => canvas.requestRenderAll(),
                        },
                    );
                }
                canvas.requestRenderAll();
            }
        };

        // Position the watermark from the given placement: a preset grid slot, or a
        // custom (relative) position the user dragged to, plus rotation.
        const applyPlacement = (obj: FabricObject, plc: Placement = placement) => {
            const box = getBgBox();
            if (!box) return;
            obj.set({ angle: plc.angle });
            if (plc.preset != null) {
                const { left, top } = presetPosition({
                    position: plc.preset,
                    bgCenterX: box.centerX,
                    bgCenterY: box.centerY,
                    bgWidth: box.width,
                    bgHeight: box.height,
                    wmWidth: obj.getScaledWidth(),
                    wmHeight: obj.getScaledHeight(),
                });
                obj.set({ left, top });
            } else if (plc.rel) {
                const { left, top } = relToPoint(plc.rel, box);
                obj.set({ left, top });
            } else {
                obj.set({ left: box.centerX, top: box.centerY });
            }
        };

        useEffect(() => {
            createOrUpdateWatermark(config, placement, true);
        }, [config, placement, hasImage, resizeTick]);

        return (
            <div
                ref={containerRef}
                className="relative w-full h-full min-h-0 bg-[#0B0B0D] rounded-[32px] border border-white/[0.06] shadow-2xl overflow-hidden group"
            >
                {/* 绝对居中的空态提示。始终渲染、仅切换透明度：Fabric 会把 <canvas>
                    包进自己的 DOM 结构，若在这里条件增删兄弟节点，React 重排时会因
                    参照节点已被 Fabric 移走而抛 insertBefore 错误并整页崩溃。 */}
                <div
                    className={`absolute inset-0 z-0 pointer-events-none transition-opacity duration-500 ${hasImage ? 'opacity-0' : 'opacity-100'}`}
                >
                    {/* 活着的取景器：极淡常驻三分线 + 缓慢呼吸的中心准星，让空画框
                        像一台待机的仪器，而不是一片空洞。 */}
                    <div className="absolute inset-8 opacity-[0.07]">
                        <span className="absolute top-0 bottom-0 left-1/3 w-px bg-white" />
                        <span className="absolute top-0 bottom-0 left-2/3 w-px bg-white" />
                        <span className="absolute left-0 right-0 top-1/3 h-px bg-white" />
                        <span className="absolute left-0 right-0 top-2/3 h-px bg-white" />
                    </div>
                    <motion.div
                        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                        animate={{ opacity: [0.12, 0.22, 0.12] }}
                        transition={{
                            duration: 3.2,
                            repeat: Number.POSITIVE_INFINITY,
                            ease: 'easeInOut',
                        }}
                    >
                        <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden>
                            <circle
                                cx="60"
                                cy="60"
                                r="46"
                                fill="none"
                                stroke="#FFB020"
                                strokeWidth="1"
                            />
                            <path
                                d="M60 8 V26 M60 94 V112 M8 60 H26 M94 60 H112"
                                stroke="#FFB020"
                                strokeWidth="1"
                                strokeLinecap="round"
                            />
                        </svg>
                    </motion.div>

                    {/* 开机式 hero：字标 → 待机指示灯 → 解码标题 → 提示，逐级浮现。 */}
                    <motion.div
                        className="absolute inset-0 flex flex-col items-center justify-center gap-5 px-8 text-center"
                        initial="hidden"
                        animate="show"
                        variants={{
                            hidden: {},
                            show: { transition: { staggerChildren: 0.16, delayChildren: 0.15 } },
                        }}
                    >
                        <motion.div
                            variants={BOOT_ITEM}
                            className="flex items-center gap-2 font-display text-sm font-bold tracking-[0.3em] text-white/85"
                        >
                            <span className="w-2.5 h-2.5 rounded-[3px] bg-[#FFB020] shadow-[0_0_10px_rgba(255,176,32,0.9)]" />
                            PRO·WATERMARK
                        </motion.div>
                        <motion.span
                            variants={BOOT_ITEM}
                            className="flex items-center gap-2 font-data text-[10px] uppercase tracking-[0.4em] text-[#FFB020]/80"
                        >
                            <motion.span
                                className="w-1.5 h-1.5 rounded-full bg-[#FFB020]"
                                animate={{ opacity: [1, 0.2, 1] }}
                                transition={{
                                    duration: 1.4,
                                    repeat: Number.POSITIVE_INFINITY,
                                    ease: 'easeInOut',
                                }}
                            />
                            READY
                        </motion.span>
                        <motion.h2
                            variants={BOOT_ITEM}
                            className="font-display text-[2rem] md:text-[2.7rem] font-bold tracking-tight leading-[1.05] text-white/95 max-w-[440px]"
                        >
                            <ScrambleText text={t('empty_hero')} delay={650} duration={1100} />
                        </motion.h2>
                        <motion.span
                            variants={BOOT_ITEM}
                            className="font-data text-[11px] md:text-xs text-white/35 mt-1 max-w-[340px] leading-relaxed"
                        >
                            {t('drop_hint')}
                        </motion.span>
                    </motion.div>
                </div>

                {/* 画布容器，确保它撑满空间 */}
                <canvas ref={canvasRef} className="absolute inset-0 z-10" />

                {/* 签名时刻：图片载入时，一道琥珀扫描线掠过画面，随后在边框角落
                    "封印"一枚无损徽章——把幕后真正做的 EXIF/ICC 保全可视化。这些都是
                    独立 DOM 元素，不在 Fabric 画布上，因此绝不会被导出捕获。 */}
                {hasImage && (
                    <>
                        {/* 取景器四角刻度：把画框变成相机取景框，载入时四角依次"吸附"到位
                            （像对焦锁定），主体（照片）居中受框。 */}
                        <div
                            key={`marks-${sealKey}`}
                            className="pointer-events-none absolute inset-5 z-20"
                        >
                            {(
                                [
                                    ['top-0 left-0 border-t-2 border-l-2 rounded-tl-lg', -44, -44],
                                    ['top-0 right-0 border-t-2 border-r-2 rounded-tr-lg', 44, -44],
                                    [
                                        'bottom-0 left-0 border-b-2 border-l-2 rounded-bl-lg',
                                        -44,
                                        44,
                                    ],
                                    [
                                        'bottom-0 right-0 border-b-2 border-r-2 rounded-br-lg',
                                        44,
                                        44,
                                    ],
                                ] as const
                            ).map(([pos, dx, dy], i) => (
                                <motion.span
                                    key={pos}
                                    className={`absolute w-10 h-10 border-[#FFB020] ${pos}`}
                                    style={{
                                        filter: 'drop-shadow(0 0 6px rgba(255,176,32,0.55))',
                                    }}
                                    initial={{ opacity: 0, x: dx, y: dy, scale: 0.3 }}
                                    animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                                    transition={{
                                        delay: 0.2 + i * 0.18,
                                        type: 'spring',
                                        stiffness: 240,
                                        damping: 24,
                                    }}
                                />
                            ))}
                            {/* 三分构图线：载入瞬间一闪而过，强化"取景器"的语境。 */}
                            {[22, 44, 66, 78].map((p, i) => {
                                const vertical = i < 2;
                                const offset = i % 2 === 0 ? '33.33%' : '66.66%';
                                return (
                                    <motion.span
                                        key={`grid-${p}`}
                                        className="absolute bg-[#FFB020]"
                                        style={
                                            vertical
                                                ? { left: offset, top: 0, bottom: 0, width: '1px' }
                                                : { top: offset, left: 0, right: 0, height: '1px' }
                                        }
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: [0, 0.45, 0] }}
                                        transition={{
                                            delay: 0.6 + i * 0.07,
                                            duration: 1.1,
                                            ease: 'easeOut',
                                        }}
                                    />
                                );
                            })}

                            {/* 中心对焦准星：十字 + 圆环，缩放弹入后回弹消失，像相机合焦。 */}
                            <motion.div
                                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                                initial={{ opacity: 0, scale: 1.6 }}
                                animate={{ opacity: [0, 1, 1, 0], scale: [1.6, 1, 1, 0.9] }}
                                transition={{ delay: 1.0, duration: 1.3, ease: 'easeOut' }}
                                style={{ filter: 'drop-shadow(0 0 6px rgba(255,176,32,0.7))' }}
                            >
                                <svg width="68" height="68" viewBox="0 0 68 68" aria-hidden>
                                    <circle
                                        cx="34"
                                        cy="34"
                                        r="22"
                                        fill="none"
                                        stroke="#FFB020"
                                        strokeWidth="1.5"
                                        opacity="0.7"
                                    />
                                    <path
                                        d="M34 6 V20 M34 48 V62 M6 34 H20 M48 34 H62"
                                        stroke="#FFB020"
                                        strokeWidth="1.5"
                                        strokeLinecap="round"
                                    />
                                    <circle cx="34" cy="34" r="2" fill="#FFB020" />
                                </svg>
                            </motion.div>

                            {/* 合拢后整框一道琥珀闪光：对上焦的"锁定"反馈。 */}
                            <motion.div
                                className="absolute inset-0 rounded-[20px] border-2 border-[#FFB020]"
                                style={{
                                    filter: 'drop-shadow(0 0 12px rgba(255,176,32,0.7))',
                                }}
                                initial={{ opacity: 0, scale: 1.05 }}
                                animate={{ opacity: [0, 1, 0], scale: [1.05, 1, 1] }}
                                transition={{ delay: 1.45, duration: 0.85, ease: 'easeOut' }}
                            />
                        </div>

                        {/* 顶部仪表读数：实测像素尺寸从 0 跳数到真实值，像仪器在"测量"照片。 */}
                        {dims && (
                            <motion.div
                                key={`dims-${sealKey}`}
                                className="pointer-events-none absolute top-4 left-4 z-20 flex items-center gap-2 rounded-lg border border-[#FFB020]/30 bg-black/55 px-3 py-1.5 backdrop-blur-md"
                                initial={{ opacity: 0, y: -8, scale: 0.85 }}
                                animate={{ opacity: 1, y: 0, scale: 1 }}
                                transition={{
                                    delay: 0.35,
                                    type: 'spring',
                                    stiffness: 480,
                                    damping: 26,
                                }}
                            >
                                <span
                                    className="font-data text-base font-bold tracking-wider text-[#FFB020] tabular-nums"
                                    style={{ textShadow: '0 0 11px rgba(255,176,32,0.52)' }}
                                >
                                    <AnimatedNumber value={dims.w} startFrom={0} duration={1.4} />
                                    <span className="text-[#FFB020]/40"> × </span>
                                    <AnimatedNumber value={dims.h} startFrom={0} duration={1.4} />
                                </span>
                                <span className="font-data text-[11px] tracking-wider text-[#FFB020]/60">
                                    px
                                </span>
                            </motion.div>
                        )}

                        <motion.div
                            key={`scan-${sealKey}`}
                            aria-hidden
                            className="pointer-events-none absolute inset-x-0 z-20 h-28"
                            style={{
                                background:
                                    'linear-gradient(to bottom, transparent, rgba(255,176,32,0.14) 45%, rgba(255,210,123,0.5) 50%, rgba(255,176,32,0.14) 55%, transparent)',
                            }}
                            initial={{ top: '-12%', opacity: 0 }}
                            animate={{ top: ['-12%', '100%'], opacity: [0, 1, 1, 0] }}
                            transition={{ duration: 0.85, ease: [0.32, 0.72, 0, 1] }}
                        />
                        <motion.div
                            key={`seal-${sealKey}`}
                            className="pointer-events-none absolute bottom-4 left-4 z-20 flex items-center gap-1.5 rounded-full border border-[#FFB020]/30 bg-black/45 px-2.5 py-1 backdrop-blur-md"
                            initial={{ opacity: 0, y: 8, scale: 0.94 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            transition={{
                                delay: 0.62,
                                type: 'spring',
                                stiffness: 420,
                                damping: 30,
                            }}
                        >
                            <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden>
                                <motion.circle
                                    cx="12"
                                    cy="12"
                                    r="9"
                                    fill="none"
                                    stroke="#FFB020"
                                    strokeWidth="2"
                                    initial={{ pathLength: 0, opacity: 0.4 }}
                                    animate={{ pathLength: 1, opacity: 1 }}
                                    transition={{ delay: 0.68, duration: 0.45, ease: 'easeOut' }}
                                />
                                <motion.path
                                    d="M8.5 12.2l2.4 2.4 4.6-5"
                                    fill="none"
                                    stroke="#FFB020"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    initial={{ pathLength: 0 }}
                                    animate={{ pathLength: 1 }}
                                    transition={{ delay: 1.0, duration: 0.3, ease: 'easeOut' }}
                                />
                            </svg>
                            <span className="font-data text-[9px] font-medium tracking-[0.18em] text-[#FFB020]/90">
                                {t('seal_label')}
                            </span>
                        </motion.div>
                    </>
                )}
            </div>
        );
    },
);

export { CanvasEditor };
CanvasEditor.displayName = 'CanvasEditor';
