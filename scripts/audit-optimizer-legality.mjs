#!/usr/bin/env node
/**
 * Optimizer legality-policy consistency gate.
 *
 * Both optimization paths must apply the SAME attachment legality policy.
 *
 * They once did not. buildOptions() rejected any attachment carrying
 * `assumedFields`, while the cache builder stripped only the named unverified
 * fields and kept the option. 27 of 56 primaries therefore shipped cached
 * winning builds using barrels the live path refused, and M250 - whose only two
 * barrels are both partially assumed - had no legal barrel at all on-demand.
 *
 * Both now share attachment-legality.js. This gate requires the divergence to be
 * exactly ZERO: any weapon whose cached winning build uses an option the live
 * optimizer would reject, or any weapon that cannot be built on-demand, is a
 * failure. `--write` refreshes the recorded snapshot in data/.
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
  status: 'RESOLVED — one shared legality policy (attachment-legality.js)',
  explanation: 'buildOptions() and scripts/build-combat-cache.mjs both apply attachment-legality.js: wholly-assumed options are excluded, partially-assumed options keep their verified fields with the unverified ones stripped. This gate requires the divergence to remain exactly zero.',
  affectedWeapons: affected.sort((a, b) => a.id.localeCompare(b.id)),
  weaponsWithNoLegalOnDemandBuild: unbuildable.sort((a, b) => a.id.localeCompare(b.id)),
  offendingAttachments: [...offendingAttachments.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ attachment: k, winningBuilds: v }))
};

if (write) {
  await writeFile(BASELINE_PATH, JSON.stringify(current, null, 1) + '\n');
  console.log(`snapshot written: ${affected.length} affected weapons, ${unbuildable.length} unbuildable on-demand`);
}

const errors = [];
for (const w of current.affectedWeapons) {
  errors.push(`${w.id}: cached winning build uses ${w.attachments.join(', ')}, which the on-demand optimizer rejects - the two paths are not sharing one legality policy`);
}
for (const w of current.weaponsWithNoLegalOnDemandBuild) {
  errors.push(`${w.id}: no legal on-demand build (${w.error})`);
}

// The shared policy must actually be the shared file, not a re-implementation.
const appSrc = await readFile('app.js', 'utf8');
if (!appSrc.includes('window.BF6_ATTACHMENT_LEGALITY')) errors.push('app.js does not use the shared attachment legality policy');
if (!appSrc.includes('legality.legalOption(opt, pointCost)')) errors.push('buildOptions() does not apply the shared legality decision');
if (/function isAssumedOption\(opt\) \{\s*if \(!opt/.test(appSrc)) errors.push('app.js still carries its own assumed-option implementation');
const sanitizerSrc = await readFile('scripts/verified-source-sanitizer.mjs', 'utf8');
if (!sanitizerSrc.includes("attachment-legality.js")) errors.push('cache-side sanitizer does not re-export the shared policy');

await mkdir('reports/overnight', { recursive: true });
await writeFile('reports/overnight/optimizer-legality.json', JSON.stringify({ generatedAt: new Date().toISOString(), current, errors }, null, 1));

console.log(`optimizer legality: ${current.affectedWeapons.length}/${roster.length} primaries diverge; ${current.weaponsWithNoLegalOnDemandBuild.length} weapons unbuildable on-demand`);
if (errors.length) { console.error('FAIL:\n' + errors.slice(0, 25).join('\n')); process.exit(1); }
console.log('PASS: both optimization paths apply one shared legality policy, with zero divergence.');
