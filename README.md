# BF6 Build Lab v0.2

A mobile-first PWA prototype that recommends a complete Battlefield 6 loadout: primary Pick-100 attachments, best-fit class, training path, signature synergy, two gadgets, throwable, complementary secondary weapon, and secondary attachments for short, medium or long range.


## Pick-100 point accuracy

The weapon attachment budget is **100 points maximum**. A valid build may use less than 100 if spending the remainder would make the build worse, but it may never exceed 100.

This project now treats point accuracy as a hard validation rule:

- Point costs are never inferred from attachment names.
- Weapon-specific magazine costs come from `WEAPON_MAG` for that exact weapon.
- Weapon-specific ammo costs come from `WEAPON_AMMO` for that exact weapon.
- Optic, barrel, magazine and ammo are mandatory paid categories; the optimizer does not inject a fake 0-point barrel.
- Missing/unknown point costs make a build invalid instead of silently counting as 0.
- Every recommended primary and secondary build is re-summed after optimization and rejected if it is over 100.
- Synced source data must pass `scripts/point-audit.mjs` before it is written to `/data`.
- The UI shows **POINTS VERIFIED** only for live data that passed the audit. Offline fallback data is clearly marked as non-production sample data.

Run a local audit after syncing:

```bash
node scripts/sync-sources.mjs
node scripts/validate-points.mjs
```

The current fixed-cost cross-check includes known optics, muzzles, barrels, lights/rangefinder and ergonomics. Magazine and variable-ammo pricing remain weapon-specific by design.

## What is different about this optimizer

It does not treat every attachment as a simple stat modifier. It has a separate behavior layer for mechanics such as:

- Range Finder target-distance display
- Magwell Flare / staying ADS during reload flow
- DLC Bolt / maintaining sight picture on supported sniper rifles
- Aftermarket Buffer visual recoil
- Bipod positional utility
- Suppressor / signature utility
- Magazine capacity vs handling/reload tradeoffs

## Data

At runtime the app tries, in order:

1. Same-origin files in `/data/` (recommended production path)
2. Current raw JSON from `raymdl/BF6-Weapon-Analyzer` on GitHub
3. A tiny bundled fallback sample so the UI still runs

The source project currently exposes:
- `data/weapons.json`
- `data/attachments.json`
- `data/ammo.json`

Important: data provenance/version matters. The UI surfaces the version string found in weapon damage provenance when available.

## Run locally

Do not double-click `index.html`; use an HTTP server.

Python:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Production deployment

This is static and works well on:
- Cloudflare Pages
- GitHub Pages
- Netlify
- Vercel static hosting

## Syncing source JSON into the site

Run:

```bash
node scripts/sync-sources.mjs
```

That downloads current weapon, attachment and ammo JSON into `/data/`, which makes the PWA same-origin and cacheable.

The included GitHub Action runs the sync every 6 hours and on manual dispatch. For a production repo, decide whether the action should commit changed JSON or trigger your deployment platform after sync.

## Important limitation in v0.1

The BF6 Weapon Analyzer currently defines `Range Finder` but does not expose exact per-weapon Range Finder compatibility in the same weapon availability mapping used by the optimizer. This prototype only infers Range Finder eligibility for Sniper Rifle / DMR and clearly flags that result.

Before public launch, replace that inference with an exact compatibility overlay collected from in-game tooltips or another validated source.

## Next engineering steps

1. Exact rangefinder/optic-accessory compatibility table.
2. Import the analyzer's full simulation functions for true post-attachment recoil/spread/TTK, instead of the current weighted tier optimizer.
3. EA/BFComms patch watcher that writes a `latest-game-version.json`.
4. Version mismatch gate: do not call a result “current meta” if weapon data version lags the official game version.
5. Shareable build URLs and QR codes.
6. Weapon images/icons with appropriate licensing/source handling.
7. Optional controller/mouse profiles and player priorities.


## v0.2 full-loadout optimizer

Added:
- Auto or manual class selection
- Class signature-weapon proficiency scoring
- Class signature trait + signature gadget context
- Training Path recommendation
- Two-gadget recommendation with Engineer launcher constraint
- Class-specific throwable recommendation
- Battle context: Infantry, Objective, Mixed, Vehicle-heavy
- Secondary weapon recommendation designed to complement the selected primary/range
- Secondary Pick-100 attachment optimization when source mappings are available
- Current class/gadget rules layer separated from raw weapon JSON so live balance changes can be versioned independently

Class/rules source layer should be kept versioned against EA's current class guides and game updates. Exact gadget availability and training names can change independently of raw gun stats.
