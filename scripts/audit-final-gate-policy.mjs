#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { offerAutoBucketCandidate, selectAnchoredAuto, laserbeamUtilityCost } from './auto-selection-policy.mjs';

const errors=[];
function strictLethal(rows){ return rows.reduce((b,a)=>!b||a.triggerTtk<b.triggerTtk?a:b,null); }
function run(rows){ const lethal=strictLethal(rows); const buckets=new Map(); for(const a of rows) offerAutoBucketCandidate(buckets,a); return {lethal,win:selectAnchoredAuto(buckets,lethal)}; }
const chain=[
  {buildId:'A',triggerTtk:100,opticEligible:true,opticFit:80,beamIndex:30,ttk:90,btk:4,damage:25,lowTtk:100,practical:0,points:100},
  {buildId:'B',triggerTtk:110,opticEligible:true,opticFit:85,beamIndex:20,ttk:100,btk:4,damage:25,lowTtk:110,practical:0,points:100},
  {buildId:'C',triggerTtk:121,opticEligible:true,opticFit:90,beamIndex:10,ttk:111,btk:4,damage:25,lowTtk:121,practical:0,points:100},
];
const x=run(chain);
if(x.lethal.buildId!=='A') errors.push(`chain lethal floor ${x.lethal.buildId}/A`);
if(x.win.buildId!=='B') errors.push(`anchored utility winner ${x.win.buildId}/B`);
if(x.win.triggerTtk/x.lethal.triggerTtk>1.120001) errors.push('anchored chain escaped 12% global floor');
const tiny=[
  {buildId:'fast',triggerTtk:100,opticEligible:true,opticFit:100,beamIndex:5,ttk:90,btk:4,damage:25,lowTtk:100,practical:0,points:100},
  {buildId:'tinyGain',triggerTtk:110,opticEligible:true,opticFit:100,beamIndex:4.98,ttk:100,btk:4,damage:25,lowTtk:110,practical:0,points:100},
];
const t=run(tiny); if(t.win.buildId!=='fast') errors.push('tiny Beam gain bought a 10% lethal sacrifice');
const strong=[
  {buildId:'fast',triggerTtk:100,opticEligible:true,opticFit:100,beamIndex:5,ttk:90,btk:4,damage:25,lowTtk:100,practical:0,points:100},
  {buildId:'laser',triggerTtk:108,opticEligible:true,opticFit:100,beamIndex:2.5,ttk:98,btk:4,damage:25,lowTtk:108,practical:0,points:100},
];
const q=run(strong); if(q.win.buildId!=='laser') errors.push('large Beam gain could not justify valid 8% tradeoff');
if(laserbeamUtilityCost(q.win.triggerTtk,q.win.beamIndex)>laserbeamUtilityCost(q.lethal.triggerTtk,q.lethal.beamIndex)+1e-9) errors.push('AUTO winner has worse stable utility than lethal floor');
const same=[
  {buildId:'badControl',triggerTtk:105,opticEligible:true,opticFit:80,beamIndex:30,ttk:95,btk:4,damage:25,lowTtk:105,practical:0,points:90},
  {buildId:'goodControl',triggerTtk:105,opticEligible:true,opticFit:90,beamIndex:20,ttk:95,btk:4,damage:25,lowTtk:105,practical:0,points:100},
];
const z=run(same); if(z.win.buildId!=='goodControl') errors.push('same-trigger bucket failed to retain best controllability row');
const builder=await readFile('scripts/build-combat-cache.mjs','utf8');
const globalSrc=await readFile('scripts/audit-global.mjs','utf8');
if(!builder.includes("from './auto-selection-policy.mjs'")) errors.push('production builder is not importing the tested AUTO policy');
if(!builder.includes('selectAnchoredAuto(autoBuckets[d],bestLethal[d])')) errors.push('builder is not selecting AUTO from anchored buckets');
if(!globalSrc.includes('laserbeamUtilityCost')) errors.push('global gate is not validating stable AUTO utility');
if(errors.length){ console.error('FINAL GATE POLICY AUDIT FAILED'); errors.forEach(e=>console.error('-',e)); process.exit(1); }
console.log('FINAL GATE POLICY PASS • strict lethal floor • 12% ceiling • percentage-weighted Beam tradeoff • tiny-gain sacrifice rejected');
