"""8-block probabilistic forecast, predicted violations, MAPE and anomaly z-score (§4)."""
from __future__ import annotations

import math
from collections import deque

import numpy as np

from .field import day_ahead
from .network import BUSES, BUS_IDX, GENS, LINES, flows

Z90 = 1.2816


class Forecaster:
    def __init__(self) -> None:
        self.level_d = 1.0
        self.level_re = 1.0
        self.pending: deque[tuple[float, float]] = deque()   # (due sim t, predicted demand)
        self.errors: deque[float] = deque(maxlen=96)
        self.ewma_mu = 0.0
        self.ewma_var = 40.0 ** 2
        self.z = 0.0
        self.last_t: float | None = None
        self.result: dict = {}

    def update(self, t: float, gs, held_mw: float, direction: str) -> dict:
        h = t / 3600
        prof = day_ahead(h)
        ratio_d = gs.demand / prof["demand"]
        ratio_re = gs.re / prof["re"] if prof["re"] > 50 else 1.0
        self.level_d = 0.7 * self.level_d + 0.3 * ratio_d
        self.level_re = 0.7 * self.level_re + 0.3 * ratio_re

        # score matured 1-block-ahead forecasts
        while self.pending and self.pending[0][0] <= t:
            _, pred = self.pending.popleft()
            self.errors.append(abs(gs.demand - pred) / gs.demand)
        # anomaly: EWMA z-score on the residual vs the (corrected) profile
        resid = gs.demand - prof["demand"] * self.level_d
        sd = math.sqrt(self.ewma_var)
        self.z = (resid - self.ewma_mu) / max(sd, 1.0)
        if abs(self.z) < 4:
            a = 0.02
            self.ewma_mu = (1 - a) * self.ewma_mu + a * resid
            self.ewma_var = (1 - a) * self.ewma_var + a * (resid - self.ewma_mu) ** 2

        sign = 1 if direction == "UP" else -1
        blocks, violations = [], []
        seen_lines: set[str] = set()
        for b in range(1, 9):
            tb = t + 900 * b
            p = day_ahead(tb / 3600)
            decay = 0.82 ** b
            dem = p["demand"] * (1 + (self.level_d - 1) * decay)
            re = p["re"] * (1 + (self.level_re - 1) * decay)
            nonre = sum(v for g in GENS if g.kind not in ("solar", "wind") for v in [gs.gen[g.id]])
            held = held_mw if b <= 2 else held_mw * 0.5 ** (b - 2)
            dev = dem - (nonre + re) - p["schedule"] - sign * held
            ace50 = -dev
            sig = math.sqrt((0.006 * dem * math.sqrt(b)) ** 2 + (0.08 * re * math.sqrt(b)) ** 2)
            blk = {"b": b, "t": tb, "demand": {"p10": dem - Z90 * 0.006 * dem * math.sqrt(b), "p50": dem,
                                               "p90": dem + Z90 * 0.006 * dem * math.sqrt(b)},
                   "re": {"p10": max(0, re - Z90 * 0.08 * re * math.sqrt(b)), "p50": re, "p90": re + Z90 * 0.08 * re * math.sqrt(b)},
                   "ace": {"p10": ace50 - Z90 * sig, "p50": ace50, "p90": ace50 + Z90 * sig}, "sigma": sig,
                   "dev_raw": dev + sign * held}
            blocks.append(blk)
            if b == 1:
                self.pending.append((tb, dem))
            if abs(ace50) >= 100 or ace50 - Z90 * sig <= -300 or ace50 + Z90 * sig >= 300:
                violations.append({"kind": "ACE", "block": b, "t": tb, "value": round(ace50)})
            if b in (1, 2, 4):
                inj = np.zeros(len(BUSES))
                dr = dem / max(gs.demand, 1)
                rr = re / max(gs.re, 1) if gs.re > 1 else 1.0
                for bid, ld in gs.loads.items():
                    inj[BUS_IDX[bid]] -= ld * dr
                for g in GENS:
                    inj[BUS_IDX[g.bus]] += gs.gen[g.id] * (rr if g.kind in ("solar", "wind") else 1)
                f = flows(inj, gs.outages)
                blk["peak_line"] = None
                for k, ln in enumerate(LINES):
                    ld = abs(f[k]) / ln.limit
                    if blk["peak_line"] is None or ld > blk["peak_line"]["loading"]:
                        blk["peak_line"] = {"line": ln.id, "loading": round(ld, 3)}
                    if ld >= 0.95 and ln.id not in seen_lines:
                        seen_lines.add(ln.id)
                        violations.append({"kind": "LINE", "block": b, "t": tb, "line": ln.id, "value": round(ld, 3)})
        peaks = [b["peak_line"] for b in blocks if b.get("peak_line")]
        self.result = {
            "blocks": blocks, "violations": violations,
            "mape": round(100 * sum(self.errors) / len(self.errors), 2) if self.errors else None,
            "samples": len(self.errors), "z": round(self.z, 2),
            "peak_line": max(peaks, key=lambda x: x["loading"]) if peaks else None,
            "level_d": round(self.level_d, 4), "level_re": round(self.level_re, 4), "model": "Level-corrected profile (baseline)",
        }
        return self.result
