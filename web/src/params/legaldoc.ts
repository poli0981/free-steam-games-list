import type { ParamMatcher } from "@sveltejs/kit";
import { isLegalDocSlug } from "$lib/legal";

/**
 * /legal/<slug> matches only a real document.
 *
 * Without it, /legal/nope was answered by the host's fallback (the prerendered
 * dashboard) and hydrated as the doc route with no data. Unmatched, it lands in
 * the layout's `page.route.id === null` branch and shows the translated 404.
 */
export const match: ParamMatcher = (param) => isLegalDocSlug(param);
