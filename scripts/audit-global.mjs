#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const errors=[];
const norm=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]/g,'');
const loadWindowJs=async path=>{
  const src=await readFile(path,'utf8');
  const context={window:{}};
  vm.runInNewContext(src,context,{filename:path});
  return {window:context.window,src};
};
const json=async p=>JSON.parse(await readFile(p,'utf8'));

const {window:rosterWin}=await loadWindowJs('roster-data.js');
const {window:classWin}=await loadWindowJs('class-data.js');
const app=await readFile('app.js','utf8');
const builder=await readFile('scripts/build-combat-cache.mjs','utf8');
const current=rosterWin.BF6_CURRENT;
const loadout=classWin.BF6_LOADOUT_DATA;
const ballistics=await json('data/ballistics.json');
if(!current?.roster) errors.push('missing BF6_CURRENT roster');
if(current?.roster?.length!==current?.rosterCount) errors.push(`roster ${current?.roster?.length}/${current?.rosterCount}`);
const ids=current?.roster?.map(x=>x.id)??[];
if(new Set(ids).size!==ids.length) errors.push('duplicate roster ids');
const names=current?.roster?.map(x=>norm(x.name))??[];
if(new Set(names).size!==names.length) errors.push('duplicate normalized roster names');

const primary=(current?.roster??[]).filter(w=>w.cls!=='Secondary');
const secondaries=(current?.roster??[]).filter(w=>w.cls==='Secondary');
if(primary.length!==56) errors.push(`expected 56 primaries, found ${primary.length}`);
if(secondaries.length!==7) errors.push(`expected 7 secondaries, found ${secondaries.length}`);

if(ballistics?.baseline!=="current-live") errors.push(`ballistics baseline ${ballistics?.baseline||"missing"} is not current-live`);
if(!Number.isFinite(Number(ballistics?.baseDragPerMeter)) || Number(ballistics.baseDragPerMeter)<=0) errors.push('invalid base projectile drag');
const ballisticIds=new Set((ballistics?.weaponIds??[]).map(norm));
for(const id of ['m2010esr','sv98','psr','miniscout','l115']) if(!ballisticIds.has(norm(id))) errors.push(`${id}: missing from verified ballistics list`);

const auditFiles={
  'Assault Rifle':'data/assault-audit.json', Carbine:'data/carbine-audit.json', SMG:'data/smg-audit.json',
  LMG:'data/lmg-audit.json', DMR:'data/dmr-audit.json', 'Sniper Rifle':'data/sniper-audit.json',
  Shotgun:'data/shotgun-audit.json', Secondary:'data/sidearm-audit.json'
};
const audits={};
for(const [cls,path] of Object.entries(auditFiles)){
  const a=await json(path); audits[cls]=a;
  if(a.pass!==true) errors.push(`${cls}: audit not passing`);
}
if(audits.Shotgun.crossClassEligible!==false) errors.push('Shotgun must remain crossClassEligible=false until spread/pellet probability is verified');
for(const [cls,a] of Object.entries(audits)) if(a.gameVersion!==current.liveVersion) errors.push(`${cls}: audit version ${a.gameVersion||'missing'} != live ${current.liveVersion}`);

function findDef(a,w){
  const keys=new Set([w.id,w.name,...(w.aliases??[])].map(norm));
  for(const [id,d] of Object.entries(a.weapons??{})) if(keys.has(norm(id))||keys.has(norm(d?.name))||keys.has(norm(d?.upstreamId))) return d;
  return null;
}
const cacheEligibleRoster=(current?.roster??[]).filter(w=>{
  const a=audits[w.cls] ?? (w.cls==='Secondary' ? audits.Secondary : null);
  const d=a ? findDef(a,w) : null;
  return d?.confidence !== 'empirical-current';
});
if(cacheEligibleRoster.length!==62) errors.push(`expected 62 cache-eligible verified/raw-backed weapons, found ${cacheEligibleRoster.length}`);
function curveDamage(curve,meter){
  const pts=(curve??[]).map(x=>({r:Number(x.r),d:Number(x.d)})).filter(x=>Number.isFinite(x.r)&&Number.isFinite(x.d)).sort((a,b)=>a.r-b.r);
  if(!pts.length) return null;
  if(meter<=pts[0].r) return pts[0].d;
  for(let i=1;i<pts.length;i++){
    const a=pts[i-1],b=pts[i];
    if(meter<=b.r){
      if(b.r===a.r) return b.d;
      const t=(meter-a.r)/(b.r-a.r);
      return a.d+(b.d-a.d)*Math.max(0,Math.min(1,t));
    }
  }
  return pts.at(-1).d;
}

function checkRanges(label,ranges){
  if(!Array.isArray(ranges)||!ranges.length){errors.push(`${label}: missing ranges`);return;}
  let next=1;
  for(const r of ranges){
    if(Number(r.min)!==next) errors.push(`${label}: gap/overlap before ${r.min}`);
    if(!Number.isFinite(Number(r.damage))||Number(r.damage)<=0) errors.push(`${label}: invalid damage`);
    if(!Number.isInteger(Number(r.btk))||Number(r.btk)<1) errors.push(`${label}: invalid btk`);
    if(!Number.isFinite(Number(r.ttk))||Number(r.ttk)<0) errors.push(`${label}: invalid ttk`);
    next=Number(r.max)+1;
  }
  if(next!==301) errors.push(`${label}: coverage ends at ${next-1}m`);
}

for(const w of primary){
  const a=audits[w.cls];
  if(!a){errors.push(`${w.id}: no class audit`);continue;}
  const d=findDef(a,w);
  if(!d){errors.push(`${w.id}: missing from ${w.cls} audit`);continue;}
  if(w.cls==='Sniper Rifle'){
    if(!Array.isArray(d.curve)||d.curve.length<2||!Number.isFinite(Number(d.shotIntervalMs))) errors.push(`${w.id}: incomplete sniper curve/cadence`);
  }else checkRanges(w.id,d.ranges);
}
for(const w of secondaries){
  const d=findDef(audits.Secondary,w);
  if(!d){errors.push(`${w.id}: missing from Sidearm audit`);continue;}
  checkRanges(w.id,d.ranges);
}

const fallback=loadout?.fallbackSecondaries??[];
if(fallback.length!==7) errors.push(`fallback sidearms ${fallback.length}/7`);
for(const f of fallback){
  const roster=secondaries.find(w=>norm(w.id)===norm(f.id)||norm(w.name)===norm(f.name));
  const d=roster?findDef(audits.Secondary,roster):null;
  if(!roster||!d){errors.push(`${f.id}: fallback cannot map to audited sidearm`);continue;}
  if(Math.abs(Number(f.rpm)-Number(d.rpm))>0.01) errors.push(`${f.id}: fallback RPM ${f.rpm} != audit ${d.rpm}`);
}

// Architecture invariants. These protect the exact failure modes found in v1.6.
if(!app.includes('function validateCombatCacheObject(cache)')) errors.push('app missing strict combat-cache integrity gate');
if(!app.includes('modeled !== expected')) errors.push('cache gate does not require complete modeled roster');
if(!app.includes('rawOrRoster?.cls === "Secondary" || rawOrRoster?.cls === "Sidearm"')) errors.push('60-point Sidearm/Secondary budget invariant missing');
const rankPos=app.indexOf('let combat = raw ? cachedCombat(raw, d) : null;');
const auditPos=app.indexOf('if (!combat) combat = auditedRosterCombat(roster, raw, d);',rankPos);
if(rankPos<0||auditPos<rankPos) errors.push('AUTO META is not cache-first');
if(!app.includes('function flightTimeMs(distanceM, velocityMps, dragPerMeter)')) errors.push('generic projectile flight model missing');
if(!app.includes('(a.combat.triggerTtk ?? Infinity) - (b.combat.triggerTtk ?? Infinity)')) errors.push('AUTO META is not trigger-to-impact TTK first');
if(app.includes('if (!combat && raw) combat = combatAtDistance(raw, d);')) errors.push('AUTO META still permits raw cadence/damage bypass');
if(!app.includes('category !== "__all__" || x.combat.ballisticsExact === true')) errors.push('cross-class AUTO does not require verified ballistics');
if(!app.includes('cachedBuild(raw, d, requiredAttachmentId)')) errors.push('optimized build path bypasses exhaustive cache for required lethal attachments');
if(!builder.includes("if (w.cls === 'Sniper Rifle') modified = applyVerifiedSniperLethality(modified);")) errors.push('exhaustive builder does not enforce audited sniper cadence/damage');
if(!builder.includes('const sniperInterval=Number(w?._sniperAuditDef?.shotIntervalMs);')) errors.push('exhaustive builder can leak raw sniper RPM into TTK');

// Optional strict post-build cache gate.
const cachePath=process.argv[2];
if(cachePath){
  const c=await json(cachePath);
  const expected=Number(c?.audit?.weaponsSource), modeled=Number(c?.audit?.modeled), incomplete=Number(c?.audit?.incomplete);
  if(c?.audit?.pass!==true) errors.push('post-build cache audit.pass is false');
  if(c?.source?.gameVersion!==current.liveVersion) errors.push(`post-build cache version ${c?.source?.gameVersion||'missing'} != live ${current.liveVersion}`);
  if(!Number.isInteger(expected)||expected<=0) errors.push('post-build cache invalid weaponsSource');
  if(expected!==cacheEligibleRoster.length) errors.push(`post-build cache eligible roster ${expected}/${cacheEligibleRoster.length}`);
  if(modeled!==expected) errors.push(`post-build cache modeled ${modeled}/${expected}`);
  if(incomplete!==0) errors.push(`post-build cache incomplete ${incomplete}`);
  const cacheEntries=Object.values(c?.weapons??{});
  if(cacheEntries.length!==expected) errors.push(`post-build cache entries ${cacheEntries.length}/${expected}`);
  for(const cw of cacheEntries){
    for(let meter=1;meter<=300;meter++){
      const row=cw?.best?.[String(meter)];
      if(!row) { errors.push(`${cw?.id||'unknown'}: missing ${meter}m`); break; }
      if(!Number.isFinite(Number(row.flightMs))||Number(row.flightMs)<0) { errors.push(`${cw.id}@${meter}: invalid flightMs`); break; }
      if(!Number.isFinite(Number(row.triggerTtk))||Number(row.triggerTtk)<Number(row.ttk)) { errors.push(`${cw.id}@${meter}: invalid triggerTtk`); break; }
    }
  }
  const rosterKeys=new Set(current.roster.flatMap(w=>[norm(w.id),norm(w.name),...(w.aliases??[]).map(norm)]));
  for(const cw of cacheEntries) if(!rosterKeys.has(norm(cw.id))&&!rosterKeys.has(norm(cw.name))) errors.push(`post-build cache unknown weapon ${cw.id||cw.name}`);
  for(const w of cacheEligibleRoster){
    const keys=new Set([w.id,w.name,...(w.aliases??[])].map(norm));
    if(!cacheEntries.some(cw=>keys.has(norm(cw.id))||keys.has(norm(cw.name)))) errors.push(`post-build cache missing eligible weapon ${w.id}`);
  }
  for(const w of cacheEligibleRoster.filter(x=>x.cls==='Sniper Rifle')){
    const def=findDef(audits['Sniper Rifle'],w);
    const keys=new Set([w.id,w.name,...(w.aliases??[])].map(norm));
    const cw=cacheEntries.find(x=>keys.has(norm(x.id))||keys.has(norm(x.name)));
    if(!def||!cw) continue;
    for(let meter=1;meter<=300;meter++){
      const row=cw.best?.[String(meter)];
      if(!row) continue;
      const damage=curveDamage(def.curve,meter);
      const btk=Math.ceil((100-1e-9)/damage);
      const expectedTtk=Math.round((btk-1)*Number(def.shotIntervalMs));
      if(Math.abs(Number(row.damage)-damage)>.01) { errors.push(`${w.id}@${meter}: cache sniper damage ${row.damage} != audit ${damage}`); break; }
      if(Number(row.btk)!==btk) { errors.push(`${w.id}@${meter}: cache sniper BTK ${row.btk} != audit ${btk}`); break; }
      if(Number(row.ttk)!==expectedTtk) { errors.push(`${w.id}@${meter}: cache sniper mech TTK ${row.ttk} != audit ${expectedTtk}`); break; }
    }
  }

  for(const [cls,a] of Object.entries(audits)) for(const [id,d] of Object.entries(a.weapons??{})) {
    const opt=d?.optimized; if(!opt?.ranges) continue;
    const roster=current.roster.find(w=>norm(w.id)===norm(id)||norm(w.name)===norm(d.name)||norm(w.id)===norm(d.upstreamId));
    if(!roster) continue;
    const cw=cacheEntries.find(x=>norm(x.id)===norm(roster.id)||norm(x.name)===norm(roster.name)||norm(x.id)===norm(d.upstreamId));
    if(!cw) continue;
    for(const r of opt.ranges){
      for(let meter=Number(r.min);meter<=Number(r.max);meter++){
        const row=cw.best?.[String(meter)]; if(!row) continue;
        if(Number(row.ttk)>Number(r.ttk)) { errors.push(`${roster.id}@${meter}: cache TTK ${row.ttk} slower than independently verified optimized ${r.ttk}`); break; }
        if(Number(row.ttk)===Number(r.ttk) && r.attachmentId){
          const b=cw.builds?.[row.buildId]; const ids=new Set([...(b?.picks??[]).map(x=>x.id),...Object.values(b?.atts??{})].filter(Boolean));
          if(!ids.has(r.attachmentId)) errors.push(`${roster.id}@${meter}: optimized winner missing ${r.attachmentId}`);
        }
      }
    }
  }
}

if(errors.length){
  console.error('GLOBAL INTEGRITY AUDIT FAILED');
  for(const e of errors) console.error('-',e);
  process.exit(1);
}
console.log(`GLOBAL INTEGRITY PASS • roster ${current.roster.length}/${current.rosterCount} • primaries ${primary.length} • sidearms ${secondaries.length} • all audit mappings covered • cache-first + trigger-to-impact META wiring locked${cachePath?' • exhaustive cache complete':''}`);
