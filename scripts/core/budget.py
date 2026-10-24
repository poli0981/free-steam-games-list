"""
How long a data job may keep starting work, so that a catalogue which outgrows
its schedule makes a run partial instead of making it fail.

A GitHub-hosted job is stopped at its timeout-minutes (six hours at most), and
a stopped job commits nothing: Update Reviews ran for exactly six hours on
2026-10-23 and threw away every review it had read. Each data workflow sets
JOB_BUDGET_MINUTES at least twenty minutes below its timeout. A loop that
reaches the budget starts no further game, the script saves what it did, and
the job commits it. The games it did not reach keep their values until the
next run, and since the loops visit their games in an order that changes daily
(core/rotation.daily_order) the next cut falls elsewhere.

A loop that ran out, or used more than three quarters of the budget, says so
with a ::warning:: annotation on the run: the sign that the catalogue is
outgrowing the job comes before any run is lost.

JOB_BUDGET_MINUTES unset, empty, zero or not a number means no deadline, so a
run on a laptop works as it always did.
"""
import math
import os
import time
from typing import Optional

ENV = "JOB_BUDGET_MINUTES"
WARN_SHARE = 0.75


class Deadline:
    """A budget of minutes counted from when it was made: from the start of
    the script, so loading and saving the catalogue count too."""
    __slots__ = ("start", "seconds")

    def __init__(self, minutes: float, now: Optional[float] = None):
        self.start = time.monotonic() if now is None else now
        self.seconds = minutes * 60

    @classmethod
    def from_env(cls) -> Optional["Deadline"]:
        try:
            minutes = float(os.environ.get(ENV, "").strip())
        except ValueError:
            return None
        if not math.isfinite(minutes) or minutes <= 0:
            return None
        return cls(minutes)

    @property
    def minutes(self) -> float:
        return self.seconds / 60

    def used(self) -> float:
        """The share of the budget spent so far, 0.0 to 1.0 and beyond."""
        return (time.monotonic() - self.start) / self.seconds

    def expired(self) -> bool:
        return self.used() >= 1.0


def expired(deadline: Optional[Deadline]) -> bool:
    return deadline is not None and deadline.expired()


def report(desc: str, done: int, total: int, deadline: Optional[Deadline], log=print) -> None:
    """One line on how a loop used the budget. A run that stopped short, or
    came close, gets a ::warning:: - it is how a growing catalogue shows up in
    the run's annotations before it costs one."""
    if deadline is None:
        return
    spent = deadline.used() * deadline.minutes
    if done < total:
        log(f"::warning::{desc}: stopped after {done} of {total} when the job's "
            f"{deadline.minutes:.0f}-minute budget ran out; the other {total - done} keep "
            f"their values until the next run.")
    elif deadline.used() > WARN_SHARE:
        log(f"::warning::{desc}: {done} done in {spent:.0f} of the job's {deadline.minutes:.0f} "
            f"budgeted minutes ({deadline.used():.0%}). The catalogue is outgrowing this "
            f"schedule: give the job a longer cycle or a larger budget.")
    else:
        log(f"{desc}: {done} done in {spent:.0f} of {deadline.minutes:.0f} budgeted minutes.")
