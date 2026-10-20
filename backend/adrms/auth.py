"""RBAC users and HS256 JWT sessions (§9). Demo users only — replace with the utility's IdP."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time

# Session secret is separate from the command key (§5.7).
SESSION_SECRET = os.environ.get("GNA_SESSION_SECRET", "").encode() or secrets.token_bytes(32)
TOKEN_TTL_S = 12 * 3600

CONTROL_ROLES = ["operator", "shift_in_charge", "analyst", "engineer", "admin"]
ROLES = CONTROL_ROLES + ["industry"]
PERMS = {
    "view": set(CONTROL_ROLES),
    "industry": {"industry"},
    "ack_alarm": {"operator", "shift_in_charge", "engineer", "admin"},
    "approve": {"shift_in_charge", "admin"},
    "operate": {"operator", "shift_in_charge", "admin"},
    "scenario": {"operator", "shift_in_charge", "engineer", "admin", "analyst"},
    "configure": {"engineer", "admin"},
    "settle": {"analyst", "shift_in_charge", "admin"},
}


def _hash(pw: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 60_000).hex()


DEMO_PASSWORD = os.environ.get("GNA_DEMO_PASSWORD", "demo")
USERS = {
    u: {"name": n, "role": r, "dual": d, "salt": u, "hash": _hash(DEMO_PASSWORD, u), "participant": p}
    for u, n, r, d, p in [
        ("operator", "Control-room Operator", "operator", False, None),
        ("sic1", "Shift-in-charge A", "shift_in_charge", True, None),
        ("sic2", "Shift-in-charge B", "shift_in_charge", True, None),
        ("analyst", "Settlement Analyst", "analyst", False, None),
        ("engineer", "SLDC Engineer", "engineer", False, None),
        ("admin", "Administrator", "admin", True, None),
        # industry participants (GridFlex portal)
        ("jsw", "JSW Steel, Toranagallu", "industry", False, "P_JSW"),
        ("mrpl", "MRPL refinery, Mangaluru", "industry", False, "P_MRPL"),
        ("cement", "Cement cluster, Shahabad", "industry", False, "P_CEMENT"),
        ("tkm", "Auto plants, Bidadi", "industry", False, "P_TKM"),
        ("dc", "Data-centre campus, Whitefield", "industry", False, "P_DC"),
        ("sugar", "Sugar co-gen cluster, Belagavi", "industry", False, "P_SUGAR"),
        ("guest", "Prospective industry (not enrolled)", "industry", False, None),
    ]
}


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def login(username: str, password: str) -> str | None:
    u = USERS.get(username)
    if not u or not hmac.compare_digest(u["hash"], _hash(password, u["salt"])):
        return None
    head = _b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    body = _b64(json.dumps({"sub": username, "role": u["role"], "dual": u["dual"], "name": u["name"],
                            "participant": u["participant"], "exp": int(time.time()) + TOKEN_TTL_S}).encode())
    sig = _b64(hmac.new(SESSION_SECRET, f"{head}.{body}".encode(), hashlib.sha256).digest())
    return f"{head}.{body}.{sig}"


def verify(token: str | None) -> dict | None:
    if not token:
        return None
    try:
        head, body, sig = token.split(".")
        exp = _b64(hmac.new(SESSION_SECRET, f"{head}.{body}".encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(exp, sig):
            return None
        claims = json.loads(_unb64(body))
        if claims["exp"] < time.time():
            return None
        return claims
    except Exception:
        return None


def can(claims: dict | None, perm: str) -> bool:
    return bool(claims) and claims["role"] in PERMS[perm]
