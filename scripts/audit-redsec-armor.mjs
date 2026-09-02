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

/** Independent re-implementation of the application's curve semantics. */
function damageAt(raw, curve, d) {
  const pts = curve
    .map((p, i) => ({ r: Number(p.r), d: Number(p.d), i }))
    .filter(p => Number.isFinite(p.r) && Number.isFinite(p.d))
    .sort((a, b) => a.r - b.r || a.i - b.i);
  if (!pts.length) return null;
  const source = String(raw?.damageSource || '');
  const linear = /linear/i.test(source);
  const oneMeterBlend = /1\s*m\s*blend/i.test(source);
  if (linear || oneMeterBlend) {
    if (d <= pts[0].r) return pts[0].d;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (d <= b.r) {
        if (b.r === a.r) return b.d;
        if (oneMeterBlend && (b.r - a.r) > 1.01) return a.d;
        const t = (d - a.r) / (b.r - a.r);
        return a.d + (b.d - a.d) * Math.max(0, Math.min(1, t));
      }
    }
    return pts.at(-1).d;
  }
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

function armorMultiplier(raw) {
  const groups = model.damageVsArmor.chestMultipliers || {};
  for (const rec of Object.values(groups)) {
    if (Array.isArray(rec?.classes) && rec.classes.includes(raw.cls)) return Number(rec.value);
  }
  return 1;
}

function alignedCarbineDamage(raw) {
  const cfg = model.damageVsArmor.carbineCloseRangeAlignment?.weaponOverrides?.[raw.id];
  if (!cfg?.referenceWeaponId) return null;
  const ref = weapon(cfg.referenceWeaponId);
  if (!ref?.dmg?.length) return null;
  const first = Number(ref.dmg[0].d);
  const changed = ref.dmg.find(p => Number(p.d) !== first);
  return changed ? Number(changed.d) : null;
}

/** Independent re-implementation of the two documented armour transforms. */
function armorCurve(raw, closeRange = model.damageVsArmor.removeFirstCloseRangeStep.policy, effectiveFireMode = raw.fireMode) {
  const shift = Number(model.damageVsArmor.rangeShiftMeters.value);
  let pts = raw.dmg.map(p => ({ r: Number(p.r), d: Number(p.d) }));
  const rule = model.damageVsArmor.removeFirstCloseRangeStep;
  if (closeRange === 'remove' && rule.appliesToFireModes.includes(effectiveFireMode)) {
    const first = pts[0].d;
    const changeAt = pts.findIndex(p => p.d !== first);
    if (changeAt > 0) {
      pts = pts.slice(changeAt);
      const aligned = alignedCarbineDamage(raw);
      if (Number.isFinite(aligned) && pts.length) {
        const ownFirst = pts[0].d;
        pts = pts.map(p => p.d === ownFirst ? { ...p, d: aligned } : p);
      }
    }
  }
  const shifted = pts.map(p => ({ r: Math.max(0, p.r + shift), d: p.d }));
  if (shifted[0].r > 0) shifted.unshift({ r: 0, d: shifted[0].d });
  return shifted;
}

const armorDmg = (raw, d, effectiveFireMode = raw.fireMode) => damageAt(raw, armorCurve(raw, undefined, effectiveFireMode), d) * Math.max(1, Number(raw.pellets) || 1) * armorMultiplier(raw);
const healthDmg = (raw, d) => damageAt(raw, raw.dmg, d) * Math.max(1, Number(raw.pellets) || 1);

/** Shot-by-shot, no spillover, exactly as data/redsec-model.json records. */
function armoredBtk(raw, d, totalArmorHp, effectiveFireMode = raw.fireMode) {
  const a = armorDmg(raw, d, effectiveFireMode), h = healthDmg(raw, d);
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
eq('automatic-primary current chest-vs-armour multiplier', model.damageVsArmor.chestMultipliers?.automaticPrimary?.value, 0.84);
eq('DMR current chest-vs-armour multiplier', model.damageVsArmor.chestMultipliers?.dmr?.value, 0.91);
eq('Sniper Rifle current chest-vs-armour multiplier', model.damageVsArmor.chestMultipliers?.sniper?.value, 0.67);
if (model.damageVsArmor.chestMultipliers?.automaticPrimary?.confidence !== 'verified-current') errors.push('automatic 0.84x armour multiplier is not marked verified-current');
if (model.damageVsArmor.chestMultipliers?.dmr?.confidence !== 'verified-current') errors.push('DMR 0.91x armour multiplier is not marked verified-current');
if (model.damageVsArmor.chestMultipliers?.sniper?.confidence !== 'verified-current') errors.push('sniper 0.67x armour multiplier is not marked verified-current');
if (!model.sources?.some(s => s.id === 'ea-bf6-update-1.3.3.0')) errors.push('1.3.3.0 authoritative multiplier source is missing from provenance');
if (model.soldierHealth.sameAsMultiplayer !== true) errors.push('model no longer reuses the Multiplayer health path');
if (model.soldierHealth.confidence !== 'verified') errors.push('soldier-health equality with Multiplayer is stated directly by EA and should not be recorded as unresolved');
if ((model.unresolved || []).some(u => /soldier base health/i.test(u.mechanic))) errors.push('soldier health is still listed as unresolved while also being reused as verified: contradictory provenance');
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
  eq('semi-auto keeps its close-range max damage step before class multiplier', damageAt(dmr, armorCurve(dmr), 0), Number(dmr.dmg[0].d));
  eq('DMR chest-vs-armour multiplier', armorMultiplier(dmr), 0.91);
  eq('M39 EMR 0m armour damage applies 0.91x', armorDmg(dmr, 0), Number(dmr.dmg[0].d) * 0.91);
}

// --- 3. Rule B: automatic weapons drop the leading step --------------------
const rpkm = weapon('rpkm');
if (!rpkm) errors.push('rpkm missing');
else {
  eq('rpkm is automatic', rpkm.fireMode, 'auto');
  // Health curve: 35.22 to 9m, 27.48 to 21m, 21.56 to 36m, 20.67 to 75m, 17.13 beyond.
  // Armour curve: leading 35.22 step removed, remaining boundaries +10m.
  eq('automatic-primary chest-vs-armour multiplier', armorMultiplier(rpkm), 0.84);
  eq('rpkm armour damage at 0m', armorDmg(rpkm, 0), 27.48 * 0.84);
  eq('rpkm armour damage at 25m', armorDmg(rpkm, 25), 27.48 * 0.84);
  eq('rpkm armour damage at 31m (boundary, outgoing tier)', armorDmg(rpkm, 31), 27.48 * 0.84);
  eq('rpkm armour damage at 32m (past boundary)', armorDmg(rpkm, 32), 21.56 * 0.84);
  eq('rpkm armour damage at 46m', armorDmg(rpkm, 46), 21.56 * 0.84);
  eq('rpkm armour damage at 47m', armorDmg(rpkm, 47), 20.67 * 0.84);
  eq('rpkm armour damage at 86m', armorDmg(rpkm, 86), 17.13 * 0.84);
  // The leading health step must be untouched.
  eq('rpkm health damage at 5m is unchanged', healthDmg(rpkm, 5), 35.22);
}

// --- 3b. EA's explicit 7.62x39 Carbine alignment exception ----------------
const sg553r = weapon('sg553r');
if (!sg553r || !rpkm) errors.push('sg553r/rpkm missing for Carbine alignment fixture');
else {
  const nonCarbineSecond = 27.48;
  eq('SG553R current health second tier remains its own lower value', healthDmg(sg553r, 10), 26.05);
  eq('SG553R aligned pre-multiplier close armour tier', damageAt(sg553r, armorCurve(sg553r), 0), nonCarbineSecond);
  eq('SG553R aligned current close armour damage', armorDmg(sg553r, 0), nonCarbineSecond * 0.84);
  eq('SG553R drops back to its own later Carbine tier after aligned close band', armorDmg(sg553r, 32), 20.67 * 0.84);
}

// --- 3c. Build-level fire-mode transforms reach the close-range rule --------
const m16 = weapon('m16a4');
if (!m16) errors.push('m16a4 missing');
else {
  eq('M16A4 base fire mode is burst', m16.fireMode, 'burst');
  // Base burst mode: no close-range flattening. A3 Receiver build: full auto,
  // so the same raw weapon must take the automatic REDSEC close-range rule.
  eq('M16 base burst keeps leading armour tier', armorDmg(m16, 10, 'burst'), 26.05 * 0.84);
  eq('M16 A3 full-auto applies close-range flattening', armorDmg(m16, 10, 'auto'), 20.67 * 0.84);
}

// --- 3d. Sniper multiplier and sweet-spot confidence guard -----------------
const sv98 = weapon('sv98');
if (!sv98) errors.push('sv98 missing');
else {
  eq('sniper chest-vs-armour multiplier', armorMultiplier(sv98), 0.67);
  const sweet = model.unresolved.find(u => /sweet-spot/i.test(u.mechanic));
  if (!sweet) errors.push('sniper sweet-spot REDSEC range geometry is not recorded as unresolved');
  if (sweet?.implementedPolicy !== 'shift-all-control-points') errors.push('sniper sweet-spot implemented policy changed without provenance update');
}

// --- 4. Shot-by-shot BTK, hand computed ------------------------------------
if (rpkm) {
  const r = armoredBtk(rpkm, 25, br.totalHp);
  eq('rpkm@25m shots to break 80 HP armour', r.shotsToBreakArmor, 4);   // ceil(80/(27.48*.84))=4
  eq('rpkm@25m health BTK', r.healthBtk, 5);                            // ceil(100/21.56)=5
  eq('rpkm@25m total BTK', r.btk, 9);

  // Armour exactly depleted with no remainder must not cost an extra shot.
  const exact = { ...rpkm, cls: 'Sidearm', dmg: [{ r: 0, d: 40 }, { r: 300, d: 40 }], fireMode: 'semi' };
  eq('armour exactly depleted by 2 shots of 40', armoredBtk(exact, 10, 80).shotsToBreakArmor, 2);
  const justOver = { ...rpkm, cls: 'Sidearm', dmg: [{ r: 0, d: 41 }, { r: 300, d: 41 }], fireMode: 'semi' };
  eq('41 damage still needs 2 shots for 80 armour', armoredBtk(justOver, 10, 80).shotsToBreakArmor, 2);
  const justUnder = { ...rpkm, cls: 'Sidearm', dmg: [{ r: 0, d: 39 }, { r: 300, d: 39 }], fireMode: 'semi' };
  eq('39 damage needs 3 shots for 80 armour', armoredBtk(justUnder, 10, 80).shotsToBreakArmor, 3);

  // Zero armour must collapse to the Multiplayer BTK exactly.
  eq('zero armour equals multiplayer BTK', armoredBtk(rpkm, 25, 0).btk, Math.ceil(100 / healthDmg(rpkm, 25)));
}

// --- 4b. EA's published worked example must reproduce exactly ---------------
// EA give one calibre example. The transform is validated against THEIR numbers
// rather than the repository's pinned snapshot, which is a different balance
// state; this checks the rule, not the data.
const fx = model.transformFixture;
if (!fx) errors.push('transform fixture (EA worked example) is missing');
else {
  const fake = { dmg: fx.healthCurve.map(([r, d]) => ({ r, d })), fireMode: fx.fireMode, pellets: 1, damageSource: 'stepped fixture' };
  const curve = armorCurve(fake);
  eq('EA historical example: transformed pre-multiplier armour damage at 0m', damageAt(fake, curve, 0), fx.expectedArmorFirstStepDamage);
  eq('EA historical example: transformed pre-multiplier armour damage at 30m', damageAt(fake, curve, 30), fx.expectedArmorFirstStepDamage);
  const boundaries = [...new Set(curve.map(p => p.r))].filter(r => r > 0).sort((a, b) => a - b);
  for (const b of fx.expectedArmorBreakpointsM) {
    if (!boundaries.includes(b)) errors.push(`EA example: expected armour breakpoint ${b}m, got [${boundaries.join(', ')}]`);
  }
  // The health curve itself must be untouched by the armour transform.
  eq('EA historical example: health damage at 5m unchanged', damageAt(fake, fake.dmg, 5), 33.4);
}

// --- 4c. Generalisation scope must stay honestly recorded -------------------
const scope = model.damageVsArmor.removeFirstCloseRangeStep.generalisationScope;
if (!scope) errors.push('close-range rule does not record how far it is generalised');
else {
  if (scope.confidence !== 'derived') errors.push('close-range rule must remain DERIVED until per-calibre armour data exists');
  const autos = weapons.filter(w => w.fireMode === 'auto' && Array.isArray(w.dmg) && w.dmg.length &&
    w.dmg.findIndex(p => Number(p.d) !== Number(w.dmg[0].d)) > 0);
  eq('recorded weapon count matches the data', scope.appliedToWeapons, autos.length);
  eq('recorded calibre count matches the data', scope.appliedToCalibers, new Set(autos.map(w => w.cal)).size);
}

// --- 4d. The recorded manual test must still match the current model -------
// The verified 1.3.3.0 multipliers silently invalidated an earlier recorded
// test case. Recompute the documented predictions so a future model change can
// never leave the published in-game procedure quietly wrong again.
const spillTest = model.spilloverResolutionTest;
if (!spillTest) errors.push('spillover resolution test procedure is missing');
else {
  for (const key of ['primaryCase', 'highContrastCase']) {
    const c = spillTest[key];
    if (!c?.weaponId) { errors.push(`${key} has no weaponId to verify against`); continue; }
    const raw = weapon(c.weaponId);
    if (!raw) { errors.push(`${key} references unknown weapon ${c.weaponId}`); continue; }
    const dTest = Number(String(c.distanceM).match(/\d+/)?.[0]);
    const a = armorDmg(raw, dTest), h = healthDmg(raw, dTest);
    eq(`${key} recorded armour damage/shot`, a, Number(c.modelledArmorDamagePerShot), 0.01);
    eq(`${key} recorded health damage/shot`, h, Number(c.modelledHealthDamagePerShot), 0.01);
    const brk = Math.ceil(Number(model.armor.battleRoyale.totalHp) / a);
    eq(`${key} recorded shots to break armour`, brk, Number(c.shotsToBreakArmor));
    const noSpill = brk + Math.ceil(100 / h);
    const carried = h * ((brk * a - Number(model.armor.battleRoyale.totalHp)) / a);
    const prop = brk + Math.ceil((100 - carried) / h);
    eq(`${key} predicted no-spillover total`, noSpill, Number(c.predictedTotalShots?.noSpillover));
    eq(`${key} predicted proportional-spillover total`, prop, Number(c.predictedTotalShots?.proportionalSpillover));
    if (noSpill === prop) errors.push(`${key} no longer distinguishes the two spillover models (${noSpill} shots either way); the procedure is useless as written`);
    // A test weapon must not invoke the derived close-range rule or a sweet-spot curve.
    if (model.damageVsArmor.removeFirstCloseRangeStep.appliesToFireModes.includes(raw.fireMode)) errors.push(`${key} uses ${raw.fireMode} fire mode, which invokes the unresolved close-range rule and confounds the spillover test`);
    if (/sweet-spot/i.test(String(raw.damageSource || ''))) errors.push(`${key} uses a sweet-spot curve, which confounds the spillover test`);
  }
}

// --- 5. REDSEC must not be a generic extra-health pool ---------------------
// This is the test that fails if someone later "simplifies" 2 plates into 180 HP.
let differentFromGeneric = 0, swept = 0;
for (const raw of weapons.filter(w => Array.isArray(w.dmg) && w.dmg.length && w.cls !== 'Secondary')) {
  for (const d of [10, 25, 37, 50, 83, 100, 150]) {
    const r = armoredBtk(raw, d, br.totalHp);
    if (!r) continue;
    swept++;
    const genericBtk = Math.ceil((100 + br.totalHp) / r.healthPerShot);
    if (r.btk !== genericBtk) differentFromGeneric++;
  }
}
if (differentFromGeneric === 0) errors.push('no case distinguishes the two-layer model from a generic 180 HP pool; the anti-simplification test is not meaningful');
if (dmr) {
  const r = armoredBtk(dmr, 40, br.totalHp);
  const genericBtk = Math.ceil((100 + br.totalHp) / r.healthPerShot);
  if (r.btk === genericBtk) errors.push(`m39emr@40m two-layer BTK (${r.btk}) collapses to the generic 180 HP result (${genericBtk}); armour damage is not being modelled separately`);
}

// --- 6. Application wiring -------------------------------------------------
const need = [
  ['function armorChestMultiplier(raw)', 'current class-specific chest-vs-armour multiplier path missing'],
  ['function alignedCarbineCloseRangeDamage(raw)', 'EA Carbine close-range alignment exception missing'],
  ['function armorDamageCurve(raw, closeRange', 'armour curve derivation missing'],
  ['function redsecArmoredCombat(raw, d, opts = {})', 'shot-by-shot armour model missing'],
  ['function redsecDependencies(raw, d, combatRow)', 'per-result confidence analysis missing'],
  ['const REDSEC_INTERPRETATIONS', 'supported alternative interpretations are not declared'],
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
console.log(`REDSEC ARMOUR PASS • ${br.plates} plates x ${br.hpPerPlate} HP = ${br.totalHp} HP • +${model.damageVsArmor.rangeShiftMeters.value}m armour range shift • current chest multipliers auto ${model.damageVsArmor.chestMultipliers.automaticPrimary.value}x / DMR ${model.damageVsArmor.chestMultipliers.dmr.value}x / sniper ${model.damageVsArmor.chestMultipliers.sniper.value}x • SG553R Carbine alignment gated • shot-by-shot two-layer model • ${differentFromGeneric}/${swept} swept cases differ from a generic 180 HP pool • armoured confidence: ${model.confidence.redsecArmored}`);
