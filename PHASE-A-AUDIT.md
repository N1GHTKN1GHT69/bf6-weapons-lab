# BF6 Weapons Lab v2.7 — Phase A Verified-Field Sanitization Audit

## Real-run finding
The v2.6 per-weapon run again failed specifically at **Cache M250**. Reviewing the current upstream attachment contract exposed a deterministic policy failure: M250 has only `heavy` and `heavy_ext` in its required barrel slot, and both records contain a mixture of verified fields plus two `assumedFields`. The v2.6 builder rejected any option with any partial assumption marker, so M250 was left with zero candidate barrels before exhaustive simulation even began.

## v2.7 correction
- Added `verified-source-sanitizer.mjs`.
- Partial assumption markers now remove only the specifically named unverified fields from the source object used by the simulator.
- Verified fields on the same attachment remain active.
- Whole-option `assumed: true` candidates remain excluded from VERIFIED META.
- M250 Heavy / Heavy Extended therefore remain legal while their provisional spread-recovery coefficients are not used.
- Actions shard cache namespace bumped from v26 to v27.

## Self-audits
- `audit-partial-assumptions.mjs`: PASS. M250-style Heavy / Heavy Extended fixtures survive; 4 provisional fields are stripped; verified velocity/spread-increase/point mechanics remain.
- Ballistic TTK: PASS.
- Global integrity 63/63: PASS.
- Laserbeam META: PASS.
- BUILD MY GUN: PASS.
- Range-aware optics: PASS.
- Cache-state dedupe: PASS.
- 100k state-scale regression: PASS.
- All JS syntax: PASS.
- Workflow YAML: PASS.

## Remaining proof
Phase A still requires the real GitHub v2.7 run to complete every per-weapon shard, merge the exhaustive cache and pass final validation.
