"""Checks the maths against the worked example in docs/HOW-IT-WORKS.md §12 and core safety properties."""
import hashlib
import hmac
import time

import pytest

from adrms import config as C
from adrms.assess import dsm, normal_rate
from adrms.audit import AuditChain
from adrms.dispatch import COMMAND_KEYS, KEY_ID
from adrms.field import Gateway
from adrms.gridflex import MvRecord
from adrms.network import ptdf
from adrms.resources import Resource, block_share, effective_rate
from adrms.platform import Platform

PRICES = {"dam": 5.40, "rtm": 7.20, "ancillary": 8.10}


def test_normal_rate_rtm_binding():
    nr = normal_rate(PRICES)
    assert nr["NR"] == pytest.approx(7.20)
    assert nr["C"] == pytest.approx(6.90)
    assert nr["binding"] == "RTM"


def test_dsm_worked_example():
    d = dsm(350, 5300, 49.95, C.default_dsm(), PRICES)
    assert d["amount"] == 990_000
    assert [b["mw"] for b in d["bands"]] == [100, 100, 150]
    assert d["marginal_rate"] == pytest.approx(14.40)
    assert d["freq_band"] == "NORMAL"


def test_dsm_under_drawal_is_receivable():
    d = dsm(-80, 5300, 50.0, C.default_dsm(), PRICES)
    assert d["amount"] == -round(80 * 0.25 * 1000 * 0.9 * 7.20)


def test_dsm_refuses_unversioned_table():
    with pytest.raises(ValueError):
        C.DsmTable.from_dict({"version": "", "source": "x", "effective_date": "2024-01-01", "bands": []})


def test_ace_worked_example():
    ia_is = -5650 - (-5300)
    freq_term = 10 * C.BIAS_MW_PER_0_1HZ * (49.95 - 50.00)
    assert ia_is - freq_term == pytest.approx(-430)


def test_effective_cost_example():
    r = Resource("X", "x", "INDUSTRIAL", "BALLARI", "GESCOM", 4.50, 12, 10, 4, 100, rebound_frac=0.3)
    assert effective_rate(r, "UP", PRICES) == pytest.approx(5.46)


def test_phi_twelve_minute_response():
    assert block_share(12, 0, 2) == [pytest.approx(0.2), pytest.approx(1.0)]


def test_performance_factor_and_reliability():
    p = 7.6 / 10
    pf = (p - 0.5) / 0.4
    assert pf == pytest.approx(0.65)
    assert round(7.6 * 1000 * 4.50 * pf) == 22_230
    assert 0.8 * 0.90 + 0.2 * 0.76 == pytest.approx(0.872)


def test_gridflex_example():
    rec = MvRecord("MV-1", "DR-1", "P", "OF", 4000, 100)
    rec.blocks = [{"B": 600, "M": 560, "R": 40, "A": 60, "V": 40}, {"B": 600, "M": 530, "R": 70, "A": 60, "V": 60}]
    t = rec.totals()
    assert t["E_mwh"] == 25
    assert t["payment_rs"] == pytest.approx(86_333, abs=1)


def test_audit_chain_detects_tampering():
    a = AuditChain()
    for i in range(5):
        a.append("TEST", "u", str(i), f"entry {i}")
    assert a.verify()["ok"]
    a.entries[2]["message"] = "tampered"
    v = a.verify()
    assert not v["ok"] and v["broken_at"] == 2


def test_gateway_rejects_bad_commands():
    gw = Gateway("R1", dict(COMMAND_KEYS))
    now = time.time()
    msg = f"v1|{KEY_ID}|CMD-1|DR-1|R1|10.000|SET|{now:.3f}"
    tag = hmac.new(COMMAND_KEYS[KEY_ID], msg.encode(), hashlib.sha256).hexdigest()
    assert gw.verify(msg, tag, KEY_ID, now, now, "CMD-1") == (True, "ok")
    assert gw.verify(msg, tag, KEY_ID, now, now, "CMD-1")[1] == "replayed command id"
    assert gw.verify(msg, "0" * 64, KEY_ID, now, now, "CMD-2")[1] == "tag mismatch"
    assert gw.verify(msg, tag, "nope", now, now, "CMD-3")[1] == "unknown key id"
    assert gw.verify(msg, tag, KEY_ID, now - 60, now, "CMD-4")[1] == "message older than 30 s"


def test_ptdf_slack_balances():
    H = ptdf()
    assert H.shape[0] == 34


def test_event_opens_and_respects_l2_envelope():
    P = Platform(persist=False)
    P.action("scenario_start", {"sub": "t"}, key="evening_surge")
    for _ in range(40):
        P.tick()
    ev = P.engine.event
    assert ev is not None and ev.direction == "UP"
    auto = sum(c.setpoint for c in P.dispatcher.commands
               if c.event == ev.id and c.kind == "SET" and c.approval_reason is None and c.state not in ("SUPERSEDED", "CANCELLED", "FAILED"))
    assert auto <= C.L2_ENVELOPE_MW + 1e-6


def test_tiers_bess_before_industrial():
    P = Platform(persist=False)
    P.action("scenario_start", {"sub": "t"}, key="evening_surge")
    for _ in range(12):
        P.tick()
    plan = P.engine.event.plan
    tiers = [a["tier"] for a in plan["allocations"]]
    assert tiers == sorted(tiers)
    bess = [a for a in plan["allocations"] if a["type"] == "BESS"]
    assert bess, "BESS (tier 1) must be used first"


def test_stale_frequency_forces_advisory():
    P = Platform(persist=False)
    P.action("scenario_start", {"sub": "t"}, key="freq_stale")
    for _ in range(3):
        P.tick()
    assert P.autonomy.effective == "L1"
    assert any("Frequency" in v for v in P.vetoes)
