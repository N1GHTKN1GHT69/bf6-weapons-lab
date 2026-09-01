#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const app = await readFile('app.js','utf8');
const builder = await readFile('scripts/build-combat-cache.mjs','utf8');
const validator = await readFile('scripts/validate-combat-cache.mjs','utf8');
const errors=[];

for (const file of ['app.js','scripts/build-combat-cache.mjs','scripts/validate-combat-cache.mjs']) {
  try { execFileSync(process.execPath,['--check',file],{stdio:'pipe'}); }
  catch (e) { errors.push(`${file}: syntax check failed`); }
}
if (!builder.includes("rankingModel: 'laserbeam-v1'")) errors.push('builder missing laserbeam-v1 model tag');
if (!builder.includes('selectedRecoilAmountFor') || !builder.includes('selectedRecoilVariationFor') || !builder.includes('effectiveSpreadMax')) errors.push('builder is not using Analyzer recoil/spread primitives');
if (!builder.includes('beamIndex')) errors.push('builder missing Beam Index');
if (!app.includes('0.55*lethalScore+0.45*beamScore')) errors.push('AUTO ranking is not 55/45 lethality/beam');
if (!app.includes('rankingModel !== "laserbeam-v1"')) errors.push('browser does not reject old ranking-model caches');
if (!validator.includes("rankingModel !== 'laserbeam-v1'")) errors.push('CLI validator does not reject old ranking-model caches');
if (!validator.includes('invalid beam index')) errors.push('cache validator does not require beam metrics');

// Synthetic regression: a small paper-TTK lead must not automatically beat a
// much more controllable gun, while a weapon far off the kill pace is penalized.
function rank(rows){
  const ttks=rows.map(x=>x.ttk), beams=rows.map(x=>x.beam);
  const fastest=Math.min(...ttks), slowest=Math.max(...ttks), best=Math.min(...beams), worst=Math.max(...beams);
  return rows.map(x=>{
    const lethal=slowest===fastest?100:100*(slowest-x.ttk)/(slowest-fastest);
    const beam=worst===best?100:100*(worst-x.beam)/(worst-best);
    const off=x.ttk>fastest*1.25+10;
    return {...x, score:.55*lethal+.45*beam-(off?20:0)};
  }).sort((a,b)=>b.score-a.score);
}
const r=rank([
  {id:'paper-fast',ttk:250,beam:9},
  {id:'laser',ttk:265,beam:2},
  {id:'too-slow',ttk:380,beam:1},
]);
if (r[0].id !== 'laser') errors.push(`synthetic laserbeam winner wrong: ${r[0].id}`);
if (r.at(-1).id !== 'too-slow') errors.push('off-pace lethality penalty failed');

if (errors.length) {
  console.error('LASERBEAM META AUDIT FAILED');
  errors.forEach(e=>console.error('-',e));
  process.exit(1);
}
console.log('LASERBEAM META PASS • syntax • recoil/spread primitives • cache model gate • 55/45 AUTO ranking • synthetic winner regression');
