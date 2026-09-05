# BF6 Weapons Lab — 1.4.2.0 ingestion, overnight pass 2026-09-05

## What this means

The blocking problem is solved. The project had been stuck because BF6 shipped update
1.4.2.0 with weapon stat changes and EA published no numbers, so the site was carrying
1.3.3.0-era values and honestly labelling them as such. Sym.gg — the outlet that
actually publishes those numbers — appeared to have nothing newer. It did: its 1.4.2.0
data had been publicly available for weeks inside a Google Sheet, and the previous
watcher could not see it because it was only watching sym.gg's own website.

Those numbers are now ingested, and the site's numbers are current for the live game.

**What actually changed for the product.** Four weapons carry new values: EF88, BROD 3,
VSSM and L115. Three ranking effects, all measured rather than predicted:

- The **L115 now beats the PSR** between 101 and 120 m under FASTEST KILL, because its
  muzzle velocity rose from 664 to 742 m/s.
- The **EF88 enters the Assault Rifle top 3** from 235 m out, because its aimed spread
  tightened.
- The **BROD 3 drops out of the Carbine top 3** from 37 m out, because its spread grew
  and its velocity fell.

Nothing else moved. 38 of 62 weapons are identical at every one of the 300 cached
distances and in all 14,400 ranking cases checked. No BALANCED winner changed anywhere.

**The honesty number moved a lot.** "Current numerical verification" went from **1% to
51%**, and that figure was measured, not set: a value only counts when a source that
states its own game version publishes it, our stored value matches it, and every patch
between that version and the live game has been read and found to change no weapon
number. The remaining 49% is named field by field — mostly damage curves, ADS times and
fire modes, which this source simply does not publish, plus the four shotguns, which
appear in no Sym dump at any version.

**The VSSM trap was real and was avoided.** The source publishes 799.999 RPM for it.
Writing that in would have been wrong: 799.999 is the *full-auto* rate, our record
holds the *semi-auto* 449.999, and the Folding Stock attachment already performs the
conversion. Ingesting it would have applied the transform twice. There is now a gate
that makes it impossible, and a second audit that hunts for the same shape across the
whole roster.

**What matters now vs what can wait.** Nothing is blocked. The three remaining 1.4.2.0
items (the Interdictor, the Match Grade Ammo damage fix, VSSM limb multipliers) need
data that no responsible source publishes, and the site correctly says so rather than
guessing. Everything below is evidence.

---

## 1. Session boundaries

| | |
| --- | --- |
| Starting HEAD | `19b1f45`, rebased to `2ce8d57` onto 5 bot commits |
| Ending HEAD | `cce12df` |
| Branch | `main`, pushed, working tree clean |
| Production | https://bf6-weapons-lab.pages.dev — deployed and verified in-browser |

### Commits created

| SHA | Subject |
| --- | --- |
| `2f79ac0` | source: ingest Sym 1.4.2.0 as a versioned overlay on the pristine mirror |
| `87c91b2` | data: atomic source + per-weapon combat cache rebuild *(CI, automated)* |
| `13c166b` | watch+measure: a second source watcher, and an exhaustive before/after impact report |
| `ddfe80e` | coverage: CURRENT NUMERICAL VERIFICATION 1% → 51%, measured not set |
| `7140c56` | ci: make the naming-artifact trigger exclusion a checked claim, not a comment |
| `d0282a1` | docs+ui: a cold-start runbook, and correct the dead "Sym has nothing newer" claim |
| `cce12df` | audit: hunt every other two-state weapon, not just the one we knew about |

### Remote/bot commits integrated

Five `bf6-freshness-bot` commits (`b89bced`, `a01af42`, `a29d1c9`, `961ba07`,
`95294e2`) were present on `origin/main` and absent locally. Each was inspected: all
five touch only `data/freshness-status.json`, changing only `detectedAt`,
`reconciledAt` and the EA page `contentHash`. Legitimate, timestamp-only, preserved,
and integrated by **rebasing the single local commit onto them** — never overwritten,
no force-push, no history rewrite. One further bot run (`d0282a1`) executed during this
session and correctly committed nothing.

---

## 2. Source identity and hashes

**Workbook:** "Battlefield 6 Interactive Weapon Guide", author SheetOnMyFace, **v1.73**
Sheet ID `1_jVZuDofvDzwdK6IjhnLGUWCP7UXI2MKpC06EVbYD_Q`
Publisher of record: **sym.gg**. Retrieved via the public CSV export endpoints; no
authentication used or bypassed.

| Tab | Bytes | SHA-256 (raw CSV response) |
| --- | ---: | --- |
| `Sym.gg Data` | 49,939 | `caf130d88169c2df18cf12c429800ed5121babc1542f5c57cb9bb465470dd870` |
| `Sym.gg Data Archive` | 138,359 | `35638fe9594911c6bfb443f06e2dc52ebac1d019b68ceb16ca0b3cc6e46e5fff` |
| `Weapon Data` | 10,264 | `99ee6e1127d827f9…` |
| `🏠Home` | 11,961 | `06da8ff424f97e77…` |

| Artifact | SHA-256 |
| --- | --- |
| `data/sources/sheetonmyface-bf6-workbook.json` | `dfa0ebaa8bdae025440c575fcea53d6bf95b0056d361cd8c0b94d85eb77c66d5` |
| `data/source-overlays.json` | `b04d283c06071e74e744fe90bad556a819fbf43141a1f1ab785631155d930e16` |
| `data/combat-cache.json` | `8cb621e7b472727977d20dcccf6b2e35dad5c338e565f950ec895763b2d1f74a` |
| `data/weapons.json` *(unchanged mirror)* | `d8ae577f…` raw / `bd1c1853…` LF-normalised |

Content: 128 stats × 59 weapons at 1.4.2.0; 128 stats × 55 weapons at each of 1.3.3.0,
1.3.1.0, 1.2.2.0. Reproduce with `node scripts/capture-sheetonmyface.mjs`
(`--verify` compares without writing).

---

## 3. Historical provenance test

Our pinned mirror against the workbook's **archived 1.3.3.0** rows, over the mapped
field set:

    3630 / 3630 field comparisons agree.  0 conflicts.  55 weapons.

This supersedes the previous pass's 660/660, which covered only the 38 weapons on
sym.gg's own patch-notes page. Zero unexplained mismatches.

**Second, independent witness.** The workbook's own hand-maintained "Weapon Data" tab
still carries the **pre-1.4.2.0** muzzle velocities — EF88 670, BROD 3 580, L115 664 —
which are *exactly our values*, while the Sym dump beside it carries the new ones. A
stale hand table next to a refreshed raw dump is what a genuine data refresh looks
like. It is stored in the capture as `weaponDataWitness` so the claim stays checkable.

---

## 4. The 1.3.3.0 → 1.4.2.0 delta

### The workbook against itself (the cleanest statement of the patch)

All 128 stats, all 55 weapons present in both versions:

    6707 / 6708 comparisons identical.  ONE value changed:
        L115  velocity  664 -> 742   (+11.747%)

**This corrects the previous pass.** That pass reported "19 differences on EF88, BROD 3
and VSSM". Those three weapons **are not in the archive tab at all** — they were added
in 1.4.1.0, after the last archived dump. Their apparent differences were
our-data-vs-source provenance differences, not 1.3.3.0 → 1.4.2.0 patch deltas. Both
facts are real; they are not the same fact, and conflating them overstated what the
patch changed.

### Our mirror against the 1.4.2.0 tab (what actually had to be ingested)

4,060 mapped comparisons over 66 stats and 58 matched weapons:

| Verdict | Count | Meaning |
| --- | ---: | --- |
| agree | 4,016 | |
| `INGEST_NO_ARCHIVE_ROW` | 34 | weapon postdates the archive; ingested on source quality |
| `REPRESENTATION_ONLY` | 6 | the workbook rounds what our mirror holds exactly — **not** ingested |
| `EXCLUDED` | 1 | VSSM `RoF` — a different fire-mode state (§6) |
| `INGEST_PATCH_DELTA` | 1 | L115 velocity, archive-proven |
| `NOT_IN_ROSTER` | 1 | Interdictor |

### Applied: 39 changes (35 direct + 4 derived)

| Weapon | Changes | What moved |
| --- | ---: | --- |
| **EF88** | 14 + 3 derived | velocity 670→724; ADS recoil amount 0.59065→0.5965, multiplier 0.9579→0.9375, direction variation 20.3→26.1, dirVarMult 0.89864→0.915366 (+ HIP equivalents); ADS base spread min 0.1→0.05, inc 0.3→0.36, distExp 0.67→0.5, firingCoef 1.04→1.2, firingOffset 2.05→2.7, idleTime 0.6→0.4, notFiringOffset 8→7.2 (+ HIP equivalents); reloadSpeed 0.987893→1. Derived: `recoilV` 0.672001→0.723930, `recoilVar` 20.3→26.1, `recoilIncAds` 0.3→0.36 |
| **BROD 3** | 9 + 1 derived | velocity 580→563; ADS spread inc 0.228→0.304, firingOffset 1.84→2.7, firingCoef 1.22→1.2, distExp 0.67→0.5, adsMove min 0.35→0.32 (+ HIP equivalents). Derived: `recoilIncAds` 0.228→0.304 |
| **VSSM** | 3 | adsMove min 0.35→0.32; hipStand min 3.352→1.804; hipMove min 4.19→2.255. **RPM deliberately untouched** |
| **L115** | 1 | velocity 664→742 |

### Deliberately NOT ingested

- **VSSM `RoF` 799.999** — a different fire-mode state, not a newer value (§6).
- **Six RPM figures** the workbook rounds more coarsely than our mirror already holds
  them: EF88 675 vs 674.999, BROD 3 830.7692307692307 vs 830.769, M2010 ESR
  44.0816018658339 vs 44.08160187, SV-98, PSR, L115. Ingesting these would **lose
  precision**. The 1e-5 threshold separating rounding from change is five orders of
  magnitude clear of the smallest real delta in this source (0.069%).

### Cross-check against EA's 1.4.2.0 notes

EA named "Weapon statistics updates for the EF88, BROD, and VSSM" — exactly the three
weapons carrying the bulk of this overlay. The L115 velocity change is **not** named by
EA; it rests on the workbook's own archived before/after, and that limitation is stated
in the overlay's `confidenceBasis` rather than smoothed over.

### The five priority weapons — confirmed unchanged

**L110, B36A4, M250, KORD 6P67, M240L** are identical across all 128 stats between
1.3.3.0 and 1.4.2.0 in the workbook's own archive. Not inferred — read. No gameplay
capture was ever needed for them.

---

## 5. Architecture: how a newer value ships without touching the mirror

`data/weapons.json` is a **byte-identical mirror** of upstream. Its SHA-256 is in
`data/source-manifest.json`, `audit-cache-identity.mjs` checks the cache against it,
and the Combat Engine re-syncs it every run — so a hand-edited value would break the
manifest and be silently reverted.

New files:

- **`source-overlay.js`** — the one applier, used by both the browser optimizer
  (`app.js` → `loadData`) and the cache builder (via `scripts/source-overlay.mjs`), so
  they cannot drift.
- **`data/source-overlays.json`** — versioned changes with per-change provenance.

    effective dataset = pristine mirror + ordered versioned overlays

**Fail-closed:** every change declares the baseline value it replaces (`from`). If the
mirror moves, the change is *not applied* and an error is recorded;
`audit-source-overlay.mjs` fails the build on any error.

All **8 class audits** now read the effective dataset rather than the bare mirror —
auditing values the product never displays proves nothing. That change immediately
caught the L115 move (`upstream velocity 742 != audited 664`), which is the wiring
working; the sniper pin was updated to 742 with the superseded 664 preserved in
`bulletVelHistory`.

**Derived-field rule, verified before use:** `recoilV = recoil.ads.amount ×
amountMult^amountExp`, exact to <1e-9 for all 62 weapons. So it is the upstream feed's
own transform, not an approximation, and the three derived follow-ups are recomputed
from it rather than asserted.

---

## 6. VSSM — conclusion and proof

**Outcome C: the source's `RoF` is a different configuration state, not a newer value.
Nothing about VSSM's RPM changes.**

The workbook publishes three rates. The VSSM is the **only** weapon in the roster where
they disagree:

| stat | value | state |
| --- | ---: | --- |
| `RoF` | 799.999 | full-auto |
| `BurstRoF` | 799.999 | — |
| `SingleRoF` | 449.999 | semi-auto |

Our record stores **449.999** = `SingleRoF` exactly. The catalog attachment
`full_auto_vssm` ("Folding Stock", 40 pts, `setsFireModeAuto`) carries **`autoRpm:
799.999`** = `RoF` exactly. Both states are already represented, each exactly once.

Ingesting `RoF` into the base record would make the semi-auto base fire at the
full-auto rate **while leaving the conversion in place** — the transform applied twice.

Corroborated three independent ways:

1. **Structural.** Across all 61 matched weapons, 60 store `RoF`. VSSM alone stores
   `SingleRoF`, and it is the only weapon with a fire-mode conversion.
2. **The project's own prior note**, written before this source existed: *"rpm 450 is
   the in-game semi-auto rate. The datamined table lists 800, which the captures show
   is the Folding Stock full-auto rate."*
3. **The attachment already carries 799.999**, matching the source exactly.

**Permanent gate** — `scripts/audit-source-overlay.mjs` asserts base rpm = source
`SingleRoF`; base rpm ≠ source `RoF`; `full_auto_vssm.autoRpm` = source `RoF`;
`setsFireModeAuto` still true; no overlay change may target `vssm.rpm`; and the written
exclusion reason must still explain the two states. **Negative-tested:** adding a
`vssm.rpm` change fires three of those assertions.

**Systematic follow-up** — `scripts/audit-state-collisions.mjs` hunts the same shape
across the roster and fails on `BASE-ALREADY-CONVERTED`. It found one genuinely
unmodelled state: the **SL9** publishes a burst cadence of 771.428 distinct from its
674.999 automatic cadence, with no attachment switching to it. Not a defect — a
modelling boundary — but now recorded, so if such an attachment is ever added its rate
goes on the attachment, never the base record.

**VSSM's three ingested values move no ranked result, and I checked why rather than
assuming.** The upstream simulator derives moving-ADS spread from a tier table
(`MOVING_ACC_TIERS`, shifted by grip/laser/barrel/mag), not from `spread.adsMove[0]`,
and hip spread reaches only `metricInputs()` — the relative display bars. So the values
are real and now current, they change the displayed base stats, and they legitimately
change nothing ranked.

---

## 7. Engine rebuild and impact

Cache rebuilt from scratch by the Combat Engine (62-job matrix), commit `87c91b2`.

**Determinism independently checked:** 13 weapon shards rebuilt locally against the
same pinned upstream revision are **byte-identical** to CI's cache.

`scripts/compare-meta-impact.mjs` boots the real app against a git worktree of the
pre-overlay commit and against the current tree.

**Coverage: 14,400 ranking cases per side** — 1–300 m *exhaustive* × 3 modes
(Multiplayer, REDSEC unarmored, REDSEC 2-plate) × 2 priorities × 8 scopes — plus all
300 cached distances per weapon for both the AUTO winner and the BUILD MY GUN winner.

| Layer | Result |
| --- | --- |
| Raw stats | 39 fields across ef88, brod3, vssm, l115 — exactly the overlay, nothing else |
| Cached results | 3 weapons moved: ef88, brod3, l115 |
| Unchanged | **38 of 62** weapons identical at every cached distance and every ranking case |

### Ranking changes, with bands

| Scope | Effect |
| --- | --- |
| MULTIPLAYER / FASTEST / all + Sniper | **winner psr → l115 at 101–120 m**; top-3 changes 100–120 m |
| REDSEC-UNARMORED / FASTEST / all + Sniper | identical to the above |
| MULTIPLAYER + REDSEC-UNARM / BALANCED / Assault | **EF88 enters the top 3 at 235–292 m** (`l85a3>b36a4>sor556` → `l85a3>ef88>b36a4`) |
| MULTIPLAYER + REDSEC-UNARM / FASTEST / Carbine | **BROD 3 leaves the top 3 from 37 m** (264 distances) |
| REDSEC-2PLATE / BALANCED / Assault | EF88 moves at 274 distances, max 4 places |
| REDSEC-2PLATE / FASTEST / Assault | EF88 moves at 64 distances, 237–300 m |

**No BALANCED winner changed in any mode at any distance.** REDSEC 2-plate shows
position movement but no winner change.

Cached-value movement: EF88 and BROD 3 changed `triggerTtk`, `flightMs`, `beamIndex`
and `effectiveAdsSpreadDeg` at all 300 distances (EF88 also `recoil`); BROD 3's winning
build changed at 11 m only; L115's winning build changed at 93–99 m and 239–247 m.

**Sensitivity list grew from 5 to 7.** L110, B36A4, M250, KORD 6P67 and M240L all
remain on it; **L115 and M2010 ESR joined**, because the L115 velocity change moved it
into contention at 100 m where a small recoil difference can now decide a winner.

---

## 8. Numerical verification coverage: before → after

| Metric | Before | After |
| --- | ---: | ---: |
| **Current numerical verification** (result-affecting fields) | **1%** (3/573) | **51%** (290/573) |
| Known patch-delta coverage | 97% | 97% |
| Fields attested by a version-stating source | 0 | **348** |
| Attestation conflicts | — | **0** |
| Weapons with any current-verified value | — | **59 / 63** |
| Weapons fully current | — | 0 |

A field counts as current-verified **only** when: the frozen capture publishes that
exact value for that weapon at a stated version, **and** our shipped value matches it,
**and** every patch between that version and live carries a recorded first-party
no-numeric-change finding. Source *coverage* is not attestation — a source can cover a
weapon and disagree with us — so the audit compares, and a disagreement is now a hard
gate failure. The gate is structural, not textual: it checks the attestation object and
the bridge, so a well-phrased sentence cannot buy a confidence claim.

### What prevents 100%, named

| Field | Fields | Why the source cannot attest it |
| --- | ---: | --- |
| `dmg` | 62 | the Sym dump carries ballistics/spread/recoil only — no damage curve exists in it |
| `adsTime` | 62 | not published; `DeployTime` is a different quantity and mapping it would be fabrication |
| `fireMode` | 62 | only on the author's hand-maintained tab, which demonstrably lags the dump |
| `ammoProfile` | 62 | attachment-level; the dump is per-weapon |
| `bulletVel` | 7 | 4 shotguns + EF88/BROD 3/VSSM (attested, but PROVISIONAL for a separate reason: not in the verified ballistics list, so their drag model is approximate) |
| `sweetSpot` | 5 | a damage-curve property |
| `rpm`/`recoilV`/`recoilVar`/`spreadMax`/`pellets` | 4 each | the four shotguns, absent from every Sym dump |
| REDSEC mechanics | 3 | unpublished by EA; unchanged, still PROVISIONAL |

---

## 9. 1.4.2.5 reconciliation

Fetched the official EA changelog in full on 2026-09-05 and classified **every line**.

**Combat relevant (1):** *"The Match Trigger attachment no longer affects fully
automatic fire on the BROD and EF88."* An attachment **legality rule**, not a number —
already represented exactly by the `BLOCKED_UNTIL_PATCH` overlay in `app.js`.

**No combat effect (all others):** support pings on downed teammates; party invites
from the splash screen; helicopter miniguns damaging swimming soldiers; laser
designation on the F/A-81F and F-74A in Carrier Strike; grenade edge indicators; the
EOD Bot Arm reclassified as a light melee weapon; UI/HUD black screens and Top Squad
placeholders; Portal Custom Lobby "Start" tile reliability; AI boats leaving the combat
area on Wake Island; server water processing; Xbox Series S stability; two REDSEC
map/mode fixes.

**Ambiguous: none.**

**Conclusion: 1.4.2.5 introduced no numeric weapon-stat change.** So 1.4.2.0-sourced
numbers *are* current for the live 1.4.2.5 game — and that is now a recorded,
checkable assertion (`numericWeaponStatDelta` per patch in the ledger, with the
evidence text), not an assumption. Values attested at 1.4.2.0 without such a bridge
would stay 1.4.2.0-current and nothing later.

**1.4.2.0 ledger blockers: 5 → 3.** Two resolved with new deterministic check types:
`sourceOverlay` (the reconciler verifies the named overlay exists, is enabled and
covers the named weapons) and `mechanicRemoved` (the VSSM barrel recoil modifier —
the patch *removed* an effect, and the simulator sums ADS recoil over grip/muzzle/
ammo/ergo only, so the barrel slot contributes no recoil term anywhere; the post-patch
state is what the model computes).

Still unresolved and still correctly blocking: the **Interdictor** (absent from
upstream), the **Match Grade Ammo damage-reduction fix** (no numbers published), and
the **VSSM limb multipliers** (no numbers published). `verifiedCombatVersion` stays
**1.4.1.5**, honestly.

---

## 10. Freshness watching

`scripts/watch-sym-source.mjs` watched sym.gg's own patch-notes chunk and reported "no
change" correctly for weeks while a Sym 1.4.2.0 dump sat publicly available elsewhere.
It is not broken; it is **structurally blind** — a watcher on the publisher's own
channel cannot see data the publisher distributes through another. Both files that
asserted "Sym has published nothing after 1.3.3.0" have been corrected rather than
worked around.

**New: `scripts/watch-source-workbook.mjs`.** Fetches one ~50 KB tab and fingerprints
only the 66 stats that can reach a combat number, canonicalised to 9 significant
digits. Both watchers run hourly, both `continue-on-error`, both exit non-zero only on
the good-news case.

`scripts/audit-freshness-watchers.mjs` proves both halves **offline** by perturbing a
copy of the committed capture:

| Perturbation | Fingerprint |
| --- | --- |
| 1e-13 relative float noise across 3,470 values | unchanged ✓ |
| editing an unmodelled stat (`BurstRoF`) | unchanged ✓ |
| reordering every weapon and stat | unchanged ✓ |
| a 0.069% move (smallest real delta this source has produced) | **detected** ✓ |
| adding a weapon / removing a value | **detected** ✓ |
| every overlay-written path reachable from the watched map | no blind spot ✓ |

**Verified in production CI:** the new watcher ran green in run `33991893230` and
correctly reported no change.

Network/Google failure exits cleanly with a log line: no false patch, no red build.

---

## 11. CI efficiency

`data/attachment-name-audit.json` matches the Combat Engine's `data/*-audit.json` glob;
the exclusion was already present. What was missing is a check that it stays **sound**.
`audit-name-honesty.mjs` now verifies:

1. **Order** — the negation must appear *after* the glob it narrows. GitHub path
   filters are order-sensitive; a `!` line above its glob silently does nothing.
2. **Independence** — no file in the cache pipeline (build/merge/validate cache,
   auto-selection-policy, cache-state-signature, verified-source-sanitizer,
   attachment-legality) may reference the naming layer. Verified: none does.

Negative-tested: deleting the exclusion fails the gate. This complements the existing
separation gate (24 optimizer functions may not read the naming layer) — that one
protects the *results*, this one protects the *trigger*, and they fail independently.

---

## 12. Validation results

**Local gates: 30/30 pass**, including 5 new ones (`audit-source-overlay`,
`audit-freshness-watchers`, `audit-state-collisions`, `build-source-overlay --check`,
plus the extended `audit-name-honesty`).

**GitHub Actions**

| Run | Commit | Result |
| --- | --- | --- |
| BF6 Lightweight Quality Gates | `2f79ac0` | success |
| **BF6 Combat Engine** (62-job matrix) | `2f79ac0` | **success** — cache rebuilt and committed |
| BF6 Lightweight Quality Gates | `ddfe80e` | success |
| BF6 Lightweight Quality Gates | `7140c56` | success |
| BF6 Lightweight Quality Gates | `d0282a1` | success |
| BF6 Freshness Watch | `d0282a1` | success (new watcher green) |
| BF6 Lightweight Quality Gates | `cce12df` | success |

No self-inflicted concurrency cancellations: each push waited for the prior run.

---

## 13. Production verification

https://bf6-weapons-lab.pages.dev — verified in-browser.

- Chip: **`LIVE 1.4.2.5 • DATA 1.4.2.0 • COMBAT 1.4.1.5`**
- Overlay: **39 applied, 0 errors**, game version 1.4.2.0
- **EF88** 724 m/s, recoilV 0.72393, recoilVar 26.1 · **BROD 3** 563 m/s, adsInc 0.304
  · **L115** 742 m/s · **VSSM base rpm 449.999 — not 799.999**
- Control **M433** unchanged at 630 m/s
- Predicted flip live: MULTIPLAYER/FASTEST winner at 110 m is `l115` (was `psr`)
- All 3 modes × 2 priorities rank; AUTO META = 48 weapons, exclusions stated exactly
  (Interdictor empirical-current; 4 shotguns class-excluded; EF88/BROD 3/VSSM no
  verified projectile ballistics)
- Shotguns rank within their own class (4); DMR (6), Carbine (9) scopes work
- BUILD MY GUN carries all 56 primaries including shotguns and the Interdictor
- **32 resources load, zero 4xx, zero console errors**; `source-overlay.js` and
  `source-overlays.json` both served; service worker at `v33-source-overlay`

---

## 14. Evidence classification

### VERIFIED FACTS

- The workbook's archived 1.3.3.0 rows match our mirror on **3630/3630** comparisons.
- Between the workbook's 1.3.3.0 and 1.4.2.0, exactly **one** value changed across
  6,708 comparisons: **L115 velocity 664 → 742**.
- **EF88, BROD 3, VSSM and the Interdictor appear in no archived version** — they
  postdate the last archived dump.
- `recoilV = amount × amountMult^amountExp` exactly (<1e-9) for all 62 weapons.
- VSSM: `SingleRoF` 449.999 = our base rpm; `RoF` 799.999 = `full_auto_vssm.autoRpm`.
  It is the only weapon in the roster whose published rates disagree in that shape.
- **L110, B36A4, M250, KORD 6P67, M240L are identical** across all 128 stats between
  1.3.3.0 and 1.4.2.0.
- EA 1.4.2.5's entire WEAPONS section is one line, and it is a rule, not a number.
- 13 locally rebuilt cache shards are byte-identical to CI's.
- 38/62 weapons unchanged across 300 distances and 14,400 ranking cases.

### DERIVED / HIGH CONFIDENCE

- The 1.4.2.0 tab is a genuine refresh (only 1/6708 internal change; the author's own
  hand table still holds pre-patch values; EA named exactly the affected weapons).
- EF88/BROD 3/VSSM values are better sourced than the donor-estimated ones they
  replace — publisher-of-record figures at an explicitly stated version.
- 1.4.2.0 numbers are current for live 1.4.2.5, on a full first-party changelog read.
- The 51% coverage figure, computed field by field from attestation + match + bridge.

### PROVISIONAL

- **L115 velocity 664 → 742** rests on a single source's own archive; EA's notes do not
  mention it. Recorded in the overlay's `confidenceBasis`. It is the one ingested value
  with no independent corroboration.
- EF88/BROD 3/VSSM remain outside cross-class AUTO META: no verified projectile drag.
- Their damage curves remain donor-estimated (VSSM's is the in-game curve).
- REDSEC close-range and armour-break spillover remain unpublished and untouched.
- The workbook is a single carrier for a single publisher. No second numerical source
  corroborates the 1.4.2.0 dump.

### UNRESOLVED

1. **Interdictor** — the sheet publishes all 128 primitives for it, but not damage.
   Adding a weapon needs a damage curve and attachment compatibility. Blocks 1.4.2.0.
2. **Match Grade Ammo** damage-reduction fix (M2010 ESR, SVK-8.6) — no numbers at any
   tier. Blocks 1.4.2.0.
3. **VSSM limb damage multipliers** — no numbers; the dump carries no damage data.
   Blocks 1.4.2.0. Affects displayed low-body figures, not chest ranking.
4. **`adsTime` missing for M16A4, PP-19, RPK-74M, L115** — unsourced, neutralised in
   ranking.
5. **Damage curves are not current-verified for any weapon** — this source publishes
   none. The single largest coverage gap (62 fields).
6. **SL9's published burst cadence (771.428)** is unmodelled; no attachment switches to
   it.
7. **REDSEC close-range / spillover** — deliberately untouched; in-game testing remains
   the path.

---

## 15. Remaining work, ranked

1. **Find a current numerical source for damage curves.** 62 result-affecting fields —
   the largest remaining gap by a wide margin, and the one blocking any weapon from
   reaching *fully* current.
2. **Resolve the three 1.4.2.0 ledger blockers** to unstick `verifiedCombatVersion`.
   The Interdictor is the most tractable: its primitives are already captured; it needs
   a damage curve and attachment compatibility.
3. **Verify the seven sensitivity-critical recoil/spread values in-game** — the five
   originals plus L115 and M2010 ESR. All seven are now *source*-verified at 1.4.2.0;
   in-game measurement would move them from source-attested to measured.
4. **REDSEC close-range and spillover in-game tests** — the only route off PROVISIONAL
   for 2-plate.
5. **Seek a second numerical publisher** purely as corroboration for the single-source
   1.4.2.0 dump, especially the uncorroborated L115 velocity. Numerical sources only —
   never tier lists, popularity or creator rankings.
6. **`adsTime` for the four weapons missing it.**
7. **Consider modelling shotgun pellet spread** — it is the reason four weapons are
   excluded from cross-class ranking and from all current-verification coverage.
