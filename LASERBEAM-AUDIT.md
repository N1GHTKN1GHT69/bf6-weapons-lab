# Laserbeam META Audit — v1.9

## Failure found

The v1.8 exhaustive cache builder contained a duplicate `const sig` declaration inside `dedupeDominated()`. Node syntax validation rejects the file, so the exhaustive attachment-aware cache could fail before ranking was generated.

## Ranking defect

Recoil and spread were present only inside `practicalScore`, which was reached after trigger TTK, mechanical TTK, BTK, damage and low-body TTK. In practice that made control almost irrelevant to weapon selection unless lethality was exactly tied.

## v1.9 model

AUTO weapon score:

- 55% normalized exact-distance trigger→kill lethality
- 45% normalized Beam Score (inverse Beam Index)
- additional penalty when trigger→kill is more than 25% + 10 ms behind the fastest candidate

Exhaustive build selection:

- if two builds are within 12% trigger→kill, lower Beam Index wins first
- otherwise materially faster trigger→kill still wins

Beam Index inputs are transformed after attachments:

- selected ADS recoil amount
- selected recoil-direction variation
- unpredictable lateral recoil component derived from amount × variation
- Analyzer `effectiveSpreadMax(..., 8)` sustained ADS spread
- moving-ADS minimum spread
- distance weighting of angular instability

## Validation

`node scripts/audit-laserbeam-meta.mjs`

Expected:

`LASERBEAM META PASS`

The exhaustive GitHub workflow must still run against the current upstream Analyzer to produce the actual per-weapon winners; this local package validates the engine wiring but does not fabricate a replacement combat cache without upstream data.
