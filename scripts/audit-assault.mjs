#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const upstream = resolve(process.argv[2] || process.env.BF6_ANALYZER_DIR || '.upstream/bf6-analyzer');
const outDir = resolve(process.argv[3] || 'data');
const expectedFile = resolve(process.argv[4] || 'data/assault-audit.json');
const weapons = JSON.parse(await readFile(join(upstream,'data/weapons.json'),'utf8'));
const atts = JSON.parse(await readFile(join(upstream,'data/attachments.json'),'utf8'));
const expected = JSON.parse(await readFile(expectedFile,'utf8'));

const EPS_DAMAGE = 0.03;
const EPS_RPM = 0.7;
const EPS_TTK_MS = 1;
const errors = [];
const checked = {};

function alias(v){ return String(v||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
function findWeapon(id,name){ return weapons.find(w=>alias(w.id)===alias(id)) || weapons.find(w=>alias(w.name)===alias(name)); }

// Correct stepped-curve rule for duplicate breakpoints: at exactly the shared
// breakpoint use the first/outgoing tier; the lower tier starts just after it.
function steppedDamageAt(raw,d){
  const pts=(raw?.dmg||[]).map((x,i)=>({r:Number(x.r),d:Number(x.d),i})).filter(x=>Number.isFinite(x.r)&&Number.isFinite(x.d)).sort((a,b)=>a.r-b.r||a.i-b.i);
  if(!pts.length) return null;
  if(d<=pts[0].r) return pts[0].d;
  let previous=pts[0];
  for(let i=1;i<pts.length;i++){
    const p=pts[i];
    if(d < p.r) return previous.d;
    if(d === p.r) return p.d; // first point at a repeated endpoint is the outgoing tier
    previous=p;
  }
  return previous.d;
}

function rangeFor(def,d){ return def.ranges.find(r=>d>=r.min&&d<=r.max) || null; }
function baseTtk(raw,btk){
  if(btk<=1) return 0;
  const rpm=Number(raw.rpm);
  if(raw.fireMode==='burst' && Number(raw.burstRounds)>0 && Number(raw.burstBurstsPerMinute)>0){
    const rounds=Number(raw.burstRounds), intra=60000/Number(raw.burstRpm||rpm), cycle=60000/Number(raw.burstBurstsPerMinute);
    const idx=btk-1;
    return Math.round((Math.floor(idx/rounds)*cycle + (idx%rounds)*intra));
  }
  return Math.round((btk-1)*60000/rpm);
}
function autoTtk(rpm,btk){ return Math.round((btk-1)*60000/Number(rpm)); }
function near(a,b,tol){ return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=tol; }

for(const [id,def] of Object.entries(expected.weapons)){
  const raw=findWeapon(id,def.name);
  if(!raw){ errors.push(`${id}: missing from upstream weapons.json`); continue; }
  if(raw.cls!=='Assault Rifle') errors.push(`${id}: expected Assault Rifle, got ${raw.cls}`);
  if(!near(Number(raw.rpm),Number(def.rpm),EPS_RPM)) errors.push(`${id}: RPM ${raw.rpm} != audited ${def.rpm}`);
  if(def.mode==='burst'){
    if(raw.fireMode!=='burst') errors.push(`${id}: expected base burst mode, got ${raw.fireMode}`);
    if(Number(raw.burstRounds)!==Number(def.burstRounds)) errors.push(`${id}: burstRounds ${raw.burstRounds} != ${def.burstRounds}`);
    if(!near(Number(raw.burstBurstsPerMinute),Number(def.burstBurstsPerMinute),0.8)) errors.push(`${id}: burst cadence ${raw.burstBurstsPerMinute} != ${def.burstBurstsPerMinute}`);
  }
  const meterRows=[];
  for(let d=1;d<=300;d++){
    const exp=rangeFor(def,d);
    if(!exp){ errors.push(`${id}: no audited range at ${d}m`); break; }
    const dmg=steppedDamageAt(raw,d);
    const btk=dmg>0?Math.ceil((100-1e-9)/dmg):null;
    const ttk=btk?baseTtk(raw,btk):null;
    if(!near(dmg,Number(exp.damage),EPS_DAMAGE)) errors.push(`${id}@${d}m damage ${dmg} != ${exp.damage}`);
    if(btk!==Number(exp.btk)) errors.push(`${id}@${d}m BTK ${btk} != ${exp.btk}`);
    if(!near(ttk,Number(exp.ttk),EPS_TTK_MS)) errors.push(`${id}@${d}m TTK ${ttk} != ${exp.ttk}`);
    meterRows.push({d,damage:dmg,btk,ttk});
    if(errors.length>100) break;
  }
  if(def.optimized){
    const ergo=(atts.ERGOS||[]).find(x=>x.id===def.optimized.attachmentId || x.name===def.optimized.attachment);
    const offered=(atts.WEAPON_ERGO?.[raw.id]?.avail||[]).includes(def.optimized.attachmentId);
    if(!ergo) errors.push(`${id}: ${def.optimized.attachment} missing from ERGOS`);
    else {
      if(Number(ergo.pts)!==Number(def.optimized.points)) errors.push(`${id}: A3 points ${ergo.pts} != ${def.optimized.points}`);
      if(ergo.setsFireModeAuto!==true) errors.push(`${id}: A3 Receiver is not marked setsFireModeAuto`);
      if(ergo.assumed===true) errors.push(`${id}: verified A3 Receiver unexpectedly marked assumed`);
    }
    if(!offered) errors.push(`${id}: A3 Receiver not offered to M16A4`);
    for(const r of def.optimized.ranges){
      const t=autoTtk(def.rpm,r.btk);
      if(!near(t,Number(r.ttk),EPS_TTK_MS)) errors.push(`${id} optimized ${r.min}-${r.max}m TTK ${t} != ${r.ttk}`);
    }
  }
  checked[id]={name:def.name,rpm:raw.rpm,fireMode:raw.fireMode,metersChecked:meterRows.length,first:meterRows[0],last:meterRows.at(-1)};
}

// Guard current special-fire-mode assumptions that must never enter verified auto-meta.
const burstTraining=(atts.ERGOS||[]).find(x=>x.id==='burst_training' || /Burst Training/i.test(x.name||''));
if(burstTraining && burstTraining.assumed!==true) errors.push('Burst Training is no longer marked assumed; re-audit its real cadence before allowing it into verified auto-meta.');

const matchTrigger=(atts.ERGOS||[]).find(x=>x.id==='match_trigger' || /Match Trigger/i.test(x.name||''));
if(matchTrigger){
  const changesFullAuto = ['rpmMult','rateOfFireMult','rofMult','autoRpm'].some(k=>Number.isFinite(Number(matchTrigger[k])) && Number(matchTrigger[k])!==1 && Number(matchTrigger[k])!==0);
  if(changesFullAuto) errors.push('Match Trigger exposes a full-auto ROF modifier; 1.4.2.5 says it must not affect EF88 full-auto fire.');
}

const report={
  schema:1,class:'Assault Rifle',gameVersion:expected.gameVersion,generatedAt:new Date().toISOString(),
  definition:expected.ttkDefinition,weaponCountExpected:Object.keys(expected.weapons).length,weaponCountChecked:Object.keys(checked).length,
  metersPerWeapon:300,totalBaseMeterChecks:Object.keys(checked).length*300,
  pass:errors.length===0,errors,checked,
  verifiedRules:{inclusiveSteppedEndpoints:true,assumedAttachmentsExcludedFromVerifiedMeta:true,m16A3FullAutoAudited:true,ef88MatchTriggerNoFullAutoRof:true}
};
await mkdir(outDir,{recursive:true});
await writeFile(join(outDir,'assault-audit-runtime.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(!report.pass) process.exitCode=2;
