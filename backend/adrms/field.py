"""Simulated field: physics of the control area, scenarios, telemetry and field gateways.

This module stands in for SCADA/EMS and the participants' gateways. Nothing
in the decision engine reads the field's internal truth: it only sees
telemetry points (value + source timestamp) and gateway acknowledgements.
"""
from __future__ import annotations

import hashlib
import hmac
import math
from dataclasses import dataclass, field

import numpy as np

from . import config as C
from .network import BUSES, BUS_IDX, GENS, LINES, flows
from .resources import DEMAND_TYPES, Resource
from .util import Rng, bump, clamp

# ------------------------------------------------------------------ day-ahead profiles (DEMO)


def demand_profile(h: float) -> float:
    return 10200 + 2600 * bump(h, 11.0, 3.2) + 3400 * bump(h, 19.3, 2.0) - 600 * bump(h, 3.5, 2.5)


def solar_cf(h: float) -> float:
    return 0.82 * max(0.0, math.sin(math.pi * (h - 6.2) / 12.6)) ** 1.3 if 6.2 < h < 18.8 else 0.0


def wind_cf(h: float) -> float:
    return 0.35 + 0.15 * math.sin(2 * math.pi * (h - 15) / 24)


def re_profile(h: float) -> dict[str, float]:
    out = {}
    for g in GENS:
        if g.kind == "solar":
            out[g.id] = g.capacity * solar_cf(h)
        elif g.kind == "wind":
            out[g.id] = g.capacity * wind_cf(h)
    return out


def hydro_profile(h: float) -> float:
    return 250 + 700 * bump(h, 19.5, 2.2)


def drawal_target(h: float) -> float:
    return 4600 + 900 * bump(h, 19.5, 2.5)


THERMAL = [g for g in GENS if g.kind == "thermal"]


def day_ahead(h: float) -> dict:
    """Day-ahead plan: demand, RE, hydro, thermal split and the resulting schedule."""
    d = demand_profile(h)
    re = re_profile(h)
    hyd = hydro_profile(h)
    th_total = clamp(d - sum(re.values()) - hyd - drawal_target(h),
                     sum(g.pmin for g in THERMAL), sum(g.capacity for g in THERMAL))
    span = sum(g.capacity - g.pmin for g in THERMAL)
    extra = th_total - sum(g.pmin for g in THERMAL)
    th = {g.id: g.pmin + extra * (g.capacity - g.pmin) / span for g in THERMAL}
    gen = {**th, **re, "SHARAVATHI": hyd}
    return {"demand": d, "re": sum(re.values()), "gen": gen, "schedule": d - sum(gen.values())}


# ------------------------------------------------------------------ scenarios

SCENARIOS: dict[str, dict] = {
    "evening_surge": {"label": "Evening demand surge (+700 MW)", "minutes": 60, "kind": "physics"},
    "thermal_trip": {"label": "BTPS unit trip (−500 MW)", "minutes": 90, "kind": "physics"},
    "cloud_cover": {"label": "Cloud cover over Pavagada (−65% solar)", "minutes": 45, "kind": "physics"},
    "wind_drop": {"label": "Wind drop (−50%)", "minutes": 60, "kind": "physics"},
    "re_surplus": {"label": "RE surplus / demand dip (under-drawal)", "minutes": 45, "kind": "physics"},
    "low_freq": {"label": "All-India low frequency (−0.18 Hz)", "minutes": 20, "kind": "physics"},
    "line_trip": {"label": "Kolar–Hoody 400 kV trip", "minutes": 60, "kind": "physics"},
    "major_shortage": {"label": "Major shortage (unit trip + surge, −1,400 MW)", "minutes": 75, "kind": "physics"},
    "freq_stale": {"label": "Frequency telemetry stale", "minutes": 10, "kind": "telemetry"},
    "rtu_fail": {"label": "RTU failure at Peenya (bus load missing)", "minutes": 15, "kind": "telemetry"},
    "breaker_unknown": {"label": "Breaker status not current (L21)", "minutes": 10, "kind": "telemetry"},
    "spike": {"label": "Spike on Mysuru bus load", "minutes": 5, "kind": "telemetry"},
    "gateway_loss": {"label": "Gateway heartbeat lost (Bidadi BESS)", "minutes": 15, "kind": "comms"},
    "no_ack": {"label": "JSW gateway not acknowledging", "minutes": 20, "kind": "comms"},
    "under_delivery": {"label": "Participants under-deliver (~50%)", "minutes": 60, "kind": "physics"},
}


@dataclass
class ActiveScenario:
    key: str
    start: float
    end: float

    def ramp(self, t: float, minutes: float = 5.0) -> float:
        """0 -> 1 over the first `minutes`, held, then 1 -> 0 over the last `minutes`."""
        if t < self.start or t > self.end:
            return 0.0
        up = (t - self.start) / (minutes * 60)
        down = (self.end - t) / (minutes * 60)
        return clamp(min(up, down, 1.0), 0.0, 1.0)


# ------------------------------------------------------------------ gateway


@dataclass
class Gateway:
    """Field gateway with its OWN copy of the command key (§5.7)."""
    resource_id: str
    keys: dict[str, bytes]
    seen: set[str] = field(default_factory=set)
    last_heartbeat: float = 0.0

    def verify(self, msg: str, tag: str, key_id: str, issued: float, now_wall: float, cmd_id: str) -> tuple[bool, str]:
        key = self.keys.get(key_id)
        if key is None:
            return False, "unknown key id"
        exp = hmac.new(key, msg.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(exp, tag):
            return False, "tag mismatch"
        if now_wall - issued > 30:
            return False, "message older than 30 s"
        if issued - now_wall > 2:
            return False, "message from the future"
        if cmd_id in self.seen:
            return False, "replayed command id"
        self.seen.add(cmd_id)
        return True, "ok"


@dataclass
class FieldCommand:
    cmd_id: str
    resource_id: str
    setpoint: float
    direction: str
    received_at: float
    ack_at: float | None
    acked: bool = False


# ------------------------------------------------------------------ the field


class Field:
    def __init__(self, resources: list[Resource], command_keys: dict[str, bytes], seed: int = 7, start_h: float = 17.5):
        self.rng = Rng(seed)
        self.t = start_h * 3600.0            # sim seconds since midnight of day 0
        self.day = 0
        self.resources = {r.id: r for r in resources}
        self.scenarios: list[ActiveScenario] = []
        self.demand_level = 1.0 + 0.012      # slow drift vs day-ahead
        self.re_level = 0.97
        self.f_noise = 0.0
        self.bus_noise = np.zeros(len(BUSES))
        self.gen_trip: dict[str, float] = {}
        self.rotated_mw: dict[str, float] = {b.id: 0.0 for b in BUSES}  # by bus, physical
        self.actual: dict = {}
        self.source = "SIM"                  # SIM | SLDC_WEB
        self.last_web_fetch = -1e9
        self.web_cache: dict = {}
        self.gateways = {r.id: Gateway(r.id, dict(command_keys), last_heartbeat=self.t) for r in resources}
        self.pending: dict[str, FieldCommand] = {}
        # physical response state per resource
        self.phys = {r.id: {"target": 0.0, "since": None, "start_mw": 0.0, "mw": 0.0, "dir": "UP"} for r in resources}
        self.step(0.0)

    # ---------------------------------------------------------------- scenarios
    def start_scenario(self, key: str, minutes: float | None = None) -> ActiveScenario:
        spec = SCENARIOS[key]
        sc = ActiveScenario(key, self.t, self.t + 60 * (minutes or spec["minutes"]))
        self.scenarios = [s for s in self.scenarios if s.key != key] + [sc]
        return sc

    def stop_scenario(self, key: str) -> None:
        self.scenarios = [s for s in self.scenarios if s.key != key]

    def active(self, key: str) -> ActiveScenario | None:
        return next((s for s in self.scenarios if s.key == key and s.start <= self.t <= s.end), None)

    def level(self, key: str, ramp_min: float = 5.0) -> float:
        s = self.active(key)
        return s.ramp(self.t, ramp_min) if s else 0.0

    # ---------------------------------------------------------------- gateway I/O
    def deliver_command(self, cmd_id: str, rid: str, setpoint: float, direction: str, msg: str, tag: str,
                        key_id: str, issued_wall: float, now_wall: float) -> tuple[bool, str]:
        gw = self.gateways[rid]
        ok, why = gw.verify(msg, tag, key_id, issued_wall, now_wall, cmd_id)
        if not ok:
            return False, why
        no_ack = (self.active("no_ack") and rid == "IND_JSW") or (self.active("gateway_loss") and rid == "BESS_BIDADI")
        latency = 2 + self.rng.random() * (6 if self.resources[rid].type in ("BESS", "GENERATION") else 18)
        self.pending[cmd_id] = FieldCommand(cmd_id, rid, setpoint, direction, self.t, None if no_ack else self.t + latency)
        return True, "accepted"

    def poll_acks(self) -> list[FieldCommand]:
        out = []
        for c in list(self.pending.values()):
            if c.ack_at is not None and self.t >= c.ack_at and not c.acked:
                c.acked = True
                ph = self.phys[c.resource_id]
                ph["start_mw"] = ph["mw"]
                ph["target"] = c.setpoint
                ph["dir"] = c.direction
                ph["since"] = self.t
                out.append(c)
                del self.pending[c.cmd_id]
        return out

    # ---------------------------------------------------------------- physics
    def _resource_physics(self, dt: float) -> None:
        under = self.level("under_delivery", 1)
        for rid, ph in self.phys.items():
            r = self.resources[rid]
            target = ph["target"]
            if ph["since"] is None:
                continue
            el = (self.t - ph["since"]) / 60.0
            rel = r.true_reliability * (1 - 0.5 * under if r.type in DEMAND_TYPES else 1)
            goal = target * rel
            if el < r.response_delay_min and goal > ph["start_mw"]:
                mw = ph["start_mw"]
            else:
                step = r.ramp_mw_min * dt / 60.0
                mw = ph["mw"] + clamp(goal - ph["mw"], -max(step, 50 * dt / 60), step)
            mw = max(0.0, mw + (self.rng.normal() * 0.01 * mw if mw > 1 else 0))
            if r.type == "BESS":
                sign = 1 if ph["dir"] == "UP" else -1
                if sign > 0:
                    r.soc -= mw * dt / 3600 / r.eta_d / r.capacity_mwh
                    if r.soc <= r.soc_min:
                        r.soc, mw = r.soc_min, 0.0
                else:
                    r.soc += mw * dt / 3600 * r.eta_c / r.capacity_mwh
                    if r.soc >= r.soc_max:
                        r.soc, mw = r.soc_max, 0.0
            ph["mw"] = mw
            if target <= 0 and mw <= 0.05:
                ph["since"] = None
                ph["mw"] = 0.0

    def step(self, dt: float) -> None:
        self.t += dt
        if self.t >= 86400:
            self.t -= 86400
            self.day += 1
            for r in self.resources.values():
                r.blocks_used = 0
        h = self.t / 3600.0
        da = day_ahead(h)
        sq = math.sqrt(max(dt, 1e-9) / 60)
        # slow drifts (Ornstein-Uhlenbeck)
        self.demand_level += (1.012 - self.demand_level) * 0.002 * dt / 60 + 0.0012 * self.rng.normal() * sq
        self.re_level += (0.97 - self.re_level) * 0.01 * dt / 60 + 0.006 * self.rng.normal() * sq
        self.f_noise += -self.f_noise * 0.08 * dt / 60 * 10 + 0.006 * self.rng.normal() * sq
        self.bus_noise += -self.bus_noise * 0.05 + 0.004 * np.array([self.rng.normal() for _ in BUSES])
        self._resource_physics(dt)

        surge = 700 * self.level("evening_surge") + 600 * self.level("major_shortage") - 650 * self.level("re_surplus")
        demand_total = da["demand"] * self.demand_level + surge
        loads = {b.id: demand_total * b.load_share * (1 + self.bus_noise[i]) for i, b in enumerate(BUSES)}

        gen = dict(da["gen"])
        for gid in gen:
            g = next(x for x in GENS if x.id == gid)
            if g.kind == "solar":
                gen[gid] *= self.re_level * (1 - 0.65 * self.level("cloud_cover", 8)) if gid == "PAVAGADA_PV" else self.re_level
                gen[gid] *= 1 + 0.25 * self.level("re_surplus")
            elif g.kind == "wind":
                gen[gid] *= (2 - self.re_level) * (1 - 0.5 * self.level("wind_drop", 10))
        gen["BTPS"] = max(0.0, gen["BTPS"] - 500 * self.level("thermal_trip", 0.5) - 800 * self.level("major_shortage", 0.5))

        # resource effects (metered physical MW)
        res_mw = {}
        for rid, ph in self.phys.items():
            r = self.resources[rid]
            mw = ph["mw"]
            sign = 1 if ph["dir"] == "UP" else -1
            res_mw[rid] = mw
            if r.type in DEMAND_TYPES:
                loads[r.bus] -= sign * mw
            elif r.type == "GENERATION":
                gen[r.gen_id] += sign * mw
            elif r.type == "BESS":
                loads[r.bus] -= sign * mw     # discharge (UP) reduces net load at the bus
        # load rotation (physical relief realised ~92% of plan)
        for bid, mw in self.rotated_mw.items():
            loads[bid] -= mw

        demand = sum(loads.values())
        gsum = sum(gen.values())
        drawal = demand - gsum
        deviation = drawal - da["schedule"]
        freq = 50.0 + self.f_noise - 0.18 * self.level("low_freq", 2) - 0.00006 * deviation
        outages = frozenset(["L07"]) if self.active("line_trip") else frozenset()
        inj = np.zeros(len(BUSES))
        for bid, ld in loads.items():
            inj[BUS_IDX[bid]] -= ld
        for g in GENS:
            inj[BUS_IDX[g.bus]] += gen[g.id]
        f = flows(inj, outages)
        self.actual = {
            "t": self.t, "freq": freq, "loads": loads, "gen": gen, "schedule": da["schedule"], "demand": demand,
            "drawal": drawal, "deviation": deviation, "flows": {ln.id: float(f[k]) for k, ln in enumerate(LINES)},
            "outages": outages, "res_mw": res_mw, "da": da,
        }
        # heartbeats
        for rid, gw in self.gateways.items():
            if not ((self.active("gateway_loss") and rid == "BESS_BIDADI")):
                gw.last_heartbeat = self.t

    # ---------------------------------------------------------------- telemetry
    def telemetry(self) -> dict:
        """Raw points {key: (value, source_ts)} as a SCADA/EMS feed would deliver them."""
        a, t = self.actual, self.t
        web = self.source == "SLDC_WEB"
        if web:
            if t - self.last_web_fetch >= C.SLDC_POLL_S:
                self.last_web_fetch = t
                self.web_cache = {"freq": a["freq"], "schedule": a["schedule"], "loads": dict(a["loads"]),
                                  "gen": dict(a["gen"]), "t": t}
            src = self.web_cache
            ts = src["t"]
        else:
            src, ts = a, t
        pts: dict[str, tuple[float | None, float]] = {}
        fs = self.active("freq_stale")
        pts["freq"] = (src["freq"], fs.start if fs else ts)
        pts["schedule"] = (src["schedule"], ts)
        for b in BUSES:
            v = src["loads"][b.id]
            if b.id == "PEENYA" and self.active("rtu_fail"):
                v = None
            if b.id == "MYSURU" and self.active("spike"):
                v = v * 3.2
            pts[f"bus:{b.id}"] = (v, ts)
        for g in GENS:
            pts[f"gen:{g.id}"] = (src["gen"][g.id], ts)
        bk = self.active("breaker_unknown")
        for ln in LINES:
            pts[f"brk:{ln.id}"] = (0.0 if ln.id in a["outages"] else 1.0, bk.start if (bk and ln.id == "L21") else t)
        for rid, r in self.resources.items():
            pts[f"res:{rid}"] = (a["res_mw"][rid], t)
            if r.type == "BESS":
                pts[f"soc:{rid}"] = (r.soc, t)
            pts[f"hb:{rid}"] = (1.0, self.gateways[rid].last_heartbeat)
        return pts
