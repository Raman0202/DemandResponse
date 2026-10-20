"""GridFlex: industrial flexibility envelopes, offers, baseline M&V and disputes (§11). Programme values are DEMO."""
from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass, field

from .util import Rng, uid

BASELINE_METHOD = "B4-mean±10% v1"


@dataclass
class Offer:
    id: str
    participant: str
    mw: float
    window: tuple[float, float]           # hours, may wrap midnight
    response_min: float
    min_activation_min: float
    max_duration_min: float
    recovery_min: float
    price_rs_mwh: float
    availability_rs_mw_h: float
    restrictions: str
    programme: str                        # committed | voluntary
    status: str                           # ACCEPTED | PENDING | REJECTED | WITHDRAWN
    decided_by: str | None = None
    programme_id: str | None = None

    def covers(self, hour: float) -> bool:
        a, b = self.window
        return a <= hour < b if a < b else (hour >= a or hour < b)


@dataclass
class Participant:
    id: str
    name: str
    resource: str
    discom: str
    declared_mw: float
    processes: list[dict]
    reliability: float


@dataclass
class MvRecord:
    id: str
    event: str
    participant: str
    offer: str
    price_rs_mwh: float
    availability_rs_mw_h: float
    blocks: list[dict] = field(default_factory=list)   # {t, B, M, R, A, V}
    status: str = "OPEN"                                # OPEN | SETTLED | DISPUTED | RESOLVED
    dispute: dict | None = None
    adjustment_rs: float = 0.0
    method: str = BASELINE_METHOD
    baseline_mw: float = 0.0

    def totals(self) -> dict:
        E = sum(b["V"] * 0.25 for b in self.blocks)
        Aenergy = sum(b["A"] * 0.25 for b in self.blocks)
        p = E / Aenergy if Aenergy > 1e-6 else 0.0
        pf = 1.0 if p >= 0.9 else 0.0 if p <= 0.5 else (p - 0.5) / 0.4
        energy_rs = E * self.price_rs_mwh
        avail_rs = sum(b["A"] for b in self.blocks) * 0.25 * self.availability_rs_mw_h
        adj = -energy_rs * (1 - pf)
        pay = energy_rs + avail_rs + adj + self.adjustment_rs
        return {"E_mwh": round(E, 2), "accepted_mwh": round(Aenergy, 2), "performance": round(p, 3), "PF": round(pf, 3),
                "energy_rs": round(energy_rs), "availability_rs": round(avail_rs), "pf_adjustment_rs": round(adj),
                "manual_adjustment_rs": round(self.adjustment_rs), "payment_rs": round(pay),
                "held": self.status == "DISPUTED"}

    def to_dict(self) -> dict:
        d = self.__dict__.copy()
        d["totals"] = self.totals()
        return d


def _participants() -> list[Participant]:
    P = Participant
    return [
        P("P_JSW", "JSW Steel, Toranagallu", "IND_JSW", "GESCOM", 600, [
            {"name": "Rolling-mill reschedule", "mw": 120, "response_min": 12, "duration_min": 60, "restriction": "not during coil change-over"},
            {"name": "Oxygen plant trim", "mw": 60, "response_min": 10, "duration_min": 90, "restriction": "—"},
            {"name": "Non-critical pumping & HVAC", "mw": 30, "response_min": 5, "duration_min": 120, "restriction": "—"}], 0.86),
        P("P_MRPL", "MRPL refinery, Mangaluru", "IND_MRPL", "MESCOM", 210, [
            {"name": "Captive generation step-up", "mw": 40, "response_min": 8, "duration_min": 60, "restriction": "—"},
            {"name": "Utility compressor trim", "mw": 20, "response_min": 6, "duration_min": 60, "restriction": "no activation during crude switch"}], 0.94),
        P("P_CEMENT", "Cement cluster, Shahabad", "IND_CEMENT", "GESCOM", 260, [
            {"name": "Raw-mill & crusher stop", "mw": 90, "response_min": 15, "duration_min": 90, "restriction": "silo level > 40%"},
            {"name": "Packing plant shift", "mw": 20, "response_min": 10, "duration_min": 60, "restriction": "—"}], 0.9),
        P("P_TKM", "Auto plants, Bidadi", "IND_TKM", "BESCOM", 120, [
            {"name": "Paint-shop HVAC setback", "mw": 25, "response_min": 5, "duration_min": 45, "restriction": "not during critical curing"},
            {"name": "Compressed-air trim", "mw": 20, "response_min": 5, "duration_min": 45, "restriction": "—"}], 0.95),
        P("P_DC", "Data-centre campus, Whitefield", "IND_DC", "BESCOM", 180, [
            {"name": "Transfer to on-site BESS/DG", "mw": 50, "response_min": 2, "duration_min": 60, "restriction": "N+1 cooling maintained"},
            {"name": "Chilled-water setpoint", "mw": 10, "response_min": 3, "duration_min": 60, "restriction": "—"}], 0.97),
        P("P_SUGAR", "Sugar co-gen cluster, Belagavi", "IND_SUGAR", "HESCOM", 90, [
            {"name": "Batch centrifuge reschedule", "mw": 40, "response_min": 10, "duration_min": 60, "restriction": "crushing season only"}], 0.8),
    ]


def _offers() -> list[Offer]:
    O = Offer
    offers = [
        O("OF-JSW-EVE", "P_JSW", 180, (17.0, 23.5), 12, 15, 60, 120, 4500, 100, "No activation during coil change-over", "committed", "ACCEPTED", "programme"),
        O("OF-MRPL-EVE", "P_MRPL", 60, (16.0, 23.0), 8, 15, 60, 60, 5200, 80, "No activation during crude switch", "committed", "ACCEPTED", "programme"),
        O("OF-CEM-DAY", "P_CEMENT", 110, (6.0, 23.0), 15, 30, 90, 90, 3900, 60, "Silo level > 40%", "committed", "ACCEPTED", "programme"),
        O("OF-TKM-DAY", "P_TKM", 45, (9.0, 17.0), 5, 15, 45, 60, 6100, 0, "Not during critical curing", "voluntary", "ACCEPTED", "operator"),
        O("OF-DC-EVE", "P_DC", 60, (18.0, 23.0), 2, 15, 60, 30, 7800, 120, "N+1 cooling maintained", "committed", "ACCEPTED", "programme"),
        O("OF-SUGAR-EVE", "P_SUGAR", 40, (17.0, 22.0), 10, 15, 60, 60, 4200, 0, "Crushing season only", "voluntary", "PENDING"),
    ]
    prog = {"OF-JSW-EVE": "PRG-EVE", "OF-MRPL-EVE": "PRG-EVE", "OF-CEM-DAY": "PRG-DAY", "OF-TKM-DAY": "PRG-DAY",
            "OF-DC-EVE": "PRG-EVE", "OF-SUGAR-EVE": "PRG-DAY"}
    for o in offers:
        o.programme_id = prog[o.id]
    return offers


class GridFlex:
    def __init__(self, audit, rng: Rng) -> None:
        self.audit = audit
        self.rng = rng
        self.participants = {p.id: p for p in _participants()}
        self.offers = {o.id: o for o in _offers()}
        self.records: dict[str, MvRecord] = {}            # key event:participant
        self.meter_hist: dict[str, deque] = defaultdict(lambda: deque(maxlen=8))   # block averages
        self._acc: dict[str, list[float]] = defaultdict(list)
        self._last_block: int | None = None
        self.meter_now: dict[str, float] = {}

    # ------------------------------------------------------------ offers
    def offer_for(self, participant: str, hour: float) -> tuple[Offer | None, str | None]:
        cands = [o for o in self.offers.values() if o.participant == participant and o.covers(hour)]
        acc = [o for o in cands if o.status == "ACCEPTED"]
        if acc:
            return acc[0], None
        if any(o.status == "PENDING" for o in cands):
            return None, "offer awaiting acceptance"
        return None, "no accepted offer covering this window"

    def decide(self, offer_id: str, accept: bool, user: str) -> bool:
        o = self.offers.get(offer_id)
        if not o or o.status != "PENDING":
            return False
        o.status, o.decided_by = ("ACCEPTED" if accept else "REJECTED"), user
        self.audit.append("OFFER", user, o.id, f"Offer {o.id} {'accepted' if accept else 'rejected'}")
        return True

    def apply_offers(self, resources: dict, hour: float) -> dict[str, str]:
        """Bind industrial resources to their offer terms; returns exclusions."""
        excl = {}
        for p in self.participants.values():
            r = resources[p.resource]
            o, why = self.offer_for(p.id, hour)
            if o is None:
                excl[r.id] = why
                continue
            r.contract_mw = o.mw
            r.bid = o.price_rs_mwh / 1000
            r.response_delay_min = o.response_min
            r.max_blocks = max(1, int(o.max_duration_min // 15))
            r.extra["offer"] = o.id
        return excl

    # ------------------------------------------------------------ metering (revenue meter, independent of the gateway)
    def meter(self, resources: dict, res_mw: dict[str, float], block: int) -> None:
        if self._last_block is not None and block != self._last_block:
            for pid, xs in self._acc.items():
                if xs:
                    self.meter_hist[pid].append(sum(xs) / len(xs))
            self._acc.clear()
        self._last_block = block
        for p in self.participants.values():
            r = resources[p.resource]
            sign = 1 if r.direction == "UP" else -1
            m = r.baseline * (1 + 0.008 * self.rng.normal()) - sign * res_mw.get(r.id, 0.0)
            self._acc[p.id].append(m)
            self.meter_now[p.id] = m

    def baseline(self, pid: str) -> float:
        p = self.participants[pid]
        r_decl = p.declared_mw
        hist = list(self.meter_hist[pid])[-4:]
        b = sum(hist) / len(hist) if hist else r_decl
        return min(max(b, 0.9 * r_decl), 1.1 * r_decl)

    def start_record(self, event: str, pid: str, offer_id: str | None) -> MvRecord:
        """Open the M&V record; the baseline is frozen at event start."""
        key = f"{event}:{pid}"
        if key not in self.records:
            off = self.offers.get(offer_id or "")
            rec = MvRecord(uid("MV"), event, pid, off.id if off else "—", off.price_rs_mwh if off else 0,
                           off.availability_rs_mw_h if off else 0)
            rec.baseline_mw = self.baseline(pid)
            self.records[key] = rec
        return self.records[key]

    def close_block(self, event: str, pid: str, offer_id: str | None, t: float, accepted_mw: float,
                    metered_avg: float, offer_cap: float) -> dict:
        rec = self.start_record(event, pid, offer_id)
        B = rec.baseline_mw
        R = max(0.0, B - metered_avg)
        A = min(accepted_mw, offer_cap)
        V = min(R, A)
        blk = {"t": t, "B": round(B, 1), "M": round(metered_avg, 1), "R": round(R, 1), "A": round(A, 1), "V": round(V, 1)}
        rec.blocks.append(blk)
        return blk

    def dispute(self, rec_id: str, user: str, reason: str) -> bool:
        rec = next((r for r in self.records.values() if r.id == rec_id), None)
        if not rec or rec.status == "DISPUTED":
            return False
        rec.status, rec.dispute = "DISPUTED", {"by": user, "reason": reason}
        self.audit.append("MV_DISPUTE", user, rec.id, f"Disputed ({reason}) — payment held")
        return True

    def resolve(self, rec_id: str, user: str, adjustment_rs: float, note: str) -> bool:
        rec = next((r for r in self.records.values() if r.id == rec_id), None)
        if not rec or rec.status != "DISPUTED":
            return False
        rec.status, rec.adjustment_rs = "RESOLVED", adjustment_rs
        rec.dispute = {**(rec.dispute or {}), "resolved_by": user, "note": note, "adjustment_rs": adjustment_rs}
        self.audit.append("MV_RESOLVE", user, rec.id, f"Resolved with audited adjustment ₹{adjustment_rs:,.0f}: {note}")
        return True

    def snapshot(self, resources: dict, hour: float) -> dict:
        out = []
        for p in self.participants.values():
            r = resources[p.resource]
            o, why = self.offer_for(p.id, hour)
            out.append({
                "id": p.id, "name": p.name, "discom": p.discom, "resource": p.resource, "declared_mw": p.declared_mw,
                "processes": p.processes, "reliability": round(r.reliability, 3), "offer": o.id if o else None,
                "status": "available" if o else why, "baseline": round(self.baseline(p.id), 1),
                "meter": round(self.meter_now.get(p.id, r.baseline), 1), "activated": round(r.setpoint, 1),
                "delivering": round(r.delivering, 1),
            })
        return {"participants": out, "offers": [o.__dict__ for o in self.offers.values()],
                "records": [r.to_dict() for r in reversed(list(self.records.values())[-30:])],
                "baseline_method": BASELINE_METHOD}


# ---------------------------------------------------------------- industry portal (§11, industry-facing)

PROGRAMMES = [
    {"id": "PRG-EVE", "name": "Evening Peak Flex", "type": "committed", "direction": "UP", "status": "OPEN",
     "summary": "Reduce load during the evening ramp when the state over-draws.",
     "window": [17.0, 23.5], "min_mw": 10, "max_response_min": 15, "duration_min": [30, 90],
     "max_activations_day": 2, "energy_cap_rs_mwh": 6500, "availability_rs_mw_h": [60, 120],
     "settlement": "Verified MWh × offer price + availability, performance factor below 90% of accepted energy",
     "requirements": ["Revenue-grade 15-min meter", "DR gateway with authenticated setpoints", "Baseline method B4-mean±10%"]},
    {"id": "PRG-EMG", "name": "Emergency Interruptible", "type": "committed", "direction": "UP", "status": "OPEN",
     "summary": "Fast curtailment when frequency is low or the grid is in emergency.",
     "window": [0.0, 24.0], "min_mw": 20, "max_response_min": 5, "duration_min": [15, 45],
     "max_activations_day": 1, "energy_cap_rs_mwh": 8500, "availability_rs_mw_h": [120, 180],
     "settlement": "As Evening Peak Flex; emergency share released only in EMERGENCY",
     "requirements": ["Automated gateway (no manual step)", "Heartbeat ≤ 60 s", "Tested quarterly"]},
    {"id": "PRG-DAY", "name": "Voluntary Day-ahead Flex", "type": "voluntary", "direction": "UP", "status": "OPEN",
     "summary": "Offer flexibility for tomorrow's blocks; the SLDC accepts what it needs.",
     "window": [6.0, 23.0], "min_mw": 5, "max_response_min": 30, "duration_min": [15, 120],
     "max_activations_day": 3, "energy_cap_rs_mwh": 5500, "availability_rs_mw_h": [0, 0],
     "settlement": "Energy only, verified MWh × offer price",
     "requirements": ["Revenue-grade 15-min meter"]},
    {"id": "PRG-SOLAR", "name": "Solar-hour Load Shift (absorb surplus)", "type": "voluntary", "direction": "DOWN",
     "status": "CONSULTATION",
     "summary": "Move flexible load into midday solar hours when the state under-draws. Expressions of interest only.",
     "window": [10.0, 16.0], "min_mw": 10, "max_response_min": 30, "duration_min": [30, 180],
     "max_activations_day": 1, "energy_cap_rs_mwh": 1500, "availability_rs_mw_h": [0, 0],
     "settlement": "To be notified after consultation", "requirements": ["Revenue-grade 15-min meter"]},
]
PROG_BY_ID = {p["id"]: p for p in PROGRAMMES}


def _covers(window, h):
    a, b = window
    return a <= h < b if a < b else (h >= a or h < b)


class IndustryDesk:
    """What the SLDC offers and needs, and the industry's side of offers and applications."""

    def __init__(self, gridflex: GridFlex, audit) -> None:
        self.gf = gridflex
        self.audit = audit
        self.applications: list[dict] = []
        self.notices: list[dict] = []

    def needs(self, t: float, nr: float, marginal_250: float) -> list[dict]:
        """Indicative flexibility the SLDC wants per hour over the next 24 h (DEMO model).

        Stress = net demand (demand − RE) above a comfortable level, scaled to MW,
        plus a forecast-error reserve; the price ceiling is 80% of the DSM marginal
        rate the flexibility would avoid.
        """
        from .field import day_ahead
        out = []
        start = int(t // 3600)
        for k in range(24):
            h = (start + k) % 24
            da = day_ahead(h + 0.5)
            net = da["demand"] - da["re"]
            stress = max(0.0, (net - 9800) / 2600)
            reserve = 1.28 * ((0.005 * da["demand"]) ** 2 + (0.06 * da["re"]) ** 2) ** 0.5
            want = round(min(1200, stress * 700 + (reserve * 0.5 if stress > 0.2 else 0)) / 10) * 10
            committed = 0.0
            for o in self.gf.offers.values():
                if o.status == "ACCEPTED" and o.covers(h + 0.5):
                    committed += o.mw
            level = "HIGH" if want >= 600 else "MEDIUM" if want >= 250 else "LOW" if want > 0 else "NONE"
            out.append({"hour": h, "label": f"{h:02d}:00–{(h + 1) % 24:02d}:00", "desired_mw": want,
                        "committed_mw": round(committed), "gap_mw": max(0, round(want - committed)),
                        "level": level, "price_ceiling_rs_mwh": round(0.8 * marginal_250 * 1000) if want else 0,
                        "programmes": [p["id"] for p in PROGRAMMES if p["status"] == "OPEN" and _covers(p["window"], h + 0.5)]})
        return out

    def submit_offer(self, pid: str, d: dict, user: str) -> tuple[bool, str]:
        p = self.gf.participants.get(pid)
        prog = PROG_BY_ID.get(d.get("programme", ""))
        if not p or not prog:
            return False, "unknown participant or programme"
        if prog["status"] != "OPEN":
            return False, f"{prog['name']} is not open for offers ({prog['status'].lower()})"
        try:
            mw = float(d["mw"])
            w0, w1 = float(d["start_h"]), float(d["end_h"])
            resp = float(d["response_min"])
            dur = float(d["max_duration_min"])
            price = float(d["price_rs_mwh"])
            avail = float(d.get("availability_rs_mw_h", 0))
        except (KeyError, TypeError, ValueError):
            return False, "MW, window, response, duration and price are required numbers"
        flex = sum(x["mw"] for x in p.processes)
        errs = []
        if mw < prog["min_mw"]:
            errs.append(f"minimum {prog['min_mw']} MW")
        if mw > flex:
            errs.append(f"exceeds your declared flexible range ({flex:.0f} MW)")
        if resp > prog["max_response_min"]:
            errs.append(f"response must be ≤ {prog['max_response_min']} min")
        if not (prog["duration_min"][0] <= dur <= prog["duration_min"][1]):
            errs.append(f"duration must be {prog['duration_min'][0]}–{prog['duration_min'][1]} min")
        if price > prog["energy_cap_rs_mwh"]:
            errs.append(f"price above programme cap ₹{prog['energy_cap_rs_mwh']:,}/MWh")
        lo, hi = prog["availability_rs_mw_h"]
        if avail and not (lo <= avail <= hi):
            errs.append(f"availability must be ₹{lo}–{hi}/MW·h")
        if not (0 <= w0 < 24 and 0 < w1 <= 24 and w0 != w1):
            errs.append("window hours must be within 0–24")
        if errs:
            return False, "; ".join(errs)
        oid = uid("OF")
        self.gf.offers[oid] = Offer(oid, pid, mw, (w0, w1), resp, 15, dur, float(d.get("recovery_min", 60)), price, avail,
                                    str(d.get("restrictions", "—"))[:200], prog["type"], "PENDING")
        self.gf.offers[oid].programme_id = prog["id"]
        self.audit.append("OFFER_SUBMIT", user, oid, f"{p.name} offered {mw:.0f} MW {w0:05.2f}–{w1:05.2f}h at ₹{price:,.0f}/MWh under {prog['name']}")
        return True, oid

    def withdraw(self, pid: str, oid: str, user: str) -> tuple[bool, str]:
        o = self.gf.offers.get(oid)
        if not o or o.participant != pid:
            return False, "offer not found"
        if o.status not in ("PENDING", "ACCEPTED"):
            return False, f"offer is {o.status.lower()}"
        o.status = "WITHDRAWN"
        self.audit.append("OFFER_WITHDRAW", user, oid, f"Offer {oid} withdrawn by participant")
        return True, "ok"

    def apply(self, d: dict, user: str) -> tuple[bool, str]:
        req = ["company", "discom", "sector", "flexible_mw", "contact"]
        if any(not str(d.get(k, "")).strip() for k in req):
            return False, "company, DISCOM, sector, flexible MW and contact are required"
        try:
            mw = float(d["flexible_mw"])
        except ValueError:
            return False, "flexible MW must be a number"
        app = {"id": uid("APP"), "company": str(d["company"])[:120], "discom": str(d["discom"])[:20],
               "sector": str(d["sector"])[:60], "flexible_mw": mw, "contact": str(d["contact"])[:120],
               "programmes": [x for x in d.get("programmes", []) if x in PROG_BY_ID],
               "processes": str(d.get("processes", ""))[:500], "status": "SUBMITTED", "by": user}
        self.applications.append(app)
        self.audit.append("APPLICATION", user, app["id"], f"Enrolment application: {app['company']} ({mw:.0f} MW, {app['discom']})")
        return True, app["id"]

    def decide_application(self, aid: str, accept: bool, user: str) -> bool:
        a = next((x for x in self.applications if x["id"] == aid and x["status"] == "SUBMITTED"), None)
        if not a:
            return False
        a["status"], a["decided_by"] = ("ACCEPTED_FOR_ONBOARDING" if accept else "DECLINED"), user
        self.audit.append("APPLICATION", user, aid, f"Application {a['company']} {'accepted for onboarding' if accept else 'declined'}")
        return True
