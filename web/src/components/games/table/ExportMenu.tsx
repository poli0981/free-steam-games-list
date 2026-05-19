import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileJson, FileSpreadsheet } from "lucide-react";
import { Button } from "../../ui/button";
import { exportCsv, exportJson } from "../../../lib/export";
import type { GameRecord } from "../../../lib/schema";

export function ExportMenu({ records }: { records: GameRecord[] }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ts = new Date().toISOString().slice(0, 10);
  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => setOpen((o) => !o)}
        title={t("games.exportTitle", { count: records.length })}
      >
        <Download className="mr-1 h-3 w-3" />
        {t("games.exportLabel")}
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-md border bg-card p-1 shadow-lg">
            <button
              type="button"
              onClick={() => {
                exportCsv(records, `f2p-games-${ts}.csv`);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
            >
              <FileSpreadsheet className="h-3 w-3" /> CSV
              <span className="ml-auto text-muted-foreground">
                {t("games.exportRowsCount", { count: records.length })}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                exportJson(records, `f2p-games-${ts}.json`);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent"
            >
              <FileJson className="h-3 w-3" /> JSON
              <span className="ml-auto text-muted-foreground">
                {t("games.exportRowsCount", { count: records.length })}
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}
