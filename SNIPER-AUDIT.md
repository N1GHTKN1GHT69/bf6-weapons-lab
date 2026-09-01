# Sniper Rifle TTK Audit — BF6 Weapons Lab v1.3

**Scope:** Sniper Rifles only. Shotguns remain audit-pending. Five sniper rifles are game-file/official-backed; Interdictor is explicitly `empirical-current` and excluded from cross-class AUTO VERIFIED.

## Audit rules

- 100 HP, unarmored target.
- Chest TTK starts on the first damaging chest hit and ends on the lethal chest hit.
- One-shot chest kills are `0 ms / 1 SHOT`.
- Sniper damage curves are linearly interpolated.
- Bolt/rechamber timing uses independently verified effective shot-to-shot cadence, not a blind `60000 / raw RPM` calculation.
- Low-body/limb multiplier: **0.67×**.
- Recon signature proficiency is not assigned a guessed numerical rechamber bonus.
- Community tier lists/popularity are not ranking inputs.

## Current audited facts

| Rifle | Effective follow-up | Base velocity used | Current one-shot chest window |
|---|---:|---:|---|
| Mini Scout | ~1276 ms (~47 RPM) | 760 m/s | none |
| SV-98 | ~1579 ms (38 RPM) | 680 m/s | 54–75 m |
| M2010 ESR | ~1395 ms (43 RPM) | 760 m/s | 75–100 m |
| PSR | ~1579 ms (38 RPM) | 680 m/s | 90–120 m |
| L115 | ~1304 ms (46 RPM) | 664 m/s | 100–133 m |
| Interdictor | ~1935 ms (31 RPM) | 732 m/s | empirical 106–164 m chest; 120–150 m all-body |

## Corrections made

1. **Raw sniper RPM is not treated as authoritative TTK cadence.** The effective public shot-to-shot rates are used for bolt follow-ups.
2. **Mini Scout raw 51 RPM was stale for TTK.** EA 1.1.3.0 added 100 ms minimum time between Mini Scout shots; that yields ~1276 ms, or about **47 effective RPM**.
3. **Interdictor is now rankable.** It is absent from the upstream Analyzer. The site uses a clearly labeled empirical-current model constrained to 31 RPM / 732 m/s / 150 max damage and observed current one-shot windows.
4. **Generic raw/cache sniper TTK can no longer override the independent sniper audit.**
5. **No guessed Recon-class TTK bonus.**
6. **DLC Bolt is utility, not free RPM.**

## Theoretical chest-TTK winner by exact distance

- **1–53 m:** Mini Scout
- **54–74 m:** SV-98
- **75–100 m:** M2010 ESR
- **101–105 m:** PSR
- **106–164 m:** Interdictor *(empirical-current curve)*
- **165–300 m:** Mini Scout

This is theoretical chest lethality only. Practical ranking will later account for velocity, sway, handling, sight recovery and hit probability without importing third-party tier lists.
