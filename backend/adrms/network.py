"""Karnataka transmission model (DEMO data) and DC power flow.

Buses are 400/220 kV aggregation nodes at their approximate geographic
location. Each bus feeds a few 220 kV stations used by the load-rotation
roster. Reactances and ratings are planning-level placeholders, not a
validated network model (see How it works §3.2).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np


@dataclass
class Bus:
    id: str
    name: str
    lat: float
    lon: float
    discom: str
    load_share: float
    tie: bool = False                 # inter-state tie bus (distributed slack)
    stations: list[str] = field(default_factory=list)


@dataclass
class Line:
    id: str
    frm: str
    to: str
    x: float                          # per-unit reactance (100 MVA base)
    limit: float                      # MW thermal limit
    kv: int = 400


@dataclass
class Gen:
    id: str
    name: str
    bus: str
    kind: str                         # thermal | hydro | solar | wind
    capacity: float
    pmin: float
    var_cost: float                   # Rs/kWh


BUSES: list[Bus] = [
    Bus("HOODY", "Hoody (Bengaluru E)", 12.99, 77.71, "BESCOM", 0.105, stations=["Hoody", "Whitefield", "ITPL", "HAL", "KR Puram", "Hebbal"]),
    Bus("PEENYA", "Peenya (Bengaluru N)", 13.03, 77.52, "BESCOM", 0.090, stations=["Peenya", "Yelahanka", "Devanahalli", "Doddaballapur", "Nagawara"]),
    Bus("SOMANAHALLI", "Somanahalli (Bengaluru S)", 12.79, 77.50, "BESCOM", 0.090, stations=["Somanahalli", "Subramanyapura", "Electronic City", "Jigani", "Anekal"]),
    Bus("NELAMANGALA", "Nelamangala", 13.10, 77.39, "BESCOM", 0.050, stations=["Nelamangala", "Dabaspet", "Kunigal Rd", "Magadi Rd"]),
    Bus("BIDADI", "Bidadi", 12.80, 77.38, "BESCOM", 0.040, stations=["Bidadi", "Ramanagara", "Kanakapura", "Channapatna"]),
    Bus("KOLAR", "Kolar (PGCIL tie)", 13.14, 78.13, "BESCOM", 0.040, tie=True, stations=["Kolar", "Malur", "Chintamani", "Mulbagal"]),
    Bus("TUMAKURU", "Tumakuru", 13.34, 77.10, "BESCOM", 0.050, stations=["Tumakuru", "Tiptur", "Gubbi", "Madhugiri", "Sira"]),
    Bus("PAVAGADA", "Pavagada Solar Park", 14.10, 77.28, "BESCOM", 0.012, stations=["Pavagada", "Madakasira Rd"]),
    Bus("CHITRADURGA", "Chitradurga", 14.23, 76.40, "BESCOM", 0.040, stations=["Chitradurga", "Hiriyur", "Challakere", "Holalkere"]),
    Bus("DAVANAGERE", "Davanagere", 14.46, 75.92, "BESCOM", 0.040, stations=["Davanagere", "Harihar", "Channagiri", "Jagalur"]),
    Bus("MYSURU", "Mysuru", 12.30, 76.64, "CESC", 0.070, stations=["Mysuru", "Hootagalli", "Nanjangud", "Hunsur", "Chamarajanagar"]),
    Bus("HASSAN", "Hassan", 13.00, 76.10, "CESC", 0.040, stations=["Hassan", "Arsikere", "Channarayapatna", "Belur"]),
    Bus("MANDYA", "Mandya", 12.52, 76.90, "CESC", 0.030, stations=["Mandya", "Maddur", "Malavalli", "Srirangapatna"]),
    Bus("SHIVAMOGGA", "Shivamogga", 13.93, 75.57, "MESCOM", 0.030, stations=["Shivamogga", "Bhadravathi", "Sagar", "Shikaripura"]),
    Bus("SHARAVATHI", "Sharavathi (hydro)", 14.19, 74.83, "MESCOM", 0.006, stations=["Talaguppa", "Jog"]),
    Bus("MANGALURU", "Mangaluru", 12.91, 74.86, "MESCOM", 0.040, stations=["Kavoor", "Baikampady", "Puttur", "Bantwal"]),
    Bus("UDUPI", "Udupi (UPCL)", 13.34, 74.75, "MESCOM", 0.020, stations=["Nandikur", "Udupi", "Kundapura"]),
    Bus("HUBBALLI", "Hubballi", 15.36, 75.12, "HESCOM", 0.050, stations=["Hubballi", "Dharwad", "Gadag", "Haveri", "Ranebennur"]),
    Bus("BELAGAVI", "Belagavi (Narendra tie)", 15.85, 74.50, "HESCOM", 0.040, tie=True, stations=["Belagavi", "Chikkodi", "Gokak", "Athani"]),
    Bus("VIJAYAPURA", "Vijayapura", 16.83, 75.71, "HESCOM", 0.040, stations=["Vijayapura", "Bagalkot", "Jamkhandi", "Basavana Bagewadi"]),
    Bus("BALLARI", "Ballari", 15.14, 76.92, "GESCOM", 0.050, stations=["Ballari", "Hosapete", "Toranagallu", "Siruguppa"]),
    Bus("RAICHUR", "Raichur (tie)", 16.20, 77.36, "GESCOM", 0.030, tie=True, stations=["Raichur", "Sindhanur", "Lingasugur", "Manvi"]),
    Bus("KALABURAGI", "Kalaburagi", 17.33, 76.83, "GESCOM", 0.040, stations=["Kalaburagi", "Shahabad", "Bidar", "Humnabad", "Yadgir"]),
]
_tot = sum(b.load_share for b in BUSES)
for _b in BUSES:
    _b.load_share /= _tot

LINES: list[Line] = [
    Line("L01", "HOODY", "PEENYA", 0.020, 300, 220),
    Line("L02", "PEENYA", "NELAMANGALA", 0.015, 1650),
    Line("L03", "NELAMANGALA", "SOMANAHALLI", 0.025, 850),
    Line("L04", "SOMANAHALLI", "HOODY", 0.020, 350, 220),
    Line("L05", "SOMANAHALLI", "BIDADI", 0.015, 300, 220),
    Line("L06", "BIDADI", "NELAMANGALA", 0.020, 900, 220),
    Line("L07", "KOLAR", "HOODY", 0.030, 2000),
    Line("L08", "KOLAR", "SOMANAHALLI", 0.035, 1600),
    Line("L09", "TUMAKURU", "NELAMANGALA", 0.030, 2850),
    Line("L10", "PAVAGADA", "TUMAKURU", 0.040, 2300),
    Line("L11", "PAVAGADA", "CHITRADURGA", 0.050, 1500),
    Line("L12", "CHITRADURGA", "TUMAKURU", 0.050, 2500),
    Line("L13", "CHITRADURGA", "DAVANAGERE", 0.040, 750),
    Line("L14", "DAVANAGERE", "SHIVAMOGGA", 0.040, 1850, 220),
    Line("L15", "SHIVAMOGGA", "SHARAVATHI", 0.030, 1350),
    Line("L16", "SHARAVATHI", "HUBBALLI", 0.060, 1150),
    Line("L17", "SHARAVATHI", "UDUPI", 0.050, 750, 220),
    Line("L18", "UDUPI", "MANGALURU", 0.030, 1950),
    Line("L19", "MANGALURU", "HASSAN", 0.060, 1150),
    Line("L20", "HASSAN", "SHIVAMOGGA", 0.050, 2450, 220),
    Line("L21", "HASSAN", "NELAMANGALA", 0.050, 1150),
    Line("L22", "HASSAN", "MYSURU", 0.040, 1750, 220),
    Line("L23", "MYSURU", "MANDYA", 0.020, 450, 220),
    Line("L24", "MANDYA", "SOMANAHALLI", 0.040, 400),
    Line("L25", "MYSURU", "BIDADI", 0.050, 300, 220),
    Line("L26", "DAVANAGERE", "HUBBALLI", 0.050, 600),
    Line("L27", "HUBBALLI", "BELAGAVI", 0.040, 2200),
    Line("L28", "BELAGAVI", "VIJAYAPURA", 0.060, 1450, 220),
    Line("L29", "BALLARI", "CHITRADURGA", 0.050, 3100),
    Line("L30", "BALLARI", "RAICHUR", 0.050, 4200),
    Line("L31", "RAICHUR", "KALABURAGI", 0.040, 2400),
    Line("L32", "KALABURAGI", "VIJAYAPURA", 0.050, 1650, 220),
    Line("L33", "BALLARI", "DAVANAGERE", 0.050, 2500),
    Line("L34", "UDUPI", "SHIVAMOGGA", 0.060, 300, 220),
]

GENS: list[Gen] = [
    Gen("RTPS", "Raichur TPS", "RAICHUR", "thermal", 1720, 800, 3.2),
    Gen("YTPS", "Yermarus TPS", "RAICHUR", "thermal", 1600, 700, 3.6),
    Gen("BTPS", "Ballari TPS", "BALLARI", "thermal", 1700, 750, 3.4),
    Gen("UPCL", "Udupi Power (UPCL)", "UDUPI", "thermal", 1200, 550, 4.1),
    Gen("SHARAVATHI", "Sharavathi hydro", "SHARAVATHI", "hydro", 1035, 100, 0.9),
    Gen("PAVAGADA_PV", "Pavagada solar park", "PAVAGADA", "solar", 2050, 0, 0.0),
    Gen("CHITRA_WIND", "Chitradurga wind", "CHITRADURGA", "wind", 1400, 0, 0.0),
    Gen("VIJAYA_PV", "Vijayapura solar", "VIJAYAPURA", "solar", 1200, 0, 0.0),
    Gen("GADAG_WIND", "Gadag wind", "HUBBALLI", "wind", 900, 0, 0.0),
]

BUS_IDX = {b.id: i for i, b in enumerate(BUSES)}
BUS_BY_ID = {b.id: b for b in BUSES}
LINE_BY_ID = {ln.id: ln for ln in LINES}
TIE_BUSES = [b.id for b in BUSES if b.tie]
TIE_WEIGHTS = {"KOLAR": 0.5, "BELAGAVI": 0.2, "RAICHUR": 0.3}


def islands(outages: frozenset[str]) -> list[list[str]]:
    """Connected components of the in-service network."""
    adj: dict[str, set[str]] = {b.id: set() for b in BUSES}
    for ln in LINES:
        if ln.id in outages:
            continue
        adj[ln.frm].add(ln.to)
        adj[ln.to].add(ln.frm)
    seen: set[str] = set()
    comps: list[list[str]] = []
    for b in BUSES:
        if b.id in seen:
            continue
        stack, comp = [b.id], []
        seen.add(b.id)
        while stack:
            u = stack.pop()
            comp.append(u)
            for v in adj[u]:
                if v not in seen:
                    seen.add(v)
                    stack.append(v)
        comps.append(comp)
    return comps


_ptdf_cache: dict[frozenset[str], np.ndarray] = {}


def ptdf(outages: frozenset[str] = frozenset()) -> np.ndarray:
    """PTDF matrix H (lines x buses) with distributed slack at the tie buses.

    Cached per outage set. Buses in an island without a tie get zero columns
    (their injection cannot be balanced by the slack).
    """
    if outages in _ptdf_cache:
        return _ptdf_cache[outages]
    n, m = len(BUSES), len(LINES)
    B = np.zeros((n, n))
    for ln in LINES:
        if ln.id in outages:
            continue
        i, j, y = BUS_IDX[ln.frm], BUS_IDX[ln.to], 1.0 / ln.x
        B[i, i] += y
        B[j, j] += y
        B[i, j] -= y
        B[j, i] -= y
    ref = BUS_IDX["KOLAR"]
    H = np.zeros((m, n))
    comps = islands(outages)
    main = next(c for c in comps if "KOLAR" in c)
    keep = [BUS_IDX[b] for b in main if BUS_IDX[b] != ref]
    Bred = B[np.ix_(keep, keep)]
    X = np.zeros((n, n))
    X[np.ix_(keep, keep)] = np.linalg.inv(Bred)
    for k, ln in enumerate(LINES):
        if ln.id in outages:
            continue
        i, j = BUS_IDX[ln.frm], BUS_IDX[ln.to]
        H[k, :] = (X[i, :] - X[j, :]) / ln.x
    # distributed slack across ties in the main island
    ties = {t: w for t, w in TIE_WEIGHTS.items() if t in main}
    wsum = sum(ties.values())
    adj = sum((w / wsum) * H[:, BUS_IDX[t]] for t, w in ties.items())
    H = H - adj[:, None]
    main_set = set(main)
    for b in BUSES:
        if b.id not in main_set:
            H[:, BUS_IDX[b.id]] = 0.0
    _ptdf_cache[outages] = H
    return H


def flows(injection: np.ndarray, outages: frozenset[str] = frozenset()) -> np.ndarray:
    """DC line flows (MW, positive frm->to) for net bus injections (MW)."""
    f = ptdf(outages) @ injection
    for k, ln in enumerate(LINES):
        if ln.id in outages:
            f[k] = 0.0
    return f


def voltage_screen(loadings: dict[str, float]) -> dict[str, float]:
    """Heuristic V ~ 1.035 - 0.075 * (worst adjacent loading)^2 pu. NOT an AC solution."""
    worst = {b.id: 0.0 for b in BUSES}
    for ln in LINES:
        ld = loadings.get(ln.id, 0.0)
        worst[ln.frm] = max(worst[ln.frm], ld)
        worst[ln.to] = max(worst[ln.to], ld)
    return {b: 1.035 - 0.075 * w * w for b, w in worst.items()}
