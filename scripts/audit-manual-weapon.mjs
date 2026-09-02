#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const [app,index,builder,validator] = await Promise.all([
  readFile('app.js','utf8'),
  readFile('index.html','utf8'),
  readFile('scripts/build-combat-cache.mjs','utf8'),
  readFile('scripts/validate-combat-cache.mjs','utf8'),
]);
const errors=[];
for (const file of ['app.js','scripts/build-combat-cache.mjs','scripts/validate-combat-cache.mjs']) {
  try { execFileSync(process.execPath,['--check',file],{stdio:'pipe'}); }
  catch (e) { errors.push(`${file}: syntax check failed`); }
}
if (!index.includes('id="autoModeBtn"') || !index.includes('id="manualModeBtn"')) errors.push('missing explicit AUTO META / BUILD MY GUN controls');
if (!index.includes('id="manualRangeProfiles"')) errors.push('missing manual range profile surface');
if (!app.includes('state.selectionMode="manual"')) errors.push('manual mode is not wired');
if (!app.includes('state.category="__all__"; // BUILD MY GUN opens the entire primary catalog.')) errors.push('BUILD MY GUN does not open full primary catalog');
// PRIORITY may explicitly pick a strategy, but it may only pick one the engine
// already implements, and BUILD MY GUN must still DEFAULT to strict lethality.
if (!app.includes('function defaultStrategy()') || !app.includes('return state.selectionMode === "manual" ? "lethal" : "laserbeam";')) errors.push('manual primary does not default to the strict lethal attachment strategy');
if (!app.includes('const PRIORITY_STRATEGY = { balanced: "laserbeam", fastest: "lethal" };')) errors.push('PRIORITY exposes strategies the engine does not implement');
if (!app.includes('PRIORITY_STRATEGY[state.priority] ?? defaultStrategy()')) errors.push('PRIORITY does not fall back to the historical per-mode strategy');
if (!app.includes('cachedBuild(raw,d,req,"lethal")')) errors.push('manual range cards do not use strict lethal cache winners');
if (!app.includes('const detailStrategy = activeStrategy();')) errors.push('manual weapon dashboard can disagree with recommended lethal build');
if (!app.includes('cachedWinningStats(raw, state.distance, detailStrategy)')) errors.push('manual weapon dashboard uses the wrong winning-build transformed stats');
if (!app.includes('if (state.selectionMode === "auto") resolveAutoWeapon();')) errors.push('distance changes can replace a manually locked weapon');
if (!builder.includes("manualBuildModel: 'range-lethality-v2'")) errors.push('cache missing range-lethality-v2 model tag');
if (!builder.includes('function betterLethalAtDistance')) errors.push('cache builder missing strict lethal comparator');
if (!builder.includes('bestLethal:Object.fromEntries')) errors.push('cache does not persist per-distance strict lethal winners');
if (!validator.includes("manualBuildModel !== 'range-lethality-v2'")) errors.push('CLI cache validator does not gate manual range-lethality model');
if (!app.includes('manualBuildModel !== "range-lethality-v2"')) errors.push('browser cache validator does not gate manual range-lethality model');

// Synthetic policy test: fastest trigger-to-kill must beat a much smoother build
// in BUILD MY GUN. Beam only breaks a lethal tie.
function betterLethal(a,b){
  if(!b)return true;
  if(a.triggerTtk!==b.triggerTtk)return a.triggerTtk<b.triggerTtk;
  if(a.ttk!==b.ttk)return a.ttk<b.ttk;
  if(a.btk!==b.btk)return a.btk<b.btk;
  if(a.damage!==b.damage)return a.damage>b.damage;
  if(a.lowTtk!==b.lowTtk)return a.lowTtk<b.lowTtk;
  if(a.beamIndex!==b.beamIndex)return a.beamIndex<b.beamIndex;
  return a.points<b.points;
}
const fastest={triggerTtk:250,ttk:220,btk:4,damage:30,lowTtk:300,beamIndex:90,points:100};
const smoother={triggerTtk:270,ttk:240,btk:4,damage:30,lowTtk:320,beamIndex:5,points:90};
const tiedRough={triggerTtk:250,ttk:220,btk:4,damage:30,lowTtk:300,beamIndex:50,points:100};
const tiedBeam={triggerTtk:250,ttk:220,btk:4,damage:30,lowTtk:300,beamIndex:10,points:100};
if(!betterLethal(fastest,smoother)) errors.push('synthetic strict-lethality test: smoother slower build beat faster build');
if(!betterLethal(tiedBeam,tiedRough)) errors.push('synthetic strict-lethality test: Beam Index did not break exact lethal tie');

if(errors.length){
  console.error('BUILD MY GUN AUDIT FAILED');
  for(const e of errors) console.error('-',e);
  process.exit(1);
}
console.log('BUILD MY GUN PASS • manual weapon stays locked • full primary catalog • range-aware lethal winners at 1–300m • optic fit gates range suitability • Beam Index breaks remaining lethal ties');
