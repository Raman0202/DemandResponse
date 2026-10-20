"""Flexible resources: catalog (DEMO), technical headroom, cost and response timing (§5.2)."""
from __future__ import annotations

from dataclasses import dataclass, field

from . import config as C
from .network import GENS

GEN_BY_ID = {g.id: g for g in GENS}

TIER = {"BESS": 1, "INDUSTRIAL": 2, "GENERATION": 3, "INTERRUPTIBLE": 3, "SHIFTABLE": 3, "DER": 3, "RTM": 4}
DEMAND_TYPES = {"INDUSTRIAL", "INTERRUPTIBLE", "SHIFTABLE", "DER"}


@dataclass
class Resource:
    id: str
    name: str
    type: str
    bus: str
    discom: str
    bid: float                         # Rs/kWh (degradation cost for BESS charging uses `degradation`)
    response_delay_min: float
    ramp_mw_min: float
    max_blocks: int
    contract_mw: float                 # state contract share
    emergency_mw: float = 0.0          # released only in EMERGENCY
    ancillary_mw: float = 0.0          # SRAS/TRAS locked, never dispatched for DR
    reliability: float = 0.95          # learned (§6)
    true_reliability: float = 0.95     # simulation truth (hidden from the optimiser)
    rebound_frac: float = 0.0
    # demand-side
    baseline: float = 0.0
    min_load: float = 0.0
    max_load: float = 0.0
    participant: str | None = None     # GridFlex industrial participant id
    # generation
    gen_id: str | None = None
    wear: float = 0.15
    # BESS
    power: float = 0.0
    capacity_mwh: float = 0.0
    soc: float = 0.5
    soc_min: float = 0.1
    soc_max: float = 0.95
    eta_c: float = 0.95
    eta_d: float = 0.95
    degradation: float = 1.2
    # runtime (filled by the field / dispatcher)
    setpoint: float = 0.0              # MW commanded in the event direction
    delivering: float = 0.0            # metered MW in the event direction
    direction: str = "UP"
    blocks_used: int = 0
    excluded_reason: str | None = None
    extra: dict = field(default_factory=dict)

    @property
    def tier(self) -> int:
        return TIER[self.type]


def catalog() -> list[Resource]:
    R = Resource
    return [
        R("BESS_PAVAGADA", "Pavagada BESS 250 MW / 500 MWh", "BESS", "PAVAGADA", "BESCOM", 0.8, 0.1, 250, 8, 250,
          power=250, capacity_mwh=500, soc=0.82, reliability=0.98, true_reliability=0.99),
        R("BESS_BIDADI", "Bidadi BESS 150 MW / 300 MWh", "BESS", "BIDADI", "BESCOM", 0.9, 0.1, 150, 8, 120,
          power=150, capacity_mwh=300, soc=0.74, ancillary_mw=30, reliability=0.97, true_reliability=0.98),
        R("BESS_KOLAR", "Kolar BESS 100 MW / 200 MWh", "BESS", "KOLAR", "BESCOM", 0.9, 0.1, 100, 8, 100,
          power=100, capacity_mwh=200, soc=0.66, reliability=0.97, true_reliability=0.97),
        R("IND_JSW", "JSW Steel, Toranagallu", "INDUSTRIAL", "BALLARI", "GESCOM", 4.50, 12, 25, 4, 180, emergency_mw=60,
          baseline=600, min_load=420, max_load=640, participant="P_JSW", reliability=0.90, true_reliability=0.86, rebound_frac=0.3),
        R("IND_MRPL", "MRPL refinery, Mangaluru", "INDUSTRIAL", "MANGALURU", "MESCOM", 5.20, 8, 10, 4, 60,
          baseline=210, min_load=150, max_load=220, participant="P_MRPL", reliability=0.93, true_reliability=0.94, rebound_frac=0.2),
        R("IND_CEMENT", "Cement cluster, Shahabad", "INDUSTRIAL", "KALABURAGI", "GESCOM", 3.90, 15, 12, 6, 110, emergency_mw=30,
          baseline=260, min_load=110, max_load=270, participant="P_CEMENT", reliability=0.88, true_reliability=0.9, rebound_frac=0.5),
        R("IND_TKM", "Auto plants, Bidadi", "INDUSTRIAL", "BIDADI", "BESCOM", 6.10, 5, 15, 3, 45,
          baseline=120, min_load=70, max_load=125, participant="P_TKM", reliability=0.95, true_reliability=0.95, rebound_frac=0.4),
        R("IND_DC", "Data-centre campus, Whitefield", "INDUSTRIAL", "HOODY", "BESCOM", 7.80, 2, 30, 4, 60,
          baseline=180, min_load=110, max_load=185, participant="P_DC", reliability=0.96, true_reliability=0.97, rebound_frac=0.1),
        R("IND_SUGAR", "Sugar co-gen cluster, Belagavi", "INDUSTRIAL", "BELAGAVI", "HESCOM", 4.20, 10, 8, 4, 40,
          baseline=90, min_load=40, max_load=95, participant="P_SUGAR", reliability=0.85, true_reliability=0.8, rebound_frac=0.2),
        R("INT_BWSSB", "BWSSB pumping (with storage)", "INTERRUPTIBLE", "SOMANAHALLI", "BESCOM", 3.50, 5, 20, 3, 80,
          baseline=95, min_load=15, max_load=100, reliability=0.92, true_reliability=0.93, rebound_frac=0.8),
        R("SHF_AGRI_N", "Agri pump feeders (north)", "SHIFTABLE", "VIJAYAPURA", "HESCOM", 2.80, 3, 60, 4, 150,
          baseline=260, min_load=80, max_load=270, reliability=0.9, true_reliability=0.88, rebound_frac=0.9),
        R("SHF_AGRI_S", "Agri pump feeders (south)", "SHIFTABLE", "MYSURU", "CESC", 2.90, 3, 50, 4, 110,
          baseline=190, min_load=60, max_load=200, reliability=0.9, true_reliability=0.9, rebound_frac=0.9),
        R("DER_BLR", "Bengaluru DER/EV aggregator", "DER", "PEENYA", "BESCOM", 6.50, 1, 40, 4, 70,
          baseline=140, min_load=60, max_load=170, reliability=0.82, true_reliability=0.8, rebound_frac=0.5),
        R("GEN_RTPS", "Raichur TPS re-dispatch", "GENERATION", "RAICHUR", "GESCOM", 0, 8, 12, 8, 400, gen_id="RTPS",
          reliability=0.97, true_reliability=0.97),
        R("GEN_BTPS", "Ballari TPS re-dispatch", "GENERATION", "BALLARI", "GESCOM", 0, 8, 10, 8, 350, gen_id="BTPS",
          reliability=0.96, true_reliability=0.96),
        R("GEN_SHARAVATHI", "Sharavathi hydro re-dispatch", "GENERATION", "SHARAVATHI", "MESCOM", 0, 2, 80, 8, 450,
          gen_id="SHARAVATHI", ancillary_mw=100, reliability=0.98, true_reliability=0.99),
        R("RTM", "IEX Real-Time Market purchase", "RTM", "KOLAR", "—", 0, C.RTM_LEAD_MIN, 1000, 4, 1500,
          reliability=1.0, true_reliability=1.0),
    ]


# --------------------------------------------------------------- headroom

def technical_headroom(r: Resource, direction: str, gen_mw: dict[str, float], duration_h: float) -> float:
    """§5.2 technical headroom in the event direction (MW)."""
    if r.type in DEMAND_TYPES:
        base = r.baseline
        return max(0.0, base - r.min_load) if direction == "UP" else max(0.0, r.max_load - base)
    if r.type == "GENERATION":
        g = GEN_BY_ID[r.gen_id]
        cur = gen_mw.get(g.id, g.pmin) - (r.delivering if r.direction == direction else 0.0) * (1 if direction == "UP" else -1)
        return max(0.0, g.capacity - cur) if direction == "UP" else max(0.0, cur - g.pmin)
    if r.type == "BESS":
        if direction == "UP":
            usable = max(0.0, (r.soc - r.soc_min) * r.capacity_mwh)
            return min(r.power, usable * r.eta_d / duration_h)
        room = max(0.0, (r.soc_max - r.soc) * r.capacity_mwh)
        return min(r.power, room / r.eta_c / duration_h)
    if r.type == "RTM":
        return r.contract_mw if direction == "UP" else 0.0
    return 0.0


def available(r: Resource, direction: str, severity: str, gen_mw: dict[str, float], duration_h: float = 1.0) -> float:
    """available = min(technical, contract share + emergency share) minus SRAS/TRAS locked capacity."""
    tech = max(0.0, technical_headroom(r, direction, gen_mw, duration_h) - r.ancillary_mw)
    share = r.contract_mw + (r.emergency_mw if severity == "EMERGENCY" else 0.0)
    return max(0.0, min(tech, share))


# --------------------------------------------------------------- cost

def pay_rate(r: Resource, direction: str, prices: dict) -> float:
    """Rs paid per delivered kWh — the same rate settlement pays (§5.2, §6)."""
    if r.type in DEMAND_TYPES:
        return r.bid
    if r.type == "BESS":
        return r.bid + C.OFFPEAK_PRICE / (r.eta_c * r.eta_d) if direction == "UP" else r.degradation
    if r.type == "GENERATION":
        vc = GEN_BY_ID[r.gen_id].var_cost
        return vc + r.wear if direction == "UP" else -0.6 * vc + r.wear
    if r.type == "RTM":
        return prices["rtm"] + C.RTM_ADDER_RS_KWH
    return r.bid


def rebound_rate(r: Resource) -> float:
    return r.rebound_frac * C.OFFPEAK_PRICE


def effective_rate(r: Resource, direction: str, prices: dict) -> float:
    return pay_rate(r, direction, prices) + rebound_rate(r)


# --------------------------------------------------------------- timing

def _g(t: float, d: float, tau: float) -> float:
    if tau <= 1e-9:
        return 1.0 if t >= d else 0.0
    return min(1.0, max(0.0, (t - d) / tau))


def block_share(delay_min: float, tau_min: float, blocks: int, step: float = 0.25) -> list[float]:
    """phi_b = (1/15) * integral of g(t) over block b (minutes from now)."""
    out = []
    for b in range(blocks):
        t0 = 15 * b
        n = int(15 / step)
        s = sum(_g(t0 + (k + 0.5) * step, delay_min, tau_min) for k in range(n)) / n
        out.append(round(s, 4))
    return out


def phi(r: Resource, avail: float, blocks: int) -> list[float]:
    """Within-block response share, crediting what is already delivering (§5.2)."""
    if avail <= 1e-6:
        return [0.0] * blocks
    if r.type == "RTM":
        return [0.0] * blocks  # delivery only after the session: beyond a 4-block horizon
    tau = avail / max(r.ramp_mw_min, 1e-6)
    cur = min(max(0.0, r.delivering), avail)
    if cur <= 1e-6:
        return block_share(r.response_delay_min, tau, blocks)
    inc_tau = (avail - cur) / max(r.ramp_mw_min, 1e-6)
    inc = block_share(r.response_delay_min, inc_tau, blocks)
    return [round((cur + p * (avail - cur)) / avail, 4) for p in inc]
