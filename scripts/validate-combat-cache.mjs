#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
const path = process.argv[2] || 'data/combat-cache.json';
const c = JSON.parse(await readFile(path,'utf8'));
const errors=[];
if (typeof c?.source?.gameVersion !== 'string' || !c.source.gameVersion) errors.push('missing source.gameVersion');
if (c?.source?.rankingModel !== 'laserbeam-v1') errors.push(`ranking model ${c?.source?.rankingModel || 'missing'}/laserbeam-v1`);
const expected=Number(c?.audit?.weaponsSource);
const modeled=Number(c?.audit?.modeled);
const incomplete=Number(c?.audit?.incomplete);
if (!c?.audit?.pass) errors.push('audit.pass is false');
if (!Number.isInteger(expected) || expected <= 0) errors.push('invalid weaponsSource');
if (!Number.isInteger(modeled) || modeled !== expected) errors.push(`modeled ${modeled}/${expected}`);
if (!Number.isInteger(incomplete) || incomplete !== 0) errors.push(`incomplete ${incomplete}`);
if (c?.audit?.errors?.length) errors.push(`audit errors ${c.audit.errors.length}`);
if (!Number.isInteger(c?.audit?.distancesPerWeapon) || c.audit.distancesPerWeapon !== 300) errors.push('expected 300 distances per modeled weapon');
const entries=Object.entries(c.weapons ?? {});
if (Number.isInteger(expected) && entries.length !== expected) errors.push(`weapon entries ${entries.length}/${expected}`);
for (const [id,w] of entries) {
  if (w.status !== 'modeled') { errors.push(`${id}: status ${w.status}`); continue; }
  for (let d=1; d<=300; d++) {
    const x=w.best?.[String(d)];
    if (!x) { errors.push(`${id}: missing ${d}m`); break; }
    if (!Number.isFinite(Number(x.points)) || !(x.points <= w.budget)) { errors.push(`${id}@${d}: ${x.points}>${w.budget}`); break; }
    const b=w.builds?.[x.buildId];
    if (!b) { errors.push(`${id}@${d}: missing winning build ${x.buildId}`); break; }
    if (Number(b.points) !== Number(x.points)) { errors.push(`${id}@${d}: winner/build point mismatch`); break; }
    if (!Number.isFinite(Number(x.ttk)) || x.ttk < 0) { errors.push(`${id}@${d}: invalid mech ttk`); break; }
    if (!Number.isFinite(Number(x.flightMs)) || x.flightMs < 0) { errors.push(`${id}@${d}: invalid flight time`); break; }
    if (!Number.isFinite(Number(x.triggerTtk)) || x.triggerTtk < x.ttk) { errors.push(`${id}@${d}: invalid trigger ttk`); break; }
    if (!Number.isFinite(Number(x.btk)) || x.btk < 1) { errors.push(`${id}@${d}: invalid btk`); break; }
    if (!Number.isFinite(Number(x.beamIndex)) || x.beamIndex < 0) { errors.push(`${id}@${d}: invalid beam index`); break; }
    if (!Number.isFinite(Number(x.effectiveAdsSpreadDeg)) || x.effectiveAdsSpreadDeg < 0) { errors.push(`${id}@${d}: invalid effective ADS spread`); break; }
  }
}
if (errors.length) {
  console.error('COMBAT CACHE VALIDATION FAILED');
  for (const e of errors.slice(0,100)) console.error('-',e);
  process.exit(1);
}
console.log(`COMBAT CACHE PASS • modeled ${c.audit.modeled}/${c.audit.weaponsSource} • raw legal combinations ${c.audit.rawLegalCombinations} • canonical evaluated ${c.audit.canonicalCombinationsEvaluated}`);
