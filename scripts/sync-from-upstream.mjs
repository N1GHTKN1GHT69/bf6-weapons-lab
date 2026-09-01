#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { auditPointData } from './point-audit.mjs';

const upstream = resolve(process.argv[2] || process.env.BF6_ANALYZER_DIR || '.upstream/bf6-analyzer');
const outDir = resolve(process.argv[3] || 'data');
const files = ['weapons.json','attachments.json','ammo.json','ballistics.json'];
const sha256 = text => createHash('sha256').update(text).digest('hex');
const parsed = {};
const raw = {};

for (const name of files) {
  const text = await readFile(join(upstream,'data',name),'utf8');
  raw[name] = text;
  parsed[name] = JSON.parse(text);
}
if (!Array.isArray(parsed['weapons.json']) || !parsed['weapons.json'].length) throw new Error('upstream weapons.json is not a non-empty array');
const points = auditPointData(parsed['attachments.json'], parsed['ammo.json']);
for (const warning of points.warnings ?? []) console.warn(`POINT WARNING: ${warning}`);
if (!points.ok) throw new Error(`upstream attachment/ammo point audit failed: ${(points.errors ?? []).slice(0,8).join('; ')}`);
const b = parsed['ballistics.json'];
if (!(Number(b?.baseDragPerMeter) >= 0) || !Array.isArray(b?.weaponIds)) throw new Error('upstream ballistics.json schema invalid');

await mkdir(outDir,{recursive:true});
for (const name of files) await writeFile(join(outDir,name), raw[name]);
let commit = null;
try { commit = execFileSync('git',['-C',upstream,'rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim(); } catch {}
const manifest = {
  schema:1,
  generatedAt:new Date().toISOString(),
  repository:'raymdl/BF6-Weapon-Analyzer',
  commit,
  counts:{weapons:parsed['weapons.json'].length, ballisticsWeaponIds:b.weaponIds.length},
  sha256:Object.fromEntries(files.map(name=>[name,sha256(raw[name])])),
  pointAudit:{ok:true,warnings:(points.warnings??[]).length,errors:0}
};
await writeFile(join(outDir,'source-manifest.json'), JSON.stringify(manifest,null,2));
console.log(`SOURCE SNAPSHOT PASS • weapons ${manifest.counts.weapons} • upstream ${commit ?? 'unknown'} • point audit PASS`);
