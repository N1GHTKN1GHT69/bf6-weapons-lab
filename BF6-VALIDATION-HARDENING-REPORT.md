# BF6 Weapons Lab — validation and hardening pass, 2026-09-06

## What this means

The previous pass got the 1.4.2.0 data in and every gate passed. This pass asked a
different question: **would the gates notice if something broke?**

They mostly would not. I injected 26 controlled faults one at a time — a wrong recoil
value, a hand-edited TTK in the cache, a REDSEC armour multiplier quietly changed, an
attachment made legal that isn't — and ran the full 30-gate suite against each.
**Nine got through.** Every gate was green the whole time.

The nine were not scattered bad luck. Almost all of them were one blind spot:
`data/source-manifest.json` had been recording a SHA-256 for each mirrored source file
since the project began, and **nothing ever checked them.** A one-byte edit to
`data/attachments.json` — changing what an attachment costs, or making one legal that
shouldn't be — sailed through everything.

Six new gates close all nine. On the re-run: **26 mutations, 22 caught, 0 escaped**,
and most are now caught in 2–3 seconds by a cheap check instead of surviving the whole
158-second suite.

**Two of the nine turned out to be my own bad tests, and that mattered more than fixing
them.** One "REDSEC multiplier" mutation was actually editing a documentation fixture
that nothing computes from — so "no gate caught it" was an accusation against gates that
work fine. The other showed that Multiplayer is protected from REDSEC armour maths
*twice over*; removing either guard alone genuinely does nothing. I didn't want to claim
defence-in-depth on inspection, so there's now a mutation that removes both guards at
once — and that one is caught.

**Nothing was found wrong with the shipped numbers.** 81,708 scenario evaluations,
378,535 independently recomputed cache values, and 85 brute-force optimizer checks all
agree with production. The work here made the *tests* trustworthy, not the data
different.

**What matters now:** the gate suite is now empirically load-bearing rather than
assumed to be. **What can wait:** performance work, which I deliberately did not start.

---

## 1. Mutation testing (14C)

`scripts/mutation-test.mjs`. Injects one fault, runs gates cheapest-first with early
stop, restores byte-for-byte, and refuses to start unless the tree is clean.

| | Baseline | After hardening |
| --- | ---: | ---: |
| Mutations | 26 | 26 |
| **Caught** | 15 | **22** |
| **Escaped** | **9** | **0** |
| Latent | — | 0 |
| Inert (not gate gaps) | — | 2 |
| Inverse tests passed | 2/2 | 2/2 |
| Apply errors | 0 | 0 |

### The nine escapes, and what closed each

| Mutation | Why it escaped | Closed by | Now caught in |
| --- | --- | --- | ---: |
| `attachment-over-budget` | cache carries its own copy of every cost | `audit-source-integrity` | 2 s |
| `attachment-illegal-slot` | stale cache never uses the newly-legal option | `audit-source-integrity` | 2 s |
| `attachment-assumed-admitted` | same | `audit-source-integrity` | 2 s |
| `manifest-hash-drift` | the recorded hashes were never verified | `audit-source-integrity` | 2 s |
| `cache-handedited-ttk` | nothing recomputed cached values | `audit-cache-recompute` | 3 s |
| `redsec-armor-multiplier` | armour arithmetic stays self-consistent when the multiplier moves | `audit-redsec-model-integrity` | 2 s |
| `ranking-weight` | **latent** — invisible until the next cache rebuild | `audit-ranking-policy-pin` | 2 s |
| `ledger-false-bridge` | the currency bridge flag was never cross-checked | `audit-provenance-consistency` | 2 s |
| `redsec-leak-into-mp` | **inert** — see below | (no gate needed) | — |

### Three verdicts, not two

"No gate caught it" only means something if the mutation *did* something. The harness
now measures two signatures before judging — what a user sees now (cache-backed) and
what a cache rebuild would produce (cache-bypassed):

- **ESCAPED** — nothing caught it and it changes what users see. A real gap.
- **LATENT** — nothing caught it, nothing moves today, but it *would* after the next
  Combat Engine run. The most dangerous shape there is: the history stays green until
  long after the cause. `ranking-weight` was exactly this.
- **INERT** — changes nothing observable. Not a gate gap, and reporting it as one is a
  false accusation against the suite.

### The two inert cases

**`redsec-armor-multiplier` was a badly targeted test.** It searched for any key matching
`/mult/i` and landed on `spilloverResolutionTest.multiplierApplied` — a documentation
fixture nothing computes from. Retargeted at
`damageVsArmor.chestMultipliers.automaticPrimary`, it is caught, with the probe
confirming cached results genuinely moved.

**`redsec-leak-into-mp` revealed real defence in depth.** Multiplayer is protected twice:
the scenario setters force `targetArmor` back to `unarmored` outside REDSEC, *and*
`armorPool()` independently refuses. Removing either alone is provably inert. Rather than
assert that on inspection, `redsec-leak-both-guards` removes both — and **is caught**.
"Inert" is only a positive finding when the leak is demonstrably catchable once it can
actually happen.

---

## 2. State-space testing (14A)

`scripts/audit-state-space.mjs` — **81,708 scenario evaluations**, zero anomalies.

| Tier | Coverage | Evaluations |
| --- | --- | ---: |
| 1 — AUTO rankings | **exhaustive**: 300 distances × 3 mode/armour states × 2 priorities × 8 scopes | 24,000 |
| 2 — per-weapon manual | **exhaustive**: 62 weapons × 300 distances × 3 states | 56,700 |
| 3 — handling preferences | **stratified**: all 16 preference combinations × deterministic weapon/distance strata | 1,008 |

243,108 ranked entries and 71,192 builds inspected for: non-finite values, BTK below 1 or
non-integer, negative TTK, trigger-to-kill below mechanical TTK, non-positive damage,
over-budget builds, duplicate attachment slots, picks absent from the catalog, thrown
exceptions, and non-determinism (14 probes re-evaluated after thousands of intervening
queries).

**Mode leakage** is checked as its own property: in Multiplayer the armour selector must
be inert, so every Multiplayer query is run at both armour states and compared. Zero
divergences across 4,800 paired queries.

**Not enumerated, stated explicitly:** the full Cartesian product (~1.7 × 10⁹) is not run;
attachment combinations are covered by the optimizer torture test instead; `classChoice`
and `context` are not swept because they filter which weapons are offered and cannot
change any weapon's computed values.

---

## 3. Property tests (14B)

`scripts/audit-invariants.mjs` — nine properties, all holding.

**Overlay algebra**
- Applying the overlay to already-overlaid data applies **nothing** — and reports the
  refusal rather than silently no-op'ing. This is the structural reason the VSSM
  double-transform cannot happen by accident.
- An older overlay cannot override a newer one, regardless of array order.
- A change whose declared baseline no longer matches is **refused, not forced**.

**One dataset** — the browser and the cache builder hold a field-for-field identical
effective dataset.

**Mode separation** — REDSEC unarmored equals Multiplayer at **every one of 300 metres**
in both priorities, not at five samples. EA state that once armour breaks the weapon
deals the same damage at the same ranges, and this project implements that by *reusing*
the Multiplayer path, so any divergence at all would be a defect.

**Claims cannot exceed evidence** — no field is CURRENT_PATCH_VERIFIED without a matching
source attestation; every weapon with a weak result-affecting dependency carries a
confidence cap; the verified combat version stays below the first blocking patch.

---

## 4. Independent reference engine (14H)

`scripts/reference-engine.mjs` re-implements the combat math from the documented
mechanics, importing nothing from the cache builder or `app.js`.

`scripts/audit-cache-recompute.mjs` re-derives **378,535 values** across **37,200 cached
rows** and **296 distinct builds**: BTK from damage, TTK from cadence, closed-form
quadratic-drag flight time, trigger-to-kill, low-body consistency with a single
documented limb multiplier per weapon, sniper damage against the audited curve, and every
cached attachment cost against the **live catalog**. **Zero mismatches.**

It also fingerprints the **catalog shape** by recounting every legal attachment
combination from the live catalog and comparing with the count the cache was built from —
which is what makes a catalog edit against a stale cache impossible to ship.

**Shared assumptions, stated rather than buried:** the Beam Index weighting is this
project's ranking policy, so re-deriving it proves arithmetic, not the model. Attachment-
modified per-shot damage is taken from the cache row, because those transforms live in
the upstream simulator. The drag *model form* comes from upstream documentation; only its
closed-form solution is re-derived.

**Two of my own invariants were wrong and were corrected, not forced:**
- Damage is **not** monotonic in distance — snipers rise into a sweet spot. My first
  version produced 158 false failures on the L115, M2010 ESR and PSR. Snipers now get the
  stronger treatment instead: their damage is recomputed from the audited curve.
- The implied limb multiplier is not recoverable from `ceil()`-quantised BTK. Replaced
  with a check that one documented multiplier reproduces every low-body BTK.

---

## 5. Optimizer torture test (14G)

`scripts/audit-optimizer-torture.mjs` — **85/85 weapon-distance cases optimal**.

17 priority weapons (the meta winners, the four 1.4.2.0 weapons, the near-tied ones, and
the unusual transforms: VSSM, SL9, M250) × 5 distances. 66,267 nodes visited; 7 cases
found an equal-scoring but different pick set, which is a tie-break policy choice, not a
correctness question.

**The bound was validated before the result was trusted.** Branch-and-bound is only sound
if the bound is admissible; an over-tight bound would prune the true optimum and this test
would then "verify" the DP against a brute force that was itself wrong. Re-running with
the score bound disabled — up to **4,013,387 complete builds** for the EF88 — reaches an
identical maximum in every case.

**Proves:** the DP finds the true optimum of the objective it is given. **Does not prove:**
the objective. Both sides use production's per-option scores, so this is an algorithm
check, not a model check.

---

## 6. Boundary and floating-point testing (14I)

`scripts/audit-boundaries.mjs` — all passing.

- **254 damage breakpoints** probed at r−1, r and r+1; **156 repeated-breakpoint cases**
  verified against the rule that the outgoing tier applies *at* the shared distance;
  182 inter-breakpoint probes confirm damage never drifts where no breakpoint exists.
- **Range ends** — every weapon has rows at 1 m and 300 m and none outside; zero-distance
  flight time is exactly 0; zero-drag degenerates to distance/velocity; zero velocity
  returns null rather than infinity.
- **The near-integer RPMs.** 449.999, 799.999 and 830.7692307692307 are how the game's own
  tables express 450, 800 and 10800/13. Each is proven to agree with its nominal form to
  **under 0.1 ms over a five-shot kill**, and the VSSM's two rates are proven not to
  collapse into each other — that pair is the difference between two fire modes.
- **BTK quantisation** — `ceil(100/20)` is 5, not 6; a hair under 20 correctly needs 6.
- **310 cache round-trips** — every float survives JSON exactly.

Five weapons never spend their full point budget (ES 5.7, M357 Trait, M44, PSR, USG-90).
Recorded as a note, not an error.

---

## 7. Uncertainty propagation (14E)

`scripts/audit-uncertainty.mjs`. **The rule: a range is only swept when the evidence
supplies one.** Inventing "±20%" so a value can be classified would present a guess as a
measurement.

| Classification | Count | Detail |
| --- | ---: | --- |
| **ROBUST** | 4 | The four missing `adsTime` values (M16A4, PP-19, RPK-74M, L115), swept across the range their own class actually exhibits (230–270, 165–185, 280–420, 430–550 ms). **None can change a recommendation anywhere.** |
| **SENSITIVE** | 1 | The two unpublished REDSEC mechanics. Their alternatives are discrete and both implemented, so all four combinations are exhaustive rather than sampled. The AUTO winner depends on which reading is right at **3 of 14** probed cases — which is exactly why REDSEC 2-plate stays PROVISIONAL. |
| **UNKNOWN** | 13 | Damage curves, fire modes, ammo profiles, shotgun pellets and the rest. No published bound exists at any tier, so none is swept. |

This converts "4 missing fields" from an open risk into a measured non-issue, and confirms
the one genuinely decision-relevant uncertainty is the one already labelled as such.

**I fixed a bug in my own tool before trusting its verdict:** `Number(null)` is 0 and
`Number.isFinite(0)` is true, so weapons with an *absent* `adsTime` were entering the peer
range as 0 ms. Three of the four credible ranges started at an impossible zero.

---

## 8. Dead / shadowed data audit (14F)

`scripts/audit-field-dependency.mjs` — 143 field/weapon perturbations across 11 weapons.

| Reaches results on the rebuild path | Measured inert |
| --- | --- |
| `bulletVel` 6/11, `recoilV` 7/11, `recoilVar` 7/11, `recoilIncAds` 7/11 | `rpm`, `dmg`, `spreadMax`, `adsTime`, `mag`, `tacRld`, `emptyRld`, `reloadSpeed`, `recoilDir` |

**The most surprising measurement: halving every damage tier changes nothing on the ranked
path.** That is not a dead field — it is **shadowed**. The class audits pin damage, BTK,
TTK and cadence per range band, the ranking reads the *audited definition*, and the raw
field is the audits' **input**. 11/11 probed weapons have a passing class audit pinning
both `rpm` and `dmg`.

That distinction decides where verification effort belongs: a stale `raw.dmg` surfaces as
a **class-audit failure**, not as a silently wrong recommendation.

`spreadMax` is inert *for a different reason* — it feeds the cached Beam Index through the
upstream effective-spread simulation, while the on-demand fallback index uses only recoil
primitives plus base spread. That is a limit of the measurement, not evidence about the
field, and it is reported as such.

**No unexplained contradictions remain.** Every inert field is accounted for by a
class-audit override, a display-only role, or a known limit of perturbation.

---

## 9. Weight audit (16)

`scripts/audit-ranking-weights.mjs` — **a report. No weight was changed.**

```
metaCost  = triggerTtk^0.55 × beamIndex^0.45 × (offPace ? 1.35 : 1)
beamIndex = recoil×(1.00+0.35t) + unpredictable×(1.25+0.75t)
          + effSpread×(2.00+2.50t) + moving×(0.35+0.65t)          t = min(1, d/120)
```

| Input | Weight | Kind |
| --- | --- | --- |
| triggerTtk / beamIndex exponents | ^0.55 / ^0.45 | **preference** |
| off-pace penalty and threshold | ×1.35 beyond 1.25× + 10 ms | **preference** |
| rangeT saturation | 120 m | **preference** |
| recoil, unpredictable, effSpread, moving | coefficients above | mechanical inputs, **preference** coefficients |

**Double-count finding.** `recoilV` enters the Beam Index **twice** — directly, and again
inside `unpredictable = recoil × sin(variation)`. Its effective total coefficient ranges
**1.00× to 2.25×** depending on the weapon's direction variation and the distance, so a
high-variation weapon is penalised for the same recoil value up to **2.25× more** than a
low-variation one.

That is probably intended — magnitude and lateral scatter are different things — but it
was never written down, and it means **recoilV is the most heavily weighted primitive in
BALANCED while also being among the values with the weakest current verification**.

**Recommendation: document the intent; do not change the coefficients to reduce the
correlation.** That would alter what BALANCED means in order to satisfy a statistic.

`effectiveAdsSpreadDeg` carries the largest coefficient and dominates the index at range —
recorded so that any future spread-model change is understood to be the highest-leverage
edit available to the ranking.

**FASTEST KILL carries no preference weighting at all** — it orders by trigger-to-kill
outright and consults Beam Index only on an exact tie (epsilon 1e-9 ms, float noise only).
That is confirmed, not changed.

All of the above is now **pinned** (`data/ranking-policy.json`): changing a weight is
legitimate, changing one without noticing is not.

---

## 10. Reproducibility (14J)

`scripts/audit-reproducibility.mjs` computes a **semantic hash** of all 8 generated
artifacts with wall-clock stamps stripped, so a re-run elsewhere is comparable on what it
**decided** rather than on when it ran. All 8 match their pin.

Exempted keys are enumerated (`generatedAt`, `reconciledAt`, `verifiedAt`, `capturedAt`,
`lastCheckedAt`, `detectedAt`, …). Nothing else is exempt: a value that varies between runs
for any other reason is a reproducibility defect, not noise.

Independent corroboration already on record: 13 combat-cache shards rebuilt locally are
**byte-identical** to CI's, and `build-source-overlay.mjs --check` re-derives the overlay
byte-for-byte from the frozen capture.

---

## 11. Red team (17)

| # | Failure mode | Severity | Likelihood | Detection now | Fix |
| --- | --- | --- | --- | --- | --- |
| 1 | A source file is edited by hand; the cache and the manifest silently disagree | **High** | Medium | `audit-source-integrity` — **proven by 4 mutations** | Done |
| 2 | An attachment's cost or legality changes; the stale cache prices builds wrongly | **High** | Medium | `audit-source-integrity` + catalog-shape fingerprint — **proven by 3 mutations** | Done |
| 3 | A cached value is corrupted or hand-edited | **High** | Low | `audit-cache-recompute`, 378,535 values — **proven** | Done |
| 4 | A BALANCED weight changes and only manifests after the next rebuild | **High** | Medium | `audit-ranking-policy-pin` — **proven, and this is the LATENT class** | Done |
| 5 | A REDSEC value changes while all arithmetic stays self-consistent | **High** | Low | `audit-redsec-model-integrity` reads the number out of the first-party quote — **proven** | Done |
| 6 | A false currency bridge upgrades hundreds of fields at once | **High** | Low | `audit-provenance-consistency` — **proven** | Done |
| 7 | The overlay is applied twice, double-transforming a value | **High** | Low | `audit-invariants` idempotence + the VSSM two-state gate — **proven** | Done |
| 8 | An older overlay overrides a newer one | Medium | Low | `audit-invariants` ordering property | Done |
| 9 | REDSEC armour rules leak into Multiplayer | **High** | Low | **Two independent guards**; both must fail, and that case is caught | Verified |
| 10 | A naming-only edit triggers the expensive 62-job matrix | Low | Medium | `audit-name-honesty` checks the exclusion **and its ordering** | Done |
| 11 | A combat-affecting file is missing from the CI path filter | **High** | Low | Path filters now include `data/source-overlays.json`, `data/ranking-policy.json`, `data/reproducibility-pin.json`, `source-overlay.js`, `scripts/source-overlay.mjs` | Done |
| 12 | Stale service-worker cache serves old data | Medium | Medium | Cache name versioned (`v33-source-overlay`); verified in-browser | Existing |
| 13 | Freshness bot and Combat Engine race on `main` | Medium | Medium | Bot commits are `[skip ci]`, rebase-not-force; integrated cleanly 6× this session | Existing |
| 14 | Third-party source unreachable is mistaken for a patch | Medium | Medium | Both watchers exit 0 on network failure; `audit-freshness-watchers` tests it offline | Existing |
| 15 | **A wrong value in a class-audit pin** | **High** | Low | **Partially covered.** The class audits re-derive from upstream; a wrong pin *and* a matching wrong source would agree. `audit-cache-recompute` catches it only where the cache disagrees. | **Open — see §13** |

---

## 12. Performance (18)

**Deliberately not attempted.** The brief puts performance after correctness, and the
correctness work filled the available time. Changing code for speed carries a risk of
altering behaviour, and I would rather hand over a slower suite that is trustworthy than
a faster one I had not re-verified.

Measured, for whoever picks this up:

| Gate | Time |
| --- | ---: |
| `audit-optimizer-exhaustive --full` | 120 s |
| `audit-state-space` (full) | 390 s |
| `audit-beam-sensitivity` | 12.5 s |
| `audit-meta-sweep` | 7.8 s |
| `audit-cache-identity` | 4.9 s |
| everything else | < 4 s each |

`audit-optimizer-exhaustive --full` alone is 76% of the fast suite. `audit-state-space`
runs `--quick` in CI (7 sampled distances) and exhaustively on demand — the full 390 s
version is the one whose result is quoted in §2.

---

## 13. Remaining work, ranked

1. **Pin the class-audit definitions the way the ranking policy is now pinned** (red-team
   #15). They are the *operative* values for damage, BTK, TTK and cadence — §8 measured
   that — and they are currently the least protected high-leverage data in the project.
2. **Add `burstBurstsPerMinute` to `build.stats` in the cache.** Without it a burst
   weapon's cached TTK cannot be re-derived from the cache alone; `audit-cache-recompute`
   currently reads it from the weapon record. A self-verifying artifact is worth a rebuild.
3. **Document the recoilV double-count intent** (§9) — one paragraph, and the highest-
   leverage undocumented decision in the ranking.
4. **A current numerical source for damage curves** — still the largest coverage gap
   (62 result-affecting fields), unchanged from the previous pass.
5. **Extend mutation coverage** to the class audits and `roster-data.js`, the two areas
   this pass did not mutate.
6. Performance, per §12.

---

## 14. Evidence classification

**VERIFIED FACTS**
- 26 mutations: 15 caught before, 22 after; 9 escapes closed; 0 escaped on re-run.
- 81,708 scenario evaluations, zero anomalies; 4,800 paired mode-leakage queries, zero
  divergences.
- 378,535 cached values independently recomputed, zero mismatches.
- 85/85 optimizer cases optimal, with the branch-and-bound bound validated against a
  fully unbounded search of up to 4,013,387 complete builds.
- REDSEC unarmored equals Multiplayer at all 300 metres in both priorities.
- All 8 generated artifacts semantically reproduce.
- The four missing `adsTime` values cannot change a recommendation within their credible
  range.

**DERIVED / HIGH CONFIDENCE**
- Multiplayer's protection from REDSEC armour is genuine defence in depth (one guard
  removed → inert; both removed → caught).
- `raw.dmg` and `raw.rpm` are shadowed by class audits on the ranking path.
- `recoilV`'s effective coefficient spans 1.00×–2.25× through its two entry points.

**PROVISIONAL**
- The REDSEC close-range and spillover readings remain unresolved and are the one
  uncertainty measured as decision-relevant (3 of 14 probed cases).

**UNRESOLVED**
- 13 unresolved values have no defensible range and were deliberately not swept.
- Class-audit pins are not independently protected (red-team #15).
- The Interdictor, Match Grade Ammo and VSSM limb multipliers remain blocked on external
  evidence, unchanged from the previous pass.
