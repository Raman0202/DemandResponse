# How ADRMS works

ADRMS — Automated Demand Response Management System (product name: **GNA (Demand Response)**).

This document explains what the platform does on every tick, which strategies it weighs, and exactly how each number on screen is calculated — the maths, the reasoning behind each choice, and worked numbers.

> **Deployment status: simulation and advisory prototype.** The architecture (monitor → assess → optimise → safety-check → approve → dispatch → measure → settle → audit) is a sound basis for SLDC decision support, but the platform is **not ready for autonomous grid control**. Before operational commands or load rotation are authorised it needs: authenticated, fresh SCADA/EMS telemetry (§2.1); the notified DSM table with all amendments (§3.4); a validated network model with AC voltage studies (§3.2, §5.5); the DISCOM's approved feeder roster (§7); and shadow-mode replay against historical operations (§13).
>
> **Illustrative values.** DSM multipliers, prices, participant bids, reliabilities, the frequency bias and the load-rotation roster ship as demonstration data. Which thresholds come from the grid code and which are this application's own policy is marked throughout.

---

## 1. The problem it solves

A state control area (here, Karnataka/KPTCL SLDC) must draw from the inter-state grid exactly what it scheduled. Any difference is a **deviation**, settled block by block (15 minutes) under the CERC **Deviation Settlement Mechanism (DSM)**:

- **Over-drawal** (drawing more than schedule) is charged, and charged harder outside a tolerance band and when frequency is low.
- **Under-drawal** is a potentially costly or low-value surplus condition; what it settles at depends on the applicable DSM provisions, the frequency and the volume band (§3.4).
- Large deviations also push frequency out of the IEGC band (49.90–50.05 Hz) and can overload transmission corridors.

Demand response (DR) closes the gap by paying flexible consumers, batteries and generators to move their output for a few blocks. The platform decides **who, how much, when and at what cost**. It then dispatches, proves delivery and settles payment, and uses load rotation only as the last resort.

---

## 2. The loop (every second)

```
SCADA / SLDC feed ─► quality ─► state estimate ─► assess ─► detect/alarms ─► decide ─► dispatch ─► M&V ─► settle ─► audit
                                     ▲                                           │
                                     └──────────── forecast (every sim minute) ◄─┘
```

| Stage | What happens |
| --- | --- |
| Ingest | Simulated field, or the live SLDC website (all DISCOM 220 kV load pages + StateGen) in hybrid mode |
| Quality | Every point validated and flagged GOOD / SUBSTITUTED / SUSPECT / STALE / MISSING |
| Estimate | Consistent grid state; missing bus loads filled in by load share; DC power flow |
| Assess | ACE, severity, direction, requirement, DSM exposure |
| Detect | Rule and anomaly alarms with on/off delays, correlated into incidents |
| Decide | Open or revise a DR event: flexibility → LP optimiser → Digital Twin → autonomy policy |
| Rotate | Roster manager proposes load rotation for the residual that flexibility can't cover |
| Act | HMAC-authenticated setpoint commands, acks, timeouts, dead-band |
| M&V / settle | Delivered vs expected energy, avoided DSM, payments, reliability learning |
| Audit | Every step appended to a SHA-256 hash chain |

Write-behind persistence runs every 10 s, and a watchdog degrades autonomy if the loop slows.

### 2.1 Four different clocks

A 1-second software loop is **not** 1-second grid telemetry. Measurement, control decision, command acknowledgement and physical response are separate clocks, and the platform keeps them separate:

| Clock | Reference (where one applies) | In this platform |
| --- | --- | --- |
| Frequency measurement | IEGC: measured at 1 s intervals | Target for the frequency input — only if the data is genuinely fresh. Every point is aged from its **source** timestamp (§3.1) |
| ACE computation / archival | IEGC: real time, archived at ≤ 10 s | A value counts as GOOD only while its source time is ≤ 10 s old |
| SLDC website (hybrid mode) | — | Polled every **300 s** by default; values keep their fetch time, so they age to SUBSTITUTED/STALE, and this source keeps the platform **advisory** (§5.6) |
| Primary response | IEGC: full primary response within 45 s for applicable resources | Not assumed for DR participants — each resource uses its own response delay and ramp |
| Secondary reserve (SRAS) | IEGC: start within 30 s, full within 15 min, sustain ≥ 30 min | SRAS/TRAS capacity is a separate service and is locked out of DR |
| Tertiary reserve (TRAS) | IEGC: within 15 min of instruction, sustain ≥ 60 min | Separate service class |
| RTM purchase | IEX: sessions every 30 min, delivery in the 4 blocks after the session | Cannot deliver inside the 4-block horizon (§5.3) |
| DR event opens after 60 s | **Application policy** | Tunable by severity, telemetry quality and tested false-alarm rate |
| Command ack timeout 90 s | **Application comms timeout** | Not a delivery guarantee: ack, first response, full output and delivered energy are tracked separately (§5.7) |
| Load-rotation proposal after 120 s | **Application trigger** | Separate from, and never a substitute for, approved UFR / df/dt protection (§7) |

Confirm exchange rules and grid-code provisions in force at implementation time.

---

## 3. Measuring the grid

### 3.1 Data quality and confidence

Each telemetry point has a range, a maximum plausible rate of change (spike check) and a time-to-live. **Age is measured from the source timestamp** (when the value was measured or fetched), never from when the platform re-read it — so a 5-minute-old web value re-delivered every second does not look fresh. A point is GOOD only while its source age is ≤ 10 s. Quality weights:

| Flag | Weight |
| --- | --- |
| GOOD | 1.00 |
| SUBSTITUTED (last good value, within TTL) | 0.85 |
| SUSPECT (failed range or spike check) | 0.50 |
| STALE (past TTL, estimated) | 0.30 |
| MISSING | 0.00 |

**Data confidence**

```
confidence = 0.25 · w(frequency)
           + 0.60 · Σ_bus w(bus load) · loadShare_bus / Σ loadShare
           + 0.15 · Σ_gen w(gen MW)   · capacity_gen  / Σ capacity
```

- Below **85%**, autonomy drops automatically to advisory (every command needs approval).
- Below 97% a P3 alarm is raised, and below 80% a P2 alarm.

**Hard vetoes.** An average can stay above 85% while one critical input is bad, so each of these forces advisory on its own, whatever the score:

- frequency not GOOD (stale, substituted or missing);
- interchange schedule stale, suspect or missing (ACE cannot be trusted);
- any breaker (line status) not current (topology uncertain);
- the source is the SLDC website (until authorised SCADA/EMS telemetry is connected).

Per-asset vetoes send just that asset to approval: gateway heartbeat lost (command path unproven), or BESS state-of-charge telemetry stale. The top bar's data pill shows the worst source age and lists every active veto.

### 3.2 State estimate

- A missing or bad bus load is estimated as `(Σ good loads / Σ their load shares) × this bus's load share`, so one failed RTU lowers confidence rather than corrupting the state.
- Demand = Σ bus loads. Generation is split into in-state and central share.
- A DC power flow gives line flows: `flows = H · p`.
  - `p` is net injection at each internal bus.
  - `H` is the PTDF matrix with distributed slack at the inter-state tie buses.
  - `H` is cached per outage set.
- Voltage is a **heuristic screening estimate**: `V ≈ 1.035 − 0.075·(worst adjacent loading)²` pu. A DC model does not solve voltage or reactive power, so this cannot certify voltage compliance.
- The DC model is a planning-level screen. Live use needs a validated network model — actual topology, impedances, transformer limits, line ratings, outage configurations — with AC load flow and the applicable contingency studies.

### 3.3 Area Control Error and severity

IEGC definition:

```
ACE = (Ia − Is) − 10 · Bf · (Fa − Fs) + Offset

Ia = −actual drawal       Is = −scheduled drawal       Fs = 50.00 Hz
Bf = frequency bias, MW per 0.1 Hz        Offset = 0 unless configured (supported in code)
```

- The IEGC defines the interchange sign convention and requires each SLDC to assess and declare its own frequency bias from its control-area response. **Bf is not a universal constant.** The value used here (−160 MW/0.1 Hz) is Karnataka configuration data **pending confirmation from the SLDC's declaration**.
- **Negative ACE** means the state is short (over-drawing). Direction is **UP**: reduce load or add supply.
- **Positive ACE** means the state is long. Direction is **DOWN**: absorb surplus.
- **Requirement** = |ACE| MW.

Severity:

| Severity | Condition | Source |
| --- | --- | --- |
| EMERGENCY | f < 49.80 Hz, or \|ACE\| > 1,500 MW | **Application policy** (not grid-code thresholds) |
| ALERT | f < 49.90 or f > 50.05 Hz | IEGC normal operating band |
| ALERT | \|ACE\| ≥ 100 MW | Application policy |
| NORMAL | otherwise | — |

**Forecast-error reserve (P90 margin)** is the flexibility kept free in case the forecast is wrong:

```
margin = 1.28 · √( (0.5% · demand)² + (6% · renewables)² )
```

### 3.4 DSM charge

**Normal Rate**

```
A  = DAM weighted ACP          (default ₹5.40/kWh)
B  = RTM ACP                   (default ₹7.20/kWh)
C  = (DAM + RTM + ancillary) / 3
NR = max(A, B, C)
```

The rule table is **versioned configuration**. Each table records its regulation, amendments applied, effective date, source and approver, and the platform refuses a table without a version, source and effective date (an engineer loads it under Administration → DSM rules). The table in force is used everywhere: assessment, optimiser, strategy comparison and M&V.

**Volume bands.** The 2024 structure prices successive slices of |deviation| differently. Each band's upper edge is the lower of a percentage of schedule and an MW cap:

```
edge_k = min(pct_k % × schedule, cap_k)       (edges never decrease; the last band is open-ended)

shipped default (structure of the 2024 general-buyer rules — numbers illustrative):
  band 1:  up to min(10% of schedule, 100 MW)      ← the tolerance band; also the load-rotation trigger (§7)
  band 2:  up to min(15% of schedule, 200 MW)
  band 3:  beyond
```

**Per-block charge** (15 min = 0.25 h), summed over the bands the deviation reaches:

```
amount = Σ_k  MW_in_band_k · 0.25 h · 1000 · m_k(frequency band, direction) · NR
```

Over-drawal is payable (+); under-drawal is receivable (−), with its own multipliers.

**Illustrative multipliers of NR** (load the notified values for the applicable buyer category):

| Frequency band | Over-drawal band 1 / 2 / 3 | Under-drawal band 1 / 2 / 3 |
| --- | --- | --- |
| LOW (f < 49.90) | 1.5 / 2.0 / 2.5 | 1.0 / 0.5 / 0.0 |
| NORMAL | 1.0 / 1.5 / 2.0 | 0.9 / 0.0 / 0.0 |
| HIGH (f ≥ 50.05) | 0.5 / 1.0 / 1.5 | 0.0 / 0.0 / 0.0 |

> **Regulatory status.** This reproduces the *structure* of the CERC DSM Regulations, 2024, not the notified settlement formula. Before any settlement use, load the principal regulations for the applicable buyer category, read with all subsequent amendments and orders, and verify against official settlement statements, including boundary cases at each volume limit. Version-1 tables (one band + beyond) still load, as a two-band table.

**Marginal DSM rate** is the multiplier of the outermost band in use × NR — the ₹/kWh of the next MW of deviation. It is the price any paid flexibility has to beat, compared like for like with the flexibility's cost per delivered kWh (§5.2).

---

## 4. Seeing ahead: the forecast

**Horizon:** 8 blocks (2 hours), each with P10, P50 and P90 values.

**1. Level correction.** Every update learns how far today is running from the day-ahead profile:

```
level_d  ← 0.7·level_d  + 0.3·(actual demand / profile demand)
level_re ← 0.7·level_re + 0.3·(actual RE / profile RE)
```

**2. Forecast for block b.** The correction fades with lead time:

```
decay   = 0.82^b
demand  = profile_demand · (1 + (level_d − 1)·decay)
RE      = profile_RE     · (1 + (level_re − 1)·decay)
dev     = demand − (in-state non-RE gen + RE) − schedule − held_flexibility
ACE_P50 = −dev
```

- `held_flexibility` assumes the DR now delivering stays for 2 blocks, then releases at 50% per block.

**3. Uncertainty** grows with √lead time:

```
σ_demand = 0.6% · demand · √b
σ_RE     = 8%   · RE     · √b
σ        = √(σ_demand² + σ_RE²)
P10/P90  = P50 ∓ 1.2816 · σ
```

**4. Predicted violations.**
- **Lines:** at blocks 1, 2 and 4, bus loads are scaled by the forecast demand ratio and RE output by the RE ratio, the power flow is re-solved, and any line ≥ 95% is flagged.
- **ACE:** a block is flagged when |ACE P50| ≥ 100 MW, or P10 ≤ −300, or P90 ≥ 300.
- Only the earliest violation per line is kept.

**5. Accuracy.** The 1-block-ahead demand forecast is scored against what happened, giving the **MAPE** over the last 96 samples.

**Anomaly detection:** an EWMA z-score runs on the demand forecast residual (α = 0.02, learning only from normal behaviour, |z| < 4); |z| ≥ 4 raises a demand-anomaly alarm.

The production ML ensemble (LightGBM / TFT) can replace this model behind the same interface, and the accuracy tracker scores whichever model is in use.

---

## 5. Deciding: the DR event engine

### 5.1 When an event opens, revises and closes

| Step | Rule |
| --- | --- |
| **Open** | \|ACE\| ≥ **100 MW**, sustained **60 s** (immediately in EMERGENCY); not at autonomy L0; outside the post-event cool-down. *Application policy, not a grid-code time* |
| **Revise** (MPC re-solve) | Every new 15-min block; on a material change in the requirement (> max(80 MW, 25%)); on a command failure; or on escalation to EMERGENCY |
| **Wind down** | Underlying requirement < **60 MW** for 3 consecutive ticks → release resources → close → settle |

**Underlying requirement** is what is actually needed, with our own actions backed out, so the event doesn't switch itself off while it is working:

```
underlying = (ACE in the event's direction) + MW our resources are delivering now + MW currently rotated out (UP only)
```

Rotated-out MW is counted on purpose: paid flexibility stays sized to the full over-drawal, so load rotation is what gets released first.

Each revision runs: flexibility of every asset → LP optimiser (OPTIMAL) → Digital Twin → (pass) autonomy policy → commands; on a twin failure it excludes or derates and re-solves, up to 4 passes.

### 5.2 What each resource can really give

**Technical headroom** in the event's direction:

| Type | UP (less load / more supply) | DOWN (absorb surplus) |
| --- | --- | --- |
| Demand (interruptible, shiftable, industrial, DER) | baseline − min load | max load − baseline |
| Generation | max − baseline | baseline − min |
| BESS | min(power, usable energy · η_d / duration), where usable = (SoC − SoC_min) · capacity | min(power, room to SoC_max / η_c / duration) |

**Available capacity:** `available = min(technical, state contract share + emergency share)`. The emergency share is released only in EMERGENCY. SRAS/TRAS (ancillary) commitments are **locked** and never dispatched for DR.

**Expected delivery and cost — one definition everywhere.**

```
expected   = available · reliability                      ← reliability scales the MW we can count on, nothing else
pay rate   = ₹ paid per delivered kWh                      ← the same rate settlement pays (§6), locked at dispatch
rebound    = reboundFrac · off-peak price                  ← ₹ per delivered kWh for energy that returns after release
effective  = pay rate + rebound                            ← ₹ per delivered kWh: ranking, economic filter, LP, display
```

| Resource | Pay rate |
| --- | --- |
| Demand-side (interruptible, shiftable, industrial, DER) | Bid |
| BESS discharging (UP) | Bid + recharge energy = bid + off-peak price / (η_c · η_d) |
| BESS charging (DOWN) | Degradation cost |
| Generation UP | Variable cost + wear |
| Generation DOWN | Credit: −60% of variable cost saved (part-load heat rate), plus wear |

**Timing: within-block response.**

```
g(t)   = clamp((t − d) / τ, 0, 1)       d = response delay (min), τ = available MW / ramp rate (min)
φ_b    = (1/15) ∫ g(t) dt over block b  share of block b's energy delivered
E_i,b  = R_i · φ_i,b · x_i,b · 0.25 h   expected energy in block b
```

A 12-minute response with an instant ramp gives φ = 0.2 in block 1 and 1.0 from block 2. A resource already delivering keeps full credit for what it delivers now; any **increase** goes through the response delay and ramp again — `φ_b = (current + φ_inc,b · (available − current)) / available`.

**Economic DR only in NORMAL.** When severity is NORMAL, a resource whose effective cost ≥ the DSM marginal rate is skipped.

### 5.3 The optimiser

A network-constrained, multi-block linear program, solved with HiGHS. Horizon = 4 blocks (1 hour), re-solved every block (model-predictive control).

| Tier | Resources | Why this order |
| --- | --- | --- |
| 1 | **BESS** | Fastest, no consumer impact, fully controllable |
| 2 | **Industrial flexibility** | Contracted envelopes inside accepted offers (§11) |
| 3 | Other paid flexibility | Generation re-dispatch, interruptible, shiftable, DER |
| 4 | RTM purchase | About 1 h lead (§2.1) |
| last | **Load rotation** | Not in the optimiser: only the residual after every tier, with approval (§7) |

Priority is enforced by a tier step π per expected MWh, larger than the widest cost spread between resources; reported costs never include π.

```
min  Σ (pay + rebound + π·(tier_i − 1))_i · R_i · φ_i,b · x[i,b] · 0.25 h · 1000
   + λ · Σ s[b]  +  μ · Σ v[l,b]                                  (μ = 10⁷ ≫ λ)

Σ_i R_i·φ_i,b·x[i,b] + s[b] ≥ req                      balance
Σ_i R_i·φ_i,b·x[i,b] ≤ 1.05·req + 20                   no over-correction
|f0_l + Σ_i PTDF[l,bus_i]·dir·x[i,b]| − v[l,b] ≤ limit_l   thermal limit, both directions
0 ≤ x[i,b] ≤ available_i ;  x = 0 where φ_i,b = 0       capacity, response time
x[i,b] − x[i,b−1] ≤ ramp_i · 15 min                     ramp
Σ_b φ_i,b·x[i,b]·0.25/η_d ≤ (SoC − SoC_min)·capacity    BESS energy
Σ_b x[i,b] ≤ maxBlocks_i · available_i                 duration budget
```

`f0` is the base flow with our own current delivery backed out. RTM is a deficit purchase at RTM ACP + ₹0.05/kWh delivered after the session, so it shows "beyond this horizon"; a surplus selling path is not modelled.

**Outputs:** allocations by block with caps explained; skipped resources with the reason; binding lines with LP shadow prices (₹/MW); coverage, post-dispatch loading, rebound MW; solver statistics (solve time, variables, rows).

```
resource_rs   = Σ expected MWh · 1000 · pay rate
rebound_rs    = Σ reboundFrac · expected MWh · 1000 · off-peak price
residual_dsm  = Σ_blocks DSM(deviation − dir · supplied_b)
total_rs      = resource_rs + rtm_rs + rebound_rs + residual_dsm
do_nothing_rs = Σ_blocks DSM(deviation);   savings_rs = do_nothing_rs − total_rs
```

### 5.4 Strategies compared (the **Options** stage)

Do nothing · Buy in RTM · Re-dispatch generation · BESS only · Demand response only · **Priority mix** (chosen). Each is the same LP restricted to a set of resource types; the chosen plan is pinned first and the rest ranked by total cost, with paid cost vs DSM still owed, savings, coverage, time to effect and the worst-line effect. If a cheaper option exists (by more than max(₹1,000, 0.5%)), the banner says what it gives up.

### 5.5 Digital Twin safety gate

| Check | Fails / warns when | Automatic fix |
| --- | --- | --- |
| Heartbeat and command path | No gateway heartbeat for > 60 s | **Exclude** asset, re-solve |
| BESS state of charge | Trajectory would breach SoC_min | **Derate** to 95% of usable MW, re-solve |
| Line loading after dispatch (DC screening) | Dispatch makes any line worse than 100% (fail); pre-existing overload only relieved (warn) | Not dispatched if worse |
| Voltage screening (heuristic) | Estimate < 0.95 pu | warn — not an AC solution |
| Response lag | < 70% of planned block-1 energy after response delay and ramp | warn |
| P90 reserve kept free | Free expected flexibility < P90 margin | warn |
| Ancillary double-commitment | — | SRAS/TRAS always untouched |
| Rebound | Post-event rebound > 25% of requirement | warn |
| Requirement covered | Shortfall > 0.5 MW: fail in EMERGENCY (escalate to load management), warn otherwise | — |

Up to 4 optimise → twin passes. If the twin still fails, a human must decide. The twin is a **pre-dispatch screening gate**, not a substitute for utility-grade network validation.

### 5.6 Autonomy policy and approvals

| Level | Behaviour |
| --- | --- |
| L0 Monitor | Detect, forecast, alarm; no decisions |
| L1 Advisory | Plans generated; every command needs approval |
| L2 Supervised (default) | BESS and generation inside the envelope (≤ 250 MW total, twin passed) execute automatically; the rest await approval |
| L3 Autonomous | Every resource except RTM executes automatically once the twin passes |

Automatic degradation to L1 on: data confidence < 85%; any hard veto; control-loop latency high; kill switch. Per-asset vetoes send that asset to approval even at L2/L3. **Dual authorisation** above **200 MW** by a different user with dual authority; a re-solve growing beyond 1.1 × approved + 20 MW starts a new round.

### 5.7 Dispatch

```
AWAITING_APPROVAL → READY → SENT → ACKED → EXECUTING → COMPLETED
                                 └ no ack in 90 s → FAILED → asset excluded, alarm, re-solve
```

- Idempotent command ids, **no blind resend**.
- **Authentication:** HMAC-SHA-256 over `v1|key id|command id|event|resource|setpoint|kind|issue time` with a dedicated command key (separate from the session secret). The gateway refuses an unknown key id, a tag mismatch (constant-time compare), a message older than 30 s or from the future, or a replayed command id.
- **Four clocks per command:** acknowledgement, first metered response (10%), full output (90%), delivered energy (M&V).
- **Dead-band:** a new setpoint is sent only if it differs by more than max(5 MW, 8%).
- **Under-delivery:** delivered < 70% of expected raises an alarm; the next re-solve compensates.

---

## 6. Proving it and paying for it

```
delivered MWh_i += telemetry MW_i · dt
expected  MWh_i += plan expected MW_i · dt
avoided DSM     += DSM(deviation + dir·Σ delivered) − DSM(deviation)

p  = delivered / expected
PF = 1.0 if p ≥ 90%;  (p − 0.5)/0.4 if 50% < p < 90%;  0 if p ≤ 50%
payment = delivered MWh · 1000 · rate · PF          (generation PF = 1; industry: GridFlex M&V)
```

**Counterfactual ledger:** DSM with no action − DSM on the actual deviation = DSM avoided − participant payments − RTM − rebound energy = net savings (reconciles by assertion).

**Reliability learning:** `reliability_new = min(0.995, 0.8 · reliability_old + 0.2 · min(1, p))`.

---

## 7. Last resort: load rotation

Only the **residual** after BESS, industrial and other flexibility can become a load-rotation order; under-drawal is never handled by rotation.

```
residual = min(residual block 1, residual block 2)                 planned shortfall that persists after ramp-in
         + Σ (R·setpoint − metered)⁺ for commands past their window   measured under-delivery

trigger: residual ≥ 50 MW AND (f < 49.90 Hz OR residual > DSM band 1), sustained 120 s — immediately below 49.80 Hz
```

> **Three separate functions.** The DR optimiser; the load-management proposal under the approved roster and approval rules; and independent UFR / df/dt protection, which the platform never delays, disables or overrides. **Demo roster:** groups of ~4 stations per DISCOM north to south, a flat 30% rotatable share, generated protected-feeder counts — replace with the DISCOM's verified records before use.

- Orders round the residual to 10 MW (≥ 50 MW), never act on their own (shift-in-charge approval; dual > 200 MW) and lapse if flexibility catches up (< 25 MW).
- **Fair selection:** split by DISCOM load share; repeatedly serve the DISCOM furthest below quota; within it, the eligible group with the lowest `F = 0.5·H + 0.3·N + 0.2·D` (7 days, normalised). Hospitals, water works, railway traction and defence are never rotated.
- Spell ≤ 45 min; daily ≤ 120 min; rest one spell; top-up when residual grows > 50 MW; trim the largest group that still leaves enough off; staged restore one group per 120 s (tightened to the earliest spell limit); relief is **metered**, escalated below 90% of plan for 2 min.
- Energy not served = ∫ rotated-out MW dt; fairness = most minus least minutes off today.

---

## 8. Alarms (ISA-18.2 style)

| Alarm | Priority | Condition | On-delay |
| --- | --- | --- | --- |
| Frequency low | P1 / P2 | < 49.80 / < 49.90 Hz | 10 s / 20 s |
| Frequency high | P3 | > 50.05 Hz | 30 s |
| ACE | P1 / P2 / P3 | \|ACE\| ≥ 1,000 / 300 / 100 MW | 20 / 30 / 60 s |
| Line overload / high loading | P1 / P3 | ≥ 100% / ≥ 90% | 20 / 60 s |
| Line out of service, islanding | P2, P1 | breaker open / island detected | immediate |
| Data confidence | P2 / P3 | < 80% / < 97% | 10 / 30 s |
| Telemetry stale or missing | P3 | point STALE or MISSING | 30 s |
| Asset heartbeat lost | P2 if in the active event | > 60 s without heartbeat | 30 s |
| Under-delivery | P2 | < 70% of expected | immediate |
| Demand anomaly | P3 | forecast residual \|z\| ≥ 4 | 30 s |
| Predicted overload | P3 | forecast line ≥ 100% within 30 min | 60 s |
| Autonomy degraded / suspended, loop latency | P2 / P3 / P2 | from policy and watchdog | immediate |

Alarms clear after a 60 s off-delay, stay listed until acknowledged, can be shelved with a reason and expiry, and correlate into incidents.

---

## 9. Trust and audit

- **RBAC:** operator, shift-in-charge, analyst, engineer, admin, and industry participants (portal only). JWT sessions.
- **Audit trail:** `hash_n = SHA-256([hash_{n−1}, seq, ts, kind, actor, ref, message])`, `hash_0 = 0…0`. Changing any entry breaks every hash after it; **Verify** re-computes the chain.

---

## 10–11. Screens, GridFlex and the industry portal

**GridFlex** is part of ADRMS: industrial flexibility is the preferred controllable response after batteries. Industries declare **flexibility envelopes** (MW, window, response, minimum activation, maximum duration, recovery, ₹/MWh, availability ₹/MW·h, restrictions) and are dispatched **only inside an accepted offer, on its terms**.

**Baseline M&V (settlement of record):**

```
B = mean metered demand over the 4 blocks before the event, bounded to ±10% of the declared level
R = max(0, B − M);  A = dispatched MW capped at the offer (counted after the offer's response time);  V = min(R, A)
E = Σ V · Δt;  pay = E · P + availability − E·P·(1 − PF)
```

Example: B = 600, A = 60; block 1 M = 560 → V = 40; block 2 M = 530 → V = 60. E = 25 of 30 MWh (PF 0.83). At ₹4,000/MWh and ₹100/MW·h: pay ≈ ₹86,333. Any record can be **disputed** (payment held) and resolved with an audited adjustment.

**Shortage ledger:** shortage − industrial (verified) − other flexibility (metered) − load rotation (metered) = residual — always from measured values.

**Lifecycle:** DETECTED → ASSESSED → PROPOSED → APPROVED → ACTIVATING → VERIFYING → RECOVERY → SETTLED (exceptions REJECTED · CANCELLED · FAILED · DISPUTED); forward only, except a new approval round returns to PROPOSED.

**Industry portal** (separate flow): the SLDC's open programmes and terms; the SLDC's indicative 24-hour flexibility need (wanted vs already committed, uncovered windows, value ceiling = 80% of the DSM marginal rate avoided); bidding offers into those windows; live performance vs target during events; delivery clocks; verified earnings and disputes; energy-reduction plan; enrolment for new industries.

**Scenario simulator** (What-if): No action · Flexibility first · Rotation-assisted (realised at ~92% of plan, unserved MWh and illustrative interruption cost).

---

## 12. Worked example

Schedule 5,300 MW, actual drawal 5,650 MW (over-drawal 350 MW), frequency 49.95 Hz, DAM ₹5.40, RTM ₹7.20, ancillary ₹8.10.

```
ACE   = (−5,650 − (−5,300)) − 10·(−160)·(49.95 − 50.00) = −350 − 80 = −430 MW   → UP, requirement 430 MW, ALERT
NR    = max(5.40, 7.20, 6.90) = ₹7.20/kWh (RTM)
edges = 100 MW, 200 MW;  350 MW → 100 / 100 / 150;  NORMAL multipliers 1.0 / 1.5 / 2.0
DSM   = (100·1.0 + 100·1.5 + 150·2.0) · 0.25 · 1000 · 7.20 = ₹9,90,000 per block;  marginal ₹14.40/kWh

participant: bid ₹4.50, rebound 0.3 × 3.20 = ₹0.96 → effective ₹5.46/kWh < ₹14.40 → dispatched;  12-min response → φ₁ = 0.2
settlement: p = 7.6/10 = 0.76 → PF 0.65 → payment = 7.6·1000·4.50·0.65 = ₹22,230;  reliability 0.8·0.90 + 0.2·0.76 = 0.872
```

These numbers are pinned by `backend/tests/test_engine.py`.

---

## 13. Validation before a utility pilot

| Area | Required before live use |
| --- | --- |
| Telemetry | Authorised SCADA/EMS path with source timestamps; the SLDC-website mode stays advisory |
| DSM | Notified table for the buyer category with all amendments and orders, with provenance; boundary tests against official statements |
| Network | Validated model, AC load flow for voltage, applicable contingency studies |
| Load management | DISCOM-approved feeder roster with measured loads and protected classifications |
| Resources | Per-resource response envelope learned from metered data |
| Commands | Key management and rotation; gateway-side verification in field equipment |
| Operations | Historical replay and shadow mode alongside existing operator decisions |

**Reference set:** CERC IEGC Regulations, 2023; CERC DSM Regulations, 2024 with amendments and orders; IEX Real-Time Market rules; CEA advisories on load shedding; State Commission regulations and DISCOM/SLDC procedures.

---

## 14. The 3D simulator and decision trace

The console opens on a **3D simulator** of the control area, built on the same live engine state:

- **Grid:** substations scale with bus load; transmission arcs carry flow particles whose speed follows line loading and whose colour turns amber at 90% and red at 100%.
- **Plants:** thermal stacks emit smoke in proportion to output, wind rotors spin with the capacity factor, solar arrays glow with output, and the hydro dam spills.
- **Flexibility:** batteries show a state-of-charge gauge and pulse when discharging; factory windows dim as an industry curtails; rotated-out areas go dark.
- **Command beams:** run from the SLDC tower to each resource with a live command — dashed amber while awaiting approval, blue pulses once sent, steady green while executing, red on failure.
- **Decision pipeline:** every loop stage with its wall time for this tick and what it concluded, including HiGHS solve time and model size. One tick takes about 1 ms and an LP re-solve about 1–3 ms.
- **Decisions & reasons:** a narrated trace derived from the audit chain. The optimiser adds allocations, skipped resources, binding lines and solver statistics; the Digital Twin adds its failed checks. Clicking an entry flies the camera to the object.
- **Inspector:** for any object, explains the engine's decision — tier, effective cost against the DSM marginal rate, φ, the limits that capped it or why it was skipped, the autonomy-policy outcome, the command's four clocks and HMAC tag.
