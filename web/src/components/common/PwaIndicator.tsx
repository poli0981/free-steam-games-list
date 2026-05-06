import { useEffect, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { toast } from "sonner";
import { Download, RotateCw, WifiOff } from "lucide-react";
import { Button } from "../ui/button";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function PwaIndicator() {
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
      toast.success("Installed", {
        description: "F2P Tracker is now available as a standalone app.",
      });
    }
    function onOnline() {
      setOffline(false);
      toast.success("Back online");
    }
    function onOffline() {
      setOffline(true);
      toast.warning("Offline — using cached data");
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
  }, []);

  useEffect(() => {
    if (needRefresh) {
      toast.info("Update available", {
        description: "A new version of the app is ready.",
        duration: Infinity,
        action: {
          label: "Reload",
          onClick: () => {
            void updateServiceWorker(true);
            setNeedRefresh(false);
          },
        },
      });
    }
  }, [needRefresh, setNeedRefresh, updateServiceWorker]);

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
          title="No network — reads served from cache"
        >
          <WifiOff className="h-3 w-3" /> offline
        </span>
      )}
      {installEvent && (
        <Button variant="outline" size="sm" onClick={install} title="Install as app">
          <Download className="mr-1 h-3 w-3" /> Install
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
          title="A new version is ready — click to reload"
        >
          <RotateCw className="mr-1 h-3 w-3" /> Update
        </Button>
      )}
    </div>
  );
}
