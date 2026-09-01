# BF6 Weapons Lab — SMG TTK Audit (v1.0)

This audit covers **SMGs only**. No LMG, DMR, Sniper Rifle, or Shotgun is promoted into VERIFIED AUTO META by this release.

## Scope

- 10 current SMGs
- 1m through 300m at every integer meter
- 3,000 base damage / BTK / chest-TTK checks
- 3,000 low-body sanity checks using the current 0.84 automatic-primary multiplier
- 42 independent known-good TTK checks
- exact stepped-damage endpoint handling
- verified attachment/ammo lethality guard
- speculative burst-mode attachment exclusion

## TTK definition

Ideal chest TTK is measured from the first damaging chest hit to the lethal chest hit against 100 HP.

For these full-auto base SMGs:

`TTK = (BTK - 1) × 60,000 / RPM`

ADS time, reaction time, network latency and projectile flight time are excluded.

## Audited chest TTK

| SMG | 1–9m | 10–21m | 22–36m | 37–75m | 76–300m |
|---|---:|---:|---:|---:|---:|
| SGX | 217ms / 4 | 289 / 5 | 361 / 6 | 433 / 7 | 506 / 8 |
| PW5A3 | 233 / 4 | 311 / 5 | 389 / 6 | 467 / 7 | 544 / 8 |
| PW7A2 | 317 / 6 | 317 / 6 | 380 / 7 | 380 / 7 | 443 / 8 |
| UMG-40 | 283 / 4 | 378 / 5 | 472 / 6 | 472 / 6 | 567 / 7 |
| USG-90 | 267 / 5 | 333 / 6 | 400 / 7 | 400 / 7 | 467 / 8 |
| KV9 | 167 / 4 | 222 / 5 | 278 / 6 | 333 / 7 | 389 / 8 |
| SCW-10 | 150 / 3 | 225 / 4 | 300 / 5 | 375 / 6 | 450 / 7 |
| SL9 | 267 / 4 | 356 / 5 | 444 / 6 | 533 / 7 | 622 / 8 |
| CZ3A1 | 183 / 4 | 244 / 5 | 306 / 6 | 367 / 7 | 428 / 8 |
| PP-19 | 250 / 4 | 333 / 5 | 417 / 6 | 500 / 7 | 583 / 8 |

The first eight SMGs are cross-checked against the current Battlefield 6 Wiki TTK table. Differences of 1ms at some bands are expected because this engine uses the more precise internal RPM values rather than display-rounded RPM. CZ3A1 and PP-19 are cross-checked from their independently published fire-rate/damage inputs.

## Endpoint rule

The outgoing/higher damage tier remains valid **through exactly** 9m, 21m, 36m and 75m when the weapon uses those breakpoints. The lower tier begins immediately after the breakpoint.

That means, for example, SCW-10 is still a 150ms / 3-BTK weapon at exactly 9m, then becomes 225ms / 4 BTK at 10m.

## Attachment rule

The current verified ordinary SMG attachment/ammo records do not get to alter chest damage or normal full-auto RPM silently. The CI audit fails if a verified attachment gains one of those transforms without an explicit post-attachment TTK audit.

Burst Training / Burst Mode are currently marked assumed by the upstream analyzer and are excluded from VERIFIED META. EA 1.3.2.0 also states that Burst Fire attachment effects on UMG-40, PW5A3 and CZ3A1 apply only while using the burst fire mode. They therefore cannot be used to create a fake full-auto TTK improvement.

## Theoretical AUTO winner

The class-only mechanical audit below is retained for regression. As of v1.8, AUTO ranking uses exact-distance trigger→lethal-impact TTK first:

- **1–9m: SCW-10 — 150ms**
- **10–300m: KV9** (222ms at 10–21m, 278ms at 22–36m, 333ms at 37–75m, 389ms at 76m+)

This is a theoretical all-chest-hit ranking. Practical recoil/spread/accuracy modeling remains a separate layer and does not overwrite the audited theoretical TTK.

## Patch status

The live game version for this audit is 1.4.2.5. Its weapon changelog only changes Match Trigger behavior on BROD and EF88; it does not introduce an SMG damage/RPM balance change.

## Data policy

External sources are used only to verify factual weapon mechanics and numeric inputs. Community tier lists, popularity, usage rates, creator recommendations, and outside meta rankings are not inputs to the optimizer.
