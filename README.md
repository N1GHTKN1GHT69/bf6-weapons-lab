# BF6 Weapons Lab v0.7 — Combat Engine

v0.7 moves the project from an on-demand heuristic optimizer toward a precomputed independent meta engine.

## What the engine does

- Uses the upstream BF6 Weapon Analyzer's maintained raw data and its own `sim/applyAttachments.js`, `sim/damage.js`, and `sim/core.js` math.
- Counts **every legal user-visible attachment combination** under the weapon budget.
- Safely collapses functionally identical or strictly more-expensive duplicates before expensive simulation. This is mathematical redundancy pruning, not a skipped gameplay option.
- Applies attachment transformations using the source simulator, not hand-written meta opinions.
- Evaluates each modeled weapon from **1 m through 300 m**.
- Picks the winning build at each meter using this hard order: ideal chest TTK, BTK, damage/shot, low-body TTK, then transformed mechanical delivery as a tie-break.
- Primaries use a 100-point cap; sidearms use a 60-point cap.
- Generates `data/combat-cache.json` plus `data/combat-audit.json`.
- The PWA uses the exhaustive cache when it is present and visibly falls back when it is not.

## What is NOT an input

The meta calculation does not consume Reddit opinions, YouTube builds, Battlefinity tiers, popularity, pick rate, creator recommendations, community votes, or another site's weapon rank. External projects may provide measured facts or simulator math only.

## Automation

`.github/workflows/combat-engine.yml` runs after relevant pushes, on manual dispatch, and daily. It checks out `raymdl/BF6-Weapon-Analyzer`, executes the audit, validates the result, commits the generated cache, and the resulting GitHub push causes Cloudflare Pages to redeploy automatically.

## Audit truthfulness

The generated audit records:

- upstream commit hash
- source weapon count
- modeled vs incomplete weapon count
- exact count of all legal raw combinations
- number of canonical combinations actually simulated after safe equivalence pruning
- 300 distances per modeled weapon
- errors / PASS state

If compatibility, points, or required modeling data is missing, that weapon is marked incomplete rather than guessed.

## Important limitation

This engine can only be as current as the factual source data. The cache records the exact upstream commit. A newer EA patch can make an older source snapshot stale even when the math is correct. Source freshness is a separate validity dimension from calculation correctness.
