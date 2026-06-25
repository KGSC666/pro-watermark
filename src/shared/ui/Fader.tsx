import type React from 'react';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';

interface FaderProps {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (value: number) => void;
    /** Formats the value for the right-aligned readout and the drag bubble. */
    format: (value: number) => string;
}

const THUMB = 16;

/**
 * An instrument-style fader: an amber-filled track, a glowing precision thumb,
 * and a value bubble that rides above the thumb while dragging.
 *
 * The bubble is rendered through a portal to <body> at viewport coordinates, so
 * it's never clipped by the inspector's scroll container (an `overflow` ancestor
 * would otherwise cut off a tooltip that floats above the track).
 *
 * Keeps the mobile fixes from the old inline sliders: `data-vaul-no-drag` plus a
 * pointer-down stop so the bottom drawer doesn't steal the gesture.
 */
export function Fader({ label, value, min, max, step, onChange, format }: FaderProps) {
    const inputRef = useRef<HTMLInputElement>(null);
    const [bubble, setBubble] = useState<{ x: number; y: number } | null>(null);
    const pct = ((value - min) / (max - min)) * 100;

    // Position the bubble over the thumb, in viewport space, for a given value.
    const placeBubble = (val: number) => {
        const el = inputRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const p = (val - min) / (max - min);
        setBubble({ x: r.left + THUMB / 2 + p * (r.width - THUMB), y: r.top });
    };

    return (
        <div>
            <div className="mb-2 flex justify-between">
                <label className="font-data text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                    {label}
                </label>
                <span className="font-data text-[10px] text-[#FFB020]/80">{format(value)}</span>
            </div>
            <input
                ref={inputRef}
                data-vaul-no-drag
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    onChange(v);
                    if (bubble) placeBubble(v);
                }}
                onPointerDown={(e) => {
                    e.stopPropagation();
                    placeBubble(value);
                }}
                onPointerUp={() => setBubble(null)}
                onPointerCancel={() => setBubble(null)}
                onBlur={() => setBubble(null)}
                style={{ '--fill': `${pct}%` } as React.CSSProperties}
                className="w-full"
            />
            {bubble &&
                createPortal(
                    <AnimatePresence>
                        <motion.div
                            initial={{ opacity: 0, y: 4, scale: 0.8 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 4, scale: 0.8 }}
                            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                            style={{ left: bubble.x, top: bubble.y - 34 }}
                            className="pointer-events-none fixed z-[120] -translate-x-1/2 rounded-md bg-[#FFB020] px-1.5 py-0.5 font-data text-[10px] font-bold text-black shadow-[0_4px_12px_rgba(255,176,32,0.4)]"
                        >
                            {format(value)}
                        </motion.div>
                    </AnimatePresence>,
                    document.body,
                )}
        </div>
    );
}
