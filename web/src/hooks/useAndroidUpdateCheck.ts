// Once-per-session check (Android only) for a newer APK on GitHub Releases.
// Shows a persistent toast with a download action. No-op off Android/Tauri;
// desktop relies on the native Tauri updater, web/PWA on the service worker.

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { isTauri, isAndroid, openExternal } from "../lib/external-open";
import { checkAndroidUpdate } from "../lib/android-update";

export function useAndroidUpdateCheck() {
  const { t } = useTranslation();
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    if (!isTauri() || !isAndroid()) return;
    ran.current = true;

    let cancelled = false;
    void checkAndroidUpdate()
      .then((upd) => {
        if (cancelled || !upd) return;
        toast.info(t("appUpdate.available", { version: upd.version }), {
          description: t("appUpdate.body"),
          duration: Infinity,
          action: {
            label: t("appUpdate.download"),
            onClick: () => void openExternal(upd.url),
          },
        });
      })
      .catch(() => {
        /* network / rate-limit — silent, it's a best-effort nicety */
      });

    return () => {
      cancelled = true;
    };
  }, [t]);
}
