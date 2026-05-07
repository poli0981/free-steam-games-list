import { useState } from "react";
import { Lock, Unlock, AlertCircle, Settings as SettingsIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { useGpg } from "../../stores/gpg";

/**
 * Topbar chip → click → popover with passphrase input → unlock without
 * round-tripping to Settings. Shows the saved key's primary user ID for
 * confirmation. Only visible when a key is saved + currently locked.
 */
export function GpgQuickUnlock() {
  const { t } = useTranslation();
  const parsed = useGpg((s) => s.parsed);
  const isVerifying = useGpg((s) => s.isVerifying);
  const error = useGpg((s) => s.error);
  const unlock = useGpg((s) => s.unlock);
  const [passphrase, setPassphrase] = useState("");
  const [open, setOpen] = useState(false);

  if (!parsed) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!passphrase) return;
    try {
      await unlock(passphrase);
      setPassphrase("");
      setOpen(false);
    } catch {
      /* error in store */
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={t("system.gpgLockedTooltip", { id: parsed.primaryEmail || parsed.keyId })}
          className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-300 hover:bg-amber-500/15"
        >
          <Lock className="h-3 w-3" />
          <span>{t("topbar.locked")}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80">
        <form onSubmit={submit} className="space-y-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("system.gpgUnlockTitle")}
            </div>
            <div className="mt-1 truncate text-sm" title={parsed.userIds.join(" · ")}>
              {parsed.primaryName}
              {parsed.primaryEmail && (
                <span className="text-muted-foreground"> &lt;{parsed.primaryEmail}&gt;</span>
              )}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
              {parsed.fingerprint.match(/.{1,4}/g)?.slice(0, 5).join(" ")} …
            </div>
          </div>

          <Input
            type="password"
            placeholder={t("system.gpgPassphrasePlaceholder")}
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            disabled={isVerifying}
            autoFocus
            autoComplete="current-password"
          />

          {error && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <Link
              to="/settings"
              onClick={() => setOpen(false)}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <SettingsIcon className="h-3 w-3" /> {t("system.gpgSettingsLink")}
            </Link>
            <Button type="submit" size="sm" disabled={!passphrase || isVerifying}>
              <Unlock className="mr-1 h-3 w-3" />
              {isVerifying ? t("system.gpgUnlocking") : t("system.gpgUnlock")}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}
