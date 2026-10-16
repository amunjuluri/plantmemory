"""Which machines are running, worked out from their repair guides.

A guide is drafted when a machine stops, so a machine with a guide that is neither
released nor withdrawn is not producing: stopped while the repair is being decided or
done, then waiting for QA's line clearance once the repair is closed.
"""

from datetime import datetime

from app.kb import KnowledgeBase
from app.kb.loader import list_assets
from app.models import MachineStatus, PlantStatus

_FIELDS = ["id", "status", "title", "asset_tag", "copies_printed", "created_at", "updated_at"]
_DONE = {"released", "withdrawn"}
# How far along a stop is; the guide furthest along is the one to open.
_PROGRESS = {"draft": 0, "rejected": 1, "in_review": 2, "approved": 3, "closed": 4}


def _at(value: str | datetime) -> datetime:
    return value if isinstance(value, datetime) else datetime.fromisoformat(value)


def _machine(tag: str, model: str | None, guides: list[dict]) -> MachineStatus:
    open_ = [g for g in guides if g["status"] not in _DONE]
    if not open_:
        released = [_at(g["updated_at"]) for g in guides if g["status"] == "released"]
        return MachineStatus(
            tag=tag, equipment_model=model, state="running", since=max(released, default=None)
        )
    # A guide still being decided or worked means the machine is stopped, even when an
    # earlier repair on it waits for release.
    repairing = [g for g in open_ if g["status"] != "closed"]
    pool = repairing or open_
    lead = max(pool, key=lambda g: (_PROGRESS[g["status"]], _at(g["updated_at"])))
    return MachineStatus(
        tag=tag,
        equipment_model=model,
        state="stopped" if repairing else "awaiting_release",
        stage=lead["status"],
        copies_printed=lead.get("copies_printed", 0),
        guide_id=lead["id"],
        guide_title=lead["title"],
        open_guides=len(open_),
        since=min(_at(g["created_at"]) for g in pool),
    )


def plant_status(kb: KnowledgeBase) -> PlantStatus:
    """Every known machine, stopped ones first (longest stop first), then running ones."""
    guides = kb.guides.fields(_FIELDS)
    models = {a.tag: a.equipment_model for a in list_assets(kb)}
    by_tag: dict[str, list[dict]] = {tag: [] for tag in models}
    unassigned = 0
    for g in guides:
        tag = g.get("asset_tag")
        if tag:
            by_tag.setdefault(tag, []).append(g)
        elif g["status"] not in _DONE:
            unassigned += 1
    machines = [_machine(tag, models.get(tag), rows) for tag, rows in by_tag.items()]
    order = {"stopped": 0, "awaiting_release": 1, "running": 2}
    machines.sort(
        key=lambda m: (
            order[m.state],
            m.since.timestamp() if m.since and m.state != "running" else 0,
            m.tag,
        )
    )
    count = {state: sum(m.state == state for m in machines) for state in order}
    return PlantStatus(
        machines=machines,
        running=count["running"],
        stopped=count["stopped"],
        awaiting_release=count["awaiting_release"],
        unassigned=unassigned,
    )
