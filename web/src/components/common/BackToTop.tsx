import { useEffect, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp } from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

interface Props {
  /** Ref to the scroll container — listens for scrollTop changes on it. */
  scrollRef: RefObject<HTMLElement>;
  /** Pixel threshold before the button fades in. */
  threshold?: number;
}

// Floating back-to-top button anchored bottom-right of the viewport.
// Only mounts the scroll listener when scrollRef.current exists; opacity
// toggles via Tailwind transition so we don't unmount+remount on every
// scroll tick.
export function BackToTop({ scrollRef, threshold = 400 }: Props) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => setVisible(el.scrollTop > threshold);
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [scrollRef, threshold]);

  return (
    <Button
      size="icon"
      onClick={() =>
        scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" })
      }
      aria-label={t("common.backToTop")}
      title={t("common.backToTop")}
      className={cn(
        "fixed bottom-4 right-4 z-30 h-10 w-10 rounded-full shadow-lg transition-opacity duration-200",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      <ArrowUp className="h-4 w-4" />
    </Button>
  );
}
