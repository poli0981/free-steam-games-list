import { useSyncExternalStore } from "react";
import { isAndroid } from "../lib/external-open";

// "Mobile" = the Android app (any size) OR a viewport below Tailwind's `md`
// breakpoint (768px). matchMedia uses max-width 767px so it flips exactly where
// the `md:` utility classes do.
const QUERY = "(max-width: 767px)";

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

/**
 * True on Android (mobile webview, regardless of viewport) OR when the viewport
 * is below the `md` (768px) breakpoint. Reactive — re-renders on resize /
 * rotation via `matchMedia`. Used to hide desktop-only affordances such as the
 * `steam://` "Steam Desktop" button. `isAndroid()` is a stable userAgent check,
 * so it's OR-ed in without a subscription.
 */
export function useIsMobile(): boolean {
  const narrow = useSyncExternalStore(subscribe, getSnapshot, () => false);
  return narrow || isAndroid();
}
