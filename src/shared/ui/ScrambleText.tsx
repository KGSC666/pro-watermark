import { useEffect, useRef, useState } from 'react';

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/\\<>=*#%';
const scramble = (text: string, revealed: number) => {
    let out = '';
    for (let i = 0; i < text.length; i++) {
        if (i < revealed || text[i] === ' ') out += text[i];
        else out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
    }
    return out;
};

interface ScrambleTextProps {
    text: string;
    className?: string;
    duration?: number;
    delay?: number;
}

/**
 * Resolves random glyphs into the final text once on mount — a "decoding" reveal
 * that fits the forensic/metadata theme. Honors prefers-reduced-motion by simply
 * showing the text.
 */
export function ScrambleText({ text, className, duration = 1100, delay = 0 }: ScrambleTextProps) {
    const reduce =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const [out, setOut] = useState(() => (reduce ? text : scramble(text, 0)));
    const raf = useRef<number>(0);

    useEffect(() => {
        if (reduce) {
            setOut(text);
            return;
        }
        let start: number | null = null;
        const timer = setTimeout(() => {
            const step = (ts: number) => {
                if (start === null) start = ts;
                const p = Math.min(1, (ts - start) / duration);
                // Ease-out so the last characters settle gently.
                const eased = 1 - (1 - p) ** 3;
                setOut(scramble(text, Math.floor(eased * text.length)));
                if (p < 1) raf.current = requestAnimationFrame(step);
                else setOut(text);
            };
            raf.current = requestAnimationFrame(step);
        }, delay);
        return () => {
            clearTimeout(timer);
            cancelAnimationFrame(raf.current);
        };
    }, [text, duration, delay, reduce]);

    return <span className={className}>{out}</span>;
}
