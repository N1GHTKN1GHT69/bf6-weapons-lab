# BF6 Weapons Lab v2.6 — Phase A M250 Dedupe Audit

## Real-run evidence
The v2.5 per-weapon workflow completed 29/63 jobs before the run failed specifically at **Cache M250**. The one-click monitor identified the exact GitHub job but unauthenticated log retrieval returned HTTP 403, so the precise runner exception is not available locally.

## Structural defect found
The v2.5 `scoringStateSignature()` copied **all** underscore-prefixed fields from the transformed weapon into its dedupe key. `applyAttachments()` sets `_label` to a string containing the attachment names. Therefore two builds with identical lethal/recoil/spread/handling behavior but different attachment labels produced different state signatures. This defeated the intended exact-state dedupe and could make a high-option weapon such as M250 retain a very large Map of duplicate states.

## v2.6 correction
- Moved the exact state-key contract to `scripts/cache-state-signature.mjs`.
- Removed `_label` and unrelated display metadata from the state key.
- Preserved every mechanic currently consumed by lethal TTK, projectile flight, Beam Index, optic fit, practical tie-breaks, magazine/reload/ADS handling and explicit Range Finder/Bipod/ADS-bolt/Magwell utility.
- Added Beam primitive caching across mechanically identical recoil/spread states.
- Added heap usage to long-search progress messages.
- GitHub cache jobs use `NODE_OPTIONS=--max-old-space-size=6144`.
- Bumped per-weapon Actions cache namespace from v25 to v26.

## Self-audits
- `audit-cache-state-dedupe.mjs`: PASS. Display-only metadata does not alter state identity; every ranked mechanic tested does.
- `audit-cache-state-scale.mjs`: PASS. 100,000 display-only M250 variants collapse to 1 state; a real recoil change creates a second state.
- Ballistic TTK audit: PASS.
- Global integrity audit: PASS, 63/63 roster mapping.
- Laserbeam META audit: PASS.
- BUILD MY GUN audit: PASS.
- Range-aware optic audit: PASS.
- All JavaScript syntax: PASS.
- Combat workflow YAML parse: PASS.

## Honest remaining gate
Because GitHub's failed-job log was inaccessible, v2.6 does not claim that `_label` was proven to be the only M250 failure. It is a concrete defect capable of causing the observed scale problem. **Phase A is complete only after the real GitHub v2.6 run finishes every weapon shard, merges the cache, and passes final validation.**
