#!/usr/bin/env node
/**
 * Mode isolation + REDSEC auditability gate.
 *
 * Drives the REAL render pipeline through the headless harness and asserts:
 *  - MULTIPLAYER never receives REDSEC armour maths, panels or labels
 *  - REDSEC 2 PLATES states armour damage AND health damage, so the shot counts
 *    are checkable against the numbers on screen
 *  - the armour arithmetic shown is self-consistent
 *  - no stale state survives a mode/armour transition
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { bootLab } from './lab-harness.mjs';

const { diag, window: win } = await bootLab();
const errors = [];
const strip = h => String(h).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const num = (t, re) => { const m = strip(t).match(re); return m ? Number(m[1]) : NaN; };

const D = [10, 25, 50, 100, 150];

for (const d of D) {
  // ---- MULTIPLAYER must be free of REDSEC ----
  const mp = diag.render({ gameMode: 'multiplayer', category: '__all__', distance: d, priority: 'fastest', mode: 'auto' });
  if (strip(mp.armorSummary) !== '') errors.push(`MP ${d}m: armour summary rendered in Multiplayer`);
  if (strip(mp.armorShotLog) !== '') errors.push(`MP ${d}m: armour shot log rendered in Multiplayer`);
  if (/REDSEC|PLATES|ARMOUR|ARMOR/i.test(mp.scenarioChip)) errors.push(`MP ${d}m: scenario chip leaks REDSEC ("${mp.scenarioChip}")`);
  if (/REDSEC/i.test(mp.confidenceChip)) errors.push(`MP ${d}m: confidence chip leaks REDSEC ("${mp.confidenceChip}")`);

  // ---- REDSEC UNARMORED must reuse the Multiplayer health path ----
  const ru = diag.render({ gameMode: 'redsec', targetArmor: 'unarmored', category: '__all__', distance: d, priority: 'fastest', mode: 'auto' });
  if (strip(ru.armorSummary) !== '') errors.push(`REDSEC unarmored ${d}m: armour summary shown for an unarmored target`);
  if (!/REDSEC/i.test(ru.scenarioChip)) errors.push(`REDSEC unarmored ${d}m: scenario chip does not say REDSEC`);
  const mpSnap = diag.snapshot({ gameMode: 'multiplayer', category: '__all__', distance: d, priority: 'fastest', mode: 'auto' });
  const ruSnap = diag.snapshot({ gameMode: 'redsec', targetArmor: 'unarmored', category: '__all__', distance: d, priority: 'fastest', mode: 'auto' });
  if (mpSnap.top[0]?.id !== ruSnap.top[0]?.id || mpSnap.top[0]?.btk !== ruSnap.top[0]?.btk) {
    errors.push(`${d}m: REDSEC unarmored diverges from Multiplayer (${mpSnap.top[0]?.id}/${mpSnap.top[0]?.btk} vs ${ruSnap.top[0]?.id}/${ruSnap.top[0]?.btk}) — EA state health damage is unchanged`);
  }

  // ---- REDSEC 2 PLATES must be auditable on screen ----
  const raQuery = { gameMode: 'redsec', targetArmor: 'plates2', category: '__all__', distance: d, priority: 'fastest', mode: 'auto' };
  const ra = diag.render(raQuery);
  const winnerId = diag.snapshot(raQuery).weaponId;
  const s = strip(ra.armorSummary);
  if (s === '') { errors.push(`REDSEC 2 plates ${d}m: no armour summary rendered`); continue; }
  if (!/armour damage \/ shot/i.test(s)) errors.push(`REDSEC 2 plates ${d}m: armour damage per shot not shown — shot counts are unverifiable on screen`);
  if (!/health damage \/ shot/i.test(s)) errors.push(`REDSEC 2 plates ${d}m: health damage per shot not shown`);
  if (!/SPILLOVER:/i.test(s)) errors.push(`REDSEC 2 plates ${d}m: unresolved armour-break rule not surfaced`);

  const aDmg = num(s, /([\d.]+) armour damage/i);
  const hDmg = num(s, /([\d.]+) health damage/i);
  const aHp = num(s, /([\d.]+) HP armour/i);
  const brk = num(s, /(\d+) shots to break/i);
  const after = num(s, /(\d+) then shots/i);
  const total = num(s, /(\d+) total BTK/i);
  if ([aDmg, hDmg, aHp, brk, after, total].some(v => !Number.isFinite(v))) {
    errors.push(`REDSEC 2 plates ${d}m: armour summary is not machine-readable ("${s}")`);
    continue;
  }
  // The numbers on screen must justify the counts on screen.
  if (Math.ceil(aHp / aDmg) !== brk) errors.push(`REDSEC 2 plates ${d}m: ceil(${aHp}/${aDmg})=${Math.ceil(aHp / aDmg)} but panel claims ${brk} shots to break`);
  if (Math.ceil(100 / hDmg) !== after) errors.push(`REDSEC 2 plates ${d}m: ceil(100/${hDmg})=${Math.ceil(100 / hDmg)} but panel claims ${after} health shots`);
  if (brk + after !== total) errors.push(`REDSEC 2 plates ${d}m: ${brk}+${after} != ${total} total BTK`);
  // Armour damage may legitimately EXCEED health damage at some distances: EA
  // shift armour drop-off thresholds outward by 10 m, so between a health
  // drop-off and the armour one the armour curve is still on the higher tier.
  // KV9 at 25 m is the worked example - health 17.13, armour 20.67 x 0.84 =
  // 17.36. The correct invariant is therefore not a magnitude comparison but
  // provenance: armour damage must be a real step of this weapon's own health
  // curve, scaled by its class multiplier, and never an invented number.
  {
    const t = diag.redsecTrace(winnerId, d, 'plates2', 'fastest');
    const mult = Number(t?.armor?.chestMultiplier);
    const steps = (t?.health?.curve ?? []).map(p => Number(p.d)).filter(Number.isFinite);
    const pellets = Math.max(1, Number(t?.armor?.pellets) || 1);
    const perShot = Number(t?.armor?.damagePerShot);
    if (steps.length && Number.isFinite(mult) && Number.isFinite(perShot)) {
      const ok = steps.some(step => Math.abs(perShot - step * mult * pellets) <= 1e-6);
      if (!ok) errors.push(`REDSEC 2 plates ${d}m ${winnerId}: armour damage ${perShot} is not any health-curve step x ${mult} - value is not derived from the weapon's own curve`);
      const maxStep = Math.max(...steps);
      if (perShot > maxStep * mult * pellets + 1e-6) errors.push(`REDSEC 2 plates ${d}m ${winnerId}: armour damage ${perShot} exceeds max health step ${maxStep} x ${mult}`);
    }
  }
}

// ---- No stale state across transitions ----
{
  const seq = [
    { gameMode: 'redsec', targetArmor: 'plates2', distance: 25 },
    { gameMode: 'multiplayer', distance: 25 },
    { gameMode: 'redsec', targetArmor: 'plates2', distance: 25 }
  ];
  const out = seq.map(q => diag.render({ ...q, category: '__all__', priority: 'fastest', mode: 'auto' }));
  if (strip(out[1].armorSummary) !== '') errors.push('transition: armour summary survived the switch to Multiplayer');
  if (strip(out[0].armorSummary) !== strip(out[2].armorSummary)) errors.push('transition: returning to REDSEC 2 PLATES did not restore the same armour result');
  const a = diag.snapshot({ gameMode: 'redsec', targetArmor: 'plates2', category: '__all__', distance: 25, priority: 'fastest', mode: 'auto' });
  diag.snapshot({ gameMode: 'multiplayer', category: '__all__', distance: 300, priority: 'balanced', mode: 'auto' });
  const b = diag.snapshot({ gameMode: 'redsec', targetArmor: 'plates2', category: '__all__', distance: 25, priority: 'fastest', mode: 'auto' });
  if (a.top[0]?.id !== b.top[0]?.id || a.top[0]?.btk !== b.top[0]?.btk || a.scenario !== b.scenario) {
    errors.push(`cache contamination: same query gave ${a.top[0]?.id}/${a.top[0]?.btk} then ${b.top[0]?.id}/${b.top[0]?.btk}`);
  }
}

// ---- No silent render failures ----
// renderPrimaryBuild() catches every error and degrades to "no build". A fault
// there previously surfaced as a benign "exhaustive cache pending" label, so a
// crash looked like a data-freshness state. Every roster primary must build, in
// every mode, with no recorded build error.
{
  // Weapons the project deliberately keeps fail-closed: they are absent from the
  // trusted upstream source, so no build is produced on purpose. Pinned rather
  // than skipped, so a NEW unbuildable weapon is still a failure.
  const EXPECTED_NO_BUILD = new Set(['interdictor']);
  const roster = (win.BF6_CURRENT?.roster ?? []).filter(w => w.cls !== 'Secondary');
  const noBuild = new Set();
  for (const m of [{ gameMode: 'multiplayer' }, { gameMode: 'redsec', targetArmor: 'plates2' }]) {
    for (const rw of roster) {
      const r = diag.render({ ...m, category: '__all__', distance: 25, priority: 'fastest', mode: 'manual', weaponId: rw.id });
      if (r.buildError) errors.push(`${m.gameMode} ${rw.id}: build failed silently - ${r.buildError.message}`);
      if (/NO BUILD PRODUCED/.test(r.confidenceChip)) noBuild.add(rw.id);
    }
  }
  for (const id of noBuild) if (!EXPECTED_NO_BUILD.has(id)) errors.push(`${id}: unexpectedly produces no build`);
  for (const id of EXPECTED_NO_BUILD) if (!noBuild.has(id)) errors.push(`${id}: now builds - update EXPECTED_NO_BUILD`);
}

await mkdir('reports/overnight', { recursive: true });
await writeFile('reports/overnight/mode-isolation.json', JSON.stringify({ generatedAt: new Date().toISOString(), distances: D, errors }, null, 1));
console.log(`mode isolation: ${D.length} distances x 3 modes checked, plus transition and cache-contamination cases`);
if (errors.length) { console.error('FAIL:\n' + errors.join('\n')); process.exit(1); }
console.log('PASS: modes are isolated and every REDSEC armour count is justified by numbers shown on screen.');
