import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Download, RotateCw, WifiOff } from "lucide-react";
import { Button } from "../ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaIndicator() {
  const { t } = useTranslation();
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegistered() {
      /* console.log("[PWA] SW registered") */
    },
    onRegisterError(err: unknown) {
      console.warn("[PWA] SW registration error:", err);
    },
  });

  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    function onBefore(e: Event) {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setInstallEvent(null);
      toast.success(t("pwa.installed"), {
        description: t("pwa.installedBody"),
      });
    }
    function onOnline() {
      setOffline(false);
      toast.success(t("pwa.backOnline"));
    }
    function onOffline() {
      setOffline(true);
      toast.warning(t("pwa.wentOffline"));
    }
    window.addEventListener("beforeinstallprompt", onBefore);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBefore);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [t]);

  useEffect(() => {
    if (needRefresh) {
      toast.info(t("pwa.updateAvailable"), {
        description: t("pwa.updateBody"),
        duration: Infinity,
        action: {
          label: t("pwa.reload"),
          onClick: () => {
            void updateServiceWorker(true);
            setNeedRefresh(false);
          },
        },
      });
    }
  }, [needRefresh, setNeedRefresh, updateServiceWorker, t]);

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  }

  return (
    <div className="hidden items-center gap-1 md:flex">
      {offline && (
        <span
          className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-300"
          title={t("system.noNetworkTooltip")}
        >
          <WifiOff className="h-3 w-3" /> {t("pwa.offline")}
        </span>
      )}
      {installEvent && (
        <Button variant="outline" size="sm" onClick={install} title={t("system.installAsApp")}>
          <Download className="mr-1 h-3 w-3" /> {t("pwa.install")}
        </Button>
      )}
      {needRefresh && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void updateServiceWorker(true);
            setNeedRefresh(false);
          }}
          title={t("system.updateReadyTooltip")}
        >
          <RotateCw className="mr-1 h-3 w-3" /> {t("pwa.update")}
        </Button>
      )}
    </div>
  );
}
