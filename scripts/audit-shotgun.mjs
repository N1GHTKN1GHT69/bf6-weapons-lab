#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { loadEffectiveWeapons } from './source-overlay.mjs';

const upstream=resolve(process.argv[2]||'.upstream/bf6-analyzer');
const outDir=resolve(process.argv[3]||'data');
const baselinePath=resolve(process.argv[4]||'data/shotgun-audit.json');
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const baseline=await json(baselinePath);
// EFFECTIVE dataset: upstream mirror + versioned source overlays, i.e. exactly the
// numbers the product ships. Auditing the bare mirror would pass against values
// the app never displays. See scripts/source-overlay.mjs.
const weapons=loadEffectiveWeapons(join(upstream,'data/weapons.json'), join(outDir,'source-overlays.json'));
const ammo=await json(join(upstream,'data/ammo.json'));
const errors=[];
const aliases={m87a1:'m87a1',m1014:'m1014','185ksk':'ks18k',db12:'db12'};
const eps=.011;

function curveDamage(curve,d){
  const pts=(curve||[]).map(x=>Array.isArray(x)?{r:Number(x[0]),d:Number(x[1])}:{r:Number(x.r),d:Number(x.d)}).filter(x=>Number.isFinite(x.r)&&Number.isFinite(x.d));
  if(!pts.length)return null;
  if(d<=pts[0].r)return pts[0].d;
  let prev=pts[0];
  for(let i=1;i<pts.length;i++){
    const p=pts[i];
    if(d<p.r)return prev.d;
    if(d===p.r)return p.d;
    prev=p;
  }
  return prev.d;
}
function rangeAt(ranges,d){return (ranges||[]).find(r=>d>=Number(r.min)&&d<=Number(r.max))||null;}
function nthMs(cad,shots){
  if(!Number.isFinite(shots)||shots<=1)return 0;
  if(cad?.type==='paired'){
    const idx=shots-1;
    return Math.round(Math.floor(idx/2)*Number(cad.pairCycleMs)+(idx%2)*(60000/Number(cad.pairRpm)));
  }
  return Math.round((shots-1)*60000/Number(cad?.rpm));
}
function near(a,b,t=eps){return Number.isFinite(Number(a))&&Number.isFinite(Number(b))&&Math.abs(Number(a)-Number(b))<=t;}

let sourceMeterChecks=0,verifiedAmmoMeterChecks=0;
for(const [labId,def] of Object.entries(baseline.weapons||{})){
  const upstreamId=aliases[labId]||def.upstreamId||labId;
  const w=weapons.find(x=>x.id===upstreamId);
  if(!w){errors.push(`${labId}: upstream weapon ${upstreamId} missing`);continue;}
  if(w.cls!=='Shotgun')errors.push(`${labId}: upstream class=${w.cls}`);
  const pellets=Number(w.pellets)||1;
  if(pellets!==16)errors.push(`${labId}: upstream pellets ${pellets}, expected 16`);
  const legalAmmo=Object.keys(ammo.WEAPON_AMMO?.[upstreamId]?.ammo||{});
  for(const id of ['buckshot','flechette','slugs','buckshot_00']) if(!legalAmmo.includes(id)) errors.push(`${labId}: legal ammo missing ${id}`);

  // The Analyzer base raw curve is #01 Buckshot per pellet. Cross-check every integer meter.
  for(let d=1;d<=300;d++){
    const expected=rangeAt(def.ammoProfiles?.buckshot?.ranges,d);
    const upstreamShell=curveDamage(w.dmg,d)*pellets;
    sourceMeterChecks++;
    if(!expected||!near(upstreamShell,expected.damage)) errors.push(`${labId}@${d}m: upstream #01 shell ${upstreamShell} != baseline ${expected?.damage}`);
  }

  for(const ammoId of baseline.verifiedAmmoIds||[]){
    const profile=def.ammoProfiles?.[ammoId];
    if(!profile?.verified){errors.push(`${labId}/${ammoId}: verified profile missing`);continue;}
    for(let d=1;d<=300;d++){
      const r=rangeAt(profile.ranges,d);
      verifiedAmmoMeterChecks++;
      if(!r){errors.push(`${labId}/${ammoId}@${d}m: range hole`);continue;}
      const btk=Math.ceil((100-1e-9)/Number(r.damage));
      const ttk=nthMs(def.cadence,btk);
      if(btk!==Number(r.btk))errors.push(`${labId}/${ammoId}@${d}m: BTK ${r.btk} != ${btk}`);
      if(ttk!==Number(r.ttk))errors.push(`${labId}/${ammoId}@${d}m: TTK ${r.ttk} != ${ttk}`);
    }
  }
  if(def.ammoProfiles?.buckshot_00?.verified!==false)errors.push(`${labId}: #00 must fail closed`);
}
if(baseline.crossClassEligible!==false)errors.push('Shotgun crossClassEligible must remain false until spread/hit-probability model is validated');
const runtime={schema:1,class:'Shotgun',gameVersion:baseline.gameVersion,generatedAt:new Date().toISOString(),pass:errors.length===0,weaponCount:Object.keys(baseline.weapons||{}).length,sourceMeterChecks,verifiedAmmoMeterChecks,excludedAmmo:Object.keys(baseline.excludedAmmo||{}),errors};
await mkdir(outDir,{recursive:true});
await writeFile(join(outDir,'shotgun-audit-runtime.json'),JSON.stringify(runtime,null,2)+'\n');
console.log(JSON.stringify(runtime,null,2));
if(errors.length)process.exitCode=2;
