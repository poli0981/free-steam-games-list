"""
refetch_all.py clears what Steam can give back and keeps what a person
decided. Run from the repository root:  python -m pytest scripts/tests
"""
import refetch_all


def test_clear_fetchable_resets_a_default_to_the_skeleton_s_value():
    # "-" used to become "", a value nothing else writes, which the old VAC
    # detection then checked against only one category.
    game = {"anti_cheat": "-", "anti_cheat_note": "", "is_kernel_ac": None, "genre": "Uncategorized"}
    refetch_all.clear_fetchable(game)
    assert (game["anti_cheat"], game["anti_cheat_note"], game["is_kernel_ac"]) == ("-", "", None)
    assert game["genre"] == ""


def test_clear_fetchable_keeps_a_decision():
    game = {"anti_cheat": "BattlEye", "anti_cheat_note": "BattlEye [Kernel]", "is_kernel_ac": True, "genre": "FPS"}
    refetch_all.clear_fetchable(game)
    assert (game["anti_cheat"], game["anti_cheat_note"], game["is_kernel_ac"], game["genre"]) == \
        ("BattlEye", "BattlEye [Kernel]", True, "FPS")
