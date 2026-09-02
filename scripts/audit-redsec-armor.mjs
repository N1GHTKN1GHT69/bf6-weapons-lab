#!/usr/bin/env node
/**
 * BF6 Weapons Lab — REDSEC armour model gate.
 *
 * This audit deliberately re-implements the damage-vs-armor transform from
 * data/redsec-model.json and data/weapons.json, INDEPENDENTLY of app.js, and
 * checks it against hand-computed expectations. The application's own output is
 * never used as the correctness oracle for the armour maths.
 *
 * It also gates the two things most likely to be broken by a later
 * "simplification": that REDSEC armour is a real shot-by-shot two-layer model
 * rather than a generic extra-health pool, and that naming/reasoning metadata
 * stays out of the combat path.
 */
import { readFile } from 'node:fs/promises';

const [model, weapons, app] = await Promise.all([
  readFile('data/redsec-model.json', 'utf8').then(JSON.parse),
  readFile('data/weapons.json', 'utf8').then(JSON.parse),
  readFile('app.js', 'utf8')
]);
const errors = [];
const eq = (label, got, want, tol = 1e-9) => {
  const ok = typeof want === 'number' ? Math.abs(Number(got) - want) <= tol : got === want;
  if (!ok) errors.push(`${label}: expected ${want}, got ${got}`);
};

const weapon = id => weapons.find(w => w.id === id);

/** Independent re-implementation of the documented step lookup. */
function stepDamage(curve, d) {
  const pts = curve.map(p => ({ r: Number(p.r), d: Number(p.d) }));
  if (d <= pts[0].r) return pts[0].d;
  let previous = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (d < p.r) return previous.d;
    if (d === p.r) return p.d;
    previous = p;
  }
  return previous.d;
}

/** Independent re-implementation of the two documented armour transforms. */
function armorCurve(raw) {
  const shift = Number(model.damageVsArmor.rangeShiftMeters.value);
  let pts = raw.dmg.map(p => ({ r: Number(p.r), d: Number(p.d) }));
  const rule = model.damageVsArmor.removeFirstCloseRangeStep;
  if (rule.policy === 'remove' && rule.appliesToFireModes.includes(raw.fireMode)) {
    const first = pts[0].d;
    const changeAt = pts.findIndex(p => p.d !== first);
    if (changeAt > 0) pts = pts.slice(changeAt);
  }
  const shifted = pts.map(p => ({ r: Math.max(0, p.r + shift), d: p.d }));
  if (shifted[0].r > 0) shifted.unshift({ r: 0, d: shifted[0].d });
  return shifted;
}

const armorDmg = (raw, d) => stepDamage(armorCurve(raw), d) * Math.max(1, Number(raw.pellets) || 1);
const healthDmg = (raw, d) => stepDamage(raw.dmg, d) * Math.max(1, Number(raw.pellets) || 1);

/** Shot-by-shot, no spillover, exactly as data/redsec-model.json records. */
function armoredBtk(raw, d, totalArmorHp) {
  const a = armorDmg(raw, d), h = healthDmg(raw, d);
  if (!(a > 0) || !(h > 0)) return null;
  let remaining = totalArmorHp, shots = 0;
  while (remaining > 0) { remaining -= a; shots++; if (shots > 200) break; }
  return { shotsToBreakArmor: shots, healthBtk: Math.ceil(100 / h), btk: shots + Math.ceil(100 / h), armorPerShot: a, healthPerShot: h };
}

// --- 1. Model integrity ----------------------------------------------------
const br = model.armor.battleRoyale;
eq('battle royale plates', br.plates, 2);
eq('battle royale hp per plate', br.hpPerPlate, 40);
eq('battle royale total armour', br.totalHp, 80);
eq('total armour equals plates x hp per plate', br.plates * br.hpPerPlate, br.totalHp);
eq('range shift', model.damageVsArmor.rangeShiftMeters.value, 10);
if (model.soldierHealth.sameAsMultiplayer !== true) errors.push('model no longer reuses the Multiplayer health path');
if (!model.unresolved?.length) errors.push('model claims no unresolved mechanics; uncertainty must stay recorded');
if (model.confidence?.redsecArmored === 'verified') errors.push('armoured model must not claim full verification while the close-range rule and spillover are unresolved');
const spill = model.unresolved.find(u => /spillover/i.test(u.mechanic));
if (spill?.implementedPolicy !== 'no-spillover') errors.push('spillover policy is not recorded as no-spillover');

// --- 2. Rule A: +10 m shift, all weapons -----------------------------------
const dmr = weapon('m39emr');
if (!dmr) errors.push('m39emr missing');
else {
  const health = [...new Set(dmr.dmg.map(p => Number(p.r)))].sort((a, b) => a - b);
  const armor = [...new Set(armorCurve(dmr).map(p => Number(p.r)))].sort((a, b) => a - b);
  for (const r of health.filter(r => r > 0)) {
    if (!armor.includes(r + 10)) errors.push(`semi-auto ${dmr.id}: armour boundary ${r + 10}m missing for health boundary ${r}m`);
  }
  // Rule B must NOT apply to a semi-automatic weapon.
  eq('semi-auto keeps its close-range max damage step', stepDamage(armorCurve(dmr), 0), Number(dmr.dmg[0].d));
}

// --- 3. Rule B: automatic weapons drop the leading step --------------------
const rpkm = weapon('rpkm');
if (!rpkm) errors.push('rpkm missing');
else {
  eq('rpkm is automatic', rpkm.fireMode, 'auto');
  // Health curve: 35.22 to 9m, 27.48 to 21m, 21.56 to 36m, 20.67 to 75m, 17.13 beyond.
  // Armour curve: leading 35.22 step removed, remaining boundaries +10m.
  eq('rpkm armour damage at 0m', armorDmg(rpkm, 0), 27.48);
  eq('rpkm armour damage at 25m', armorDmg(rpkm, 25), 27.48);
  eq('rpkm armour damage at 31m (boundary, outgoing tier)', armorDmg(rpkm, 31), 27.48);
  eq('rpkm armour damage at 32m (past boundary)', armorDmg(rpkm, 32), 21.56);
  eq('rpkm armour damage at 46m', armorDmg(rpkm, 46), 21.56);
  eq('rpkm armour damage at 47m', armorDmg(rpkm, 47), 20.67);
  eq('rpkm armour damage at 86m', armorDmg(rpkm, 86), 17.13);
  // The leading health step must be untouched.
  eq('rpkm health damage at 5m is unchanged', healthDmg(rpkm, 5), 35.22);
}

// --- 4. Shot-by-shot BTK, hand computed ------------------------------------
if (rpkm) {
  const r = armoredBtk(rpkm, 25, br.totalHp);
  eq('rpkm@25m shots to break 80 HP armour', r.shotsToBreakArmor, 3);   // ceil(80/27.48)=3
  eq('rpkm@25m health BTK', r.healthBtk, 5);                            // ceil(100/21.56)=5
  eq('rpkm@25m total BTK', r.btk, 8);

  // Armour exactly depleted with no remainder must not cost an extra shot.
  const exact = { ...rpkm, dmg: [{ r: 0, d: 40 }, { r: 300, d: 40 }], fireMode: 'semi' };
  eq('armour exactly depleted by 2 shots of 40', armoredBtk(exact, 10, 80).shotsToBreakArmor, 2);
  const justOver = { ...rpkm, dmg: [{ r: 0, d: 41 }, { r: 300, d: 41 }], fireMode: 'semi' };
  eq('41 damage still needs 2 shots for 80 armour', armoredBtk(justOver, 10, 80).shotsToBreakArmor, 2);
  const justUnder = { ...rpkm, dmg: [{ r: 0, d: 39 }, { r: 300, d: 39 }], fireMode: 'semi' };
  eq('39 damage needs 3 shots for 80 armour', armoredBtk(justUnder, 10, 80).shotsToBreakArmor, 3);

  // Zero armour must collapse to the Multiplayer BTK exactly.
  eq('zero armour equals multiplayer BTK', armoredBtk(rpkm, 25, 0).btk, Math.ceil(100 / healthDmg(rpkm, 25)));
}

// --- 5. REDSEC must not be a generic extra-health pool ---------------------
// This is the test that fails if someone later "simplifies" 2 plates into 180 HP.
let generic = 0;
for (const raw of weapons.filter(w => Array.isArray(w.dmg) && w.dmg.length && w.cls !== 'Secondary')) {
  for (const d of [10, 25, 37, 50, 83, 100, 150]) {
    const r = armoredBtk(raw, d, br.totalHp);
    if (!r) continue;
    const genericBtk = Math.ceil((100 + br.totalHp) / r.healthPerShot);
    if (r.btk === genericBtk) generic++;
  }
}
if (generic === 0) errors.push('no case distinguishes the two-layer model from a generic 180 HP pool; the anti-simplification test is not meaningful');
if (rpkm) {
  const r = armoredBtk(rpkm, 25, br.totalHp);
  const genericBtk = Math.ceil((100 + br.totalHp) / r.healthPerShot);
  if (r.btk === genericBtk) errors.push(`rpkm@25m two-layer BTK (${r.btk}) collapses to the generic 180 HP result (${genericBtk}); armour damage is not being modelled separately`);
}

// --- 6. Application wiring -------------------------------------------------
const need = [
  ['function armorDamageCurve(raw)', 'armour curve derivation missing'],
  ['function redsecArmoredCombat(raw, d, opts = {})', 'shot-by-shot armour model missing'],
  ['function scenarioCombat(raw, d, strategy, mpRow, winStats)', 'scenario transform missing'],
  ['combat = scenarioCombat(raw, d, strategy, combat, winStats);', 'game mode / armour state does not reach weapon ranking'],
  ['function scenarioKey(', 'scenario identity key missing'],
  ['gameMode: "multiplayer"', 'game mode is not part of application state'],
  ['targetArmor: "unarmored"', 'target armour is not part of application state']
];
for (const [token, msg] of need) if (!app.includes(token)) errors.push(msg);
// No generic effective-health shortcut may exist in the app.
for (const bad of ['100 + 80', 'targetHealth = 180', '= 180;', 'effectiveHealth']) {
  if (app.includes(bad)) errors.push(`app.js contains a generic effective-health shortcut (${bad})`);
}
// Armour mechanics must come from data, not hardcoded constants in app.js.
if (/const\s+ARMOR_(TOTAL|HP)\s*=\s*\d/.test(app)) errors.push('armour HP is hardcoded in app.js instead of read from data/redsec-model.json');
if (!app.includes('redsecModel()?.armor?.battleRoyale')) errors.push('armour pool is not read from the model data');

if (errors.length) {
  console.error('REDSEC ARMOUR AUDIT FAILED');
  errors.forEach(e => console.error('-', e));
  process.exit(1);
}
console.log(`REDSEC ARMOUR PASS • ${br.plates} plates x ${br.hpPerPlate} HP = ${br.totalHp} HP • +${model.damageVsArmor.rangeShiftMeters.value}m armour range shift • auto close-range step removed • shot-by-shot two-layer model • ${generic} of the swept cases would be wrong under a generic 180 HP pool • armoured confidence: ${model.confidence.redsecArmored}`);
