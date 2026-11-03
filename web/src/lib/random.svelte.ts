/**
 * The picks /random shows, kept for the session.
 *
 * Module-level, like filters.svelte.ts, so opening a game and coming Back
 * shows the same games rather than a new roll. Memory only, on purpose: the
 * Privacy Policy lists every key the app stores, and editing it changes the
 * document's hash, which asks every reader to accept the terms again. A reload
 * rolls anew, which is what reloading a random page should do anyway.
 *
 * The picks are appids, resolved against whichever catalogue is current, so a
 * revalidation that brings new data never re-rolls: it only drops a pick that
 * left the catalogue or no longer qualifies. Nothing tops a dropped pick back
 * up - that would be a roll the reader did not ask for.
 */
import {
  MAX_PICKS,
  buildPool,
  clampCount,
  isEligible,
  samplePicks,
  type Catalogue,
  type PoolOptions,
  type RandomSource,
  type TypeChoice,
} from "./random-pick";
import type { GameRecord } from "./schema";

export interface ShownPick {
  appid: string;
  record: GameRecord;
}

export class RandomPicks {
  count = $state(MAX_PICKS);
  type = $state<TypeChoice>("any");
  includeDead = $state(false);
  /** In display order. Replaced whole, never mutated. */
  appids = $state.raw<readonly string[]>([]);

  #rolled = false;
  readonly #next: RandomSource | undefined;

  /** `next` replaces the crypto source, for tests only. */
  constructor(next?: RandomSource) {
    this.#next = next;
  }

  get options(): PoolOptions {
    return { type: this.type, includeDead: this.includeDead };
  }

  /** The picks still in `data` that still qualify, in order. Deterministic,
   *  so it is safe inside a $derived. */
  resolve(data: Catalogue): ShownPick[] {
    const opts = this.options;
    const out: ShownPick[] = [];
    const seen = new Set<string>();
    for (const appid of this.appids) {
      const i = data.appidIndex.get(appid);
      const record = i === undefined ? undefined : data.records[i];
      if (!record || seen.has(appid) || !isEligible(record, opts)) continue;
      seen.add(appid);
      out.push({ appid, record });
    }
    return out;
  }

  /** The first roll, once the catalogue is here; a no-op ever after. */
  rollOnce(data: Catalogue): void {
    if (!this.#rolled) this.roll(data);
  }

  /** A new set, avoiding the games on screen while enough others remain. */
  roll(data: Catalogue): void {
    const shown = new Set(this.resolve(data).map((p) => p.appid));
    this.appids = samplePicks(buildPool(data, this.options), this.count, { avoid: shown, next: this.#next });
    this.#rolled = true;
  }

  /** Fewer keeps the first ones; more adds new games beside the ones shown.
   *  Without a catalogue yet it only records the choice for the first roll. */
  setCount(n: number, data?: Catalogue): void {
    this.count = clampCount(n);
    if (!data) return;
    const kept = this.resolve(data)
      .slice(0, this.count)
      .map((p) => p.appid);
    const missing = this.count - kept.length;
    this.appids =
      missing > 0
        ? [...kept, ...samplePicks(buildPool(data, this.options), missing, { exclude: new Set(kept), next: this.#next })]
        : kept;
    this.#rolled = true;
  }

  /** A different type changes which games qualify, so it rolls again. */
  setType(type: TypeChoice, data?: Catalogue): void {
    this.type = type;
    if (data) this.roll(data);
  }

  /** As setType: the pool changes, so the picks do too. */
  setIncludeDead(on: boolean, data?: Catalogue): void {
    this.includeDead = on;
    if (data) this.roll(data);
  }
}

export const randomPicks = new RandomPicks();
