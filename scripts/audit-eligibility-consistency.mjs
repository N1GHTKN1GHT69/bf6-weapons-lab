#!/usr/bin/env node
/**
 * Eligibility / count consistency gate.
 *
 * The number a scope advertises must be the number that scope can actually rank,
 * and every excluded primary must carry a deterministic, recognised reason.
 * This runs against the REAL app.js through the headless harness, including the
 * rendered tab markup, so a regression in either the predicate or the rendering
 * is caught.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { bootLab } from './lab-harness.mjs';

const KNOWN_REASONS = new Set([
  'empirical-current-not-verified',
  'class-excluded-from-cross-class',
  'ballistics-not-exact',
  'no-class-audit',
  'incomplete-combat-values',
  'no-combat-row'
]);

const { diag, window: win } = await bootLab();
const errors = [];
const report = [];

const scopes = ['__all__', ...(win.BF6_CURRENT?.primaryClasses ?? [])];
const modes = [
  { gameMode: 'multiplayer', targetArmor: 'unarmored' },
  { gameMode: 'redsec', targetArmor: 'unarmored' },
  { gameMode: 'redsec', targetArmor: 'plates2' }
];

for (const m of modes) {
  for (const priority of ['balanced', 'fastest']) {
    for (const category of scopes) {
      for (const distance of [1, 10, 25, 50, 100, 150, 300]) {
        const q = { ...m, category, distance, priority, mode: 'auto' };
        const scope = diag.scope(q);
        const snap = diag.snapshot(q);
        const label = `${m.gameMode}/${m.targetArmor}/${priority}/${category}/${distance}m`;

        if (scope.rankable !== snap.rankedCount) {
          errors.push(`${label}: scope says ${scope.rankable} rankable, ranking produced ${snap.rankedCount}`);
        }
        for (const e of scope.excluded) {
          if (!KNOWN_REASONS.has(e.reason)) errors.push(`${label}: ${e.name} excluded with unrecognised reason "${e.reason}"`);
        }
        // Every primary is either ranked or excluded with a reason - nothing vanishes.
        const inScope = category === '__all__'
          ? scope.totalPrimaries
          : (win.BF6_CURRENT.roster.filter(w => w.cls === category).length);
        if (scope.rankable + scope.excluded.length !== inScope) {
          errors.push(`${label}: ${scope.rankable} ranked + ${scope.excluded.length} excluded != ${inScope} in scope`);
        }
        report.push({ ...q, rankable: scope.rankable, ranked: snap.rankedCount, excluded: scope.excluded.length });
      }
    }
  }
}

const doc = diag.env();

await mkdir('reports/overnight', { recursive: true });
await writeFile('reports/overnight/eligibility-consistency.json', JSON.stringify({
  generatedAt: new Date().toISOString(), cases: report.length, errors, env: doc, report
}, null, 1));

console.log(`eligibility consistency: ${report.length} scope cases checked`);
if (errors.length) { console.error('FAIL:\n' + errors.slice(0, 30).join('\n')); process.exit(1); }
console.log('PASS: advertised count equals ranked count in every scope; every exclusion has a known reason.');
