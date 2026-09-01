# BF6 Weapons Lab v0.4

v0.4 is the first structural rebuild after live testing the deployed prototype.

## What changed

- Current 63-weapon multiplayer catalog is always present, independent of stat-feed health.
- Exact 5–300 m target-distance control replaces the old short/medium/long buckets.
- Quick distance presets are shortcuts only; the exact selected meter value drives scoring.
- BF6-style visual weapon dashboard with damage/BTK/TTK/ROF/MAG and colored characteristic bars.
- Character bars are explicitly **relative within the weapon class**; they are not fake copies of BF6's hidden UI formula.
- Live weapon, attachment and ammo feeds fail independently. A bad attachment record no longer erases the weapon catalog.
- Builds fail closed: no weapon-specific compatibility + magazine + ammo tables means **DATA PENDING**, not a guessed loadout.
- Removed inferred Range Finder compatibility. The optimizer only uses Range Finder when the weapon compatibility table actually lists it.
- Primary attachment budget: **100**.
- Secondary attachment budget: **60**.
- Complete loadout presentation is compact and closer to the Battlefield loadout mental model.
- Service worker cache bumped to `v04` and uses network-first app assets so updates appear reliably.

## Current data architecture

1. `roster-data.js` — current catalog shell and official range notes that should remain visible even if external data fails.
2. BF6 Weapon Analyzer raw JSON — weapon simulation values and weapon-specific attachment compatibility when reachable.
3. `class-data.js` — class / training / gadget / throwable utility layer.
4. Optimizer — exact-distance weighted Pick-100 (or Pick-60 sidearm) search.

## Important truth-in-data rules

- `POINT MATH PASS` means the selected source costs add up and are within the weapon budget. It does **not** mean every third-party cost has been independently confirmed in the current in-game UI.
- Source freshness is shown separately.
- The Interdictor is in the catalog because it is live in 1.4.2.0; if the stat feed does not yet contain it, its build stays unavailable.
- BF6 Character bars are relative class indexes derived from measurable recoil/spread/handling inputs. The exact raw values remain visible underneath.

## Deploy

Replace the repository files with the contents of this folder and commit to `main`. Cloudflare Pages should redeploy automatically.

Because the service worker cache name changed, v0.4 should replace the old cached app after refresh/reopen.

## Point-budget correction found during v0.4

The data audit now allows legitimate **0-point ammunition choices on specific sidearms** (for example, the source currently lists Standard ammo at 0 points on M44 and M357 TRAIT). The old v0.3 audit incorrectly assumed every ammo selection had to consume points; that could cause the whole data feed to fail and trigger the four-gun sample fallback. v0.4 removes that failure mode and re-adds every recommended build from its exact source costs before displaying it.
