import { Outlet, useLocation } from "react-router-dom";
import { Suspense, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sidebar, MobileSidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { CommandPalette } from "../common/CommandPalette";
import { BackToTop } from "../common/BackToTop";
import { ErrorBoundary } from "../common/ErrorBoundary";
import { LoadingState } from "../common/QueryState";
import { ErrorPage } from "../../pages/errors/ErrorPage";
import { isChunkLoadError } from "../../lib/lazy";
import { useGpgAutolock } from "../../hooks/useGpgAutolock";

export function Layout() {
  useGpgAutolock();
  const { t } = useTranslation();
  const location = useLocation();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenuToggle={() => setMobileNavOpen(true)} />
        <main ref={mainRef} className="flex-1 overflow-y-auto">
          <div className="container max-w-screen-2xl py-6">
            {/*
              Boundary + Suspense live INSIDE the layout so the sidebar/topbar
              stay mounted during lazy-route loads and page crashes. resetKey
              clears a stuck error when the user navigates away. A chunk-load
              error landing here means lazyWithRetry already burned its one
              auto-reload — show the "new deploy, reload" copy.
            */}
            <ErrorBoundary
              resetKey={location.pathname}
              fallback={(err) =>
                isChunkLoadError(err) ? (
                  <ErrorPage code="503" detail={t("errors.boundary.chunkDescription")} />
                ) : (
                  <ErrorPage
                    code="500"
                    detail={import.meta.env.DEV ? err.message : undefined}
                  />
                )
              }
            >
              <Suspense fallback={<LoadingState />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </div>
        </main>
      </div>
      <MobileSidebar open={mobileNavOpen} onOpenChange={setMobileNavOpen} />
      <BackToTop scrollRef={mainRef} />
      <CommandPalette />
    </div>
  );
}
