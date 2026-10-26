/**
 * Client hooks.
 *
 * One job: a deploy that lands mid-session deletes the hashed chunks the open
 * tab still references. Loading one of them does not 404 on either host - both
 * answer with index.html at HTTP 200 - so it fails as a MIME-type error that
 * looks nothing like a network problem. chunk-error.ts recognises that shape;
 * this reloads once to pick up the new build instead of showing an error page
 * for an app that is not actually broken.
 */
import type { HandleClientError } from "@sveltejs/kit/hooks";
import { isChunkLoadError, reloadOnceForStaleChunk } from "#lib/chunk-error.js";

export const handleError: HandleClientError = ({ error }) => {
  if (isChunkLoadError(error) && reloadOnceForStaleChunk()) {
    return { message: "Reloading to pick up the latest version" };
  }
  // Returning nothing keeps SvelteKit's own status and safe message.
};
