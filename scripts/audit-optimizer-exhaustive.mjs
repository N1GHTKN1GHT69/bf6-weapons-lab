#!/usr/bin/env node
/**
 * Optimizer validation.
 *
 * The production on-demand optimizer is a forward knapsack DP over slots. This
 * audit checks it against a TRUE EXHAUSTIVE Cartesian enumeration of every legal
 * attachment combination for every weapon whose search space is small enough to
 * enumerate outright, and against an independently written exact solver
 * (top-down, memoised, different traversal) for the rest. The exact solver is
 * itself validated against brute force on every case where both run, so the
 * larger cases are not resting on an unproven shortcut.
 *
 * It also checks legality of the shipped exhaustive cache winners, and whether
 * the cache builder and the on-demand optimizer agree about which attachments
 * are legal at all.
 *
 * Sampling is never called exhaustive: each row records which method was used.
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { bootLab } from './lab-harness.mjs';

// Cases at or below this are enumerated by TRUE brute force. --full raises it to
// infinity so every case is brute-forced (about 2.0 billion combinations, a few
// minutes); the default keeps the gate fast enough to run on every push while
// still brute-forcing the majority.
const FULL = process.argv.includes('--full');
const BRUTE_FORCE_LIMIT = FULL ? Infinity : 20000000;
const DISTANCES = [10, 25, 100];

const { diag, window: win } = await bootLab();
const cache = JSON.parse(await readFile('data/combat-cache.json', 'utf8'));
const cacheWeapons = cache.weapons ?? cache;

const roster = (win.BF6_CURRENT?.roster ?? []).filter(w => w.cls !== 'Secondary');
const errors = [], rows = [], optionErrors = [], divergence = [];

/** TRUE exhaustive: every combination, no pruning of any kind. */
function bruteForce(slots, budget) {
  let best = null, evaluated = 0;
  const names = Object.keys(slots);
  const idx = new Array(names.length).fill(0);
  const lens = names.map(s => slots[s].length);
  for (;;) {
    let pts = 0, score = 0;
    for (let i = 0; i < names.length; i++) {
      const o = slots[names[i]][idx[i]];
      pts += o.pts; score += o.score;
    }
    evaluated++;
    if (pts <= budget) {
      if (!best || score > best.score + 1e-12 || (Math.abs(score - best.score) <= 1e-12 && pts < best.points)) {
        best = { score, points: pts, picks: names.map((s, i) => ({ slot: s, id: slots[s][idx[i]].id, pts: slots[s][idx[i]].pts })) };
      }
    }
    let k = names.length - 1;
    while (k >= 0 && ++idx[k] === lens[k]) { idx[k] = 0; k--; }
    if (k < 0) break;
  }
  return { ...best, evaluated, method: 'brute-force-exhaustive' };
}

/** Independent exact solver: top-down memoised search over (slot, budget left). */
function exactMemo(slots, budget) {
  const names = Object.keys(slots);
  const memo = new Map();
  let visited = 0;
  const solve = (i, left) => {
    if (i === names.length) return { score: 0, points: 0, picks: [] };
    const key = i * (budget + 1) + left;
    if (memo.has(key)) return memo.get(key);
    visited++;
    let best = null;
    for (const o of slots[names[i]]) {
      if (o.pts > left) continue;
      const rest = solve(i + 1, left - o.pts);
      if (!rest) continue;
      const score = rest.score + o.score, points = rest.points + o.pts;
      if (!best || score > best.score + 1e-12 || (Math.abs(score - best.score) <= 1e-12 && points < best.points)) {
        best = { score, points, picks: [{ slot: names[i], id: o.id, pts: o.pts }, ...rest.picks] };
      }
    }
    memo.set(key, best);
    return best;
  };
  const r = solve(0, budget);
  return r ? { ...r, evaluated: visited, method: 'exact-memoised-search' } : null;
}

for (const rw of roster) {
  let opts = null;
  try { opts = diag.optimizer.options(rw.id, 25); }
  catch (e) { optionErrors.push({ id: rw.id, name: rw.name, cls: rw.cls, error: String(e.message || e) }); }

  // Cache/on-demand legality divergence: does the shipped cache winner use
  // attachments the on-demand optimizer refuses to consider?
  const cw = cacheWeapons?.[rw.id];
  if (cw && cw.builds) {
    const anyBuild = Object.values(cw.builds)[0];
    const legal = new Map();
    if (opts) for (const [slot, list] of Object.entries(opts)) legal.set(slot, new Set(list.map(o => o.id)));
    if (anyBuild && anyBuild.atts) {
      const bad = [];
      for (const [slot, id] of Object.entries(anyBuild.atts)) {
        if (!opts) { bad.push(`${slot}=${id} [on-demand optimizer cannot build this weapon at all]`); continue; }
        if (legal.has(slot) && !legal.get(slot).has(id)) bad.push(`${slot}=${id}`);
      }
      if (bad.length) divergence.push({ id: rw.id, name: rw.name, cls: rw.cls, cacheUses: bad });
    }
  }

  if (!opts) continue;

  for (const d of DISTANCES) {
    let slots;
    try { slots = diag.optimizer.options(rw.id, d); } catch { continue; }
    const budget = diag.optimizer.budget(rw.id);
    const combos = Object.values(slots).reduce((a, l) => a * l.length, 1);

    const prod = diag.optimizer.dpBuild(rw.id, d, 'laserbeam');
    if (!prod || prod.error) { errors.push(`${rw.id}@${d}m: production DP failed: ${(prod && prod.error) || 'null'}`); continue; }

    const memo = exactMemo(slots, budget);
    const brute = combos <= BRUTE_FORCE_LIMIT ? bruteForce(slots, budget) : null;

    // The exact solver must reproduce brute force wherever both run.
    if (brute && Math.abs(brute.score - memo.score) > 1e-9) {
      errors.push(`${rw.id}@${d}m: exact solver ${memo.score} differs from brute force ${brute.score} - solver is not safe`);
    }
    const reference = brute || memo;

    if (Math.abs(prod.score - reference.score) > 1e-9) {
      errors.push(`${rw.id}@${d}m: production optimum ${prod.score} != ${reference.method} ${reference.score}`);
    }
    if (prod.points !== reference.points) {
      errors.push(`${rw.id}@${d}m: production spent ${prod.points} pts, ${reference.method} optimum spends ${reference.points}`);
    }
    // Legality of the production build.
    if (prod.points > budget) errors.push(`${rw.id}@${d}m: build spends ${prod.points} over budget ${budget}`);
    const slotsUsed = prod.picks.map(p => p.slot);
    if (new Set(slotsUsed).size !== slotsUsed.length) errors.push(`${rw.id}@${d}m: duplicate slot in build`);
    const recomputed = prod.picks.reduce((a, p) => a + p.pts, 0);
    if (recomputed !== prod.points) errors.push(`${rw.id}@${d}m: point total ${prod.points} != recomputed ${recomputed}`);
    for (const p of prod.picks) {
      if (!slots[p.slot] || !slots[p.slot].some(o => o.id === p.id)) {
        errors.push(`${rw.id}@${d}m: pick ${p.slot}=${p.id} is not a legal option`);
      }
    }

    rows.push({
      id: rw.id, name: rw.name, cls: rw.cls, d, budget, combos,
      method: reference.method, evaluated: reference.evaluated,
      prodScore: prod.score, refScore: reference.score,
      prodPoints: prod.points, refPoints: reference.points,
      match: Math.abs(prod.score - reference.score) <= 1e-9 && prod.points === reference.points
    });
  }
}

const brutes = rows.filter(r => r.method === 'brute-force-exhaustive');
const summary = {
  generatedAt: new Date().toISOString(),
  weaponsConsidered: roster.length,
  // Count what was actually optimized. Weapons absent from data/weapons.json are
  // skipped silently by the options accessor, so roster length minus thrown
  // errors overstated this.
  weaponsOptimized: new Set(rows.map(r => r.id)).size,
  weaponsSkippedNoSourceEntry: roster.length - new Set(rows.map(r => r.id)).size - optionErrors.length,
  bruteForceLimit: FULL ? 'none (--full)' : BRUTE_FORCE_LIMIT,
  distances: DISTANCES,
  cases: rows.length,
  trueExhaustiveCases: brutes.length,
  exactSolverCases: rows.length - brutes.length,
  combinationsBruteForced: brutes.reduce((a, r) => a + r.combos, 0),
  largestSearchSpace: rows.reduce((a, r) => Math.max(a, r.combos), 0),
  mismatches: rows.filter(r => !r.match).length,
  errorCount: errors.length,
  optionErrors,
  cacheVsOnDemandDivergence: divergence
};
await mkdir('reports/overnight', { recursive: true });
await writeFile('reports/overnight/optimizer-exhaustive.json', JSON.stringify({ summary, errors, rows }, null, 1));
const cols = ['id', 'name', 'cls', 'd', 'budget', 'combos', 'method', 'prodScore', 'refScore', 'prodPoints', 'refPoints', 'match'];
await writeFile('reports/overnight/optimizer-exhaustive.csv',
  [cols.join(','), ...rows.map(r => cols.map(c => JSON.stringify(r[c] ?? '')).join(','))].join('\n'));

console.log(JSON.stringify(summary, null, 1));
if (errors.length) { console.error(`\nFAIL: ${errors.length} problems\n` + errors.slice(0, 20).join('\n')); process.exit(1); }
console.log('\nPASS: production optimizer matches the independent optimum in every case checked.');
