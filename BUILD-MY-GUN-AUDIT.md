# BUILD MY GUN audit — v2.0

## Goal

The user may lock any primary weapon and optimize only that weapon's attachments for the selected exact distance. AUTO META must never replace a manually locked weapon.

## Two independent winner models

- `best`: AUTO META / Laserbeam winner. Uses the recoil-aware laserbeam policy.
- `bestLethal`: BUILD MY GUN winner. Uses strict trigger-to-lethal-impact time first, then mechanical TTK, BTK, damage and low-body TTK. Beam Index is only a tie-break after lethal metrics tie.

Both maps are generated for every modeled weapon at every integer meter from 1–300 m and point-budget validation applies to both.

## UI invariants

- Explicit AUTO META and BUILD MY GUN controls.
- BUILD MY GUN opens all primary weapons.
- Changing distance in BUILD MY GUN cannot call automatic weapon replacement.
- 10/25/50/100/150 m range cards preview the strict max-lethality winner when the exhaustive cache is valid.
- The detail dashboard and attachment panel use the same `bestLethal` winner in manual mode.
- If the exhaustive cache is unavailable, the site labels the on-demand build as non-exhaustive instead of claiming a verified max-lethality winner.

## Regression

`node scripts/audit-manual-weapon.mjs`

Expected:

`BUILD MY GUN PASS • manual weapon stays locked • full primary catalog • strict max-lethality winners at 1–300m • Beam Index only breaks lethal ties`
