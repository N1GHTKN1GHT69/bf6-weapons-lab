#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
const path = process.argv[2] || 'data/combat-cache.json';
const c = JSON.parse(await readFile(path,'utf8'));
const errors=[];
if (!c?.audit?.pass) errors.push('audit.pass is false');
if (!Number.isInteger(c?.audit?.distancesPerWeapon) || c.audit.distancesPerWeapon !== 300) errors.push('expected 300 distances per modeled weapon');
for (const [id,w] of Object.entries(c.weapons ?? {})) {
  if (w.status !== 'modeled') continue;
  for (let d=1; d<=300; d++) {
    const x=w.best?.[String(d)];
    if (!x) { errors.push(`${id}: missing ${d}m`); break; }
    if (!(x.points <= w.budget)) { errors.push(`${id}@${d}: ${x.points}>${w.budget}`); break; }
    if (!w.builds?.[x.buildId]) { errors.push(`${id}@${d}: missing winning build ${x.buildId}`); break; }
    if (x.ttk != null && x.ttk < 0) { errors.push(`${id}@${d}: negative ttk`); break; }
  }
}
if (errors.length) {
  console.error('COMBAT CACHE VALIDATION FAILED');
  for (const e of errors.slice(0,100)) console.error('-',e);
  process.exit(1);
}
console.log(`COMBAT CACHE PASS • modeled ${c.audit.modeled}/${c.audit.weaponsSource} • raw legal combinations ${c.audit.rawLegalCombinations} • canonical evaluated ${c.audit.canonicalCombinationsEvaluated}`);
