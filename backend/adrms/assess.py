"""State estimate (§3.2), ACE and severity (§3.3) and DSM charge (§3.4)."""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from . import config as C
from .config import DsmTable
from .network import BUSES, BUS_IDX, GENS, LINES, flows, islands, voltage_screen
from .quality import Point


# ------------------------------------------------------------------ DSM

def normal_rate(prices: dict) -> dict:
    a, b = prices["dam"], prices["rtm"]
    c = (prices["dam"] + prices["rtm"] + prices["ancillary"]) / 3
    nr = max(a, b, c)
    binding = "DAM" if nr == a else "RTM" if nr == b else "average"
    return {"A": a, "B": b, "C": round(c, 3), "NR": nr, "binding": binding}


def freq_band(f: float) -> str:
    if f < C.F_BAND_LOW:
        return "LOW"
    if f >= C.F_BAND_HIGH:
        return "HIGH"
    return "NORMAL"


def band_edges(table: DsmTable, schedule: float) -> list[float]:
    edges, last = [], 0.0
    for b in table.bands[:-1]:
        e = min((b.pct or 0) / 100 * abs(schedule), b.cap_mw if b.cap_mw is not None else math.inf)
        last = max(last, e)
        edges.append(last)
    return edges


def dsm(deviation: float, schedule: float, f: float, table: DsmTable, prices: dict) -> dict:
    """Per-block DSM: + payable for over-drawal, − receivable for under-drawal."""
    nr = normal_rate(prices)["NR"]
    fb = freq_band(f)
    over = deviation >= 0
    mag = abs(deviation)
    edges = band_edges(table, schedule)
    lo, parts, amount, marginal = 0.0, [], 0.0, 0.0
    for k, band in enumerate(table.bands):
        hi = edges[k] if k < len(edges) else math.inf
        mw = max(0.0, min(mag, hi) - lo)
        m = (band.over if over else band.under)[fb]
        if mw > 0 or k == 0:
            rs = mw * 0.25 * 1000 * m * nr
            amount += rs
            parts.append({"band": k + 1, "mw": round(mw, 1), "mult": m, "rs": round(rs), "edge": None if hi == math.inf else round(hi, 1)})
            if mw > 0:
                marginal = m * nr
        lo = hi
        if mag <= hi:
            break
    if not over:
        amount = -amount
    return {"amount": round(amount), "bands": parts, "marginal_rate": round(marginal, 3), "nr": nr,
            "freq_band": fb, "direction": "OVER" if over else "UNDER", "edges": [round(e, 1) for e in edges]}


def dsm_amount(deviation: float, schedule: float, f: float, table: DsmTable, prices: dict) -> float:
    return dsm(deviation, schedule, f, table, prices)["amount"]


# ------------------------------------------------------------------ state estimate


@dataclass
class GridState:
    t: float
    freq: float
    schedule: float
    loads: dict[str, float]
    gen: dict[str, float]
    demand: float
    in_state_gen: float
    re: float
    drawal: float
    deviation: float
    flows: dict[str, float]
    loading: dict[str, float]
    voltage: dict[str, float]
    outages: frozenset
    islands: list[list[str]]
    ace: float
    direction: str
    requirement: float
    severity: str
    p90_margin: float
    dsm: dict
    bus_flags: dict[str, str]


def estimate(points: dict[str, Point], t: float, table: DsmTable, prices: dict, offset: float = 0.0) -> GridState:
    # bus loads: fill missing / bad by load share
    good = {b.id: points[f"bus:{b.id}"].value for b in BUSES if points[f"bus:{b.id}"].flag in ("GOOD", "SUBSTITUTED")}
    gshare = sum(next(b for b in BUSES if b.id == k).load_share for k in good) or 1.0
    scale = sum(good.values()) / gshare
    loads, flags = {}, {}
    for b in BUSES:
        p = points[f"bus:{b.id}"]
        flags[b.id] = p.flag
        loads[b.id] = good[b.id] if b.id in good else scale * b.load_share
    gen = {g.id: (points[f"gen:{g.id}"].value or 0.0) for g in GENS}
    demand = sum(loads.values())
    re = sum(v for g in GENS if g.kind in ("solar", "wind") for v in [gen[g.id]])
    ins = sum(gen.values())
    schedule = points["schedule"].value or 0.0
    freq = points["freq"].value or C.F_NOMINAL
    drawal = demand - ins
    deviation = drawal - schedule
    outages = frozenset(ln.id for ln in LINES if (points[f"brk:{ln.id}"].value or 0) < 0.5)
    inj = np.zeros(len(BUSES))
    for bid, ld in loads.items():
        inj[BUS_IDX[bid]] -= ld
    for g in GENS:
        inj[BUS_IDX[g.bus]] += gen[g.id]
    f = flows(inj, outages)
    fl = {ln.id: float(f[k]) for k, ln in enumerate(LINES)}
    loading = {ln.id: abs(fl[ln.id]) / ln.limit for ln in LINES}
    # ACE (IEGC):  ACE = (Ia − Is) − 10·Bf·(Fa − Fs) + Offset
    ia, is_ = -drawal, -schedule
    ace = (ia - is_) - 10 * C.BIAS_MW_PER_0_1HZ * (freq - C.F_NOMINAL) + offset
    direction = "UP" if ace < 0 else "DOWN"
    if freq < C.F_EMERGENCY or abs(ace) > C.ACE_EMERGENCY_MW:
        sev = "EMERGENCY"
    elif freq < C.F_BAND_LOW or freq > C.F_BAND_HIGH or abs(ace) >= C.ACE_ALERT_MW:
        sev = "ALERT"
    else:
        sev = "NORMAL"
    margin = 1.28 * math.sqrt((0.005 * demand) ** 2 + (0.06 * re) ** 2)
    return GridState(t, freq, schedule, loads, gen, demand, ins, re, drawal, deviation, fl, loading,
                     voltage_screen(loading), outages, islands(outages), ace, direction, abs(ace), sev, margin,
                     dsm(deviation, schedule, freq, table, prices), flags)
