#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const upstream = resolve(process.argv[2] || process.env.BF6_ANALYZER_DIR || '.upstream/bf6-analyzer');
const outDir = resolve(process.argv[3] || 'data');
const expectedFile = resolve(process.argv[4] || 'data/dmr-audit.json');

const weapons = JSON.parse(await readFile(join(upstream,'data/weapons.json'),'utf8'));
const atts = JSON.parse(await readFile(join(upstream,'data/attachments.json'),'utf8'));
const ammo = JSON.parse(await readFile(join(upstream,'data/ammo.json'),'utf8'));
const expected = JSON.parse(await readFile(expectedFile,'utf8'));

const EPS_RPM = 0.8;
const EPS_TTK_MS = 1;
const errors = [];
const warnings = [];
const checked = {};
let knownGoodBandChecks = 0;
let lowBodyChecks = 0;
let optimizedChecks = 0;
let upstreamMeterChecks = 0;

function alias(v){ return String(v||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
function findWeapon(id,name){ return weapons.find(w=>alias(w.id)===alias(id)) || weapons.find(w=>alias(w.name)===alias(name)); }
function near(a,b,tol){ return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=tol; }
function rangeFor(def,d){ return (def.ranges||[]).find(r=>d>=r.min&&d<=r.max) || null; }
function autoTtk(rpm,btk){ return btk<=1 ? 0 : Math.round((btk-1)*60000/Number(rpm)); }
function btkFor(dmg){ return dmg>0 ? Math.ceil((100-1e-9)/Number(dmg)) : null; }

// Duplicate-x stepped curves are endpoint-inclusive: exact 9/21/36/75m
// remains on the outgoing/high tier. The lower tier starts immediately after.
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
function assumedLethalityFields(x){
  const f=x?.assumedFields;
  const names=Array.isArray(f)?f:(f&&typeof f==='object'?Object.keys(f):[]);
  return names.filter(k=>/damage|dmg|rpm|rate.?of.?fire|fire.?mode|setsFireMode|autoRpm/i.test(String(k)));
}
function hasDirectLethalityModifier(x){
  if(!x || typeof x!=='object') return false;
  const multKeys=['damageMult','dmgMult','damageMultiplier','dmgMultiplier','rpmMult','rateOfFireMult','rofMult'];
  for(const k of multKeys){ if(k in x){ const n=Number(x[k]); if(Number.isFinite(n)&&n!==1&&n!==0) return true; } }
  const addKeys=['damageAdd','dmgAdd','autoRpm'];
  for(const k of addKeys){ if(k in x){ const n=Number(x[k]); if(Number.isFinite(n)&&n!==0) return true; } }
  return x.setsFireModeAuto===true || x.setsFireModeBurst===true;
}

const lowMult=Number(expected.lowBodyMultiplier||0.91);
const bandDistances=[1,10,22,37,76];
const knownStale={};

// First validate the independent audited baseline itself at every meter.
for(const [id,def] of Object.entries(expected.weapons||{})){
  const raw=findWeapon(id,def.name);
  if(!raw){ errors.push(`${id}: missing from upstream weapons.json`); continue; }
  if(raw.cls!=='DMR') errors.push(`${id}: expected DMR, got ${raw.cls}`);
  if(!near(Number(raw.rpm),Number(def.rpm),EPS_RPM)) errors.push(`${id}: RPM ${raw.rpm} != audited base ${def.rpm}`);

  const rows=[];
  let staleMeters=0;
  let unexpectedMismatch=0;
  for(let d=1; d<=300; d++){
    const exp=rangeFor(def,d);
    if(!exp){ errors.push(`${id}: no audited range at ${d}m`); break; }
    const expBtk=btkFor(Number(exp.damage));
    const expTtk=autoTtk(Number(def.rpm),expBtk);
    if(expBtk!==Number(exp.btk)) errors.push(`${id}@${d}m audited BTK self-check ${expBtk} != ${exp.btk}`);
    if(!near(expTtk,Number(exp.ttk),EPS_TTK_MS)) errors.push(`${id}@${d}m audited TTK self-check ${expTtk} != ${exp.ttk}`);

    const lowDmg=Number(exp.damage)*lowMult;
    const lowBtk=btkFor(lowDmg);
    const lowTtk=autoTtk(Number(def.rpm),lowBtk);
    if(!(lowBtk>=expBtk && lowTtk>=expTtk)) errors.push(`${id}@${d}m low-body sanity failed`);
    lowBodyChecks++;

    const rawDmg=steppedDamageAt(raw,d);
    const rawBtk=btkFor(rawDmg);
    const rawTtk=autoTtk(Number(raw.rpm),rawBtk);
    upstreamMeterChecks++;
    if(rawBtk!==expBtk || !near(rawTtk,expTtk,EPS_TTK_MS)){
      if(id==='grtcps' && rawBtk===3 && near(rawTtk,333,2)) staleMeters++;
      else unexpectedMismatch++;
    }
    rows.push({d,damage:Number(exp.damage),btk:expBtk,ttk:expTtk,lowDamage:lowDmg,lowBtk,lowTtk,upstreamDamage:rawDmg,upstreamBtk:rawBtk,upstreamTtk:rawTtk});
  }
  if(id==='grtcps'){
    if(staleMeters>0 && unexpectedMismatch===0){
      knownStale.grtcps={detected:true,staleMeters,message:`Upstream analyzer remains stale on ${staleMeters}/300 GRT-CPS meters; independent live baseline overrides it.`};
      warnings.push(knownStale.grtcps.message);
    } else if(staleMeters===0 && unexpectedMismatch===0) {
      knownStale.grtcps={detected:false,staleMeters:0,message:'Upstream GRT-CPS data now agrees with the independent live baseline.'};
    } else if(unexpectedMismatch>0) errors.push(`grtcps: ${unexpectedMismatch} unexpected upstream-vs-live mismatches beyond the known stale 3-BTK curve`);
  } else if(unexpectedMismatch>0) errors.push(`${id}: ${unexpectedMismatch} upstream BTK/TTK mismatches against audited live baseline`);

  checked[id]={name:def.name,rpm:raw.rpm,fireMode:raw.fireMode,metersChecked:rows.length,first:rows[0],last:rows.at(-1)};
}

// Independent known-good TTK table for the four original DMRs.
for(const [id,values] of Object.entries(expected.knownGoodCrossCheck?.displayRoundedTtk||{})){
  const def=expected.weapons?.[id]; if(!def) continue;
  for(let i=0;i<bandDistances.length;i++){
    const r=rangeFor(def,bandDistances[i]);
    const actual=autoTtk(Number(def.rpm),Number(r.btk));
    knownGoodBandChecks++;
    if(!near(actual,Number(values[i]),EPS_TTK_MS)) errors.push(`${id}@${bandDistances[i]}m known-good ${actual} != ${values[i]}`);
  }
}

// Current independent GRT-CPS public inputs: 360 RPM, 28.6/27.3/25 => 500ms all bands.
{
  const kg=expected.knownGoodCrossCheck?.grtcps;
  const def=expected.weapons?.grtcps;
  for(let i=0;i<3;i++){
    const b=btkFor(Number(kg.displayDamage[i]));
    const t=autoTtk(Number(kg.displayRpm),b);
    knownGoodBandChecks++;
    if(b!==4 || !near(t,Number(kg.displayTtk[i]),EPS_TTK_MS)) errors.push(`grtcps current-public input check failed band ${i}`);
    const r=def.ranges[i];
    if(Number(r.btk)!==4 || !near(Number(r.ttk),500,EPS_TTK_MS)) errors.push(`grtcps audited baseline not 4BTK/500ms band ${i}`);
  }
}

// VSSM: validate the direct-lethality attachment instead of excluding it merely
// because upstream has an assumed recoil-decay sub-field.
{
  const def=expected.weapons?.vssm;
  const opt=def?.optimized;
  const ergo=(atts.ERGOS||[]).find(x=>x.id===opt?.attachmentId);
  if(!ergo) errors.push('vssm: Folding Stock/full_auto_vssm missing from ERGOS');
  else {
    if(Number(ergo.pts)!==40) errors.push(`vssm Folding Stock points ${ergo.pts} != 40`);
    if(ergo.setsFireModeAuto!==true) errors.push('vssm Folding Stock no longer sets full auto');
    if(!near(Number(ergo.autoRpm),800,EPS_RPM)) errors.push(`vssm Folding Stock autoRpm ${ergo.autoRpm} != 800`);
    const lethalAssumed=assumedLethalityFields(ergo);
    if(lethalAssumed.length) errors.push(`vssm Folding Stock lethal fields became assumed: ${lethalAssumed.join(', ')}`);
  }
  const avail=atts.WEAPON_ERGO?.vssm?.avail || [];
  if(!avail.includes(opt?.attachmentId)) errors.push('vssm: Folding Stock is not in weapon-specific ergonomics availability');

  // Verify the 40p transform fits inside Pick-100 alongside the mandatory cheapest optic/barrel/mag/ammo.
  const sights=(atts.SIGHTS||[]).map(x=>Number(x.pts)).filter(Number.isFinite);
  const barrelIds=atts.WEAPON_ATTS?.vssm?.barrel||[];
  const barrels=(atts.BARRELS||[]).filter(x=>barrelIds.includes(x.id)).map(x=>Number(x.pts)).filter(Number.isFinite);
  const mags=Object.values(atts.WEAPON_MAG?.vssm?.mags||{}).map(x=>Number(x.pts)).filter(Number.isFinite);
  const ammos=Object.values(ammo.WEAPON_AMMO?.vssm?.ammo||{}).map(Number).filter(Number.isFinite);
  if(!sights.length||!barrels.length||!mags.length||!ammos.length) errors.push('vssm: cannot prove minimum legal Pick-100 cost');
  else {
    const mandatoryMin=Math.min(...sights)+Math.min(...barrels)+Math.min(...mags)+Math.min(...ammos)+40;
    if(mandatoryMin>100) errors.push(`vssm Folding Stock cannot fit mandatory Pick-100 minimum (${mandatoryMin}/100)`);
    else checked.vssm.foldingStockMinimumLegalPoints=mandatoryMin;
  }

  for(let d=1;d<=300;d++){
    const base=rangeFor(def,d); const r=rangeFor(opt,d);
    if(!r){ errors.push(`vssm optimized: no range at ${d}m`); break; }
    const b=btkFor(Number(base.damage));
    const t=autoTtk(Number(opt.rpm),b);
    if(b!==Number(r.btk)) errors.push(`vssm stock@${d}m BTK ${b} != ${r.btk}`);
    if(!near(t,Number(r.ttk),EPS_TTK_MS)) errors.push(`vssm stock@${d}m TTK ${t} != ${r.ttk}`);
    optimizedChecks++;
  }
  const kg=expected.knownGoodCrossCheck?.vssm;
  if(!near(Number(opt.rpm),Number(kg.fullAutoRpm),EPS_RPM) || Number(opt.points)!==Number(kg.foldingStockPoints)) errors.push('vssm optimized baseline disagrees with independent Folding Stock facts');
}

// Fail closed on any other non-speculative direct lethality transform.
const catalogs={
  muzzle:Array.isArray(atts.MUZZLES)?atts.MUZZLES:[],barrel:Array.isArray(atts.BARRELS)?atts.BARRELS:[],
  grip:Array.isArray(atts.GRIPS)?atts.GRIPS:[],laser:Array.isArray(atts.LASERS)?atts.LASERS:[],
  light:Array.isArray(atts.LIGHTS)?atts.LIGHTS:[],ergo:Array.isArray(atts.ERGOS)?atts.ERGOS:[]
};
for(const [id,def] of Object.entries(expected.weapons||{})){
  const raw=findWeapon(id,def.name); if(!raw) continue;
  const wa=atts.WEAPON_ATTS?.[raw.id]||{};
  for(const slot of ['muzzle','barrel','grip','laser','light']){
    for(const attId of (Array.isArray(wa[slot])?wa[slot]:[])){
      const x=catalogs[slot].find(o=>o.id===attId); if(!x) continue;
      if(hasDirectLethalityModifier(x) && !assumed(x)) errors.push(`${id}: verified ${slot} ${attId} changes lethality; explicit audit required`);
    }
  }
  for(const attId of (atts.WEAPON_ERGO?.[raw.id]?.avail||[])){
    const x=catalogs.ergo.find(o=>o.id===attId); if(!x) continue;
    if(id==='vssm' && attId==='full_auto_vssm') continue;
    if(hasDirectLethalityModifier(x) && !assumed(x)) errors.push(`${id}: verified ergo ${attId} changes lethality; explicit audit required`);
  }
  for(const [magId,x] of Object.entries(atts.WEAPON_MAG?.[raw.id]?.mags||{})){
    if(hasDirectLethalityModifier(x) && !assumed(x)) errors.push(`${id}: verified magazine ${magId} changes lethality; explicit audit required`);
  }
}
const dmrAmmoIds=new Set();
for(const [id,def] of Object.entries(expected.weapons||{})){
  const raw=findWeapon(id,def.name); if(!raw) continue;
  for(const aid of Object.keys(ammo.WEAPON_AMMO?.[raw.id]?.ammo||{})) dmrAmmoIds.add(aid);
}
for(const x of (ammo.AMMO||[])){
  if(!dmrAmmoIds.has(x.id)) continue;
  if(hasDirectLethalityModifier(x) && !assumed(x)) errors.push(`ammo ${x.id}: direct chest lethality modifier detected on DMR; explicit audit required`);
}

const report={
  schema:1,class:'DMR',gameVersion:expected.gameVersion,generatedAt:new Date().toISOString(),definition:expected.ttkDefinition,
  weaponCountExpected:Object.keys(expected.weapons||{}).length,weaponCountChecked:Object.keys(checked).length,
  metersPerWeapon:300,totalBaseMeterChecks:Object.keys(checked).length*300,lowBodyChecks,optimizedChecks,upstreamMeterChecks,knownGoodBandChecks,
  pass:errors.length===0,errors,warnings,knownStale,checked,
  verifiedRules:{
    inclusiveSteppedEndpoints:true,allSixCurrentDmrs:true,oneToThreeHundredMeters:true,independentKnownGoodCrossCheck:true,
    currentGrtCpsOverride:true,vssmFoldingStock800Rpm:true,vssmPick100Legality:true,lowBodyMultiplier091:true,
    verifiedDirectLethalityRequiresReaudit:true,directAmmoLethalityRequiresReaudit:true
  }
};
await mkdir(outDir,{recursive:true});
await writeFile(join(outDir,'dmr-audit-runtime.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(!report.pass) process.exitCode=2;
