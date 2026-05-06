/**
 * Derives the right { author, signer } pair for a commit, based on current
 * auth + GPG state.
 *
 *   Unlocked GPG → author = key's selected user ID (preferredUidIndex),
 *                  signer = OpenPGP detached → "Verified" badge on GitHub.
 *   Plain auth   → author = GitHub user's noreply email,
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

function parseUid(uid: string): { name: string; email: string } {
  const m = uid.match(/^\s*(.*?)\s*<\s*(.+?)\s*>\s*$/);
  if (!m) return { name: uid.trim(), email: "" };
  return { name: m[1].trim(), email: m[2].trim() };
}

export function useCommitContext(): CommitContext | null {
  const auth = useAuth();
  const unlocked = useGpg((s) => s.unlocked);
  const preferredUidIndex = useGpg((s) => s.preferredUidIndex);

  if (!auth.isAuthenticated || !auth.user) return null;

  if (unlocked) {
    const parsed = unlocked.parsed;
    const uids = parsed.userIds ?? [];
    const idx = Math.min(preferredUidIndex, Math.max(0, uids.length - 1));
    const chosenUid = uids[idx] ?? "";
    const parts = parseUid(chosenUid);
    const email = parts.email || parsed.primaryEmail;
    if (!email) {
      // Selected UID has no email → fall back to plain (unsigned) rather than
      // ship a commit GitHub will mark "bad_email".
      return plainContext(auth.user);
    }
    return {
      author: { name: parts.name || auth.user.login, email },
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
