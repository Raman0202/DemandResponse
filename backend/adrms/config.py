"""Policy constants, grid-code thresholds and the versioned DSM rule table.

Each value is tagged in a comment as GRID CODE (IEGC / CERC), APP POLICY (this
application's own tunable choice) or DEMO (illustrative data that must be
replaced before use).
"""
from __future__ import annotations

import copy
from dataclasses import dataclass, field

# ---------------------------------------------------------------- clocks
BLOCK_S = 900                      # GRID CODE: 15-min DSM block
GOOD_AGE_S = 10                    # GRID CODE: ACE archived at <= 10 s -> GOOD only while source age <= 10 s
SLDC_POLL_S = 300                  # APP: SLDC website poll interval in hybrid mode
EVENT_OPEN_HOLD_S = 60             # APP POLICY
ACK_TIMEOUT_S = 90                 # APP: comms timeout, not a delivery guarantee
ROTATION_HOLD_S = 120              # APP POLICY
PERSIST_EVERY_S = 10               # write-behind persistence (wall clock)

# ---------------------------------------------------------------- frequency / ACE
F_NOMINAL = 50.0
F_BAND_LOW = 49.90                 # GRID CODE: IEGC band
F_BAND_HIGH = 50.05                # GRID CODE: IEGC band
F_EMERGENCY = 49.80                # APP POLICY (decision threshold, NOT a relay setting)
BIAS_MW_PER_0_1HZ = -160.0         # DEMO: Karnataka config pending SLDC's declared Bf
ACE_ALERT_MW = 100.0               # APP POLICY
ACE_EMERGENCY_MW = 1500.0          # APP POLICY

# ---------------------------------------------------------------- data quality
QUALITY_WEIGHT = {"GOOD": 1.0, "SUBSTITUTED": 0.85, "SUSPECT": 0.5, "STALE": 0.3, "MISSING": 0.0}
CONF_ADVISORY = 0.85               # below -> autonomy degrades to L1
CONF_P3 = 0.97
CONF_P2 = 0.80

# ---------------------------------------------------------------- DR event engine (APP POLICY)
EVENT_CLOSE_MW = 60.0
EVENT_CLOSE_TICKS = 3
EVENT_COOLDOWN_S = 300
REVISE_ABS_MW = 80.0
REVISE_REL = 0.25
HORIZON_BLOCKS = 4
TIER_STEP_RS_KWH = 50.0            # pi: larger than widest cost spread between resources
OVERCORRECT_REL = 1.05
OVERCORRECT_ABS = 20.0
OVERLOAD_PENALTY = 1e7             # mu
TWIN_MAX_PASSES = 4
HEARTBEAT_LOST_S = 60
DEADBAND_MW = 5.0
DEADBAND_REL = 0.08
UNDER_DELIVERY = 0.70
RTM_ADDER_RS_KWH = 0.05
RTM_LEAD_MIN = 60
OFFPEAK_PRICE = 3.20               # DEMO: Rs/kWh, used for rebound and BESS recharge

# ---------------------------------------------------------------- autonomy
AUTONOMY_LEVELS = ["L0", "L1", "L2", "L3"]
L2_AUTO_TYPES = {"BESS", "GENERATION"}
L2_ENVELOPE_MW = 250.0
DUAL_AUTH_MW = 200.0
REAPPROVE_REL = 1.1
REAPPROVE_ABS = 20.0
LOOP_LATENCY_WARN_S = 0.6

# ---------------------------------------------------------------- load rotation (APP POLICY / DEMO)
ROT_MIN_MW = 50.0
ROT_LAPSE_MW = 25.0
ROT_SPELL_MIN = 45
ROT_DAILY_MIN = 120
ROT_REST_MIN = 45
ROT_TOPUP_MW = 50.0
ROT_TRIM_MARGIN_MW = 40.0
ROT_RESTORE_GAP_S = 120
ROT_RELIEF_OK = 0.90
ROT_RELIEF_WINDOW_S = 120
ROT_ROTATABLE_SHARE = 0.30         # DEMO: non-essential 11 kV share
ROT_GROUP_SIZE = 4

# ---------------------------------------------------------------- prices (DEMO)
DEFAULT_PRICES = {"dam": 5.40, "rtm": 7.20, "ancillary": 8.10}


@dataclass
class DsmBand:
    pct: float | None        # % of schedule (None for the open-ended last band)
    cap_mw: float | None
    over: dict[str, float]   # frequency band -> multiplier of NR, over-drawal
    under: dict[str, float]  # frequency band -> multiplier of NR, under-drawal


@dataclass
class DsmTable:
    version: str
    regulation: str
    amendments: list[str]
    effective_date: str
    source: str
    approver: str
    bands: list[DsmBand] = field(default_factory=list)
    illustrative: bool = True

    def to_dict(self) -> dict:
        return {
            "version": self.version, "regulation": self.regulation, "amendments": self.amendments,
            "effective_date": self.effective_date, "source": self.source, "approver": self.approver,
            "illustrative": self.illustrative,
            "bands": [{"pct": b.pct, "cap_mw": b.cap_mw, "over": b.over, "under": b.under} for b in self.bands],
        }

    @staticmethod
    def from_dict(d: dict) -> "DsmTable":
        for k in ("version", "source", "effective_date"):
            if not d.get(k):
                raise ValueError(f"DSM table refused: '{k}' is required")
        bands = [DsmBand(b.get("pct"), b.get("cap_mw"), dict(b["over"]), dict(b["under"])) for b in d["bands"]]
        if len(bands) == 1:  # version-1 table: one band + beyond
            bands.append(DsmBand(None, None, dict(bands[0].over), dict(bands[0].under)))
        if len(bands) < 2:
            raise ValueError("DSM table refused: at least one band plus 'beyond' is required")
        return DsmTable(d["version"], d.get("regulation", ""), list(d.get("amendments", [])), d["effective_date"],
                        d["source"], d.get("approver", ""), bands, bool(d.get("illustrative", False)))


DEFAULT_DSM = DsmTable(
    version="DEMO-2024-v2",
    regulation="Structure of CERC (Deviation Settlement Mechanism) Regulations, 2024 — general buyer",
    amendments=["NOT LOADED: notified amendments and orders must be applied before settlement use"],
    effective_date="2024-09-16",
    source="Illustrative multipliers shipped with GNA (Demand Response)",
    approver="—",
    bands=[
        DsmBand(10, 100, {"LOW": 1.5, "NORMAL": 1.0, "HIGH": 0.5}, {"LOW": 1.0, "NORMAL": 0.9, "HIGH": 0.0}),
        DsmBand(15, 200, {"LOW": 2.0, "NORMAL": 1.5, "HIGH": 1.0}, {"LOW": 0.5, "NORMAL": 0.0, "HIGH": 0.0}),
        DsmBand(None, None, {"LOW": 2.5, "NORMAL": 2.0, "HIGH": 1.5}, {"LOW": 0.0, "NORMAL": 0.0, "HIGH": 0.0}),
    ],
)


def default_dsm() -> DsmTable:
    return copy.deepcopy(DEFAULT_DSM)
