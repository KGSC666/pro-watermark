import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as Slider from '@radix-ui/react-slider';
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

/**
 * An instrument-style fader built on Radix Slider — keyboard + ARIA accessible
 * out of the box — styled with an amber-filled track and a glowing precision
 * thumb. A value bubble rides above the thumb while dragging; it's portaled to
 * <body> so the inspector's scroll container can't clip it.
 *
 * Keeps the mobile fixes from the old slider: `data-vaul-no-drag` + a pointer
 * stop so the bottom drawer doesn't steal the gesture.
 */
export function Fader({ label, value, min, max, step, onChange, format }: FaderProps) {
    const thumbRef = useRef<HTMLSpanElement>(null);
    const [bubble, setBubble] = useState<{ x: number; y: number } | null>(null);

    // Position the bubble over the thumb, in viewport space.
    const place = () => {
        const r = thumbRef.current?.getBoundingClientRect();
        if (r) setBubble({ x: r.left + r.width / 2, y: r.top });
    };

    return (
        <div>
            <div className="mb-2 flex justify-between">
                <label className="font-data text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                    {label}
                </label>
                <span className="font-data text-[10px] text-[#FFB020]/80">{format(value)}</span>
            </div>
            <Slider.Root
                data-vaul-no-drag
                className="relative flex h-4 w-full touch-none select-none items-center"
                min={min}
                max={max}
                step={step}
                value={[value]}
                onValueChange={([v]) => {
                    onChange(v);
                    if (bubble) place();
                }}
                onPointerDown={(e) => {
                    e.stopPropagation();
                    requestAnimationFrame(place);
                }}
                onPointerUp={() => setBubble(null)}
                onPointerCancel={() => setBubble(null)}
                onBlur={() => setBubble(null)}
            >
                <Slider.Track className="relative h-1.5 w-full grow rounded-full bg-white/12">
                    <Slider.Range className="absolute h-full rounded-full bg-[#FFB020]" />
                </Slider.Track>
                <Slider.Thumb
                    ref={thumbRef}
                    aria-label={label}
                    className="block h-4 w-4 rounded-full bg-[#fafafa] shadow-[0_0_0_4px_rgba(9,9,11,0.9),0_0_10px_rgba(255,176,32,0.55)] transition-shadow active:shadow-[0_0_0_3px_rgba(9,9,11,0.9),0_0_0_7px_rgba(255,176,32,0.25),0_0_14px_rgba(255,176,32,0.7)]"
                />
            </Slider.Root>
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
