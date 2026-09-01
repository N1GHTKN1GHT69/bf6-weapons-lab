# Assault Rifle TTK Audit — BF6 1.4.2.5

Verified: 2026-09-01

Definition: **Ideal chest TTK = first damaging chest hit → lethal chest hit against 100 HP.** It excludes ADS time, human reaction time, network latency, and projectile flight time.

The audit checks all 11 Assault Rifles across every integer meter from **1–300m** (3,300 base-weapon meter checks). Current public values were cross-checked against recent BF6 Wiki weapon pages/TTK tables and EA's current patch notes. The game-data feed uses more precise internal RPM values than many UI tables, so a published whole-RPM chart can differ by 1 ms.

| Weapon | 1st band | 2nd band | 3rd+ band | Notes |
|---|---|---|---|---|
| M433 | 1–21m: 4 BTK / **217ms** | 22–75m: 5 / **289ms** | 76m+: 6 / **361ms** | 830.769 internal RPM |
| B36A4 | 1–21m: 4 / **250ms** | 22–75m: 5 / **333ms** | 76m+: 6 / **417ms** | 719.999 RPM |
| SOR-556 MK2 | 1–21m: 4 / **317ms** | 22–75m: 5 / **422ms** | 76m+: 6 / **528ms** | Some whole-RPM charts show 423ms at mid range |
| AK4D | 1–21m: 3 / **233ms** | 22–75m: 4 / **350ms** | 76m+: 5 / **467ms** | 514.285 RPM |
| TR-7 | 1–21m: 3 / **167ms** | 22–75m: 4 / **250ms** | 76m+: 5 / **333ms** | Theoretical AR TTK leader in the audited base data |
| KORD 6P67 | 1–21m: 5 / **267ms** | 22–75m: 6 / **333ms** | 76m+: 7 / **400ms** | 900 RPM; assumed Burst Training excluded from verified AUTO META |
| NVO-228E | 1–9m: 3 / **183ms** | 10–21m: 4 / **275ms** | 22–75m: 5 / **367ms**; 76m+: 6 / **458ms** | Separate damage step at 36/37m does not change BTK |
| L85A3 | 1–21m: 4 / **283ms** | 22–75m: 5 / **378ms** | 76m+: 6 / **472ms** | 635.294 RPM |
| VCR-2 | 1–21m: 4 / **200ms** | 22–75m: 5 / **267ms** | 76m+: 6 / **333ms** | 900 RPM |
| M16A4 (base burst) | 1–21m: 4 / **267ms** | 22–75m: 5 / **344ms** | 76m+: 6 / **422ms** | Burst cadence is not continuous 771 RPM |
| M16A4 + A3 Receiver | 1–21m: 4 / **233ms** | 22–75m: 5 / **311ms** | 76m+: 6 / **389ms** | Verified 25-point full-auto conversion at 771.428 RPM |
| EF88 | 1–21m: 4 / **267ms** | 22–75m: 5 / **356ms** | 76m+: 6 / **444ms** | 1.4.2.5: Match Trigger must not alter full-auto cadence |

## Confirmed code issues found

1. **Exact damage-breakpoint bug in browser fallback.** Repeated stepped-curve endpoints were processed with a `<=` loop, so exactly 21m/75m (and NVO 9m/21m/36m/75m) could prematurely use the lower damage tier. Fixed to keep the outgoing/high tier through the exact endpoint.
2. **Speculative attachment mechanics could enter AUTO META.** Options marked `assumed` / `assumedFields` are now excluded from verified automatic optimization. Raw combinations can still be counted for transparency.
3. **M16A4 base vs optimized TTK was ambiguous.** The UI now distinguishes base burst TTK from optimized A3 full-auto TTK.
4. **TTK labeling was ambiguous.** The site now explicitly defines TTK as first chest hit → kill and labels the base value separately.
5. **Live version marker was stale.** Updated from 1.4.2.0 to 1.4.2.5. EF88 Match Trigger logic follows the current 1.4.2.5 rule.

## Automated gate

`scripts/audit-assault.mjs` checks the upstream weapon data against this audited baseline at every meter from 1–300m. If damage, RPM, BTK, burst cadence, or TTK moves outside tolerance, the GitHub Action fails instead of silently publishing a new Assault meta cache.
