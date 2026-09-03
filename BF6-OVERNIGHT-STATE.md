# BF6 Weapons Lab — overnight run state

Run 2026-09-02 -> 2026-09-03, autonomous. Branch `main`. Baseline commit `2856164`.
Full findings: `BF6-WEAPONS-LAB-OVERNIGHT-REPORT.md`.

## Completed
- Phase 0 baseline preserved. 17/17 local gates passed at start, no pre-existing failures.
- Built `scripts/lab-harness.mjs`: boots the real `app.js` headlessly so audits can
  compare ACTUAL production output against independent references. Every previous
  local gate only pattern-matched `app.js` source.
- REDSEC model cross-validated: 6,916 production-vs-reference comparisons, 0 mismatches.
- Optimizer validated: 156 cases, 87 by true exhaustive enumeration (50,521,932
  combinations), 0 mismatches.
- Meta sweep: 1,344 cases / 17,304 ranking evaluations, 0 anomalies.
- Cache identity: 336 queries in 3 orders, order-independent, no key collisions.
- 8 new gates added and wired into CI. Final: 25/25 pass.

## Important findings
1. **OPEN (needs decision): FASTEST KILL does not rank by kill speed.**
   `rankWeapons()` always sorts by the 55/45 laserbeam utility; PRIORITY only
   changes which cached build row is read. 411/672 cases show a non-fastest
   winner, worst gap 796 ms. Two viable fixes in the report; recommendation is
   to make the ranking match the label.
2. **OPEN (pinned): two attachment-legality policies disagree.** The exhaustive
   cache admits attachments with upstream `assumedFields`; `buildOptions()`
   rejects them. 27/56 primaries ship cached winning builds using such barrels;
   M250 has no non-assumed barrel and throws on-demand. Baseline recorded in
   `data/optimizer-legality-divergence.json`, gated by `audit-optimizer-legality.mjs`.
3. KORD 6P67 @25m/2 PLATES = **12 BTK is correct** and is NOT sensitive to
   spillover. The old 5/11 expectation is the `closeRange=keep` reading.
   The 25m/2-PLATE **winner** IS sensitive to that unresolved reading
   (remove -> KORD 6P67, keep -> M250), so the result is correctly PROVISIONAL.

## Unresolved assumptions (unchanged, externally blocked)
- EA's "reduce or remove" close-range armour rule — materially affects results.
- Armour-break spillover — immaterial for KORD; decisive in-game test already
  specified in `data/redsec-model.json` (M39 EMR @40-60m: 6 shots = no spillover).
- REDSEC treatment of sniper sweet-spot control points.

## Blockers
None. Two worked-around limitations: `.upstream/bf6-analyzer` is absent locally
so per-class damage audits are CI-only; and the two mechanics above need in-game
measurement.

## Next task
Decide FASTEST KILL semantics (finding 1), then resolve the attachment-legality
conflict (finding 2).
