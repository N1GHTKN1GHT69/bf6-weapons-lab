# DMR Re-Audit — BF6 Weapons Lab v1.4

## What looked wrong

The displayed **mechanical TTK arithmetic was mostly correct**, but the UI made a critical presentation mistake: the site used an exact target-distance slider while labeling a number that **excluded projectile flight** simply as TTK. For DMRs, where BTK often does not change across range, that made 400ms/467ms/500ms appear unrealistically flat regardless of distance.

## Correct mechanical chest TTK

| DMR | 1–9m | 10–21m | 22–36m | 37–75m | 76m+ |
|---|---:|---:|---:|---:|---:|
| M39 EMR | 467 / 3 | 467 / 3 | 467 / 3 | 467 / 3 | 467 / 3 |
| LMR27 | 400 / 4 | 400 / 4 | 400 / 4 | 400 / 4 | 400 / 4 |
| SVK-8.6 | 400 / 2 | 400 / 2 | 400 / 2 | 400 / 2 | 400 / 2 |
| SVDM | 400 / 3 | 400 / 3 | 400 / 3 | 400 / 3 | 400 / 3 |
| GRT-CPS | 500 / 4 | 500 / 4 | 500 / 4 | 500 / 4 | 500 / 4 |
| VSSM base | 267 / 3 | 400 / 4 | 533 / 5 | 533 / 5 | 533 / 5 |
| VSSM + Folding Stock | 150 / 3 | 225 / 4 | 300 / 5 | 300 / 5 | 300 / 5 |

Each cell is `mechanical TTK ms / chest BTK`. Mechanical TTK starts when the first damaging hit lands and ends when the lethal hit lands. Projectile travel is excluded by definition.

## New distance-sensitive metric

The PWA now also shows **TRIGGER→KILL** for DMRs:

`trigger-to-kill = projectile flight time to selected distance + mechanical TTK`

For the five DMRs included in the verified ballistics set (M39, LMR27, SVK-8.6, SVDM, GRT-CPS), flight time uses the measured Battlefield drag form with `dragPerMeter = 0.0035` and the current equipped-barrel velocity.

VSSM is not yet in the upstream verified ballistics weapon list. Its 800-RPM Folding Stock mechanical TTK is verified, but its distance-adjusted value is displayed only as a **no-drag lower bound (≥)** until the projectile drag model is verified.

## Other corrections

- The old warning that GRT-CPS upstream data was still a stale 3-BTK curve is removed. Current upstream data now agrees on the 4-BTK / 500ms result.
- DMR velocity and ADS display now use the audited current/equipped values instead of letting older raw base fields override them.
- VSSM's 40-point Folding Stock remains a verified 800-RPM direct-lethality transform and is still charged against Pick-100.
- Theoretical weapon ranking remains based on **mechanical chest TTK first**, because that is the standard weapon TTK definition. Distance-sensitive projectile delivery is now exposed separately instead of being hidden inside an ambiguous TTK label.
