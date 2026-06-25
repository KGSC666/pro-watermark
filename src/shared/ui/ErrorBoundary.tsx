import type React from 'react';
import { ErrorBoundary as ReactErrorBoundary, type FallbackProps } from 'react-error-boundary';

// Localized strings are kept inline and self-contained: the fallback must render
// even if i18n (or anything else) is the thing that crashed, so it can't depend
// on app state or hooks.
const COPY: Record<string, { title: string; desc: string; btn: string }> = {
    en: {
        title: 'Something went wrong',
        desc: 'The page hit an unexpected error. Reloading usually fixes it.',
        btn: 'Reload page',
    },
    zh: {
        title: '出了点问题',
        desc: '页面遇到意外错误，刷新通常即可恢复。',
        btn: '刷新页面',
    },
    ja: {
        title: '問題が発生しました',
        desc: '予期しないエラーが発生しました。再読み込みで解消することが多いです。',
        btn: '再読み込み',
    },
};

const pickCopy = () => {
    const lang = typeof navigator !== 'undefined' ? (navigator.language || 'en').slice(0, 2) : 'en';
    return COPY[lang] ?? COPY.en;
};

function Fallback(_props: FallbackProps) {
    const c = pickCopy();
    return (
        <div className="h-screen w-full bg-black text-white flex flex-col items-center justify-center gap-6 px-8 text-center">
            <div className="w-14 h-14 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center">
                <svg
                    width="26"
                    height="26"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-white/50"
                >
                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
            </div>
            <div className="max-w-[300px]">
                <p className="text-lg font-semibold tracking-tight">{c.title}</p>
                <p className="text-sm text-neutral-500 mt-2 leading-relaxed">{c.desc}</p>
            </div>
            <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-5 py-2.5 bg-white text-black rounded-xl font-semibold text-sm hover:bg-neutral-200 active:scale-95 transition-all"
            >
                {c.btn}
            </button>
        </div>
    );
}

/** Thin wrapper over react-error-boundary so call sites stay unchanged. */
export function ErrorBoundary({ children }: { children: React.ReactNode }) {
    return (
        <ReactErrorBoundary
            FallbackComponent={Fallback}
            onError={(error, info) => console.error('Caught by ErrorBoundary:', error, info)}
        >
            {children}
        </ReactErrorBoundary>
    );
}
