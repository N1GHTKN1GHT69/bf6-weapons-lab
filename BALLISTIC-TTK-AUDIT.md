# Exact-Distance Ballistic TTK Audit — BF6 Weapons Lab v1.8

## Why v1.7 was misleading

The class audits used the conventional **mechanical TTK** definition: time from the first damaging hit to the lethal hit. That is useful for weapon mechanics, but it excludes projectile travel. In an exact-distance optimizer this caused two bad UI/ranking behaviors:

1. A one-shot sniper at 100 m displayed `0 ms`, even though the bullet still needs time to reach the target.
2. A two-shot sniper could display the same TTK at 10, 25, 50, 100 and 150 m as long as its BTK did not change.

The screenshots also exposed a separate bypass: Mini Scout could fall back to the Analyzer's nominal `51 RPM`, producing `1176 ms`, instead of the independently audited effective interval that includes EA's +100 ms minimum time between shots (~1276 ms / ~47 effective RPM).

## v1.8 definitions

- **MECH TTK** = first damaging hit → lethal hit. This remains a diagnostic and still reads `0 ms` for a one-shot.
- **TRIGGER→KILL TTK** = trigger pull → lethal impact at the selected distance. This is now the primary exact-distance META/ranking metric.
- `TRIGGER→KILL = MECH TTK + projectile flight time` for the lethal projectile.
- Projectile flight uses the current BF6 Analyzer ballistic model `dv/dt = -k·v²`, with level-flight time `expm1(k·distance)/(k·velocity)` and current verified drag data.
- AUTO ranking fails closed if the audited combat path is missing. It no longer drops to raw weapon RPM/damage.

## Sniper regression examples

These values use the current verified base drag model and audited sniper follow-up cadence.

| Rifle / distance | Damage | BTK | MECH TTK | Flight | TRIGGER→KILL |
|---|---:|---:|---:|---:|---:|
| Mini Scout @ 10 m | 62.0 | 2 | 1276 ms | 13 ms | **1290 ms** |
| Mini Scout @ 25 m | 61.7 | 2 | 1276 ms | 34 ms | **1311 ms** |
| Mini Scout @ 50 m | 59.9 | 2 | 1276 ms | 72 ms | **1348 ms** |
| Mini Scout @ 100 m | 58.0 | 2 | 1276 ms | 158 ms | **1434 ms** |
| Mini Scout @ 150 m | 58.0 | 2 | 1276 ms | 260 ms | **1536 ms** |
| M2010 ESR @ 100 m | 100 | 1 | 0 ms | 158 ms | **158 ms** |
| PSR @ 100 m | 100 | 1 | 0 ms | 176 ms | **176 ms** |
| L115 @ 100 m | 100 | 1 | 0 ms | 180 ms | **180 ms** |

The important invariant is not that mechanical TTK must vary continuously. It often should not. The invariant is that the **primary exact-distance TTK must include flight time**, so it changes with distance even when BTK and cadence are unchanged.

## Verified sniper winner by exact-distance TRIGGER→KILL

Interdictor remains excluded from VERIFIED AUTO until its game-file curve/ballistics are independently available.

- 1–53 m: Mini Scout
- 54–74 m: SV-98
- 75–100 m: M2010 ESR
- 101–120 m: PSR
- 121–133 m: L115
- 134–300 m: Mini Scout

## Permanent gates

`node scripts/audit-ballistic-ttk.mjs` now fails if:

- the five verified legacy snipers are absent from the verified ballistic list;
- Mini Scout does not use `60000/51 + 100 ms` effective follow-up timing;
- the stale 1176 ms Mini Scout cadence leaks into the audited path;
- Mini Scout trigger-to-kill does not increase across 10/25/50/100/150 m;
- a one-shot sniper at 100 m reports zero trigger-to-kill time.

The global gate additionally fails if AUTO contains a raw `combatAtDistance` bypass, if trigger-to-impact is not the first ranking key, or if cross-class VERIFIED admits a weapon without verified ballistics.
