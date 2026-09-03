# BF6 Weapons Lab — overnight engineering + validation report

Run: 2026-09-02 → 2026-09-03, autonomous. Branch `main`, no pushes.
Baseline `2856164` → rebased onto `origin/main` (`58104e5`) → final `475764d`.

Backup before any of this: tag `overnight-checkpoint-20260903` and a verified
full-history bundle at `../bf6-weapons-lab-overnight-20260903.bundle`.

---

## What this means (plain English)

**Both open problems are now closed, and neither turned out the way I first
described it.**

**FASTEST KILL now means what it says.** The weapon ranking previously always
used the balanced 55/45 score; PRIORITY only swapped which attachment build was
read. It now ranks by trigger-to-kill, with Beam Index breaking only genuine
ties. **411 of 672** FASTEST KILL winners changed. **BALANCED changed in 0 of
672** — the default experience is untouched.

**The attachment-legality problem was the opposite of what I reported.** I said
the cache shipped builds using unverified attachment values. It does not. The
cache builder already strips unverified *fields* and keeps the verified ones —
it never used a guessed number. The defect was entirely in the live path, which
threw away the whole attachment whenever *any* field was marked unverified. That
hid 13 attachments from the on-demand optimizer and left M250 with no legal
barrel at all. **My earlier report overstated this; the correction is below.**

Consequences: **zero cached builds were invalid, so nothing needed rebuilding**,
and unifying the two paths changed **0 of 1,344** displayed results. It repaired
the fallback path without disturbing a single shipped answer.

**One new problem found and fixed along the way.** The app was calling armoured
REDSEC results "robust to armour uncertainty" while the *winner itself* flipped
between the two readings of EA's unpublished close-range rule. Robustness was
being judged per-weapon when AUTO META also picks the weapon. 25 m is correctly
PROVISIONAL again.

**What can wait:** nothing is now open at HIGH severity. The remaining work is
external — settling EA's close-range rule and armour spillover needs in-game
measurement, not code.

---

## 1. The 6,916 audit count — corrected

**My report's arithmetic gloss was wrong; the audit was right.** I wrote
"56 weapons × 26 distances × both armour states", which reads as 2,912 and is
not what the number counts. 6,916 is a count of **assertions**, not cases, over
**2,782 distinct cases**:

| Component | Weapons | Distances | Cases | Assertions each | Total |
| --- | --- | --- | --- | --- | --- |
| Armoured (REDSEC 2 PLATES) | **53** | 26 | 1,378 | **4** | 5,512 |
| Unarmoured health path | **54** | 26 | 1,404 | **1** | 1,404 |
| | | | **2,782** | | **6,916** |

- **53, not 56**, on the armoured side: `kts100mk8`, `interdictor` and `185ksk`
  have no entry in `data/weapons.json`, and the armoured path needs the raw
  damage curve. They are skipped with a recorded reason.
- **54** on the unarmoured side: `kts100mk8` and `185ksk` produce no health
  damage; `interdictor` does, via the class-audit path.
- The **4 assertions per armoured case** are `armorDamagePerShot`,
  `shotsToBreakArmor`, `btk`, and a reference-internal check that the shot-by-shot
  simulation agrees with the closed form. The unarmoured case asserts
  `btk == ceil(100 / damage)`.

Verified against the audit's own output: `1378 × 4 + 1404 = 6916`. The audit
summary now emits these fields explicitly so the figure is self-documenting.

---

## 2. Did the rebase change anything?

**No. Zero change to any computed result.**

Two upstream commits were integrated: `a2fa8d6` (data-bot atomic cache rebuild)
and `58104e5` (freshness status). The rebase applied all 7 local commits with
**no conflicts**.

The upstream diff touches only timestamps, content hashes and `observedCommit`.
The cache still points at the same upstream commit `fb7a214`, same
`gameVersion 1.4.2.5`, same 62 modelled weapons.

The three big audits *appeared* to change on 2,688 / 2,756 / 312 lines. That was
**entirely CRLF-vs-LF**: checkout rewrote the committed copies to CRLF while the
scripts write LF. With line endings normalised, all three are **byte-identical**.
`.gitattributes` now pins LF for generated artefacts so this noise can never
again hide a real change.

---

## 3. FASTEST KILL — before / after

### What changed

`rankWeapons()` now selects a comparator from the active priority:

| PRIORITY | Comparator order |
| --- | --- |
| BALANCED | `metaCost` (55/45 utility) → trigger-to-kill → Beam Index → tie-break tail |
| FASTEST KILL | **trigger-to-kill** → Beam Index → tie-break tail |

Beam Index breaks a FASTEST KILL tie only within **1e-9 ms** — float noise, not a
tolerance band. The shared deterministic tail is BTK → chest damage → muzzle
velocity → ADS time, so no comparison ever falls through to input order. No new
weight, penalty or scoring component was introduced; both keys were already
computed. **No weapon is hard-coded anywhere in the change.**

### Validation

| Check | Before | After |
| --- | --- | --- |
| FASTEST KILL cases where winner is not the fastest killer | **411 / 672** (61%), worst gap 796 ms | **0 / 672** |
| FASTEST KILL ordering violations | not enforced | **0** |
| BALANCED cases changed | — | **0 / 672** |
| Meta-sweep anomalies | 0 | **0** |

`audit-meta-sweep.mjs` now **fails** on either violation, and `audit-global.mjs`
gates that PRIORITY selects the comparator and that both comparators read
trigger-to-impact TTK.

### How many FASTEST KILL winners changed: **411 of 672 (61%)**

Evenly spread across modes — Multiplayer 136, REDSEC unarmored 136,
REDSEC 2 PLATES 139. By scope: Assault Rifle 84, SMG 84, LMG 71, Carbine 66,
ALL VERIFIED 61, DMR 23, Sniper 11, Shotgun 11.

Representative cross-class changes:

| Mode / distance | Was | Now | Gain |
| --- | --- | --- | --- |
| MP 1 m | RPKM 218 ms | SCW-10 152 ms | −66 ms |
| MP 25 m | L110 361 ms | TR-7 285 ms | −76 ms |
| MP 50 m | KORD 6P67 408 ms | TR-7 322 ms | −86 ms |
| MP 150 m | LMR27 575 ms | M250 485 ms | −90 ms |
| REDSEC 2 PLATES 1 m | SL9 713 ms | KV9 447 ms | **−266 ms** |
| REDSEC 2 PLATES 25 m | KORD 6P67 769 ms | KV9 613 ms | −156 ms |
| REDSEC 2 PLATES 200 m | LMR27 1179 ms | M250 942 ms | −237 ms |

The recorded L110 / KORD 6P67 baselines were validation cases, not required
outcomes, and both remain the **BALANCED** winners at 25 m.

---

## 4. Attachment legality — root cause

### Answer: **B — the live legality rules were wrong (too strict).** Not A, C or D.

The two pipelines disagreed about what "assumed" *means*:

| | Wholly assumed (`assumed: true`) | Partially assumed (`assumedFields`) |
| --- | --- | --- |
| `scripts/build-combat-cache.mjs` | exclude option | **strip only the named fields, keep the option and every verified field** |
| `app.js buildOptions()` | exclude option | **exclude the whole option** ← the defect |

**A (stale/invalid cache) — ruled out.** The cache points at the same upstream
commit, validates, and `stripPartialAssumptions()` removes assumed fields *before
simulation*. No unverified value ever entered a cached build. My earlier report
implied otherwise and was wrong.

**C (wrong classifications) — ruled out.** The markers are precise. Across the
whole catalogue: **4 wholly assumed** (correctly excluded by both), **13
partially assumed**, 91 clean.

**D (incomplete source data) — ruled out.** The data names exactly which fields
are unverified:

| Records | Assumed field |
| --- | --- |
| 5 muzzles (`comp_brake`, `flash_comp`, `long_supp`, `light_supp`, `compensator`) | `adsRecoilDecayMult` |
| 3 barrels (`heavy`, `heavy_ext`, `cryo`) | `spreadFiringDecCoefMult`, `spreadFiringDecOffsetMult` |
| 2 lasers, 2 lights | `hipSpreadDecayBoost` |
| 1 ergo (`full_auto_vssm`) | `recoilDecreaseFactorOverride` |

### M250 root cause

M250's weapon table offers exactly two barrels, `heavy` and `heavy_ext`, and
**both** are partially assumed. Barrel is a **required** slot (no `none` option).
Under the live path's all-or-nothing rule the barrel slot emptied and
`buildOptions()` threw `barrel: no verified point-cost choices` — so M250 could
not be built at all whenever the exhaustive cache was unavailable. It was
invisible as a defect in normal use only because the cache is authoritative.

### The fix: one authoritative pipeline

`attachment-legality.js` is now the single implementation, loaded by
`index.html` for the browser and re-exported by
`scripts/verified-source-sanitizer.mjs` for the cache builder. Neither side
carries its own copy — `audit-optimizer-legality.mjs` fails if `app.js`
re-implements it.

The rule, stated once: wholly-assumed options are excluded; partially-assumed
options keep every verified field with the unverified ones stripped. A stripped
field is *absent*, so downstream code uses its own defined default — exactly as
for an attachment that never had that field. **No unverified number reaches any
calculation, and none is invented.**

It also subsumes the hand-written VSSM exception: `full_auto_vssm`'s verified
full-auto / 800 RPM transform now survives generically, because only its assumed
`recoilDecreaseFactorOverride` is stripped.

### Cached builds invalidated / rebuilt: **0**

Sanitization output is **byte-identical** to the previous implementation across
`attachments.json`, `ammo.json` and `weapons.json` (15 fields stripped from 13
records, identical hashes). The cache was never wrong, so no rebuild was required
— and none was possible locally anyway, since the builder needs the upstream
simulator checkout.

Confirmed by result: **0 of 1,344** meta-sweep results changed after unification.

### Divergence after the fix

| Metric | Before | After |
| --- | --- | --- |
| Primaries whose cached winning build uses a locally-rejected attachment | 27 / 56 | **0 / 56** |
| Weapons with no legal on-demand build | 1 (M250) | **0** |
| Weapons optimizable on-demand | 52 | **56** |

The gate now **requires zero** rather than pinning a baseline.

---

## 5. Exhaustive optimizer results after the fix

Legalising the 13 partially-assumed records enlarged the search space
substantially — the largest single case went from 10.3 M to **59.9 M**
combinations. Every case was still enumerated by true brute force:

| Metric | Value |
| --- | --- |
| Cases | 159 (53 weapons × 3 distances) |
| **True exhaustive cases** | **159 / 159** (`--full`, no pruning) |
| Exact-solver cases | 0 |
| **Combinations enumerated** | **2,017,995,552** |
| Largest single search space | 59,875,200 |
| **Mismatches** | **0** |
| Legality violations | 0 |
| Runtime | 2 m 3 s |

CI now runs `--full`. The 3 skipped weapons are those with no source entry, and
are reported explicitly rather than hidden — the old `weaponsOptimizable` metric
counted them as optimized, which was a misleading figure I have corrected.

---

## 6. New defect found and fixed: overstated REDSEC robustness

`redsecDependencies()` asks whether the **selected weapon's own** numbers move
under the unpublished mechanics. In AUTO META the engine also *chooses* the
weapon, so that is the wrong question alone. At 25 m the winner flips between
readings while each individual weapon looks stable:

| closeRange | spillover | Winner | BTK | TTK |
| --- | --- | --- | --- | --- |
| remove | none / proportional | **KV9** | 11 | 613 ms |
| keep | none / proportional | **TR-7** | 7 | 535 ms |

The chip nonetheless read "REDSEC — ROBUST TO ARMOUR UNCERTAINTY".
`redsecWinnerStable()` now re-ranks across all four interpretation combinations
(memoised per scenario), and a ROBUST claim requires the weapon's numbers **and**
the winner to survive. `audit-mode-isolation.mjs` fails on a ROBUST label with an
unstable winner, across 9 distances × 2 priorities.

Current labelling: 10 m PROVISIONAL, 25 m PROVISIONAL, 50 m ROBUST, 100 m
PARTIALLY VERIFIED (assumed modifier disclosed). **The unresolved EA close-range
interpretation retains PROVISIONAL status wherever it actually bites.**

---

## 7. Re-run matrix

Every combination re-run after both changes. `audit-meta-sweep.mjs`:

| Dimension | Coverage |
| --- | --- |
| Modes | Multiplayer, REDSEC unarmored, REDSEC 2 PLATES |
| Priorities | BALANCED, FASTEST KILL |
| Scopes | ALL VERIFIED + all 7 weapon classes |
| Distances | 28, including 9/21/31/36/54/75/76/83/85/133 m breakpoints |
| **Cases** | **1,344** |
| **Ranking evaluations** | **17,304** |
| **Anomalies** | **0** |
| Winner changes across distance | 155 |
| Distinct winners | 36 (was 30 — the lethal comparator surfaces more weapons) |

Supporting gates, all re-run: engine cross-check 6,916 assertions / 0 mismatches;
eligibility 336 scope cases; cache identity 336 queries × 3 orders / 336 distinct
keys / 0 contamination; name honesty 800/800 cards flagged; advanced options no
dead controls and no combat leakage.

**Final suite: 25 passed, 0 failed. Syntax clean.**

Verified live in the browser at `localhost:8181` after reload: shared policy
loaded (`attachment-legality-v1`), REDSEC/2 PLATES/25 m/FASTEST KILL → KV9,
17.36 armour damage, 5 shots to break, 11 BTK, PROVISIONAL; MP BALANCED → L110;
MP FASTEST → TR-7; M250 builds on-demand at 100/100 points.

---

## 8. Updated trust status

| Area | Was | **Now** | Basis |
| --- | --- | --- | --- |
| **Multiplayer combat** | HIGH CONFIDENCE | **HIGH CONFIDENCE** | 1,404 unarmoured cases, BTK equals `ceil(100/damage)` in every one; 17,304 ranking evaluations, 0 anomalies. Still not VERIFIED because the per-class *damage audits* are CI-only (they need the upstream checkout), so the damage inputs were not re-derived here. |
| **REDSEC combat** | PROVISIONAL | **PROVISIONAL** (unarmored: HIGH CONFIDENCE) | Unarmored is proven to be the Multiplayer path itself. Armoured keeps PROVISIONAL: EA's "reduce or remove" close-range rule is unpublished and still flips the winner at some distances. Robustness claims are now honest about that. |
| **Attachment data** | PROVISIONAL | **PROVISIONAL** | Unchanged and correct: 168 names audited, **0** confirmed against a live in-game string. The legality fix concerned mechanics, not names. |
| **Attachment optimizer** | VERIFIED | **VERIFIED** | 159/159 cases by true brute force over 2,017,995,552 combinations, 0 mismatches, with the enlarged legal search space; one shared legality policy, 0 divergence, 0 unbuildable weapons. |
| **AUTO META** | NOT YET TRUSTWORTHY | **HIGH CONFIDENCE** | The label defect is fixed and enforced: FASTEST KILL ranks by kill speed, 0 violations in 672 cases; BALANCED unchanged. Not VERIFIED, because it inherits the attachment-name PROVISIONAL status and the armoured REDSEC uncertainty. |
| **Advanced options** | VERIFIED | **VERIFIED** | Unchanged: 4 distinct loadouts each, exactly 1 combat result, no dead controls. |

Per your instruction, nothing is labelled VERIFIED merely because the combat
model passes. In the UI, AUTO META still never shows a bare "VERIFIED" chip — the
naming audit records 0 game-verified-exact names, so the best it can read is
"PARTIALLY VERIFIED — N/M NAMES SOURCED".

---

## 9. Commits

| Commit | Scope |
| --- | --- |
| `f6fa005` … `71264b2` | The 7 overnight commits, rebased cleanly onto `origin/main` |
| `941cf62` | `.gitattributes` — LF for generated artefacts |
| `84aaf26` | FASTEST KILL ranks by trigger-to-kill |
| `faa06d3` | One shared attachment legality policy |
| `475764d` | Armoured robustness must include winner stability |

Backup: tag `overnight-checkpoint-20260903`, bundle
`../bf6-weapons-lab-overnight-20260903.bundle` (verified, complete history).
Nothing pushed. Working tree clean.

---

## 10. Next recommended action

**Run the in-game spillover test, then settle the close-range rule the same way.**

Every remaining uncertainty in this project is now external. The code side is
closed: one legality pipeline, an enforced FASTEST KILL contract, 2.0 billion
combinations of optimizer validation, and honest labelling everywhere. What still
limits trust is two sentences EA never quantified.

The spillover test is already specified in `data/redsec-model.json` and takes a
few minutes: **M39 EMR, Standard ammo, chest only, 40–60 m, full-armour target —
6 shots to down means no spillover (current model), 5 means spillover.**

The close-range rule matters more, because it still flips the armoured winner at
some distances. The equivalent test is a **fireMode:auto** weapon against a
full-armour target at a distance inside its first health tier: count shots to
break armour and compare against the two predictions the model already computes
for `remove` versus `keep`. I can generate that per-weapon prediction table on
request so you only need to fire and count.

After that, the highest-value code work is promoting attachment names from
`SOURCE_CORROBORATED` to `GAME_VERIFIED_EXACT` — the only remaining reason
AUTO META cannot read plain VERIFIED.
