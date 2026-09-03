# BF6 Weapons Lab — overnight engineering + validation report

Run: 2026-09-02 → 2026-09-03, autonomous. Branch `main`, no pushes.
Baseline commit `2856164` → final commit at end of this document.

---

## What this means (plain English)

**The combat maths is in good shape.** I built a way to run the actual
application headlessly and check its real output — not just read the source —
and then compared it against maths written independently from the raw data.
Across **6,916 comparisons** covering every weapon at 26 distances, in both
armour states, **production and the independent reference agreed every single
time**. A separate sweep of **17,304 ranking evaluations** found **zero**
impossible or nonsensical results.

**Your KORD question has a definite answer: 12 BTK is correct** for the model as
implemented, and it does *not* depend on the unresolved spillover mechanic. The
old "5 shots / 11 BTK" expectation isn't wrong arithmetic — it is what you get
under the *other* reading of one EA sentence that has never been published
precisely. Details below.

**Three real defects were found.** Two I fixed. One I deliberately did not,
because fixing it changes the headline answer the product gives, and that is your
call, not mine:

1. *(fixed)* The weapon-count badge lied. "ALL VERIFIED 55" sat above a result
   saying "best out of 48", because the badge and the ranking used different
   filters. Both now come from one rule, and every excluded weapon has a stated
   reason.
2. *(fixed)* The REDSEC armour panel didn't show armour damage, which is why
   "17.1 damage / 80 armour HP / 6 shots" looked like broken arithmetic. It never
   was — armour has its own damage number (14.39) that simply wasn't on screen.
3. *(NOT fixed — needs your decision)* **FASTEST KILL does not rank by fastest
   kill.** The weapon ranking always uses the balanced 55/45 score; PRIORITY only
   changes which attachment build is read. In **411 of 672** measured cases the
   recommended weapon is not the fastest killer, worst case by **796 ms**. See
   *Next recommended action*.

**What can wait:** everything cosmetic. The ↑green/↓red/neutral colour scheme you
asked about is already implemented correctly, so I left it alone.

---

## Executive trust status

| Area | Rating | Basis |
| --- | --- | --- |
| **Multiplayer combat model** | **HIGH CONFIDENCE** | 1,404 unarmored cases: production BTK equals `ceil(100 / damage)` in every one. 17,304 ranking evaluations, zero anomalies. Not VERIFIED only because the per-class damage audits are CI-only (they need the upstream simulator checkout, absent locally), so the *damage inputs* were not re-derived here. |
| **REDSEC unarmored** | **HIGH CONFIDENCE** | Proven to be the Multiplayer path itself, not a copy: winner and BTK match Multiplayer at every distance tested. EA state health damage and ranges are unchanged, so reuse is the correct model. |
| **REDSEC 2-plate** | **PROVISIONAL** | Armour HP, +10 m shift, post-armour health path and 1.3.3.0 class multipliers are verified. But the winner at 25 m *flips* on an unresolved mechanic (see below). The app already labels this "PROVISIONAL REDSEC RANKING". Correctly provisional, not broken. |
| **Attachment data** | **PROVISIONAL** | 168 names audited, **0** confirmed against a live in-game string; 94 source-corroborated, 51 unverified, 23 explicit placeholders. The posture is right (nothing invented, everything flagged). Separately, 27 primaries ship builds using attachments whose modifiers upstream marks *assumed*. |
| **Attachment optimizer** | **VERIFIED** | 156 cases; 87 checked by **true exhaustive enumeration** (50,521,932 combinations, no pruning), the rest by an independent exact solver that reproduced brute force wherever both ran. Optimum score, point spend and build legality matched in **all 156**. |
| **AUTO META** | **NOT YET TRUSTWORTHY** *(as labelled)* | The maths underneath is clean. The problem is the label: FASTEST KILL does not rank by kill speed. BALANCED is sound and is the default. |
| **Advanced options** | **VERIFIED** | Executed, not assumed: Player class and Loadout focus each produce 4 distinct loadouts and **exactly 1** combat result — matching the UI's own claim that they change recommendations only. No dead controls. |

---

## KORD 6P67 / 25 m / 2 PLATES

Reproduced exactly from your screenshots by the harness (`BF6_LAB_DIAG.redsecTrace`).

| Quantity | Value |
| --- | --- |
| Health damage / shot | **17.13** |
| Armour damage / shot | **14.3892** = 17.13 × 0.84 |
| Chest-vs-armour multiplier | **0.84** (automatic weapons, BF6 Update 1.3.3.0) |
| Armour HP | **80** (2 plates × 40) |
| Shots to break armour | **6** — `ceil(80 / 14.3892)` = `ceil(5.560)` |
| Armour left after 5 shots | 8.054 — a 6th shot is unavoidable |
| Spillover | **none** (implemented policy; unpublished mechanic) |
| Excess on the breaking shot | 6.335 of 14.3892, discarded |
| Health shots after break | **6** — `ceil(100 / 17.13)` = `ceil(5.838)` |
| **Total BTK** | **12** |
| RPM | 899.999 |
| Shot interval | 66.667 ms |
| Firing time | (12 − 1) × 66.667 = **733.334 ms** |
| Velocity | 724 m/s |
| Flight time @ 25 m | **36.086 ms** |
| **Trigger-to-kill** | 733.334 + 36.086 = **769.42 ms** |

### Is 12 BTK correct?

**Yes — given the implemented reading of EA's close-range rule, and it is robust
to the spillover question.**

- Under `spillover = none`: 6 + 6 = **12**.
- Under `spillover = proportional`: the breaking shot carries 7.54 health damage,
  leaving 92.46 HP, which still needs `ceil(92.46 / 17.13)` = 6 shots. Still
  **12**. The unresolved spillover mechanic **does not affect this answer.**

### Where the old "5 shots / 11 BTK" expectation comes from

It is the other reading of one EA sentence, not an arithmetic error.

EA say automatic weapons have their "very close-range maximum damage step"
*"reduced or removed"* against armour, and publish no table.

- **"removed"** (implemented): the 20.67 step is dropped, so 17.13 applies from
  0 m → armour damage 14.3892 → **6 shots to break, 12 BTK**.
- **"reduced"/kept**: the 20.67 step survives the +10 m shift and covers 25 m →
  armour damage 20.67 × 0.84 = 17.36 → `ceil(80/17.36)` = **5 shots to break,
  11 BTK**.

"Removed" is implemented because it requires no invented number; "reduced by how
much" would. That choice is recorded in `data/redsec-model.json` under
`unresolved`, and the app surfaces it per result as
*"Close-range armour damage — DERIVED — AFFECTS THIS RESULT"*.

**This is not a cosmetic uncertainty.** At 25 m / 2 PLATES the *winner itself*
changes with the reading:

| Close-range reading | Spillover | Winner | BTK | TTK |
| --- | --- | --- | --- | --- |
| remove | none | **KORD 6P67** | 12 | 769 ms |
| remove | proportional | **KORD 6P67** | 12 | 769 ms |
| keep | none | **M250** | 8 | 651 ms |
| keep | proportional | **M250** | 8 | 651 ms |

Spillover: immaterial. Close-range rule: decisive. The result is correctly
labelled PROVISIONAL.

---

## REDSEC mechanics

| Mechanic | Status | Notes |
| --- | --- | --- |
| Armour HP | **VERIFIED** | 80 HP, 2 × 40, stated by EA. Gauntlet 40 HP recorded but not exposed. |
| Health vs armour damage | **VERIFIED (principle)** | Two separate curves; only the armour curve is adjusted. |
| +10 m range shift | **VERIFIED** | Every drop-off threshold moves outward 10 m. |
| Chest-vs-armour multipliers | **VERIFIED CURRENT** | 0.84 auto / 0.91 DMR / 0.67 sniper (1.3.3.0). No later change found in 1.4.1.0–1.4.2.5. |
| Post-armour health | **VERIFIED** | Identical to Multiplayer — proven by execution, not asserted. |
| Close-range auto step | **DERIVED** | "reduce or remove" is unquantified. Materially changes results. |
| Armour-break spillover | **UNVERIFIED** | Not addressed by any source. Immaterial for KORD; quantified per result. |
| Two plates vs one 80 HP pool | **UNRESOLVED, IMMATERIAL** | Identical results under no-spillover. |
| Sniper sweet-spot under +10 m | **UNVERIFIED** | Any armoured sweet-spot sniper result stays provisional. |
| Shotguns | **EXCLUDED** | Correctly excluded from cross-class ranking; pellet spread not modelled. |

`data/redsec-model.json` already encodes a **decisive in-game test** to settle
spillover in a handful of shots (M39 EMR at 40–60 m: 6 shots = no spillover,
5 = spillover). That remains the single highest-value external input.

---

## Bugs found

| # | Severity | Issue |
| --- | --- | --- |
| 1 | **HIGH** | FASTEST KILL does not rank by trigger-to-kill. `rankWeapons()` always sorts by the 55/45 laserbeam utility. 411/672 cases show a non-fastest winner; worst gap 796 ms. **Open — needs your decision.** |
| 2 | **HIGH** | Two attachment-legality policies disagree. The exhaustive cache admits attachments carrying upstream `assumedFields`; `buildOptions()` rejects them. 27 of 56 primaries ship a cached *winning* build using such a barrel (`heavy_ext` ×78, `cryo` ×32, `heavy` ×9). **M250 has no non-assumed barrel at all**, so its on-demand build throws outright whenever the cache is unavailable. **Open — pinned, not resolved.** |
| 3 | **MEDIUM** | Count inconsistency: "ALL VERIFIED 55" above "best out of 48". **Fixed.** |
| 4 | **MEDIUM** | REDSEC armour panel omitted armour damage, making its own shot counts unverifiable on screen. **Fixed.** |
| 5 | **MEDIUM** | `renderPrimaryBuild()` caught *every* exception and degraded to "EXHAUSTIVE BUILD CACHE PENDING", reporting a code fault as a benign data-freshness state. **Fixed.** |
| 6 | **LOW** | Confidence chip read "N/M NAMES EXACT" for a count including `SOURCE_CORROBORATED`, which the audit's own definitions say is *not* an exact-name claim. **Fixed.** |
| 7 | **LOW** | `audit-global`'s ballistics gate matched an inline filter string, so a behaviour-preserving refactor broke it. Gates that match source text are brittle by construction. **Fixed, and largely superseded** by the new execution gates. |

### Investigated and cleared (not bugs)

- **M87A1 showing 75 damage at 31 m** where the raw curve says 60.8 — this is the
  audited **Slugs** ammo profile, correctly applied from the optimized build.
- **Shotgun TTK "discontinuities"** at 1→5→9 m — one-shot kills whose TTK *is*
  projectile flight time; a 400% relative jump is 8 ms. The sweep now requires an
  absolute move too.
- **↑green / ↓red / neutral chips** — already correct (`.fx.up`, `.fx.down`,
  `.fx.none`). No change made.
- **"Standard Optic", "Variable High", "Extended"** — all already correctly
  classified `INTERNAL_PLACEHOLDER`, and rendered with a CATEGORY LABEL chip.

---

## Bugs fixed — cause, fix, verification

**#3 Count inconsistency.** *Cause:* `populateTabs()` counted weapons with a
class audit that aren't `empirical-current`; `buildRankPool()` additionally
required cross-class eligibility and exact ballistics. *Fix:* both now derive
from `rosterScopeExclusion()` / `combatScopeExclusion()`. *Verified:*
`audit-eligibility-consistency.mjs`, 336 scope cases — advertised count equals
ranked count everywhere, every exclusion has a recognised reason.
56 primaries = 48 rankable + Interdictor + 4 shotguns + EF88/BROD 3/VSSM.

**#4 Armour panel.** *Cause:* the headline damage metric is soldier-health
damage; armour damage existed in the model but never reached the summary.
*Fix:* the panel now states armour damage/shot, health damage/shot, the
multiplier in a tooltip, and the spillover rule as explicitly unverified.
*Verified:* `audit-mode-isolation.mjs` re-derives `ceil(armourHP/armourDmg)`,
`ceil(100/healthDmg)` and their sum **from the rendered text** at 5 distances.

**#5 Silent render failure.** *Cause:* a blanket `catch` around build rendering.
*Fix:* faults recorded on `state.lastBuildError`; missing build now reads
"NO BUILD PRODUCED" instead of a cache-freshness message. *Verified:* every
primary rendered in both modes, zero silent failures, against a pinned
expected-empty set (Interdictor only, which is fail-closed by design).

**#6 Name-confidence overstatement.** *Cause:* `verified` counted
`SOURCE_CORROBORATED` and the chip called it "EXACT". *Fix:* wording is now
"NAMES SOURCED" and `buildNameConfidence()` tracks `exact` separately.
*Verified:* `audit-name-honesty.mjs` — 800/800 rendered cards carry a status
flag; no headline may say EXACT while the audit records 0.

---

## Data corrections

**None.** No weapon damage, RPM, range, magazine, velocity, attachment cost,
effect or compatibility value was changed. One new file was added:
`data/optimizer-legality-divergence.json` — a recorded baseline of the known
legality conflict, not gameplay data.

---

## Attachment name audit

| Status | Count |
| --- | --- |
| `GAME_VERIFIED_EXACT` | **0** |
| `SOURCE_CORROBORATED` | 94 |
| `UNVERIFIED` | 51 |
| `INTERNAL_PLACEHOLDER` | 23 |
| `MISMATCH` | 0 |
| **Total** | **168** |

Duplicates are handled correctly: 10+ shared-display-name groups exist (five
`6H64 Vertical` grips, three `Factory Angled`), and identity is the
`attachmentId`, never the string. Rendering verified by execution: **800 of 800**
attachment cards carry a name-status flag. Naming remains display-only —
`affectsOptimizer: false`, enforced by the existing gate.

Remaining examples needing live-game confirmation: every optic tier (`Iron
Sights`, `Standard Optic`, `Variable Low`, `Variable High`, `Thermal`, `Thermal
Hybrid`), bare barrel tiers (`Extended`, `Heavy Extended`), and abbreviated
source strings such as `#01 BUCK`.

---

## Optimizer audit

| Metric | Value |
| --- | --- |
| Cases | 156 (52 weapons × 3 distances) |
| **True exhaustive** cases | **87** |
| Combinations brute-forced | **50,521,932** |
| Exact-solver cases | 69 |
| Largest single search space | 10,342,080 (DRS-IAR) |
| Total raw space per distance | 132,898,236 |
| **Mismatches** | **0** |
| Legality violations | 0 |

Method: brute force enumerated *every* combination with no pruning for spaces
≤ 2,000,000. Larger spaces used an independently written top-down memoised exact
solver, which reproduced brute force on **every** case where both ran — so the
larger results rest on a validated method, not an unproven shortcut. Nothing here
is sampling, and nothing sampled is called exhaustive.

Remaining uncertainty: this validates the **on-demand DP** against true optimum
over the candidate set. It does not re-derive the shipped exhaustive cache, which
requires the upstream simulator checkout (CI-only). Bug #2 is the live
consequence of that gap.

---

## META engine audit

| Metric | Value |
| --- | --- |
| Modes | 3 (MP, REDSEC unarmored, REDSEC 2 PLATES) |
| Priorities | 2 |
| Scopes | 8 |
| Distances | 28, including 9/21/31/36/54/75/76/83/85/133 m boundaries |
| Cases | 1,344 |
| **Ranking evaluations** | **17,304** |
| **Anomalies** | **0** |
| Winner changes across distance | 198 |
| Distinct winners | 30 |

Checked for and found none of: impossible BTK, non-finite or negative TTK/damage,
trigger-TTK below mech-TTK, out-of-order ranking, TTK discontinuity, or any case
where an armoured target dies faster than an unarmoured one.

Cache identity: 336 queries evaluated in **three different orders** including an
adversarial Multiplayer / 2-PLATE interleave — results order-independent, and all
336 scenario keys serve exactly one answer.

---

## Test results

**Baseline:** 17 locally runnable gates, **17 passed, 0 failed, 0 warnings.**
No pre-existing failures. (`reports/overnight/baseline-gates.log`)

**Final:** **25 passed, 0 failed.** Syntax clean across all sources.

New gates added (8), all wired into `BF6 Lightweight Quality Gates`:

| Gate | What it proves |
| --- | --- |
| `audit-engine-crosscheck.mjs` | 6,916 production-vs-independent comparisons |
| `audit-eligibility-consistency.mjs` | 336 scope cases; counts reconcile |
| `audit-mode-isolation.mjs` | Mode isolation + on-screen armour arithmetic + no silent build failures |
| `audit-optimizer-exhaustive.mjs` | 156 cases vs true exhaustive enumeration |
| `audit-optimizer-legality.mjs` | Pins the legality divergence baseline |
| `audit-meta-sweep.mjs` | 17,304 ranking evaluations, anomaly detection |
| `audit-name-honesty.mjs` | Nothing on screen overstates name confidence |
| `audit-cache-identity.mjs` | Order-independence, no scenario-key collisions |
| `audit-advanced-options.mjs` | No dead controls; advanced options don't touch combat |

**The structural gap these close:** before tonight, *every* local gate read
`app.js` as text and pattern-matched it. That proves a function exists; it cannot
prove it computes the right number. `scripts/lab-harness.mjs` boots the real
`app.js` in a Node vm behind a minimal DOM/fetch shim so audits compare **actual
production output** against independent references.

---

## Performance

| Job | Scale | Runtime |
| --- | --- | --- |
| Optimizer exhaustive | 50,521,932 combinations enumerated | 4.9 s |
| Meta sweep | 17,304 ranking evaluations | 7.9 s |
| Engine cross-check | 6,916 comparisons | ~5 s |
| Cache identity | 1,008 evaluations | 4.9 s |
| Full 25-gate suite | — | under 2 minutes |

Pruning used: none in the brute-force path (that is the point). The exact solver
memoises on `(slot index, remaining budget)` and was validated against brute force
on all 87 overlapping cases before being relied on for the 69 larger ones.

---

## Files changed

- `app.js` — diagnostics surface (`redsecTrace`, `scope`, `render`, `optimizer`),
  exclusion predicates, armour summary, honest confidence labelling, build-error
  recording. **No combat, ballistic, ranking or optimizer maths altered.**
- `styles.css` — one rule for the armour-rule chip.
- `README.md` — corrected the PRIORITY description to match measured behaviour.
- `.github/workflows/quality-gates.yml` — runs the 9 engine-execution gates.
- `scripts/audit-global.mjs` — ballistics gate moved onto the new predicate.
- **New:** `scripts/lab-harness.mjs`, `scripts/redsec-reference.mjs`, and the 8
  new audit scripts above.
- **New data:** `data/optimizer-legality-divergence.json` (baseline record).
- **New reports:** `reports/overnight/*.json`, `*.csv`, `baseline-gates.log`.
- `BF6-OVERNIGHT-STATE.md`, this report.

## Checkpoints

| Commit | Scope |
| --- | --- |
| `36bf53c` | Harness + REDSEC trace |
| `248206a` | Eligibility/count consistency |
| `024414c` | REDSEC UI auditability + mode isolation |
| `db4d9fc` | Optimizer exhaustive validation + legality conflict |
| `0fe61fb` | Meta sweep + PRIORITY gap recorded |
| `7d19565` | Name honesty, cache identity, advanced options, CI wiring |

Nothing pushed. History intact. Working tree clean.

## Blockers

**None.** Two environment limitations, worked around, not blocking:

1. `.upstream/bf6-analyzer` is not checked out locally, so the eight per-class
   damage audits are CI-only. Their outputs are present and passing as data.
2. Spillover and the close-range rule cannot be settled without in-game
   measurement or a published damage-vs-armor table. Both are explicitly modelled
   as unresolved rather than hidden in a formula.

---

## Next recommended action

**Decide what FASTEST KILL should mean, then I implement it in one commit.**

This is the weakest link in the chain right now — not because the maths is wrong,
but because the product currently cannot defend its own headline. A control
labelled *"Lowest kill time, even if it kicks harder"* returns a weapon that is
not the fastest killer in 61% of cases, by up to 796 ms.

Two defensible answers:

- **(A) Make it true** — sort by `triggerTtk` under FASTEST KILL, with Beam Index
  breaking ties. This is what `README.md` already documents and what the engine
  already computes (`bestLethal` rows exist). It changes headline winners in
  ~61% of FASTEST KILL queries, including the L110 / KORD 6P67 results you
  recorded as the baseline. BALANCED — the default — is untouched.
- **(B) Relabel it** — keep the ranking and change the control's copy to describe
  what it does: it optimises the *build* for kill speed within a
  balanced weapon ranking. Zero maths change, zero winner change.

**My recommendation: (A).** The tool exists to answer "what actually kills
fastest here", the engine already computes it, and the README already promises it.
(B) preserves your recorded baseline but leaves the product unable to answer its
own most direct question. I did not do (A) tonight only because it changes the
exact results you asked me to preserve.

After that, in order: resolve the attachment-legality conflict (bug #2 — I
recommend extending the existing `auditedAssumedException` mechanism to the
spread-decay barrels, since damage/RPM/BTK are unaffected and it makes M250
buildable again), then run the M39 EMR in-game test to close out spillover.
