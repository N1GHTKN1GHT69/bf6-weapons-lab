#!/usr/bin/env node
/**
 * Gate the source freshness watchers - WITHOUT touching the network.
 *
 * A watcher is only worth having if it is quiet when nothing happened and loud
 * when something did. Both halves are testable offline, and both are tested here,
 * because a watcher that silently stopped detecting things looks exactly like a
 * watcher that has nothing to report.
 *
 *   1. STATE/CAPTURE AGREEMENT  the committed watch fingerprint must reproduce
 *      from the committed capture. If they drift, the watcher is comparing the
 *      live workbook against a state nothing in the repository stands behind.
 *   2. QUIET ON NOISE           canonicalisation absorbs spreadsheet float noise
 *      and formatting, so a recalculation cannot spawn a 62-weapon rebuild.
 *   3. LOUD ON SIGNAL           a real value move, a new weapon, and a removed
 *      value each change the fingerprint. Verified by perturbing a copy.
 *   4. NO BLIND SPOT            every path the overlay actually writes is
 *      reachable from the watched field map, so nothing this project ingests can
 *      change at the source without the watcher noticing.
 *   5. BOTH WATCHERS WIRED      sym.gg's own site AND the workbook. Watching only
 *      the publisher's site is what let a 1.4.2.0 dump sit unnoticed for weeks.
 *
 * Usage: node scripts/audit-freshness-watchers.mjs
 */
import { readFile } from 'node:fs/promises';
import { combatFingerprint } from './watch-source-workbook.mjs';
import { SYM_FIELD_MAP, SYM_COMBAT_STATS, MIRROR_FIELDS, canonicalNumber } from './sym-field-map.mjs';

const errors = [];
const notes = [];
const fail = m => errors.push(m);

const capture = JSON.parse(await readFile('data/sources/sheetonmyface-bf6-workbook.json', 'utf8'));
const state = JSON.parse(await readFile('data/sources/workbook-watch-state.json', 'utf8'));
const overlay = JSON.parse(await readFile('data/source-overlays.json', 'utf8'));
const workflow = await readFile('.github/workflows/freshness-watch.yml', 'utf8');

// ------------------------------------------------- 1. state / capture agreement
const liveVersion = capture.tabs['Sym.gg Data'].gameVersions[0];
if (state.knownGameVersion !== liveVersion) {
  fail(`watch state knows game version ${state.knownGameVersion} but the committed capture is ${liveVersion}`);
}
if (state.knownSheetVersion !== capture.source.sheetVersion) {
  fail(`watch state knows sheet v${state.knownSheetVersion} but the committed capture is v${capture.source.sheetVersion}`);
}
const fromCapture = combatFingerprint(capture.values[liveVersion]);
if (fromCapture.digest !== state.combatFingerprint) {
  fail(`the watch fingerprint (${state.combatFingerprint.slice(0, 16)}...) does not reproduce from the committed capture (${fromCapture.digest.slice(0, 16)}...). Re-run scripts/watch-source-workbook.mjs --write.`);
}
if (fromCapture.fields !== state.combatFields) {
  fail(`the watch state counts ${state.combatFields} modelled values but the capture yields ${fromCapture.fields}`);
}
notes.push(`watch fingerprint reproduces from the capture over ${fromCapture.fields} modelled values`);

// ------------------------------------------------------------ 2. quiet on noise
const base = capture.values[liveVersion];
const clone = () => JSON.parse(JSON.stringify(base));

// (a) float noise from a spreadsheet recalculation
const noisy = clone();
let noiseApplied = 0;
for (const weapon of Object.keys(noisy)) {
  for (const stat of SYM_COMBAT_STATS) {
    const v = noisy[weapon][stat];
    if (typeof v !== 'number' || v === 0) continue;
    noisy[weapon][stat] = v + v * 1e-13; // ~1e-13 relative: pure IEEE noise
    noiseApplied++;
  }
}
if (!noiseApplied) fail('float-noise test perturbed nothing; the test is not exercising anything');
if (combatFingerprint(noisy).digest !== state.combatFingerprint) {
  fail('float noise at 1e-13 relative changed the fingerprint. A spreadsheet recalculation would spawn a full rebuild.');
} else notes.push(`float noise at 1e-13 relative across ${noiseApplied} values does NOT move the fingerprint`);

// (b) an edit to a stat this project does not model
const unmodelled = clone();
const firstWeapon = Object.keys(unmodelled)[0];
const unmodelledStat = capture.statNames.find(s => !SYM_COMBAT_STATS.includes(s));
if (!unmodelledStat) fail('every captured stat is modelled, so the unmodelled-stat test cannot run');
else {
  unmodelled[firstWeapon][unmodelledStat] = 123456.789;
  if (combatFingerprint(unmodelled).digest !== state.combatFingerprint) {
    fail(`changing the unmodelled stat ${unmodelledStat} moved the fingerprint. The watcher would fire on data this project never reads.`);
  } else notes.push(`an edit to the unmodelled stat "${unmodelledStat}" does NOT move the fingerprint`);
}

// (c) column reordering
const reordered = {};
for (const w of Object.keys(base).reverse()) {
  reordered[w] = Object.fromEntries(Object.entries(base[w]).reverse());
}
if (combatFingerprint(reordered).digest !== state.combatFingerprint) {
  fail('reordering weapons/stats moved the fingerprint; it is not order-independent');
} else notes.push('weapon and stat reordering does NOT move the fingerprint');

// ------------------------------------------------------------ 3. loud on signal
const smallestRealDelta = 0.00069; // ef88 HIPRecoilDirectionVariationMultiplier, 0.069%
const moved = clone();
const probeWeapon = Object.keys(moved).find(w => typeof moved[w].velocity === 'number');
moved[probeWeapon].velocity = moved[probeWeapon].velocity * (1 + smallestRealDelta);
if (combatFingerprint(moved).digest === state.combatFingerprint) {
  fail(`a ${(smallestRealDelta * 100).toFixed(3)}% move in ${probeWeapon} velocity did NOT change the fingerprint. The watcher is blind to the smallest real delta this source has produced.`);
} else notes.push(`a ${(smallestRealDelta * 100).toFixed(3)}% value move (the smallest real delta seen in this source) DOES move the fingerprint`);

const added = clone();
added['__NEW WEAPON__'] = { velocity: 700, RoF: 600 };
if (combatFingerprint(added).digest === state.combatFingerprint) fail('adding a weapon did not change the fingerprint');

const removed = clone();
delete removed[probeWeapon].velocity;
if (combatFingerprint(removed).digest === state.combatFingerprint) fail('removing a modelled value did not change the fingerprint');
notes.push('adding a weapon and removing a modelled value both move the fingerprint');

// canonicalNumber directly
if (canonicalNumber(0.36) !== canonicalNumber(0.36000000000000004)) fail('canonicalNumber does not absorb IEEE representation noise');
if (canonicalNumber(830.769) === canonicalNumber(830.7692307692307)) fail('canonicalNumber collapses 830.769 and 830.7692307692307; 9 significant digits should keep them distinct');
if (canonicalNumber('') !== null || canonicalNumber('abc') !== null) fail('canonicalNumber should return null for non-numeric input');

// -------------------------------------------------------------- 4. no blind spot
const watchedPaths = new Set(SYM_FIELD_MAP.map(f => f.path));
const derivedPaths = new Set(MIRROR_FIELDS.map(m => m.path).concat(['recoilV']));
for (const o of overlay.overlays ?? []) {
  for (const c of o.changes ?? []) {
    if (watchedPaths.has(c.path)) continue;
    if (c.derived && derivedPaths.has(c.path)) continue;
    fail(`overlay writes ${c.weaponId}.${c.path} but no watched source stat maps to it. A change to that value at the source would go undetected.`);
  }
}
notes.push(`all ${(overlay.overlays ?? []).flatMap(o => o.changes ?? []).length} overlay changes target watched or derived paths`);

// ------------------------------------------------------- 5. both watchers wired
if (!/scripts\/watch-sym-source\.mjs/.test(workflow)) fail('the freshness workflow no longer runs the sym.gg site watcher');
if (!/scripts\/watch-source-workbook\.mjs/.test(workflow)) {
  fail('the freshness workflow does not run the workbook watcher. Watching only sym.gg\'s own site is what let a public 1.4.2.0 dump sit unnoticed.');
}
if (!/continue-on-error:\s*true/.test(workflow)) fail('the watchers are not marked continue-on-error; an unreachable third party would fail the build');

console.log(`freshness watcher gate — ${SYM_COMBAT_STATS.length} watched stats, ${state.combatFields} fingerprinted values`);
for (const n of notes) console.log(`  ${n}`);
if (errors.length) {
  console.error('\nFAIL:\n  ' + errors.join('\n  '));
  process.exitCode = 1;
} else {
  console.log('\nPASS: the watchers are quiet on noise, loud on real change, and have no blind spot over what this project ingests.');
}
