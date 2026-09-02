# BF6 Weapons Lab v3.0 — Phase B Stable Laserbeam Ranking Audit

## Real-cache findings that triggered this correction
The v2.9 cache itself passed structural validation (62/62 modeled, 0 incomplete), but Phase B winner analysis exposed two ranking-policy defects:

1. AUTO attachment selection allowed any candidate inside the 12% lethal window to win on even a microscopic Beam Index improvement. Real examples included ~10–12% slower Trigger→Kill for negligible control gains.
2. Weapon META used min/max normalization from the currently visible candidate pool. Filtering to a class changed the scale of the 55/45 formula and could reorder the same guns without any weapon statistic changing.

## v3.0 policy
### AUTO attachment selection
- Strict Max Lethality floor remains unchanged.
- AUTO remains capped at 12% slower Trigger→Kill than that floor.
- Inside the window, the winner minimizes `TriggerTtk^0.55 × BeamIndex^0.45`.
- Optic eligibility remains a hard gate. Optic fit becomes a tie-break after the stable utility rather than a blank check to sacrifice lethality.

### Weapon ranking
- Uses the same pool-stable 55/45 percentage utility.
- Weapons more than 25% (+10 ms slack) slower than the global fastest eligible weapon receive a fixed 1.35× competitiveness cost penalty.
- Cross-class-eligible class filters reuse the same global reference pace, so filtering the UI cannot change the tradeoff or pairwise order.
- Laser Score remains higher-is-better and is displayed relative to the best stable utility cost at that distance; this display rescaling does not affect ordering.

## Self-audit
PASS:
- JavaScript syntax across all JS/MJS
- Final-gate anchored 12% policy
- Tiny-gain sacrifice regression (real VCR-2 style case)
- Large-control-gain tradeoff regression (real PW5A3 style case)
- Filter-invariance regression
- Ballistic TTK
- Global roster/integration 63/63
- BUILD MY GUN
- Range-aware optics
- Cache-state dedupe
- 100,000-state dedupe stress test
- M250 partial-assumption sanitizer
- GitHub workflow YAML

## Known Phase B limitation not hidden by this correction
Shotgun buck/flechette long-range rows remain ideal all-pellets-hit mechanical calculations. They stay excluded from cross-class META until expected pellet-hit / target simulation is implemented.
