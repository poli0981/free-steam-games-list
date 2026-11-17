"""
mark_dead_games.py compares player counts, which the dataset stores as
formatted strings ("492,197"), never as numbers (CLAUDE.md).

Run from the repository root:  python -m pytest scripts/tests
"""
import pytest

from mark_dead_games import parse_players


@pytest.mark.parametrize("stored, players", [
    ("492,197", 492197),
    ("0", 0),
    (12, 12),
    (3.0, 3),
    (None, 0),
    ("N/A", 0),
    ("", 0),
])
def test_players_are_read_from_the_stored_string(stored, players):
    assert parse_players(stored) == players
