import { Outlet } from "react-router-dom";
import { useRef, useState } from "react";
import { Sidebar, MobileSidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { CommandPalette } from "../common/CommandPalette";
import { BackToTop } from "../common/BackToTop";
import { useGpgAutolock } from "../../hooks/useGpgAutolock";

export function Layout() {
  useGpgAutolock();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenuToggle={() => setMobileNavOpen(true)} />
        <main ref={mainRef} className="flex-1 overflow-y-auto">
          <div className="container max-w-screen-2xl py-6">
            <Outlet />
          </div>
        </main>
      </div>
      <MobileSidebar open={mobileNavOpen} onOpenChange={setMobileNavOpen} />
      <BackToTop scrollRef={mainRef} />
      <CommandPalette />
    </div>
  );
}
