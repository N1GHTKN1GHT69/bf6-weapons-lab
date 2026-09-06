# BF6 Weapons Lab — v1 pre-certification report

**Verdict: READY FOR REAL-GAME AUDIT.**

---

## What this means

This run asked one question: *is the Lab honest enough to be checked against the real game?*
Not "is it right" — the game decides that. "Are its claims traceable, are its uncertainties
labelled, and would anything notice if a number broke?"

The answer is yes, with one correction to what the previous run believed and one deliberate
non-decision left for a human.

**The correction.** Last run concluded that class-audit values *shadow* the raw damage data —
that changing `raw.dmg` moved nothing. That measurement was taken through a path that bypasses
the exhaustive cache, so it described the **fallback**, not production. In production the cache
is primary and was **built from `raw.dmg`** for most classes. The audit values are an
independent re-derivation that agrees, which is exactly what makes them a useful cross-check
rather than an override. The genuine overrides are narrower: shotgun ammo profiles and the
sniper curves and bolt intervals. All 182 class-audit pins are now mapped, with zero
unexplained.

**The non-decision.** `recoilV` really does enter the BALANCED score twice. I tested whether
that is accidental duplication by removing each term across all 300 distances. It is not
duplication — the two terms carry different information — but dropping the second one changes
the BALANCED winner **zero times in 300 distances**. So it is real, it is not a bug, and it does
not decide what a user reads. Whether it *deserves* the influence it has over sub-winner
ordering is a product judgement, and I left the formula untouched.

**What is still unknown, and is labelled unknown.** No number in this project has been
confirmed against the actual game. "Source-verified" means a publisher printed it and we match;
it does not mean anyone has fired the gun. That is what the next phase is for, and there is now
an 84-test plan for it, ordered so the tests that can invalidate the most come first.

**What matters now:** run the real-game audit. **What can wait:** everything else — feature
work is frozen.

---

## 1. Session boundaries

| | |
| --- | --- |
| Starting HEAD | `56896cb` |
| Ending HEAD | `6dabd45` (last engineering commit; the report and tag sit one commit later) |
| Bot commits integrated | `01199a7` (freshness status; timestamps + EA page hash only) |
| Working tree | clean |
| Local gates | **43 / 43 pass** |
| CI | green |
| Combat Engine | not re-run — no cache-affecting data changed this session |
| Production | verified in browser at https://bf6-weapons-lab.pages.dev |
| Freeze tag | `v1-rc-pre-real-game-audit-20260906` |

### Commits

| SHA | Subject |
| --- | --- |
| `9fe41e4` | wip: class-audit provenance, BALANCED ablation, class-audit pin mutations |
| `e8ef3b0` | audit: local backstop for class-audit pins, since the class audits only run in the cancellable Combat Engine |
| `b24c178` | audit: class-audit provenance, BALANCED ablation, and the real-game audit package |
| `6dabd45` | ci+gate: close the last two pipeline gaps before the v1 freeze |

---

## 2. Class-audit provenance (Phase 1–2)

182 pins across 62 weapons. **Operativeness decided mechanically** — the cached production
value is compared against a raw-derived and an audit-derived value at nine distances. Reading
comments is not evidence.

| Class | Damage pin | Cadence pin | Velocity pin |
| --- | --- | --- | --- |
| Assault Rifle | CONCORDANT | raw RPM operative | audit does not pin |
| Carbine | CONCORDANT | raw RPM operative | audit does not pin |
| SMG | CONCORDANT | raw RPM operative | audit does not pin |
| LMG | CONCORDANT | raw RPM operative | audit does not pin |
| Sidearm | CONCORDANT | raw RPM operative | audit does not pin |
| DMR | **raw operative** (audit bands are a rounded restatement) | raw RPM operative | audit base = raw ×6 |
| Sniper Rifle | **audit operative** ×4, concordant ×1 | **audit interval operative** ×5 | audit base = raw ×5 |
| Shotgun | **audit operative** ×4 | **audit cadence operative** ×2, concordant ×2 | — |

### Reconciliation against the source (Phase 2)

| Verdict | Count | Detail |
| --- | ---: | --- |
| **MATCH** | 115 | cadence 57 (raw RPM = source `RoF`) + 1 (VSSM = `SingleRoF`, the documented fire-mode state) + velocity 58 (raw = source, all) |
| **MISMATCH** | **0** | |
| **NO CURRENT SOURCE** | 66 | all 62 damage curves + 4 shotgun cadences |

**Currentness, stated honestly:** RPM and velocity are source-verified at 1.4.2.0. **Damage
curves have no current publisher at any version** — they are historically pinned to the
upstream mirror, and the audits are re-derivations of that same snapshot, not independent
confirmation. They are not promoted.

### Protection

The class audits *do* catch a corrupted pin — verified by mutating an M433 range band and
watching `audit-assault` fail. But they run **only** in the Combat Engine, which is
`cancel-in-progress`. `audit-class-audit-provenance` now pins the expected relationship per
class and runs in the cheap suite; all four class-audit pin mutations are caught in ≤3 s.

---

## 3. BALANCED model (Phase 3, 16)

```
metaCost  = triggerTtk^0.55 × beamIndex^0.45 × (offPace ? 1.35 : 1)
beamIndex = recoil×(1.00+0.35t) + unpredictable×(1.25+0.75t)
          + effSpread×(2.00+2.50t) + moving×(0.35+0.65t)
unpredictable = recoil × sin(min(90, directionVariation))        t = min(1, d/120)
```

`recoilV`'s effective coefficient spans **1.00× – 2.25×** depending on direction variation and
distance. Its combined share of the Beam Index for top-5 weapons ranges **39.2 % – 93.9 %**.

### Ablation — exact, over all 300 distances

| Variant | Winner changes | Top-3 changes | Position moves |
| --- | ---: | ---: | ---: |
| `NO_UNPREDICT` — drop the second recoil term | **0 / 300** | 123 | 8,829 |
| `NO_DIRECT` — drop the direct recoil term | 15 / 300 | 293 | 13,213 |
| `DECORRELATED` — keep scatter angle, drop the re-multiplication | 7 / 300 | 269 | 10,613 |
| `NO_SPREAD` — control | 114 / 300 | 263 | 13,143 |

The control moving 114/300 confirms the harness measures something.

### Verdict: **C — distinct information, but never decisive for the winner**

Not option B (accidental duplication): decorrelating the term gives a *different* answer again
than dropping it, so it genuinely encodes magnitude-weighted scatter rather than re-charging
magnitude. Not option A either: dropping it changes the BALANCED winner **zero times in 300
distances**.

**Changed: nothing.** No coefficient was touched. A duplicated-looking term that carries real
information and never flips the headline answer is a product question, not a mathematical error,
and it is not mine to settle. It now has a measured answer to be decided against.

**FASTEST KILL remains fully objective** — it orders by trigger-to-kill outright and consults
Beam Index only on an exact tie (ε = 1e-9 ms, float noise only).

Everything above is pinned in `data/ranking-policy.json`; changing a weight is legitimate,
changing one *without noticing* is not.

---

## 4. Patch ledger (Phase 4)

| Version | Status |
| --- | --- |
| 1.4.1.0 | VERIFIED PRESENT |
| 1.4.1.5 | NO COMBAT EFFECT |
| **1.4.2.0** | **PENDING — 3 unresolved** |
| 1.4.2.5 | VERIFIED PRESENT |

**LIVE 1.4.2.5 · DATA 1.4.2.0 · COMBAT 1.4.1.5**

COMBAT VERIFIED **cannot** advance beyond 1.4.1.5. The exact blockers:

1. **Interdictor** — added by 1.4.2.0, absent from the upstream feed. Its 128 ballistic
   primitives are captured, but it has no damage curve and no attachment compatibility.
2. **Match Grade Ammo** damage-reduction fix (M2010 ESR, SVK-8.6) — EA changed a value and
   published no number; the ammo record exposes no damage-reduction field to compare against.
3. **VSSM limb damage multipliers** — adjusted, no numbers published, and the Sym dump carries
   no damage data at all.

None is resolvable from any public source. Missing publication is **not** treated as evidence
of no change — all three remain blocking.

---

## 5. REDSEC (Phase 5)

Two mechanics EA stated qualitatively and never quantified:

| Mechanic | Lab implements | Alternative |
| --- | --- | --- |
| close-range max-damage step vs armour (automatics) | **remove** (the literal reading) | reduce/keep |
| armour-break spillover | **none** | proportional |

This pair is the **only** uncertainty in the project measured as decision-relevant: it flips the
AUTO winner at **3 of 14** probed REDSEC 2-plate cases. Everything else unresolved is either
ROBUST or has no defensible range.

### The minimum discriminating experiments

**Spillover — SVK-8.6, 1–9 m band (use 5 m), 2 plates, chest only, Standard ammo.**
Armour damage 60.697/shot, health 66.70/shot, breaks after 2. No-spillover predicts **4** shots
to down; proportional predicts **3**. 68 % of the breaking shot's armour damage goes unused
under the current model. **Fire exactly 3: dead = spillover, alive = no spillover.** Binary —
no shot counting to get wrong, and a 9 m band means ranging error cannot flip it.

**Close-range — AK4D, 1–21 m band (use 11 m), 2 plates, chest only.**
Remove predicts 7 shots (armour breaks after 4); keep predicts 6 (breaks after 3).

7 viable spillover tests and further close-range candidates are in
`reports/overnight/redsec-experiments.json`.

---

## 6. Special fire modes (Phase 6)

| Weapon | Finding |
| --- | --- |
| **VSSM** | The only roster weapon whose published rates disagree: `RoF` 799.999, `SingleRoF` 449.999. The weapon stores the semi-auto rate; `full_auto_vssm` (Folding Stock) carries the full-auto rate. **TWO-STATE-CORRECTLY-SPLIT.** Four gate assertions make a double transform impossible; negative-tested. |
| **SL9** | The source publishes a burst cadence of **771.428** RPM distinct from its 674.999 automatic rate, and **no catalog attachment switches to it**. That state is not modelled. Not a defect — a modelling boundary — but it is the VSSM shape minus the trigger, so it is in the audit plan (T3). |
| **M16A4** | Burst, and the only weapon carrying `burstBurstsPerMinute`. Its cached TTK cannot be re-derived from the cache alone because `build.stats` omits that field; the recompute gate reads it from the weapon record and the gap is recorded. |
| Attachment overrides | Exactly two exist (`full_auto`, `full_auto_vssm`). Both cross-checked; neither is baked into a base record. |

---

## 7. Numerical verification (Phase 8)

| | |
| --- | --- |
| **Numerator** | **290** (287 CURRENT_PATCH_VERIFIED + 3 VERIFIED_UNCHANGED) |
| **Denominator** | **573** result-affecting fields |
| **Percentage** | **51 %** |
| Weapon coverage | 59 of 63 have current-verified values; **0 fully current**; the 4 with none are the shotguns, absent from every Sym dump |
| Confirmed against the actual game | **0 fields** |

### Negative-tested, both directions

| Test | Result |
| --- | --- |
| Metadata-only edit (`source-verification.json` set to VERIFIED, overrides cleared) | 51 % → **51 %** — did not rise ✓ |
| Make the operative source stale (remove the 1.4.2.5 no-change finding, breaking the bridge) | 51 % → **1 %** — collapsed ✓ |

The second result is the important one: the metric is genuinely load-bearing on the currency
bridge, not on labels.

**What holds it at 51 %:** damage curves (62 fields, no publisher), `adsTime` (62, not
published), `fireMode` (62), `ammoProfile` (62), and the 4 shotguns.

---

## 8. Optimizer certification (Phase 9)

| | |
| --- | --- |
| Weapons | 17 priority (meta winners, all four 1.4.2.0 weapons, the fragile ones, VSSM/SL9/M250) |
| Cases | **85** weapon × distance, across 5 distances |
| Nodes visited | 66,267 |
| **Mismatches** | **0** |

The bound was validated before the result was trusted: re-running with the score bound disabled
— up to **4,013,387 complete builds** for the EF88 — reaches an identical maximum. Seven cases
found an equal-scoring but different pick set, which is a tie-break policy choice, not a defect.

**Proves** the DP finds the true optimum of its objective. **Does not prove** the objective —
both sides use production's per-option scores. That is an algorithm check, not a model check.

---

## 9. Reference engine (Phase 10)

| | |
| --- | --- |
| Values independently recomputed | **378,535** |
| Rows | 37,200 (62 weapons × 300 distances × 2 strategies) |
| Distinct builds | 296 |
| **Mismatches** | **0** |

Covers BTK from damage, TTK from cadence, closed-form quadratic-drag flight time,
trigger-to-kill, low-body consistency against a single documented limb multiplier, sniper damage
against the audited curve, every cached attachment cost against the **live** catalog, and a
catalog-shape fingerprint recounting every legal combination.

**Shared assumptions, labelled:** the Beam Index weighting is project policy — re-deriving it
proves arithmetic, not the model. Attachment-modified per-shot damage is taken from the cache
row. The drag *model form* is upstream's; only its closed-form solution is re-derived.

---

## 10. Mutation testing (Phase 11)

| | Baseline (previous run) | This run |
| --- | ---: | ---: |
| Mutations | 26 | **32** |
| **Caught** | 22 | **29** |
| **Escaped** | 0 | **0** |
| Latent | 0 | **0** |
| Inert | 2 | **1** |
| Inverse tests | 2/2 | **2/2** |

Six new mutations this run, all caught: four class-audit pin corruptions (sniper curve, sniper
interval, shotgun profile, concordant range band), the REDSEC armour HP pool, and a
both-guards Multiplayer armour leak.

**The one inert case is a positive finding.** Multiplayer is protected from REDSEC armour twice
— the scenario setters force `targetArmor` back to `unarmored` outside REDSEC, *and*
`armorPool()` independently refuses. Removing either alone is provably inert. Removing **both**
is caught. "Inert" only counts as defence in depth when the leak is demonstrably catchable once
it can actually happen.

---

## 11. Mode, UI and trust labels (Phase 12–13)

| Claim | Evidence |
| --- | --- |
| Multiplayer cannot consume REDSEC armour rules | 4,800 paired queries, zero divergence; two independent guards |
| REDSEC unarmored = Multiplayer health path | identical at **every one of 300 metres**, both priorities |
| BALANCED and FASTEST do not leak | FASTEST is objective at every probed distance; they differ at 4/6 |
| No dead controls | classChoice and context move the loadout and *only* the loadout; distance, mode/armour, category and priority all move combat |
| Handling preferences | **not user-facing** — engine defaults held in state so a UI control can never silently steer the optimizer. Now asserted, because with a valid cache such a control would look dead while steering the next rebuild |
| AUTO META pool | 48 ranked; exclusions stated exactly (Interdictor empirical-current; 4 shotguns class-scoped; EF88/BROD 3/VSSM no verified projectile ballistics) |
| BUILD MY GUN catalogue | 56 primaries, complete |
| Shotguns class-scoped | 4 ranked within their own class only, until pellet hit probability is modelled |

**Every label checked against the dependency graph. None upgraded; none needed downgrading.**
`LIVE 1.4.2.5 · DATA 1.4.2.0 · COMBAT 1.4.1.5` states three different things and does not merge
them, which is what keeps the version label honest.

---

## 12. Clean-room reproduction (Phase 14)

From a fresh worktree at the same commit:

- 7 integrity gates pass
- `build-source-overlay --check` re-derives the overlay byte-for-byte (39 changes)
- all **8** generated artifacts reproduce their semantic hash exactly
- the ranking signature over 24 mode/priority/distance combinations is **identical**
  (`b7b644d7e2f28e59…` in both trees)

Timestamps are excluded from semantic hashes and the exempt keys are enumerated. `contentHash`
was added to that list this run, with justification: it is EA's *page* hash, an external
observation that oscillates between two values across CDN edges while the normalised body is
byte-stable within a session (measured 4/4). The things that catch a real EA change —
`gameVersion`, `combatImpact`, `matchedTerms` — remain in the hash, and a simulated version bump
still fails the gate.

---

### A reporting defect, found and fixed

Two committed gate artifacts did not hold the run whose numbers earlier reports quoted.
`reports/validation/mutation-test.json` held only the last 2-case subset run, and
`reports/validation/state-space.json` held the `--quick` 2,891-evaluation run — because CI
runs `--quick` and its output overwrites the full local run. The reports were right; the
committed evidence for them was not, which is the same failure mode as an unverified hash.

Both now hold the full runs: **32 mutations** and **81,708 state-space evaluations** (24,000
exhaustive AUTO rankings, 56,700 exhaustive per-weapon manual builds, 1,008 stratified
preference cases; 243,108 ranked entries and 71,192 builds inspected; no impossible value,
illegal build, mode leak, exception or non-determinism).

---

## 13. CI and pipeline (Phase 15)

| Check | State |
| --- | --- |
| Source-manifest hashes enforced | ✅ `audit-source-integrity`, in both workflows |
| Class-audit changes trigger validation | ✅ `data/*-audit.json` triggers the Combat Engine, and now quality-gates too |
| Combat-affecting files trigger the engine | ✅ including `data/source-overlays.json`, `source-overlay.js`, `scripts/source-overlay.mjs` |
| Naming-only files do not | ✅ exclusion present **and its ordering asserted** |
| Source update cannot falsely promote | ✅ promotion is earned in the ledger; negative-tested |
| Network failure cannot look like a balance update | ✅ both watchers exit 0 on failure; tested offline |
| Bot commit races handled | ✅ `[skip ci]`, rebase-not-force; 7 integrated cleanly across sessions |
| Concurrent jobs cannot discard validation | ✅ a cancelling push always re-validates the *final* file state; mirrored files now also in the cheap suite for a second chance |

### One open item, not fixable from here

**Cloudflare Pages deploys on push, independently of GitHub Actions.** A commit that fails CI
would still deploy. This has never happened — every push this session and last was green — but
the gate is advisory rather than blocking. Fixing it means changing Cloudflare project settings
(build command or deploy gating), which is outside the repository and was not authorised. It is
recorded here as the single highest-value pipeline change available.

---

## 14. Real-game audit package (Phase 17–18)

**`BF6-REAL-GAME-AUDIT-PLAN.md` — 84 tests**, generated from live data rather than transcribed,
because a stale figure in an audit plan sends someone to verify a number the Lab no longer makes.

| Tier | Tests | A failure invalidates |
| --- | ---: | --- |
| 1 — mechanism | 12 | a rule dozens of weapons inherit |
| 2 — class representative | 7 | one whole class |
| 3 — edge case | 22 | a weapon, value or unresolved mechanic |
| 4 — roster confirmation | 43 | one weapon |

**`BF6-FALSE-DATA-CHECKLIST.md`** — ten questions for hunting false confidence, each with the
answer the repo can give today, plus eight beliefs already disproved by measurement. Four of
those eight were mistakes made by the *auditing tools themselves*, which is the point: a wrong
test is worse than no test, because it produces confident findings.

### The first three tests, in order

1. **T1-001 — shot interval = 60000/RPM.** M433, 10-round string at 60 fps. If TTK is not
   `(BTK−1) × 60000/RPM`, every ranking in the app rests on the wrong base. Cheapest test,
   largest blast radius.
2. **T1-002 — damage breakpoints are exact metres.** M433 at 20/21/22 m. The app promises
   answers at an exact metre; if drop-off is banded or interpolated, that promise is false
   everywhere.
3. **T1-010 — REDSEC spillover.** SVK-8.6, 5 m, armoured chest, fire exactly 3. The only
   measured decision-relevant uncertainty in the project, and a binary observation.

---

## 15. Performance (Phase 16)

**Not attempted.** Correctness work filled the run, and the brief puts performance last. Gate
timings are recorded in the previous report; `audit-optimizer-exhaustive --full` (120 s) and the
full `audit-state-space` (390 s) dominate. Nothing was traded for speed.

---

## 16. Release-candidate decision (Phase 19)

### READY FOR REAL-GAME AUDIT

| Requirement | State |
| --- | --- |
| No known P0 correctness defect | ✅ none found |
| 0 active mutation escapes | ✅ 32 mutations, 29 caught, 0 escaped, 1 documented-inert |
| Optimizer independently verified | ✅ 85/85, bound validated |
| Reference recomputation clean | ✅ 378,535 values, 0 mismatches |
| Class-audit operative values mapped and classified | ✅ 182 pins, 0 unexplained, 0 source mismatches |
| Source/version state truthful | ✅ LIVE/DATA/COMBAT stated separately |
| No known false VERIFIED label | ✅ every label checked; none upgraded |
| Production matches repo | ✅ verified in browser |
| Repository clean, CI green | ✅ |
| Unresolved mechanics explicitly exposed | ✅ 1 SENSITIVE, 4 ROBUST, 13 UNKNOWN |
| Comprehensive real-game audit package | ✅ 84 tests + false-data checklist |

Unknown is acceptable. False certainty is not, and none was found.

### Frozen

Tag `v1-rc-pre-real-game-audit-20260906`, following the repository's existing tag convention.
**No further formula changes until real-game evidence warrants them.**

---

## 17. Evidence classification

**VERIFIED FACTS**
- 32 mutations, 29 caught, 0 escaped, 0 latent, 2/2 inverse.
- 378,535 cached values independently recomputed; 0 mismatches.
- 85/85 optimizer cases optimal; bound validated against an unbounded search.
- 182 class-audit pins mapped; 0 unexplained; 115 source-matched; **0 mismatches**.
- Dropping the unpredictable-recoil term changes the BALANCED winner 0 times in 300 distances.
- REDSEC unarmored equals Multiplayer at all 300 metres.
- Coverage 290/573 = 51 %; rises on no metadata edit; collapses to 1 % when the bridge breaks.
- Clean-room reproduction is exact, including the ranking signature.

**DERIVED / HIGH CONFIDENCE**
- Shotgun ammo profiles and sniper curves/intervals are genuine cache-feeding overrides;
  everything else is concordant or raw-operative.
- Multiplayer's protection from REDSEC armour is real defence in depth.
- The second recoil term encodes magnitude-weighted scatter, not duplicated magnitude.

**PROVISIONAL**
- L115 velocity 664 → 742: single source, no second publisher, **not named in EA's notes** —
  the weakest provenance in the dataset, and it decides the FASTEST-KILL sniper order at
  101–120 m.
- REDSEC close-range and spillover readings.

**UNRESOLVED**
- 0 fields confirmed against the actual game.
- Damage curves have no current publisher (62 result-affecting fields).
- Interdictor, Match Grade Ammo, VSSM limb multipliers.
- SL9 burst state published but unmodelled.
- Cloudflare deploys independently of CI.

---

## 18. Remaining work, ranked

1. **Run the real-game audit.** Everything else is now downstream of it.
2. **Gate Cloudflare deployment on CI** — the one pipeline gap, outside the repo.
3. **Add `burstBurstsPerMinute` to `build.stats`** so the cache is fully self-verifying
   (needs a rebuild).
4. **Document the recoilV double-count intent** — one paragraph; the measurement is done.
5. **A current numerical source for damage curves** — still the largest coverage gap.
6. Performance.
