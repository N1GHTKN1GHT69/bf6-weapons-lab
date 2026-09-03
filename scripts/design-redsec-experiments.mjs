#!/usr/bin/env node
/**
 * REDSEC in-game experiment designer.
 *
 * Two mechanics EA never quantified still move this project's output:
 *
 *   CLOSE-RANGE  "we reduce or remove the very close-range maximum damage step
 *                 when calculating damage vs. armor" (automatic weapons only).
 *                 A = remove (implemented), B = keep.
 *   SPILLOVER     whether leftover damage on the armour-breaking shot carries
 *                 into health. A = none (implemented), B = proportional.
 *
 * This script searches the whole roster for the FEWEST in-game tests that
 * separate those readings unambiguously, and prints exactly what to shoot.
 *
 * A test is only admitted when the mechanic under test is the ONLY thing that
 * can explain the observed shot count:
 *
 *   - a close-range test must be insensitive to spillover
 *   - a spillover test must be insensitive to close-range (so: never a
 *     fireMode:auto weapon, since the close-range rule applies only to those)
 *   - never a sniper sweet-spot curve, whose REDSEC range geometry is itself
 *     unresolved
 *   - the prediction must hold over a wide distance band, so ranging error
 *     cannot flip the answer
 *
 * Predictions come from the production engine under each explicit
 * interpretation. Nothing here is hand-computed.
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { bootLab } from './lab-harness.mjs';

const { diag, window: win } = await bootLab();
const weapons = JSON.parse(await readFile('data/weapons.json', 'utf8'));
const roster = (win.BF6_CURRENT?.roster ?? []).filter(w => w.cls !== 'Secondary');

const MAX_D = 120;
const MAX_SHOTS = 14;          // beyond this, miscounting in a firefight is likely
const MIN_BAND = 6;            // metres of contiguous distance giving the same answer

const run = (id, d, closeRange, spillover) => {
  try { return diag.redsec.armored(id, d, 'plates2', { closeRange, spillover }); }
  catch { return null; }
};

/** All four interpretation combinations at one weapon/distance. */
function matrix(id, d) {
  const out = {};
  for (const cr of ['remove', 'keep']) {
    for (const sp of ['none', 'proportional']) {
      const r = run(id, d, cr, sp);
      if (!r) return null;
      out[`${cr}|${sp}`] = { btk: r.btk, brk: r.shotsToBreakArmor, health: r.healthBtk, aDmg: r.armorDamagePerShot };
    }
  }
  return out;
}

const closeRangeCandidates = [];
const spilloverCandidates = [];

for (const rw of roster) {
  const raw = weapons.find(w => w.id === rw.id);
  if (!raw) continue;
  const isAuto = raw.fireMode === 'auto';
  const isSniper = rw.cls === 'Sniper Rifle';
  if (isSniper) continue; // unresolved sweet-spot geometry would confound both tests

  for (let d = 1; d <= MAX_D; d++) {
    const m = matrix(rw.id, d);
    if (!m) continue;
    const A = m['remove|none'], B = m['keep|none'];
    const Asp = m['remove|proportional'], Bsp = m['keep|proportional'];

    // ---- CLOSE-RANGE test: only valid for automatic weapons ----
    if (isAuto) {
      const spilloverIrrelevant = A.btk === Asp.btk && B.btk === Bsp.btk;
      const separates = A.btk !== B.btk;
      if (spilloverIrrelevant && separates && Math.max(A.btk, B.btk) <= MAX_SHOTS) {
        closeRangeCandidates.push({
          id: rw.id, name: rw.name, cls: rw.cls, cal: raw.cal ?? null, d,
          rpm: Math.round(Number(raw.rpm) || 0),
          removeBtk: A.btk, removeBrk: A.brk, removeADmg: A.aDmg,
          keepBtk: B.btk, keepBrk: B.brk, keepADmg: B.aDmg,
          gap: Math.abs(A.btk - B.btk), maxShots: Math.max(A.btk, B.btk)
        });
      }
    }

    // ---- SPILLOVER test: never an automatic weapon, never a shotgun ----
    // Shotguns would otherwise dominate this list (one shot vastly overkills the
    // armour pool), but pellet spread and hit probability are deliberately not
    // modelled - an all-pellet hit is an idealisation, so a real trigger pull
    // would not reproduce the prediction.
    if (!isAuto && rw.cls !== 'Shotgun') {
      const closeRangeIrrelevant = A.btk === B.btk && Asp.btk === Bsp.btk;
      const separates = A.btk !== Asp.btk;
      if (closeRangeIrrelevant && separates && Math.max(A.btk, Asp.btk) <= MAX_SHOTS) {
        spilloverCandidates.push({
          id: rw.id, name: rw.name, cls: rw.cls, cal: raw.cal ?? null, d,
          rpm: Math.round(Number(raw.rpm) || 0),
          noneBtk: A.btk, propBtk: Asp.btk, brk: A.brk,
          // Fraction of the breaking shot's armour damage left unused. The larger
          // this is, the more starkly the two readings diverge.
          overkillPct: Math.round(100 * (A.brk * A.aDmg - 80) / A.aDmg),
          aDmg: A.aDmg, hDmg: run(rw.id, d, 'remove', 'none')?.healthDamagePerShot ?? null,
          gap: Math.abs(A.btk - Asp.btk), maxShots: Math.max(A.btk, Asp.btk)
        });
      }
    }
  }
}

/** Widen each candidate to the contiguous distance band giving the same answer. */
function bandFor(list, key) {
  const byWeapon = new Map();
  for (const c of list) {
    if (!byWeapon.has(c.id)) byWeapon.set(c.id, []);
    byWeapon.get(c.id).push(c);
  }
  const out = [];
  for (const [, rows] of byWeapon) {
    rows.sort((a, b) => a.d - b.d);
    let run = [rows[0]];
    const flush = () => {
      if (!run.length) return;
      const mid = run[Math.floor(run.length / 2)];
      out.push({ ...mid, bandMin: run[0].d, bandMax: run.at(-1).d, bandWidth: run.at(-1).d - run[0].d + 1 });
    };
    for (let i = 1; i < rows.length; i++) {
      const p = rows[i - 1], c = rows[i];
      const same = c.d === p.d + 1 && key(c) === key(p);
      if (same) run.push(c); else { flush(); run = [c]; }
    }
    flush();
  }
  return out;
}

const crBands = bandFor(closeRangeCandidates, c => `${c.removeBtk}/${c.keepBtk}`)
  .filter(b => b.bandWidth >= MIN_BAND)
  // Every discriminating case in the roster separates the readings by exactly ONE
  // shot - no larger gap exists anywhere. So the deciding factor is not the gap
  // but whether a human can COUNT it: lowest cadence first, then fewest shots,
  // then the widest distance band so ranging error cannot flip the answer.
  .sort((a, b) => a.rpm - b.rpm || a.maxShots - b.maxShots || b.bandWidth - a.bandWidth);

const spBands = bandFor(spilloverCandidates, c => `${c.noneBtk}/${c.propBtk}`)
  .filter(b => b.bandWidth >= MIN_BAND)
  .sort((a, b) => a.maxShots - b.maxShots || b.overkillPct - a.overkillPct || b.bandWidth - a.bandWidth);

/** Minimum set: best test per calibre, capped, so one result generalises. */
function minimumSet(bands, cap) {
  const seenCal = new Set(), out = [];
  for (const b of bands) {
    const cal = b.cal ?? b.id;
    if (seenCal.has(cal)) continue;
    seenCal.add(cal);
    out.push(b);
    if (out.length >= cap) break;
  }
  return out;
}

const crSet = minimumSet(crBands, 2);
const spSet = minimumSet(spBands, 2);

const report = {
  generatedAt: new Date().toISOString(),
  predictionsFrom: 'production engine (app.js) under explicit interpretation overrides, via scripts/lab-harness.mjs',
  closeRange: {
    question: 'EA: automatic weapons have the very close-range maximum damage step "reduced or removed" against armour. Removed is implemented.',
    interpretationA: 'remove — leading max-damage step dropped, second step applies from 0 m (implemented)',
    interpretationB: 'keep — leading step retained, +10 m range shift only',
    candidateTests: crBands.length,
    recommended: crSet
  },
  spillover: {
    question: 'Does leftover damage on the armour-breaking shot carry into health? No source states either way.',
    interpretationA: 'none — the breaking shot damages armour only (implemented)',
    interpretationB: 'proportional — the unused fraction of that shot carries into health',
    candidateTests: spBands.length,
    recommended: spSet
  }
};

await mkdir('reports/overnight', { recursive: true });
await writeFile('reports/overnight/redsec-experiments.json', JSON.stringify(report, null, 1));

const line = '-'.repeat(78);
console.log('\n' + line + '\nCLOSE-RANGE DISCRIMINATION TESTS  (' + crBands.length + ' viable found, ' + crSet.length + ' recommended)\n' + line);
for (const t of crSet) {
  console.log(`\n  ${t.name}  [${t.cls}, ${t.cal ?? 'calibre n/a'}]`);
  console.log(`    distance      ${t.bandMin}-${t.bandMax} m  (any metre in this band; use ${t.d} m)`);
  console.log(`    armour        2 plates, 80 HP, undamaged health`);
  console.log(`    ammo          Standard      body location  CHEST only`);
  console.log(`    cadence       ${t.rpm} rpm  (${Math.round(60000 / t.rpm)} ms between shots)`);
  console.log(`    A "removed"   ${t.removeBrk} shots to break armour, ${t.removeBtk} shots total   (armour dmg ${t.removeADmg.toFixed(2)})`);
  console.log(`    B "kept"      ${t.keepBrk} shots to break armour, ${t.keepBtk} shots total   (armour dmg ${t.keepADmg.toFixed(2)})`);
  console.log(`    OBSERVE       shots until the armour bar empties: ${t.removeBrk} = A, ${t.keepBrk} = B`);
  console.log(`    confirm       total shots to down: ${t.removeBtk} = A (current model), ${t.keepBtk} = B (model must change)`);
  console.log(`    or binary     fire exactly ${t.keepBtk}: target DEAD = B, target ALIVE = A`);
}
console.log('\n' + line + '\nSPILLOVER DISCRIMINATION TESTS  (' + spBands.length + ' viable found, ' + spSet.length + ' recommended)\n' + line);
for (const t of spSet) {
  console.log(`\n  ${t.name}  [${t.cls}, ${t.cal ?? 'calibre n/a'}]`);
  console.log(`    distance      ${t.bandMin}-${t.bandMax} m  (use ${t.d} m)`);
  console.log(`    armour        2 plates, 80 HP, undamaged health`);
  console.log(`    ammo          Standard      body location  CHEST only`);
  console.log(`    armour dmg    ${t.aDmg.toFixed(3)} / shot     health dmg ${t.hDmg == null ? 'n/a' : t.hDmg.toFixed(2)} / shot`);
  console.log(`    breaks armour after ${t.brk} shots`);
  console.log(`    A no spillover        ${t.noneBtk} shots total`);
  console.log(`    B proportional        ${t.propBtk} shots total`);
  console.log(`    overkill      ${t.overkillPct}% of the breaking shot's armour damage goes unused`);
  console.log(`    proves        ${t.noneBtk} = A (current model) | ${t.propBtk} = B (model must change)`);
  console.log(`    or binary     fire exactly ${t.propBtk}: target DEAD = B, target ALIVE = A`);
}
console.log('\nWritten: reports/overnight/redsec-experiments.json\n');
