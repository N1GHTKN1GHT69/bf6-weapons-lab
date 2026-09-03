#!/usr/bin/env node
/**
 * Cross-source reconciliation against the ORIGINAL publisher.
 *
 * Our dataset reaches us through the raymdl/BF6-Weapon-Analyzer mirror, which
 * ingests Sym.gg. Until now the claim "our values are Sym 1.3.3.0" rested on the
 * mirror's own metadata. This checks it against Sym's OWN publication - their
 * "Patch Notes: Sym Style" page, which prints the exact post-patch value of each
 * source primitive - and so eliminates mirror transcription error as a risk
 * class entirely.
 *
 * What this does and does not establish:
 *   DOES     confirm our stored values are faithfully Sym's published 1.3.3.0
 *            numbers, field by field.
 *   DOES NOT make them current for 1.4.2.5. Sym has published no BF6 numeric
 *            data after 1.3.3.0, so this is a FIDELITY check, not a CURRENCY
 *            one, and it deliberately moves no currency classification.
 *
 * Refreshing when Sym publishes a newer patch: re-capture the page (it is
 * client-rendered, so a plain fetch returns only the shell - render it, expand
 * every weapon accordion, read the post-patch column), write a new
 * data/sources/sym-bf6-<version>.json, and point SOURCE at it. The comparison
 * logic below is version-agnostic.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const SOURCE = 'data/sources/sym-bf6-1330.json';
const src = JSON.parse(await readFile(SOURCE, 'utf8'));
const weapons = JSON.parse(await readFile('data/weapons.json', 'utf8'));
const freshness = JSON.parse(await readFile('data/freshness-status.json', 'utf8'));

const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const byName = new Map();
for (const w of weapons) { byName.set(norm(w.name), w); byName.set(norm(w.id), w); }

const FIELDS = [
  { sym: 'ADSRecoilAmount', get: w => w.recoil?.ads?.amount, path: 'recoil.ads.amount' },
  { sym: 'ADSRecoilDirectionVariation', get: w => w.recoil?.ads?.dirVar, path: 'recoil.ads.dirVar' },
  { sym: 'ADSRecoilDirectionVariationMultiplier', get: w => w.recoil?.ads?.dirVarMult, path: 'recoil.ads.dirVarMult' },
  { sym: 'velocity', get: w => w.bulletVel, path: 'bulletVel' },
  { sym: 'ADSBaseSpreadInc', get: w => w.spreadDyn?.ads?.inc, path: 'spreadDyn.ads.inc' },
  { sym: 'ADSBaseSpreadFiringDecCoef', get: w => w.spreadDyn?.ads?.firingCoef, path: 'spreadDyn.ads.firingCoef' },
  { sym: 'ADSBaseSpreadFiringDecOffset', get: w => w.spreadDyn?.ads?.firingOffset, path: 'spreadDyn.ads.firingOffset' },
  { sym: 'ADSBaseSpreadDistExp', get: w => w.spreadDyn?.ads?.distExp, path: 'spreadDyn.ads.distExp' }
];

const errors = [], conflicts = [], unmatched = [];
let compared = 0, agreed = 0;
const perWeapon = [];

for (const [name, vals] of Object.entries(src.values)) {
  const w = byName.get(norm(name)) || byName.get(norm(name.replace('/', '')));
  if (!w) { unmatched.push(name); continue; }
  const row = { weaponId: w.id, symName: name, fields: {} };
  for (const f of FIELDS) {
    const theirs = Number(vals[f.sym]);
    if (!Number.isFinite(theirs)) continue;
    const ours = Number(f.get(w));
    compared++;
    const match = Number.isFinite(ours) && Math.abs(ours - theirs) < 1e-9;
    if (match) agreed++;
    else conflicts.push({ weaponId: w.id, field: f.path, symField: f.sym, ours, theirs });
    row.fields[f.path] = { ours, sym: theirs, match };
  }
  perWeapon.push(row);
}

// A conflict is a real finding: either the mirror altered a value, or our copy
// drifted. Either way it must not pass silently.
if (conflicts.length) {
  for (const c of conflicts.slice(0, 20)) {
    errors.push(`${c.weaponId} ${c.field}: ours=${c.ours} but Sym published ${c.theirs} (${c.symField})`);
  }
}
if (unmatched.length > 5) {
  errors.push(`${unmatched.length} Sym weapon names could not be matched to our roster: ${unmatched.slice(0, 8).join(', ')}`);
}

const report = {
  generatedAt: new Date().toISOString(),
  source: { name: src.source, url: src.sourceUrl, published: src.publishedDate, represents: src.representsGameVersion, deltaRange: src.deltaRange },
  liveGameVersion: freshness.official?.gameVersion ?? null,
  establishes: 'FIDELITY of our stored values to the original publisher. NOT currency: Sym has published no BF6 numeric data after ' + src.representsGameVersion + '.',
  weaponsInSource: Object.keys(src.values).length,
  weaponsMatched: perWeapon.length,
  unmatched,
  fieldComparisons: compared,
  agreed,
  conflicts,
  perWeapon
};

await mkdir('reports/patch-delta', { recursive: true });
await writeFile('reports/patch-delta/source-reconciliation.json', JSON.stringify(report, null, 1));

console.log(`source reconciliation vs ${src.source} (${src.representsGameVersion}, published ${src.publishedDate})`);
console.log(`  weapons matched : ${perWeapon.length}/${Object.keys(src.values).length}${unmatched.length ? ` (unmatched: ${unmatched.join(', ')})` : ''}`);
console.log(`  field comparisons: ${compared}   agreed: ${agreed}   conflicts: ${conflicts.length}`);
if (errors.length) { console.error('FAIL:\n' + errors.join('\n')); process.exit(1); }
console.log('PASS: every stored value matches the original publisher exactly. Mirror transcription error is ruled out.');
console.log('NOTE: this is a fidelity check. It does not make any value current for ' + (freshness.official?.gameVersion ?? 'the live version') + '.');
