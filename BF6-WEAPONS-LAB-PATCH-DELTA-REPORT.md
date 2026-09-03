# BF6 Weapons Lab — current-patch (1.4.2.5) source re-derivation report

Session: 2026-09-03, autonomous. Branch `main`.
Baseline preserved: tag `pre-142x-baseline-20260903`, bundle
`../bf6-weapons-lab-pre-142x-20260903.bundle`, and commit `858c2c6`.
Commits this pass: `fbc237f` (architecture), `e43db88` (correction).

This report is additional to, not a replacement for,
[`BF6-WEAPONS-LAB-OVERNIGHT-REPORT.md`](BF6-WEAPONS-LAB-OVERNIGHT-REPORT.md),
which remains the record of the prior session's optimizer/ranking/legality work.

---

## What this means (plain English)

**The Lab is no longer capped by a version number.** Previously, every field
sourced from the pinned 1.3.3.0 game-file snapshot was flagged "stale" simply
because the live game is 1.4.2.5, regardless of whether anything actually
changed. I checked the full official patch history between those two versions,
weapon by weapon, and found that **only 6 of 62 weapons (57 of 63 roster
entries counting Interdictor) are named by an actual recorded gameplay change.**
The other 56 weapons' values are now correctly classified as **checked and
current**, not merely old.

**Trust is now per-weapon, not blanket.** A KORD 6P67 result is no longer
labelled provisional because SVK-8.6's ammo data is in question. Each weapon's
displayed confidence chip reflects only its own data.

**No weapon number was changed.** I searched official EA patch notes, the
upstream data simulator, and community sources for exact replacement values for
the 6 affected weapons. None exist publicly. Per the data policy, no number was
invented. **Rankings are therefore byte-identical to before this pass** — not
because nothing needed updating, but because nothing responsible *could* be
updated. That is the honest, if less satisfying, answer to "how much did the
meta change."

**One of my own findings was wrong and I want to be direct about it.** I
initially classified a VSSM barrel-recoil patch fix as "not result-affecting"
because our data has no field to represent it. On correction, I re-derived that
finding properly: the field's absence is schema-wide (no weapon's barrel
records carry recoil, anywhere), which rules out "VSSM specifically has missing
data" — but does **not** prove the underlying game mechanic has zero effect.
That item is now correctly recorded as unresolved, not resolved. VSSM's
displayed trust status is unchanged either way (it was already provisional for
other reasons).

---

## 1–2. Result-affecting fields: stale at start → current now

| Metric | At start | Now |
| --- | --- | --- |
| Result-affecting fields (of 759 total) | 573 | 573 |
| Flagged stale (**blanket** version compare) | **564 / 573 (98%)** | *(superseded)* |
| **Current** (dependency-aware: checked against the full patch ledger) | — | **556 / 573 (97%)** |
| Stale — a specific unresolved delta names this exact field | — | **4** |
| Missing — no value exists at all | — | **4** |
| Provisional — donor/estimated model, independent of patch status | 9 | 9 (unchanged) |

The jump from 2% to 97% "current" did not come from acquiring new data. It came
from replacing a metric that couldn't distinguish "unchanged" from "unchecked"
with one that actually checked.

---

## 3. Fields still unresolved — exact list

| Weapon | Field | Status | Why |
| --- | --- | --- | --- |
| M2010 ESR | `dmg` | STALE_NEEDS_RECHECK | Match Grade Ammo fix (1.4.2.0); residual reading — may describe the base cartridge rather than the ruled-out `long_range` attachment |
| M2010 ESR | `ammoProfile` | STALE_NEEDS_RECHECK | same |
| SVK-8.6 | `dmg` | STALE_NEEDS_RECHECK | same |
| SVK-8.6 | `ammoProfile` | STALE_NEEDS_RECHECK | same |
| EF88 | `dmg`, `bulletVel` | PROVISIONAL | donor/estimated model; "weapon statistics updates" (1.4.2.0) unquantified |
| BROD 3 | `dmg`, `bulletVel` | PROVISIONAL | same |
| VSSM | `dmg`, `bulletVel` | PROVISIONAL | same |
| VSSM | *(no weapons.json field — attachment-level)* | **UNRESOLVED**, corrected this pass | barrel recoil fix (1.4.2.0); schema carries no recoil field on any barrel, roster-wide — see §5 correction below |
| M16A4, PP-19, RPK-74M, L115 | `adsTime` | MISSING | absent from every source; already made a *neutral* tie-break rather than worst-case (prior session) |
| Interdictor | *(entire record)* | MISSING | no weapons.json entry exists; stat-aggregator sites found but not used (no stated methodology) |
| *(model-level)* | REDSEC close-range rule, armour spillover | PROVISIONAL / UNVERIFIED | unrelated to this pass — REDSEC experimental questions, kept separate per instruction |

---

## 4. Weapons most affected by current-patch findings

| Weapon | Items | Net effect on displayed status |
| --- | --- | --- |
| **VSSM** | 2 (weapon statistics; barrel recoil) | Unchanged — already PROVISIONAL |
| EF88 | 1 (weapon statistics) | Unchanged — already PROVISIONAL |
| BROD 3 | 1 (weapon statistics) | Unchanged — already PROVISIONAL |
| M2010 ESR | 1 (Match Grade Ammo) | Now discloses `SOURCE DATA STALE_NEEDS_RECHECK` on its chip (previously silent) |
| SVK-8.6 | 1 (Match Grade Ammo) | Now discloses `SOURCE DATA STALE_NEEDS_RECHECK` (previously silent) |
| Interdictor | 1 (new weapon) | Unchanged — already excluded via empirical-current |
| **All other 56 weapons** | 0 | Now show **no** source-data caveat at all — previously implicitly "stale" by blanket version compare |

---

## 5. Every source-data correction that changed BTK/TTK

**None.** No `weapons.json`, `attachments.json`, or `ammo.json` numeric value
was edited this pass. Confirmed by diff: `reports/overnight/meta-sweep.csv` is
byte-identical to the pre-patchwork checkpoint (`858c2c6`) across all 1,344
cases — mode × priority × scope × distance. This pass is classification and
architecture work: it changes what the Lab *says* about its data, not the data
itself.

### The one inference error, corrected mid-pass

I initially wrote that VSSM's barrel-recoil fix was "not result-affecting"
because the current data has no field to represent it. That conflated *"our
schema doesn't model this"* with *"verified unchanged."* On correction I:

1. Confirmed **no barrel record across the entire 62-weapon catalog** carries a
   recoil-affecting field — this is a schema-wide absence, not evidence VSSM's
   data specifically is incomplete.
2. Confirmed VSSM's own **grips** — where this schema *does* model recoil
   (`adsRecoilTierMod`) — are fully populated, identically to every other
   weapon's. VSSM is treated consistently everywhere the concept exists.
3. Found no numeric magnitude at any evidence tier.
4. Reclassified the item **UNRESOLVED**, not resolved. Two readings stay
   explicitly open: barrels may genuinely never carry recoil in BF6's real
   combat math (nothing to model), or this schema may have a real roster-wide
   gap unrelated to VSSM. Neither is asserted; no number is invented.

VSSM's displayed status did not change — it was already `PROVISIONAL` from the
weapon-statistics item — but the research log no longer claims this specific
question is closed. Full evidence trail:
`data/current-patch-coverage.json` → `researchLog`.

---

## 6–8. Winner changes

**BALANCED winners: 0 changed. FASTEST KILL winners: 0 changed. Attachment-build
winners: 0 changed.** Direct consequence of §5 — no input value moved, so no
output could move. The optimizer, legality gate, and full 1,344-case meta sweep
were re-run and confirmed identical rather than assumed identical.

---

## 9. Current source-data coverage (result-affecting fields)

**97% (556 / 573).**

Full six-bucket breakdown, all 759 fields:

| Bucket | Count |
| --- | --- |
| CURRENT_1.4.2.5_VERIFIED | 176 |
| UNCHANGED_SINCE_EARLIER_PATCH_VERIFIED | 557 |
| STALE_NEEDS_RECHECK | 4 |
| PROVISIONAL | 9 |
| MISSING | 13 |

("Unchanged since earlier patch, verified" means the full patch-delta ledger —
every official update between the pinned snapshot and 1.4.2.5 — was checked
against that weapon and named no change, which is a checked fact, not an
assumption of stability.)

---

## 10. Updated trust — now dependency-aware, not global

| Layer | Status | Basis |
| --- | --- | --- |
| **Multiplayer combat (56 of 62 weapons)** | **HIGH CONFIDENCE**, current-patch checked | No unresolved delta names them; the previous session's 1,404-case unarmoured proof and 17,304-evaluation sweep still hold unchanged |
| **Multiplayer combat (6 affected weapons)** | **PROVISIONAL**, individually disclosed | EF88/BROD 3/VSSM (donor model), M2010 ESR/SVK-8.6 (Match Grade ambiguity), Interdictor (missing record) — each chip now says so on its own |
| **REDSEC unarmored** | HIGH CONFIDENCE | Unchanged — reuses the Multiplayer path, unaffected by this pass |
| **REDSEC 2-plate** | **PROVISIONAL** | Unchanged, and deliberately not touched by this pass per instruction — the close-range/spillover questions remain separate experimental questions, unresolved |
| **Attachment optimizer** | VERIFIED | Unchanged — no optimizer/legality code was touched, so the prior 2,017,995,552-combination validation still applies without rerun |
| **Ranking engine** | HIGH CONFIDENCE | Unchanged |
| **AUTO META end-to-end** | **PROVISIONAL globally, but now per-weapon** | 56 of 62 weapons carry no override at all; a query landing on one of the other 6 discloses exactly which fields are in question and why |

---

## 11. Remaining blockers

**None are code or process blockers — all six are genuine external evidence
gaps**, each exhausted across every available tier before being left open:

1. **EF88 / BROD 3 / VSSM base statistics** (1.4.2.0 "weapon statistics
   updates") — EA published no numbers; upstream simulator has not synced past
   the pinned commit; no datamine found with exact current values.
2. **M2010 ESR / SVK-8.6 Match Grade Ammo** — the specifically-tagged
   `long_range` ammo option is proven inert (0/600 cached rows); the base
   `dmg` curve's status is genuinely unresolved pending either a published
   number or in-game measurement.
3. **VSSM barrel recoil** — no field exists anywhere in this schema to carry
   the value; unresolved rather than resolved, per the correction above.
4. **Interdictor** — no responsible source publishes exact values; stays
   excluded.
5. **4 missing `adsTime` values** — absent from every checked source; already
   neutralised rather than defaulted to worst-case.
6. **REDSEC close-range / spillover** — deliberately untouched this pass; the
   in-game test plans from the prior session remain the path to close them.

---

## 12. Recommended next action

**Nothing further should be spent chasing exact numbers for the 6 affected
weapons right now — that evidence does not exist publicly, and I have checked
every tier the data policy allows.** Continuing to search would burn effort
against a wall, not close a gap.

The two highest-leverage next steps are both already queued and don't need new
engineering:

1. **The REDSEC in-game tests from the prior session** (AK4D @ 11 m, RPKM @
   5 m for close-range; SVK-8.6 @ 5 m for spillover) remain the single biggest
   lever on the Lab's overall trust rating — they can move REDSEC 2-plate off
   PROVISIONAL, which nothing in this pass touched.
2. **If you have access to a live 1.4.2.5 client**, the 6 affected weapons are
   now a short, exact shopping list for manual verification: EF88/BROD 3/VSSM
   base damage-per-hit at any two ranges, M2010 ESR/SVK-8.6's Match Grade
   damage value, and VSSM's suppressed-barrel recoil behaviour with/without the
   attachment equipped. Six weapons, not 62 — the dependency-aware audit did
   the work of finding them.

Everything else in the Lab — the other 56 weapons, the optimizer, the ranking
engine, REDSEC unarmored — is not blocked on anything from this pass.
