#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const errors=[];
function checkAuto(auto,lethal,label){
  const at=Number(auto.triggerTtk), lt=Number(lethal.triggerTtk);
  if(!(Number.isFinite(at)&&Number.isFinite(lt))) return;
  if(at<=lt+1e-6) return;
  const near=lt>0 ? at/lt<=1.120001 : false;
  if(!near){ errors.push(`${label}: outside 12% window`); return; }
  const betterOptic=Number(auto.opticFit)>Number(lethal.opticFit)+1e-9;
  const betterBeam=Number(auto.beamIndex)<Number(lethal.beamIndex)-1e-9;
  if(!betterOptic&&!betterBeam) errors.push(`${label}: slower without optic/beam improvement`);
}
function checkKnownLethal(lethal,baseline,label){
  if(Number(lethal.ttk)>Number(baseline)) errors.push(`${label}: strict lethal winner slower than known optimized baseline`);
}

checkAuto({triggerTtk:110,opticFit:90,beamIndex:20},{triggerTtk:100,opticFit:80,beamIndex:25},'valid optic tradeoff');
checkAuto({triggerTtk:110,opticFit:80,beamIndex:20},{triggerTtk:100,opticFit:80,beamIndex:25},'valid beam tradeoff');
const before=errors.length;
checkAuto({triggerTtk:110,opticFit:80,beamIndex:25},{triggerTtk:100,opticFit:80,beamIndex:25},'invalid no-benefit tradeoff');
if(errors.length!==before+1) errors.push('policy test failed to reject slower AUTO with no control benefit');
const before2=errors.length;
checkAuto({triggerTtk:113,opticFit:100,beamIndex:0},{triggerTtk:100,opticFit:80,beamIndex:25},'invalid >12% tradeoff');
if(errors.length!==before2+1) errors.push('policy test failed to reject >12% AUTO tradeoff');
checkKnownLethal({ttk:233},233,'known lethal pass');
const before3=errors.length;
checkKnownLethal({ttk:240},233,'known lethal fail');
if(errors.length!==before3+1) errors.push('policy test failed to reject strict lethal regression');

// Remove the expected negative-test messages; anything else is a real failure.
const expectedPrefixes=['invalid no-benefit tradeoff:','invalid >12% tradeoff:','known lethal fail:'];
for(let i=errors.length-1;i>=0;i--) if(expectedPrefixes.some(p=>errors[i].startsWith(p))) errors.splice(i,1);

const globalSrc=await readFile('scripts/audit-global.mjs','utf8');
const builderSrc=await readFile('scripts/build-combat-cache.mjs','utf8');
if(!globalSrc.includes('const lethal=cw.bestLethal?.[String(meter)]')) errors.push('global gate is not checking independent optimized baselines against bestLethal');
if(globalSrc.includes('optimized winner missing')) errors.push('legacy exact-attachment AUTO assertion still present');
if(!globalSrc.includes('at/lt<=1.120001')) errors.push('global gate missing 12% AUTO tradeoff ceiling');
if(!globalSrc.includes('betterOptic')||!globalSrc.includes('betterBeam')) errors.push('global gate missing control-benefit requirement');
if(!builderSrc.includes('slowest / fastest <= 1.12')) errors.push('builder 12% laserbeam policy changed without updating final gate');

if(errors.length){
  console.error('FINAL GATE POLICY AUDIT FAILED');
  errors.forEach(e=>console.error('-',e));
  process.exit(1);
}
console.log('FINAL GATE POLICY PASS • strict bestLethal baseline + bounded AUTO laserbeam tradeoff aligned');
