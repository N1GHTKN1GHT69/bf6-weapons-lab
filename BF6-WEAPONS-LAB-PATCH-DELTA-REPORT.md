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

**My earlier "97% current coverage" claim was wrong, and the correction is the
most important thing in this report.** That figure counted a value as
verified-current if no patch note mentioned it — but "nobody told us it changed"
is not the same as "we checked and it is right." Corrected, there are now two
separate numbers that must never be merged: **known patch-delta coverage is 97%**
(nothing outstanding against the field), while **current numerical verification
is 1%** (3 of 573 fields actually confirmed against the live game). Zero fields
are verified against 1.4.2.5 — there is no 1.4.2.5 extraction and EA published no
numbers in either recent patch.

**What I can now say precisely is how old the data is, which is better than
before.** Two date bounds pin it: the extraction is dated nine days *after*
1.4.1.0 shipped, so the "1.3.3.0" label on the files is stale metadata rather
than a content ceiling; and the upstream mirror's last data commit lands *one day
before* 1.4.2.0. So the dataset is **current through 1.4.1.5**, missing only
1.4.2.0 and 1.4.2.5 — exactly the two patches already tracked, whose changes name
exactly the 6 already-flagged weapons. I also verified there are **no missing
patches** in between, which is what makes that reasoning sound.

**The recoil/spread problem is now five values, not 186.** Those fields drive 45%
of the BALANCED score and none is confirmed against the live game. Rather than
treat all 186 as equally urgent, I measured what each can actually move: only
**5 of 159** weapon/field combinations can flip a BALANCED winner even at ±25%
error. Four are `recoilV`, on L110, B36A4, M250 and KORD 6P67, all fighting over
the 25–50 m band. L110's win at 25 m — the most-used range — flips to B36A4 if its
recoil is 25% off.

**Trust is per-weapon, not blanket.** A KORD 6P67 result is no longer labelled
provisional because SVK-8.6's ammo data is in question.

**No weapon number was changed.** I exhausted every allowed tier for those five
recoil values, including sym.gg itself (the snapshot's primary source, which is
client-side rendered and unreadable, and whose consumer hasn't updated since
2026-08-13). Aggregator figures exist but are on an incompatible scale and cite no
methodology, so they were not used. **Rankings are byte-identical** — not because
nothing needed updating, but because nothing responsible *could* be.

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

## 1–2. Result-affecting field breakdown — CORRECTED

The earlier "97% current coverage" figure in this report was **wrong in what it
claimed**, and the correction matters more than the number. It counted two things
as verified-current that are not:

- fields a class audit "re-derives" — but those audits re-derive from the *same*
  pinned snapshot, so agreement proves internal consistency, not currency;
- fields with no published patch delta — which means nobody told us it changed,
  a weaker and different claim than knowing it did not.

Corrected breakdown of the 573 result-affecting fields:

| Bucket | Count |
| --- | --- |
| **CURRENT_PATCH_VERIFIED** | **0** |
| **VERIFIED_UNCHANGED** | **3** |
| **PATCH_RECONCILED_NO_KNOWN_DELTA** | **553** |
| **STALE_NEEDS_RECHECK** | **4** |
| **PROVISIONAL** | **9** |
| **MISSING_UNSUPPORTED** | **4** |

The two headline metrics, now emitted separately in
`data/source-verification.json` and flagged never to be merged:

| Metric | Value | What it actually means |
| --- | --- | --- |
| **KNOWN PATCH-DELTA COVERAGE** | **97%** | No outstanding published patch delta against the field. Says nothing about whether the number is current. |
| **CURRENT NUMERICAL VERIFICATION** | **1%** | The value is confirmed against the live version, or affirmatively checked as unchanged through it. Carrying an old value forward does not count. |

Zero fields are CURRENT_PATCH_VERIFIED — there is no 1.4.2.5 extraction, no
in-game measurement on record, and EA published no numbers in either 1.4.2.0 or
1.4.2.5. A gate now fails any field claiming that status without naming
live-version evidence, so this stops being an assumption.

The 3 VERIFIED_UNCHANGED fields are REDSEC armour HP, the +10 m shift, and the
chest-vs-armour multipliers — each with a *recorded, targeted* changelog check
across every intervening patch, not incidental silence.

### Two findings that strengthen what "reconciled" is worth

Neither promotes any field, but together they bound the uncertainty tightly:

1. **Ledger completeness verified.** An independent patch index confirms **no
   patch exists between 1.3.3.0 (2026-06-26) and 1.4.1.0 (2026-07-16)** — no
   1.3.3.5, 1.3.4.0 or 1.4.0.x. The four post-baseline entries are the complete
   set, so reconciliation is a targeted check across a verified-complete set.
   Recorded per field as `reconciliationStrength`.
2. **The dataset's content window is bounded on both sides.** Lower: the
   extraction is dated 2026-07-25, nine days *after* 1.4.1.0 shipped, so it
   captures that patch — the declared "1.3.3.0" is stale file metadata, not a
   content ceiling. Upper: the upstream mirror's last weapon-data commit is
   2026-08-13, **one day before 1.4.2.0 shipped**, so it definitively cannot
   contain it. **Effective content: current through 1.4.1.5, excluding 1.4.2.0
   and 1.4.2.5.**

So the only patches whose combat content could be missing are exactly the two
already tracked as unrepresented, whose blocking items name exactly the 6
already-flagged weapons. That is why a PATCH_RECONCILED field can support HIGH
CONFIDENCE *trust* while its *classification* stays honest — but it is still not
measurement, and nothing was promoted on this basis.

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

## 8b. Recoil / spread sensitivity — the actual research target

`recoilV`, `recoilVar` and `spreadMax` are 186 fields, all carried forward with
no live-version confirmation, and they drive 45% of the BALANCED score. Rather
than treat all 186 as equally urgent,
`scripts/audit-beam-sensitivity.mjs` measures what each can actually move: it
scales the stored beam primitive, recomputes `beamIndex` with the exact
production formula from `build-combat-cache.mjs`, re-ranks, and records winner
and top-3 movement. **2,544 probes across 53 weapons**, at ±10% and ±25% — probe
factors expressing tolerance, never claims a value is wrong.

**Only 5 of 159 weapon × primitive combinations can flip a BALANCED winner.**
132 of 159 have no measurable effect at all.

| Priority | Weapon | Field | Winner flips | Observed flip |
| --- | --- | --- | --- | --- |
| **9** | **L110** | `recoilV` | 2 | 25m +25% → B36A4 wins; 50m −25% → L110 takes it from KORD |
| **8** | **B36A4** | `recoilV` | 1 | 25m −25% → takes 25m from L110 |
| **7** | **M250** | `recoilV` | 1 | 25m −25% → takes 25m from L110 |
| **6** | **M240L** | `spreadMax` | 1 | 10m −25% → takes 10m from M123K |
| **5** | **KORD 6P67** | `recoilV` | 1 | 50m +25% → loses to L110 |

Four of the five are `recoilV`, all contesting the 25–50 m band — the most-used
engagement range. **That is the entire high-impact target: five values, not 186.**

Worklist artifact: `reports/patch-delta/beam-sensitivity.csv`.

### Verification attempt on those five: exhausted, nothing achieved

| Tier | Source | Result |
| --- | --- | --- |
| 1 | EA changelogs 1.4.2.0 + 1.4.2.5, read in full | No recoil/spread value for any of the five. These notes *do* carry other balance items (VSSM barrel recoil, Match Grade, EF88/BROD), so they are a venue where such changes appear when they occur. |
| 2 | `raymdl/BF6-Weapon-Analyzer` | Last weapon-data commit 2026-08-13 — one day before 1.4.2.0. No newer numbers. |
| 2 | **sym.gg** (the primary source the snapshot cites) | Charts page is client-side rendered, not machine-readable, no retrievable version label. The mirror consuming it hasn't updated past 2026-08-13. |
| 3 | Targeted search for extracted recoil values | No source states an extraction methodology. Aggregator figures found (e.g. "L110 recoil 32") are on an **incompatible scale** to the dataset's normalised values (L110 `recoilV` = 0.566) and carry no methodology — unusable, and not used. |

**No numeric value was changed, because none could be responsibly established.**
The five values are carried forward and deliberately **not** promoted: changelog
silence inside a bounded window is not a measurement.

## 9. Current source-data coverage (result-affecting fields)

Reported as two figures, never one — see §1–2 for the full breakdown and why
merging them was the error being corrected:

- **KNOWN PATCH-DELTA COVERAGE: 97%** (556 of 573 with no outstanding delta)
- **CURRENT NUMERICAL VERIFICATION: 1%** (3 of 573 with live-version or
  affirmative-unchanged evidence)

## 10. Updated trust — now dependency-aware, not global

| Layer | Status | Basis |
| --- | --- | --- |
| **Multiplayer combat (56 of 62 weapons)** | **HIGH CONFIDENCE** | Not "current-patch verified" — no field is. Basis: content bounded as current through 1.4.1.5, a **verified-complete** patch ledger with no delta naming them, and the prior 1,404-case unarmoured proof plus 17,304-evaluation sweep. Residual risk is a silent unpublished tune in 1.4.2.0/1.4.2.5. |
| **Multiplayer combat (6 affected weapons)** | **PROVISIONAL**, individually disclosed | EF88/BROD 3/VSSM (donor model), M2010 ESR/SVK-8.6 (Match Grade ambiguity), Interdictor (missing record) — each chip now says so on its own |
| **REDSEC unarmored** | HIGH CONFIDENCE | Unchanged — reuses the Multiplayer path, unaffected by this pass |
| **REDSEC 2-plate** | **PROVISIONAL** | Unchanged, and deliberately not touched by this pass per instruction — the close-range/spillover questions remain separate experimental questions, unresolved |
| **Attachment optimizer** | VERIFIED | Unchanged — no optimizer/legality code was touched, so the prior 2,017,995,552-combination validation still applies without rerun |
| **Ranking engine** | **HIGH CONFIDENCE**, with a measured caveat | Logic unchanged and validated. But BALANCED consumes recoil/spread values that are 0% numerically verified, and 5 weapon/field combinations can flip a winner at ±25% error — so BALANCED carries more input risk than FASTEST KILL, which ranks on trigger-to-kill. |
| **Attachment data** | **PROVISIONAL** | Unchanged this pass: 168 names audited, 0 confirmed against a live in-game string. Evidence-ingestion path built; worklist preserved. |
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
7. **The 5 high-impact recoil/spread values** (L110/B36A4/M250/KORD 6P67
   `recoilV`, M240L `spreadMax`) — no accessible tier publishes a current
   number, including sym.gg itself. These are the only unverified values proven
   able to change a BALANCED winner.

---

## 12. Recommended next action

**One in-game session, measuring five recoil values and three REDSEC shot
counts.** Everything still blocking this project is now a measurement, not an
engineering task — and the measurement list is short and exact because the
sensitivity work narrowed it.

Ranked by what it unblocks:

1. **L110 `recoilV` first.** It is the current BALANCED winner at 25 m — the
   most-used range — and its win flips to B36A4 at +25% error. One weapon, one
   value, highest leverage in the roster. Then B36A4, M250, KORD 6P67 (`recoilV`)
   and M240L (`spreadMax`): five values total, and the ranked worklist in
   `reports/patch-delta/beam-sensitivity.csv` gives the exact scenarios each one
   decides.
2. **The three REDSEC shot counts** (AK4D @ 11 m, RPKM @ 5 m, SVK-8.6 @ 5 m) —
   still the single biggest lever on the overall trust rating, since they can
   move REDSEC 2-plate off PROVISIONAL. Untouched by this pass by design.

If a live client is unavailable, the honest alternative is to **wait for the
upstream mirror to publish a post-1.4.2.0 snapshot** rather than substitute
aggregator numbers. Its last data commit was 2026-08-13; the freshness watcher
already polls hourly and will trigger the pipeline automatically when it moves.
That is a legitimate hold, not a stall — and until then, the Lab now states
exactly what it does and does not know.
