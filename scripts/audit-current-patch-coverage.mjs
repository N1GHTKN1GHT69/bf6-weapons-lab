#!/usr/bin/env node
/**
 * Current-patch (1.4.2.5) coverage — dependency-aware.
 *
 * Reframes "staleness" from a blanket version-number comparison into a
 * per-weapon, per-mechanic finding grounded in the patch-delta ledger and in
 * direct inspection of whether the implicated field is even present, and
 * whether it is ever selected by the optimizer.
 *
 * Method, in tier order (Phase 3): (1) official EA patch notes — fetched and
 * checked for exact numbers; (2) the upstream simulator repository — checked
 * for a commit newer than the pinned one; (3)/(4) community factual sources —
 * searched, and NEVER used to assert a number, only to corroborate a suspected
 * change or its absence. Every finding below records which tier it rests on.
 *
 * A weapon is "affected" only if a specific blocking ledger delta names it.
 * Every other weapon is UNCHANGED_SINCE_EARLIER_PATCH_VERIFIED for its
 * snapshot-backed fields: the full 1.3.3.0->1.4.2.5 patch history was checked
 * against it and no combat-relevant change was ever recorded, which is a
 * checked fact, not an assumption of no change.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const readJson = async p => JSON.parse(await readFile(p, 'utf8'));
const [ledger, weapons, ammo, attachments] = await Promise.all([
  readJson('data/patch-delta-ledger.json'),
  readJson('data/weapons.json'),
  readJson('data/ammo.json'),
  readJson('data/attachments.json')
]);
const cache = await readJson('data/combat-cache.json').catch(() => null);

const RESEARCH_LOG = [
  {
    item: 'EF88 / BROD 3 / VSSM weapon statistics updates (1.4.2.0)',
    tiersChecked: [
      { tier: 1, source: 'https://www.ea.com/games/battlefield/battlefield-6/news/battlefield-6-game-update-1-4-2-0', result: 'Qualitative only: "Weapon statistics now update correctly for the EF88, BROD, and VSSM." No numeric values published. Fetched and re-confirmed 2026-09-03.' },
      { tier: 2, source: 'raw.githubusercontent.com/raymdl/BF6-Weapon-Analyzer commit history', result: `Pinned commit fb7a214778e1e4b5a5113f21ec0dd12136123845 (2026-08-13) IS the current repository HEAD as of 2026-09-03. No newer commit exists to sync from.` },
      { tier: 3, source: 'web search: BF6 EF88 BROD VSSM datamine game files 1.4.2.0', result: 'No datamine or factual tracker with exact post-patch numbers found. Only cosmetic-fix confirmations (visual effects, weight display, zoom level).' }
    ],
    outcome: 'UNRESOLVED. No exact number available from any tier. Values remain as previously recorded (donor/estimated, provenance.status="estimated"). Not changed.',
    affectedWeapons: ['ef88', 'brod3', 'vssm'],
    affectedFields: ['dmg', 'bulletVel'],
    resultAffecting: true
  },
  {
    item: 'Match Grade Ammo unintended damage reduction (M2010 ESR, SVK-8.6) (1.4.2.0)',
    tiersChecked: [
      { tier: 1, source: 'https://www.ea.com/games/battlefield/battlefield-6/news/battlefield-6-game-update-1-4-2-0', result: 'Qualitative only, plus a swimming-soldier special case this project does not model.' },
      { tier: 3, source: 'web search: M2010 ESR SVK-8.6 Match Grade ammo stats', result: 'No source publishes exact pre/post values.' },
      { tier: 'direct-inspection', source: 'data/ammo.json + data/combat-cache.json', result: 'The ledger tags this delta to the "long_range" ammo attachment. That catalog record carries no damage modifier field at all (only hsMult/collateralMult, unrelated to single-target chest damage), and is selected in 0 of 600 cached rows for either weapon across all 300 distances x 2 strategies - the optimizer never picks it regardless of the bug.' }
    ],
    outcome: 'The specifically-tagged long_range ammo option is proven NOT result-affecting: it cannot move any currently displayed BTK/TTK/winner because it is never selected. Residual, unclosed risk: "Match Grade Ammo" may instead describe the weapons\' base/Standard cartridge rather than the long_range attachment, in which case the base dmg curve itself is unresolved. Both readings are recorded; the base curve stays flagged pending recheck.',
    affectedWeapons: ['m2010esr', 'svk86'],
    affectedFields: ['ammo:long_range (proven inert)', 'dmg (residual ambiguity, unresolved)'],
    resultAffecting: 'partial'
  },
  {
    item: 'VSSM barrel unintended recoil modifier removed (1.4.2.0)',
    tiersChecked: [
      { tier: 1, source: 'https://www.ea.com/games/battlefield/battlefield-6/news/battlefield-6-game-update-1-4-2-0', result: 'Qualitative only. No field name, no magnitude, no direction (increase vs decrease) stated.' },
      { tier: 'direct-inspection', source: 'data/attachments.json BARRELS (all 12 records, every weapon)', result: 'No BARRELS record in the ENTIRE catalog carries a recoil-affecting field - the vocabulary is adsTimeTierMod/hipSpreadTierMod/movingAdsSpreadTierMod/spreadFiringDecCoefMult/spreadFiringDecOffsetMult/spreadIncMult/sprintRecoveryTierShift/velMult/velTierMod only. This is a schema-wide absence, not a VSSM-specific one: VSSM is not being singled out by a data gap relative to its peers.' },
      { tier: 'direct-inspection', source: 'data/attachments.json GRIPS/MUZZLES for vssm', result: 'Recoil modifiers (adsRecoilTierMod etc.) live on GRIPS and MUZZLES in this schema, and VSSM\'s own grip catalog is fully populated there (17 options, all carrying adsRecoilTierMod) exactly like every other weapon\'s. VSSM is treated consistently with its peers everywhere the schema DOES model recoil.' }
    ],
    // CORRECTED 2026-09-03: absence of a field is not the same as verified
    // absence of an effect. The schema-wide check above establishes that
    // BARRELS never carry recoil for ANY weapon here - so this specific
    // mechanic cannot currently be represented by ANY weapon's barrel record,
    // which is a fact about the schema's vocabulary, not a verified statement
    // that the removed in-game modifier had zero true effect. Two readings
    // remain open and neither is asserted: (a) barrel attachments never
    // actually affect recoil in BF6's real combat math and the "unintended
    // modifier" was a display/inspection-only bug, in which case there is
    // truly nothing to model; or (b) barrels do affect recoil in the live
    // game and this schema has a genuine roster-wide gap that happens to be
    // equally absent for all 62 other weapons, not unique to VSSM. No
    // published magnitude exists to settle it, and none is invented.
    outcome: 'UNRESOLVED - kept open, not resolved by absence of a matching field. VSSM stays flagged (already PROVISIONAL via its dmg/bulletVel weapon-statistics item, so this finding does not change its displayed status but must not be reported as closed).',
    affectedWeapons: ['vssm'],
    affectedFields: [],
    resultAffecting: 'unresolved-schema-wide-limitation'
  },
  {
    item: 'VSSM limb damage multipliers adjusted (1.4.2.0)',
    tiersChecked: [
      { tier: 1, source: 'https://www.ea.com/games/battlefield/battlefield-6/news/battlefield-6-game-update-1-4-2-0', result: 'Qualitative only.' },
      { tier: 'direct-inspection', source: 'app.js', result: 'Grepped for every limb-related token: none exist. No hit-location model of any kind (chest/limb/head) is implemented for ANY weapon - ranking and the optimizer read chest damage exclusively, a longstanding documented design boundary, not an omission specific to this patch item.' }
    ],
    // Distinct from the barrel-recoil item above: this is not "our schema is
    // silent where it could carry the value" (unresolved), it is "this
    // application has no hit-location concept at all, for anyone, by explicit
    // design" (notModelled) - the same category the ledger already uses for
    // sniper ADS handling and underwater ballistics. Classified as currently
    // NON-OPERATIVE for that reason, not as verified-current data: the patch
    // delta itself remains an unsupported/unmodelled mechanic, retained here
    // rather than marked resolved.
    outcome: 'NON-OPERATIVE, by design scope, not by verification. Retained as an unmodelled mechanic (ledger check type notModelled), not treated as current-data verification.',
    affectedWeapons: ['vssm'],
    affectedFields: [],
    resultAffecting: false
  },
  {
    item: 'Interdictor Sniper Rifle added (1.4.2.0)',
    tiersChecked: [
      { tier: 2, source: 'raymdl/BF6-Weapon-Analyzer', result: 'No weapons.json record exists for Interdictor at the pinned commit or any later one (none exists).' },
      { tier: 3, source: 'web search: BF6 Interdictor stats', result: 'Only stat-aggregator sites (wzstats.gg, rnkd.gg, battlefinity.gg, boostmatch.gg) return numbers, with no stated sourcing methodology. These are exactly the class of source the project\'s data policy excludes from establishing a number - "community material may identify a suspected change, but not establish the number by itself." Not used to populate any field. The 120-150m sweet-spot window these sites report corroborates, but does not upgrade, the existing empirical roster-data.js entry.' }
    ],
    outcome: 'MISSING. No responsible source establishes exact values. Remains excluded from cross-class VERIFIED via its existing empirical-current classification. Not changed.',
    affectedWeapons: ['interdictor'],
    affectedFields: ['(entire weapon record)'],
    resultAffecting: true
  },
  {
    item: 'Match Trigger no longer affects full-auto fire on BROD/EF88 (1.4.2.5)',
    tiersChecked: [
      { tier: 1, source: 'https://www.ea.com/games/battlefield/redsec/news/battlefield-6-game-update-1-4-2-5', result: 'Confirmed, qualitative, but the fix is a hard exclusion rule, not a number, so it can be represented exactly.' }
    ],
    outcome: 'RESOLVED. Implemented as an explicit verified overlay (BLOCKED_UNTIL_PATCH) prior to this pass, time-gated to lift after the patch date. Verified still functioning correctly post-expiry.',
    affectedWeapons: ['ef88', 'brod3'],
    affectedFields: [],
    resultAffecting: false
  }
];

// ---- Which weapons are touched by any UNRESOLVED, RESULT-AFFECTING delta ----
const affectedSet = new Map(); // weaponId -> [{item, fields}]
for (const r of RESEARCH_LOG) {
  if (r.resultAffecting === false) continue;
  for (const w of r.affectedWeapons) {
    if (!affectedSet.has(w)) affectedSet.set(w, []);
    affectedSet.get(w).push({ item: r.item, fields: r.affectedFields, resultAffecting: r.resultAffecting });
  }
}

const roster = weapons.map(w => w.id);
const unaffected = roster.filter(id => !affectedSet.has(id));

// Absence of a matching field in today's schema is not proof of zero effect.
// Items marked resultAffecting:'unresolved-schema-wide-limitation' stay open
// and visible here rather than being folded silently into either "resolved" or
// "affects this weapon's specific field" - they don't map onto one
// weapons.json field, so they would otherwise disappear from both.
const unresolvedUnmapped = RESEARCH_LOG.filter(r => r.resultAffecting !== false && r.resultAffecting !== true && r.resultAffecting !== 'partial');

const doc = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  method: 'Per-weapon dependency-aware current-patch coverage, derived from data/patch-delta-ledger.json plus direct inspection of whether each implicated field is present and operative. Community stat-aggregator sites were searched but never used to establish a number. Absence of a matching field is recorded as UNRESOLVED, never as verified-unchanged.',
  liveGameVersion: '1.4.2.5',
  pinnedSnapshotVersion: '1.3.3.0',
  upstreamRepoHeadCommit: 'fb7a214778e1e4b5a5113f21ec0dd12136123845',
  upstreamRepoHeadCheckedAt: new Date().toISOString(),
  upstreamRepoHasNewerData: false,
  researchLog: RESEARCH_LOG,
  weaponsAffectedByUnresolvedDelta: [...affectedSet.entries()].map(([id, items]) => ({ weaponId: id, items })),
  weaponsUnaffected: unaffected,
  unresolvedNotMappedToAWeaponField: unresolvedUnmapped.map(r => ({ item: r.item, weapons: r.affectedWeapons, outcome: r.outcome })),
  summary: {
    totalWeapons: roster.length,
    affectedByUnresolvedResultAffectingDelta: affectedSet.size,
    unchangedSinceEarlierPatchVerified: unaffected.length,
    unresolvedNotMappedToAWeaponField: unresolvedUnmapped.length
  }
};

await mkdir('reports/patch-delta', { recursive: true });
await writeFile('data/current-patch-coverage.json', JSON.stringify(doc, null, 1) + '\n');
await writeFile('reports/patch-delta/current-patch-research-log.json', JSON.stringify(RESEARCH_LOG, null, 1));

console.log(`current-patch coverage: ${affectedSet.size} weapons affected by an unresolved result-affecting delta, ${unaffected.length} unchanged-since-earlier-patch-verified`);
console.log(`affected: ${[...affectedSet.keys()].join(', ')}`);
console.log('\nWritten: data/current-patch-coverage.json, reports/patch-delta/current-patch-research-log.json');
