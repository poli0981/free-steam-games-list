/**
 * Gate edit/add/delete UI to the repo owner. Read-only browse stays open
 * to all visitors. Random visitors signed in with their own PATs would also
 * fail the server-side push permission check, but hiding the UI keeps the
 * experience clear for them.
 */
import { useAuth } from "../stores/auth";
import { OWNER_LOGIN } from "../lib/schema";

export function useIsOwner(): boolean {
  const user = useAuth((s) => s.user);
  const permission = useAuth((s) => s.permission);
  if (!user) return false;
  if (user.login === OWNER_LOGIN) return true;
  // Fallback: any account that the GitHub API confirmed has push access.
  return permission === "admin" || permission === "write";
}
