#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const upstream = resolve(process.argv[2] || process.env.BF6_ANALYZER_DIR || '.upstream/bf6-analyzer');
const outDir = resolve(process.argv[3] || 'data');
const expectedFile = resolve(process.argv[4] || 'data/sidearm-audit.json');
const weapons = JSON.parse(await readFile(join(upstream,'data/weapons.json'),'utf8'));
const expected = JSON.parse(await readFile(expectedFile,'utf8'));
const EPS_DAMAGE=0.03, EPS_RPM=0.7, EPS_TTK_MS=1;
const errors=[], checked={};
function alias(v){return String(v||'').toLowerCase().replace(/[^a-z0-9]/g,'');}
function findWeapon(id,name){return weapons.find(w=>alias(w.id)===alias(id)) || weapons.find(w=>alias(w.name)===alias(name));}
function steppedDamageAt(raw,d){
  const pts=(raw?.dmg||[]).map((x,i)=>({r:Number(x.r),d:Number(x.d),i})).filter(x=>Number.isFinite(x.r)&&Number.isFinite(x.d)).sort((a,b)=>a.r-b.r||a.i-b.i);
  if(!pts.length)return null;
  if(d<=pts[0].r)return pts[0].d;
  let previous=pts[0];
  for(let i=1;i<pts.length;i++){const p=pts[i]; if(d<p.r)return previous.d; if(d===p.r)return p.d; previous=p;}
  return previous.d;
}
function rangeFor(def,d){return def.ranges.find(r=>d>=r.min&&d<=r.max)||null;}
function ttk(rpm,btk){return btk<=1?0:Math.round((btk-1)*60000/Number(rpm));}
function near(a,b,tol){return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=tol;}
for(const [id,def] of Object.entries(expected.weapons)){
  const raw=findWeapon(id,def.name);
  if(!raw){errors.push(`${id}: missing from upstream weapons.json`);continue;}
  if(raw.cls!=='Sidearm')errors.push(`${id}: expected upstream class Sidearm, got ${raw.cls}`);
  if(!near(Number(raw.rpm),Number(def.rpm),EPS_RPM))errors.push(`${id}: RPM ${raw.rpm} != audited ${def.rpm}`);
  if(raw.fireMode!==def.mode)errors.push(`${id}: fireMode ${raw.fireMode} != audited ${def.mode}`);
  let meters=0;
  for(let d=1;d<=300;d++){
    const exp=rangeFor(def,d); if(!exp){errors.push(`${id}: no audited range at ${d}m`);break;}
    const damage=steppedDamageAt(raw,d);
    const btk=damage>0?Math.ceil((100-1e-9)/damage):null;
    const t=btk?ttk(raw.rpm,btk):null;
    if(!near(damage,Number(exp.damage),EPS_DAMAGE))errors.push(`${id}@${d}m damage ${damage} != ${exp.damage}`);
    if(btk!==Number(exp.btk))errors.push(`${id}@${d}m BTK ${btk} != ${exp.btk}`);
    if(!near(t,Number(exp.ttk),EPS_TTK_MS))errors.push(`${id}@${d}m TTK ${t} != ${exp.ttk}`);
    meters++;
    if(errors.length>100)break;
  }
  checked[id]={name:raw.name,rpm:raw.rpm,fireMode:raw.fireMode,metersChecked:meters};
}
const upstreamSidearms=weapons.filter(w=>w.cls==='Sidearm');
if(upstreamSidearms.length!==Object.keys(expected.weapons).length) errors.push(`upstream Sidearm count ${upstreamSidearms.length} != audited ${Object.keys(expected.weapons).length}`);
const report={schema:1,class:'Sidearm',gameVersion:expected.gameVersion,generatedAt:new Date().toISOString(),definition:expected.ttkDefinition,weaponCountExpected:Object.keys(expected.weapons).length,weaponCountChecked:Object.keys(checked).length,metersPerWeapon:300,totalBaseMeterChecks:Object.keys(checked).length*300,pass:errors.length===0,errors,checked,verifiedRules:{inclusiveSteppedEndpoints:true,currentSidearmClassLabel:true,baseMechanicalTtk:true}};
await mkdir(outDir,{recursive:true});
await writeFile(join(outDir,'sidearm-audit-runtime.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(!report.pass)process.exitCode=2;
