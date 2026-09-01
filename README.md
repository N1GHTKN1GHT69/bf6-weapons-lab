# BF6 Weapons Lab v2.0 — Build My Gun

v2.0 makes the manual-weapon workflow a first-class mode instead of hiding it inside the weapon dropdown.

## Build My Gun

- **AUTO META:** the engine may choose both the weapon and its legal attachment build.
- **BUILD MY GUN:** the selected primary is locked. Distance, class/context settings and attachment optimization may change; the weapon itself cannot be replaced by AUTO.
- Entering BUILD MY GUN opens the complete primary catalog so any primary can be selected immediately.
- CQB / Close / Mid / Long / Extreme range cards show the verified exhaustive winning build for 10 / 25 / 50 / 100 / 150m when the combat cache is valid.
- Tapping a range card changes the exact-distance optimizer without unlocking the weapon.
- If the exhaustive combat cache is unavailable, the app clearly labels the current attachment result as **on-demand / not exhaustive** rather than claiming it is the most-lethal verified winner.
- Within a chosen weapon, verified exhaustive attachment winners preserve kill speed first; when lethal performance is close, transformed recoil/spread Beam Index decides the more laser-like build.

# BF6 Weapons Lab v1.9 — Laserbeam META

v1.9 changes AUTO from paper-TTK-first ranking to a recoil-aware laserbeam META. The previous engine already stored recoil/spread mechanics, but they were only attachment tie-breaks; a 1 ms TTK advantage could therefore keep the same high-recoil gun at #1. This release promotes transformed recoil/spread into the actual weapon ranking while retaining a hard lethality competitiveness penalty.

## v1.9 corrections

- **Fixed a cache-builder syntax failure:** `dedupeDominated()` contained a duplicate `const sig` declaration. That could prevent the exhaustive combat cache from building at all and leave the UI on a simpler fallback ranking.
- **AUTO is now Laserbeam META:** 55% exact-distance trigger→kill lethality + 45% recoil/spread controllability.
- **Off-pace guns are penalized:** weapons more than 25% slower than the fastest trigger→kill at the selected distance receive an additional ranking penalty.
- **Beam Index uses transformed mechanics:** recoil amount, directional recoil variation, effective sustained ADS spread, and moving-ADS minimum spread after the selected attachments are applied.
- **Attachment winners are recoil-aware:** when two verified builds are within 12% trigger→kill, the lower Beam Index wins before tiny paper-TTK differences.
- **Old caches fail closed:** `rankingModel` must equal `laserbeam-v1`, and every winning row must include finite Beam Index and effective ADS spread values.
- **Permanent regression gate:** `scripts/audit-laserbeam-meta.mjs` syntax-checks the relevant engine, verifies recoil/spread primitives are wired in, verifies the cache-model gate, and uses a synthetic ranking test to ensure a slightly slower laserbeam can beat a tiny paper-TTK advantage while a grossly slow gun cannot.

### Beam Index scope

Beam Index is a **controllability index**, not a fabricated hit-probability percentage. Lower is better. It is built from the Analyzer's real recoil/spread model and becomes more sensitive to angular instability as distance increases. Actual player compensation, target movement, network conditions and aim skill are not claimed or guessed.

# BF6 Weapons Lab v1.8 — Exact-Distance Ballistic TTK

This release fixes the exact-distance TTK failure exposed by the Sniper Rifle screenshots. v1.7's class audits were mechanically correct but the primary displayed/ranking TTK still used first-hit→kill timing, which intentionally excludes projectile flight. v1.8 separates mechanical TTK from trigger→lethal-impact TTK and makes the distance-sensitive ballistic value authoritative for AUTO ranking.

## v1.8 ballistic corrections

- **Exact-distance TTK now includes projectile flight.** `TRIGGER→KILL` is the primary META key; `MECH TTK` remains visible as a diagnostic.
- **One-shot does not mean 0 ms in the primary ranking anymore.** A 100 m one-shot shows its actual flight time.
- **Mini Scout stale 51-RPM bypass is blocked.** AUTO cannot fall through to raw weapon cadence if an audited class model is missing; its effective follow-up remains ~1276 ms after EA's +100 ms minimum shot interval adjustment.
- **Verified BF6 drag is generalized to all classes.** The app loads `data/ballistics.json` and uses the same closed-form flight model as the current BF6 Weapon Analyzer.
- **Cross-class VERIFIED is stricter.** A weapon must have both audited lethality and verified projectile ballistics to enter the cross-class META.
- **Exhaustive cache winners now carry `flightMs` and `triggerTtk`.** Cache generation/ranking uses trigger→impact first and validation rejects rows that omit ballistic timing.
- **Detail and AUTO panels now agree.** A validated exhaustive winning build is shown before the base class-audit result.
- See `BALLISTIC-TTK-AUDIT.md` for the regression values and exact failure gates.

This release hardens the whole engine after all weapon classes were individually audited. It rejects incomplete combat caches, makes exhaustive verified attachment winners authoritative for AUTO META ranking, preserves class-audit values as the fail-closed fallback, and adds a permanent 63-weapon global regression gate.

## v1.7 global corrections retained

- **Exhaustive cache now fails closed.** `audit.pass` alone is no longer sufficient: every source weapon must be modeled, incomplete must be zero, every modeled weapon must contain all 300 distance winners, every winner must reference a real build, and every winning build must remain within its class point budget.
- **AUTO META is now cache-first.** When a valid exhaustive cache exists, weapon ranking uses the best verified legal attachment build at that distance before falling back to base class-audit TTK. This fixes the v1.6 mismatch where the attachment panel could show an optimized build while AUTO ranked the naked gun.
- **Tie-break stats follow the winning build.** Velocity and ADS tie-breaks now use the transformed stats of the exhaustive winning build when available.
- **Required lethal attachments no longer bypass exhaustive optimization.** M16A4 A3 Receiver, VSSM Folding Stock, and verified shotgun Slug transforms can use the exhaustive winner when that winner contains the independently required attachment.
- **Source sync now triggers META rebuilds.** Changes to synced weapons, attachments, ammo, ballistics, balance tables, or recoil-decay data immediately trigger the combat workflow instead of waiting for the next daily combat schedule.
- **Global regression gate added.** CI now checks 63/63 roster coverage, 56 primaries, 7 sidearms, unique IDs/names, every class-audit mapping, 1–300m range coverage, corrected sidearm fallback RPMs, the 60-point sidearm budget, shotgun cross-class exclusion, cache-first ranking wiring, and the final exhaustive cache.
- The ZIP intentionally ships its combat cache as **pending** unless it was produced by the GitHub combat workflow. Pending/invalid caches are never labeled exhaustive or used as META input.

## Verified classes

- Assault Rifles: 11/11, 1–300m
- Carbines: 9/9, 1–300m
- SMGs: 10/10, 1–300m
- LMGs: 10/10, 1–300m
- DMRs: 6/6, 1–300m
- Sniper Rifles: **5 fully verified + 1 empirical-current (Interdictor)**, 1–300m
- Cross-class `AUTO VERIFIED` now includes **51 fully verified primaries**. Interdictor remains manually inspectable but is excluded from VERIFIED AUTO until its exact game-file curve and verified projectile model are available.

See `SNIPER-AUDIT.md` for the sniper-specific values and corrections.

## Critical v1.3 corrections

1. **Bolt-action TTK no longer blindly uses the Analyzer raw RPM field.** Audited effective shot-to-shot cadence is used for M2010 ESR, SV-98, PSR, Mini Scout and L115.
2. **Mini Scout cadence fixed.** EA officially added 100 ms to its minimum time between shots. Applied to the upstream 51-RPM nominal interval, that is about 1276 ms between shots, or roughly 47 effective RPM.
3. **Sweet-spot damage is linearly interpolated** at every integer meter. The EA 1.3.3 current windows are SV-98 54–75m, M2010 ESR 75–100m, PSR 90–120m and L115 100–133m.
4. **Interdictor remains fail-closed for VERIFIED AUTO.** The Analyzer still lacks it. Its labeled empirical-current model remains available for manual inspection, but it is not admitted to automatic META until the exact game-file curve and projectile model are verified.
5. **No guessed Recon rechamber multiplier.** Recon proficiency is real, but until a reliable numerical multiplier is available the TTK audit remains class-neutral.
6. **DLC Bolt is utility, not free ROF.** Staying ADS while cycling is not treated as shorter shot-to-shot time without verified cadence evidence.
7. Any newly introduced verified sniper damage/RPM/fire-mode transform causes CI to fail until explicitly audited.

## TTK definitions

- **MECH TTK:** first damaging chest hit → lethal chest hit against 100 HP. Projectile flight is excluded; a one-shot is mechanically `0 ms`.
- **TRIGGER→KILL:** trigger pull → lethal chest impact at the exact selected distance. Projectile flight is included and this is the primary META ranking key.
- ADS time, reaction time and network latency remain separate from both metrics.

## Data policy

External sources provide factual mechanics/data only. Community rankings, popularity, usage, tier lists and creator recommendations are never inputs to the meta calculation.

## Deploy

Download this ZIP and drag it onto `Deploy-BF6.bat`; GitHub and Cloudflare update automatically.

## v1.4 DMR recheck

- Reconfirmed all six DMR mechanical chest TTK curves at every integer meter from 1–300m.
- Renamed the displayed TTK to **MECH CHEST TTK** because standard TTK is first-hit→kill and excludes projectile travel.
- Added **TRIGGER→KILL** for DMRs so the exact target distance visibly affects time-to-lethal-impact.
- Uses the verified `dragPerMeter = 0.0035` ballistic model for M39 EMR, LMR27, SVK-8.6, SVDM and GRT-CPS.
- VSSM is not in the upstream verified ballistics list, so its trigger-to-kill can be shown only as **provisional** within the DMR class and is excluded from cross-class VERIFIED. Its 40-point / 800-RPM Folding Stock mechanical transform remains verified.
- Retired the old GRT-CPS stale-3-BTK warning because current upstream data now agrees with 4 BTK / 500ms.

## Shotgun audit

Shotguns now have a fail-closed mechanical audit for #01 Buckshot, Flechette and Slugs across 1–300 m. M87A1 pump cadence and DB-12 paired cadence are modeled explicitly. #00 Buckshot remains legal but is excluded from VERIFIED META until its exact current full pellet/damage/range curve is independently validated. Shotguns also remain excluded from cross-class AUTO VERIFIED rankings until spread/pellet hit probability is modeled; ideal all-pellet TTK is only appropriate for within-class mechanical comparison.
