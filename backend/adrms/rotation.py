"""Last-resort load rotation: DEMO roster, trigger, approval, fair selection, spells and staged restore (§7)."""
from __future__ import annotations

from dataclasses import dataclass, field

from . import config as C
from .network import BUSES
from .util import Rng, hhmm, uid

DISCOMS = ["BESCOM", "CESC", "MESCOM", "HESCOM", "GESCOM"]
PROTECTED = ["hospitals", "water works", "railway traction", "defence"]


@dataclass
class Group:
    id: str
    discom: str
    stations: list[dict]                      # {name, bus, lat, share}
    protected_feeders: int
    out: bool = False
    out_since: float | None = None
    planned_mw: float = 0.0
    restored_at: float | None = None
    spells: list[tuple[float, float]] = field(default_factory=list)   # (start, end) in absolute sim seconds

    def minutes_today(self, now_abs: float) -> float:
        day0 = now_abs - (now_abs % 86400)
        m = sum(max(0.0, e - max(s, day0)) for s, e in self.spells if e > day0) / 60
        if self.out and self.out_since is not None:
            m += (now_abs - max(self.out_since, day0)) / 60
        return m

    def stats7(self, now_abs: float) -> tuple[float, int, float]:
        lo = now_abs - 7 * 86400
        sp = [(s, e) for s, e in self.spells if e > lo]
        if self.out and self.out_since is not None:
            sp.append((self.out_since, now_abs))
        hours = sum(e - max(s, lo) for s, e in sp) / 3600
        latest = (sp[-1][1] - sp[-1][0]) / 60 if sp else 0.0
        return hours, len(sp), latest


def build_roster(seed: int = 11) -> list[Group]:
    rng = Rng(seed)
    groups = []
    for d in DISCOMS:
        sts = []
        for b in BUSES:
            if b.discom != d:
                continue
            n = len(b.stations)
            for k, s in enumerate(b.stations):
                sts.append({"name": s, "bus": b.id, "lat": b.lat + 0.08 * (k - n / 2) / n, "lon": b.lon, "share": 1 / n})
        sts.sort(key=lambda s: -s["lat"])          # north to south
        for gi in range(0, len(sts), C.ROT_GROUP_SIZE):
            chunk = sts[gi:gi + C.ROT_GROUP_SIZE]
            letter = chr(ord("A") + gi // C.ROT_GROUP_SIZE)
            groups.append(Group(f"{d}-{letter}", d, chunk, rng.randint(2, 9)))
    # seed a little history so fairness has something to weigh
    for g in groups:
        for _ in range(rng.randint(0, 3)):
            start = -rng.uniform(1, 6.5) * 86400
            g.spells.append((start, start + rng.uniform(15, 45) * 60))
        g.spells.sort()
    return groups


@dataclass
class Order:
    id: str
    mw: float
    state: str                                # PROPOSED | APPROVED | ACTIVE | RESTORING | COMPLETED | LAPSED | REJECTED
    created_t: float
    reason: str
    auto: bool = True
    approvals: list[str] = field(default_factory=list)
    log: list[dict] = field(default_factory=list)
    groups: list[str] = field(default_factory=list)
    next_in_line: list[dict] = field(default_factory=list)
    exclusions: list[dict] = field(default_factory=list)
    escalated: bool = False
    low_relief_since: float | None = None
    last_restore_t: float = -1e9
    closed_t: float | None = None

    def to_dict(self) -> dict:
        return self.__dict__.copy()


class RotationManager:
    def __init__(self, audit, rng: Rng) -> None:
        self.audit = audit
        self.rng = rng
        self.groups = build_roster()
        self.by_id = {g.id: g for g in self.groups}
        self.orders: list[Order] = []
        self.trigger_since: float | None = None
        self.band_override_mw: float | None = None
        self.ens_mwh = 0.0
        self.measured_mw = 0.0
        self.demo_roster = True
        self.last_residual = 0.0
        self.last_trigger = {}

    # ------------------------------------------------------------- helpers
    @property
    def order(self) -> Order | None:
        return next((o for o in reversed(self.orders) if o.state in ("PROPOSED", "APPROVED", "ACTIVE", "RESTORING")), None)

    def group_mw(self, g: Group, loads: dict[str, float]) -> float:
        return sum(loads[s["bus"]] * s["share"] for s in g.stations) * C.ROT_ROTATABLE_SHARE

    def planned_out(self) -> float:
        return sum(g.planned_mw for g in self.groups if g.out)

    def fairness_scores(self, now_abs: float) -> dict[str, float]:
        st = {g.id: g.stats7(now_abs) for g in self.groups}
        mh = max((s[0] for s in st.values()), default=0) or 1
        mn = max((s[1] for s in st.values()), default=0) or 1
        md = max((s[2] for s in st.values()), default=0) or 1
        return {k: 0.5 * s[0] / mh + 0.3 * s[1] / mn + 0.2 * s[2] / md for k, s in st.items()}

    def eligible(self, g: Group, now_abs: float) -> tuple[bool, str]:
        if g.out:
            return False, "already rotated out"
        left = C.ROT_DAILY_MIN - g.minutes_today(now_abs)
        if left < 10:
            return False, f"daily limit reached ({g.minutes_today(now_abs):.0f}/{C.ROT_DAILY_MIN} min)"
        if g.restored_at is not None and now_abs - g.restored_at < C.ROT_REST_MIN * 60:
            return False, f"resting until {hhmm(g.restored_at + C.ROT_REST_MIN * 60)}"
        return True, "eligible"

    def select(self, mw: float, loads: dict[str, float], now_abs: float, exclude: set[str] = frozenset()) -> tuple[list[Group], list[dict], list[dict]]:
        """Fair selection: DISCOM quotas by load share, then lowest fairness score within the DISCOM."""
        dload = {d: sum(loads[b.id] for b in BUSES if b.discom == d) for d in DISCOMS}
        tot = sum(dload.values())
        quota = {d: mw * dload[d] / tot for d in DISCOMS}
        got = {d: 0.0 for d in DISCOMS}
        scores = self.fairness_scores(now_abs)
        picks, log, excl = [], [], []
        avail: dict[str, list[Group]] = {d: [] for d in DISCOMS}
        for g in self.groups:
            if g.id in exclude:
                continue
            ok, why = self.eligible(g, now_abs)
            if ok:
                avail[g.discom].append(g)
            elif not g.out:
                excl.append({"group": g.id, "reason": why})
        for d in DISCOMS:
            avail[d].sort(key=lambda g: scores[g.id])
        total = 0.0
        while total < mw:
            cand = [d for d in DISCOMS if avail[d]]
            if not cand:
                break
            d = min(cand, key=lambda d: got[d] - quota[d])
            g = avail[d].pop(0)
            gm = self.group_mw(g, loads)
            picks.append(g)
            got[d] += gm
            total += gm
            log.append({"group": g.id, "discom": d, "mw": round(gm, 1), "score": round(scores[g.id], 3),
                        "reason": f"{d} furthest below quota ({got[d] - gm:.0f}/{quota[d]:.0f} MW); lowest F={scores[g.id]:.2f}"})
        return picks, log, excl

    def _next(self, loads, now_abs) -> list[dict]:
        scores = self.fairness_scores(now_abs)
        el = [g for g in self.groups if self.eligible(g, now_abs)[0]]
        el.sort(key=lambda g: scores[g.id])
        return [{"group": g.id, "score": round(scores[g.id], 3), "mw": round(self.group_mw(g, loads), 1)} for g in el[:5]]

    def _out(self, g: Group, mw: float, now_abs: float) -> None:
        g.out, g.out_since, g.planned_mw = True, now_abs, mw

    def _restore(self, g: Group, now_abs: float) -> None:
        g.spells.append((g.out_since or now_abs, now_abs))
        g.out, g.out_since, g.planned_mw, g.restored_at = False, None, 0.0, now_abs

    # ------------------------------------------------------------- main
    def step(self, t: float, now_abs: float, dt: float, residual: float, freq: float, band1_mw: float,
             loads: dict[str, float], field_) -> None:
        self.last_residual = residual
        band = self.band_override_mw if self.band_override_mw is not None else band1_mw
        cond = residual >= C.ROT_MIN_MW and (freq < C.F_BAND_LOW or residual > band)
        self.last_trigger = {"residual": round(residual, 1), "band": round(band, 1), "cond": cond,
                             "since": self.trigger_since, "freq": freq}
        o = self.order
        if cond:
            self.trigger_since = self.trigger_since if self.trigger_since is not None else t
        else:
            self.trigger_since = None
        held = self.trigger_since is not None and (t - self.trigger_since >= C.ROTATION_HOLD_S or freq < C.F_EMERGENCY)
        if o is None and cond and held:
            mw = max(C.ROT_MIN_MW, round(residual / 10) * 10)
            o = Order(uid("ROT"), mw, "PROPOSED", t,
                      f"Residual {residual:.0f} MW ≥ {C.ROT_MIN_MW:.0f} MW and " +
                      (f"f {freq:.2f} Hz < 49.90" if freq < C.F_BAND_LOW else f"> DSM band 1 ({band:.0f} MW)") +
                      f", sustained {C.ROTATION_HOLD_S} s")
            o.next_in_line = self._next(loads, now_abs)
            self.orders.append(o)
            self.audit.append("ROTATION_PROPOSED", "system", o.id, f"Load-rotation order proposed: {mw:.0f} MW — {o.reason}")
        if o and o.state == "PROPOSED":
            o.mw = max(C.ROT_MIN_MW, round(residual / 10) * 10) if residual >= C.ROT_MIN_MW else o.mw
            if o.auto and residual < C.ROT_LAPSE_MW:
                o.state, o.closed_t = "LAPSED", t
                self.audit.append("ROTATION_LAPSED", "system", o.id, "Flexibility caught up (residual < 25 MW) — order lapsed")
        if o and o.state == "APPROVED":
            picks, log, excl = self.select(o.mw, loads, now_abs)
            for g in picks:
                self._out(g, self.group_mw(g, loads), now_abs)
            o.groups = [g.id for g in picks]
            o.log += [{**e, "t": t, "action": "OUT"} for e in log]
            o.exclusions = excl
            o.state = "ACTIVE"
            self.audit.append("ROTATION_ACTIVE", "system", o.id, f"Rotated out {', '.join(o.groups)} ({self.planned_out():.0f} MW planned) — "
                              + "; ".join(f"{e['group']}: {e['reason']}" for e in log[:3]))
        if o and o.state in ("ACTIVE", "RESTORING"):
            self._manage(o, t, now_abs, residual, loads)
        # physical effect (relief realised ~92% of plan, with noise) and metering
        per_bus = {b.id: 0.0 for b in BUSES}
        for g in self.groups:
            if g.out:
                tot = sum(loads[s["bus"]] * s["share"] for s in g.stations) or 1
                for s in g.stations:
                    per_bus[s["bus"]] += g.planned_mw * (loads[s["bus"]] * s["share"] / tot) * 0.92
        field_.rotated_mw = per_bus
        self.measured_mw = sum(per_bus.values()) * (1 + 0.01 * self.rng.normal())
        self.ens_mwh += self.measured_mw * dt / 3600
        o = self.order
        if o and o.state == "ACTIVE":
            planned = self.planned_out()
            if planned > 0 and self.measured_mw < C.ROT_RELIEF_OK * planned:
                o.low_relief_since = o.low_relief_since or t
                if t - o.low_relief_since >= C.ROT_RELIEF_WINDOW_S and not o.escalated:
                    o.escalated = True
                    self.audit.append("ROTATION_ESCALATE", "system", o.id,
                                      f"Metered relief {self.measured_mw:.0f} MW < 90% of planned {planned:.0f} MW for 2 min — residual re-estimated from metering")
            else:
                o.low_relief_since = None

    def _manage(self, o: Order, t: float, now_abs: float, residual: float, loads) -> None:
        out = [g for g in self.groups if g.out]
        planned = sum(g.planned_mw for g in out)
        need = residual  # residual already counts rotated-out MW in (§7)
        # rotation at end of spell
        for g in out:
            if now_abs - (g.out_since or now_abs) >= C.ROT_SPELL_MIN * 60 or g.minutes_today(now_abs) >= C.ROT_DAILY_MIN:
                picks, log, _ = self.select(g.planned_mw, loads, now_abs, exclude={g.id})
                self._restore(g, now_abs)
                for p in picks[:1]:
                    self._out(p, self.group_mw(p, loads), now_abs)
                    o.groups.append(p.id)
                o.log.append({"t": t, "action": "ROTATE", "group": g.id, "reason": f"spell limit {C.ROT_SPELL_MIN} min reached",
                              "replacement": picks[0].id if picks else None})
                self.audit.append("ROTATE", "system", o.id, f"{g.id} restored at spell limit; {picks[0].id if picks else 'no eligible group'} out")
        out = [g for g in self.groups if g.out]
        planned = sum(g.planned_mw for g in out)
        if o.state == "ACTIVE":
            if need > planned + C.ROT_TOPUP_MW:
                picks, log, _ = self.select(need - planned, loads, now_abs)
                for p in picks:
                    self._out(p, self.group_mw(p, loads), now_abs)
                    o.groups.append(p.id)
                o.log += [{**e, "t": t, "action": "TOP-UP"} for e in log]
                if picks:
                    self.audit.append("ROTATION_TOPUP", "system", o.id, f"Top-up: {', '.join(p.id for p in picks)}")
            elif out and need < 10:
                o.state = "RESTORING"
                self.audit.append("ROTATION_RESTORE", "system", o.id, "Over-drawal gone — staged restore begins")
            elif out:
                smallest = min(g.planned_mw for g in out)
                if planned - need > smallest + C.ROT_TRIM_MARGIN_MW:
                    cand = sorted(out, key=lambda g: -g.planned_mw)
                    for g in cand:
                        if planned - g.planned_mw >= need:
                            self._restore(g, now_abs)
                            o.log.append({"t": t, "action": "TRIM", "group": g.id, "reason": "more than needed is rotated out"})
                            self.audit.append("ROTATION_TRIM", "system", o.id, f"Trim: {g.id} given back")
                            break
        if o.state == "RESTORING":
            out = [g for g in self.groups if g.out]
            if need > C.ROT_MIN_MW:
                o.state = "ACTIVE"
                return
            if not out:
                o.state, o.closed_t = "COMPLETED", t
                self.audit.append("ROTATION_COMPLETE", "system", o.id, f"All groups restored; ENS so far {self.ens_mwh:.1f} MWh")
                return
            earliest = min(C.ROT_SPELL_MIN * 60 - (now_abs - (g.out_since or now_abs)) for g in out)
            gap = min(C.ROT_RESTORE_GAP_S, max(10.0, earliest / len(out)))
            if t - o.last_restore_t >= gap:
                g = max(out, key=lambda g: now_abs - (g.out_since or now_abs))
                self._restore(g, now_abs)
                o.last_restore_t = t
                o.log.append({"t": t, "action": "RESTORE", "group": g.id, "reason": f"staged restore, gap {gap:.0f} s, longest-out first"})

    def approve(self, user: str, dual: bool, t: float) -> str:
        o = self.order
        if not o or o.state != "PROPOSED":
            return "no proposed order"
        if user in o.approvals:
            return "the second approver must be a different user"
        if o.approvals and not dual:
            return "second approver needs dual authority"
        o.approvals.append(user)
        need = 2 if o.mw > C.DUAL_AUTH_MW else 1
        self.audit.append("ROTATION_APPROVE", user, o.id, f"Approval {len(o.approvals)}/{need} for {o.mw:.0f} MW")
        if len(o.approvals) >= need:
            o.state = "APPROVED"
        return "ok"

    def reject(self, user: str, t: float, reason: str) -> None:
        o = self.order
        if o and o.state == "PROPOSED":
            o.state, o.closed_t = "REJECTED", t
            self.audit.append("ROTATION_REJECT", user, o.id, f"Rejected: {reason}")

    def manual(self, mw: float, user: str, t: float, loads, now_abs) -> None:
        if self.order:
            return
        o = Order(uid("ROT"), max(C.ROT_MIN_MW, round(mw / 10) * 10), "PROPOSED", t, f"Manual order by {user}", auto=False)
        o.next_in_line = self._next(loads, now_abs)
        self.orders.append(o)
        self.audit.append("ROTATION_PROPOSED", user, o.id, f"Manual load-rotation order {o.mw:.0f} MW")

    def snapshot(self, loads, now_abs: float) -> dict:
        scores = self.fairness_scores(now_abs)
        mins = [g.minutes_today(now_abs) for g in self.groups]
        return {
            "demo_roster": self.demo_roster,
            "order": self.order.to_dict() if self.order else None,
            "orders": [o.to_dict() for o in reversed(self.orders[-10:])],
            "trigger": self.last_trigger,
            "planned_mw": round(self.planned_out(), 1),
            "measured_mw": round(self.measured_mw, 1),
            "ens_mwh": round(self.ens_mwh, 2),
            "fairness_spread_min": round(max(mins) - min(mins), 1),
            "max_minutes": round(max(mins), 1),
            "band_override_mw": self.band_override_mw,
            "groups": [{
                "id": g.id, "discom": g.discom, "out": g.out, "out_since": g.out_since,
                "spell_min": round((now_abs - g.out_since) / 60, 1) if g.out and g.out_since is not None else 0,
                "minutes_today": round(g.minutes_today(now_abs), 1), "mw": round(self.group_mw(g, loads), 1),
                "planned_mw": round(g.planned_mw, 1), "F": round(scores[g.id], 3),
                "stats7": [round(x, 2) for x in g.stats7(now_abs)],
                "eligible": self.eligible(g, now_abs)[1], "protected_feeders": g.protected_feeders,
                "stations": [{"name": s["name"], "bus": s["bus"]} for s in g.stations],
            } for g in self.groups],
            "protected_classes": PROTECTED,
        }
