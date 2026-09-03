# BF6 Weapons Lab — overnight run state

Run started 2026-09-02 (autonomous). Branch `main`. Baseline commit `2856164`.

## Baseline (Phase 0) — PRESERVED
- Working tree was clean at start; no uncommitted work to protect.
- 17/17 locally runnable gates PASS at baseline. No pre-existing failures.
  Log: `reports/overnight/baseline-gates.log`
- `.upstream/bf6-analyzer` is not present locally, so the eight per-class
  audits (`audit-assault` … `audit-shotgun`) cannot run here. They are CI-only.
  NOT a regression; recorded as an environment limitation.

## Key findings so far
1. **Gap closed: production code was never executed by any local gate.** Every
   gate read `app.js` as text and pattern-matched it. Added
   `scripts/lab-harness.mjs`, which boots the real `app.js` in a Node vm with a
   minimal DOM/fetch shim, so audits can compare ACTUAL production output
   against independent reference maths.
2. **Harness reproduces the recorded manual sanity test exactly** — REDSEC/AUTO
   META/ALL VERIFIED/25m: unarmored winner L110 5 BTK 361 ms; 2 PLATES winner
   KORD 6P67 12 BTK 769 ms; 48 ranked. No drift.
3. **KORD 6P67 12 BTK is internally correct** under the implemented model, and
   is NOT sensitive to the unresolved spillover mechanic.
4. **The 2-PLATE winner at 25m IS sensitive to the unresolved close-range
   mechanic.** closeRange=remove → KORD 6P67 (12 BTK); closeRange=keep → M250
   (8 BTK). The old "5 shots to break / 11 BTK" expectation is exactly the
   `keep` reading, not a bug.

## Files added/changed
- `scripts/lab-harness.mjs` (new) — headless production-execution harness.
- `app.js` — added `BF6_LAB_DIAG.redsecTrace()`, a complete manually
  reproducible REDSEC audit trail. Diagnostics only; no combat maths changed.
- `reports/overnight/` — audit logs and machine-readable outputs.

## Blockers
- None. Offline/no-upstream limitations recorded above, worked around.

## Next task
Systematic production-vs-independent-reference cross-validation across the
roster (Phase 1 continued), then optimizer exhaustive validation.
