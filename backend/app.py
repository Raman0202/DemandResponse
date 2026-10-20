"""GNA (Demand Response) API: REST + WebSocket over the ADRMS engine.

Run:  uvicorn app:app --port 8000   (from backend/)
"""
from __future__ import annotations

import asyncio
import json
import os
import threading
import time
from contextlib import asynccontextmanager

import numpy as np
from fastapi import Body, Depends, FastAPI, Header, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from adrms import auth
from adrms.platform import Platform

PLATFORM = Platform(seed=int(os.environ.get("GNA_SEED", "7")), start_h=float(os.environ.get("GNA_START_H", "17.5")))

ACTION_PERMS = {
    "scenario_start": "scenario", "scenario_stop": "scenario",
    "speed": "operate", "pause": "operate", "suspend": "operate",
    "autonomy": "approve",
    "event_approve": "approve", "event_reject": "approve", "event_close": "approve",
    "rotation_approve": "approve", "rotation_reject": "approve", "rotation_manual": "operate",
    "rotation_band": "configure",
    "alarm_ack": "ack_alarm", "alarm_shelve": "ack_alarm",
    "offer_decide": "operate", "application_decide": "operate",
    "mv_dispute": "settle", "mv_resolve": "settle",
    "dsm_table": "configure", "prices": "configure", "source": "configure", "offset": "configure",
}


def _default(o):
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (set, frozenset, tuple)):
        return list(o)
    if isinstance(o, np.ndarray):
        return o.tolist()
    return str(o)


def dumps(obj) -> str:
    return json.dumps(obj, default=_default, separators=(",", ":"))


def loop() -> None:
    while True:
        t0 = time.time()
        if PLATFORM.running:
            try:
                PLATFORM.tick()
            except Exception as e:  # keep the loop alive; record the fault
                PLATFORM.audit.append("LOOP_ERROR", "system", None, f"{type(e).__name__}: {e}")
        time.sleep(max(0.05, 1.0 - (time.time() - t0)))


@asynccontextmanager
async def lifespan(_app):
    threading.Thread(target=loop, daemon=True, name="adrms-loop").start()
    yield
    PLATFORM._save()


app = FastAPI(title="GNA (Demand Response) API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("GNA_CORS", "http://localhost:3000,http://127.0.0.1:3000").split(","),
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"],
)


def user(authorization: str | None = Header(default=None)) -> dict:
    token = authorization.split(" ", 1)[1] if authorization and authorization.lower().startswith("bearer ") else None
    claims = auth.verify(token)
    if not claims:
        raise HTTPException(401, "not authenticated")
    return claims


def json_response(obj) -> Response:
    return Response(dumps(obj), media_type="application/json")


@app.get("/api/health")
def health():
    return {"ok": True, "tick": PLATFORM.tick_count, "sim_t": PLATFORM.field.t}


@app.post("/api/login")
def login(body: dict = Body(...)):
    token = auth.login(body.get("username", ""), body.get("password", ""))
    if not token:
        raise HTTPException(401, "invalid credentials")
    return {"token": token, "user": auth.verify(token)}


@app.get("/api/me")
def me(u: dict = Depends(user)):
    return {**u, "perms": sorted(p for p in auth.PERMS if auth.can(u, p))}


def control(u: dict = Depends(user)) -> dict:
    if not auth.can(u, "view"):
        raise HTTPException(403, "control-room view is not available to industry accounts")
    return u


def industry(u: dict = Depends(user)) -> dict:
    if not auth.can(u, "industry"):
        raise HTTPException(403, "industry portal is for participant accounts")
    return u


@app.get("/api/snapshot")
def snapshot(u: dict = Depends(control)):
    return json_response(PLATFORM.snapshot())


@app.get("/api/industry/portal")
def industry_portal(u: dict = Depends(industry)):
    return json_response(PLATFORM.industry_portal(u))


@app.post("/api/industry/{name}")
def industry_action(name: str, body: dict = Body(default={}), u: dict = Depends(industry)):
    try:
        res = PLATFORM.industry_action(name, u, **body)
    except (KeyError, TypeError, ValueError) as e:
        raise HTTPException(400, f"bad request: {e}")
    if not res.get("ok"):
        raise HTTPException(409, res.get("error") or "rejected")
    return res


@app.post("/api/action/{name}")
def action(name: str, body: dict = Body(default={}), u: dict = Depends(user)):
    perm = ACTION_PERMS.get(name)
    if perm is None:
        raise HTTPException(404, f"unknown action {name}")
    if not auth.can(u, "view"):
        raise HTTPException(403, "control-room actions are not available to industry accounts")
    if not auth.can(u, perm):
        raise HTTPException(403, f"role '{u['role']}' lacks permission '{perm}'")
    try:
        res = PLATFORM.action(name, u, **body)
    except (KeyError, TypeError, ValueError) as e:
        raise HTTPException(400, f"bad request: {e}")
    if not res.get("ok"):
        raise HTTPException(409, res.get("error") or "rejected")
    return res


@app.post("/api/whatif")
def whatif(body: dict = Body(...), u: dict = Depends(control)):
    shortage = float(body.get("shortage", 800))
    minutes = float(body.get("minutes", 60))
    part = float(body.get("participation", 0.7))
    if not (0 < shortage <= 5000 and 15 <= minutes <= 120 and 0 < part <= 1):
        raise HTTPException(400, "shortage 0–5000 MW, minutes 15–120, participation 0–1")
    return json_response(PLATFORM.whatif(shortage, minutes, part))


@app.get("/api/audit")
def audit(offset: int = 0, limit: int = Query(200, le=1000), u: dict = Depends(control)):
    e = PLATFORM.audit.entries
    return json_response({"length": len(e), "entries": list(reversed(e))[offset:offset + limit]})


@app.get("/api/audit/verify")
def audit_verify(u: dict = Depends(control)):
    return PLATFORM.audit.verify()


@app.websocket("/ws")
async def ws(socket: WebSocket, token: str = Query(default="")):
    claims = auth.verify(token)
    if not claims or not auth.can(claims, "view"):
        await socket.close(code=4401)
        return
    await socket.accept()
    last = -1
    try:
        while True:
            if PLATFORM.tick_count != last:
                last = PLATFORM.tick_count
                await socket.send_text(dumps(PLATFORM.snapshot()))
            await asyncio.sleep(0.25)
    except (WebSocketDisconnect, RuntimeError):
        return
