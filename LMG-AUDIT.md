# LMG TTK Audit — v1.1

## Scope

This audit covers all 10 current Battlefield 6 LMGs:

- L110
- DRS-IAR
- M/60
- RPKM
- M123K
- M250
- KTS100 MK8
- M240L
- M121 A2
- RPK-74M

Every weapon is checked at every integer distance from 1m through 300m.

## TTK definition

Ideal chest TTK is measured from the first damaging chest hit to the lethal chest hit against 100 HP.

For these full-auto LMGs:

`TTK = (BTK - 1) × 60,000 / RPM`

ADS time, reaction time, network latency and projectile flight time are not included.

## Verified base chest TTK

| Weapon | 1–9m | 10–21m | 22–36m | 37–75m | 76m+ |
|---|---:|---:|---:|---:|---:|
| L110 | 250 / 4 | 250 / 4 | 333 / 5 | 333 / 5 | 417 / 6 |
| DRS-IAR | 233 / 4 | 233 / 4 | 311 / 5 | 311 / 5 | 389 / 6 |
| M/60 | 233 / 3 | 233 / 3 | 350 / 4 | 350 / 4 | 467 / 5 |
| RPKM | 217 / 3 | 325 / 4 | 433 / 5 | 433 / 5 | 542 / 6 |
| M123K | 217 / 4 | 217 / 4 | 289 / 5 | 289 / 5 | 361 / 6 |
| M250 | 267 / 4 | 267 / 4 | 267 / 4 | 267 / 4 | 267 / 4 |
| KTS100 MK8 | 350 / 4 | 350 / 4 | 467 / 5 | 467 / 5 | 583 / 6 |
| M240L | 200 / 3 | 200 / 3 | 300 / 4 | 300 / 4 | 400 / 5 |
| M121 A2 | 183 / 3 | 183 / 3 | 275 / 4 | 275 / 4 | 367 / 5 |
| RPK-74M | 350 / 5 | 350 / 5 | 438 / 6 | 438 / 6 | 525 / 7 |

Each cell is `TTK ms / BTK`.

## Independent cross-check

The eight original LMGs were checked against the current Battlefield 6 Wiki TTK/BTK table. The engine uses precise internal RPM, so 1ms differences from tables calculated with rounded RPM are accepted.

M121 A2 was independently cross-checked against its current public weapon page:
- 654 RPM displayed
- 33.4 / 25 / 20 displayed damage
- 21m and 75m breakpoints
- derives 3 / 4 / 5 BTK and 183 / 275 / 367ms first-hit-to-kill TTK

RPK-74M was independently cross-checked against its current public weapon page:
- 685 RPM displayed
- 20 / 16.7 / 14.3 displayed damage
- 21m and 75m breakpoints
- derives 5 / 6 / 7 BTK and about 350 / 438 / 526ms using rounded RPM
- the precise 685.714 RPM source produces 350 / 438 / 525ms

M250 was independently cross-checked as a fixed-damage weapon with no falloff:
- 25 displayed damage
- 675 RPM
- 4 BTK
- 267ms TTK at every distance

## AUTO LMG result

The class-only mechanical audit below is retained for regression. As of v1.8, AUTO ranking uses exact-distance trigger→lethal-impact TTK first:

- **1–21m: M121 A2 — 183ms**
- **22–300m: M250 — 267ms**

So AUTO LMG should switch from M121 A2 to M250 immediately after 21m.

## Fail-closed attachment rule

The LMG audit scans all currently compatible attachment and ammo records.

If any verified LMG attachment or ammo begins changing:
- chest damage
- full-auto RPM
- fire mode

the audit fails until that post-attachment lethality effect is explicitly modeled and independently verified.

Speculative/assumed records cannot create a VERIFIED META lethality advantage.

## Automated test totals

- 10 weapons
- 300 distances per weapon
- 3,000 base chest damage/BTK/TTK checks
- 3,000 low-body TTK sanity checks
- 46 independent known-good breakpoint checks
- direct-lethality attachment/ammo fail-closed gate
