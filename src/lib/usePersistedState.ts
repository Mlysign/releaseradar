"use client";
import { useEffect, useRef, useState } from "react";

// State that survives client-side navigation (e.g. opening an item then going
// back) by mirroring to sessionStorage. First paint uses `initial`; the stored
// value is restored on mount. Used for the list pages' filters/search/sort so
// back-nav doesn't reset them (T12).
export function usePersistedState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [val, setVal] = useState<T>(initial);
  // `hydrated` is state, not a ref, so the save effect below skips the very first
  // commit: a ref would flip true synchronously inside the hydrate effect and the
  // save effect (same commit) would then clobber storage with the stale `initial`
  // before the restored value commits — which under React's dev double-invoke of
  // effects gets read back as the value, losing the persisted state on back-nav.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key);
      // Hydrating from sessionStorage must happen post-mount (it's unavailable
      // during SSR), so this restore necessarily sets state in an effect.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw != null) setVal(JSON.parse(raw) as T);
    } catch { /* storage unavailable / bad JSON */ }
    setHydrated(true);
  }, [key]);

  useEffect(() => {
    if (!hydrated) return;
    try { sessionStorage.setItem(key, JSON.stringify(val)); } catch { /* quota */ }
  }, [key, val, hydrated]);

  return [val, setVal];
}

// Save + restore window scroll for a page across back-nav. Restores once after
// `ready` becomes true (i.e. the list has rendered), then tracks scroll to save.
export function useScrollRestore(key: string, ready: boolean) {
  const restored = useRef(false);
  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    let userScrolled = false;
    const markUser = () => { userScrolled = true; };
    const onScroll = () => { try { sessionStorage.setItem(key, String(window.scrollY)); } catch { /* ignore */ } };

    // Restore once, but (re)attach the scroll listener every time the effect runs.
    // Gating the listener behind the one-time `restored` ref would drop it on
    // React's dev effect re-invoke, so the scroll position would stop being saved.
    if (!restored.current) {
      restored.current = true;
      try {
        const raw = sessionStorage.getItem(key);
        const target = raw != null ? parseInt(raw, 10) || 0 : 0;
        if (target > 4) {
          // Re-apply across a short window rather than once: filters persisted via
          // usePersistedState hydrate a beat after the list first renders, so a
          // single scrollTo would land against the un-filtered (taller) list and
          // then collapse when a narrow facet shrinks it. Keep nudging to the
          // target until it sticks or the user takes over.
          const start = performance.now();
          const tick = () => {
            if (userScrolled) return;
            window.scrollTo(0, target);
            if (Math.abs(window.scrollY - target) > 2 && performance.now() - start < 1200) {
              raf = requestAnimationFrame(tick);
            }
          };
          window.addEventListener("wheel", markUser, { passive: true });
          window.addEventListener("touchmove", markUser, { passive: true });
          window.addEventListener("keydown", markUser);
          raf = requestAnimationFrame(tick);
        }
      } catch { /* ignore */ }
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("wheel", markUser);
      window.removeEventListener("touchmove", markUser);
      window.removeEventListener("keydown", markUser);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [key, ready]);
}
