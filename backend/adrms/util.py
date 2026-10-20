"""Small helpers shared by the engine."""
from __future__ import annotations

import itertools
import math
import random
import time


def clamp(v: float, lo: float, hi: float) -> float:
    return min(hi, max(lo, v))


def bump(h: float, c: float, w: float) -> float:
    return math.exp(-0.5 * ((h - c) / w) ** 2)


def hhmm(s: float) -> str:
    t = int(s) % 86400
    return f"{t // 3600:02d}:{(t % 3600) // 60:02d}"


def r1(v: float) -> float:
    return round(float(v), 1)


_seq = itertools.count()


def uid(prefix: str) -> str:
    return f"{prefix}-{int(time.time()) % 100000:05d}{next(_seq):04d}"


class Rng(random.Random):
    """Seeded RNG so a demo run is reproducible."""

    def normal(self) -> float:
        return self.gauss(0.0, 1.0)
