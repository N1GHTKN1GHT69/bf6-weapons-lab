# BF6 Weapons Lab v2.5 — Phase A Per-Weapon Cache Audit

## Why v2.5 exists
The v2.4 eight-class matrix successfully isolated the previously monolithic exhaustive build, but the real GitHub run still failed at the LMG class shard after other classes completed. The screenshot identifies the failed class, not the underlying builder exception, so v2.5 does **not** guess the root cause. It reduces the failure domain from one whole class to one exact weapon and improves retry behavior.

## v2.5 pipeline
1. Lock one `raymdl/BF6-Weapon-Analyzer` commit.
2. Run upstream compatibility + every class/static audit.
3. Dynamically enumerate the exact upstream-backed weapon list.
4. Run one cache job per weapon, max 12 concurrently.
5. Reuse successful per-weapon shards on retry when upstream/scoring inputs are unchanged.
6. Build each missing weapon with `--weapon`, exact Pick budget, legal attachment combinations, transformed-state dedupe, 1–300 m lethality/ballistics/recoil/spread/optic scoring.
7. Upload one independently diagnosable shard per weapon.
8. Require the exact dynamic weapon count, merge with duplicate/missing-weapon checks.
9. Snapshot data from the same locked upstream revision.
10. Validate cache/source revision/model/version gates and global integration.
11. Commit source + verified cache atomically only after every weapon passes.

## Local self-audits
- Workflow YAML parse: PASS.
- All JavaScript syntax: PASS.
- Ballistic TTK regression: PASS.
- Global roster/integration regression: PASS (63/63 roster wiring).
- Laserbeam META regression: PASS.
- BUILD MY GUN regression: PASS.
- Range-aware optics regression: PASS.
- Synthetic dynamic per-weapon matrix + merge: PASS; 3/3 fixture weapons, zero missing/duplicates.
- Per-weapon builder filter and transformed-state dedupe wiring: syntax/static inspection PASS.

## Failure behavior
A failed weapon job blocks `finalize`; no partial cache is published as verified META. Successful weapon jobs can be restored on a retry if the upstream revision and scoring implementation are unchanged. The one-click monitor should identify the exact failed weapon/job and surface its failed log tail.

## Phase A completion condition
Phase A is complete only after a real GitHub run produces the full per-weapon cache with `audit.pass=true`, zero incomplete weapons, exact source/cache revision match, and the live Cloudflare site serves that verified cache.
