import { useEffect, useRef, useState, useImperativeHandle, forwardRef } from "react";
import { Canvas, FabricImage, IText, FabricObject } from "fabric";
import { WatermarkConfig, Placement } from "../entities/watermark/types";
import { presetPosition, relToPoint, pointToRel, sizePctToPx, pxToSizePct } from "../entities/watermark/geometry";
import { useTranslation } from "react-i18next";

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

const CanvasEditor = forwardRef<CanvasEditorRef, CanvasEditorProps>(({ file, config, placement, onImageLoad, onConfigChange, onPlacementChange }, ref) => {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvas = useRef<Canvas | null>(null);
  const watermarkRef = useRef<FabricObject | null>(null);

  const [hasImage, setHasImage] = useState(false);

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
    const bg = canvas?.getObjects().find(o => (o as any).isBackground) as FabricImage | undefined;
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
    if (!fabricCanvas.current) throw new Error("Canvas not initialized");
    const canvas = fabricCanvas.current;
    const bgImg = canvas.getObjects().find(obj => (obj as any).isBackground) as FabricImage;
    if (!bgImg) throw new Error("No image loaded");

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
      quality: 1,
      multiplier,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      enableRetinaScaling: false
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
    }
  }));

  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const canvas = new Canvas(canvasRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      backgroundColor: "transparent",
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
        latest.current.onConfigChange({ sizePct: Math.round(pxToSizePct(baseDim, px) * 10) / 10 });
      }
    });
    canvas.on('text:changed', (e) => {
      const target = e.target as IText;
      if (target) latest.current.onConfigChange({ text: target.text });
    });

    const handleResize = () => {
      if (!containerRef.current || !fabricCanvas.current) return;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      
      fabricCanvas.current.setDimensions({ width, height });
      fabricCanvas.current.requestRenderAll();
    };
    window.addEventListener('resize', handleResize);

    return () => { 
      window.removeEventListener('resize', handleResize);
      canvas.dispose(); 
    };
  }, []);

  // Load a file onto the canvas as the background, fully awaitable.
  const loadFileOnCanvas = (target: File): Promise<void> => {
    return new Promise((resolve, reject) => {
      const canvas = fabricCanvas.current;
      if (!canvas) return reject(new Error("Canvas not ready"));
      const reader = new FileReader();
      reader.onload = async (f) => {
        try {
          const data = f.target?.result as string;
          const img = await FabricImage.fromURL(data);

          // Set high quality scaling filters
          img.set({ imageSmoothing: true });

          canvas.clear();
          watermarkRef.current = null;
          const scale = Math.min(canvas.width! / img.width!, canvas.height! / img.height!) * 0.95;
          (img as any).isBackground = true;
          img.set({
            left: canvas.width! / 2, top: canvas.height! / 2,
            originX: "center", originY: "center",
            scaleX: scale, scaleY: scale,
            selectable: false, evented: false
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
    if (!file || !fabricCanvas.current) return;
    let cancelled = false;
    loadFileOnCanvas(file)
      .then(async () => {
        if (cancelled) return;
        setHasImage(true);
        onImageLoad(file);
        // Re-apply the watermark for the freshly loaded image. The [config]
        // effect won't fire on its own when only the image changes.
        await createOrUpdateWatermark();
      })
      .catch(err => console.error("Failed to load image", err));
    return () => { cancelled = true; };
  }, [file]);

  // Defaults to the live props, but batch export passes each image's own state
  // explicitly so it renders that image's watermark rather than the active one.
  const createOrUpdateWatermark = async (cfg: WatermarkConfig = config, plc: Placement = placement) => {
    const canvas = fabricCanvas.current;
    if (!canvas) return;
    // Gate on the actual background object rather than the React `hasImage`
    // state, which hasn't flushed yet during the load → render sequence.
    const bg = canvas.getObjects().find(o => (o as any).isBackground);
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
    const shouldRecreate = !watermarkRef.current ||
      (wantText && !isText) ||
      (wantImage && (!isImage || currentLogoSrc !== cfg.image));

    if (shouldRecreate) {
      if (watermarkRef.current) {
        canvas.remove(watermarkRef.current);
        watermarkRef.current = null;
      }
      if (wantText) {
        watermarkRef.current = new IText(cfg.text, {
          fontFamily: "Inter, system-ui, sans-serif",
          originX: "center", originY: "center",
          fontSize: pctToPx(cfg.sizePct),
          fill: cfg.color,
          opacity: cfg.opacity,
        });
      } else if (wantImage) {
        const img = await FabricImage.fromURL(cfg.image!);
        const logoScale = (canvas.width! * 0.15) / img.width!;
        img.set({ scaleX: logoScale, scaleY: logoScale, originX: "center", originY: "center", opacity: cfg.opacity });
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
        w.set({ text: cfg.text, fill: cfg.color, fontSize: pctToPx(cfg.sizePct), scaleX: 1, scaleY: 1 });
      }
      w.set({ opacity: cfg.opacity });
      applyPlacement(w, plc);
      w.setCoords();
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
        bgCenterX: box.centerX, bgCenterY: box.centerY,
        bgWidth: box.width, bgHeight: box.height,
        wmWidth: obj.getScaledWidth(), wmHeight: obj.getScaledHeight(),
      });
      obj.set({ left, top });
    } else if (plc.rel) {
      const { left, top } = relToPoint(plc.rel, box);
      obj.set({ left, top });
    } else {
      obj.set({ left: box.centerX, top: box.centerY });
    }
  };

  useEffect(() => { createOrUpdateWatermark(); }, [config, placement, hasImage]);

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full min-h-0 bg-neutral-950 rounded-[40px] border border-white/5 shadow-2xl overflow-hidden group"
    >
      {/* 绝对居中的空态提示 */}
      {!hasImage && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 pointer-events-none z-0 px-8 text-center animate-in fade-in zoom-in-95 duration-700">
           <div className="w-16 h-16 md:w-20 md:h-20 bg-white/[0.02] rounded-[24px] flex items-center justify-center border border-white/10 shadow-2xl transition-transform duration-500">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" className="opacity-30"><path d="M12 5v14M5 12h14" strokeLinecap="round"/></svg>
           </div>
           <div className="max-w-[280px]">
             <span className="text-base md:text-lg font-semibold tracking-tight text-white/60 block">{t('ready_to_process')}</span>
             <span className="text-xs md:text-sm text-neutral-600 mt-2 block leading-relaxed">{t('drop_hint')}</span>
           </div>
        </div>
      )}
      
      {/* 画布容器，确保它撑满空间 */}
      <canvas ref={canvasRef} className="absolute inset-0 z-10" />
    </div>
  );
});

export { CanvasEditor };
CanvasEditor.displayName = "CanvasEditor";
