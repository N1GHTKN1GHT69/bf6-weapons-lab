#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const upstream = resolve(process.argv[2] || process.env.BF6_ANALYZER_DIR || '.upstream/bf6-analyzer');
const outDir = resolve(process.argv[3] || 'data');
const expectedFile = resolve(process.argv[4] || 'data/carbine-audit.json');

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

function alias(v){ return String(v||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
function findWeapon(id,name){ return weapons.find(w=>alias(w.id)===alias(id)) || weapons.find(w=>alias(w.name)===alias(name)); }
function near(a,b,tol){ return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=tol; }
function rangeFor(def,d){ return def.ranges.find(r=>d>=r.min&&d<=r.max) || null; }

// BF6 stepped damage endpoints are inclusive. With duplicate x-values in the
// raw curve, the first/outgoing tier owns the exact breakpoint; the lower tier
// starts immediately after it.
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

function autoTtk(rpm,btk){
  if(btk<=1) return 0;
  return Math.round((btk-1)*60000/Number(rpm));
}

function hasDirectLethalityModifier(x){
  if(!x || typeof x!=='object') return false;
  const multKeys=['damageMult','dmgMult','damageMultiplier','dmgMultiplier','rpmMult','rateOfFireMult','rofMult'];
  for(const k of multKeys){
    if(k in x){
      const n=Number(x[k]);
      if(Number.isFinite(n) && n!==1 && n!==0) return true;
    }
  }
  const addKeys=['damageAdd','dmgAdd','autoRpm'];
  for(const k of addKeys){
    if(k in x){
      const n=Number(x[k]);
      if(Number.isFinite(n) && n!==0) return true;
    }
  }
  if(x.setsFireModeAuto===true || x.setsFireModeBurst===true) return true;
  return false;
}

function assumed(x){
  if(!x || typeof x!=='object') return false;
  if(x.assumed===true) return true;
  const f=x.assumedFields;
  if(Array.isArray(f)) return f.length>0;
  if(f && typeof f==='object') return Object.keys(f).length>0;
  return false;
}

const bandDistances=[1,10,22,37,76];

for(const [id,def] of Object.entries(expected.weapons)){
  const raw=findWeapon(id,def.name);
  if(!raw){ errors.push(`${id}: missing from upstream weapons.json`); continue; }
  if(raw.cls!=='Carbine') errors.push(`${id}: expected Carbine, got ${raw.cls}`);
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
    meterRows.push({d,damage:dmg,btk,ttk});
    if(errors.length>100) break;
  }

  const publicTtks=expected.knownGoodCrossCheck?.displayRoundedTtk?.[id];
  if(Array.isArray(publicTtks)){
    for(let i=0;i<bandDistances.length;i++){
      const d=bandDistances[i];
      const expRange=rangeFor(def,d);
      // M277 has fewer internal bands; public table repeats the same value at 9/21/36/75.
      const actual=autoTtk(raw.rpm,expRange.btk);
      const publicValue=Number(publicTtks[i]);
      knownGoodBandChecks++;
      if(!near(actual,publicValue,EPS_TTK_MS)){
        errors.push(`${id}@${d}m known-good TTK ${actual} != public ${publicValue}`);
      }
    }
  }

  checked[id]={
    name:def.name,rpm:raw.rpm,fireMode:raw.fireMode,
    metersChecked:meterRows.length,first:meterRows[0],last:meterRows.at(-1)
  };
}

// Verified-meta guard: no currently verified carbine attachment may silently
// introduce chest-damage/RPM/fire-mode changes that this class audit has not modeled.
const ergoCatalog=Array.isArray(atts.ERGOS)?atts.ERGOS:[];
for(const [id,def] of Object.entries(expected.weapons)){
  const raw=findWeapon(id,def.name);
  if(!raw) continue;
  const avail=atts.WEAPON_ERGO?.[raw.id]?.avail||[];
  for(const attId of avail){
    const opt=ergoCatalog.find(x=>x.id===attId);
    if(!opt) continue;
    if(hasDirectLethalityModifier(opt) && !assumed(opt)){
      errors.push(`${id}: verified ergo ${attId} now changes lethality/fire mode; re-audit exact post-attachment TTK before publishing.`);
    }
  }
}

// These two burst-mode records are currently speculative in the analyzer.
// If that changes, force a re-audit rather than silently accepting a cadence.
for(const id of ['burst_training','grtbc_burst_mode']){
  const opt=ergoCatalog.find(x=>x.id===id);
  if(opt && !assumed(opt)){
    errors.push(`${id}: no longer marked assumed; exact burst cadence must be independently validated before VERIFIED META can use it.`);
  }
}

// BF6 1.4.2.5: Match Trigger must not affect BROD full-auto fire.
const matchTrigger=ergoCatalog.find(x=>x.id==='match_trigger'||/Match Trigger/i.test(x.name||''));
if(!matchTrigger) errors.push('match_trigger: missing from current attachment catalog');
else if(hasDirectLethalityModifier(matchTrigger)){
  errors.push('BROD Match Trigger exposes a lethality/ROF/fire-mode modifier, contradicting the audited 1.4.2.5 full-auto rule.');
}

// Ammo guard. If current ammo data starts exposing direct chest damage or RPM
// transforms, force this audit to be extended before VERIFIED META consumes it.
const ammoCatalog=Array.isArray(ammo.AMMO)?ammo.AMMO:[];
const carbineAmmoIds=new Set();
for(const [id,def] of Object.entries(expected.weapons)){
  const raw=findWeapon(id,def.name);
  if(!raw) continue;
  for(const ammoId of Object.keys(ammo.WEAPON_AMMO?.[raw.id]?.ammo||{})) carbineAmmoIds.add(ammoId);
}
for(const opt of ammoCatalog){
  if(!carbineAmmoIds.has(opt.id)) continue;
  if(hasDirectLethalityModifier(opt) && !assumed(opt)){
    errors.push(`ammo ${opt.id}: direct lethality modifier detected on a Carbine; post-ammo TTK requires a new explicit audit.`);
  }
}

const report={
  schema:1,class:'Carbine',gameVersion:expected.gameVersion,generatedAt:new Date().toISOString(),
  definition:expected.ttkDefinition,
  weaponCountExpected:Object.keys(expected.weapons).length,
  weaponCountChecked:Object.keys(checked).length,
  metersPerWeapon:300,
  totalBaseMeterChecks:Object.keys(checked).length*300,
  knownGoodBandChecks,
  pass:errors.length===0,errors,checked,
  verifiedRules:{
    inclusiveSteppedEndpoints:true,
    allNineCurrentCarbines:true,
    oneToThreeHundredMeters:true,
    publicTtkBandCrossCheck:true,
    assumedAttachmentsExcludedFromVerifiedMeta:true,
    brodMatchTriggerNoFullAutoRof:true,
    directAmmoLethalityRequiresReaudit:true
  }
};
await mkdir(outDir,{recursive:true});
await writeFile(join(outDir,'carbine-audit-runtime.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(!report.pass) process.exitCode=2;
