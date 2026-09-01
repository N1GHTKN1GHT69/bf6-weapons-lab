# DMR TTK Audit — BF6 1.4.2.5

This audit covers **all 6 current DMRs** at every integer distance from **1m through 300m**.

## TTK definition

Ideal chest TTK is first damaging chest hit → lethal chest hit against 100 HP. ADS time, reaction time, network latency and bullet flight time are excluded.

| DMR | 1–9m | 10–21m | 22–36m | 37–75m | 76m+ |
|---|---:|---:|---:|---:|---:|
| M39 EMR | 467ms / 3 | 467 / 3 | 467 / 3 | 467 / 3 | 467 / 3 |
| LMR27 | 400 / 4 | 400 / 4 | 400 / 4 | 400 / 4 | 400 / 4 |
| SVK-8.6 | 400 / 2 | 400 / 2 | 400 / 2 | 400 / 2 | 400 / 2 |
| SVDM | 400 / 3 | 400 / 3 | 400 / 3 | 400 / 3 | 400 / 3 |
| GRT-CPS | 500 / 4 | 500 / 4 | 500 / 4 | 500 / 4 | 500 / 4 |
| VSSM base | 267 / 3 | 400 / 4 | 533 / 5 | 533 / 5 | 533 / 5 |
| **VSSM + Folding Stock** | **150 / 3** | **225 / 4** | **300 / 5** | **300 / 5** | **300 / 5** |

## Confirmed corrections

### GRT-CPS stale upstream damage
Current live factual references give the GRT-CPS **28.6 / 27.3 / 25 damage at 360 RPM**, so it is a 4-BTK / 500ms chest kill at every audited range. The older analyzer curve can incorrectly give it a 3-BTK / ~333ms TTK. The independent DMR audit now overrides that stale curve.

### VSSM Folding Stock
The VSSM is 450 RPM semi-auto by default. The **40-point Folding Stock** explicitly enables **800 RPM full-auto**. Because that directly changes TTK, the attachment is not handled as a vague utility score: it has its own audited post-attachment TTK curve and is forced into the recommended build whenever the site presents the optimized VSSM TTK.

### SVK-8.6 Match Grade
EA 1.4.2.0 fixed unintended damage reductions from Match Grade ammo on the SVK-8.6. The verified chest TTK baseline therefore remains 2-BTK / 400ms across its damage bands.

## Fail-closed rule
Any other DMR attachment/ammo that begins changing raw chest damage, RPM or fire mode causes the CI audit to fail until that transform is explicitly audited.
