"""The knowledge base's local document store and manual loader."""

from pathlib import Path

from app.kb import code_key
from app.kb.loader import build_manual, list_assets, manual_code, section_id, summarize_manuals
from app.kb.store import LocalDocStore
from app.models import Part
from tests.fakes import make_kb


def part(no: str, tags: list[str], stock: int = 1) -> Part:
    return Part(part_no=no, name=no, equipment_model="m", asset_tags=tags, stock_qty=stock)


def test_put_get_filter_delete_and_reload(tmp_path: Path) -> None:
    path = tmp_path / "parts.json"
    store = LocalDocStore(Part, path, key="part_no")
    store.put([part("A", ["TP-01"]), part("B", ["TP-01", "TP-02"], 0)])
    assert store.get("A").name == "A"
    assert {p.part_no for p in store.all(asset_tags="TP-02")} == {"B"}  # list fields: contains
    assert {p.part_no for p in store.all(stock_qty=0)} == {"B"}
    store.put([part("A", ["TP-03"])])  # same key replaces
    assert LocalDocStore(Part, path, key="part_no").get("A").asset_tags == ["TP-03"]
    store.delete(["A", "missing"])
    assert [p.part_no for p in store.all()] == ["B"]
    store.clear()
    assert store.all() == []


def test_search_ranks_by_cosine(tmp_path: Path) -> None:
    kb = make_kb(tmp_path)
    hits = kb.sections.search([1.0, 0.0, 0.0], k=2)
    assert len(hits) == 2 and hits[0][1] > 0.99


def test_codes_link_to_their_procedure_not_the_alarm_list(tmp_path: Path) -> None:
    kb = make_kb(tmp_path)
    e104 = kb.codes.get("RTP37-E104")
    assert e104.code_key == "E104" and e104.section_id == "MAN-RTP37-16"


def test_section_ids_and_codes() -> None:
    assert section_id("RTP37", 16) == "MAN-RTP37-16"
    assert section_id("RTP37", 16, {"MAN-RTP37-16"}) == "MAN-RTP37-16B"
    assert code_key("e 104") == code_key("E-104") == "E104"
    assert manual_code("Aerodry FBD-120 dryer") == "FBD120"
    sections, _ = build_manual(
        "X",
        "X",
        "m",
        [],
        [{"page": 2, "title": "a", "text": "t"}, {"page": 2, "title": "b", "text": "t"}],
        [],
    )
    assert [s.id for s in sections] == ["MAN-X-2", "MAN-X-2B"]


def test_manual_summary_and_assets(tmp_path: Path) -> None:
    kb = make_kb(tmp_path)
    [summary] = summarize_manuals(kb)
    assert (summary.manual_id, summary.sections, summary.error_codes, summary.figures) == (
        "RTP37",
        5,
        2,
        1,
    )
    assert [(a.tag, a.manual_id) for a in list_assets(kb)] == [
        ("TP-01", "RTP37"),
        ("TP-02", "RTP37"),
    ]


def test_firestore_search_falls_back_when_the_index_is_not_ready() -> None:
    from google.api_core.exceptions import FailedPrecondition

    from app.kb.store import FirestoreDocStore
    from app.models import ManualSection

    store = FirestoreDocStore.__new__(FirestoreDocStore)
    store.model, store.key = ManualSection, "id"
    store.collection = type("C", (), {"id": "manual_sections"})()
    common = {"manual_id": "M", "manual_title": "M", "equipment_model": "m", "page": 1, "text": "t"}
    near = ManualSection(id="MAN-M-1", title="near", embedding=[1.0, 0.0], **common)
    far = ManualSection(id="MAN-M-2", title="far", embedding=[0.0, 1.0], **common)

    def missing_index(vector, k):
        raise FailedPrecondition("index not ready")

    store._nearest = missing_index
    store.all = lambda **_: [far, near]
    assert [d.id for d, _ in store.search([1.0, 0.1], k=1)] == ["MAN-M-1"]
