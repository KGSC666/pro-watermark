import { useEffect, useState } from 'react';
import { useScramble } from 'use-scramble';

interface ScrambleTextProps {
    text: string;
    className?: string;
    /** Hold before the decode starts, to sync with a staggered reveal. */
    delay?: number;
}

/**
 * Resolves random glyphs into the final text — a "decoding" reveal that fits the
 * forensic/metadata theme. Built on use-scramble; honors prefers-reduced-motion
 * by rendering the plain text.
 */
export function ScrambleText({ text, className, delay = 0 }: ScrambleTextProps) {
    const reduce =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    // Start blank and swap in the real text after `delay`; use-scramble animates
    // on every text change, so this also gives us the delayed start for free.
    const [active, setActive] = useState(delay ? '' : text);
    useEffect(() => {
        if (!delay) {
            setActive(text);
            return;
        }
        const id = setTimeout(() => setActive(text), delay);
        return () => clearTimeout(id);
    }, [text, delay]);

    const { ref } = useScramble({
        text: active,
        speed: 0.5,
        scramble: 6,
        step: 2,
        seed: 2,
        playOnMount: !reduce,
    });

    if (reduce) return <span className={className}>{text}</span>;
    return <span ref={ref} className={className} />;
}
