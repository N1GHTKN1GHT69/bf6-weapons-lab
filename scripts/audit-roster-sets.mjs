#!/usr/bin/env node
/**
 * BF6 Weapons Lab — roster identity-set gate.
 *
 * Roster correctness was previously encoded as hard-coded counts (56 primaries,
 * 7 secondaries, 62 cache-eligible), which meant a legitimate new Battlefield
 * weapon could not flow through the automatic updater without a source edit,
 * and a substitution (one weapon removed, one unknown added) kept the totals
 * looking correct. These scenarios drive the real set model directly.
 */
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { buildWeaponSets, evaluateWeaponSets, missingCombatFields, norm } from './roster-sets.mjs';

const errors = [];
const check = (label, cond, detail = '') => { if (!cond) errors.push(`${label}${detail ? `: ${detail}` : ''}`); };

const json = async p => JSON.parse(await readFile(p, 'utf8'));
const ctx = { window: {} };
vm.runInNewContext(await readFile('roster-data.js', 'utf8'), ctx, { filename: 'roster-data.js' });
const roster = ctx.window.BF6_CURRENT;
const weapons = await json('data/weapons.json');
const ledger = await json('data/patch-delta-ledger.json');
const cache = await json('data/combat-cache.json').catch(() => null);
const audits = {
  'Assault Rifle': await json('data/assault-audit.json'), Carbine: await json('data/carbine-audit.json'),
  SMG: await json('data/smg-audit.json'), LMG: await json('data/lmg-audit.json'),
  DMR: await json('data/dmr-audit.json'), 'Sniper Rifle': await json('data/sniper-audit.json'),
  Shotgun: await json('data/shotgun-audit.json'), Sidearm: await json('data/sidearm-audit.json')
};

const pendingKeys = new Set();
for (const p of ledger.patches ?? []) for (const ch of p.changes ?? []) {
  if (ch.check?.type === 'weaponPresent' && ch.check.weaponId && !weapons.some(w => norm(w.id) === norm(ch.check.weaponId))) {
    pendingKeys.add(norm(ch.check.weaponId));
  }
}
const run = (opts = {}) => {
  const sets = buildWeaponSets({
    roster: opts.roster ?? roster, weapons: opts.weapons ?? weapons,
    ledger: opts.ledger ?? ledger, audits, cacheIds: opts.cacheIds ?? null
  });
  return { sets, ...evaluateWeaponSets(sets, { ledgerPendingWeaponKeys: opts.pendingKeys ?? pendingKeys }) };
};
const clone = o => JSON.parse(JSON.stringify(o));
const sample = weapons.find(w => w.cls === 'Assault Rifle');

// --- A. Existing current roster passes -------------------------------------
{
  const { sets, errors: e } = run({ cacheIds: cache ? Object.keys(cache.weapons ?? {}) : null });
  check('A: current roster passes set reconciliation', e.length === 0, e.join('; '));
  check('A: counts are derived, not asserted', sets.counts.combatEligible > 0 && sets.counts.primaries > 0 && sets.counts.sidearms > 0);
  if (cache) check('A: cache set equals combat-eligible set', !sets.cacheDelta.missingFromCache.length && !sets.cacheDelta.extraInCache.length,
    `missing ${sets.cacheDelta.missingFromCache.join(',')} extra ${sets.cacheDelta.extraInCache.join(',')}`);
}

// --- B. Expected new weapon absent from source stays pending ----------------
{
  const { errors: e, sets } = run();
  const pendingIds = sets.expectedMissingFromSource.map(m => m.id);
  check('B: an officially expected weapon absent from source does not error while the ledger holds it pending',
    e.length === 0 && pendingIds.length > 0, `errors=${e.join(';')} pending=${pendingIds.join(',')}`);
  check('B: the pending weapon is not combat-eligible', !sets.combatEligibleIds.includes(norm(pendingIds[0])));
}

// --- C. Expected weapon later appears with valid data becomes eligible ------
{
  // A future patch adds a weapon; the ledger records it; upstream then ships it.
  // Nothing in the audits is edited, and it must become eligible on its own.
  const futureLedger = clone(ledger);
  futureLedger.patches.push({
    version: '1.4.3.0', releaseDate: '2026-09-20', officialSource: 'https://www.ea.com/x',
    combatRelevant: true,
    changes: [{ mechanic: 'new weapon', blocking: true, description: 'XM-9 added', check: { type: 'weaponPresent', weaponId: 'xm9' } }]
  });
  const futureRoster = clone(roster);
  futureRoster.roster.push({ id: 'xm9', name: 'XM-9', cls: 'Assault Rifle' }); // no unlock/desc metadata
  futureRoster.rosterCount = futureRoster.roster.length;

  // Before upstream ships it: expected, pending, not eligible, no hard error.
  const pendingRun = run({ roster: futureRoster, ledger: futureLedger, pendingKeys: new Set(['xm9', ...pendingKeys]) });
  check('C: a ledger-recorded weapon absent upstream stays pending without error', pendingRun.errors.length === 0, pendingRun.errors.join('; '));
  check('C: pending weapon is not yet combat-eligible', !pendingRun.sets.combatEligibleIds.includes('xm9'));
  const before = pendingRun.sets.counts.combatEligible;

  // After upstream ships it, with valid combat data and no metadata.
  const arrived = clone(weapons);
  arrived.push({ ...clone(sample), id: 'xm9', name: 'XM-9', cls: 'Assault Rifle' });
  const { sets, errors: e } = run({ roster: futureRoster, weapons: arrived, ledger: futureLedger });
  check('C: newly arrived expected weapon becomes combat-eligible automatically', sets.combatEligibleIds.includes('xm9'), e.join('; '));
  check('C: no unresolved errors once it arrives', e.length === 0, e.join('; '));
  check('C: class counts grow automatically without editing constants', sets.counts.combatEligible === before + 1,
    `${before} -> ${sets.counts.combatEligible}`);
  check('C: the new weapon lands in its declared class', sets.counts.byClass['Assault Rifle'] > 0);
}

// --- C2. Interdictor specifically stays gated by its empirical confidence ---
{
  // Even when it arrives upstream, an empirical-current audited model must not
  // silently enter cache generation. This is existing verified behaviour.
  const arrived = clone(weapons);
  arrived.push({ ...clone(sample), id: 'interdictor', name: 'Interdictor', cls: 'Sniper Rifle' });
  const { sets } = run({ weapons: arrived, pendingKeys: new Set() });
  check('C2: an empirical-current weapon stays out of the cache-eligible set even once upstream ships it',
    !sets.combatEligibleIds.includes('interdictor'));
  check('C2: and the reason is reported', sets.ineligible.some(i => i.id === 'interdictor' && /empirical-current/.test(i.reason)));
}

// --- D. Unexpected source-only weapon is quarantined ------------------------
{
  const contaminated = clone(weapons);
  contaminated.push({ ...clone(sample), id: 'zz_test_weapon', name: 'ZZ Test Weapon' });
  const { sets, errors: e } = run({ weapons: contaminated });
  check('D: unknown source weapon is quarantined, not promoted', e.some(x => /QUARANTINE/.test(x) && /zz_test_weapon/.test(x)), e.join('; '));
  check('D: quarantined weapon never becomes combat-eligible', !sets.combatEligibleIds.includes('zztestweapon'));
}

// --- E. An expected weapon disappearing fails ------------------------------
{
  const removed = clone(weapons).filter(w => w.id !== sample.id);
  const { errors: e } = run({ weapons: removed });
  check('E: a previously expected weapon vanishing from source fails closed',
    e.some(x => x.includes(sample.id) && /missing from the trusted combat source/.test(x)), e.join('; '));
}

// --- F. Same count, wrong identity, must still fail -------------------------
{
  const substituted = clone(weapons).filter(w => w.id !== sample.id);
  substituted.push({ ...clone(sample), id: 'unknown_sub', name: 'Unknown Sub' });
  check('F: substitution keeps the total identical', substituted.length === weapons.length);
  const { errors: e } = run({ weapons: substituted });
  check('F: substitution fails despite an unchanged count',
    e.some(x => x.includes(sample.id)) && e.some(x => /QUARANTINE/.test(x)), e.join('; '));
}

// --- G. Missing optional UI metadata does not block combat ------------------
{
  const stripped = clone(roster);
  for (const w of stripped.roster) { delete w.unlock; delete w.desc; }
  const { sets, errors: e } = run({ roster: stripped });
  check('G: absent unlock/description metadata does not block combat ingestion',
    e.length === 0 && sets.counts.combatEligible === run().sets.counts.combatEligible, e.join('; '));
}

// --- H. Missing required combat fields blocks the weapon -------------------
{
  for (const field of ['dmg', 'rpm', 'bulletVel', 'mag']) {
    const broken = clone(weapons);
    const target = broken.find(w => w.id === sample.id);
    delete target[field];
    const { sets } = run({ weapons: broken });
    check(`H: missing ${field} makes the weapon combat-ineligible`, !sets.combatEligibleIds.includes(norm(sample.id)));
    check(`H: missing ${field} is reported with a reason`, sets.ineligible.some(i => i.id === sample.id && i.reason.includes(field)));
  }
  check('H: field validator rejects a malformed damage curve', missingCombatFields({ ...sample, dmg: [{ r: 'x', d: null }] }).includes('dmg'));
}

// --- I. Cache set differing from eligible set fails with exact ids ----------
{
  if (cache) {
    const ids = Object.keys(cache.weapons ?? {});
    const short = ids.filter(id => id !== ids[0]);
    const { errors: e } = run({ cacheIds: [...short, 'ghost_weapon'] });
    check('I: cache/eligible mismatch fails and names the missing id', e.some(x => x.includes(ids[0]) && /absent from the cache/.test(x)), e.join('; '));
    check('I: cache/eligible mismatch names the extra id', e.some(x => /ghostweapon/.test(x) && /not combat-eligible/.test(x)), e.join('; '));
  }
}

// --- J. Unknown class quarantines rather than inventing a category ---------
{
  const oddClass = clone(weapons);
  oddClass.find(w => w.id === sample.id).cls = 'Railgun';
  const { sets } = run({ weapons: oddClass });
  check('J: unrecognised class makes the weapon ineligible', !sets.combatEligibleIds.includes(norm(sample.id)));
  check('J: unrecognised class is reported', sets.ineligible.some(i => i.id === sample.id && /unrecognised class/.test(i.reason)));
  check('J: no new optimizer category is invented', !sets.recognisedClasses.includes('Railgun'));
}

// --- No magic counts may return to the audits ------------------------------
{
  const global = await readFile('scripts/audit-global.mjs', 'utf8');
  const preflight = await readFile('scripts/preflight-upstream.mjs', 'utf8');
  for (const [file, src] of [['audit-global.mjs', global], ['preflight-upstream.mjs', preflight]]) {
    for (const bad of [/length!==\s*56/, /length!==\s*62/, /length!==\s*63/, /!==\s*7\)/]) {
      if (bad.test(src)) errors.push(`${file} reintroduced a hard-coded roster count (${bad})`);
    }
    if (/['"]interdictor['"]/.test(src)) errors.push(`${file} hardcodes a specific weapon id; new weapons must flow through the ledger instead`);
  }
}

if (errors.length) {
  console.error('ROSTER SET AUDIT FAILED');
  errors.forEach(e => console.error('-', e));
  process.exit(1);
}
const s = run({ cacheIds: cache ? Object.keys(cache.weapons ?? {}) : null }).sets;
console.log(`ROSTER SET PASS • ${s.counts.officialExpected} officially expected • ${s.counts.trustedSource} in trusted source • ${s.counts.combatEligible} combat-eligible (${s.counts.primaries} primaries + ${s.counts.sidearms} sidearms) • ${s.expectedMissingFromSource.length} awaiting upstream • 10 identity scenarios gated`);
