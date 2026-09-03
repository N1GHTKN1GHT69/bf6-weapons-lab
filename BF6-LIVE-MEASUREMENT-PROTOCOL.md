# BF6 Weapons Lab — live-game measurement protocol

Purpose: turn the five highest-impact unverified recoil/spread values into
measurements taken from the live game, with stated uncertainty, ingested through
an auditable path.

**Creating this protocol verifies nothing.** All five values remain
`PATCH_RECONCILED_NO_KNOWN_DELTA` until real captures are ingested.

---

## 1. What `recoilV` actually is

**Not a raw observable — a derived value.** Verified against the shipped dataset,
exact on **62 / 62 weapons**:

```
recoilV = recoil.ads.amount × recoil.ads.amountMult ^ recoil.ads.amountExp
```

For L110: `0.47 × 0.94^(−3) = 0.5658669081032143` ✓

- `amount` — the per-shot vertical camera impulse, in **degrees**
- `amountMult` — per-tier multiplier (< 1, so each tier step reduces recoil)
- `amountExp` — the weapon's inherent tier exponent (L110: −3)

With attachments equipped, the exponent shifts by the summed tier modifiers.
Verified exact on **238 / 248** cached rows:

```
recoil = round₃( amount × amountMult ^ (amountExp + Σ adsRecoilTierMod) )
```

The 10 exceptions are bolt-action and burst weapons with special cadence
handling — **none is a measurement target**. All five targets are in the exact set.

**The consequence that shapes the whole protocol:** with *no* recoil-affecting
attachment equipped, Σ tier = 0, so the measured per-shot kick corresponds
**directly** to stored `recoilV`. Strip attachments rather than correcting for them.

`recoilVar` follows the same pattern (`dirVar × dirVarMult ^ dirVarExp`, exact on
60/62 — M16A4 and VSSM differ, both burst/fire-mode special cases).

## 2. What `spreadMax` actually is

**A discrete tier index, not a physical quantity.** Across the entire 62-weapon
roster it takes only five values: **5, 6, 7, 9, 11**. It equals
`spread.adsStand[1]` on 62/62 weapons; the *degrees* value is `adsStand[0]`
(only ever 0, 0.05 or 0.1).

`spreadMax` therefore **cannot be measured directly**, and its mapping to degrees
runs through `effectiveSpreadMax()` in the upstream simulator — which this
repository does not contain. Empirically that mapping is heavily confounded:
tier-7 weapons span 0 → 1.24° of effective spread in the shipped cache.

**So do not try to measure `spreadMax`.** Measure `effectiveAdsSpreadDeg`
instead — the value `beamIndex` actually consumes. It is both tractable and
strictly more useful.

## 3. Full trace: raw measurement → BALANCED score

```
game files      recoil.ads.{amount, amountMult, amountExp, dirVar, ...}
                        │
recoilV         = amount × amountMult^amountExp                    [62/62 exact]
recoilVar       = dirVar × dirVarMult^dirVarExp                    [60/62 exact]
                        │  + equipped Σ adsRecoilTierMod
recoil          = round₃(amount × amountMult^(amountExp + Σtier))  [238/248 exact]
recoilVariationDeg = dirVar (+ attachment variation mods)
unpredictable   = recoil × sin(min(90, recoilVariationDeg) × π/180)
effSpread       = effectiveSpreadMax(weapon, 8)      ← upstream, tier-driven
moving          = _movingAdsMinSpreadDeg
                        │
                 T = min(1, max(1, distance) / 120)
beamIndex       = recoil      × (1.00 + 0.35·T)
                + unpredictable × (1.25 + 0.75·T)
                + effSpread   × (2.00 + 2.50·T)
                + moving      × (0.35 + 0.65·T)
                        │
metaCost        = triggerTtk^0.55 × beamIndex^0.45   (× 1.35 if off-pace)
BALANCED winner = argmin(metaCost)
```

### The finding that determines the method

**BALANCED winners are stable under a uniform scaling of every weapon's recoil
from ×0.5 to ×2.0**, at 10/25/50/100 m. An absolute calibration error common to
all weapons *cannot* change the winner. Only **relative** recoil between weapons
can.

So the calibrated-ratio method is not a convenience — it measures exactly the
quantity the ranking depends on, and cancels FOV, resolution, aspect ratio and
optic magnification along the way.

---

## 4. L110 measurement protocol (proof of concept)

**Target:** L110 `recoilV`, stored **0.5659**.

**Method `ratio-v1`.** Measure L110 and a reference weapon under identical
conditions in one session; the ratio of screen displacements equals the ratio of
true angular recoil.

Recommended reference: **B36A4** — it is itself a target, so one capture pair
serves both, and their mutual ratio is precisely what decides the 25 m winner.

### Procedure

1. **Strip all attachments** from both weapons (Σ tier = 0 → measured value maps
   directly to `recoilV`). If an attachment cannot be removed, record its exact
   id so its `adsRecoilTierMod` can be backed out.
2. Firing range, **standing, stationary, ADS**, aiming at a wall with a visible
   fixed feature (a decal, corner, or placed target) as the reference point.
3. **Single tap-fired shots only** — never sustained fire. Recoil decays between
   shots (`decFactor 72`, `duration 0.025`), so cumulative climb is *not* N × the
   per-shot value. The first-shot peak is the clean observable.
4. **Do not compensate.** Hands off the mouse/stick during and after each shot.
   Let the camera settle fully before the next shot.
5. Record video. For each trial, measure the **peak vertical displacement in
   pixels** of the aim point from its pre-shot position.
6. **10 trials per weapon** to start. The tool computes how many are actually
   needed from the observed spread and will tell you if 10 was insufficient.
7. Repeat identically for the reference weapon **in the same session**, without
   changing any display setting.

### Required capture settings

Because the ratio cancels the projection, settings need only be **constant across
the two weapons**, not any particular value:

| Setting | Requirement |
| --- | --- |
| FOV / ADS FOV | Any value — but identical for both weapons |
| Resolution / aspect | Any — identical for both |
| Optic | **Iron sights on both**, or the same magnification on both |
| FOV scaling / uniform aim | Fixed; do not change mid-session |
| Capture frame rate | ≥ 60 fps (higher is better — you need the peak frame) |
| Aim assist / any input aid | Off |

The one thing that must **not** vary is anything that changes the world→screen
projection between the two weapons.

---

## 5. Uncertainty methodology

Per weapon: sample mean, sample standard deviation, standard error
(`sd/√n`). The ratio's relative error is propagated in quadrature:

```
rel_error(ratio) = √( relSE(subject)² + relSE(reference)² )
```

The derived value is reported as **value ± 1.96·SE (95% CI)**, and that whole
interval is pushed through the real ranking engine at its lower bound, centre and
upper bound. The verdict is then:

- **ROBUST** — the entire interval yields the same winner. The measurement
  settles the question.
- **SENSITIVE** — the interval spans two different winners. The measurement's own
  uncertainty, not the value, is deciding the answer; more trials are required.

### How precise is precise enough

Every one of the five values needs a **±19–24%** error to flip anything (§7). The
self-test achieved **±0.96%** relative error from 8 trials. That is roughly a
**20× margin** — so this method is comfortably precise enough to settle all five
questions, and the binding constraint is capture discipline, not statistics.

---

## 6. Tooling

| File | Role |
| --- | --- |
| `data/live-measurements.json` | Evidence schema + ingestion. Ships with **zero** observations. |
| `scripts/ingest-live-measurement.mjs` | Derives the value, propagates uncertainty, runs the impact report. |

Deliberately **no computer vision** — manual point marking is more reliable and
fully auditable. Raw per-trial numbers are retained so any derived value can be
recomputed and challenged.

Verify the pipeline before capturing anything:

```bash
node scripts/ingest-live-measurement.mjs --self-test
```

That injects a synthetic +18% on L110 and recovers **+17.83% ± 0.96%**, then
reports the ranking impact. Its output is labelled and never promotes anything.

Guards, matching the attachment-name evidence path: a capture on a **non-live
game version is rejected**, and fewer than 3 trials is rejected.

---

## 7. Decision boundaries — what result would actually matter

Computed by binary search against the real ranking engine:

| Weapon | Field | Stored | Flip threshold | Change needed | Outcome if crossed |
| --- | --- | --- | --- | --- | --- |
| **L110** | `recoilV` | 0.5659 | **≥ 0.7010** | **+23.9%** | B36A4 wins 25 m |
| **B36A4** | `recoilV` | 0.7265 | **≤ 0.5864** | **−19.3%** | B36A4 wins 25 m |
| **M250** | `recoilV` | 0.7267 | **≤ 0.5580** | **−23.2%** | M250 wins 25 m |
| **KORD 6P67** | `recoilV` | 0.5411 | **≥ 0.6504** | **+20.2%** | L110 wins 50 m |
| **M240L** | `effectiveAdsSpreadDeg` | (tier 11) | **−22.9%** | −22.9% | M240L wins 10 m |

**For L110 specifically:** a measured `recoilV` of **0.7010 or higher** flips the
25 m BALANCED winner to B36A4. Anything below that changes the stored number but
**not the answer** — which is still worth ingesting, because it converts the
field from reconciled to measured.

---

## 8. Minimum capture worklist — 6 weapons, 2 sessions

The four `recoilV` targets all flip **against each other**, so measuring their
mutual ratios is self-contained — no external anchor needed.

**Session A — recoil (`ratio-v1`), 4 weapons**
> L110, B36A4, M250, KORD 6P67
> Bare, ADS, standing, tap-fired, 10 trials each, identical settings throughout.

**Session B — spread (`group-v1`), 2 weapons**
> M240L, M123K
> ADS, standing, sustained burst into a wall at a **known measured distance**;
> record group **radius in metres**, 10 groups each. World-space, so no FOV or
> resolution constraint at all.

That is the complete list. **Not 62 weapons — 6.**

---

## 9. How to hand me the captures

Either is fine:

**Option A — numbers directly.** Per weapon, the list of per-trial peak
displacements (pixels for recoil; group radius in metres for spread), plus
resolution, optic and attachment state. I add the records and run the analysis.

**Option B — the video/screenshots.** Send the capture and tell me the reference
feature you aimed at; I will mark points and extract the displacements, then
show you the per-trial numbers for you to check before anything is ingested.

Either way I record: weapon, field, game version, capture date, full test
configuration, trial count, **raw per-trial values**, derived value, uncertainty,
method version, and evidence reference — and the historical 1.3.3.0 value is
preserved alongside, never overwritten.

---

## 10. Kept separate: the REDSEC experiments

These are **independent** and must not be mixed with recoil/spread capture:

| Test | Setup | Reading |
| --- | --- | --- |
| **Close-range armour** | AK4D @ 11 m, 2 plates, Standard, chest only | **4** armour-break shots = current interpretation · **3** = model must change |
| Corroborating | RPKM @ 5 m, same protocol | same |
| **Armour-break spillover** | SVK-8.6 @ 5 m, 2 plates, chest only | **4** shots to down = no spillover · **3** = spillover |

REDSEC 2-plate stays **PROVISIONAL** until these are established.
