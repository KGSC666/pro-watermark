import type React from 'react';
import { useState, useEffect, useRef } from 'react';
import { Drawer } from 'vaul';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { motion, AnimatePresence } from 'framer-motion';
import { Settings, Download, Plus, ChevronRight, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface EditorLayoutProps {
    canvas: React.ReactNode;
    controls: React.ReactNode;
    onExport: () => void;
    onAdd: () => void;
    onDropFiles: (files: File[]) => void;
}

export const EditorLayout: React.FC<EditorLayoutProps> = ({
    canvas,
    controls,
    onExport,
    onAdd,
    onDropFiles,
}) => {
    const { t, i18n } = useTranslation();
    const [isDesktop, setIsDesktop] = useState(() =>
        typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : true,
    );
    const [showSidebar, setShowSidebar] = useState(true);
    const [dragging, setDragging] = useState(false);
    const dragDepth = useRef(0);

    const languages = [
        { code: 'en', label: 'English' },
        { code: 'zh', label: '简体中文' },
        { code: 'ja', label: '日本語' },
    ];

    // Track the desktop breakpoint via matchMedia (no manual resize bookkeeping).
    useEffect(() => {
        const mq = window.matchMedia('(min-width: 1024px)');
        const onChange = () => setIsDesktop(mq.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);

    const handleDragEnter = (e: React.DragEvent) => {
        if (!Array.from(e.dataTransfer.types).includes('Files')) return;
        dragDepth.current += 1;
        setDragging(true);
    };
    const handleDragLeave = () => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragging(false);
    };
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onDropFiles(files);
    };

    return (
        <div
            onDragEnter={handleDragEnter}
            onDragOver={(e) => e.preventDefault()}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className="grain relative flex h-[100dvh] w-full bg-[#09090B] overflow-hidden font-sans antialiased text-white selection:bg-[#FFB020]/25"
        >
            {/* 静默的暗背景：胶片噪点（.grain）+ 一束极淡的暖色顶光暗角，给纵深而不与
                照片抢戏。氛围由"安静 + 质感"承载，不再用漂浮的极光色块。 */}
            <div
                className="absolute inset-0 z-0 pointer-events-none"
                style={{
                    background:
                        'radial-gradient(120% 80% at 50% -10%, rgba(255,176,32,0.05), transparent 55%), radial-gradient(100% 100% at 50% 120%, rgba(0,0,0,0.6), transparent 60%)',
                }}
            />

            <AnimatePresence>
                {dragging && (
                    <motion.div
                        initial={{ opacity: 0, scale: 1.02 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 1.02 }}
                        transition={{ duration: 0.18 }}
                        className="fixed inset-3 z-[80] bg-black/70 backdrop-blur-md rounded-[40px] border-2 border-dashed border-[#FFB020]/45 flex flex-col items-center justify-center pointer-events-none"
                    >
                        <Plus size={40} className="text-[#FFB020]/80 mb-4" />
                        <p className="text-lg font-semibold text-white/80">{t('drop_to_add')}</p>
                    </motion.div>
                )}
            </AnimatePresence>

            <main className="flex-1 relative flex items-center justify-center min-w-0 transition-all duration-500">
                <div className="w-full h-full px-4 pt-20 pb-28 md:p-12 lg:p-20 flex items-center justify-center relative overflow-hidden">
                    <div className="w-full h-full max-w-[1400px] max-h-[1000px] relative">
                        {canvas}
                    </div>
                </div>

                {isDesktop && (
                    <div className="absolute top-6 left-1/2 -translate-x-1/2 flex items-center gap-2 p-1.5 bg-[#101013]/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl z-20">
                        <button
                            onClick={onAdd}
                            title="Add Image"
                            className="p-2.5 hover:bg-white/10 rounded-xl transition-all active:scale-95 text-white/60 hover:text-white"
                        >
                            <Plus size={20} />
                        </button>

                        {/* 语言切换器（Radix DropdownMenu：自带键盘导航 / 外点关闭 / Escape） */}
                        <DropdownMenu.Root>
                            <DropdownMenu.Trigger asChild>
                                <button
                                    title={t('inspector')}
                                    className="p-2.5 hover:bg-white/10 rounded-xl transition-all text-white/60 hover:text-white flex items-center gap-2 outline-none"
                                >
                                    <Globe size={18} strokeWidth={1.5} />
                                </button>
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Portal>
                                <DropdownMenu.Content
                                    align="start"
                                    sideOffset={8}
                                    className="z-50 min-w-[120px] origin-top-left rounded-xl border border-white/10 bg-neutral-900 p-1 shadow-2xl data-[state=open]:animate-[toastIn_0.16s_ease-out]"
                                >
                                    {languages.map((lang) => (
                                        <DropdownMenu.Item
                                            key={lang.code}
                                            onSelect={() => i18n.changeLanguage(lang.code)}
                                            className={`w-full cursor-pointer rounded-lg px-3 py-2 text-xs outline-none transition-colors data-[highlighted]:bg-white/5 ${
                                                i18n.language.startsWith(lang.code)
                                                    ? 'bg-white text-black font-bold data-[highlighted]:bg-white'
                                                    : 'text-neutral-400'
                                            }`}
                                        >
                                            {lang.label}
                                        </DropdownMenu.Item>
                                    ))}
                                </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                        </DropdownMenu.Root>

                        <div className="w-[1px] h-5 bg-white/10" />
                        <button
                            onClick={onExport}
                            className="flex items-center gap-2 px-5 py-2 bg-white text-black rounded-xl font-bold text-sm hover:bg-neutral-200 transition-all active:scale-95"
                        >
                            <Download size={16} /> {t('export')}
                        </button>

                        <div className="w-[1px] h-5 bg-white/10" />
                        <button
                            onClick={() => setShowSidebar(!showSidebar)}
                            className={`p-2.5 rounded-xl transition-all ${showSidebar ? 'text-white/60' : 'text-blue-400 bg-blue-400/10'}`}
                        >
                            {showSidebar ? <ChevronRight size={20} /> : <Settings size={20} />}
                        </button>
                    </div>
                )}

                {/* 移动端顶部工具条：添加 + 导出 */}
                {!isDesktop && (
                    <div className="fixed top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 p-1.5 bg-[#101013]/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl z-40">
                        <button
                            onClick={onAdd}
                            title={t('add_image')}
                            className="p-2.5 hover:bg-white/10 rounded-xl transition-all active:scale-95 text-white/60 hover:text-white"
                        >
                            <Plus size={20} />
                        </button>
                        <div className="w-[1px] h-5 bg-white/10" />
                        <button
                            onClick={onExport}
                            className="flex items-center gap-2 px-4 py-2 bg-white text-black rounded-xl font-bold text-sm active:scale-95 transition-transform"
                        >
                            <Download size={16} /> {t('export')}
                        </button>
                    </div>
                )}
            </main>

            {isDesktop ? (
                <aside
                    className={`h-full bg-[#0C0C0E]/95 backdrop-blur-xl border-l border-white/[0.07] flex flex-col shadow-[-10px_0_30px_rgba(0,0,0,0.5)] overflow-hidden z-10 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${
                        showSidebar
                            ? 'w-[320px] opacity-100 translate-x-0'
                            : 'w-0 opacity-0 translate-x-20'
                    }`}
                >
                    <div className="w-[320px] p-8 flex flex-col gap-8 h-full">
                        <div className="flex items-center justify-between shrink-0">
                            <h2 className="font-data text-[11px] font-medium uppercase tracking-[0.32em] text-white/80 flex items-center gap-2.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#FFB020] shadow-[0_0_8px_rgba(255,176,32,0.8)]" />
                                {t('inspector')}
                            </h2>
                            <button
                                onClick={() => setShowSidebar(false)}
                                className="text-neutral-600 hover:text-white transition-colors"
                            >
                                <ChevronRight size={20} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide px-3 -mx-3">
                            {controls}
                        </div>
                    </div>
                </aside>
            ) : (
                <Drawer.Root shouldScaleBackground>
                    <Drawer.Trigger asChild>
                        <button className="fixed bottom-8 right-8 p-5 bg-white text-black rounded-full shadow-2xl z-50 active:scale-90 transition-transform">
                            <Settings size={24} />
                        </button>
                    </Drawer.Trigger>
                    <Drawer.Portal>
                        <Drawer.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]" />
                        <Drawer.Content className="bg-neutral-900 flex flex-col rounded-t-[32px] h-[80vh] fixed bottom-0 left-0 right-0 border-t border-white/10 outline-none z-[70]">
                            <div className="mx-auto w-12 h-1.5 rounded-full bg-neutral-800 mt-4 mb-8" />
                            <Drawer.Title className="sr-only">{t('inspector')}</Drawer.Title>
                            <div className="p-8 overflow-y-auto overflow-x-hidden flex-1 scrollbar-hide">
                                <div className="flex gap-2 mb-8">
                                    {languages.map((lang) => (
                                        <button
                                            key={lang.code}
                                            onClick={() => i18n.changeLanguage(lang.code)}
                                            className={`px-4 py-2 rounded-full text-xs transition-all ${i18n.language.startsWith(lang.code) ? 'bg-white text-black' : 'bg-white/5 text-neutral-500 border border-white/5'}`}
                                        >
                                            {lang.label}
                                        </button>
                                    ))}
                                </div>
                                {controls}
                            </div>
                        </Drawer.Content>
                    </Drawer.Portal>
                </Drawer.Root>
            )}
        </div>
    );
};
