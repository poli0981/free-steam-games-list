import { useEffect } from "react";
import { useTranslation } from "react-i18next";

const SITE_NAME = "Steam F2P Tracker";

/**
 * Sets `document.title` to `<page> · <SITE_NAME>` on mount, restores on unmount.
 *
 * Pass either an i18n key (resolves via `t()`) or a literal string. The hook
 * re-runs when the resolved title changes — switching language updates the
 * tab title automatically.
 */
export function useDocumentTitle(titleOrKey: string, opts?: { isKey?: boolean }) {
  const { t, i18n } = useTranslation();
  const isKey = opts?.isKey ?? true;
  const resolved = isKey ? t(titleOrKey) : titleOrKey;

  useEffect(() => {
    const previous = document.title;
    document.title = resolved ? `${resolved} · ${SITE_NAME}` : SITE_NAME;
    return () => {
      document.title = previous;
    };
    // i18n.language is in the deps because t() output changes with language.
  }, [resolved, i18n.language]);
}
