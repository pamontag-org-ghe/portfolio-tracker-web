import { useEffect, useState } from 'react';

/**
 * Returns true when the viewport matches the given media query (default: phone
 * portrait). Used to switch between desktop tables and stacked card layouts.
 *
 * The hook is SSR-safe: when `window` is unavailable, it defaults to `false`.
 */
export function useIsMobile(query = '(max-width: 767px)'): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    // Older Safari uses addListener; modern browsers use addEventListener.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    }
    mql.addListener(handler);
    return () => mql.removeListener(handler);
  }, [query]);

  return matches;
}
