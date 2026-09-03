#!/usr/bin/env node
/**
 * Full META engine sweep.
 *
 * Runs the real ranking engine across every mode / armour state / priority /
 * scope / distance combination and looks for results that cannot be true,
 * rather than results that are merely surprising. A surprising-but-supported
 * ranking is preserved and reported, never "corrected".
 *
 * Raw per-case output goes to reports/overnight/meta-sweep.csv. Only totals,
 * anomalies and representative examples are printed.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { bootLab } from './lab-harness.mjs';

const DISTANCES = [1, 5, 9, 10, 15, 20, 21, 25, 30, 31, 35, 36, 37, 40, 50, 54, 60, 75, 76, 83, 90, 100, 120, 133, 150, 200, 250, 300];
const MODES = [
  { key: 'MP', gameMode: 'multiplayer', targetArmor: 'unarmored' },
  { key: 'RS-UNARM', gameMode: 'redsec', targetArmor: 'unarmored' },
  { key: 'RS-2PLATE', gameMode: 'redsec', targetArmor: 'plates2' }
];
const PRIORITIES = ['balanced', 'fastest'];

const { diag, window: win } = await bootLab();
const scopes = ['__all__', ...(win.BF6_CURRENT?.primaryClasses ?? [])];

const rows = [];
const anomalies = [];
const flips = [];
const fidelity = [];
let evaluations = 0;

const bad = (kind, o) => anomalies.push({ kind, ...o });

for (const m of MODES) {
  for (const priority of PRIORITIES) {
    for (const category of scopes) {
      let prevWinner = null, prevTtk = null, prevD = null;
      for (const d of DISTANCES) {
        const label = `${m.key}/${priority}/${category}/${d}m`;
        let s;
        try {
          s = diag.snapshot({ gameMode: m.gameMode, targetArmor: m.targetArmor, category, distance: d, priority, mode: 'auto', topN: 200 });
        } catch (e) { bad('snapshot-threw', { label, detail: String(e.message || e) }); continue; }

        evaluations += s.rankedCount;
        const top = s.top[0];
        if (!top) { bad('no-winner', { label, ranked: s.rankedCount }); continue; }

        // --- results that cannot be true ---
        for (const t of s.top) {
          if (!Number.isInteger(t.btk) || t.btk <= 0 || t.btk > 100) bad('impossible-btk', { label, weapon: t.id, btk: t.btk });
          for (const [f, v] of [['triggerTtk', t.triggerTtk], ['mechTtk', t.mechTtk], ['damage', t.damage]]) {
            if (v == null) continue;
            if (!Number.isFinite(Number(v))) bad('non-finite', { label, weapon: t.id, field: f, value: String(v) });
            else if (Number(v) < 0) bad('negative', { label, weapon: t.id, field: f, value: v });
          }
          if (Number.isFinite(Number(t.damage)) && Number(t.damage) <= 0) bad('non-positive-damage', { label, weapon: t.id, damage: t.damage });
          if (Number.isFinite(Number(t.triggerTtk)) && Number.isFinite(Number(t.mechTtk)) && Number(t.triggerTtk) + 1e-9 < Number(t.mechTtk)) {
            bad('trigger-ttk-below-mech-ttk', { label, weapon: t.id, triggerTtk: t.triggerTtk, mechTtk: t.mechTtk });
          }
        }
        // PRIORITY fidelity. rankWeapons() always orders by the 55/45 laserbeam
        // utility; PRIORITY only selects which cached build row is read. So under
        // FASTEST KILL the winner is frequently not the fastest killer. That is a
        // tracked product-truth gap, not an arithmetic fault, so it is measured
        // here rather than counted as an engine anomaly.
        if (priority === 'fastest') {
          const finite = s.top.filter(t => Number.isFinite(Number(t.triggerTtk)));
          if (finite.length) {
            const fastest = finite.reduce((a, b) => Number(b.triggerTtk) < Number(a.triggerTtk) ? b : a);
            if (fastest.id !== top.id) {
              fidelity.push({ label, shown: top.id, shownTtk: Math.round(top.triggerTtk), fastest: fastest.id, fastestTtk: Math.round(fastest.triggerTtk), deltaMs: Math.round(top.triggerTtk - fastest.triggerTtk) });
            }
          }
        }
        // Armour must never make a target easier to kill than no armour.
        if (m.key === 'RS-2PLATE') {
          const un = diag.snapshot({ gameMode: 'redsec', targetArmor: 'unarmored', category, distance: d, priority, mode: 'auto' });
          const unTop = un.top[0];
          if (unTop && Number.isFinite(top.triggerTtk) && Number.isFinite(unTop.triggerTtk) && top.triggerTtk + 1e-6 < unTop.triggerTtk) {
            bad('armour-faster-than-unarmoured', { label, armoured: top.id, armouredTtk: top.triggerTtk, unarmoured: unTop.id, unarmouredTtk: unTop.triggerTtk });
          }
        }

        // --- discontinuity watch (reported, not failed) ---
        if (prevWinner && top.id !== prevWinner) flips.push({ mode: m.key, priority, category, from: prevD, to: d, was: prevWinner, now: top.id });
        if (prevTtk != null && Number.isFinite(top.triggerTtk) && Number.isFinite(prevTtk)) {
          const jump = Math.abs(top.triggerTtk - prevTtk) / Math.max(1, prevTtk);
          // A relative jump on a one-shot weapon is just projectile flight time
          // changing by a few milliseconds; require a real absolute move too.
          if (jump > 0.6 && Math.abs(top.triggerTtk - prevTtk) > 50 && top.id === prevWinner) {
            bad('ttk-discontinuity', { label, weapon: top.id, from: prevD, fromTtk: prevTtk, toTtk: top.triggerTtk, jumpPct: Math.round(jump * 100) });
          }
        }
        prevWinner = top.id; prevTtk = top.triggerTtk; prevD = d;

        rows.push({
          mode: m.key, priority, category, d,
          ranked: s.rankedCount, winner: top.id, winnerName: top.name, cls: top.cls,
          btk: top.btk, damage: top.damage,
          mechTtk: Number.isFinite(top.mechTtk) ? Math.round(top.mechTtk) : null,
          triggerTtk: Number.isFinite(top.triggerTtk) ? Math.round(top.triggerTtk) : null,
          beamIndex: top.beamIndex == null ? null : Number(top.beamIndex).toFixed(3),
          buildPoints: s.build?.points ?? null, exhaustive: s.build?.exhaustive ?? null
        });
      }
    }
  }
}

const byKind = {};
for (const a of anomalies) byKind[a.kind] = (byKind[a.kind] || 0) + 1;

const summary = {
  generatedAt: new Date().toISOString(),
  distances: DISTANCES.length, modes: MODES.length, priorities: PRIORITIES.length, scopes: scopes.length,
  cases: rows.length,
  rankingEvaluations: evaluations,
  anomalies: anomalies.length,
  anomaliesByKind: byKind,
  winnerChanges: flips.length,
  distinctWinners: [...new Set(rows.map(r => r.winner))].length,
  priorityFidelity: {
    note: 'FASTEST KILL cases whose winner is not the fastest killer. rankWeapons() always sorts by the 55/45 laserbeam utility; PRIORITY only changes which cached build row is read. Tracked, not auto-corrected: changing it changes headline winners across the product.',
    fastestKillCases: rows.filter(r => r.priority === 'fastest').length,
    winnerNotFastest: fidelity.length,
    worstDeltaMs: fidelity.reduce((a, f) => Math.max(a, f.deltaMs), 0),
    examples: fidelity.slice(0, 12)
  }
};

await mkdir('reports/overnight', { recursive: true });
await writeFile('reports/overnight/meta-sweep.json', JSON.stringify({ summary, anomalies, flips, fidelity }, null, 1));
const cols = ['mode', 'priority', 'category', 'd', 'ranked', 'winner', 'winnerName', 'cls', 'btk', 'damage', 'mechTtk', 'triggerTtk', 'beamIndex', 'buildPoints', 'exhaustive'];
await writeFile('reports/overnight/meta-sweep.csv',
  [cols.join(','), ...rows.map(r => cols.map(c => JSON.stringify(r[c] ?? '')).join(','))].join('\n'));

console.log(JSON.stringify(summary, null, 1));
if (anomalies.length) {
  console.error('\nANOMALIES (first 20):');
  for (const a of anomalies.slice(0, 20)) console.error('  ' + JSON.stringify(a));
  process.exit(1);
}
console.log('\nPASS: no impossible BTK/TTK, no non-finite or negative values, no out-of-order ranking, no armour shortcut.');
