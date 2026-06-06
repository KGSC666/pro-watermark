import React, { useState, useRef, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { EditorLayout } from "../features/EditorLayout";
import { CanvasEditor, CanvasEditorRef } from "../features/CanvasEditor";
import { Effect } from "effect";
import { processImagePipeline } from "../kernel/pipeline";
import { WatermarkConfig, Placement, Placements } from "../entities/watermark/types";
import { useTranslation } from "react-i18next";
import { X, Pipette } from "lucide-react";
import ExifReader from "exifreader";
import { heicTo, isHeic as isHeicContent } from "heic-to";
import "../shared/lib/i18n"; // 初始化 i18n
import "./globals.css";

console.log("App Version 1.0.1 - Initializing...");

const COLOR_PRESETS = ["#FFFFFF", "#000000", "#FF3B30"];

/** The full, independent watermark state for a single image. */
interface WatermarkState {
  config: WatermarkConfig;
  placements: Placements;
}

const makeDefaultState = (): WatermarkState => ({
  config: {
    type: "text",
    text: "PRO WATERMARK",
    image: null,
    opacity: 0.8,
    color: "#FFFFFF",
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
  const [exportProgress, setExportProgress] = useState(0);
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
    if (hasImages) setStates(prev => prev.map((s, i) => (i === currentIndex ? updater(s) : s)));
    else setDraft(prev => updater(prev));
  };
  // Accepts either a full config object ({...config, x}) or an updater, matching
  // both call styles used throughout the panel below.
  const setConfig = (next: WatermarkConfig | ((prev: WatermarkConfig) => WatermarkConfig)) =>
    updateActive(s => ({ ...s, config: typeof next === "function" ? next(s.config) : next }));
  const setActivePlacement = (p: Placement) =>
    updateActive(s => ({ ...s, placements: { ...s.placements, [s.config.type]: p } }));


  const [isExporting, setIsExporting] = useState(false);
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
          console.warn("Failed to load metadata", err);
          setMetadata(null);
        }
      }
    };
    loadMetadata();
  }, [sourceFiles, currentIndex]);

  // Keep thumbnail object URLs in sync with the source files, revoking old ones.
  useEffect(() => {
    const urls = sourceFiles.map(f => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach(u => URL.revokeObjectURL(u));
  }, [sourceFiles]);

  // Hand finished images to the OS. On mobile, the native share sheet lets the
  // user tap "Save to Photos" → straight into the camera roll (web pages can't
  // write the photo library directly). On desktop, fall back to downloads.
  const saveFiles = async (files: File[]) => {
    // canShare() is true on desktop Safari/Chrome too, so it isn't a "mobile"
    // signal — gate on the actual device. iPadOS 13+ spoofs a Mac UA, so a real
    // touchscreen (maxTouchPoints > 1) tells the iPad apart from a desktop Mac.
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    const isMobile =
      /Android|iPhone|iPod/.test(ua) ||
      (/iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const canShareFiles =
      isMobile &&
      typeof navigator.canShare === "function" &&
      navigator.canShare({ files });

    if (canShareFiles) {
      try {
        await navigator.share({ files, title: "Pro Watermark" });
        return;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return; // user closed the sheet
        // e.g. activation expired on a large batch — fall through to download.
        console.warn("Share failed, downloading instead:", err);
      }
    }

    for (const file of files) {
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    }
  };

  const handleExportAll = async () => {
    if (sourceFiles.length === 0) return alert(t('add_images_first'));
    setIsExporting(true);
    setExportProgress(0);

    // Snapshot the image currently on screen FIRST, before any other image is
    // loaded into the canvas. This preserves a watermark the user dragged into
    // a custom position (that position only lives on the live Fabric object,
    // not in config). null = current image isn't ready, fall back to a reload.
    const currentSnapshot = await editorRef.current!.exportBlob().catch(() => null);
    let canvasDisturbed = false;
    const outFiles: File[] = [];

    try {
      for (let i = 0; i < sourceFiles.length; i++) {
        setExportProgress(i + 1);
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
          renderToBlob = () => editorRef.current!.exportFileBlob(file, st.config, st.placements[st.config.type]);
        }
        const task = processImagePipeline(file, renderToBlob);
        const finalFile = await Effect.runPromise(task);
        const name = `pro_${file.name.replace(/\.(heic|heif)$/i, '.jpg')}`;
        outFiles.push(new File([finalFile], name, { type: "image/jpeg" }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      // Only repaint if the loop actually overwrote the canvas with other
      // images; otherwise leave the user's dragged watermark untouched.
      if (canvasDisturbed) {
        const current = sourceFiles[currentIndex];
        if (current) editorRef.current?.restoreView(current).catch(console.error);
      }
    }

    setIsExporting(false);
    if (outFiles.length > 0) await saveFiles(outFiles);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (f) => setConfig({ ...config, type: "image", image: f.target?.result as string });
      reader.readAsDataURL(file);
    }
  };

  // Quick sync guess by extension/MIME, for the initial file filter.
  const looksLikeHeic = (f: File) => /\.(heic|heif)$/i.test(f.name) || /image\/hei[cf]/i.test(f.type);

  const ingestFiles = async (files: File[]) => {
    const imageFiles = files.filter(f => f.type.startsWith("image/") || looksLikeHeic(f));
    if (imageFiles.length === 0) return;

    const accepted: File[] = [];
    const acceptedNames: string[] = [];
    const failed: string[] = [];

    // Convert sequentially (one libheif decode at a time keeps memory sane on
    // a big "select all photos" batch).
    for (const file of imageFiles) {
      // Trust the extension/MIME first; otherwise sniff the actual bytes.
      let heic = looksLikeHeic(file);
      if (!heic) { try { heic = await isHeicContent(file); } catch { /* not heic */ } }

      if (heic) {
        try {
          const blob = await heicTo({ blob: file, type: "image/jpeg", quality: 0.92 });
          const name = /\.(heic|heif)$/i.test(file.name) ? file.name.replace(/\.(heic|heif)$/i, ".jpg") : `${file.name}.jpg`;
          accepted.push(new File([blob], name, { type: "image/jpeg" }));
          acceptedNames.push(file.name);
        } catch (e) {
          // Skip it rather than injecting an unrenderable HEIC that crashes the canvas.
          console.error("HEIC conversion failed:", file.name, e);
          failed.push(file.name);
        }
      } else {
        accepted.push(file);
        acceptedNames.push(file.name);
      }
    }

    if (failed.length > 0) alert(t("heic_failed", { names: failed.join(", ") }));
    if (accepted.length === 0) return;

    // Give each new image its own independent state, cloned from whatever is
    // currently being edited (the active image, or the draft if none yet).
    const template = active;
    const newStates = accepted.map(() => structuredClone(template));

    setOriginalNames(prev => [...prev, ...acceptedNames]);
    setCurrentIndex(sourceFiles.length); // jump to the first newly added image
    setStates(prev => [...prev, ...newStates]);
    setSourceFiles(prev => [...prev, ...accepted]);
  };

  const handleFilesChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    await ingestFiles(Array.from(e.target.files || []));
    e.target.value = ""; // allow re-selecting the same file
  };

  // Remove one image (and its independent watermark state) from the queue.
  const removeImage = (index: number) => {
    const drop = <T,>(arr: T[]) => arr.filter((_, i) => i !== index);
    setSourceFiles(prev => drop(prev));
    setOriginalNames(prev => drop(prev));
    setStates(prev => drop(prev));
    setCurrentIndex(prev => {
      const newLen = sourceFiles.length - 1;
      if (newLen <= 0) return 0;
      // Shift selection left if we removed something at/ before it, then clamp.
      const next = index < prev ? prev - 1 : prev;
      return Math.min(next, newLen - 1);
    });
  };

  return (
    <>
      <input type="file" ref={fileInputRef} className="hidden" multiple accept="image/*,.heic,.heif" onChange={handleFilesChange} />
      <input type="file" ref={logoInputRef} className="hidden" accept="image/png,image/svg+xml" onChange={handleLogoUpload} />
      
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
            onConfigChange={(newFields) => setConfig(prev => ({ ...prev, ...newFields }))}
            onPlacementChange={setActivePlacement}
            onImageLoad={(f) => {
               if(!sourceFiles.find(sf => sf === f)) setSourceFiles(p => [...p, f]);
            }}
          />
        }
        controls={
          <div className="flex flex-col gap-6 overflow-x-hidden">
            {sourceFiles.length > 0 && (
              <div className="p-3 bg-white/5 rounded-2xl border border-white/5 mb-2">
                 <p className="text-[10px] font-bold text-neutral-500 uppercase mb-2 tracking-widest">{t('batch_queue')} ({sourceFiles.length})</p>
                 <div className="flex gap-2.5 overflow-x-auto pb-2 pt-1 px-1 scrollbar-hide">
                    {sourceFiles.map((_, i) => (
                      <div key={i} className="relative shrink-0">
                        <button onClick={() => setCurrentIndex(i)} className={`w-10 h-10 rounded-lg block border-2 overflow-hidden transition-all ${currentIndex === i ? 'border-white' : 'border-transparent opacity-40 hover:opacity-70'}`}>
                          {previews[i]
                            ? <img src={previews[i]} alt="" className="w-full h-full object-cover" />
                            : <div className="w-full h-full bg-neutral-800 flex items-center justify-center text-[8px]">{i + 1}</div>}
                        </button>
                        <button
                          onClick={() => removeImage(i)}
                          title={t('remove')}
                          className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-neutral-900 border border-white/20 flex items-center justify-center text-white/60 hover:bg-red-500 hover:text-white hover:border-red-500 transition-all active:scale-90 shadow-md"
                        >
                          <X size={9} strokeWidth={2.5} />
                        </button>
                      </div>
                    ))}
                 </div>
              </div>
            )}

            <div className="flex p-1 bg-white/5 rounded-xl border border-white/5">
               <button onClick={() => setConfig({...config, type: 'text'})} className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${config.type === 'text' ? 'bg-white text-black shadow-lg' : 'text-neutral-500'}`}>{t('type_text')}</button>
               <button onClick={() => setConfig({...config, type: 'image'})} className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${config.type === 'image' ? 'bg-white text-black shadow-lg' : 'text-neutral-500'}`}>{t('type_logo')}</button>
            </div>

            {config.type === "text" ? (
              <section className="space-y-5">
                <div>
                  <label className="text-[10px] font-bold text-neutral-500 uppercase block mb-2 tracking-widest">{t('watermark_text')}</label>
                  <input type="text" value={config.text} onChange={(e) => setConfig({...config, text: e.target.value})} className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-white/30 transition-all" placeholder={t('placeholder')} />
                </div>
                <div>
                  <div className="flex justify-between mb-2">
                    <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">{t('size')}</label>
                    <span className="text-[10px] font-mono text-white/40">{config.sizePct.toFixed(1)}%</span>
                  </div>
                  <input type="range" min="1" max="25" step="0.5" value={config.sizePct} onChange={(e) => setConfig({...config, sizePct: parseFloat(e.target.value)})} className="w-full accent-white" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest block mb-3">{t('color')}</label>
                  <div className="flex items-center justify-between bg-white/[0.08] rounded-full px-4 py-2.5 border border-white/5">
                    {COLOR_PRESETS.map(c => {
                      const selected = config.color.toUpperCase() === c;
                      return (
                        <button
                          key={c}
                          onClick={() => setConfig({ ...config, color: c })}
                          className={`w-7 h-7 rounded-full transition-all active:scale-90 ${selected ? 'p-[4px] ring-2 ring-inset ring-white' : 'ring-1 ring-inset ring-white/20 hover:ring-white/50'}`}
                        >
                          <span className="block w-full h-full rounded-full" style={{ backgroundColor: c }} />
                        </button>
                      );
                    })}
                    <label
                      title={t('custom_color')}
                      className={`relative w-7 h-7 rounded-full cursor-pointer flex items-center justify-center transition-all active:scale-90 ${isCustomColor ? 'p-[4px] ring-2 ring-inset ring-white' : 'ring-1 ring-inset ring-white/20 hover:ring-white/50'}`}
                    >
                      <span className="block w-full h-full rounded-full" style={{ backgroundColor: isCustomColor ? config.color : 'rgba(255,255,255,0.06)' }} />
                      <Pipette size={12} strokeWidth={2} className="absolute text-white mix-blend-difference pointer-events-none" />
                      <input type="color" value={config.color} onChange={(e) => setConfig({ ...config, color: e.target.value })} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer rounded-full" />
                    </label>
                  </div>
                </div>
              </section>
            ) : (
              <section>
                <label className="text-[10px] font-bold text-neutral-500 uppercase block mb-2 tracking-widest">{t('upload_logo')}</label>
                <div className="relative">
                  <button onClick={() => logoInputRef.current?.click()} className="w-full py-8 border-2 border-dashed border-white/10 rounded-2xl flex flex-col items-center gap-2 hover:bg-white/5 transition-all">
                    {config.image ? <img src={config.image} className="h-12 object-contain" alt="Logo" /> : <><div className="w-10 h-10 bg-white/5 rounded-full flex items-center justify-center text-neutral-500">+</div><span className="text-xs text-neutral-600">{t('click_to_select')}</span></>}
                  </button>
                  {config.image && (
                    <button
                      onClick={() => setConfig({ ...config, image: null })}
                      className="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 backdrop-blur border border-white/10 flex items-center justify-center text-white/70 hover:text-white hover:bg-red-500/80 transition-all active:scale-90"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              </section>
            )}

            <section>
              <div className="flex justify-between mb-2">
                <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">{t('opacity')}</label>
                <span className="text-[10px] font-mono text-white/40">{Math.round(config.opacity * 100)}%</span>
              </div>
              <input type="range" min="0" max="1" step="0.01" value={config.opacity} onChange={(e) => setConfig({...config, opacity: parseFloat(e.target.value)})} className="w-full accent-white" />
            </section>

            <section>
              <div className="flex justify-between items-center mb-4">
                <label className="text-[10px] font-bold text-neutral-500 uppercase tracking-widest">{t('position')}</label>
                {activePlacement.preset === null && (
                  <span className="text-[10px] font-mono text-white/40">{t('position_custom')}</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 bg-white/5 p-2 rounded-2xl border border-white/5">
                {[1,2,3,4,5,6,7,8,9].map(i => {
                  const selected = activePlacement.preset === i;
                  return (
                    <button key={i} onClick={() => setActivePlacement({ ...activePlacement, preset: i, rel: null })} className={`aspect-square rounded-lg flex items-center justify-center border transition-all ${selected ? 'bg-white/10 border-white/40 shadow-lg' : 'border-transparent hover:bg-white/5'}`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${selected ? 'bg-white' : 'bg-neutral-700'}`} />
                    </button>
                  );
                })}
              </div>
            </section>
            
            {sourceFiles.length > 0 && (
              <div className="mt-2 p-4 bg-emerald-500/5 rounded-2xl border border-emerald-500/10 text-[10px] text-neutral-500 font-mono space-y-1">
                <p className="text-emerald-500 font-bold mb-1 uppercase">{t('source_verified')}</p>
                <p className="truncate">NAME: {originalNames[currentIndex] ?? sourceFiles[currentIndex].name}</p>
                {metadata && (
                  <div className="mt-4 pt-4 border-t border-emerald-500/10 space-y-1 max-h-[220px] overflow-y-auto scrollbar-hide pr-1">
                    {Object.entries(metadata).map(([key, val]) => (
                      <p key={key} className="flex justify-between gap-4">
                        <span className="text-emerald-500/60 shrink-0">{key}:</span>
                        <span className="truncate text-white/60">{val as string}</span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
            
          </div>
        }
      />

      {isExporting && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex flex-col items-center justify-center text-center p-8">
           <div className="w-12 h-12 border-4 border-white/20 border-t-white rounded-full animate-spin mb-4" />
           <p className="text-lg font-bold tracking-tight">{t('processing')}</p>
           <p className="text-sm text-neutral-500 mt-2">{t('saving_info', { current: exportProgress, total: sourceFiles.length })}</p>
        </div>
      )}
    </>
  );
};

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <React.Suspense fallback={<div className="h-screen w-full bg-black flex items-center justify-center text-white">Loading...</div>}>
      <App />
    </React.Suspense>
  </React.StrictMode>
);
