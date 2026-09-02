#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { offerAutoBucketCandidate, selectAnchoredAuto } from './auto-selection-policy.mjs';

const errors=[];
function strictLethal(rows){
  return rows.reduce((b,a)=>!b||a.triggerTtk<b.triggerTtk?a:b,null);
}
function run(rows){
  const lethal=strictLethal(rows); const buckets=new Map();
  for(const a of rows) offerAutoBucketCandidate(buckets,a);
  return {lethal,win:selectAnchoredAuto(buckets,lethal)};
}
const chain=[
  {buildId:'A',triggerTtk:100,opticEligible:true,opticFit:80,beamIndex:30,ttk:90,btk:4,damage:25,lowTtk:100,practical:0,points:100},
  {buildId:'B',triggerTtk:110,opticEligible:true,opticFit:85,beamIndex:20,ttk:100,btk:4,damage:25,lowTtk:110,practical:0,points:100},
  {buildId:'C',triggerTtk:121,opticEligible:true,opticFit:90,beamIndex:10,ttk:111,btk:4,damage:25,lowTtk:121,practical:0,points:100},
];
const x=run(chain);
if(x.lethal.buildId!=='A') errors.push(`chain lethal floor ${x.lethal.buildId}/A`);
if(x.win.buildId!=='B') errors.push(`anchored chain winner ${x.win.buildId}/B; transitive drift returned`);
if(x.win.triggerTtk/x.lethal.triggerTtk>1.120001) errors.push('anchored chain escaped 12% global floor');
const shrink=[
  {buildId:'oldFloor',triggerTtk:120,opticEligible:true,opticFit:80,beamIndex:30,ttk:100,btk:4,damage:25,lowTtk:120,practical:0,points:100},
  {buildId:'control',triggerTtk:130,opticEligible:true,opticFit:100,beamIndex:1,ttk:110,btk:4,damage:25,lowTtk:130,practical:0,points:100},
  {buildId:'newFloor',triggerTtk:100,opticEligible:true,opticFit:75,beamIndex:40,ttk:90,btk:4,damage:25,lowTtk:100,practical:0,points:100},
];
const y=run(shrink);
if(y.lethal.buildId!=='newFloor') errors.push('shrinking floor did not update strict lethal winner');
if(y.win.buildId==='control') errors.push('candidate outside new global 12% floor survived');
const same=[
  {buildId:'badControl',triggerTtk:105,opticEligible:true,opticFit:80,beamIndex:30,ttk:95,btk:4,damage:25,lowTtk:105,practical:0,points:90},
  {buildId:'goodControl',triggerTtk:105,opticEligible:true,opticFit:90,beamIndex:20,ttk:95,btk:4,damage:25,lowTtk:105,practical:0,points:100},
];
const z=run(same);
if(z.win.buildId!=='goodControl') errors.push('same-trigger bucket failed to retain best controllability row');
const builder=await readFile('scripts/build-combat-cache.mjs','utf8');
const globalSrc=await readFile('scripts/audit-global.mjs','utf8');
if(!builder.includes("from './auto-selection-policy.mjs'")) errors.push('production builder is not importing the tested AUTO policy');
if(!builder.includes('selectAnchoredAuto(autoBuckets[d],bestLethal[d])')) errors.push('builder is not selecting AUTO from globally anchored buckets');
if(builder.includes('function betterAtDistance')) errors.push('legacy pairwise drifting comparator still exists');
if(!globalSrc.includes('at/lt<=1.120001')) errors.push('global gate missing absolute 12% AUTO ceiling');
if(errors.length){ console.error('FINAL GATE POLICY AUDIT FAILED'); errors.forEach(e=>console.error('-',e)); process.exit(1); }
console.log('FINAL GATE POLICY PASS • production AUTO policy anchored to strict global lethal floor • 100→110→121 drift rejected');
