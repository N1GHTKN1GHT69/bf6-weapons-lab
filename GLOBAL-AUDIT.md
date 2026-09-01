# Global Integrity + Ballistic TTK Audit — v1.8

## Purpose

The class audits prove weapon lethality math. This gate proves the application connects those audits, the roster, point budgets, and the exhaustive attachment cache without silently falling back to a different model.

## Gates

1. Current roster must be exactly 63 weapons: 56 primaries and 7 sidearms.
2. Roster IDs and normalized names must be unique.
3. Every weapon must map to its independently passing class audit.
4. Every non-sniper audit must cover every integer meter from 1 through 300 without gaps or overlaps. Snipers must expose a verified curve and effective shot interval.
5. All 7 sidearm fallback RPMs must match the independent Sidearm audit and both `Sidearm` and `Secondary` must remain on the 60-point budget path.
6. Shotguns must remain excluded from cross-class AUTO VERIFIED until spread/pellet hit probability is independently modeled.
7. AUTO META must use the exhaustive cache first when that cache is valid. Class-audit lethality remains the fail-closed fallback; raw combat data is never an AUTO fallback.
8. A combat cache is valid only if its game version matches the live roster and every class audit, every source weapon is modeled, incomplete is zero, every weapon has a winner at all 300 distances, every winner references a real build, and every winning build respects its point budget.
9. Required independently verified lethal transforms may use cache winners only when the winning build contains the required attachment.
10. Any synced weapon, attachment, ammo, ballistics, balance-table, or recoil-decay change must trigger the combat workflow so the exhaustive cache cannot silently lag source data.
11. AUTO ranking must sort by trigger→lethal-impact TTK before mechanical TTK, BTK, damage or handling.
12. Cross-class VERIFIED requires a verified projectile-ballistics entry.
13. Every exhaustive-cache winner must include finite `flightMs` and `triggerTtk >= ttk`.
14. Mini Scout AUTO may never fall back to raw 51-RPM cadence; the ballistic regression locks its audited effective interval to ~1276 ms.

## Local checks

```bash
node scripts/audit-ballistic-ttk.mjs
node scripts/audit-global.mjs
node scripts/validate-combat-cache.mjs data/combat-cache.json
node scripts/audit-global.mjs data/combat-cache.json
```

The first two commands validate ballistic timing and packaged application/audit wiring. The last two are strict post-build gates and are expected to fail against a deliberately `pending` placeholder cache. They pass only after the exhaustive GitHub workflow has generated a complete cache.
