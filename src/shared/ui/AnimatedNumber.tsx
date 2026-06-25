import { useEffect, useRef, useState } from 'react';
import { animate } from 'framer-motion';

interface AnimatedNumberProps {
    /** The target value to settle on. */
    value: number;
    /** Optional starting point; when set, the number tweens from here on mount
     *  (e.g. 0 → 3024 for a "measuring" count-up). Defaults to `value` (no count). */
    startFrom?: number;
    duration?: number;
    /** Formats the (fractional, mid-tween) display value into text. */
    format?: (n: number) => string;
    className?: string;
}

/**
 * A number that tweens to its target instead of snapping — the core "instrument
 * readout" motion. Used for the measured pixel dimensions so the tool visibly
 * *measures* a photo rather than just printing a static label.
 */
export function AnimatedNumber({
    value,
    startFrom,
    duration = 1.0,
    format = (n) => Math.round(n).toString(),
    className,
}: AnimatedNumberProps) {
    const [display, setDisplay] = useState(startFrom ?? value);
    // Track the *current* displayed value (not the target) so re-running the
    // effect always tweens from where we are. Setting this to `value` eagerly
    // would make React 18 StrictMode's double-invoke animate value→value (i.e.
    // no motion at all in dev) — the bug that made the count-up invisible.
    const displayRef = useRef(startFrom ?? value);

    useEffect(() => {
        const controls = animate(displayRef.current, value, {
            duration,
            ease: [0.16, 1, 0.3, 1],
            onUpdate: (v) => {
                displayRef.current = v;
                setDisplay(v);
            },
        });
        return () => controls.stop();
    }, [value, duration]);

    return <span className={className}>{format(display)}</span>;
}
