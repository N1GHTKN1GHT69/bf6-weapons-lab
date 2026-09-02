# BF6 Weapons Lab v2.8 — Phase A Final-Gate Alignment Audit

## Real-run finding
The v2.7 GitHub run completed every raw-backed per-weapon cache shard and passed the generated combat-cache structural validator. The only failure moved to `Gate global integration against generated cache`.

## Root cause
The final global gate still enforced the old pre-Laserbeam assumption that the AUTO winner must never be mechanically slower than the independently verified fastest-TTK attachment baseline. That contradicts the current product policy: AUTO Laserbeam META may accept a small trigger-to-kill tradeoff (up to 12%) when the selected range-eligible build materially improves optic fit or recoil/spread Beam Index. BUILD MY GUN / `bestLethal` remains the strict lethality winner.

## v2.8 correction
- Independent optimized lethal baselines are now checked against `bestLethal`, not AUTO `best`.
- AUTO `best` is audited against `bestLethal` at every meter. If AUTO is slower, it must remain within the 12% trigger-to-kill window and must improve Optic Fit or Beam Index.
- Removed the legacy assertion that a particular attachment ID must be present whenever another legal build ties the same TTK. Numbers, not attachment identity, are authoritative.
- Added `audit-final-gate-policy.mjs` and wired it into GitHub preflight.
- Per-weapon cache namespace stays `v27` intentionally so the 62 successful v2.7 weapon shards can be restored instead of recomputed.

## Self-audits
- Final-gate policy synthetic cases: PASS.
- Strict known-lethality regression rejection: PASS.
- 12% AUTO tradeoff ceiling: PASS.
- Slower AUTO without optic/Beam benefit rejection: PASS.
- Existing ballistic/global/laserbeam/BUILD MY GUN/range-optic/cache-state/partial-assumption audits: PASS.
- JS syntax and workflow YAML: PASS.

## Expected next run
The next workflow should restore the successful v27 per-weapon shards, merge them, validate the generated cache, then pass the corrected global integration gate.
