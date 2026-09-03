#!/usr/bin/env node
/**
 * Advanced-options behaviour gate.
 *
 * MORE OPTIONS states: "Changes class/gadget recommendations only. Does not
 * change weapon damage or TTK." This executes the real engine and checks both
 * halves of that claim, rather than trusting the label:
 *
 *  - Player class and Loadout focus DO change the loadout recommendation
 *    (so neither control is dead)
 *  - and they change NOTHING in the combat model, ranking or attachment build
 *
 * Also checks that the controls that ARE meant to change combat actually do.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { bootLab } from './lab-harness.mjs';

const { diag } = await bootLab();
const errors = [];
const observations = [];

const combatSig = s => JSON.stringify({
  winner: s.weaponId, ranked: s.rankedCount,
  top: s.top.map(t => [t.id, t.btk, t.damage, t.triggerTtk, t.mechTtk, t.beamIndex]),
  build: s.build ? [s.build.points, s.build.exhaustive, s.build.picks.map(p => p.id)] : null
});
const loadoutSig = s => JSON.stringify(s.loadout);

const base = { gameMode: 'multiplayer', category: '__all__', distance: 25, priority: 'balanced', mode: 'auto' };

// --- Player class / Loadout focus: must move the loadout, never the combat ---
for (const [field, values] of [
  ['classChoice', ['auto', 'assault', 'engineer', 'support', 'recon']],
  ['context', ['mixed', 'infantry', 'objective', 'vehicles']]
]) {
  const combats = new Set(), loadouts = new Set();
  for (const v of values) {
    const s = diag.snapshot({ ...base, [field]: v });
    combats.add(combatSig(s));
    loadouts.add(loadoutSig(s));
  }
  observations.push({ control: field, values: values.length, distinctCombatResults: combats.size, distinctLoadouts: loadouts.size });
  if (combats.size !== 1) errors.push(`${field}: changes the combat model / ranking / build, but the UI states it does not (${combats.size} distinct combat results)`);
  if (loadouts.size < 2) errors.push(`${field}: dead control - every value produces the same loadout recommendation`);
}

// --- Controls that SHOULD change combat must actually change it ---
const mustMove = [
  { name: 'distance', a: { ...base, distance: 10 }, b: { ...base, distance: 150 } },
  { name: 'gameMode+armour', a: { ...base, gameMode: 'redsec', targetArmor: 'unarmored' }, b: { ...base, gameMode: 'redsec', targetArmor: 'plates2' } },
  { name: 'category', a: { ...base, category: '__all__' }, b: { ...base, category: 'SMG' } }
];
for (const c of mustMove) {
  const sa = combatSig(diag.snapshot(c.a)), sb = combatSig(diag.snapshot(c.b));
  if (sa === sb) errors.push(`${c.name}: changing this input did not change the combat result at all`);
  observations.push({ control: c.name, changesCombat: sa !== sb });
}

// --- PRIORITY: records what it actually does, and asserts it is not dead ---
{
  let movedBuild = 0, movedWinner = 0, cases = 0;
  for (const distance of [1, 10, 25, 50, 100, 150, 300]) {
    for (const [gameMode, targetArmor] of [['multiplayer', 'unarmored'], ['redsec', 'plates2']]) {
      const a = diag.snapshot({ ...base, gameMode, targetArmor, distance, priority: 'balanced' });
      const b = diag.snapshot({ ...base, gameMode, targetArmor, distance, priority: 'fastest' });
      cases++;
      if (JSON.stringify(a.build?.picks) !== JSON.stringify(b.build?.picks)) movedBuild++;
      if (a.weaponId !== b.weaponId) movedWinner++;
    }
  }
  observations.push({ control: 'priority', cases, casesWhereBuildChanged: movedBuild, casesWhereWinnerChanged: movedWinner });
  if (movedBuild === 0 && movedWinner === 0) errors.push('priority: dead control - neither the build nor the winner ever changes');
}

await mkdir('reports/overnight', { recursive: true });
await writeFile('reports/overnight/advanced-options.json', JSON.stringify({ generatedAt: new Date().toISOString(), observations, errors }, null, 1));

console.log('advanced options:');
for (const o of observations) console.log('  ' + JSON.stringify(o));
if (errors.length) { console.error('FAIL:\n' + errors.join('\n')); process.exit(1); }
console.log('PASS: no dead controls, and the advanced controls change only what they claim to change.');
