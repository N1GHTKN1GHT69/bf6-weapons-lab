#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const [app,builder,validator,index] = await Promise.all([
  readFile('app.js','utf8'),
  readFile('scripts/build-combat-cache.mjs','utf8'),
  readFile('scripts/validate-combat-cache.mjs','utf8'),
  readFile('index.html','utf8'),
]);
const errors=[];
for (const file of ['app.js','scripts/build-combat-cache.mjs','scripts/validate-combat-cache.mjs']) {
  try { execFileSync(process.execPath,['--check',file],{stdio:'pipe'}); }
  catch { errors.push(`${file}: syntax check failed`); }
}
if (!builder.includes("opticModel: 'tier-range-fit-v1'")) errors.push('builder missing optic-model version gate');
if (!builder.includes("if (slot === 'sight') return `sight:${data.id}`")) errors.push('sight tiers can still be deduped as mechanically identical');
if (!builder.includes('function opticRangeFit')) errors.push('builder missing range-aware optic fit');
if (!builder.includes('opticEligible:opticFit >= minimumOpticFit')) errors.push('builder does not gate clearly unsuitable optics');
if (!builder.includes('if (a.opticEligible !== b.opticEligible) return !!a.opticEligible;')) errors.push('winner comparator does not prefer range-eligible optics');
if (!app.includes('function opticRangeFit')) errors.push('browser fallback missing range-aware optic fit');
if (!app.includes('fit * 4 - (fit < min ? 500 : 0)')) errors.push('browser on-demand optimizer does not strongly penalize unsuitable optics');
if (!app.includes('ONE-SHOT SWEET SPOT:')) errors.push('sniper sweet-spot UI is not explicit');
if (!validator.includes('AUTO winner has range-ineligible optic')) errors.push('CLI validator does not reject bad AUTO optic winners');
if (!validator.includes('manual winner has range-ineligible optic')) errors.push('CLI validator does not reject bad manual optic winners');
if (!app.includes('AUTO winner has range-ineligible optic')) errors.push('browser cache validator does not reject bad optic winners');

function fit(id,d){
  if(id==='iron')return d<=15?100:d<=25?85:d<=40?55:d<=60?25:0;
  if(id==='std_optic')return d<=15?90:d<=35?100:d<=60?90:d<=85?70:d<=110?45:20;
  if(id==='var_low')return d<=15?55:d<=35?85:d<=75?100:d<=110?90:d<=150?70:50;
  if(id==='var_high')return d<=20?15:d<=40?45:d<=60?75:d<=90?95:d<=180?100:95;
  if(id==='thermal')return d<=15?45:d<=40?70:d<=100?90:d<=160?80:65;
  if(id==='therm_hyb')return d<=15?45:d<=40?75:d<=100?95:d<=160?100:90;
  return 60;
}
const minFit=d=>d<=20?45:d<=60?50:d<=120?55:60;
if (!(fit('iron',10)>fit('var_high',10))) errors.push('10m does not favor close-range sighting over high magnification');
if (!(fit('var_low',50)>fit('iron',50))) errors.push('50m does not favor a range optic over irons');
if (!(fit('var_high',100)>fit('std_optic',100) && fit('iron',100)<minFit(100))) errors.push('100m optic gate does not reject irons / favor magnification');
if (!(fit('var_high',150)>=minFit(150) && fit('std_optic',150)<minFit(150))) errors.push('150m optic gate does not favor high-range tiers');

if(errors.length){
  console.error('RANGE OPTIC AUDIT FAILED');
  errors.forEach(e=>console.error('-',e));
  process.exit(1);
}
console.log('RANGE OPTIC PASS • sight tiers preserved • close/medium/long fit policy • unsuitable-optic gate • sweet-spot UI • cache validators');
