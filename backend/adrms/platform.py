"""The control loop (§2): ingest → quality → estimate → assess → detect → decide → rotate → act → M&V → audit."""
from __future__ import annotations

import copy
import dataclasses
import json
import math
import os
import threading
import time
from collections import deque
from pathlib import Path

from . import config as C
from .alarms import AlarmEngine
from .assess import band_edges, dsm, dsm_amount, estimate, normal_rate
from .audit import AuditChain
from .dispatch import COMMAND_KEYS, Dispatcher
from .events import EventEngine
from .field import SCENARIOS, Field
from .forecast import Forecaster
from .gridflex import PROGRAMMES, GridFlex, IndustryDesk
from .network import BUSES, GENS, LINES
from .optimiser import solve
from .quality import QualityState, asset_vetoes, confidence, vetoes
from .resources import catalog
from .rotation import RotationManager
from .util import Rng, hhmm, r1

DATA_DIR = Path(os.environ.get("GNA_DATA_DIR", Path(__file__).resolve().parents[2] / "data"))
INTERRUPTION_COST_RS_KWH = 40.0   # DEMO: set per utility study


class Autonomy:
    def __init__(self) -> None:
        self.configured = "L2"
        self.suspended = False
        self.effective = "L2"
        self.reasons: list[str] = []

    def update(self, conf: float, vetoes_: list[str], latency_high: bool) -> None:
        reasons = []
        if self.suspended:
            reasons.append("kill switch (suspended)")
        if conf < C.CONF_ADVISORY:
            reasons.append(f"data confidence {conf * 100:.0f}% < 85%")
        reasons += vetoes_
        if latency_high:
            reasons.append("control-loop latency high")
        self.reasons = reasons
        lvl = self.configured
        if reasons and lvl in ("L2", "L3"):
            lvl = "L1"
        self.effective = lvl


class Platform:
    def __init__(self, seed: int = 7, start_h: float = 17.5, persist: bool = True) -> None:
        self.lock = threading.RLock()
        self.rng = Rng(seed)
        self.persist_enabled = persist
        self.res_list = catalog()
        self.resources = {r.id: r for r in self.res_list}
        self.field = Field(self.res_list, COMMAND_KEYS, seed=seed, start_h=start_h)
        self.audit = AuditChain(clock=lambda: self.field.t)
        self.quality = QualityState()
        self.forecaster = Forecaster()
        self.alarms = AlarmEngine(self.audit)
        self.dispatcher = Dispatcher(self.field, self.audit)
        self.gridflex = GridFlex(self.audit, Rng(seed + 1))
        self.desk = IndustryDesk(self.gridflex, self.audit)
        self.rotation = RotationManager(self.audit, Rng(seed + 2))
        self.engine = EventEngine(self.resources, self.dispatcher, self.gridflex, self.audit)
        self.autonomy = Autonomy()
        self.prices = dict(C.DEFAULT_PRICES)
        self.dsm_table = C.default_dsm()
        self.ace_offset = 0.0
        self.speed = 10.0
        self.running = True
        self.history: deque = deque(maxlen=720)
        self.latency: deque = deque(maxlen=10)
        self.last_minute = -1
        self.fc: dict = {}
        self.last_persist = time.time()
        self.tick_count = 0
        self.gs = None
        self.points = {}
        self.conf = 1.0
        self.vetoes: list[str] = []
        self.asset_veto: dict = {}
        self.snapshot_cache: dict = {}
        self._load()
        self.audit.append("START", "system", None, "GNA (Demand Response) platform started")
        self.tick(0.0)

    # ---------------------------------------------------------------- time
    @property
    def now_abs(self) -> float:
        return self.field.day * 86400 + self.field.t

    @property
    def block(self) -> int:
        return int(self.field.t // C.BLOCK_S) + 1

    # ---------------------------------------------------------------- loop
    def tick(self, dt: float | None = None) -> None:
        with self.lock:
            w0 = time.perf_counter()
            dt = self.speed if dt is None else dt
            f = self.field
            f.step(dt)
            t = f.t
            raw = f.telemetry()
            self.points = pts = self.quality.evaluate(raw, t)
            self.conf = confidence(pts)
            self.vetoes = vetoes(pts, f.source)
            self.asset_veto = asset_vetoes(pts)
            self.gs = gs = estimate(pts, t, self.dsm_table, self.prices, self.ace_offset)
            for r in self.res_list:
                p = pts.get(f"res:{r.id}")
                r.delivering = float(p.value or 0.0) if p else 0.0
                if r.type == "BESS" and pts[f"soc:{r.id}"].flag == "GOOD":
                    r.extra["soc_seen"] = pts[f"soc:{r.id}"].value
            self.gridflex.meter(self.resources, f.actual["res_mw"], self.block)
            ev = self.engine.event
            direction = ev.direction if ev else gs.direction
            minute = int(t // 60)
            if minute != self.last_minute or not self.fc:
                self.last_minute = minute
                self.fc = self.forecaster.update(t, gs, self.engine.delivering_total(direction) + self.rotation.measured_mw, direction)
            latency_high = len(self.latency) >= 3 and sum(list(self.latency)[-3:]) / 3 > C.LOOP_LATENCY_WARN_S
            prev_eff = self.autonomy.effective
            self.autonomy.update(self.conf, self.vetoes, latency_high)
            if prev_eff != self.autonomy.effective:
                self.audit.append("AUTONOMY", "policy", None, f"Autonomy {prev_eff} → {self.autonomy.effective}: {'; '.join(self.autonomy.reasons) or 'restored'}")
            hb_age = {k[3:]: p.age for k, p in pts.items() if k.startswith("hb:")}
            inc = next((i.id for i in reversed(self.alarms.incidents) if i.closed_at is None), None)
            notes = self.engine.step(t, self.now_abs, dt, gs, self.fc, self.autonomy, self.prices, self.dsm_table,
                                     self.asset_veto, hb_age, self.rotation.measured_mw, t / 3600, self.block, inc)
            # rotation
            ev = self.engine.event
            if ev:
                residual = self.engine.residual(t)
            elif self.rotation.order and self.rotation.order.state in ("ACTIVE", "RESTORING"):
                residual = max(0.0, -gs.ace + self.rotation.measured_mw)   # rotated-out MW stay counted in
            elif self.autonomy.effective == "L0" and gs.ace < 0:
                residual = -gs.ace
            else:
                residual = 0.0
            band1 = band_edges(self.dsm_table, gs.schedule)[0]
            self.rotation.step(t, self.now_abs, dt, residual, gs.freq, band1, gs.loads, f)
            self._alarms(t, gs, notes, hb_age, latency_high)
            self.history.append({
                "t": t, "freq": round(gs.freq, 4), "ace": r1(gs.ace), "demand": r1(gs.demand), "drawal": r1(gs.drawal),
                "schedule": r1(gs.schedule), "re": r1(gs.re), "req": r1(ev.requirement if ev else gs.requirement),
                "delivering": r1(self.engine.delivering_total(direction)), "rotated": r1(self.rotation.measured_mw),
                "dsm": gs.dsm["amount"], "conf": round(self.conf, 3),
            })
            self.tick_count += 1
            el = time.perf_counter() - w0
            self.latency.append(el)
            self.snapshot_cache = {}
            if self.persist_enabled and time.time() - self.last_persist >= C.PERSIST_EVERY_S:
                self.last_persist = time.time()
                self._save()

    # ---------------------------------------------------------------- alarms
    def _alarms(self, t, gs, notes, hb_age, latency_high) -> None:
        cond = []
        A = lambda key, p, title, detail, cat, delay, ref=None: cond.append(
            {"key": key, "priority": p, "title": title, "detail": detail, "category": cat, "delay": delay, "ref": ref})
        if gs.freq < C.F_EMERGENCY:
            A("freq_low", "P1", "Frequency low (emergency)", f"{gs.freq:.3f} Hz < 49.80", "frequency", 10)
        elif gs.freq < C.F_BAND_LOW:
            A("freq_low", "P2", "Frequency low", f"{gs.freq:.3f} Hz < 49.90", "frequency", 20)
        if gs.freq > C.F_BAND_HIGH:
            A("freq_high", "P3", "Frequency high", f"{gs.freq:.3f} Hz > 50.05", "frequency", 30)
        a = abs(gs.ace)
        if a >= 1000:
            A("ace", "P1", "ACE critical", f"ACE {gs.ace:.0f} MW", "balance", 20)
        elif a >= 300:
            A("ace", "P2", "ACE high", f"ACE {gs.ace:.0f} MW", "balance", 30)
        elif a >= 100:
            A("ace", "P3", "ACE outside band", f"ACE {gs.ace:.0f} MW", "balance", 60)
        for ln in LINES:
            ld = gs.loading[ln.id]
            if ld >= 1.0:
                A(f"line:{ln.id}", "P1", f"Line overload {ln.id}", f"{ln.frm}–{ln.to} {ld * 100:.0f}%", "network", 20, ln.id)
            elif ld >= 0.9:
                A(f"line:{ln.id}", "P3", f"Line high loading {ln.id}", f"{ln.frm}–{ln.to} {ld * 100:.0f}%", "network", 60, ln.id)
            if ln.id in gs.outages:
                A(f"out:{ln.id}", "P2", f"Line out of service {ln.id}", f"{ln.frm}–{ln.to} breaker open", "network", 0, ln.id)
        if len(gs.islands) > 1:
            A("island", "P1", "Islanding detected", f"{len(gs.islands)} islands", "network", 0)
        if self.conf < C.CONF_P2:
            A("conf", "P2", "Data confidence low", f"{self.conf * 100:.1f}% < 80%", "telemetry", 10)
        elif self.conf < C.CONF_P3:
            A("conf", "P3", "Data confidence degraded", f"{self.conf * 100:.1f}% < 97%", "telemetry", 30)
        for k, p in self.points.items():
            if k.split(":")[0] in ("freq", "bus", "gen", "schedule") and p.flag in ("STALE", "MISSING"):
                A(f"tm:{k}", "P3", f"Telemetry {p.flag.lower()}: {k}", f"age {p.age:.0f} s", "telemetry", 30, k)
        ev = self.engine.event
        active_ids = {c.resource for c in self.dispatcher.live()} if ev else set()
        for rid, age in hb_age.items():
            if age > C.HEARTBEAT_LOST_S:
                A(f"hb:{rid}", "P2" if rid in active_ids or (ev and rid in {a['id'] for a in (ev.plan or {}).get('allocations', [])}) else "P3",
                  f"Asset heartbeat lost: {self.resources[rid].name}", f"{age:.0f} s without heartbeat", "comms", 30, rid)
        for lag in self.engine.lagging(t):
            A(f"under:{lag['resource']}", "P2", f"Under-delivery: {lag['name']}", f"metered {lag['metered']:.0f} vs expected {lag['expected']:.0f} MW", "dispatch", 0, lag["resource"])
        for n in notes:
            if n.startswith("FAILED:"):
                _, rid, name = n.split(":", 2)
                A(f"cmdfail:{rid}:{int(t)}", "P2", f"Command failed: {name}", "no acknowledgement — asset excluded, re-solved", "dispatch", 0, rid)
        if abs(self.forecaster.z) >= 4:
            A("anomaly", "P3", "Demand anomaly", f"forecast residual z = {self.forecaster.z:.1f}", "forecast", 30)
        for v in (self.fc or {}).get("violations", []):
            if v["kind"] == "LINE" and v["block"] <= 2 and v["value"] >= 1.0:
                A(f"pred:{v['line']}", "P3", f"Predicted overload {v['line']}", f"{v['value'] * 100:.0f}% within 30 min", "forecast", 60, v["line"])
        if self.autonomy.suspended:
            A("suspended", "P3", "Autonomy suspended", "kill switch pressed", "autonomy", 0)
        elif self.autonomy.effective != self.autonomy.configured:
            A("degraded", "P2", "Autonomy degraded", "; ".join(self.autonomy.reasons), "autonomy", 0)
        if latency_high:
            A("latency", "P2", "Control-loop latency high", f"{sum(self.latency) / len(self.latency) * 1000:.0f} ms avg", "autonomy", 0)
        self.alarms.evaluate(t, cond)

    # ---------------------------------------------------------------- actions
    def action(self, name: str, user: dict, **kw) -> dict:
        with self.lock:
            t = self.field.t
            u = user["sub"]
            if name == "scenario_start":
                sc = self.field.start_scenario(kw["key"], kw.get("minutes"))
                self.audit.append("SCENARIO", u, kw["key"], f"Scenario started: {SCENARIOS[kw['key']]['label']} until {hhmm(sc.end)}")
            elif name == "scenario_stop":
                self.field.stop_scenario(kw["key"])
                self.audit.append("SCENARIO", u, kw["key"], f"Scenario stopped: {SCENARIOS[kw['key']]['label']}")
            elif name == "speed":
                self.speed = float(max(1, min(60, kw["speed"])))
            elif name == "pause":
                self.running = not bool(kw.get("paused", self.running))
            elif name == "autonomy":
                lvl = kw["level"]
                if lvl not in C.AUTONOMY_LEVELS:
                    return {"ok": False, "error": "unknown level"}
                self.audit.append("CONFIG", u, None, f"Autonomy level {self.autonomy.configured} → {lvl}")
                self.autonomy.configured = lvl
            elif name == "suspend":
                self.autonomy.suspended = bool(kw["on"])
                self.audit.append("KILL_SWITCH", u, None, "Autonomy suspended (kill switch)" if kw["on"] else "Kill switch released")
            elif name == "event_approve":
                r = self.engine.approve(u, user.get("dual", False), t)
                return {"ok": r == "ok", "error": None if r == "ok" else r}
            elif name == "event_reject":
                r = self.engine.reject(u, t, kw.get("reason", "rejected"))
                return {"ok": r == "ok", "error": None if r == "ok" else r}
            elif name == "event_close":
                r = self.engine.manual_close(t, u)
                return {"ok": r == "ok", "error": None if r == "ok" else r}
            elif name == "rotation_approve":
                r = self.rotation.approve(u, user.get("dual", False), t)
                return {"ok": r == "ok", "error": None if r == "ok" else r}
            elif name == "rotation_reject":
                self.rotation.reject(u, t, kw.get("reason", "rejected"))
            elif name == "rotation_manual":
                self.rotation.manual(float(kw["mw"]), u, t, self.gs.loads, self.now_abs)
            elif name == "rotation_band":
                self.rotation.band_override_mw = None if kw.get("mw") in (None, "") else float(kw["mw"])
                self.audit.append("CONFIG", u, None, f"Rotation band override: {self.rotation.band_override_mw}")
            elif name == "alarm_ack":
                ids = kw.get("ids") or [kw["id"]]
                for i in ids:
                    self.alarms.ack(i, u, t)
            elif name == "alarm_shelve":
                self.alarms.shelve(kw["id"], u, t, float(kw.get("minutes", 30)), kw.get("reason", "—"))
            elif name == "application_decide":
                return {"ok": self.desk.decide_application(kw["id"], bool(kw["accept"]), u)}
            elif name == "offer_decide":
                return {"ok": self.gridflex.decide(kw["id"], bool(kw["accept"]), u)}
            elif name == "mv_dispute":
                return {"ok": self.gridflex.dispute(kw["id"], u, kw.get("reason", "—"))}
            elif name == "mv_resolve":
                return {"ok": self.gridflex.resolve(kw["id"], u, float(kw.get("adjustment_rs", 0)), kw.get("note", "—"))}
            elif name == "dsm_table":
                try:
                    tbl = C.DsmTable.from_dict(kw["table"])
                except (ValueError, KeyError, TypeError) as e:
                    return {"ok": False, "error": str(e)}
                self.dsm_table = tbl
                self.audit.append("CONFIG", u, tbl.version, f"DSM rule table loaded: {tbl.version} ({tbl.source}, effective {tbl.effective_date})")
            elif name == "prices":
                for k in ("dam", "rtm", "ancillary"):
                    if k in kw:
                        self.prices[k] = float(kw[k])
                self.audit.append("CONFIG", u, None, f"Prices updated: {self.prices}")
            elif name == "source":
                self.field.source = "SLDC_WEB" if kw["mode"] == "SLDC_WEB" else "SIM"
                self.field.last_web_fetch = -1e9
                self.audit.append("CONFIG", u, None, f"Telemetry source → {self.field.source}")
            elif name == "offset":
                self.ace_offset = float(kw["mw"])
                self.audit.append("CONFIG", u, None, f"ACE offset → {self.ace_offset} MW")
            else:
                return {"ok": False, "error": f"unknown action {name}"}
            self.snapshot_cache = {}
            return {"ok": True}

    # ---------------------------------------------------------------- industry portal
    def _needs(self) -> list[dict]:
        gs = self.gs
        m250 = dsm(250, gs.schedule, C.F_NOMINAL, self.dsm_table, self.prices)["marginal_rate"]
        return self.desk.needs(self.field.t, normal_rate(self.prices)["NR"], m250)

    def industry_portal(self, claims: dict) -> dict:
        """Industry-facing view: SLDC offers and needs, plus this participant's own data only."""
        with self.lock:
            t = self.field.t
            pid = claims.get("participant")
            ev = self.engine.event
            out = {
                "app": "GNA (Demand Response) — Industry portal", "user": {"name": claims["name"], "participant": pid},
                "clock": {"t": t, "hhmm": hhmm(t), "block": self.block},
                "programmes": PROGRAMMES, "needs": self._needs(),
                "grid_status": {
                    "event_active": bool(ev and ev.direction == "UP"),
                    "condition": "EMERGENCY" if self.gs.severity == "EMERGENCY" else "TIGHT" if ev else "NORMAL",
                    "message": ("The SLDC is calling on flexibility now." if ev and ev.direction == "UP"
                                else "No demand-response event in progress."),
                },
                "baseline_method": self.gridflex.snapshot(self.resources, t / 3600)["baseline_method"],
                "applications": [a for a in self.desk.applications if a["by"] == claims["sub"]],
            }
            if not pid:
                out["participant"] = None
                return out
            p = self.gridflex.participants[pid]
            r = self.resources[p.resource]
            offers = [o for o in self.gridflex.offers.values() if o.participant == pid]
            cmds = [c.to_dict() for c in reversed(self.dispatcher.commands) if c.resource == r.id][:12]
            recs = [rec.to_dict() for rec in reversed(list(self.gridflex.records.values())) if rec.participant == pid]
            live = next((c for c in cmds if c["state"] in ("AWAITING_APPROVAL", "READY", "SENT", "ACKED", "EXECUTING") and c["kind"] == "SET"), None)
            o_now, why = self.gridflex.offer_for(pid, t / 3600)
            out["participant"] = {
                "id": p.id, "name": p.name, "discom": p.discom, "declared_mw": p.declared_mw, "processes": p.processes,
                "flexible_mw": sum(x["mw"] for x in p.processes), "reliability": round(r.reliability, 3),
                "baseline": round(self.gridflex.baseline(pid), 1), "meter": round(self.gridflex.meter_now.get(pid, r.baseline), 1),
                "instructed_mw": round(r.setpoint, 1), "delivering_mw": round(r.delivering, 1),
                "offer_now": o_now.id if o_now else None, "offer_status": None if o_now else why,
                "heartbeat_age": round(self.points[f"hb:{r.id}"].age, 1),
            }
            out["instruction"] = live
            out["offers"] = [o.__dict__ for o in offers]
            out["dispatches"] = cmds
            out["records"] = recs
            out["earnings"] = {
                "settled_rs": sum(x["totals"]["payment_rs"] for x in recs if x["status"] in ("SETTLED", "RESOLVED")),
                "held_rs": sum(x["totals"]["payment_rs"] for x in recs if x["status"] == "DISPUTED"),
                "open_rs": sum(x["totals"]["payment_rs"] for x in recs if x["status"] == "OPEN"),
                "verified_mwh": round(sum(x["totals"]["E_mwh"] for x in recs), 2),
            }
            meter_hist = list(self.gridflex.meter_hist[pid])
            out["meter_history"] = [round(x, 1) for x in meter_hist]
            return out

    def industry_action(self, name: str, claims: dict, **kw) -> dict:
        with self.lock:
            pid, u = claims.get("participant"), claims["sub"]
            if name == "apply":
                ok, msg = self.desk.apply(kw, u)
            elif not pid:
                return {"ok": False, "error": "enrol first: this account is not a registered participant"}
            elif name == "offer":
                ok, msg = self.desk.submit_offer(pid, kw, u)
            elif name == "withdraw":
                ok, msg = self.desk.withdraw(pid, kw["id"], u)
            elif name == "dispute":
                rec = next((r for r in self.gridflex.records.values() if r.id == kw["id"]), None)
                if not rec or rec.participant != pid:
                    return {"ok": False, "error": "record not found"}
                ok, msg = self.gridflex.dispute(rec.id, u, str(kw.get("reason", "—"))[:300]), "ok"
            else:
                return {"ok": False, "error": f"unknown action {name}"}
            self.snapshot_cache = {}
            return {"ok": ok, "error": None if ok else msg, "id": msg if ok else None}

    # ---------------------------------------------------------------- what-if (§11.5)
    def whatif(self, shortage: float, minutes: float, participation: float) -> dict:
        with self.lock:
            gs = copy.copy(self.gs)
            blocks = max(1, min(8, math.ceil(minutes / 15)))
            res_copy = {k: copy.copy(v) for k, v in self.resources.items()}
            for r in res_copy.values():
                r.setpoint = r.delivering = 0.0
            eng = EventEngine(res_copy, self.dispatcher, self.gridflex, self.audit)
            sev = "EMERGENCY" if shortage > C.ACE_EMERGENCY_MW else "ALERT"
            ctx, _ = eng.build_ctx(gs, self.fc, self.prices, self.dsm_table, 0.0, gs.t / 3600, severity=sev,
                                   direction="UP", req_override=shortage, participation=participation)
            ctx.blocks = blocks
            ctx.req = [shortage] * blocks
            ctx.deviations = [shortage] * blocks
            plan = solve(list(res_copy.values()), ctx)
            per_block = dsm_amount(shortage, gs.schedule, gs.freq, self.dsm_table, self.prices)
            no_action = per_block * blocks
            uns = plan["unserved"]
            persistent = min(uns[:2]) if len(uns) > 1 else uns[0]
            realised = persistent * 0.92
            picks, log, _ = self.rotation.select(persistent, gs.loads, self.now_abs) if persistent >= 1 else ([], [], [])
            stations = sum(len(g.stations) for g in picks)
            unserved_mwh = realised * minutes / 60
            dsm_after_rot = sum(dsm_amount(max(0.0, shortage - plan["supplied"][b] - realised), gs.schedule, gs.freq, self.dsm_table, self.prices)
                                for b in range(blocks))
            c = plan["costs"]
            paid = c["resource_rs"] + c["rtm_rs"]
            return {
                "inputs": {"shortage": shortage, "minutes": minutes, "participation": participation, "blocks": blocks},
                "no_action": {"dsm_rs": round(no_action), "per_block_rs": per_block},
                "flex_first": {"payments_rs": round(paid), "rebound_rs": c["rebound_rs"], "dsm_owed_rs": c["residual_dsm"],
                               "total_rs": c["total_rs"], "persistent_residual_mw": round(persistent, 1),
                               "allocations": [{"name": a["name"], "type": a["type"], "x1": a["x"][0], "exp": a["expected"]} for a in plan["allocations"]],
                               "supplied": plan["supplied"]},
                "rotation_assisted": {"rotated_mw": round(persistent, 1), "realised_mw": round(realised, 1),
                                      "groups": [g.id for g in picks], "stations": stations, "unserved_mwh": round(unserved_mwh, 1),
                                      "interruption_cost_rs": round(unserved_mwh * 1000 * INTERRUPTION_COST_RS_KWH),
                                      "interruption_cost_rate": INTERRUPTION_COST_RS_KWH,
                                      "dsm_owed_rs": round(dsm_after_rot),
                                      "total_rs": round(paid + c["rebound_rs"] + dsm_after_rot)},
            }

    # ---------------------------------------------------------------- snapshot
    def _event_dict(self, ev) -> dict | None:
        if ev is None:
            return None
        d = dataclasses.asdict(ev)
        d.pop("block_acc", None)
        d["commands"] = [c.to_dict() for c in self.dispatcher.commands if c.event == ev.id]
        d["mv_records"] = [r.to_dict() for r in self.gridflex.records.values() if r.event == ev.id]
        d["lagging"] = self.engine.lagging(self.field.t) if ev is self.engine.event else []
        return d

    def _shortage_ledger(self) -> dict | None:
        ev = self.engine.event
        if not ev or ev.direction != "UP":
            return None
        ind_ver = ind_planned = other = other_planned = 0.0
        for p in self.gridflex.participants.values():
            r = self.resources[p.resource]
            if r.setpoint <= 0.01 and r.delivering < 0.5:
                continue
            base = self.gridflex.baseline(p.id)
            ver = min(max(0.0, base - self.gridflex.meter_now.get(p.id, base)), r.setpoint)
            ind_ver += ver
            ind_planned += r.setpoint
        for r in self.res_list:
            if r.type != "INDUSTRIAL" and r.type != "RTM" and r.direction == "UP":
                other += r.delivering
                other_planned += r.setpoint
        rot = self.rotation.measured_mw
        rot_planned = self.rotation.planned_out()
        shortage = ev.requirement
        residual = shortage - ind_ver - other - rot
        esc = []
        for lag in self.engine.lagging(self.field.t):
            esc.append(f"{lag['name']} lagging: {lag['metered']:.0f} of {lag['expected']:.0f} MW")
        o = self.rotation.order
        if o and o.escalated:
            esc.append("Load rotation delivering under plan (metered < 90%)")
        band1 = band_edges(self.dsm_table, self.gs.schedule)[0]
        if residual > band1 and not o:
            esc.append(f"Residual {residual:.0f} MW beyond band ({band1:.0f} MW) with no rotation order")
        return {"shortage": round(shortage, 1), "industrial_verified": round(ind_ver, 1), "industrial_planned": round(ind_planned, 1),
                "other_metered": round(other, 1), "other_planned": round(other_planned, 1), "rotation_metered": round(rot, 1),
                "rotation_planned": round(rot_planned, 1), "residual": round(residual, 1), "escalations": esc,
                "emergency_override": self.gs.freq < C.F_EMERGENCY or self.gs.severity == "EMERGENCY"}

    def snapshot(self) -> dict:
        with self.lock:
            if self.snapshot_cache:
                return self.snapshot_cache
            gs, f, t = self.gs, self.field, self.field.t
            pts = self.points
            ev = self.engine.event
            ages = {"frequency": pts["freq"].age, "schedule": pts["schedule"].age,
                    "breakers": max(p.age for k, p in pts.items() if k.startswith("brk:")),
                    "sldc_fetch": (t - f.last_web_fetch) if f.source == "SLDC_WEB" else None}
            worst = max(v for v in ages.values() if v is not None)
            flags = {}
            for p in pts.values():
                flags[p.flag] = flags.get(p.flag, 0) + 1
            nr = normal_rate(self.prices)
            hour = t / 3600
            direction = ev.direction if ev else gs.direction
            snap = {
                "app": "GNA (Demand Response)",
                "clock": {"t": t, "hhmm": hhmm(t), "day": f.day, "block": self.block, "block_progress": (t % C.BLOCK_S) / C.BLOCK_S,
                          "speed": self.speed, "running": self.running, "tick": self.tick_count,
                          "latency_ms": round(sum(self.latency) / max(len(self.latency), 1) * 1000, 1)},
                "source": f.source,
                "quality": {"confidence": round(self.conf, 4), "worst_age_s": round(worst, 1), "ages": {k: (round(v, 1) if v is not None else None) for k, v in ages.items()},
                            "vetoes": self.vetoes, "asset_vetoes": self.asset_veto, "flags": flags},
                "grid": {
                    "freq": round(gs.freq, 4), "demand": r1(gs.demand), "in_state_gen": r1(gs.in_state_gen), "re": r1(gs.re),
                    "drawal": r1(gs.drawal), "schedule": r1(gs.schedule), "deviation": r1(gs.deviation), "ace": r1(gs.ace),
                    "ace_terms": {"interchange": r1(-gs.drawal + gs.schedule), "freq_term": r1(-10 * C.BIAS_MW_PER_0_1HZ * (gs.freq - 50)),
                                  "offset": self.ace_offset, "bias": C.BIAS_MW_PER_0_1HZ},
                    "direction": gs.direction, "requirement": r1(gs.requirement), "severity": gs.severity, "p90_margin": r1(gs.p90_margin),
                    "dsm": gs.dsm, "nr": nr, "freq_band": gs.dsm["freq_band"],
                    "demand_delta_blk": r1(gs.demand - self.history[-min(len(self.history), max(1, int(900 / max(self.speed, 1))))]["demand"]) if self.history else 0,
                    "buses": [{"id": b.id, "name": b.name, "lat": b.lat, "lon": b.lon, "discom": b.discom, "tie": b.tie,
                               "load": r1(gs.loads[b.id]), "flag": gs.bus_flags[b.id], "v": round(gs.voltage[b.id], 3),
                               "rotated": r1(f.rotated_mw.get(b.id, 0.0)),
                               "dr": r1(sum(r.delivering for r in self.res_list if r.bus == b.id and r.type != "RTM"))} for b in BUSES],
                    "lines": [{"id": ln.id, "from": ln.frm, "to": ln.to, "kv": ln.kv, "flow": r1(gs.flows[ln.id]), "limit": ln.limit,
                               "loading": round(gs.loading[ln.id], 3), "in_service": ln.id not in gs.outages} for ln in LINES],
                    "gens": [{"id": g.id, "name": g.name, "bus": g.bus, "kind": g.kind, "mw": r1(gs.gen[g.id]), "capacity": g.capacity,
                              "flag": pts[f"gen:{g.id}"].flag} for g in GENS],
                    "islands": len(gs.islands),
                    "worst_line": max(({"id": k, "loading": round(v, 3)} for k, v in gs.loading.items()), key=lambda x: x["loading"]),
                },
                "forecast": self.fc,
                "alarms": self.alarms.snapshot(t),
                "autonomy": {"configured": self.autonomy.configured, "effective": self.autonomy.effective,
                             "suspended": self.autonomy.suspended, "reasons": self.autonomy.reasons},
                "event": self._event_dict(ev),
                "events": [{"id": e.id, "opened_t": e.opened_t, "closed_t": e.closed_t, "direction": e.direction,
                            "req_at_open": round(e.req_at_open), "phase": e.phase, "exception": e.exception,
                            "net_savings": (e.settlement or {}).get("ledger", {}).get("net_savings")} for e in reversed(self.engine.history)],
                "event_history": {e.id: self._event_dict(e) for e in self.engine.history[-5:]},
                "resources": [{
                    "id": r.id, "name": r.name, "type": r.type, "tier": r.tier, "bus": r.bus, "discom": r.discom,
                    "available": r1(self._avail(r, direction, gs)), "reliability": round(r.reliability, 3),
                    "setpoint": r1(r.setpoint), "delivering": r1(r.delivering), "direction": r.direction,
                    "soc": round(r.soc, 3) if r.type == "BESS" else None, "capacity_mwh": r.capacity_mwh or None,
                    "response_min": r.response_delay_min, "ramp": r.ramp_mw_min, "max_blocks": r.max_blocks, "blocks_used": r.blocks_used,
                    "ancillary_mw": r.ancillary_mw, "contract_mw": r.contract_mw, "emergency_mw": r.emergency_mw,
                    "bid": r.bid, "hb_age": round(pts[f"hb:{r.id}"].age, 1), "veto": self.asset_veto.get(r.id),
                    "offer": r.extra.get("offer"),
                } for r in self.res_list],
                "commands": [c.to_dict() for c in reversed(self.dispatcher.commands[-40:])],
                "rotation": self.rotation.snapshot(gs.loads, self.now_abs),
                "gridflex": {**self.gridflex.snapshot(self.resources, hour), "programmes": PROGRAMMES,
                             "applications": list(reversed(self.desk.applications[-20:]))},
                "ledger": self._shortage_ledger(),
                "audit": {"length": len(self.audit.entries), "head": self.audit.head, "recent": list(reversed(self.audit.entries[-80:]))},
                "history": list(self.history),
                "scenarios": [{"key": k, **v, "active": bool(f.active(k)), "until": (lambda s: s.end if s else None)(f.active(k))}
                              for k, v in SCENARIOS.items()],
                "config": {"dsm_table": self.dsm_table.to_dict(), "prices": self.prices, "bias": C.BIAS_MW_PER_0_1HZ,
                           "offset": self.ace_offset, "band_edges": band_edges(self.dsm_table, gs.schedule),
                           "policy": {"event_open_hold_s": C.EVENT_OPEN_HOLD_S, "ack_timeout_s": C.ACK_TIMEOUT_S,
                                      "rotation_hold_s": C.ROTATION_HOLD_S, "dual_auth_mw": C.DUAL_AUTH_MW,
                                      "l2_envelope_mw": C.L2_ENVELOPE_MW, "ace_alert_mw": C.ACE_ALERT_MW}},
            }
            self.snapshot_cache = snap
            return snap

    def _avail(self, r, direction, gs) -> float:
        from .resources import available
        return available(r, direction, gs.severity, gs.gen)

    # ---------------------------------------------------------------- persistence (write-behind)
    def _save(self) -> None:
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            state = {
                "audit": self.audit.entries,
                "reliability": {r.id: r.reliability for r in self.res_list},
                "offers": {o.id: o.status for o in self.gridflex.offers.values()},
                "config": {"autonomy": self.autonomy.configured, "prices": self.prices, "dsm_table": self.dsm_table.to_dict()},
                "settlements": [{"id": e.id, "opened_t": e.opened_t, "closed_t": e.closed_t, "direction": e.direction,
                                 "settlement": e.settlement} for e in self.engine.history],
            }
            tmp = DATA_DIR / "state.json.tmp"
            tmp.write_text(json.dumps(state, default=str))
            tmp.replace(DATA_DIR / "state.json")
        except OSError:
            pass

    def _load(self) -> None:
        if not self.persist_enabled:
            return
        p = DATA_DIR / "state.json"
        if not p.exists():
            return
        try:
            st = json.loads(p.read_text())
        except (OSError, ValueError):
            return
        self.audit.entries = st.get("audit", [])
        if not self.audit.verify()["ok"]:
            self.audit.entries = []
        for rid, rel in st.get("reliability", {}).items():
            if rid in self.resources:
                self.resources[rid].reliability = rel
        for oid, status in st.get("offers", {}).items():
            if oid in self.gridflex.offers:
                self.gridflex.offers[oid].status = status
        cfg = st.get("config", {})
        self.autonomy.configured = cfg.get("autonomy", "L2")
        self.prices.update(cfg.get("prices", {}))
        try:
            if cfg.get("dsm_table"):
                self.dsm_table = C.DsmTable.from_dict(cfg["dsm_table"])
        except ValueError:
            pass
        self.audit.append("RESTORE", "system", None, f"State restored from disk ({len(self.audit.entries)} audit entries)")
