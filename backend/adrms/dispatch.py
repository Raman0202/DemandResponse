"""Command lifecycle, HMAC-SHA-256 authentication, dead-band and four clocks (§5.7)."""
from __future__ import annotations

import hashlib
import hmac
import os
import secrets
import time
from dataclasses import dataclass, field

from . import config as C
from .util import uid

KEY_ID = os.environ.get("GNA_COMMAND_KEY_ID", "k1")
COMMAND_KEY = bytes.fromhex(os.environ["GNA_COMMAND_KEY"]) if os.environ.get("GNA_COMMAND_KEY") else secrets.token_bytes(32)
COMMAND_KEYS = {KEY_ID: COMMAND_KEY}   # the gateways receive their own copy at provisioning

TERMINAL = {"COMPLETED", "FAILED", "CANCELLED", "SUPERSEDED"}


@dataclass
class Command:
    id: str
    event: str
    resource: str
    name: str
    rtype: str
    direction: str
    setpoint: float
    expected: float
    kind: str                          # SET | RELEASE
    state: str
    created_t: float
    pay_rate: float = 0.0
    approval_reason: str | None = None
    approvals: list[str] = field(default_factory=list)
    sent_t: float | None = None
    ack_t: float | None = None
    first_t: float | None = None
    full_t: float | None = None
    start_mw: float = 0.0
    fail_reason: str | None = None
    tag: str | None = None
    msg: str | None = None
    closed_t: float | None = None

    def to_dict(self) -> dict:
        d = self.__dict__.copy()
        d["clocks"] = {
            "ack_s": None if self.ack_t is None or self.sent_t is None else round(self.ack_t - self.sent_t),
            "first_s": None if self.first_t is None or self.sent_t is None else round(self.first_t - self.sent_t),
            "full_s": None if self.full_t is None or self.sent_t is None else round(self.full_t - self.sent_t),
        }
        return d


def message(cmd: Command, issued: float) -> str:
    return f"v1|{KEY_ID}|{cmd.id}|{cmd.event}|{cmd.resource}|{cmd.setpoint:.3f}|{cmd.kind}|{issued:.3f}"


def sign(msg: str) -> str:
    return hmac.new(COMMAND_KEYS[KEY_ID], msg.encode(), hashlib.sha256).hexdigest()


def beyond_deadband(new: float, cur: float) -> bool:
    return abs(new - cur) > max(C.DEADBAND_MW, C.DEADBAND_REL * max(abs(cur), abs(new)))


class Dispatcher:
    def __init__(self, field_, audit) -> None:
        self.field = field_
        self.audit = audit
        self.commands: list[Command] = []

    def live(self, rid: str | None = None) -> list[Command]:
        return [c for c in self.commands if c.state not in TERMINAL and (rid is None or c.resource == rid)]

    def create(self, t: float, event: str, r, setpoint: float, expected: float, direction: str, pay: float,
               needs_approval: str | None) -> Command:
        kind = "RELEASE" if setpoint <= 0.01 else "SET"
        for old in self.live(r.id):
            if old.state in ("AWAITING_APPROVAL", "READY"):
                old.state, old.closed_t = "SUPERSEDED", t
        c = Command(uid("CMD"), event, r.id, r.name, r.type, direction, round(setpoint, 1), round(expected, 1), kind,
                    "AWAITING_APPROVAL" if needs_approval else "READY", t, pay, needs_approval)
        self.commands.append(c)
        self.commands = self.commands[-400:]
        self.audit.append("COMMAND", "system", c.id,
                          f"{kind} {r.name} → {c.setpoint:.0f} MW {direction} ({'awaiting approval: ' + needs_approval if needs_approval else 'ready'})")
        return c

    def send(self, c: Command, t: float, r) -> None:
        for old in self.live(c.resource):
            if old is not c and old.state in ("SENT", "ACKED", "EXECUTING"):
                old.state, old.closed_t = "SUPERSEDED", t     # a newer setpoint for that asset
                self.field.pending.pop(old.id, None)
        issued = time.time()
        c.msg = message(c, issued)
        c.tag = sign(c.msg)
        ok, why = self.field.deliver_command(c.id, c.resource, c.setpoint, c.direction, c.msg, c.tag, KEY_ID, issued, time.time())
        c.sent_t = t
        c.start_mw = r.delivering if r.direction == c.direction else 0.0
        if ok:
            c.state = "SENT"
            self.audit.append("SEND", "system", c.id, f"Sent {c.kind} {c.name} {c.setpoint:.0f} MW, HMAC {c.tag[:12]}…")
        else:
            c.state, c.fail_reason, c.closed_t = "FAILED", f"gateway refused: {why}", t
            self.audit.append("SEND_FAIL", "system", c.id, f"Gateway refused {c.name}: {why}")

    def tick(self, t: float, resources: dict) -> list[Command]:
        """Advance lifecycle; returns commands that FAILED this tick."""
        failed = []
        acks = {a.cmd_id: a for a in self.field.poll_acks()}
        for c in self.live():
            r = resources[c.resource]
            if c.state == "SENT":
                if c.id in acks:
                    c.state, c.ack_t = "ACKED", t
                    r.setpoint, r.direction = c.setpoint, c.direction
                    self.audit.append("ACK", c.resource, c.id, f"Ack {c.name} after {t - c.sent_t:.0f} s")
                elif t - c.sent_t > C.ACK_TIMEOUT_S:
                    c.state, c.fail_reason, c.closed_t = "FAILED", f"no ack in {C.ACK_TIMEOUT_S} s", t
                    self.field.pending.pop(c.id, None)
                    failed.append(c)
                    self.audit.append("ACK_TIMEOUT", "system", c.id, f"No ack from {c.name} in {C.ACK_TIMEOUT_S} s — no blind resend")
                    continue
            if c.state in ("ACKED", "EXECUTING"):
                c.state = "EXECUTING"
                span = c.setpoint - c.start_mw
                got = r.delivering - c.start_mw
                if abs(span) > 0.5:
                    if c.first_t is None and got / span >= 0.10:
                        c.first_t = t
                    if c.full_t is None and got / span >= 0.90:
                        c.full_t = t
                elif c.full_t is None:
                    c.first_t = c.first_t or t
                    c.full_t = t
                if c.kind == "RELEASE" and r.delivering <= 0.5:
                    c.state, c.closed_t = "COMPLETED", t
                    r.setpoint = 0.0
        return failed

    def approve(self, cmd_ids: list[str], user: str) -> None:
        for c in self.commands:
            if c.id in cmd_ids and c.state == "AWAITING_APPROVAL":
                c.approvals.append(user)

    def cancel_event(self, event: str, t: float, reason: str) -> None:
        for c in self.live():
            if c.event == event and c.state in ("AWAITING_APPROVAL", "READY"):
                c.state, c.closed_t, c.fail_reason = "CANCELLED", t, reason
