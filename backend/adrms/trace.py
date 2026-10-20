"""Decision trace: what the engine decided, at which pipeline stage, and why.

Every audit entry is mirrored here tagged with its pipeline stage; the optimiser and
Digital Twin add richer structured entries (solve time, allocations, failed checks).
"""
from __future__ import annotations

from collections import deque

STAGES = ["ingest", "quality", "estimate", "assess", "forecast", "detect", "decide",
          "optimise", "twin", "policy", "dispatch", "rotate", "mv", "settle", "audit"]

KIND_STAGE = {
    "SCENARIO": ("ingest", "info"), "AUTONOMY": ("policy", "warn"), "KILL_SWITCH": ("policy", "alarm"), "CONFIG": ("policy", "info"),
    "ALARM": ("detect", "warn"), "ALARM_ACK": ("detect", "neutral"), "ALARM_SHELVE": ("detect", "neutral"),
    "EVENT_OPEN": ("decide", "warn"), "EVENT_WIND_DOWN": ("decide", "ok"), "EVENT_MANUAL_CLOSE": ("decide", "info"),
    "ANALYSIS": ("optimise", "info"),
    "APPROVAL_REQUEST": ("policy", "warn"), "APPROVE": ("policy", "ok"), "REJECT": ("policy", "alarm"),
    "COMMAND": ("policy", "info"), "SEND": ("dispatch", "info"), "SEND_FAIL": ("dispatch", "alarm"),
    "ACK": ("dispatch", "ok"), "ACK_TIMEOUT": ("dispatch", "alarm"),
    "SETTLE": ("settle", "ok"), "MV_DISPUTE": ("settle", "warn"), "MV_RESOLVE": ("settle", "ok"),
    "OFFER": ("policy", "info"), "OFFER_SUBMIT": ("policy", "info"), "OFFER_WITHDRAW": ("policy", "neutral"), "APPLICATION": ("policy", "info"),
    "LOOP_ERROR": ("audit", "alarm"),
}


class Tracer:
    def __init__(self, clock, maxlen: int = 250) -> None:
        self.clock = clock
        self.items: deque = deque(maxlen=maxlen)
        self.seq = 0

    def add(self, stage: str, title: str, why: str = "", tone: str = "neutral", ref: str | None = None, data: dict | None = None) -> None:
        self.seq += 1
        self.items.append({"seq": self.seq, "t": round(self.clock(), 1), "stage": stage, "title": title, "why": why,
                           "tone": tone, "ref": ref, "data": data or {}})

    def from_audit(self, e: dict) -> None:
        kind = e["kind"]
        if kind.startswith("ROTATION") or kind == "ROTATE":
            stage, tone = "rotate", ("warn" if kind in ("ROTATION_PROPOSED", "ROTATION_ACTIVE", "ROTATION_ESCALATE", "ROTATE") else "ok")
        elif kind in ("ALARM_CLEAR", "START", "RESTORE", "ANALYSIS"):
            return  # clears are noise; ANALYSIS is traced richer by the optimiser hook
        elif kind == "ALARM" and " P3 " in f" {e['message'][:3]} ":
            return  # P3 alarms stay on the alarm strip
        else:
            stage, tone = KIND_STAGE.get(kind, ("audit", "neutral"))
        msg = e["message"]
        title, _, why = msg.partition(" — ")
        self.add(stage, title, why, tone, e.get("ref"), {"actor": e["actor"], "audit_seq": e["seq"]})

    def snapshot(self, n: int = 80) -> list:
        return list(reversed(list(self.items)[-n:]))
