# BF6 Weapons Lab v1.2 — DMR TTK Audited

v1.2 adds the fifth class-by-class verification gate: **DMRs**.

## Verified classes

- Assault Rifles: 11/11, 1–300m
- Carbines: 9/9, 1–300m
- SMGs: 10/10, 1–300m
- LMGs: 10/10, 1–300m
- DMRs: 6/6, 1–300m
- Cross-class `AUTO VERIFIED` now includes **46 independently audited primaries**.

See `DMR-AUDIT.md` for the DMR-specific values and corrections.

## Critical v1.2 corrections

1. **GRT-CPS stale upstream curve fixed.** Current live factual data is 28.6 / 27.3 / 25 damage at 360 RPM, yielding 4 BTK / 500ms across all ranges. The older analyzer curve could incorrectly rank it as ~333ms.
2. **VSSM Folding Stock explicitly modeled.** The 40-point stock enables verified 800 RPM full-auto. Its optimized chest TTK is 150ms at 1–9m, 225ms at 10–21m and 300ms from 22m onward.
3. The VSSM optimized recommendation is now required to actually include Folding Stock. The site cannot display the 800-RPM TTK while recommending a build that omitted the stock.
4. The generic combat cache cannot override the independent DMR baseline.
5. Any other verified DMR damage/RPM/fire-mode transform causes CI to fail until explicitly audited.

## TTK definition

Ideal chest TTK = first damaging chest hit to lethal chest hit against 100 HP. It excludes ADS time, reaction time, network latency and bullet travel time.

## Data policy

External sources provide factual mechanics/data only. Community rankings, popularity, usage, tier lists and creator recommendations are never inputs to the meta calculation.

## Deploy

Download this ZIP and drag it onto `Deploy-BF6.bat`; GitHub and Cloudflare update automatically.
