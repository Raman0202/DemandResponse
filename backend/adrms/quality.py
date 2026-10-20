"""Telemetry quality flags, data confidence and hard vetoes (§3.1)."""
from __future__ import annotations

from dataclasses import dataclass, field

from . import config as C
from .network import BUSES, GENS

# key prefix -> (lo, hi, max plausible change per second, ttl seconds)
LIMITS = {
    "freq": (48.5, 51.5, 0.05, 30),
    "schedule": (0, 15000, 50, 900),
    "bus": (0, 4000, 40, 60),
    "gen": (0, 2200, 30, 60),
    "brk": (0, 1, 1, 30),
    "res": (0, 1000, 120, 60),
    "soc": (0, 1, 0.01, 60),
    "hb": (0, 1, 1, 1e9),
}


@dataclass
class Point:
    value: float | None
    source_ts: float
    flag: str = "GOOD"
    age: float = 0.0


@dataclass
class QualityState:
    last_good: dict[str, tuple[float, float]] = field(default_factory=dict)   # key -> (value, source_ts)
    prev: dict[str, tuple[float, float]] = field(default_factory=dict)

    def evaluate(self, raw: dict[str, tuple[float | None, float]], now: float) -> dict[str, Point]:
        out: dict[str, Point] = {}
        for key, (v, ts) in raw.items():
            kind = key.split(":")[0]
            lo, hi, rate, ttl = LIMITS[kind]
            age = max(0.0, now - ts)
            if v is None:
                lg = self.last_good.get(key)
                if lg and now - lg[1] <= ttl:
                    out[key] = Point(lg[0], lg[1], "SUBSTITUTED", now - lg[1])
                elif lg:
                    out[key] = Point(lg[0], lg[1], "STALE", now - lg[1])
                else:
                    out[key] = Point(None, ts, "MISSING", age)
                continue
            if kind == "hb":
                out[key] = Point(v, ts, "GOOD" if age <= C.HEARTBEAT_LOST_S else "STALE", age)
                continue
            suspect = not (lo <= v <= hi)
            pv = self.prev.get(key)
            if pv and ts > pv[1] and abs(v - pv[0]) / max(ts - pv[1], 1.0) > rate:
                suspect = True
            if suspect:
                lg = self.last_good.get(key)
                out[key] = Point(lg[0] if lg else v, lg[1] if lg else ts, "SUSPECT", age)
                continue
            self.prev[key] = (v, ts)
            if age <= C.GOOD_AGE_S:
                out[key] = Point(v, ts, "GOOD", age)
                self.last_good[key] = (v, ts)
            elif age <= ttl:
                out[key] = Point(v, ts, "SUBSTITUTED", age)
            else:
                out[key] = Point(v, ts, "STALE", age)
        return out


def confidence(points: dict[str, Point]) -> float:
    w = C.QUALITY_WEIGHT
    f = w[points["freq"].flag]
    ls = sum(b.load_share for b in BUSES)
    bus = sum(w[points[f"bus:{b.id}"].flag] * b.load_share for b in BUSES) / ls
    cap = sum(g.capacity for g in GENS)
    gen = sum(w[points[f"gen:{g.id}"].flag] * g.capacity for g in GENS) / cap
    return 0.25 * f + 0.60 * bus + 0.15 * gen


def vetoes(points: dict[str, Point], source: str) -> list[str]:
    out = []
    if points["freq"].flag != "GOOD":
        out.append(f"Frequency {points['freq'].flag.lower()} ({points['freq'].age:.0f} s)")
    if points["schedule"].flag in ("STALE", "SUSPECT", "MISSING"):
        out.append(f"Interchange schedule {points['schedule'].flag.lower()} — ACE untrusted")
    bad = [k.split(":")[1] for k, p in points.items() if k.startswith("brk:") and p.flag != "GOOD"]
    if bad:
        out.append(f"Breaker status not current: {', '.join(bad)} — topology uncertain")
    if source == "SLDC_WEB":
        out.append("Source is the SLDC website — advisory until authorised SCADA/EMS is connected")
    return out


def asset_vetoes(points: dict[str, Point]) -> dict[str, str]:
    out = {}
    for k, p in points.items():
        if k.startswith("hb:") and p.flag != "GOOD":
            out[k[3:]] = f"Gateway heartbeat lost ({p.age:.0f} s) — command path unproven"
        if k.startswith("soc:") and p.flag != "GOOD":
            out[k[4:]] = "State-of-charge telemetry stale"
    return out
