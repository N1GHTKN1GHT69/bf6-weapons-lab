#!/usr/bin/env node
/**
 * Optimizer legality-policy consistency gate.
 *
 * The product contains two attachment-legality policies and they disagree:
 *
 *   buildOptions()          (on-demand optimizer) rejects any attachment whose
 *                           upstream record carries `assumed`/`assumedFields`.
 *   build-combat-cache.mjs  (exhaustive cache) does not, so the shipped cache
 *                           ships winning builds using exactly those attachments.
 *
 * That is a real inconsistency, not a cosmetic one: the winning build shown for
 * most primaries uses a barrel the app's own on-demand path refuses to consider,
 * and one weapon (M250) has no non-assumed barrel at all, so its on-demand build
 * throws outright whenever the exhaustive cache is unavailable.
 *
 * Resolving it is a data-policy decision that changes displayed winners, so this
 * gate does not resolve it. It pins the divergence to a recorded baseline and
 * fails if the set changes, so the issue can neither grow nor quietly disappear.
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { bootLab } from './lab-harness.mjs';

const BASELINE_PATH = 'data/optimizer-legality-divergence.json';
const write = process.argv.includes('--write');

const { diag, window: win } = await bootLab();
const cache = JSON.parse(await readFile('data/combat-cache.json', 'utf8'));
const cws = cache.weapons ?? cache;
const roster = (win.BF6_CURRENT?.roster ?? []).filter(w => w.cls !== 'Secondary');

const unbuildable = [];
const affected = [];
const offendingAttachments = new Map();

for (const rw of roster) {
  let opts = null;
  try { opts = diag.optimizer.options(rw.id, 25); }
  catch (e) { unbuildable.push({ id: rw.id, name: rw.name, cls: rw.cls, error: String(e.message || e) }); }

  const cw = cws[rw.id];
  if (!cw || !cw.builds) continue;

  const legal = new Map();
  if (opts) for (const [s, l] of Object.entries(opts)) legal.set(s, new Set(l.map(o => o.id)));

  const winning = new Set();
  for (const src of ['best', 'bestLethal']) {
    for (const k of Object.keys(cw[src] || {})) {
      const b = cw[src][k];
      const id = b && (b.buildId || b.id);
      if (id) winning.add(id);
    }
  }

  const found = new Set();
  for (const bid of winning) {
    const b = cw.builds[bid];
    if (!b || !b.atts) continue;
    for (const [slot, id] of Object.entries(b.atts)) {
      if (!opts) continue;
      if (legal.has(slot) && !legal.get(slot).has(id)) {
        found.add(`${slot}=${id}`);
        offendingAttachments.set(`${slot}=${id}`, (offendingAttachments.get(`${slot}=${id}`) || 0) + 1);
      }
    }
  }
  if (found.size) affected.push({ id: rw.id, cls: rw.cls, attachments: [...found].sort() });
}

const current = {
  schema: 1,
  status: 'OPEN — two attachment-legality policies disagree',
  explanation: 'The exhaustive cache builder admits attachments whose upstream record carries assumedFields; buildOptions() in app.js rejects them. Neither side is being changed by this gate, because either choice changes displayed winners. See BF6-WEAPONS-LAB-OVERNIGHT-REPORT.md.',
  affectedWeapons: affected.sort((a, b) => a.id.localeCompare(b.id)),
  weaponsWithNoLegalOnDemandBuild: unbuildable.sort((a, b) => a.id.localeCompare(b.id)),
  offendingAttachments: [...offendingAttachments.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ attachment: k, winningBuilds: v }))
};

if (write) {
  await writeFile(BASELINE_PATH, JSON.stringify(current, null, 1) + '\n');
  console.log(`baseline written: ${affected.length} affected weapons, ${unbuildable.length} unbuildable on-demand`);
  process.exit(0);
}

let baseline = null;
try { baseline = JSON.parse(await readFile(BASELINE_PATH, 'utf8')); }
catch { console.error(`FAIL: ${BASELINE_PATH} missing. Run with --write to record the current divergence.`); process.exit(1); }

const errors = [];
const key = o => JSON.stringify(o.affectedWeapons) + '|' + JSON.stringify(o.weaponsWithNoLegalOnDemandBuild.map(x => x.id));
if (key(current) !== key(baseline)) {
  const b = new Map(baseline.affectedWeapons.map(x => [x.id, x.attachments.join(',')]));
  const c = new Map(current.affectedWeapons.map(x => [x.id, x.attachments.join(',')]));
  for (const [id, v] of c) if (!b.has(id)) errors.push(`NEW divergent weapon ${id}: ${v}`);
  for (const [id, v] of b) if (!c.has(id)) errors.push(`RESOLVED divergent weapon ${id}: ${v} — update the baseline with --write`);
  for (const [id, v] of c) if (b.has(id) && b.get(id) !== v) errors.push(`CHANGED divergence for ${id}: ${b.get(id)} -> ${v}`);
  const bu = new Set(baseline.weaponsWithNoLegalOnDemandBuild.map(x => x.id));
  const cu = new Set(current.weaponsWithNoLegalOnDemandBuild.map(x => x.id));
  for (const id of cu) if (!bu.has(id)) errors.push(`NEW weapon with no legal on-demand build: ${id}`);
  for (const id of bu) if (!cu.has(id)) errors.push(`weapon ${id} now builds on-demand — update the baseline with --write`);
}

await mkdir('reports/overnight', { recursive: true });
await writeFile('reports/overnight/optimizer-legality.json', JSON.stringify({ generatedAt: new Date().toISOString(), current, errors }, null, 1));

console.log(`optimizer legality: ${current.affectedWeapons.length}/${roster.length} primaries ship a cached winning build using an attachment the on-demand optimizer rejects`);
console.log(`weapons with no legal on-demand build at all: ${current.weaponsWithNoLegalOnDemandBuild.map(x => x.id).join(', ') || 'none'}`);
if (errors.length) { console.error('FAIL:\n' + errors.join('\n')); process.exit(1); }
console.log('PASS: divergence matches the recorded baseline (known-open issue, not a regression).');
