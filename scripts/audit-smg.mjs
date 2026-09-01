#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const upstream = resolve(process.argv[2] || process.env.BF6_ANALYZER_DIR || '.upstream/bf6-analyzer');
const outDir = resolve(process.argv[3] || 'data');
const expectedFile = resolve(process.argv[4] || 'data/smg-audit.json');

const weapons = JSON.parse(await readFile(join(upstream,'data/weapons.json'),'utf8'));
const atts = JSON.parse(await readFile(join(upstream,'data/attachments.json'),'utf8'));
const ammo = JSON.parse(await readFile(join(upstream,'data/ammo.json'),'utf8'));
const expected = JSON.parse(await readFile(expectedFile,'utf8'));

const EPS_DAMAGE = 0.03;
const EPS_RPM = 0.7;
const EPS_TTK_MS = 1;
const errors = [];
const checked = {};
let knownGoodBandChecks = 0;
let lowBodyChecks = 0;

function alias(v){ return String(v||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
function findWeapon(id,name){ return weapons.find(w=>alias(w.id)===alias(id)) || weapons.find(w=>alias(w.name)===alias(name)); }
function near(a,b,tol){ return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=tol; }
function rangeFor(def,d){ return def.ranges.find(r=>d>=r.min&&d<=r.max) || null; }
function autoTtk(rpm,btk){ return btk<=1 ? 0 : Math.round((btk-1)*60000/Number(rpm)); }

// Duplicate-x stepped curves are endpoint-inclusive: at exactly 9/21/36/75m
// the first/outgoing damage value still owns the breakpoint. The lower tier
// begins immediately after the endpoint.
function steppedDamageAt(raw,d){
  const pts=(raw?.dmg||[])
    .map((x,i)=>({r:Number(x.r),d:Number(x.d),i}))
    .filter(x=>Number.isFinite(x.r)&&Number.isFinite(x.d))
    .sort((a,b)=>a.r-b.r||a.i-b.i);
  if(!pts.length) return null;
  if(d<=pts[0].r) return pts[0].d;
  let previous=pts[0];
  for(let i=1;i<pts.length;i++){
    const p=pts[i];
    if(d < p.r) return previous.d;
    if(d === p.r) return p.d;
    previous=p;
  }
  return previous.d;
}

function assumed(x){
  if(!x || typeof x!=='object') return false;
  if(x.assumed===true) return true;
  const f=x.assumedFields;
  if(Array.isArray(f)) return f.length>0;
  if(f && typeof f==='object') return Object.keys(f).length>0;
  return false;
}

function hasDirectLethalityModifier(x){
  if(!x || typeof x!=='object') return false;
  const multKeys=['damageMult','dmgMult','damageMultiplier','dmgMultiplier','rpmMult','rateOfFireMult','rofMult'];
  for(const k of multKeys){
    if(k in x){ const n=Number(x[k]); if(Number.isFinite(n) && n!==1 && n!==0) return true; }
  }
  const addKeys=['damageAdd','dmgAdd','autoRpm'];
  for(const k of addKeys){
    if(k in x){ const n=Number(x[k]); if(Number.isFinite(n) && n!==0) return true; }
  }
  if(x.setsFireModeAuto===true || x.setsFireModeBurst===true) return true;
  return false;
}

const bandDistances=[1,10,22,37,76];
const lowMult=Number(expected.lowBodyMultiplier||0.84);

for(const [id,def] of Object.entries(expected.weapons)){
  const raw=findWeapon(id,def.name);
  if(!raw){ errors.push(`${id}: missing from upstream weapons.json`); continue; }
  if(raw.cls!=='SMG') errors.push(`${id}: expected SMG, got ${raw.cls}`);
  if(raw.fireMode!=='auto') errors.push(`${id}: expected full-auto base weapon, got ${raw.fireMode}`);
  if(!near(Number(raw.rpm),Number(def.rpm),EPS_RPM)) errors.push(`${id}: RPM ${raw.rpm} != audited ${def.rpm}`);

  const meterRows=[];
  for(let d=1;d<=300;d++){
    const exp=rangeFor(def,d);
    if(!exp){ errors.push(`${id}: no audited range at ${d}m`); break; }
    const dmg=steppedDamageAt(raw,d);
    const btk=dmg>0?Math.ceil((100-1e-9)/dmg):null;
    const ttk=btk?autoTtk(raw.rpm,btk):null;
    if(!near(dmg,Number(exp.damage),EPS_DAMAGE)) errors.push(`${id}@${d}m damage ${dmg} != ${exp.damage}`);
    if(btk!==Number(exp.btk)) errors.push(`${id}@${d}m BTK ${btk} != ${exp.btk}`);
    if(!near(ttk,Number(exp.ttk),EPS_TTK_MS)) errors.push(`${id}@${d}m TTK ${ttk} != ${exp.ttk}`);

    // Also sanity-check the low-body value the website displays. Automatic
    // primaries use the current 0.84 low-body multiplier.
    const lowDmg=dmg*lowMult;
    const lowBtk=Math.ceil((100-1e-9)/lowDmg);
    const lowTtk=autoTtk(raw.rpm,lowBtk);
    if(!(lowBtk>=btk && lowTtk>=ttk)) errors.push(`${id}@${d}m low-body TTK sanity failed`);
    lowBodyChecks++;

    meterRows.push({d,damage:dmg,btk,ttk,lowDamage:lowDmg,lowBtk,lowTtk});
    if(errors.length>100) break;
  }

  const publicTtks=expected.knownGoodCrossCheck?.displayRoundedTtk?.[id];
  if(Array.isArray(publicTtks)){
    for(let i=0;i<bandDistances.length;i++){
      const d=bandDistances[i];
      const expRange=rangeFor(def,d);
      const actual=autoTtk(raw.rpm,expRange.btk);
      const publicValue=Number(publicTtks[i]);
      knownGoodBandChecks++;
      if(!near(actual,publicValue,EPS_TTK_MS)) errors.push(`${id}@${d}m known-good TTK ${actual} != public ${publicValue}`);
    }
  }
  if(id==='cz3a1'){
    const actual=autoTtk(raw.rpm,rangeFor(def,1).btk);
    knownGoodBandChecks++;
    if(!near(actual,Number(expected.knownGoodCrossCheck?.cz3a1CloseTtk),EPS_TTK_MS)) errors.push(`cz3a1 close known-good TTK ${actual} mismatch`);
  }
  if(id==='pp19'){
    const actual=autoTtk(raw.rpm,rangeFor(def,1).btk);
    knownGoodBandChecks++;
    if(!near(actual,Number(expected.knownGoodCrossCheck?.pp19CloseTtk),EPS_TTK_MS)) errors.push(`pp19 close known-good TTK ${actual} mismatch`);
  }

  checked[id]={name:def.name,rpm:raw.rpm,fireMode:raw.fireMode,metersChecked:meterRows.length,first:meterRows[0],last:meterRows.at(-1)};
}

// Fail closed if any verified attachment currently available to an SMG gains a
// direct chest-damage, full-auto RPM, or fire-mode transform that this audit has
// not explicitly modeled. Assumed/speculative records are excluded by the site.
const catalogs={
  muzzle:Array.isArray(atts.MUZZLES)?atts.MUZZLES:[],
  barrel:Array.isArray(atts.BARRELS)?atts.BARRELS:[],
  grip:Array.isArray(atts.GRIPS)?atts.GRIPS:[],
  laser:Array.isArray(atts.LASERS)?atts.LASERS:[],
  light:Array.isArray(atts.LIGHTS)?atts.LIGHTS:[],
  ergo:Array.isArray(atts.ERGOS)?atts.ERGOS:[]
};
for(const [id,def] of Object.entries(expected.weapons)){
  const raw=findWeapon(id,def.name); if(!raw) continue;
  const wa=atts.WEAPON_ATTS?.[raw.id]||{};
  for(const slot of ['muzzle','barrel','grip','laser','light']){
    for(const attId of (Array.isArray(wa[slot])?wa[slot]:[])){
      const opt=catalogs[slot].find(x=>x.id===attId); if(!opt) continue;
      if(hasDirectLethalityModifier(opt) && !assumed(opt)) errors.push(`${id}: verified ${slot} ${attId} changes lethality/fire mode; explicit post-attachment TTK audit required.`);
    }
  }
  for(const attId of (atts.WEAPON_ERGO?.[raw.id]?.avail||[])){
    const opt=catalogs.ergo.find(x=>x.id===attId); if(!opt) continue;
    if(hasDirectLethalityModifier(opt) && !assumed(opt)) errors.push(`${id}: verified ergo ${attId} changes lethality/fire mode; explicit post-attachment TTK audit required.`);
  }
  for(const [magId,opt] of Object.entries(atts.WEAPON_MAG?.[raw.id]?.mags||{})){
    if(hasDirectLethalityModifier(opt) && !assumed(opt)) errors.push(`${id}: verified magazine ${magId} changes lethality/fire mode; explicit post-attachment TTK audit required.`);
  }
}

// Current Burst Training/Burst Mode math remains speculative in the analyzer.
// If upstream marks either as verified, stop publishing until cadence is audited.
for(const id of ['burst_training','burst_mode']){
  const opt=catalogs.ergo.find(x=>x.id===id);
  if(opt && !assumed(opt)) errors.push(`${id}: no longer marked assumed; exact burst cadence must be independently validated before VERIFIED META can use it.`);
}

// Ammo guard: headshot/penetration/velocity utility is fine; a verified chest
// damage or RPM transform requires an explicit post-ammo TTK audit.
const ammoCatalog=Array.isArray(ammo.AMMO)?ammo.AMMO:[];
const smgAmmoIds=new Set();
for(const [id,def] of Object.entries(expected.weapons)){
  const raw=findWeapon(id,def.name); if(!raw) continue;
  for(const ammoId of Object.keys(ammo.WEAPON_AMMO?.[raw.id]?.ammo||{})) smgAmmoIds.add(ammoId);
}
for(const opt of ammoCatalog){
  if(!smgAmmoIds.has(opt.id)) continue;
  if(hasDirectLethalityModifier(opt) && !assumed(opt)) errors.push(`ammo ${opt.id}: direct lethality modifier detected on an SMG; explicit post-ammo TTK audit required.`);
}

const report={
  schema:1,class:'SMG',gameVersion:expected.gameVersion,generatedAt:new Date().toISOString(),definition:expected.ttkDefinition,
  weaponCountExpected:Object.keys(expected.weapons).length,weaponCountChecked:Object.keys(checked).length,
  metersPerWeapon:300,totalBaseMeterChecks:Object.keys(checked).length*300,lowBodyChecks,knownGoodBandChecks,
  pass:errors.length===0,errors,checked,
  verifiedRules:{
    inclusiveSteppedEndpoints:true,allTenCurrentSmgs:true,oneToThreeHundredMeters:true,
    independentKnownGoodCrossCheck:true,lowBodySanity:true,assumedBurstAttachmentsExcluded:true,
    verifiedDirectLethalityRequiresReaudit:true,directAmmoLethalityRequiresReaudit:true
  }
};
await mkdir(outDir,{recursive:true});
await writeFile(join(outDir,'smg-audit-runtime.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(!report.pass) process.exitCode=2;
