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

## Current state (2026-09-03, post-push)

CI: both workflows green. Combat Engine rebuilt the cache from scratch and
produced a byte-identical result (winners hash 9cbd7a8bd5328d54), independently
confirming the legality refactor changed nothing.

## Trust terminology (authoritative)
- ATTACHMENT OPTIMIZER = VERIFIED
- META / RANKING ENGINE = HIGH CONFIDENCE
- AUTO META END-TO-END RESULT = PROVISIONAL (capped by source data)
- REDSEC 2-PLATE = PROVISIONAL
Enforced in code: data/source-verification.json drives an end-to-end cap in
renderConfidence(); audit-name-honesty.mjs fails if a chip overstates.

## Open, blocked on in-game capture
1. REDSEC close-range rule. Tests: AK4D @11m (1-21m band) and RPKM @5m
   (EA's published 7.62x39 calibre). Armour break 4 = current model, 3 = change.
2. Armour-break spillover. Tests: SVK-8.6 @5m (4 = no spillover, 3 = spillover)
   and M39 EMR @38-50m (6 = no spillover, 5 = spillover). Both semi-auto, so
   neither can be influenced by the close-range rule.
3. Attachment exact names: 0/168 game-verified. Evidence path now exists
   (data/attachment-name-evidence.json) with stale-patch and tier-ambiguity
   safeguards, both proven. Top 20 captures cover 82% of displayed names;
   worklist at reports/overnight/name-verification-worklist.csv.

## Open, needs a decision
4. STALENESS dominates everything: 750/759 fields come from a 1.3.3.0 snapshot
   against live 1.4.2.5, with 1.4.2.0 and 1.4.2.5 combat deltas unrepresented.
5. Beam Index inputs (recoilV, recoilVar, spreadMax - 186 fields) drive 45% of
   the BALANCED ranking and no class audit re-derives them.
6. 4 weapons have MISSING adsTime and therefore always lose the ADS tie-break.

## Recorded data-integrity notes
- damageStatus says "verified" for all 62 weapons while BROD 3 / EF88 / VSSM
  carry provenance.status "estimated". The audit uses the stricter reading.
- reference-data/attachment-audit/attachment-screenshot-review.json is cited by
  BROD 3 and EF88 provenance but has never existed in this repository.

## Next task
In-game capture session: 2 close-range tests, 1-2 spillover tests, top-20
attachment name screenshots. Then decide the staleness strategy.
