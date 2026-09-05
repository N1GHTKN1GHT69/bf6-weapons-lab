#!/usr/bin/env node
/**
 * Hunt for OTHER weapons that exist in two states, the way the VSSM does.
 *
 * The VSSM near-miss was specific and instructive: the source publishes RoF 799.999
 * and SingleRoF 449.999, our record stores the SingleRoF value, and an attachment
 * carries the RoF value as its conversion target. Ingesting the "obvious" stat would
 * have applied the fire-mode transform twice. It was caught because someone knew to
 * look at that one weapon.
 *
 * This looks at ALL of them, mechanically, and reports two independent signals:
 *
 *   A. SOURCE-SIDE COLLISIONS. Weapons where the source publishes several rate stats
 *      that disagree. Wherever they disagree, ONE of them is the state we model and
 *      the others are different configurations, so "just take the headline stat" is
 *      unsafe by construction.
 *
 *   B. ATTACHMENT-SIDE OVERRIDES. Attachments that carry an absolute replacement for a
 *      base weapon value (autoRpm, burstRpm, a fire-mode switch). Each one creates a
 *      second state for its weapon, and each is a place a future ingest could
 *      double-apply.
 *
 * Then it CROSSES them: for every attachment override, does the source publish a stat
 * equal to the override rather than to the base? That is exactly the VSSM shape, and
 * finding it anywhere else would be a live double-transform risk.
 *
 * This is a REPORT, not a policy. It fails only on the one thing that is unambiguously
 * wrong: a base weapon value that equals an attachment's override target while the
 * source publishes a different base value for it - i.e. the transform already applied
 * to the base record.
 *
 * Usage: node scripts/audit-state-collisions.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { loadEffectiveWeapons } from './source-overlay.mjs';
import { loadCapture } from './source-currency.mjs';

const weapons = loadEffectiveWeapons('data/weapons.json');
const attachments = JSON.parse(await readFile('data/attachments.json', 'utf8'));
const capture = loadCapture();
const errors = [];
const notes = [];

const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const liveVersion = capture?.tabs?.['Sym.gg Data']?.gameVersions?.[0] ?? null;
const live = liveVersion ? capture.values[liveVersion] : null;
const sheetRow = w => {
  if (!live) return null;
  for (const name of Object.keys(live)) {
    if (norm(name) === norm(w.name) || norm(name) === norm(w.id) || norm(name) === norm(String(w.name).replace('/', ''))) return live[name];
  }
  return null;
};
const close = (a, b) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= Math.max(1e-9, Math.abs(a) * 1e-5);

/** Every attachment id a weapon can equip, across all three compatibility maps. */
function attachmentIdsFor(weaponId) {
  const ids = new Set();
  const collect = node => {
    if (Array.isArray(node)) { for (const x of node) if (typeof x === 'string') ids.add(x); return; }
    if (node && typeof node === 'object') { for (const v of Object.values(node)) collect(v); }
  };
  collect(attachments.WEAPON_ATTS?.[weaponId]);
  collect(attachments.WEAPON_ERGO?.[weaponId]?.avail);
  for (const k of Object.keys(attachments.WEAPON_MAG?.[weaponId]?.mags ?? {})) ids.add(k);
  return ids;
}

// ---------------------------------------------------- A. source-side rate collisions
const RATE_STATS = ['RoF', 'BurstRoF', 'SingleRoF'];
const sourceCollisions = [];
for (const w of weapons) {
  const row = sheetRow(w);
  if (!row) continue;
  const rates = Object.fromEntries(RATE_STATS.map(s => [s, row[s]]).filter(([, v]) => typeof v === 'number'));
  const distinct = [...new Set(Object.values(rates).map(v => v.toFixed(6)))];
  if (distinct.length <= 1) continue;
  const matching = Object.entries(rates).filter(([, v]) => close(v, w.rpm)).map(([k]) => k);
  sourceCollisions.push({
    weaponId: w.id, name: w.name, fireMode: w.fireMode, ourRpm: w.rpm,
    rates, distinctValues: distinct.length,
    weStore: matching.length ? matching.join('/') : '(none of them)',
    // A weapon whose published rates disagree and whose stored value matches NONE of
    // them is the dangerous case: we cannot say which state our number represents.
    unattributable: matching.length === 0
  });
}

// ------------------------------------------- B. attachment-side absolute overrides
const OVERRIDE_KEYS = ['autoRpm', 'burstRpm', 'rpmOverride', 'setsFireModeAuto', 'recoilDecreaseFactorOverride'];
const overrides = [];
for (const [slot, list] of Object.entries(attachments)) {
  if (!Array.isArray(list)) continue;
  for (const opt of list) {
    const hit = OVERRIDE_KEYS.filter(k => opt?.[k] !== undefined);
    if (!hit.length) continue;
    // Compatibility lives in THREE separate maps with different shapes: WEAPON_ATTS
    // (slot -> ids), WEAPON_ERGO ({avail: ids}) and WEAPON_MAG (mags keyed by id).
    // Checking only the first is how the ergonomics slot - which is exactly where the
    // VSSM fire-mode conversion lives - gets missed.
    const users = weapons.filter(w => attachmentIdsFor(w.id).has(opt.id));
    overrides.push({
      slot, attachmentId: opt.id, name: opt.name,
      keys: Object.fromEntries(hit.map(k => [k, opt[k]])),
      assumedFields: opt.assumedFields ? Object.keys(opt.assumedFields) : [],
      weapons: users.map(w => w.id)
    });
  }
}

// ------------------------------------------------------------------ C. the cross
const risks = [];
for (const o of overrides) {
  const target = o.keys.autoRpm ?? o.keys.burstRpm ?? o.keys.rpmOverride;
  if (typeof target !== 'number') continue;
  for (const id of o.weapons) {
    const w = weapons.find(x => x.id === id);
    const row = sheetRow(w);
    if (!row) continue;
    const publishedMatchingOverride = RATE_STATS.filter(s => close(row[s], target));
    const publishedMatchingBase = RATE_STATS.filter(s => close(row[s], w.rpm));
    const baseIsOverride = close(w.rpm, target);
    const entry = {
      weaponId: id, attachmentId: o.attachmentId, overrideValue: target, baseRpm: w.rpm,
      sourceStatsEqualToOverride: publishedMatchingOverride,
      sourceStatsEqualToBase: publishedMatchingBase,
      shape: baseIsOverride ? 'BASE-ALREADY-CONVERTED'
        : publishedMatchingOverride.length && publishedMatchingBase.length ? 'TWO-STATE-CORRECTLY-SPLIT'
        : publishedMatchingBase.length ? 'OVERRIDE-NOT-PUBLISHED'
        : 'BASE-NOT-PUBLISHED'
    };
    risks.push(entry);
    if (entry.shape === 'BASE-ALREADY-CONVERTED') {
      errors.push(`${id}: base rpm ${w.rpm} equals ${o.attachmentId}'s override target, so the conversion is baked into the base record AND applied again by the attachment. The source publishes ${publishedMatchingBase.join('/') || 'no stat'} for the base.`);
    }
    if (entry.shape === 'BASE-NOT-PUBLISHED') {
      notes.push(`${id}: base rpm ${w.rpm} matches no published rate stat, so which state it represents cannot be confirmed from the source.`);
    }
  }
}

// ------------------------------------------- D. published states we do not model
// A weapon whose published BurstRoF differs from its RoF has a burst state at its own
// cadence. Where no attachment in the catalog switches to it, that state is simply not
// modelled - which is a legitimate modelling boundary, but it must be VISIBLE, because
// it is the same shape as the VSSM case minus the attachment that would trigger it.
//
// Restricted to AUTO and BURST weapons on purpose. For a bolt-action the published RoF
// is a derived effective cycle rate (~44 for the M2010) while BurstRoF/SingleRoF carry
// the raw 299.999 trigger rate - a filler, not a second fire mode. Reporting those as
// "an unmodelled burst state" would be five false alarms that train the reader to skim
// this section, which is the fastest way to make a real one invisible.
const unmodelledStates = [];
for (const c of sourceCollisions) {
  if (c.fireMode !== 'auto' && c.fireMode !== 'burst') continue;
  if (!close(c.rates.RoF, c.rates.BurstRoF) && typeof c.rates.BurstRoF === 'number') {
    const switches = overrides.filter(o => o.weapons.includes(c.weaponId));
    unmodelledStates.push({
      weaponId: c.weaponId, ourRpm: c.ourRpm, ourFireMode: c.fireMode,
      publishedRoF: c.rates.RoF, publishedBurstRoF: c.rates.BurstRoF,
      switchingAttachments: switches.map(s => s.attachmentId),
      modelled: switches.length > 0
    });
  }
}
for (const u of unmodelledStates.filter(x => !x.modelled)) {
  notes.push(`${u.weaponId}: the source publishes a burst cadence (${u.publishedBurstRoF}) distinct from its ${u.publishedRoF} automatic cadence, and no catalog attachment switches to it. That second state is not modelled. Not a defect - but if an attachment for it is ever added, its rate must go on the ATTACHMENT, never into the base record.`);
}

const report = {
  generatedAt: new Date().toISOString(),
  sourceVersion: liveVersion,
  describes: 'weapons that exist in more than one state, and the attachments that switch between them - the class of defect the VSSM RPM near-miss belongs to',
  sourceRateCollisions: sourceCollisions,
  unmodelledPublishedStates: unmodelledStates,
  attachmentOverrides: overrides,
  crossCheck: risks,
  notes, errors
};
await mkdir('reports/patch-delta', { recursive: true });
await writeFile('reports/patch-delta/state-collisions.json', JSON.stringify(report, null, 1));

console.log(`state collisions — source ${liveVersion ?? '(no capture)'}`);
console.log(`\nA. weapons whose published rate stats DISAGREE (${sourceCollisions.length}):`);
for (const c of sourceCollisions) {
  console.log(`   ${c.weaponId.padEnd(10)} ${String(c.fireMode).padEnd(6)} ours ${String(c.ourRpm).padStart(20)}  = ${c.weStore.padEnd(24)} [${Object.entries(c.rates).map(([k, v]) => `${k} ${v}`).join(', ')}]`);
}
console.log(`\nB. attachments carrying an absolute override (${overrides.length}):`);
for (const o of overrides) console.log(`   ${o.slot}/${o.attachmentId.padEnd(20)} ${JSON.stringify(o.keys)}  -> ${o.weapons.join(', ') || '(no weapon lists it)'}`);
console.log(`\nC. cross-check (${risks.length}):`);
for (const r of risks) console.log(`   ${r.weaponId.padEnd(10)} ${r.attachmentId.padEnd(18)} base ${String(r.baseRpm).padStart(10)} / override ${String(r.overrideValue).padStart(10)}  ${r.shape}  base=${r.sourceStatsEqualToBase.join('+') || '-'} override=${r.sourceStatsEqualToOverride.join('+') || '-'}`);
for (const n of notes) console.log(`\n   note: ${n}`);

if (errors.length) {
  console.error('\nFAIL:\n  ' + errors.join('\n  '));
  process.exitCode = 1;
} else {
  console.log('\nPASS: no weapon carries an attachment conversion already baked into its base record.');
}
