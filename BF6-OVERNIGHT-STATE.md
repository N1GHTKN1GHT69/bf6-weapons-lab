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

## Important findings — BOTH RESOLVED
1. **RESOLVED: FASTEST KILL now ranks by trigger-to-kill.** rankWeapons() selects
   a comparator per priority. 411/672 winners changed; BALANCED 0/672 changed.
   Enforced by audit-meta-sweep.mjs (0 violations) and audit-global.mjs.
2. **RESOLVED: one shared attachment legality policy.** Root cause was the LIVE
   path, not the cache: buildOptions() treated any `assumedFields` as
   whole-option assumption, while the cache builder stripped only the named
   fields. attachment-legality.js is now the single implementation used by both.
   0/56 divergence, 0 unbuildable weapons, 0 cached builds invalidated (the
   sanitizer refactor is byte-identical), 0 of 1,344 displayed results changed.
3. **NEW, fixed:** armoured results claimed robustness while the WINNER flipped
   between close-range readings. redsecWinnerStable() now gates that claim.
4. Corrected the 6,916 figure: it is ASSERTIONS (1,378 armoured x 4 + 1,404
   unarmoured) over 2,782 cases, not 56x26x2.
5. Rebase onto origin/main changed no results; the apparent diff was CRLF vs LF.
   .gitattributes now pins LF for generated artefacts.

## Unresolved assumptions (unchanged, externally blocked)
- EA's "reduce or remove" close-range armour rule — still flips the armoured
  winner at some distances, so REDSEC 2-PLATE stays PROVISIONAL.
- Armour-break spillover — decisive in-game test specified in
  data/redsec-model.json (M39 EMR @40-60m: 6 shots = no spillover).
- REDSEC treatment of sniper sweet-spot control points.
- 0 attachment names confirmed against a live in-game string.

## Blockers
None. Local limitation: `.upstream/bf6-analyzer` is absent, so the per-class
damage audits and any cache rebuild are CI-only.

## Next task
In-game measurement: spillover test, then the close-range test for a
fireMode:auto weapon. Both are external inputs, not code work.
