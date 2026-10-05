/**
 * `{@attach imgFallback(url)}` - when an <img> fails to load, swap its src to
 * `url`, once.
 *
 * lib/image.ts points thumbnails and the hero at the minted AVIF on the media
 * host. That load fails in exactly two ways, and both fire `error`: the AVIF
 * is not minted yet (the bucket answers 404 - a new game, or the backfill
 * still running), or the browser cannot decode AVIF. Either way the Worker's
 * /img route has the right answer, Steam's JPEG.
 *
 * An ATTACHMENT, never an action. On a prerendered <img>, `use:` (like an
 * onload/onerror handler) makes Svelte write `onload="this.__e=event"` and
 * `onerror="this.__e=event"` into the HTML, so it can replay an event that
 * fired before hydration - and kit.csp, a hash policy, refuses inline event
 * handlers: a CSP violation on every game page. verify-dist.mjs fails the
 * build if one appears. The replay is not needed anyway: a load that already
 * failed is `complete` with no `naturalWidth` by the time this runs.
 *
 * One swap per attachment: if the fallback fails too, the image stays broken
 * rather than looping. A new url (a reused table row) is a new attachment.
 */
interface FallbackTarget {
  src: string;
  complete: boolean;
  naturalWidth: number;
  getAttribute(name: string): string | null;
  addEventListener(type: "error", listener: () => void): void;
  removeEventListener(type: "error", listener: () => void): void;
}

export function imgFallback(url: string | null | undefined) {
  return (node: FallbackTarget) => {
    if (!url) return;
    let swapped = false;
    const swap = () => {
      if (swapped) return;
      swapped = true;
      node.src = url;
    };
    node.addEventListener("error", swap);
    if (node.complete && node.naturalWidth === 0 && node.getAttribute("src")) swap();
    return () => node.removeEventListener("error", swap);
  };
}
