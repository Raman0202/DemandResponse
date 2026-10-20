"""ISA-18.2 style alarms with on/off delays, acknowledgement, shelving and incidents (§8)."""
from __future__ import annotations

from dataclasses import dataclass, field

from .util import uid

OFF_DELAY_S = 60
INCIDENT_WINDOW_S = 300


@dataclass
class Alarm:
    id: str
    key: str
    priority: str
    title: str
    detail: str
    category: str
    raised_at: float
    active: bool = True
    cleared_at: float | None = None
    acked_by: str | None = None
    acked_at: float | None = None
    shelved_until: float | None = None
    shelve_reason: str | None = None
    incident: str | None = None
    ref: str | None = None

    def to_dict(self) -> dict:
        return self.__dict__.copy()


@dataclass
class Incident:
    id: str
    title: str
    opened_at: float
    category: str
    alarms: list[str] = field(default_factory=list)
    dr_event: str | None = None
    closed_at: float | None = None


class AlarmEngine:
    def __init__(self, audit) -> None:
        self.audit = audit
        self.pending_on: dict[str, float] = {}     # key -> first time condition true
        self.pending_off: dict[str, float] = {}    # key -> first time condition false
        self.alarms: dict[str, Alarm] = {}         # by key (live)
        self.history: list[Alarm] = []
        self.incidents: list[Incident] = []

    def evaluate(self, t: float, conditions: list[dict]) -> None:
        """conditions: [{key, priority, title, detail, category, delay, ref}] currently TRUE."""
        now_true = {c["key"]: c for c in conditions}
        for key, c in now_true.items():
            self.pending_off.pop(key, None)
            al = self.alarms.get(key)
            if al and al.active:
                al.detail = c["detail"]
                if al.priority != c["priority"] and c["priority"] < al.priority:  # escalate (P1 < P2)
                    al.priority = c["priority"]
                    al.title = c["title"]
                continue
            first = self.pending_on.setdefault(key, t)
            if t - first >= c.get("delay", 0):
                self.pending_on.pop(key, None)
                if al and not al.active and not al.acked_by:
                    al.active, al.cleared_at, al.detail = True, None, c["detail"]
                    continue
                al = Alarm(uid("ALM"), key, c["priority"], c["title"], c["detail"], c["category"], t, ref=c.get("ref"))
                self.alarms[key] = al
                self.history.append(al)
                self._correlate(al, t)
                self.audit.append("ALARM", "system", al.id, f"{al.priority} {al.title} — {al.detail}")
        for key in list(self.pending_on):
            if key not in now_true:
                del self.pending_on[key]
        for key, al in list(self.alarms.items()):
            if key in now_true or not al.active:
                continue
            first = self.pending_off.setdefault(key, t)
            if t - first >= OFF_DELAY_S:
                al.active, al.cleared_at = False, t
                self.pending_off.pop(key, None)
                self.audit.append("ALARM_CLEAR", "system", al.id, f"Cleared: {al.title}")
        # drop cleared + acknowledged from the live set
        for key, al in list(self.alarms.items()):
            if not al.active and al.acked_by:
                del self.alarms[key]
        for inc in self.incidents:
            if inc.closed_at is None and not any(a.active for a in self.alarms.values() if a.incident == inc.id):
                inc.closed_at = t

    def _correlate(self, al: Alarm, t: float) -> None:
        inc = next((i for i in reversed(self.incidents) if i.closed_at is None and t - i.opened_at <= INCIDENT_WINDOW_S
                    and (i.category == al.category or {i.category, al.category} <= {"balance", "frequency"})), None)
        if inc is None:
            inc = Incident(uid("INC"), al.title, t, al.category)
            self.incidents.append(inc)
            self.incidents = self.incidents[-50:]
        inc.alarms.append(al.id)
        al.incident = inc.id

    def ack(self, alarm_id: str, user: str, t: float) -> bool:
        for al in self.alarms.values():
            if al.id == alarm_id and not al.acked_by:
                al.acked_by, al.acked_at = user, t
                self.audit.append("ALARM_ACK", user, al.id, f"Acknowledged {al.title}")
                return True
        return False

    def shelve(self, alarm_id: str, user: str, t: float, minutes: float, reason: str) -> bool:
        for al in self.alarms.values():
            if al.id == alarm_id:
                al.shelved_until, al.shelve_reason = t + 60 * minutes, reason
                self.audit.append("ALARM_SHELVE", user, al.id, f"Shelved {minutes:.0f} min: {reason}")
                return True
        return False

    def snapshot(self, t: float) -> dict:
        live = [a for a in self.alarms.values()]
        for a in live:
            if a.shelved_until and t > a.shelved_until:
                a.shelved_until = None
        act = sorted(live, key=lambda a: (a.priority, -a.raised_at))
        unacked = [a for a in act if not a.acked_by]
        return {
            "active": [a.to_dict() for a in act],
            "counts": {p: sum(1 for a in act if a.priority == p and not a.shelved_until) for p in ("P1", "P2", "P3")},
            "oldest_unacked": min((a.raised_at for a in unacked), default=None),
            "incidents": [i.__dict__ for i in reversed(self.incidents[-15:])],
            "history": [a.to_dict() for a in reversed(self.history[-60:])],
        }
