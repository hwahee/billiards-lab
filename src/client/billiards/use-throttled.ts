/**
 * The latest value, but changing no more often than `intervalMs`.
 *
 * For work that is worth doing on every change in principle, but not at
 * pointer rate: a drag fires moves as fast as the browser can deliver them,
 * and anything expensive hung off that — recomputing a preview, rebuilding
 * geometry — competes with the frames that make the drag feel direct.
 *
 * The trailing edge always lands, so the value settles on the real one once
 * the hand stops; nothing is dropped, only skipped on the way.
 */
import { useEffect, useRef, useState } from 'react';

export function useThrottled<T>(value: T, intervalMs: number): T {
  const [throttled, setThrottled] = useState(value);
  const lastChangeRef = useRef(-Infinity);

  useEffect(() => {
    // Always through a timer, even at zero delay: settling state during the
    // effect itself would just move the work back into this render.
    const wait = Math.max(0, intervalMs - (performance.now() - lastChangeRef.current));
    const timer = setTimeout(() => {
      lastChangeRef.current = performance.now();
      setThrottled(value);
    }, wait);
    return () => clearTimeout(timer);
  }, [value, intervalMs]);

  return throttled;
}
