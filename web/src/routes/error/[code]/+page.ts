import { ERROR_CODES } from "$lib/common/ErrorView.svelte";
import type { EntryGenerator } from "./$types";

/** Prerender one page per known code, so /error/503 is a real static document
 *  rather than something only the SPA fallback can produce. */
export const entries: EntryGenerator = () => ERROR_CODES.map((code) => ({ code }));
export const prerender = true;
