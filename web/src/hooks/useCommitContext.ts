/**
 * Derives the right { author, signer } pair for a commit, based on current
 * auth + GPG state.
 *
 *   Unlocked GPG → author = key's primary user ID, signer = OpenPGP detached
 *                  → "Verified" badge on GitHub.
 *   Plain auth   → author = GitHub user's email (or noreply fallback),
 *                  no signer → unsigned (but author shows correctly).
 */
import { useAuth } from "../stores/auth";
import { useGpg } from "../stores/gpg";
import { signCommitContent } from "../lib/gpg";
import type { CommitAuthor, CommitSigner } from "../lib/edits";

export interface CommitContext {
  author: CommitAuthor;
  signer?: CommitSigner;
  /** Whether this commit will be GPG-signed by us. */
  willSign: boolean;
}

export function useCommitContext(): CommitContext | null {
  const auth = useAuth();
  const unlocked = useGpg((s) => s.unlocked);

  if (!auth.isAuthenticated || !auth.user) return null;

  if (unlocked) {
    const parsed = unlocked.parsed;
    if (!parsed.primaryEmail) {
      // Key has no email userID → fall back to plain mode rather than failing.
      return plainContext(auth.user);
    }
    return {
      author: { name: parsed.primaryName || auth.user.login, email: parsed.primaryEmail },
      signer: (content) => signCommitContent(unlocked, content),
      willSign: true,
    };
  }

  return plainContext(auth.user);
}

function plainContext(user: {
  login: string;
  name: string | null;
}): CommitContext {
  return {
    author: {
      name: user.name ?? user.login,
      email: `${user.login}@users.noreply.github.com`,
    },
    willSign: false,
  };
}
