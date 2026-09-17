"""
data/index.json is the client's cache contract. These pin the two halves of it:

- files[].sha256 describes the exact committed bytes of each shard, and
- last_updated changes if and only if something a client downloads changed.

Run from the repository root:  python -m pytest scripts/tests
"""
import hashlib
import json
import os

import pytest

from core import data_store
from core.constants import MAX_RECORDS_PER_FILE


def _records(n: int, tag: str = "a") -> list[dict]:
    return [
        {
            "link": f"https://store.steampowered.com/app/{100000 + i}/",
            "name": f"Game {i} {tag} – ünïcode",
            "description": "",
            "genre": "Action",
        }
        for i in range(n)
    ]


@pytest.fixture
def workdir(tmp_path, monkeypatch):
    """A scratch repository root: DATA_DIR is the relative path "data"."""
    monkeypatch.chdir(tmp_path)
    os.makedirs("data")
    stamps = iter(f"2026-01-01T00:00:{s:02d}Z" for s in range(60))
    monkeypatch.setattr(data_store, "now_iso", lambda: next(stamps))
    return tmp_path


def _index() -> dict:
    with open(os.path.join("data", "index.json"), encoding="utf-8") as f:
        return json.load(f)


def _save(records: list[dict]) -> dict:
    data_store.save_main(records, apply_human_overrides=False)
    return _index()


def test_each_hash_is_the_sha256_of_the_file_bytes(workdir):
    index = _save(_records(MAX_RECORDS_PER_FILE + 5))
    assert [f["name"] for f in index["files"]] == ["data_001.jsonl", "data_002.jsonl"]
    for entry in index["files"]:
        raw = open(os.path.join("data", entry["name"]), "rb").read()
        assert entry["sha256"] == hashlib.sha256(raw).hexdigest()
        # The committed blob is LF (.gitattributes eol=lf). A CRLF file on disk
        # would hash to bytes no client ever downloads.
        assert b"\r\n" not in raw


def test_an_identical_save_keeps_last_updated(workdir):
    first = _save(_records(10))
    before = open(os.path.join("data", "index.json"), "rb").read()
    second = _save(_records(10))
    assert second["last_updated"] == first["last_updated"]
    # Byte-identical, so a run that changed nothing produces no commit.
    assert open(os.path.join("data", "index.json"), "rb").read() == before


def test_one_changed_record_bumps_and_changes_exactly_one_hash(workdir):
    records = _records(MAX_RECORDS_PER_FILE * 2 + 1)
    first = _save(records)
    records[0]["name"] = "Renamed"
    second = _save(records)
    assert second["last_updated"] != first["last_updated"]
    changed = [
        a["name"]
        for a, b in zip(first["files"], second["files"])
        if a["sha256"] != b["sha256"]
    ]
    assert changed == ["data_001.jsonl"]


def test_a_different_shard_count_bumps(workdir):
    first = _save(_records(MAX_RECORDS_PER_FILE + 1))
    second = _save(_records(MAX_RECORDS_PER_FILE))
    assert len(second["files"]) == len(first["files"]) - 1
    assert second["last_updated"] != first["last_updated"]
    assert not os.path.exists(os.path.join("data", "data_002.jsonl"))


def test_a_legacy_index_without_hashes_bumps_once(workdir):
    records = _records(3)
    _save(records)
    legacy = _index()
    for entry in legacy["files"]:
        del entry["sha256"]
    legacy["last_updated"] = "2020-01-01T00:00:00Z"
    with open(os.path.join("data", "index.json"), "w", encoding="utf-8") as f:
        json.dump(legacy, f)

    upgraded = _save(records)
    assert upgraded["last_updated"] != "2020-01-01T00:00:00Z"
    assert all("sha256" in f for f in upgraded["files"])
    # ...and from then on it is stable again.
    assert _save(records)["last_updated"] == upgraded["last_updated"]


def test_an_unreadable_previous_index_is_treated_as_changed(workdir):
    with open(os.path.join("data", "index.json"), "w", encoding="utf-8") as f:
        f.write("{ not json")
    index = _save(_records(2))
    assert index["total"] == 2
    assert index["last_updated"].startswith("2026-01-01T")
