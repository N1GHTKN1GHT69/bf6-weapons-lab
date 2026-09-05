#!/usr/bin/env node
/**
 * Gate the versioned source overlay.
 *
 * The overlay is the only mechanism in this project that changes a weapon number
 * without an upstream resync, so it gets the strictest checks in the repository.
 * Every assertion below is mechanical - each one re-derives a fact from the frozen
 * capture or the pristine mirror rather than trusting the overlay document.
 *
 *   1. BASELINE INTEGRITY   every `from` still matches data/weapons.json, and the
 *                           recorded baseline SHA-256 is the file's actual hash.
 *   2. NO HAND-ENTERED DATA every non-derived `to` is byte-equal to the value in
 *                           the frozen source capture for its declared stat.
 *   3. DERIVED CORRECTNESS  every derived `to` is independently recomputed here
 *                           from its declared rule and must match.
 *   4. SCHEMA INVARIANTS    the mirror-duplicate fields (recoilVar, recoilDir,
 *                           recoilIncAds, spreadMax) and the computed recoilV hold
 *                           for ALL 62 weapons in the effective dataset, not just
 *                           the touched ones.
 *   5. VSSM DOUBLE-TRANSFORM REGRESSION   see the block at the bottom. This is the
 *                           reason the gate exists at all.
 *   6. CLEAN APPLICATION    applying through the shipped applier yields zero errors.
 *
 * Usage: node scripts/audit-source-overlay.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { applyOverlays, loadOverlayDoc, readPath, contentSha256 } from './source-overlay.mjs';

const errors = [];
const notes = [];
const fail = m => errors.push(m);

const weaponsText = await readFile('data/weapons.json', 'utf8');
const baseline = JSON.parse(weaponsText);
const doc = loadOverlayDoc();
const capture = JSON.parse(await readFile('data/sources/sheetonmyface-bf6-workbook.json', 'utf8'));
const attachments = JSON.parse(await readFile('data/attachments.json', 'utf8'));

if (!doc) {
  console.log('source overlay: no data/source-overlays.json present. Nothing to gate.');
  process.exit(0);
}
if (doc.schema !== 1) fail(`overlay schema ${doc.schema}, expected 1`);

// ---------------------------------------------------------------- 1. baseline
const actualSha = contentSha256(weaponsText);
if (doc.baseline?.sha256 !== actualSha) {
  fail(`overlay baseline sha256 ${doc.baseline?.sha256} does not match data/weapons.json (${actualSha}). The mirror changed; re-derive the overlay.`);
}

const byId = new Map(baseline.map(w => [w.id, w]));
const allChanges = doc.overlays.flatMap(o => (o.changes ?? []).map(c => ({ ...c, overlayId: o.id, gameVersion: o.gameVersion })));

for (const c of allChanges) {
  const w = byId.get(c.weaponId);
  if (!w) { fail(`${c.overlayId}: unknown weapon ${c.weaponId}`); continue; }
  const current = readPath(w, c.path);
  if (typeof current !== 'number' || Math.abs(current - c.from) > 1e-12) {
    fail(`${c.weaponId}.${c.path}: mirror holds ${current} but the overlay expects to replace ${c.from}`);
  }
}

// ------------------------------------------------------- 2. no hand-entered data
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const sheetNameFor = new Map();
for (const [version, weapons] of Object.entries(capture.values)) {
  for (const sheetName of Object.keys(weapons)) {
    const key = norm(sheetName);
    if (!sheetNameFor.has(key)) sheetNameFor.set(key, sheetName);
  }
}
const captureValue = (weaponId, version, stat) => {
  const w = byId.get(weaponId);
  const sheetName = sheetNameFor.get(norm(w?.name ?? '')) ?? sheetNameFor.get(norm(weaponId));
  return sheetName ? capture.values[version]?.[sheetName]?.[stat] : undefined;
};

for (const c of allChanges) {
  if (c.derived) continue;
  if (!c.sourceStat) { fail(`${c.weaponId}.${c.path}: non-derived change carries no sourceStat, so its value is unattributable`); continue; }
  const fromCapture = captureValue(c.weaponId, c.gameVersion, c.sourceStat);
  if (fromCapture === undefined) {
    fail(`${c.weaponId}.${c.path}: the capture has no ${c.sourceStat} at ${c.gameVersion}`);
  } else if (typeof fromCapture !== 'number' || Math.abs(fromCapture - c.to) > 1e-12) {
    fail(`${c.weaponId}.${c.path}: overlay writes ${c.to} but the capture publishes ${fromCapture} for ${c.sourceStat}. Overlay values must never be hand-entered.`);
  }
}

// --------------------------------------------------------- 6. clean application
const result = applyOverlays(baseline, doc);
for (const e of result.errors) fail(`applier: ${e}`);
const effective = new Map(result.weapons.map(w => [w.id, w]));

// ------------------------------------------------------- 3/4. derived + invariants
const MIRRORS = [
  { path: 'recoilDir', of: 'recoil.ads.dir' },
  { path: 'recoilVar', of: 'recoil.ads.dirVar' },
  { path: 'recoilIncAds', of: 'spreadDyn.ads.inc' },
  { path: 'spreadMax', of: 'spread.adsStand[1]' }
];
const recoilVof = w => readPath(w, 'recoil.ads.amount') * Math.pow(readPath(w, 'recoil.ads.amountMult'), readPath(w, 'recoil.ads.amountExp'));

for (const w of result.weapons) {
  for (const m of MIRRORS) {
    const a = readPath(w, m.path), b = readPath(w, m.of);
    if (typeof a !== 'number' || typeof b !== 'number') continue;
    if (Math.abs(a - b) > 1e-12) fail(`${w.id}: ${m.path} (${a}) no longer mirrors ${m.of} (${b}) after overlays`);
  }
  const want = recoilVof(w);
  if (Number.isFinite(want) && typeof w.recoilV === 'number' && Math.abs(want - w.recoilV) > 1e-9) {
    fail(`${w.id}: recoilV ${w.recoilV} does not equal recoil.ads.amount * amountMult^amountExp (${want}) after overlays`);
  }
}
notes.push(`schema invariants re-verified on all ${result.weapons.length} weapons of the effective dataset`);

// The derived changes must be reproducible, not asserted.
for (const c of allChanges) {
  if (!c.derived) continue;
  const w = effective.get(c.weaponId);
  let want;
  if (c.derived.startsWith('mirror of ')) want = readPath(w, c.derived.slice('mirror of '.length));
  else if (c.derived.startsWith('recoilV =')) want = recoilVof(w);
  else { fail(`${c.weaponId}.${c.path}: unrecognised derivation rule "${c.derived}"`); continue; }
  if (!Number.isFinite(want) || Math.abs(want - c.to) > 1e-9) {
    fail(`${c.weaponId}.${c.path}: derived value ${c.to} does not reproduce from its rule (${want})`);
  }
}

// ------------------------------------------------------------------------------
// 5. VSSM DOUBLE-TRANSFORM REGRESSION
// ------------------------------------------------------------------------------
// The VSSM is the one weapon in the roster that exists in two fire-rate states.
// The workbook publishes both: RoF 799.999 is the FULL-AUTO rate, SingleRoF
// 449.999 is the SEMI-AUTO rate. This project stores the semi-auto rate on the
// weapon and the full-auto rate on the Folding Stock attachment that performs the
// conversion, so both states are already represented exactly once.
//
// Ingesting the workbook's RoF into the base record would make the semi-auto base
// fire at the full-auto rate AND leave the attachment's conversion in place - the
// transform applied twice. These assertions make that permanently impossible.
const vssm = effective.get('vssm');
const vssmSingle = captureValue('vssm', '1.4.2.0', 'SingleRoF');
const vssmAuto = captureValue('vssm', '1.4.2.0', 'RoF');
const folding = (attachments?.ERGOS ?? []).find(a => a.id === 'full_auto_vssm')
  ?? Object.values(attachments ?? {}).flat().find(a => a && a.id === 'full_auto_vssm');

if (!vssm) fail('VSSM is missing from the roster');
if (typeof vssmSingle !== 'number' || typeof vssmAuto !== 'number') fail('the capture no longer publishes both VSSM fire rates; the regression check cannot run');
if (!folding) fail('attachment full_auto_vssm is missing; the VSSM fire-mode conversion is unrepresented');

if (vssm && typeof vssmSingle === 'number' && Math.abs(vssm.rpm - vssmSingle) > 1e-9) {
  fail(`VSSM base rpm is ${vssm.rpm}; it must stay the source SingleRoF (${vssmSingle}), the semi-auto rate.`);
}
if (vssm && typeof vssmAuto === 'number' && Math.abs(vssm.rpm - vssmAuto) < 1e-9) {
  fail(`VSSM base rpm has become the source RoF (${vssmAuto}), the FULL-AUTO rate. The Folding Stock conversion would then apply on top of an already-converted base - the exact double transform this gate exists to prevent.`);
}
if (folding && typeof vssmAuto === 'number' && Math.abs(Number(folding.autoRpm) - vssmAuto) > 1e-9) {
  fail(`full_auto_vssm.autoRpm is ${folding.autoRpm}; it must equal the source RoF (${vssmAuto}), the full-auto rate.`);
}
if (folding && folding.setsFireModeAuto !== true) {
  fail('full_auto_vssm no longer declares setsFireModeAuto; the conversion is what makes the two-state model valid.');
}
if (allChanges.some(c => c.weaponId === 'vssm' && c.path === 'rpm')) {
  fail('an overlay change targets vssm.rpm. The base record must keep the semi-auto rate; the full-auto rate belongs to full_auto_vssm.');
}
const vssmExclusion = doc.overlays.flatMap(o => o.excluded ?? []).find(e => e.weaponId === 'vssm' && e.sourceStat === 'RoF');
if (!vssmExclusion) {
  fail('the overlay does not record the VSSM RoF exclusion. The reason it is excluded must stay written down, or a later pass will "fix" it.');
} else if (!/fire-mode|full-auto|SingleRoF/i.test(String(vssmExclusion.reason))) {
  fail('the recorded VSSM RoF exclusion no longer explains that RoF and SingleRoF are different fire-mode states.');
}
if (!errors.length) {
  notes.push(`VSSM two-state model intact: base rpm ${vssm.rpm} = source SingleRoF, full_auto_vssm.autoRpm ${folding.autoRpm} = source RoF. No double transform possible.`);
}

// -------------------------------------------------------------------- report
const report = {
  generatedAt: new Date().toISOString(),
  overlayFile: 'data/source-overlays.json',
  baselineSha256: actualSha,
  overlays: doc.overlays.map(o => ({ id: o.id, gameVersion: o.gameVersion, enabled: o.enabled !== false, changes: (o.changes ?? []).length, excluded: (o.excluded ?? []).length, weapons: o.weapons ?? [] })),
  applied: result.applied.length,
  applierErrors: result.errors,
  checks: {
    baselineIntegrity: 'every `from` matches the pristine mirror',
    noHandEnteredValues: 'every non-derived `to` is byte-equal to the frozen capture',
    derivedReproducible: 'every derived `to` recomputed from its rule',
    schemaInvariants: `mirror duplicates + recoilV verified on all ${result.weapons.length} weapons`,
    vssmDoubleTransform: 'base rpm = SingleRoF, attachment autoRpm = RoF, no overlay may touch vssm.rpm'
  },
  notes,
  errors
};
await mkdir('reports/patch-delta', { recursive: true });
await writeFile('reports/patch-delta/source-overlay-audit.json', JSON.stringify(report, null, 1));

console.log(`source overlay gate — ${doc.overlays.length} overlay(s), ${allChanges.length} declared change(s), ${result.applied.length} applied`);
for (const o of doc.overlays) console.log(`  ${o.id.padEnd(14)} ${o.gameVersion}  ${(o.changes ?? []).length} changes, ${(o.excluded ?? []).length} excluded  [${(o.weapons ?? []).join(', ')}]`);
for (const n of notes) console.log(`  note: ${n}`);
if (errors.length) {
  console.error('\nFAIL:\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log('\nPASS: overlay is fully attributable to the frozen capture, applies cleanly, preserves every schema invariant, and the VSSM two-state model is intact.');
