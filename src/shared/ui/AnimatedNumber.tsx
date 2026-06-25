import { useEffect, useState } from 'react';
import NumberFlow from '@number-flow/react';

interface AnimatedNumberProps {
    /** The target value to settle on. */
    value: number;
    /** Optional starting point; when set, the number animates from here on mount
     *  (e.g. 0 → 3024 for a "measuring" count-up). Defaults to `value`. */
    startFrom?: number;
    /** Spin duration in seconds. */
    duration?: number;
    className?: string;
}

/**
 * A number that animates to its target — the "instrument readout" motion, used
 * for the measured pixel dimensions so the tool visibly *measures* a photo.
 * Built on NumberFlow (digit-level transitions, respects reduced motion).
 */
export function AnimatedNumber({ value, startFrom, duration = 1, className }: AnimatedNumberProps) {
    // Render the start value first, then flip to the target so NumberFlow plays
    // the count-up. (NumberFlow only animates on prop *changes* after mount.)
    const [display, setDisplay] = useState(startFrom ?? value);
    useEffect(() => {
        setDisplay(value);
    }, [value]);

    return (
        <NumberFlow
            value={display}
            className={className}
            willChange
            spinTiming={{ duration: duration * 1000, easing: 'cubic-bezier(0.16,1,0.3,1)' }}
        />
    );
}
