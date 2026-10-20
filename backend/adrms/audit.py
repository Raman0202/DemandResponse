"""Append-only SHA-256 hash-chained audit trail (§9)."""
from __future__ import annotations

import hashlib
import json
import time

GENESIS = "0" * 64


class AuditChain:
    def __init__(self, clock=None) -> None:
        self.entries: list[dict] = []
        self.clock = clock or (lambda: 0.0)
        self.on_append = None   # optional observer (decision trace)

    @property
    def head(self) -> str:
        return self.entries[-1]["hash"] if self.entries else GENESIS

    @staticmethod
    def digest(prev: str, seq: int, ts: str, kind: str, actor: str, ref: str, message: str) -> str:
        payload = json.dumps([prev, seq, ts, kind, actor, ref, message], separators=(",", ":"), ensure_ascii=False)
        return hashlib.sha256(payload.encode()).hexdigest()

    def append(self, kind: str, actor: str, ref: str | None, message: str) -> dict:
        seq = len(self.entries)
        ts = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + "Z"
        e = {"seq": seq, "ts": ts, "sim_t": round(self.clock(), 1), "kind": kind, "actor": actor, "ref": ref or "",
             "message": message}
        e["hash"] = self.digest(self.head, seq, ts, kind, actor, e["ref"], message)
        self.entries.append(e)
        if self.on_append:
            self.on_append(e)
        return e

    def verify(self) -> dict:
        prev = GENESIS
        for i, e in enumerate(self.entries):
            h = self.digest(prev, e["seq"], e["ts"], e["kind"], e["actor"], e["ref"], e["message"])
            if e["seq"] != i or h != e["hash"]:
                return {"ok": False, "broken_at": i, "length": len(self.entries)}
            prev = h
        return {"ok": True, "broken_at": None, "length": len(self.entries), "head": prev}
