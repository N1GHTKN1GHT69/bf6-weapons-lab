# BF6 Weapons Lab v2.3 — Phase A Audit

## Goal
Produce the first trustworthy exhaustive combat cache from one atomic upstream source revision, validate it, and prevent stale/mixed-source META from activating.

## Pass 1 — Atomic pipeline
- PASS: single 6-hour Combat Engine pipeline owns production source sync + cache generation.
- PASS: legacy sync workflow no longer runs on a schedule.
- PASS: source snapshot performs point/schema validation before writing.
- PASS: source manifest records upstream commit and hashes.

## Pass 2 — Cache-builder performance
- PASS: sustained ADS spread simulation moved from once-per-distance to once-per-transformed-build.
- PASS: distance weighting still occurs at every 1–300m row.
- PASS: existing ballistic/global/laserbeam/manual/optic audits remain green.

## Pass 3 — Upstream compatibility preflight
- PASS: required Analyzer JSON contracts checked.
- PASS: 62 raw-backed roster records required; empirical Interdictor remains separate.
- PASS: WEAPON_ATTS / WEAPON_MAG / WEAPON_AMMO coverage checked per raw weapon.
- PASS: required simulator function exports checked before class audits/build.

## Pass 4 — Cache/source consistency
- PASS: validator rejects cache/source-manifest commit mismatch.
- PASS: app rejects exhaustive cache if weapons/attachments/ammo/ballistics are not all loaded from the local atomic deployment.
- PASS: service-worker shell cache bumped for Phase A.

## Pass 5 — Red-team / release gate
- PASS: human concurrent push is allowed to make the bot push fail rather than rebasing an already-validated cache onto changed app code.
- PASS: manual source/cache file edits trigger a full Combat Engine rebuild.
- PASS: GitHub diagnostics are uploaded on failure.
- PASS: workflow timeout raised to 110 minutes after removing a major 300x repeated spread-calculation hotspot.

## Production completion criteria
Phase A is complete only when GitHub `BF6 Combat Engine` finishes successfully and:
1. `data/combat-cache.json` has `audit.pass: true`.
2. `scripts/validate-combat-cache.mjs` passes against `data/source-manifest.json`.
3. `scripts/audit-global.mjs data/combat-cache.json` passes.
4. The bot commits the atomic source + cache update to `main`.
5. The deployed UI reports an active META engine rather than build pending/fallback.
6. Representative 10/25/50/100/150m winners are manually sanity-checked before Phase B.
