import { useTranslation } from "react-i18next";
import { FileText, Code } from "lucide-react";
import type { View } from "./types";

export function ViewToggle({
  view,
  setView,
}: {
  view: View;
  setView: (v: View) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="inline-flex rounded-md border p-0.5 text-xs">
      <button
        type="button"
        onClick={() => setView("form")}
        className={
          "flex items-center gap-1 rounded px-2 py-0.5 " +
          (view === "form"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground")
        }
      >
        <FileText className="h-3 w-3" /> {t("edit.viewForm")}
      </button>
      <button
        type="button"
        onClick={() => setView("json")}
        className={
          "flex items-center gap-1 rounded px-2 py-0.5 " +
          (view === "json"
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground")
        }
      >
        <Code className="h-3 w-3" /> {t("edit.viewJson")}
      </button>
    </div>
  );
}
