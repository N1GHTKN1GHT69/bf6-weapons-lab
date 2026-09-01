# BF6 Weapons Lab — Carbine TTK Audit (v0.9)

**Scope:** Carbines only. No SMG/LMG/DMR/Sniper/Shotgun conclusions are certified by this audit.

## Definition

Ideal **chest TTK** is measured from the first damaging chest hit to the lethal chest hit against a 100 HP target.

- No ADS time
- No reaction time
- No network latency
- No projectile flight time
- Full-auto carbines use: `TTK = (BTK - 1) × 60,000 / RPM`
- Damage step endpoints are inclusive. The outgoing/higher tier remains valid **through exactly 9m, 21m, 36m and 75m** where that weapon uses those breakpoints.

## Audited base values

| Weapon | 1–9m | 10–21m | 22–36m | 37–75m | 76m+ |
|---|---:|---:|---:|---:|---:|
| M4A1 | 200ms / 4 | 267 / 5 | 333 / 6 | 333 / 6 | 400 / 7 |
| M277 | 250 / 4 | 250 / 4 | 250 / 4 | 250 / 4 | 333 / 5 |
| AK-205 | 333 / 5 | 417 / 6 | 500 / 7 | 500 / 7 | 583 / 8 |
| M417 A2 | 183 / 3 | 275 / 4 | 367 / 5 | 367 / 5 | **458 / 6** |
| GRT-BC | 217 / 4 | 289 / 5 | 361 / 6 | 361 / 6 | **433 / 7** |
| QBZ-192 | 233 / 4 | 311 / 5 | 389 / 6 | 389 / 6 | 467 / 7 |
| SG 553R | **167 / 3** | 250 / 4 | 333 / 5 | 417 / 6 | 500 / 7 |
| SOR-300SC | 200 / 3 | 300 / 4 | 400 / 5 | 500 / 6 | 600 / 7 |
| BROD 3 | 217 / 4 | 289 / 5 | 361 / 6 | 361 / 6 | **433 / 7** |

M417 A2 and GRT-BC/BROD can appear one millisecond slower in public tables because those tables use displayed/rounded RPM (654 / 830). The engine uses the more precise raw rates (654.545 / 830.769).

## Independent factual cross-check

The current Battlefield 6 Wiki TTK/BTK comparison matches the eight legacy carbine band values. The current BROD 3 page independently states BROD 3 has the same damage, falloff and rate of fire as GRT-BC, so its base theoretical chest TTK matches GRT-BC.

## Issues found / corrections

1. **Carbines had never been independently audit-gated.** They were still using the live/cache path even after the Assault audit. v0.9 makes the fixed Carbine audit authoritative for base chest damage/BTK/TTK.
2. **Audited classes could be overridden by the exhaustive cache.** That defeats the purpose of a class audit. v0.9 uses the audited class baseline first; cache data is only allowed to supply post-build/mechanical information where it does not contradict the audited base TTK.
3. **Speculative `assumedFields` filtering only handled arrays.** Some upstream records use objects. v0.9 excludes both non-empty arrays and objects from VERIFIED AUTO META.
4. **BROD Match Trigger is explicitly guarded.** BF6 1.4.2.5 says Match Trigger no longer affects fully automatic fire on BROD. Any future source record that claims a full-auto damage/RPM/fire-mode advantage now fails the Carbine audit.
5. **Burst Training remains unverified.** `burst_training` and `grtbc_burst_mode` are currently marked assumed by the source. They are excluded from VERIFIED META until exact burst cadence is independently validated.

## Automated gate

GitHub now validates:

- 9 current Carbines
- 300 integer distances per weapon
- **2,700 base distance checks**
- 5 public TTK bands × 9 weapons = **45 known-good band cross-checks**
- attachment lethality guards
- current BROD Match Trigger rule

A source update that changes those facts causes the audit job to fail instead of silently publishing a new “meta.”
