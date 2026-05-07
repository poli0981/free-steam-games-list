import { Outlet } from "react-router-dom";
import { useState } from "react";
import { Sidebar, MobileSidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { CommandPalette } from "../common/CommandPalette";
import { useGpgAutolock } from "../../hooks/useGpgAutolock";

export function Layout() {
  useGpgAutolock();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenuToggle={() => setMobileNavOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <div className="container max-w-screen-2xl py-6">
            <Outlet />
          </div>
        </main>
      </div>
      <MobileSidebar open={mobileNavOpen} onOpenChange={setMobileNavOpen} />
      <CommandPalette />
    </div>
  );
}
