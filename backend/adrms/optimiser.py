"""Network-constrained multi-block LP (HiGHS) and strategy comparison (§5.3, §5.4)."""
from __future__ import annotations

from dataclasses import dataclass, field

import time

import highspy
import numpy as np

from . import config as C
from .assess import dsm_amount
from .network import BUS_IDX, LINES
from .resources import Resource, effective_rate, pay_rate, phi, rebound_rate

INF = highspy.kHighsInf

STRATEGIES = [
    ("do_nothing", "Do nothing", []),
    ("rtm", "Buy in RTM", ["RTM"]),
    ("generation", "Re-dispatch generation", ["GENERATION"]),
    ("bess", "BESS only", ["BESS"]),
    ("dr", "Demand response only", ["INDUSTRIAL", "INTERRUPTIBLE", "SHIFTABLE", "DER"]),
    ("priority_mix", "Priority mix", ["BESS", "INDUSTRIAL", "GENERATION", "INTERRUPTIBLE", "SHIFTABLE", "DER", "RTM"]),
]


@dataclass
class OptContext:
    direction: str
    severity: str
    req: list[float]                       # per block, expected block-average MW
    deviations: list[float]                # per block, deviation (+ over-drawal) without our action
    schedule: float
    freq: float
    prices: dict
    dsm_table: object
    marginal_rate: float
    f0: dict[str, float]                   # base flows with our own delivery backed out
    H: np.ndarray                          # PTDF
    outages: frozenset
    avail: dict[str, float]
    excluded: dict[str, str] = field(default_factory=dict)   # rid -> reason (heartbeat, offer, ...)
    derate: dict[str, float] = field(default_factory=dict)   # rid -> MW cap override
    blocks: int = C.HORIZON_BLOCKS


def solve(resources: list[Resource], ctx: OptContext, types: list[str] | None = None) -> dict:
    B = ctx.blocks
    dsign = 1.0 if ctx.direction == "UP" else -1.0
    skipped, usable = [], []
    for r in resources:
        if types is not None and r.type not in types:
            continue
        if r.id in ctx.excluded:
            skipped.append({"id": r.id, "name": r.name, "reason": ctx.excluded[r.id]})
            continue
        if r.type == "RTM" and ctx.direction == "DOWN":
            skipped.append({"id": r.id, "name": r.name, "reason": "n/a for a surplus (no rule-compliant selling path modelled)"})
            continue
        av = min(ctx.avail.get(r.id, 0.0), ctx.derate.get(r.id, 1e9))
        if av <= 0.5:
            skipped.append({"id": r.id, "name": r.name, "reason": "no headroom in this direction" if r.ancillary_mw == 0 else "no headroom outside SRAS/TRAS commitment"})
            continue
        remaining = r.max_blocks - r.blocks_used
        if remaining <= 0:
            skipped.append({"id": r.id, "name": r.name, "reason": "duration budget used"})
            continue
        eff = effective_rate(r, ctx.direction, ctx.prices)
        if ctx.severity == "NORMAL" and eff >= ctx.marginal_rate:
            skipped.append({"id": r.id, "name": r.name,
                            "reason": f"uneconomic: ₹{eff:.2f}/kWh ≥ DSM marginal ₹{ctx.marginal_rate:.2f}/kWh"})
            continue
        ph = phi(r, av, B)
        if r.type == "RTM":
            skipped.append({"id": r.id, "name": r.name, "reason": "delivers beyond this horizon (session + 4 blocks ≈ 1 h lead)"})
            continue
        usable.append((r, av, ph, eff, remaining))

    n_res = len(usable)
    lines = [ln for ln in LINES if ln.id not in ctx.outages]
    nx = n_res * B
    ns = B
    nv = len(lines) * B
    ncol = nx + ns + nv
    xi = lambda i, b: i * B + b
    si = lambda b: nx + b
    vi = lambda k, b: nx + ns + k * B + b

    cost = np.zeros(ncol)
    lo = np.zeros(ncol)
    hi = np.zeros(ncol)
    for i, (r, av, ph, eff, rem) in enumerate(usable):
        R = r.reliability
        for b in range(B):
            c = (eff + C.TIER_STEP_RS_KWH * (r.tier - 1)) * R * ph[b] * 0.25 * 1000 + 1e-3 * i
            cost[xi(i, b)] = c
            hi[xi(i, b)] = av if ph[b] > 0 else 0.0
    lam = (C.TIER_STEP_RS_KWH * 4 + 100) * 0.25 * 1000
    for b in range(B):
        cost[si(b)] = lam
        hi[si(b)] = INF
    for k in range(len(lines)):
        for b in range(B):
            cost[vi(k, b)] = C.OVERLOAD_PENALTY
            hi[vi(k, b)] = INF

    rows_lo, rows_hi, starts, idx, vals, row_tags = [], [], [], [], [], []

    def add(lo_, hi_, entries, tag):
        starts.append(len(idx))
        for j, v in entries:
            idx.append(j)
            vals.append(v)
        rows_lo.append(lo_)
        rows_hi.append(hi_)
        row_tags.append(tag)

    for b in range(B):
        ent = [(xi(i, b), r.reliability * ph[b]) for i, (r, av, ph, eff, rem) in enumerate(usable) if ph[b] > 0]
        add(ctx.req[b], INF, ent + [(si(b), 1.0)], ("balance", b))
        add(-INF, C.OVERCORRECT_REL * ctx.req[b] + C.OVERCORRECT_ABS, ent, ("over", b))
    lidx = {ln.id: k for k, ln in enumerate(LINES)}
    for k, ln in enumerate(lines):
        row = ctx.H[lidx[ln.id]]
        f0 = ctx.f0.get(ln.id, 0.0)
        coefs = [(i, row[BUS_IDX[r.bus]] * dsign) for i, (r, *_rest) in enumerate(usable)]
        coefs = [(i, c) for i, c in coefs if abs(c) > 1e-6]
        for b in range(B):
            ent = [(xi(i, b), c) for i, c in coefs]
            add(-INF, ln.limit - f0, ent + [(vi(k, b), -1.0)], ("line+", ln.id, b))
            add(-INF, ln.limit + f0, [(j, -c) for j, c in ent] + [(vi(k, b), -1.0)], ("line-", ln.id, b))
    for i, (r, av, ph, eff, rem) in enumerate(usable):
        ramp = r.ramp_mw_min * 15
        cur = r.setpoint if r.direction == ctx.direction else 0.0
        add(-INF, cur + ramp, [(xi(i, 0), 1.0)], ("ramp", r.id, 0))
        for b in range(1, B):
            add(-INF, ramp, [(xi(i, b), 1.0), (xi(i, b - 1), -1.0)], ("ramp", r.id, b))
        if r.type == "BESS":
            if ctx.direction == "UP":
                cap = max(0.0, (r.soc - r.soc_min) * r.capacity_mwh)
                add(-INF, cap, [(xi(i, b), ph[b] * 0.25 / r.eta_d) for b in range(B)], ("energy", r.id))
            else:
                cap = max(0.0, (r.soc_max - r.soc) * r.capacity_mwh)
                add(-INF, cap, [(xi(i, b), ph[b] * 0.25 * r.eta_c) for b in range(B)], ("energy", r.id))
        add(-INF, rem * av, [(xi(i, b), 1.0) for b in range(B)], ("duration", r.id))

    h = highspy.Highs()
    h.setOptionValue("output_flag", False)
    h.addVars(ncol, lo, hi)
    h.changeColsCost(ncol, np.arange(ncol, dtype=np.int32), cost)
    if rows_lo:
        h.addRows(len(rows_lo), np.array(rows_lo), np.array(rows_hi), len(idx),
                  np.array(starts, dtype=np.int32), np.array(idx, dtype=np.int32), np.array(vals, dtype=float))
    _t0 = time.perf_counter()
    h.run()
    solve_ms = (time.perf_counter() - _t0) * 1000
    status = h.modelStatusToString(h.getModelStatus())
    sol = h.getSolution()
    xv = np.array(sol.col_value) if ncol else np.zeros(0)
    rv = np.array(sol.row_value) if rows_lo else np.zeros(0)
    duals = np.array(sol.row_dual) if rows_lo else np.zeros(0)

    def binding(tag_pred) -> bool:
        for k, tag in enumerate(row_tags):
            if tag_pred(tag) and rows_hi[k] < INF and abs(rv[k] - rows_hi[k]) < 1e-4 and abs(duals[k]) > 1e-6:
                return True
        return False

    allocs = []
    supplied = [0.0] * B
    resource_rs = rtm_rs = rebound_rs = 0.0
    rebound_mw = 0.0
    for i, (r, av, ph, eff, rem) in enumerate(usable):
        x = [float(xv[xi(i, b)]) for b in range(B)]
        if max(x) < 0.5:
            continue
        exp = [r.reliability * ph[b] * x[b] for b in range(B)]
        mwh = sum(exp) * 0.25
        pr = pay_rate(r, ctx.direction, ctx.prices)
        if r.type == "RTM":
            rtm_rs += mwh * 1000 * pr
        else:
            resource_rs += mwh * 1000 * pr
        rebound_rs += r.rebound_frac * mwh * 1000 * C.OFFPEAK_PRICE
        rebound_mw += r.rebound_frac * max(exp)
        for b in range(B):
            supplied[b] += exp[b]
        caps = []
        if r.type == "BESS" and binding(lambda t: t[0] == "energy" and t[1] == r.id):
            caps.append("energy-limited")
        if binding(lambda t: t[0] == "duration" and t[1] == r.id):
            caps.append("max duration")
        if binding(lambda t: t[0] == "ramp" and t[1] == r.id):
            caps.append("ramp-limited")
        if any(abs(x[b] - av) < 0.5 and ph[b] > 0 for b in range(B)):
            caps.append("at available")
        if ph[0] < 1:
            caps.append(f"response {r.response_delay_min:g} min → φ₁={ph[0]:.2f}")
        allocs.append({
            "id": r.id, "name": r.name, "type": r.type, "tier": r.tier, "bus": r.bus, "discom": r.discom,
            "available": round(av, 1), "reliability": round(r.reliability, 3), "phi": ph,
            "x": [round(v, 1) for v in x], "expected": [round(v, 1) for v in exp],
            "pay_rate": round(pr, 3), "rebound_rate": round(rebound_rate(r), 3), "effective": round(eff, 3),
            "earliest_block": next((b + 1 for b in range(B) if ph[b] > 0), None),
            "response_delay_min": r.response_delay_min, "caps": caps, "mwh": round(mwh, 2),
        })
    allocs.sort(key=lambda a: (a["tier"], a["effective"]))

    # residual DSM and the counterfactual
    residual_dsm = sum(dsm_amount(ctx.deviations[b] - dsign * supplied[b], ctx.schedule, ctx.freq, ctx.dsm_table, ctx.prices)
                       for b in range(B))
    do_nothing = sum(dsm_amount(ctx.deviations[b], ctx.schedule, ctx.freq, ctx.dsm_table, ctx.prices) for b in range(B))
    total = resource_rs + rtm_rs + rebound_rs + residual_dsm

    # post-dispatch loading (block 1) and binding lines
    post, base = {}, {}
    for ln in LINES:
        if ln.id in ctx.outages:
            continue
        row = ctx.H[lidx[ln.id]]
        delta = sum(row[BUS_IDX[a["bus"]]] * dsign * a["x"][0] for a in allocs)
        post[ln.id] = abs(ctx.f0.get(ln.id, 0.0) + delta) / ln.limit
        base[ln.id] = abs(ctx.f0.get(ln.id, 0.0)) / ln.limit
    blines = []
    for k, tag in enumerate(row_tags):
        if tag[0] in ("line+", "line-") and abs(duals[k]) > 1e-6 and abs(rv[k] - rows_hi[k]) < 1e-3:
            blines.append({"line": tag[1], "block": tag[2] + 1, "shadow_rs_per_mw": round(abs(float(duals[k])), 1),
                           "loading_after": round(post.get(tag[1], 0), 3)})
    unserved = [float(xv[si(b)]) for b in range(B)]
    coverage = [min(1.0, supplied[b] / ctx.req[b]) if ctx.req[b] > 0.5 else 1.0 for b in range(B)]
    worst_post = max(post.items(), key=lambda kv: kv[1]) if post else (None, 0)
    worst_base = max(base.items(), key=lambda kv: kv[1]) if base else (None, 0)
    return {
        "status": "OPTIMAL" if status == "Optimal" else status.upper(),
        "allocations": allocs, "skipped": skipped, "binding_lines": blines,
        "supplied": [round(v, 1) for v in supplied], "unserved": [round(v, 1) for v in unserved],
        "req": [round(v, 1) for v in ctx.req], "coverage": [round(v, 3) for v in coverage],
        "rebound_mw": round(rebound_mw, 1),
        "costs": {"resource_rs": round(resource_rs), "rtm_rs": round(rtm_rs), "rebound_rs": round(rebound_rs),
                  "residual_dsm": round(residual_dsm), "total_rs": round(total), "do_nothing_rs": round(do_nothing),
                  "savings_rs": round(do_nothing - total)},
        "post_loading": {k: round(v, 3) for k, v in post.items()},
        "worst_line": {"line": worst_post[0], "loading": round(worst_post[1], 3)},
        "worst_line_base": {"line": worst_base[0], "loading": round(worst_base[1], 3)},
        "time_to_effect_min": min((a["response_delay_min"] for a in allocs), default=None),
        "blocks": B,
        "solver": {"engine": "HiGHS", "solve_ms": round(solve_ms, 2), "vars": int(ncol), "rows": len(rows_lo),
                   "nonzeros": len(idx), "objective": round(float(h.getInfo().objective_function_value), 1) if status == "Optimal" else None},
    }


def compare(resources: list[Resource], ctx: OptContext, chosen: dict | None = None) -> list[dict]:
    """Each strategy = the same LP restricted to a set of resource types; chosen plan pinned first."""
    out = []
    for key, label, types in STRATEGIES:
        if key == "do_nothing":
            res = solve(resources, ctx, types=["__none__"])
        elif key == "priority_mix" and chosen is not None:
            res = chosen
        else:
            res = solve(resources, ctx, types=types)
        c = res["costs"]
        tte = res["time_to_effect_min"]
        if key == "rtm":
            tte = C.RTM_LEAD_MIN
        out.append({
            "key": key, "label": label, "chosen": key == "priority_mix",
            "total_rs": c["total_rs"], "paid_rs": c["resource_rs"] + c["rtm_rs"] + c["rebound_rs"],
            "dsm_owed_rs": c["residual_dsm"], "savings_rs": c["savings_rs"],
            "coverage": round(sum(res["coverage"]) / len(res["coverage"]), 3),
            "time_to_effect_min": tte, "worst_line": res["worst_line"], "worst_line_base": res["worst_line_base"],
            "na": key == "rtm" and ctx.direction == "DOWN",
            "beyond_horizon": key == "rtm" and ctx.direction == "UP",
            "allocations": [{"id": a["id"], "name": a["name"], "x1": a["x"][0], "exp1": a["expected"][0]} for a in res["allocations"]],
        })
    chosen_row = out[-1]
    rest = sorted(out[:-1], key=lambda o: o["total_rs"])
    ranked = [chosen_row] + rest
    cheaper = [o for o in rest if not o["na"] and o["total_rs"] < chosen_row["total_rs"] - max(1000, 0.005 * abs(chosen_row["total_rs"]))]
    for o in cheaper:
        gives = []
        if o["coverage"] < chosen_row["coverage"] - 0.01:
            gives.append(f"coverage {o['coverage'] * 100:.0f}% vs {chosen_row['coverage'] * 100:.0f}%")
        if (o["worst_line"]["loading"] or 0) > (chosen_row["worst_line"]["loading"] or 0) + 0.005:
            gives.append(f"worse line loading ({o['worst_line']['line']} {o['worst_line']['loading'] * 100:.0f}%)")
        if (o["time_to_effect_min"] or 999) > (chosen_row["time_to_effect_min"] or 0):
            gives.append(f"slower ({o['time_to_effect_min']} min)")
        o["gives_up"] = gives or ["lower assurance of covering the requirement"]
    return ranked
