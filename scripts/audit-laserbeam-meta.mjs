#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { laserbeamUtilityCost, weaponMetaCost } from './auto-selection-policy.mjs';

const app = await readFile('app.js','utf8');
const builder = await readFile('scripts/build-combat-cache.mjs','utf8');
const validator = await readFile('scripts/validate-combat-cache.mjs','utf8');
const errors=[];

for (const file of ['app.js','scripts/build-combat-cache.mjs','scripts/validate-combat-cache.mjs','scripts/auto-selection-policy.mjs']) {
  try { execFileSync(process.execPath,['--check',file],{stdio:'pipe'}); }
  catch { errors.push(`${file}: syntax check failed`); }
}
if (!builder.includes("rankingModel: 'laserbeam-v4-stable-utility-range-optics'")) errors.push('builder missing laserbeam-v4-stable-utility-range-optics model tag');
if (!builder.includes('selectedRecoilAmountFor') || !builder.includes('selectedRecoilVariationFor') || !builder.includes('effectiveSpreadMax')) errors.push('builder is not using Analyzer recoil/spread primitives');
if (!builder.includes('beamIndex')) errors.push('builder missing Beam Index');
if (!app.includes('Math.pow(t, 0.55) * Math.pow(b, 0.45)')) errors.push('browser AUTO ranking is not using pool-stable 55/45 percentage utility');
if (!app.includes('baseCost * (offPace ? 1.35 : 1)')) errors.push('browser missing fixed 25%-off-pace competitiveness penalty');
if (!app.includes('buildRankPool("__all__", d)')) errors.push('class filters do not use global reference pool');
if (!app.includes('rankingModel !== "laserbeam-v4-stable-utility-range-optics"')) errors.push('browser does not reject old ranking-model caches');
if (!validator.includes("rankingModel !== 'laserbeam-v4-stable-utility-range-optics'")) errors.push('CLI validator does not reject old ranking-model caches');
if (!validator.includes('invalid beam index')) errors.push('cache validator does not require beam metrics');

// Pool-stability regression: filtering away an unrelated outlier must not change
// the order between A and B when the same global fastest reference is retained.
const fastest=200;
const a={id:'A',ttk:260,beam:1.3};
const b={id:'B',ttk:240,beam:1.7};
const order=(rows)=>rows.map(x=>({...x,cost:weaponMetaCost(x.ttk,x.beam,fastest)})).sort((x,y)=>x.cost-y.cost).map(x=>x.id).join(',');
const o1=order([a,b,{id:'irrelevant',ttk:1200,beam:9}]);
const o2=order([a,b]);
if(o1.split(',').slice(0,2).join(',')!==o2) errors.push(`filter-stability failed: ${o1} vs ${o2}`);

// Percentage utility regression: a tiny Beam gain cannot justify ~10% slower TTK.
const lethal=laserbeamUtilityCost(572.1199,6.711447);
const tinyGain=laserbeamUtilityCost(631.8999,6.706777);
if(!(lethal<tinyGain)) errors.push('tiny Beam gain incorrectly justifies ~10% slower TTK');
// A large control gain can justify a modest lethal tradeoff.
const strongLaser=laserbeamUtilityCost(1027.5146,1.473463);
const strongLethal=laserbeamUtilityCost(930.8117,3.483711);
if(!(strongLaser<strongLethal)) errors.push('large Beam improvement cannot justify valid lethal tradeoff');

if (errors.length) {
  console.error('LASERBEAM META AUDIT FAILED');
  errors.forEach(e=>console.error('-',e));
  process.exit(1);
}
console.log('LASERBEAM META PASS • stable 55/45 percentage utility • filter invariance • recoil/spread primitives • competitiveness penalty • real Phase-B tradeoff regressions');
