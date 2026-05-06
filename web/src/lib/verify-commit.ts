/**
 * Poll a commit's verification status after we push it. GitHub recomputes
 * `verification` asynchronously; right after the create-commit response it's
 * usually still null/unverified, even when the signature is valid.
 *
 * We poll up to a few times with a small backoff and resolve as soon as
 * verified flips to true (or we exhaust retries — caller treats that as
 * "still unverified, surface the reason").
 */
import { REPO_OWNER, REPO_NAME } from "./schema";

export interface VerifyStatus {
  verified: boolean;
  reason: string;
}

export async function pollCommitVerification(
  sha: string,
  token: string | null,
  attempts = 4,
  delayMs = 800,
): Promise<VerifyStatus> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let last: VerifyStatus = { verified: false, reason: "unknown" };
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    try {
      const res = await fetch(
        `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits/${sha}`,
        { headers },
      );
      if (!res.ok) continue;
      const data = await res.json();
      const v = data?.commit?.verification;
      if (v) {
        last = { verified: !!v.verified, reason: v.reason ?? "unknown" };
        if (last.verified) return last;
      }
    } catch {
      /* keep retrying */
    }
  }
  return last;
}
