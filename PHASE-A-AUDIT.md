# BF6 Weapons Lab v2.4 — Phase A Parallel Cache Audit

## Why v2.4 exists
The first real exhaustive cache run remained in the single `Run exhaustive combat audit` step for more than 70 minutes. The monitor timed out while GitHub was still running. Extending the timeout would hide the architectural problem rather than fix it.

## v2.4 pipeline
The Combat Engine is now three stages:

1. **Prepare** — upstream lock, syntax/preflight, all weapon-class audits and static regressions.
2. **Parallel cache matrix** — Assault Rifle, Carbine, SMG, LMG, DMR, Sniper Rifle, Sidearm and Shotgun are built simultaneously on eight GitHub runners.
3. **Finalize** — the eight exact cache shards are merged, validated against the locked upstream weapon roster, globally audited, and committed atomically with the matching source snapshot.

The upstream Analyzer SHA is locked once in Prepare and every shard/finalize job checks out that exact revision.

## Safety
- `concurrency.cancel-in-progress: true`: a newer deploy cancels an obsolete long cache run.
- Each class shard has a 35-minute hard timeout.
- Prepare/finalize each have 15-minute hard timeouts.
- Merge rejects missing or duplicate weapons.
- Merge rejects source/ranking/rules mismatch between shards.
- Final validator still requires a complete, same-source, passing cache.

## Self-audits performed
- Sharded builder: synthetic one-weapon-per-class fixture, 8/8 modeled, merge PASS.
- Artifact layout: eight cache JSONs separated from eight audit JSONs, PASS.
- Workflow YAML parse and 8-class matrix structure, PASS.
- JavaScript syntax across app + all scripts, PASS.
- Ballistic TTK audit, PASS.
- Global integrity audit (63/63 roster), PASS.
- Laserbeam META audit, PASS.
- BUILD MY GUN audit, PASS.
- Range-aware optic audit, PASS.

## Phase A completion condition
Phase A is complete only after the real GitHub matrix build produces a cache with `audit.pass=true`, zero incomplete weapons, source/cache revision match, and the live Cloudflare site serves that same verified cache.
