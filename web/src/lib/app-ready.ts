/**
 * Whether the reader is past both first-run gates: the terms accepted
 * (consent.svelte.ts) and the Turnstile human check passed, waived or not
 * applicable (human-check-state.svelte.ts - always the last once the packaged
 * apps have hydrated).
 *
 * Every network cost the app imposes waits for this: the root layout's
 * catalogue, service worker and analytics, and every Resource, through its
 * `enabled` option - including the pages that fetch data of their own
 * (/activity, /charts/delisted), which used to load before consent.
 * resource.test.ts fails on a Resource constructed without it.
 *
 * It is a plain function over rune state, so calling it inside an $effect
 * subscribes that effect: a load held back here starts by itself the moment
 * the reader passes the gates.
 */
import { consent } from "./consent.svelte";
import { humanCheck } from "./human-check-state.svelte";

export function appReady(): boolean {
  return consent.accepted && humanCheck.cleared;
}
