"""
The backfill buckets each search row by its release date as the store search
writes it (asked with l=english, so the month names are English).

Run from the repository root:  python -m pytest scripts/tests
"""
import pytest

from backfill_discover import parse_released


@pytest.mark.parametrize("text, expected", [
    ("21 Aug, 2012", (2012, 8)),
    ("Aug 21, 2012", (2012, 8)),
    ("Sep 2024", (2024, 9)),
    # A year alone sorts with the year's start.
    ("2025", (2025, 1)),
    # Not dates: kept out of every window.
    ("Xyz 2024", None),
    ("Q1 2026", None),
    ("Coming soon", None),
    ("", None),
    (None, None),
])
def test_release_rows_are_bucketed_by_year_and_month(text, expected):
    assert parse_released(text) == expected
