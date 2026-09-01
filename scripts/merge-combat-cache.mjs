#!/usr/bin/env node
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';

const upstream = resolve(process.argv[2] || process.env.BF6_ANALYZER_DIR || '.upstream/bf6-analyzer');
const partialDir = resolve(process.argv[3] || 'partial-cache');
const outDir = resolve(process.argv[4] || 'data');
const json = async p => JSON.parse(await readFile(p,'utf8'));
const expectedWeapons = await json(join(upstream,'data/weapons.json'));
const expectedIds = new Set(expectedWeapons.map(w=>w.id));
const files = (await readdir(partialDir)).filter(x=>x.endsWith('.json')).sort();
if (!files.length) throw new Error(`No partial cache JSON files found in ${partialDir}`);
const parts = await Promise.all(files.map(f=>json(join(partialDir,f))));

const first = parts[0];
const requiredSourceFields=['commit','gameVersion','rankingModel','opticModel','manualBuildModel'];
for(const [i,p] of parts.entries()){
  if(p?.audit?.pass!==true) throw new Error(`${files[i]} partial audit is not passing`);
  if(!p?.source?.classFilter) throw new Error(`${files[i]} is not a class-filtered partial cache`);
  for(const k of requiredSourceFields){
    if(p?.source?.[k]!==first?.source?.[k]) throw new Error(`${files[i]} source mismatch for ${k}: ${p?.source?.[k]} != ${first?.source?.[k]}`);
  }
  if(JSON.stringify(p.rules)!==JSON.stringify(first.rules)) throw new Error(`${files[i]} rules differ from first partial`);
}

const weapons={};
let modeled=0,incomplete=0,canonical=0,raw=0n;
const errors=[];
for(const p of parts){
  modeled += Number(p.audit.modeled)||0;
  incomplete += Number(p.audit.incomplete)||0;
  canonical += Number(p.audit.canonicalCombinationsEvaluated)||0;
  raw += BigInt(p.audit.rawLegalCombinations || '0');
  errors.push(...(p.audit.errors||[]));
  for(const [id,w] of Object.entries(p.weapons||{})){
    if(weapons[id]) throw new Error(`Duplicate weapon across partial caches: ${id}`);
    weapons[id]=w;
  }
}
const actualIds=new Set(Object.keys(weapons));
const missing=[...expectedIds].filter(id=>!actualIds.has(id));
const extra=[...actualIds].filter(id=>!expectedIds.has(id));
if(missing.length) errors.push(`Missing merged weapons: ${missing.join(', ')}`);
if(extra.length) errors.push(`Unexpected merged weapons: ${extra.join(', ')}`);

const source={...first.source,classFilter:null,totalWeapons:expectedWeapons.length};
const generatedAt=new Date().toISOString();
const audit={
  weaponsSource:expectedWeapons.length,
  totalWeaponsSource:expectedWeapons.length,
  modeled,incomplete,
  rawLegalCombinations:String(raw),
  canonicalCombinationsEvaluated:canonical,
  distancesPerWeapon:first.audit.distancesPerWeapon,
  errors,
};
audit.pass = errors.length===0 && incomplete===0 && modeled===expectedWeapons.length && actualIds.size===expectedWeapons.length;
const merged={schema:first.schema,generatedAt,source,rules:first.rules,audit,weapons};
await mkdir(outDir,{recursive:true});
await writeFile(join(outDir,'combat-cache.json'),JSON.stringify(merged));
await writeFile(join(outDir,'combat-audit.json'),JSON.stringify({generatedAt,source,rules:first.rules,audit},null,2));
console.log(JSON.stringify({partials:files.length,classes:parts.map(p=>p.source.classFilter),audit},null,2));
if(!audit.pass) process.exitCode=2;
