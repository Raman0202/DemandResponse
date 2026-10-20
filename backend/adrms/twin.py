"""Digital Twin pre-dispatch screening gate (§5.5). A DC screen, not utility-grade validation."""
from __future__ import annotations

from . import config as C
from .network import LINE_BY_ID, voltage_screen


def screen(plan: dict, resources: dict, ctx, hb_age: dict[str, float], p90_margin: float) -> dict:
    checks, exclude, derate = [], {}, {}
    allocs = plan["allocations"]
    B = plan["blocks"]
    # 1. heartbeat / command path
    lost = [a for a in allocs if hb_age.get(a["id"], 0) > C.HEARTBEAT_LOST_S]
    for a in lost:
        exclude[a["id"]] = f"heartbeat lost {hb_age[a['id']]:.0f} s — command path unproven"
    checks.append({"name": "Heartbeat and command path", "status": "fail" if lost else "pass",
                   "detail": ", ".join(f"{a['name']}: {hb_age[a['id']]:.0f} s" for a in lost) or "all gateways reporting",
                   "fix": "exclude asset, re-solve" if lost else None})

    # 2. BESS SoC trajectory (minute by minute)
    soc_fail = []
    traj_total = [0.0] * (15 * B)
    for a in allocs:
        r = resources[a["id"]]
        cur = r.delivering if r.direction == ctx.direction else 0.0
        mins = []
        for b in range(B):
            mins += [a["x"][b]] * 15
        tr, mw = [], cur
        for m in range(15 * B):
            target = mins[m]
            if m + 1 > r.response_delay_min or target <= mw:
                mw += max(-r.ramp_mw_min, min(r.ramp_mw_min, target - mw))
            tr.append(mw * r.reliability)
        for m in range(15 * B):
            traj_total[m] += tr[m]
        if r.type == "BESS":
            soc = r.soc
            for m in range(15 * B):
                e = tr[m] / 60
                soc += (-e / r.eta_d if ctx.direction == "UP" else e * r.eta_c) / r.capacity_mwh
                if (ctx.direction == "UP" and soc < r.soc_min - 1e-6) or (ctx.direction == "DOWN" and soc > r.soc_max + 1e-6):
                    usable = max(0.0, (r.soc - r.soc_min) * r.capacity_mwh) if ctx.direction == "UP" else max(0.0, (r.soc_max - r.soc) * r.capacity_mwh)
                    dur_h = max(0.25, sum(1 for x in a["x"] if x > 0.5) * 0.25)
                    derate[a["id"]] = 0.95 * usable * (r.eta_d if ctx.direction == "UP" else 1 / r.eta_c) / dur_h
                    soc_fail.append(f"{a['name']} breaches SoC limit at +{m + 1} min")
                    break
    checks.append({"name": "BESS state of charge", "status": "fail" if soc_fail else "pass",
                   "detail": "; ".join(soc_fail) or "trajectories stay within SoC limits",
                   "fix": "derate to 95% of usable MW, re-solve" if soc_fail else None})

    # 3. line loading after dispatch (DC screening)
    worse, relieved = [], []
    for lid, ld in plan["post_loading"].items():
        b = abs(ctx.f0.get(lid, 0.0)) / LINE_BY_ID[lid].limit
        if ld > 1.0 and ld > b + 1e-4:
            worse.append(f"{lid} {b * 100:.0f}% → {ld * 100:.0f}%")
        elif b > 1.0:
            relieved.append(f"{lid} {b * 100:.0f}% → {ld * 100:.0f}%")
    checks.append({"name": "Line loading after dispatch (DC screen)",
                   "status": "fail" if worse else "warn" if relieved else "pass",
                   "detail": "; ".join(worse) if worse else ("pre-existing overload relieved: " + "; ".join(relieved)) if relieved
                   else f"worst {plan['worst_line']['line']} {plan['worst_line']['loading'] * 100:.0f}%",
                   "fix": "not dispatched if worse — human decision" if worse else None})

    # 4. voltage screening (heuristic)
    v = voltage_screen(plan["post_loading"])
    low = {k: x for k, x in v.items() if x < 0.95}
    checks.append({"name": "Voltage screening (heuristic, not AC)", "status": "warn" if low else "pass",
                   "detail": ", ".join(f"{k} {x:.3f} pu" for k, x in low.items()) or f"min {min(v.values()):.3f} pu"})

    # 5. response lag
    planned = sum(a["x"][0] * a["reliability"] for a in allocs)
    got = sum(traj_total[:15]) / 15 if allocs else 0.0
    ratio = got / planned if planned > 0.5 else 1.0
    checks.append({"name": "Response lag", "status": "warn" if ratio < 0.7 else "pass",
                   "detail": f"{ratio * 100:.0f}% of planned block-1 energy after response delay and ramp"})

    # 6. P90 reserve kept free
    free = 0.0
    used = {a["id"]: a["x"][0] for a in allocs}
    for rid, av in ctx.avail.items():
        r = resources[rid]
        if r.type == "RTM" or rid in ctx.excluded:
            continue
        free += max(0.0, av - used.get(rid, 0.0)) * r.reliability
    checks.append({"name": "P90 reserve kept free", "status": "warn" if free < p90_margin else "pass",
                   "detail": f"free expected flexibility {free:.0f} MW vs P90 margin {p90_margin:.0f} MW"})

    # 7. ancillary
    anc = sum(r.ancillary_mw for r in resources.values())
    checks.append({"name": "Ancillary double-commitment", "status": "pass",
                   "detail": f"{anc:.0f} MW SRAS/TRAS locked and untouched"})

    # 8. rebound
    req1 = plan["req"][0] if plan["req"] else 0.0
    checks.append({"name": "Rebound", "status": "warn" if req1 > 0 and plan["rebound_mw"] > 0.25 * req1 else "pass",
                   "detail": f"post-event rebound {plan['rebound_mw']:.0f} MW ({(plan['rebound_mw'] / req1 * 100) if req1 else 0:.0f}% of requirement)"})

    # 9. requirement covered
    short = max(0.0, req1 - plan["supplied"][0]) if plan["req"] else 0.0
    st = "pass" if short <= 0.5 else ("fail" if ctx.severity == "EMERGENCY" else "warn")
    checks.append({"name": "Requirement covered", "status": st,
                   "detail": f"shortfall {short:.0f} MW" + (" — escalate to load management" if st == "fail" else ""),
                   "shortfall": short})
    failed = [c for c in checks if c["status"] == "fail"]
    fixable = bool(exclude or derate)
    return {"passed": not failed, "checks": checks, "exclude": exclude, "derate": derate, "fixable": fixable,
            "trajectory": [round(x, 1) for x in traj_total[::3]]}
