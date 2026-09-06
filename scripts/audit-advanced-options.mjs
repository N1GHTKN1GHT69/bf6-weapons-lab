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
import { writeFile, mkdir, readFile } from 'node:fs/promises';
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

// --- Handling preferences must stay OUT of the DOM ---------------------------------
// stayAds / movingAds / stealth / bigMag steer the on-demand attachment optimizer. They
// are held in state precisely so that "the presence or absence of a UI control can never
// change optimizer behaviour" (app.js). Measured: flipping all four changes the
// recommended build on 0 of 4 probed weapons, because a valid cache short-circuits the
// on-demand path - so if a control for them were ever added to the UI, it would appear
// dead to the user while silently steering the next cache rebuild. That is the LATENT
// shape, and this assertion keeps it from arriving by accident.
{
  const app = await readFile('app.js', 'utf8');
  const html = await readFile('index.html', 'utf8');
  const PREFS = ['stayAds', 'movingAds', 'stealth', 'bigMag'];
  for (const p of PREFS) {
    if (new RegExp(`id=["']${p}["']`).test(html)) {
      errors.push(`${p}: a DOM control with this id exists. Handling preferences are engine defaults and are short-circuited by the exhaustive cache, so a user-facing control would look dead while still steering the next rebuild. Either wire it through the cache or do not present it.`);
    }
  }
  if (!app.includes('so that the presence or absence of a\n  // UI control can never change optimizer behaviour')) {
    observations.push({ control: 'handling-preferences', note: 'the design comment explaining why these are not DOM-driven has moved or been removed' });
  }
  observations.push({ control: 'handling-preferences', domControls: 0, heldInState: true, note: 'engine defaults, deliberately not user-facing' });
}

await mkdir('reports/overnight', { recursive: true });
await writeFile('reports/overnight/advanced-options.json', JSON.stringify({ generatedAt: new Date().toISOString(), observations, errors }, null, 1));

console.log('advanced options:');
for (const o of observations) console.log('  ' + JSON.stringify(o));
if (errors.length) { console.error('FAIL:\n' + errors.join('\n')); process.exit(1); }
console.log('PASS: no dead controls, and the advanced controls change only what they claim to change.');
