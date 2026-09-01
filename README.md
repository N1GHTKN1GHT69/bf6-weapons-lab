# BF6 Weapons Lab v1.4 — DMR Recheck

This release re-audits DMR TTK presentation after live testing showed the target-distance UI was misleading. Mechanical first-hit→kill TTK remains verified, while DMR projectile flight is now shown separately as TRIGGER→KILL where the ballistic model is verified. VSSM remains lower-bound-only for flight until its drag model is verified.


v1.3 adds the sixth class-by-class verification gate: **Sniper Rifles**.

## Verified classes

- Assault Rifles: 11/11, 1–300m
- Carbines: 9/9, 1–300m
- SMGs: 10/10, 1–300m
- LMGs: 10/10, 1–300m
- DMRs: 6/6, 1–300m
- Sniper Rifles: **5 fully verified + 1 empirical-current (Interdictor)**, 1–300m
- Cross-class `AUTO VERIFIED` now includes **51 fully verified primaries**. Interdictor can rank inside the Sniper tab but is excluded from cross-class VERIFIED until its exact game-file curve is available.

See `SNIPER-AUDIT.md` for the sniper-specific values and corrections.

## Critical v1.3 corrections

1. **Bolt-action TTK no longer blindly uses the Analyzer raw RPM field.** Audited effective shot-to-shot cadence is used for M2010 ESR, SV-98, PSR, Mini Scout and L115.
2. **Mini Scout cadence fixed.** EA officially added 100 ms to its minimum time between shots. Applied to the upstream 51-RPM nominal interval, that is about 1276 ms between shots, or roughly 47 effective RPM.
3. **Sweet-spot damage is linearly interpolated** at every integer meter. The EA 1.3.3 current windows are SV-98 54–75m, M2010 ESR 75–100m, PSR 90–120m and L115 100–133m.
4. **Interdictor is rankable without fabricating its attachment model.** The Analyzer still lacks it, so TTK uses a clearly labeled empirical-current model constrained to current 31 RPM / 732 m/s / 150 max damage and observed 106–164m chest OHK plus 120–150m all-body OHK. Attachment/recoil data remain pending.
5. **No guessed Recon rechamber multiplier.** Recon proficiency is real, but until a reliable numerical multiplier is available the TTK audit remains class-neutral.
6. **DLC Bolt is utility, not free ROF.** Staying ADS while cycling is not treated as shorter shot-to-shot time without verified cadence evidence.
7. Any newly introduced verified sniper damage/RPM/fire-mode transform causes CI to fail until explicitly audited.

## TTK definition

Ideal chest TTK = first damaging chest hit to lethal chest hit against 100 HP. A chest one-shot is displayed as `1 SHOT`, not `0 ms`. ADS time, reaction time, network latency and bullet flight time are excluded.

## Data policy

External sources provide factual mechanics/data only. Community rankings, popularity, usage, tier lists and creator recommendations are never inputs to the meta calculation.

## Deploy

Download this ZIP and drag it onto `Deploy-BF6.bat`; GitHub and Cloudflare update automatically.

## v1.4 DMR recheck

- Reconfirmed all six DMR mechanical chest TTK curves at every integer meter from 1–300m.
- Renamed the displayed TTK to **MECH CHEST TTK** because standard TTK is first-hit→kill and excludes projectile travel.
- Added **TRIGGER→KILL** for DMRs so the exact target distance visibly affects time-to-lethal-impact.
- Uses the verified `dragPerMeter = 0.0035` ballistic model for M39 EMR, LMR27, SVK-8.6, SVDM and GRT-CPS.
- VSSM is not in the upstream verified ballistics list, so its trigger-to-kill is shown only as a **no-drag lower bound (≥)**. Its 40-point / 800-RPM Folding Stock mechanical transform remains verified.
- Retired the old GRT-CPS stale-3-BTK warning because current upstream data now agrees with 4 BTK / 500ms.

## Shotgun audit

Shotguns now have a fail-closed mechanical audit for #01 Buckshot, Flechette and Slugs across 1–300 m. M87A1 pump cadence and DB-12 paired cadence are modeled explicitly. #00 Buckshot remains legal but is excluded from VERIFIED META until its exact current full pellet/damage/range curve is independently validated. Shotguns also remain excluded from cross-class AUTO VERIFIED rankings until spread/pellet hit probability is modeled; ideal all-pellet TTK is only appropriate for within-class mechanical comparison.
