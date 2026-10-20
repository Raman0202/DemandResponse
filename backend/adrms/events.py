"""DR event engine (§5.1–5.7), M&V and settlement (§6), coordination lifecycle and shortage ledger (§11)."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from . import config as C
from .assess import dsm_amount
from .dispatch import TERMINAL, Dispatcher, beyond_deadband
from .network import BUS_IDX, LINES, ptdf
from .optimiser import OptContext, compare, solve
from .resources import DEMAND_TYPES, Resource, available, pay_rate
from .twin import screen
from .util import uid

PHASES = ["DETECTED", "ASSESSED", "PROPOSED", "APPROVED", "ACTIVATING", "VERIFYING", "RECOVERY", "SETTLED"]


@dataclass
class ApprovalRound:
    n: int
    mw: float
    needed: int
    approvers: list[str] = field(default_factory=list)
    state: str = "PENDING"            # PENDING | APPROVED | REJECTED | SUPERSEDED
    cmd_ids: list[str] = field(default_factory=list)


@dataclass
class DrEvent:
    id: str
    opened_t: float
    opened_abs: float
    direction: str
    severity: str
    req_at_open: float
    state: str = "OPEN"               # OPEN | WINDING_DOWN | CLOSED
    phase: str = "DETECTED"
    phase_log: list[dict] = field(default_factory=list)
    exception: str | None = None
    requirement: float = 0.0
    plan: dict | None = None
    options: list[dict] = field(default_factory=list)
    twin: dict | None = None
    twin_passes: int = 0
    revisions: list[dict] = field(default_factory=list)
    rounds: list[ApprovalRound] = field(default_factory=list)
    approved_mw: float = 0.0
    excluded: dict[str, str] = field(default_factory=dict)
    last_block: int | None = None
    last_req: float = 0.0
    last_severity: str = "NORMAL"
    low_ticks: int = 0
    mv: dict[str, dict] = field(default_factory=dict)
    counterfactual_dsm: float = 0.0
    actual_dsm: float = 0.0
    settlement: dict | None = None
    closed_t: float | None = None
    block_acc: dict[str, dict] = field(default_factory=dict)
    residual: float = 0.0
    autonomy: dict = field(default_factory=dict)
    incident: str | None = None

    def set_phase(self, p: str, t: float, force: bool = False) -> None:
        if p == self.phase:
            return
        if force or PHASES.index(p) > PHASES.index(self.phase):
            self.phase = p
            self.phase_log.append({"phase": p, "t": t})


class EventEngine:
    def __init__(self, resources: dict[str, Resource], dispatcher: Dispatcher, gridflex, audit) -> None:
        self.resources = resources
        self.dispatcher = dispatcher
        self.gridflex = gridflex
        self.audit = audit
        self.event: DrEvent | None = None
        self.history: list[DrEvent] = []
        self.open_since: float | None = None
        self.cooldown_until: float = -1e9
        self.latest_ctx: OptContext | None = None
        self.trace = None   # Tracer, set by the platform

    # -------------------------------------------------------------- helpers
    def delivering_total(self, direction: str) -> float:
        return sum(r.delivering for r in self.resources.values() if r.direction == direction and r.type != "RTM")

    def need(self, gs, rotated_mw: float) -> tuple[float, float]:
        """(underlying requirement, raw ACE need in event direction)."""
        ev = self.event
        direction = ev.direction if ev else gs.direction
        raw = -gs.ace if direction == "UP" else gs.ace
        underlying = raw + self.delivering_total(direction) + (rotated_mw if direction == "UP" else 0.0)
        return underlying, raw

    # -------------------------------------------------------------- tick
    def step(self, t: float, now_abs: float, dt: float, gs, fc: dict, autonomy, prices, dsm_table, asset_veto: dict,
             hb_age: dict, rotated_mw: float, hour: float, block: int, alarms_incident=None) -> list[str]:
        """Returns a list of notes (e.g. failures) for the alarm layer."""
        notes = []
        failed = self.dispatcher.tick(t, self.resources)
        ev = self.event
        if ev is None:
            raw = abs(gs.ace)
            cond = raw >= C.ACE_ALERT_MW and autonomy.effective != "L0" and t >= self.cooldown_until
            if cond:
                self.open_since = self.open_since if self.open_since is not None else t
                if gs.severity == "EMERGENCY" or t - self.open_since >= C.EVENT_OPEN_HOLD_S:
                    self._open(t, now_abs, gs, alarms_incident)
                    ev = self.event
            else:
                self.open_since = None
        if ev is None:
            return notes

        underlying, raw = self.need(gs, rotated_mw)
        ev.requirement = max(0.0, underlying)
        reasons = []
        if ev.plan is None:
            reasons.append("event opened")
        if ev.last_block is not None and block != ev.last_block:
            reasons.append("new 15-min block")
            self._close_participant_blocks(ev, t)
        if ev.plan is not None and abs(ev.requirement - ev.last_req) > max(C.REVISE_ABS_MW, C.REVISE_REL * max(ev.last_req, 1)):
            reasons.append(f"requirement changed {ev.last_req:.0f} → {ev.requirement:.0f} MW")
        for c in failed:
            if c.event == ev.id:
                ev.excluded[c.resource] = f"command failed: {c.fail_reason}"
                reasons.append(f"command failure ({c.name})")
                notes.append(f"FAILED:{c.resource}:{c.name}")
        if gs.severity == "EMERGENCY" and ev.last_severity != "EMERGENCY":
            reasons.append("escalation to EMERGENCY")
        ev.last_block = block
        ev.last_severity = gs.severity

        if ev.state == "OPEN":
            if ev.requirement < C.EVENT_CLOSE_MW:
                ev.low_ticks += 1
            else:
                ev.low_ticks = 0
            if ev.low_ticks >= C.EVENT_CLOSE_TICKS:
                self._wind_down(t)
            elif reasons:
                self.revise(t, gs, fc, autonomy, prices, dsm_table, asset_veto, hb_age, rotated_mw, hour, "; ".join(reasons))
        elif ev.state == "WINDING_DOWN":
            if all(c.state in TERMINAL for c in self.dispatcher.commands if c.event == ev.id) or \
                    all(r.delivering < 1 for r in self.resources.values()):
                self._close(t, prices, now_abs)
                return notes

        self._mv(t, dt, gs, prices, dsm_table)
        self._accumulate_participants(ev, t)
        ev.residual = self.residual(t)
        self._advance_phase(t)
        return notes

    # -------------------------------------------------------------- open / revise / close
    def _open(self, t, now_abs, gs, incident) -> None:
        ev = DrEvent(uid("DR"), t, now_abs, gs.direction, gs.severity, abs(gs.ace))
        ev.set_phase("DETECTED", t, force=True)
        ev.phase_log = [{"phase": "DETECTED", "t": t}]
        ev.incident = incident
        self.event = ev
        self.open_since = None
        self.audit.append("EVENT_OPEN", "system", ev.id,
                          f"DR event opened: ACE {gs.ace:.0f} MW, direction {gs.direction}, {gs.severity} — "
                          + ("EMERGENCY opens immediately" if gs.severity == "EMERGENCY"
                             else f"|ACE| ≥ {C.ACE_ALERT_MW:.0f} MW sustained {C.EVENT_OPEN_HOLD_S} s"))

    def build_ctx(self, gs, fc, prices, dsm_table, rotated_mw, hour, severity=None, direction=None, req_override=None,
                  participation: float | None = None) -> tuple[OptContext, dict[str, float]]:
        ev = self.event
        direction = direction or (ev.direction if ev else gs.direction)
        severity = severity or gs.severity
        dsign = 1.0 if direction == "UP" else -1.0
        excl = dict(self.gridflex.apply_offers(self.resources, hour))
        if ev:
            excl.update(ev.excluded)
        avail = {}
        for r in self.resources.values():
            av = available(r, direction, severity, gs.gen)
            if participation is not None and r.type == "INDUSTRIAL":
                av *= participation
            avail[r.id] = av
        H = ptdf(gs.outages)
        delivering = {r.id: (r.delivering if r.direction == direction else 0.0) for r in self.resources.values()}
        inj_own = np.zeros(H.shape[1])
        for r in self.resources.values():
            inj_own[BUS_IDX[r.bus]] += dsign * delivering[r.id]
        f_own = H @ inj_own
        f0 = {ln.id: gs.flows[ln.id] - f_own[k] for k, ln in enumerate(LINES)}
        underlying = req_override if req_override is not None else max(0.0, self.need(gs, rotated_mw)[0])
        blocks = fc.get("blocks", [])
        raw = [b.get("dev_raw", 0.0) for b in blocks[:C.HORIZON_BLOCKS]]
        while len(raw) < C.HORIZON_BLOCKS:
            raw.append(raw[-1] if raw else 0.0)
        req = [underlying] + [max(0.0, underlying + dsign * (raw[b] - raw[0])) for b in range(1, C.HORIZON_BLOCKS)]
        dev_now = dsign * underlying if req_override is not None else gs.deviation + dsign * (sum(delivering.values()) + (rotated_mw if direction == "UP" else 0))
        devs = [dev_now] + [dev_now + (raw[b] - raw[0]) for b in range(1, C.HORIZON_BLOCKS)]
        marginal = gs.dsm["marginal_rate"]
        ctx = OptContext(direction, severity, req, devs, gs.schedule, gs.freq, prices, dsm_table, marginal, f0, H,
                         gs.outages, avail, excl)
        return ctx, delivering

    def revise(self, t, gs, fc, autonomy, prices, dsm_table, asset_veto, hb_age, rotated_mw, hour, reason) -> None:
        ev = self.event
        if ev.phase == "DETECTED":
            ev.set_phase("ASSESSED", t)
        ctx, _ = self.build_ctx(gs, fc, prices, dsm_table, rotated_mw, hour)
        plan = twin = None
        passes = 0
        for passes in range(1, C.TWIN_MAX_PASSES + 1):
            plan = solve(list(self.resources.values()), ctx)
            twin = screen(plan, self.resources, ctx, hb_age, gs.p90_margin)
            if twin["passed"] or not twin["fixable"]:
                break
            for rid, why in twin["exclude"].items():
                ctx.excluded[rid] = why
            for rid, mw in twin["derate"].items():
                ctx.derate[rid] = mw
        self.latest_ctx = ctx
        ev.plan, ev.twin, ev.twin_passes = plan, twin, passes
        ev.options = compare(list(self.resources.values()), ctx, chosen=plan)
        ev.last_req = ev.requirement
        ev.revisions.append({"t": t, "reason": reason, "req": round(ev.requirement, 1), "passes": passes,
                             "twin": "pass" if twin["passed"] else "fail", "status": plan["status"],
                             "supplied": plan["supplied"][0], "total_rs": plan["costs"]["total_rs"]})
        ev.revisions = ev.revisions[-40:]
        self.audit.append("ANALYSIS", "optimiser", ev.id,
                          f"Re-solve ({reason}): req {ev.requirement:.0f} MW, {plan['status']}, supplied {plan['supplied'][0]:.0f} MW, "
                          f"total ₹{plan['costs']['total_rs']:,}, twin {'PASS' if twin['passed'] else 'FAIL'} after {passes} pass(es)")
        if self.trace:
            sv = plan.get("solver", {})
            c = plan["costs"]
            self.trace.add("optimise", f"LP re-solve: {plan['status']} in {sv.get('solve_ms', 0):.1f} ms",
                           f"{reason}. {sv.get('vars')} vars × {sv.get('rows')} rows; supplies {plan['supplied'][0]:.0f} of {plan['req'][0]:.0f} MW in block 1; "
                           f"total ₹{c['total_rs']:,} vs do-nothing ₹{c['do_nothing_rs']:,}",
                           "info", ev.id, {"solver": sv, "allocations": [
                               {"id": a["id"], "name": a["name"], "tier": a["tier"], "x1": a["x"][0], "exp1": a["expected"][0],
                                "eff": a["effective"], "phi1": a["phi"][0], "caps": a["caps"]} for a in plan["allocations"][:8]],
                               "skipped": plan["skipped"][:6], "binding": plan["binding_lines"][:3], "costs": c})
            fails = [k for k in twin["checks"] if k["status"] != "pass"]
            self.trace.add("twin", f"Digital Twin {'PASS' if twin['passed'] else 'FAIL'} after {passes} pass(es)",
                           "; ".join(f"{k['name']}: {k['detail']}" for k in fails) or "all nine checks passed",
                           "ok" if twin["passed"] else "alarm", ev.id,
                           {"checks": [{"name": k["name"], "status": k["status"]} for k in twin["checks"]],
                            "exclude": twin["exclude"], "derate": twin["derate"]})
        self._policy_and_commands(t, autonomy, asset_veto, plan, twin)

    def _policy_and_commands(self, t, autonomy, asset_veto, plan, twin) -> None:
        ev = self.event
        level = autonomy.effective
        allocs = {a["id"]: a for a in plan["allocations"]}
        # MW already executing automatically in this event count against the L2 envelope
        auto_by_res = {c.resource: c.setpoint for c in self.dispatcher.commands
                       if c.event == ev.id and c.kind == "SET" and c.approval_reason is None and c.state not in TERMINAL}
        new_cmds, awaiting = [], []
        targets: dict[str, tuple[float, float, float]] = {}
        for rid, a in allocs.items():
            targets[rid] = (a["x"][0], a["expected"][0], a["pay_rate"])
        for r in self.resources.values():
            if r.setpoint > 0.01 and r.direction == ev.direction and r.id not in targets:
                targets[r.id] = (0.0, 0.0, 0.0)
        for rid, (sp, exp, pay) in targets.items():
            r = self.resources[rid]
            live = self.dispatcher.live(rid)
            cur = live[-1].setpoint if live else (r.setpoint if r.direction == ev.direction else 0.0)
            if not beyond_deadband(sp, cur) and not (sp == 0 and cur > 0):
                continue
            # autonomy policy
            why = None
            if sp <= 0.01:
                why = None                       # releases always execute
            elif not twin["passed"]:
                why = "twin failed — human decision"
            elif rid in asset_veto:
                why = asset_veto[rid]
            elif level in ("L0", "L1"):
                why = f"autonomy {level}" + (f" ({'; '.join(autonomy.reasons)})" if autonomy.reasons else "")
            elif level == "L2":
                others = sum(v for k, v in auto_by_res.items() if k != rid)
                if r.type in C.L2_AUTO_TYPES and others + sp <= C.L2_ENVELOPE_MW:
                    auto_by_res[rid] = sp
                else:
                    why = "L2: outside automatic envelope" if r.type in C.L2_AUTO_TYPES else f"L2: {r.type.lower()} needs approval"
            elif level == "L3":
                if r.type == "RTM":
                    why = "RTM always needs approval"
            c = self.dispatcher.create(t, ev.id, r, sp, exp, ev.direction, pay, why)
            new_cmds.append(c)
            if why:
                awaiting.append(c)
        if awaiting:
            mw = sum(c.setpoint for c in awaiting)
            granted = [rd for rd in ev.rounds if rd.state == "APPROVED"]
            if granted and mw <= C.REAPPROVE_REL * ev.approved_mw + C.REAPPROVE_ABS and twin["passed"] and autonomy.effective != "L1":
                for c in awaiting:
                    c.state, c.approvals = "READY", ["(within approved envelope)"]
            else:
                for rd in ev.rounds:
                    if rd.state == "PENDING":
                        rd.state = "SUPERSEDED"
                rd = ApprovalRound(len(ev.rounds) + 1, round(mw, 1), 2 if mw > C.DUAL_AUTH_MW else 1, cmd_ids=[c.id for c in awaiting])
                ev.rounds.append(rd)
                ev.set_phase("PROPOSED", t, force=True)
                self.audit.append("APPROVAL_REQUEST", "system", ev.id,
                                  f"Approval round {rd.n}: {mw:.0f} MW awaiting ({rd.needed} approver{'s' if rd.needed > 1 else ''})")
        for c in new_cmds:
            if c.state == "READY":
                self.dispatcher.send(c, t, self.resources[c.resource])
        if new_cmds and ev.phase in ("ASSESSED",):
            ev.set_phase("PROPOSED", t)

    def approve(self, user: str, dual: bool, t: float) -> str:
        ev = self.event
        if not ev:
            return "no open event"
        rd = next((r for r in ev.rounds if r.state == "PENDING"), None)
        if not rd:
            return "nothing awaiting approval"
        if user in rd.approvers:
            return "the second approver must be a different user"
        if rd.needed == 2 and not dual:
            return "dual authorisation needed: approver must hold dual authority"
        rd.approvers.append(user)
        self.audit.append("APPROVE", user, ev.id, f"Approval {len(rd.approvers)}/{rd.needed} for round {rd.n} ({rd.mw:.0f} MW)")
        if len(rd.approvers) >= rd.needed:
            rd.state = "APPROVED"
            ev.approved_mw = max(ev.approved_mw, rd.mw)
            for c in self.dispatcher.commands:
                if c.id in rd.cmd_ids and c.state == "AWAITING_APPROVAL":
                    c.state, c.approvals = "READY", list(rd.approvers)
                    self.dispatcher.send(c, t, self.resources[c.resource])
        return "ok"

    def reject(self, user: str, t: float, reason: str) -> str:
        ev = self.event
        if not ev:
            return "no open event"
        rd = next((r for r in ev.rounds if r.state == "PENDING"), None)
        if not rd:
            return "nothing awaiting approval"
        rd.state = "REJECTED"
        for c in self.dispatcher.commands:
            if c.id in rd.cmd_ids and c.state == "AWAITING_APPROVAL":
                c.state, c.closed_t, c.fail_reason = "CANCELLED", t, f"rejected by {user}: {reason}"
        self.audit.append("REJECT", user, ev.id, f"Round {rd.n} rejected: {reason}")
        if not any(c.state not in TERMINAL or c.state == "COMPLETED" for c in self.dispatcher.commands if c.event == ev.id):
            ev.exception = "REJECTED"
        return "ok"

    def _wind_down(self, t) -> None:
        ev = self.event
        ev.state = "WINDING_DOWN"
        ev.set_phase("RECOVERY", t)
        self.dispatcher.cancel_event(ev.id, t, "event winding down")
        for rd in ev.rounds:
            if rd.state == "PENDING":
                rd.state = "SUPERSEDED"
        for r in self.resources.values():
            if r.setpoint > 0.01 or r.delivering > 0.5:
                c = self.dispatcher.create(t, ev.id, r, 0.0, 0.0, ev.direction, 0.0, None)
                self.dispatcher.send(c, t, r)
        self.audit.append("EVENT_WIND_DOWN", "system", ev.id,
                          f"Underlying requirement < {C.EVENT_CLOSE_MW:.0f} MW for {C.EVENT_CLOSE_TICKS} ticks — releasing resources")

    def manual_close(self, t, user) -> str:
        if not self.event or self.event.state != "OPEN":
            return "no open event"
        self.audit.append("EVENT_MANUAL_CLOSE", user, self.event.id, "Manual wind-down requested")
        self._wind_down(t)
        return "ok"

    # -------------------------------------------------------------- M&V
    def _mv(self, t, dt, gs, prices, dsm_table) -> None:
        ev = self.event
        dsign = 1.0 if ev.direction == "UP" else -1.0
        allocs = {a["id"]: a for a in (ev.plan or {}).get("allocations", [])}
        total = 0.0
        for r in self.resources.values():
            if r.type == "RTM":
                continue
            active = any(c.event == ev.id and c.state in ("SENT", "ACKED", "EXECUTING") and c.kind == "SET"
                         for c in self.dispatcher.commands if c.resource == r.id)
            d = r.delivering if r.direction == ev.direction else 0.0
            if not active and d < 0.5 and r.id not in ev.mv:
                continue
            m = ev.mv.setdefault(r.id, {"delivered_mwh": 0.0, "expected_mwh": 0.0, "name": r.name, "type": r.type,
                                        "pay_rate": allocs.get(r.id, {}).get("pay_rate", pay_rate(r, ev.direction, prices))})
            if r.id in allocs:
                m["pay_rate"] = allocs[r.id]["pay_rate"]
            m["delivered_mwh"] += d * dt / 3600
            if active and r.id in allocs:
                m["expected_mwh"] += allocs[r.id]["expected"][0] * dt / 3600
            total += d
        cf = dsm_amount(gs.deviation + dsign * total, gs.schedule, gs.freq, dsm_table, prices)
        act = dsm_amount(gs.deviation, gs.schedule, gs.freq, dsm_table, prices)
        ev.counterfactual_dsm += cf * dt / C.BLOCK_S
        ev.actual_dsm += act * dt / C.BLOCK_S

    def residual(self, t: float) -> float:
        """Residual for load rotation (§7): persistent planned shortfall + measured under-delivery past the window."""
        ev = self.event
        if not ev or ev.direction != "UP" or not ev.plan:
            return 0.0
        uns = ev.plan["unserved"]
        planned = min(uns[0], uns[1]) if len(uns) > 1 else uns[0]
        # requirement may have grown since the last solve
        grown = max(0.0, ev.requirement - ev.last_req) if ev.state == "OPEN" else 0.0
        under = 0.0
        for c in self.dispatcher.commands:
            if c.event != ev.id or c.kind != "SET" or c.state not in ("ACKED", "EXECUTING", "SENT") or c.sent_t is None:
                continue
            r = self.resources[c.resource]
            window = (r.response_delay_min + c.setpoint / max(r.ramp_mw_min, 1e-6)) * 60 + 60
            if t - c.sent_t > window:
                under += max(0.0, r.reliability * c.setpoint - r.delivering)
        # awaiting-approval MW count as not delivering once past their window too (no assumption of approval)
        return max(0.0, planned + grown + under)

    def lagging(self, t: float) -> list[dict]:
        out = []
        ev = self.event
        if not ev:
            return out
        for c in self.dispatcher.commands:
            if c.event != ev.id or c.kind != "SET" or c.state not in ("ACKED", "EXECUTING") or c.sent_t is None:
                continue
            r = self.resources[c.resource]
            window = (r.response_delay_min + c.setpoint / max(r.ramp_mw_min, 1e-6)) * 60 + 60
            exp = r.reliability * c.setpoint
            if t - c.sent_t > window and exp > 1 and r.delivering < C.UNDER_DELIVERY * exp:
                out.append({"resource": r.id, "name": r.name, "expected": round(exp, 1), "metered": round(r.delivering, 1)})
        return out

    # -------------------------------------------------------------- GridFlex block M&V
    def _accumulate_participants(self, ev, t: float) -> None:
        for p in self.gridflex.participants.values():
            r = self.resources[p.resource]
            if r.setpoint <= 0.01 and p.id not in ev.block_acc:
                continue
            acc = ev.block_acc.setdefault(p.id, {"meter": [], "acc": [], "offer": r.extra.get("offer")})
            acc["meter"].append(self.gridflex.meter_now.get(p.id, r.baseline))
            # accepted reduction counts once the offer's response time has elapsed since acknowledgement
            cmd = next((c for c in reversed(self.dispatcher.commands)
                        if c.event == ev.id and c.resource == r.id and c.ack_t is not None and c.kind == "SET"), None)
            due = cmd is not None and t - cmd.ack_t >= r.response_delay_min * 60
            acc["acc"].append(r.setpoint if (due and r.direction == ev.direction) else 0.0)
            if p.id not in {rec.participant for rec in self.gridflex.records.values() if rec.event == ev.id}:
                self.gridflex.start_record(ev.id, p.id, acc["offer"])

    def _close_participant_blocks(self, ev, t) -> None:
        for pid, acc in ev.block_acc.items():
            if not acc["meter"]:
                continue
            off = self.gridflex.offers.get(acc["offer"] or "")
            cap = off.mw if off else 0.0
            self.gridflex.close_block(ev.id, pid, acc["offer"], t, sum(acc["acc"]) / len(acc["acc"]),
                                      sum(acc["meter"]) / len(acc["meter"]), cap)
            acc["meter"], acc["acc"] = [], []

    # -------------------------------------------------------------- lifecycle
    def _advance_phase(self, t) -> None:
        ev = self.event
        cmds = [c for c in self.dispatcher.commands if c.event == ev.id and c.kind == "SET"]
        if not cmds or any(rd.state == "PENDING" for rd in ev.rounds):
            return
        if ev.rounds and all(rd.state != "PENDING" for rd in ev.rounds) and any(rd.state == "APPROVED" for rd in ev.rounds):
            ev.set_phase("APPROVED", t)
        elif not ev.rounds and any(c.state != "AWAITING_APPROVAL" for c in cmds):
            ev.set_phase("APPROVED", t)
        if any(c.sent_t is not None for c in cmds):
            ev.set_phase("ACTIVATING", t)
        if any(c.full_t is not None or (c.first_t is not None) for c in cmds):
            ev.set_phase("VERIFYING", t)
        sent = [c for c in cmds if c.sent_t is not None]
        if sent and all(c.state == "FAILED" for c in sent):
            ev.exception = "FAILED"
        if any(rec.status == "DISPUTED" for rec in self.gridflex.records.values() if rec.event == ev.id):
            ev.exception = "DISPUTED"

    # -------------------------------------------------------------- settlement
    def _close(self, t, prices, now_abs) -> None:
        ev = self.event
        self._close_participant_blocks(ev, t)
        lines, payments = [], 0.0
        rebound_rs = 0.0
        industrial_records = {rec.participant: rec for rec in self.gridflex.records.values() if rec.event == ev.id}
        for rid, m in ev.mv.items():
            r = self.resources[rid]
            exp, dl = m["expected_mwh"], m["delivered_mwh"]
            p = dl / exp if exp > 1e-6 else (1.0 if dl > 0 else 0.0)
            pf = 1.0 if p >= 0.9 else 0.0 if p <= 0.5 else (p - 0.5) / 0.4
            if r.type == "GENERATION":
                pf = 1.0
            rate = m["pay_rate"]
            pay = dl * 1000 * rate * pf
            source = "platform M&V"
            if r.type == "INDUSTRIAL" and r.participant in industrial_records:
                pay = industrial_records[r.participant].totals()["payment_rs"]
                industrial_records[r.participant].status = "SETTLED" if industrial_records[r.participant].status == "OPEN" else industrial_records[r.participant].status
                source = "GridFlex baseline M&V (settlement of record)"
            payments += pay
            rebound_rs += r.rebound_frac * dl * 1000 * C.OFFPEAK_PRICE
            old = r.reliability
            if exp > 1e-6:
                r.reliability = min(0.995, 0.8 * r.reliability + 0.2 * min(1.0, p))
            lines.append({"id": rid, "name": m["name"], "type": r.type, "expected_mwh": round(exp, 2),
                          "delivered_mwh": round(dl, 2), "performance": round(p, 3), "PF": round(pf, 3),
                          "rate": round(rate, 3), "payment_rs": round(pay), "source": source,
                          "reliability_old": round(old, 3), "reliability_new": round(r.reliability, 3)})
        avoided = ev.counterfactual_dsm - ev.actual_dsm
        rtm_rs = 0.0
        net = avoided - payments - rtm_rs - rebound_rs
        ledger = {"counterfactual_dsm": round(ev.counterfactual_dsm), "actual_dsm": round(ev.actual_dsm),
                  "dsm_avoided": round(avoided), "participant_payments": round(payments), "rtm_purchase": round(rtm_rs),
                  "rebound_energy": round(rebound_rs), "net_savings": round(net)}
        assert abs(ledger["counterfactual_dsm"] - ledger["actual_dsm"] - ledger["dsm_avoided"]) <= 1
        assert abs(ledger["dsm_avoided"] - ledger["participant_payments"] - ledger["rtm_purchase"] - ledger["rebound_energy"] - ledger["net_savings"]) <= 3
        ev.settlement = {"lines": lines, "ledger": ledger, "settled_t": t}
        ev.state, ev.closed_t = "CLOSED", t
        ev.set_phase("SETTLED", t)
        for r in self.resources.values():
            used = ev.mv.get(r.id)
            if used:
                r.blocks_used += max(1, int((t - ev.opened_t) // C.BLOCK_S))
        self.audit.append("SETTLE", "system", ev.id,
                          f"Settled: DSM avoided ₹{avoided:,.0f}, payments ₹{payments:,.0f}, rebound ₹{rebound_rs:,.0f}, net ₹{net:,.0f}")
        self.history.append(ev)
        self.history = self.history[-30:]
        self.event = None
        self.cooldown_until = t + C.EVENT_COOLDOWN_S
