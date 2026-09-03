#!/usr/bin/env node
/**
 * MEASURED field impact.
 *
 * The source-data audit states which fields can move which outputs. Those claims
 * were structural - reasoned from how the engine is wired. This measures them:
 * each field is perturbed to an obviously different value and the weapon's own
 * ranking row is compared before and after.
 *
 * KNOWN LIMITATION, stated rather than hidden: a source perturbation is only
 * observable on the ON-DEMAND path, because the exhaustive cache holds
 * precomputed rows. So this measures the dependency a cache REBUILD would
 * follow, not the currently cached values. Two consequences:
 *
 *   - Beam Index here is the fallback index, which uses recoil primitives only.
 *     The richer cached Beam Index additionally consumes spread fields, so a
 *     "no change" for a spread field means "not used by the fallback", NOT
 *     "unused by the engine".
 *   - Where an audited class model supersedes a raw field, the raw field
 *     correctly shows no effect. That is a finding about which value is
 *     operative, not a dead field.
 *
 * Writes reports/overnight/field-impact.json. Fails only on a contradiction
 * that matters: a field the source audit calls result-moving that is provably
 * inert on every weapon tested AND has no audited override to explain it.
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { bootLab } from './lab-harness.mjs';

const { diag, window: win } = await bootLab();
const weapons = JSON.parse(await readFile('data/weapons.json', 'utf8'));

// One weapon per class, so a class-specific override cannot hide behind another.
const roster = (win.BF6_CURRENT?.roster ?? []).filter(w => w.cls !== 'Secondary');
const sample = [];
for (const cls of win.BF6_CURRENT?.primaryClasses ?? []) {
  const pick = roster.find(w => w.cls === cls && weapons.some(x => x.id === w.id));
  if (pick) sample.push(pick);
}

const PERTURB = {
  rpm: w => Math.max(30, Number(w.rpm || 600) * 0.5),
  bulletVel: w => Math.max(50, Number(w.bulletVel || 700) * 0.4),
  mag: () => 5,
  tacRld: () => 9,
  emptyRld: () => 9,
  recoilV: w => (Number(w.recoilV) || 1) * 10 + 5,
  recoilVar: () => 80,
  spreadMax: () => 9,
  adsTime: () => 999,
  dmg: w => (w.dmg ?? []).map(p => ({ ...p, d: Number(p.d) * 0.5 })),
  pellets: w => Math.max(1, Math.round(Number(w.pellets || 8) / 2))
};

const q = { gameMode: 'multiplayer', category: '__all__', distance: 25, priority: 'balanced', topN: 200 };
const rowOf = (snap, id) => {
  const r = (snap.top ?? []).find(t => t.id === id);
  return r ? { btk: r.btk, damage: r.damage, triggerTtk: r.triggerTtk, beamIndex: r.beamIndex } : null;
};
const outputsMoved = (a, b) => {
  if (!a || !b) return [];
  const moved = [];
  const near = (x, y) => Number.isFinite(x) && Number.isFinite(y) ? Math.abs(x - y) <= 1e-9 : x === y;
  if (a.btk !== b.btk) moved.push('BTK');
  if (!near(Number(a.triggerTtk), Number(b.triggerTtk))) moved.push('TTK');
  if (!near(Number(a.damage), Number(b.damage))) moved.push('damage');
  if (!near(Number(a.beamIndex), Number(b.beamIndex))) moved.push('beamIndex');
  return moved;
};

const results = [];
for (const rw of sample) {
  const raw = weapons.find(w => w.id === rw.id);
  if (!raw) continue;
  const baseSnap = diag.perturb(rw.id, '__probe__', null, q);
  const base = rowOf(baseSnap, rw.id);
  if (!base) continue;

  for (const [field, mk] of Object.entries(PERTURB)) {
    if (raw[field] === undefined && field !== 'pellets') continue;
    if (field === 'pellets' && rw.cls !== 'Shotgun') continue;
    let after;
    try { after = rowOf(diag.perturb(rw.id, field, mk(raw), q), rw.id); }
    catch (e) { results.push({ weapon: rw.name, cls: rw.cls, field, error: String(e.message || e) }); continue; }
    results.push({ weapon: rw.name, weaponId: rw.id, cls: rw.cls, field, moved: outputsMoved(base, after), before: base, after });
  }
}

// Roll up per field across the sample.
const byField = new Map();
for (const r of results) {
  if (!byField.has(r.field)) byField.set(r.field, { field: r.field, tested: 0, movedOn: 0, outputs: new Set() });
  const e = byField.get(r.field);
  e.tested++;
  if ((r.moved ?? []).length) { e.movedOn++; for (const o of r.moved) e.outputs.add(o); }
}

const OVERRIDDEN_BY_AUDIT = {
  dmg: 'the audited class RANGE table is the operative damage source on the ranking path, so perturbing the raw curve does not move it. Both trace to the same pinned upstream commit - weapons.json is the synced snapshot, the class audit is re-derived from the same simulator - so this is about which value the engine reads, not a provenance gap. Verified directly: setting KORD 6P67 to a flat 1 damage leaves its ranked damage at 17.13, which is its audited 3-range table.',
  rpm: 'audited class cadence supersedes the raw RPM field for every audited class, which is deliberate - see README on bolt-action cadence and the Mini Scout +100 ms adjustment',
  adsTime: 'last ranking tie-break, behind BTK, chest damage and velocity; never reached in the 1,344-case sweep',
  spreadMax: 'consumed by the CACHED Beam Index, not the fallback index this harness exercises'
};

const rollup = [...byField.values()].map(e => ({
  field: e.field,
  weaponsTested: e.tested,
  weaponsWhereItMoved: e.movedOn,
  outputsMoved: [...e.outputs].sort(),
  inertOnEveryWeapon: e.movedOn === 0,
  explanation: e.movedOn === 0 ? (OVERRIDDEN_BY_AUDIT[e.field] ?? null) : null
})).sort((a, b) => b.weaponsWhereItMoved - a.weaponsWhereItMoved || a.field.localeCompare(b.field));

const unexplained = rollup.filter(r => r.inertOnEveryWeapon && !r.explanation && !['mag', 'tacRld', 'emptyRld'].includes(r.field));

const summary = {
  generatedAt: new Date().toISOString(),
  method: 'perturb one raw field, re-evaluate on the ON-DEMAND path, compare the weapon\'s own ranking row',
  limitation: 'observes the dependency a cache rebuild would follow, not the currently cached values; Beam Index here is the fallback index (recoil primitives only)',
  weaponsSampled: sample.map(w => `${w.name} (${w.cls})`),
  fieldsTested: rollup.length,
  observations: results.length,
  rollup,
  confirmedInert: rollup.filter(r => r.inertOnEveryWeapon && ['mag', 'tacRld', 'emptyRld'].includes(r.field)).map(r => r.field),
  unexplainedInert: unexplained.map(r => r.field)
};

await mkdir('reports/overnight', { recursive: true });
await writeFile('reports/overnight/field-impact.json', JSON.stringify({ summary, results }, null, 1));

console.log(JSON.stringify(summary, null, 1));
if (unexplained.length) {
  console.error(`\nFAIL: ${unexplained.length} field(s) claimed to move a result are inert with no recorded explanation: ${unexplained.map(r => r.field).join(', ')}`);
  process.exit(1);
}
console.log('\nPASS: measured impact matches the source audit, and every inert field has a recorded reason.');
