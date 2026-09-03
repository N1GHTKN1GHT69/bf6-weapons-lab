#!/usr/bin/env node
/**
 * Production-vs-independent cross-check of the REDSEC armour model and the
 * Multiplayer health BTK path.
 *
 * The production side is the REAL app.js, executed through scripts/lab-harness.mjs.
 * The reference side is scripts/redsec-reference.mjs, written from the JSON data
 * only. A disagreement is a genuine finding, not a tautology.
 *
 * Writes reports/overnight/engine-crosscheck.{json,csv}. Exits non-zero on any
 * mismatch or numeric anomaly.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import { bootLab } from './lab-harness.mjs';
import * as ref from './redsec-reference.mjs';

const DISTANCES = [1, 5, 9, 10, 11, 20, 21, 25, 30, 31, 35, 36, 37, 50, 60, 74, 75, 76, 83, 85, 100, 120, 150, 200, 250, 300];

const [model, weapons] = await Promise.all([
  readFile('data/redsec-model.json', 'utf8').then(JSON.parse),
  readFile('data/weapons.json', 'utf8').then(JSON.parse)
]);

const { diag, window: win } = await bootLab();
const roster = (win.BF6_CURRENT?.roster ?? []).filter(w => w.cls !== 'Secondary');

const rows = [];
const mismatches = [];
const anomalies = [];
const skipped = [];

const note = (list, o) => list.push(o);

for (const rw of roster) {
  const raw = weapons.find(w => w.id === rw.id);
  if (!raw) { note(skipped, { id: rw.id, name: rw.name, reason: 'no raw weapon entry in data/weapons.json' }); continue; }

  for (const d of DISTANCES) {
    let t;
    try { t = diag.redsecTrace(rw.id, d, 'plates2', 'fastest'); }
    catch (e) { note(anomalies, { id: rw.id, d, kind: 'trace-threw', detail: String(e?.message || e) }); continue; }

    if (!t?.armor) { note(skipped, { id: rw.id, name: rw.name, d, reason: 'production produced no armour model' }); continue; }

    const health = Number(t.health.damageAtDistance);
    const closeRange = t.armor.closeRangePolicy;
    const fireMode = t.fireMode.effective;
    const refArmor = ref.armorDamageAt(model, raw, weapons, d, closeRange, fireMode);
    const refRes = ref.armoredResolve({
      armorHp: t.armor.totalHp, armorDamage: refArmor,
      healthDamage: health, spillover: t.armor.spilloverPolicy
    });
    const refClosed = t.armor.spilloverPolicy === 'none' && refArmor > 0 && health > 0
      ? ref.closedFormBtk(t.armor.totalHp, refArmor, health) : null;

    const prodArmor = Number(t.armor.damagePerShot);
    const rec = {
      id: rw.id, name: rw.name, cls: rw.cls, d,
      fireMode, closeRange, spillover: t.armor.spilloverPolicy,
      mult: t.armor.chestMultiplier,
      healthDamage: health,
      prodArmorDamage: prodArmor, refArmorDamage: refArmor,
      prodBreak: t.armor.shotsToBreakArmor, refBreak: refRes?.shotsToBreakArmor ?? null,
      prodHealthShots: t.armor.healthShotsAfterBreak, refHealthShots: refRes?.healthBtk ?? null,
      prodBtk: t.btk, refBtk: refRes?.btk ?? null, refClosedFormBtk: refClosed,
      rpm: t.timing.rpm, triggerTtk: t.timing.triggerTtk, flightMs: t.timing.flightMs
    };
    rows.push(rec);

    const near = (a, b) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-6;
    if (!near(prodArmor, refArmor)) note(mismatches, { ...rec, field: 'armorDamagePerShot' });
    if (rec.prodBreak !== rec.refBreak) note(mismatches, { ...rec, field: 'shotsToBreakArmor' });
    if (rec.prodBtk !== rec.refBtk) note(mismatches, { ...rec, field: 'btk' });
    if (refClosed != null && refRes && refClosed !== refRes.btk) {
      note(mismatches, { ...rec, field: 'reference-internal (loop vs closed form)' });
    }

    // Numeric sanity on the production result.
    if (!Number.isFinite(t.btk) || t.btk <= 0) note(anomalies, { id: rw.id, d, kind: 'impossible-btk', value: t.btk });
    if (t.timing.triggerTtk != null && (!Number.isFinite(t.timing.triggerTtk) || t.timing.triggerTtk < 0)) {
      note(anomalies, { id: rw.id, d, kind: 'bad-trigger-ttk', value: t.timing.triggerTtk });
    }
    if (!Number.isFinite(prodArmor) || prodArmor <= 0) note(anomalies, { id: rw.id, d, kind: 'bad-armor-damage', value: prodArmor });
    if (t.armor.shotsToBreakArmor <= 0) note(anomalies, { id: rw.id, d, kind: 'zero-armor-shots', value: t.armor.shotsToBreakArmor });
  }
}

// Multiplayer / REDSEC-unarmored health path: btk must equal ceil(100/damage).
const mpRows = [];
for (const rw of roster) {
  for (const d of DISTANCES) {
    const t = diag.redsecTrace(rw.id, d, 'unarmored', 'fastest');
    const dmg = Number(t?.health?.damageAtDistance);
    if (!Number.isFinite(dmg) || dmg <= 0) { note(skipped, { id: rw.id, d, reason: 'no unarmored health damage' }); continue; }
    const expect = Math.ceil(100 / dmg);
    mpRows.push({ id: rw.id, name: rw.name, cls: rw.cls, d, damage: dmg, prodBtk: t.btk, refBtk: expect });
    if (t.btk !== expect) note(mismatches, { id: rw.id, name: rw.name, cls: rw.cls, d, field: 'unarmored-btk', prodBtk: t.btk, refBtk: expect, healthDamage: dmg });
  }
}

await mkdir('reports/overnight', { recursive: true });
const summary = {
  generatedAt: new Date().toISOString(),
  productionSource: 'app.js executed via scripts/lab-harness.mjs',
  referenceSource: 'scripts/redsec-reference.mjs (data-only, shares no code with app.js)',
  weapons: roster.length, distances: DISTANCES.length,
  armoredCases: rows.length, unarmoredCases: mpRows.length,
  totalComparisons: rows.length * 4 + mpRows.length,
  mismatches: mismatches.length, anomalies: anomalies.length, skipped: skipped.length,
  mismatchSample: mismatches.slice(0, 25),
  anomalySample: anomalies.slice(0, 25),
  skippedSample: skipped.slice(0, 25)
};
await writeFile('reports/overnight/engine-crosscheck.json', JSON.stringify({ summary, mismatches, anomalies, skipped }, null, 1));
const cols = ['id','name','cls','d','fireMode','closeRange','mult','healthDamage','prodArmorDamage','refArmorDamage','prodBreak','refBreak','prodBtk','refBtk','rpm','triggerTtk'];
await writeFile('reports/overnight/engine-crosscheck.csv',
  [cols.join(','), ...rows.map(r => cols.map(c => JSON.stringify(r[c] ?? '')).join(','))].join('\n'));

console.log(JSON.stringify(summary, null, 1));
if (mismatches.length || anomalies.length) { console.error(`\nFAIL: ${mismatches.length} mismatches, ${anomalies.length} anomalies`); process.exit(1); }
console.log('\nPASS: production engine agrees with the independent reference on every case.');
