import { describe, expect, it } from "vitest";
import { imgFallback } from "./img-fallback";

/**
 * The fallback is what keeps a not-yet-minted AVIF (a 404 from the media host)
 * or a browser without AVIF from showing a broken image. It must fire for an
 * error that happened before hydration, and it must never loop.
 */

class FakeImg {
  complete = false;
  naturalWidth = 0;
  /** Every src the attachment assigned, in order. */
  assigned: string[] = [];
  private attrs = new Map<string, string>();
  private listeners = new Set<() => void>();

  constructor(src: string) {
    this.attrs.set("src", src);
  }
  get src(): string {
    return this.attrs.get("src") ?? "";
  }
  set src(value: string) {
    this.assigned.push(value);
    this.attrs.set("src", value);
  }
  /** What Svelte does when the bound expression changes: set the attribute. */
  setAttribute(name: string, value: string) {
    this.attrs.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  addEventListener(_type: "error", listener: () => void) {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "error", listener: () => void) {
    this.listeners.delete(listener);
  }
  fail() {
    this.complete = true;
    this.naturalWidth = 0;
    for (const l of [...this.listeners]) l();
  }
  get listening(): number {
    return this.listeners.size;
  }
}

const AVIF = "https://media.free-steam-games.win/img/v2/230q55/730/header@1.avif";
const JPEG = "/img/s/730/header.jpg?t=1";

describe("imgFallback", () => {
  it("swaps to the fallback when the image fails", () => {
    const img = new FakeImg(AVIF);
    imgFallback(JPEG)(img);
    expect(img.src).toBe(AVIF);
    img.fail();
    expect(img.src).toBe(JPEG);
  });

  it("swaps once: a failing fallback stays broken instead of looping", () => {
    const img = new FakeImg(AVIF);
    imgFallback(JPEG)(img);
    img.fail();
    img.fail();
    img.fail();
    expect(img.assigned).toEqual([JPEG]);
  });

  it("recovers an image that had already failed before it was attached (prerendered, pre-hydration)", () => {
    const img = new FakeImg(AVIF);
    img.complete = true;
    img.naturalWidth = 0;
    imgFallback(JPEG)(img);
    expect(img.assigned).toEqual([JPEG]);
  });

  it("leaves an image that already loaded alone", () => {
    const img = new FakeImg(AVIF);
    img.complete = true;
    img.naturalWidth = 230;
    imgFallback(JPEG)(img);
    expect(img.assigned).toEqual([]);
  });

  it("leaves an image that is still loading alone until it actually fails", () => {
    const img = new FakeImg(AVIF);
    imgFallback(JPEG)(img);
    expect(img.assigned).toEqual([]);
  });

  it("does nothing without a fallback (Tauri, or a URL that is not Steam's)", () => {
    const img = new FakeImg(AVIF);
    expect(imgFallback(null)(img)).toBeUndefined();
    img.fail();
    expect(img.assigned).toEqual([]);
    expect(img.listening).toBe(0);
  });

  it("starts over for a new image: Svelte replaces the attachment when its url changes (a reused row)", () => {
    const img = new FakeImg(AVIF);
    const detach = imgFallback(JPEG)(img);
    img.fail();
    expect(img.src).toBe(JPEG);

    detach?.();
    img.setAttribute("src", "https://media.free-steam-games.win/img/v2/230q55/570/header@2.avif");
    img.complete = false;
    imgFallback("/img/s/570/header.jpg?t=2")(img);
    img.fail();
    expect(img.assigned).toEqual([JPEG, "/img/s/570/header.jpg?t=2"]);
  });

  it("stops listening when it is detached", () => {
    const img = new FakeImg(AVIF);
    const detach = imgFallback(JPEG)(img);
    expect(img.listening).toBe(1);
    detach?.();
    expect(img.listening).toBe(0);
  });
});
