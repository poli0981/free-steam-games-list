/**
 * Auto-lock the unlocked GPG key after N minutes of user inactivity.
 *
 * "Activity" = mousemove / keydown / pointerdown / scroll / focus /
 * visibilitychange (page becoming visible). We do not lock on visibility=hidden
 * since the user may be briefly switching tabs; we just stop counting and
 * resume on visible.
 *
 * If autolockMinutes is 0, we skip everything.
 */
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useGpg } from "../stores/gpg";

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  "mousemove",
  "keydown",
  "pointerdown",
  "scroll",
  "focus",
  "touchstart",
];

export function useGpgAutolock() {
  const unlocked = useGpg((s) => s.unlocked);
  const minutes = useGpg((s) => s.autolockMinutes);
  const lock = useGpg((s) => s.lock);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!unlocked || minutes <= 0) return;

    const ms = minutes * 60_000;
    const reset = () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        lock();
        toast.info("GPG locked", {
          description: `Idle for ${minutes} minutes — unlock again to sign commits.`,
        });
      }, ms);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") reset();
    };

    reset();
    for (const ev of ACTIVITY_EVENTS)
      window.addEventListener(ev, reset, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      for (const ev of ACTIVITY_EVENTS) window.removeEventListener(ev, reset);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [unlocked, minutes, lock]);
}
