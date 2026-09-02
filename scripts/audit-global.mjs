#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { laserbeamUtilityCost } from './auto-selection-policy.mjs';

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
import { buildWeaponSets, evaluateWeaponSets, norm as setNorm } from './roster-sets.mjs';
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
// Counts are derived for reporting. Correctness is enforced by the identity-set
// invariants below, which a substitution cannot slip past the way a count can.
const recognised=new Set([...(current?.primaryClasses??[]),'Secondary']);
for(const w of current?.roster??[]) if(!recognised.has(w.cls)) errors.push(`${w.id}: unrecognised roster class "${w.cls}"`);
if(!primary.length) errors.push('no primary weapons in roster');
if(!secondaries.length) errors.push('no secondary weapons in roster');

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
// Fallback sidearm list must cover exactly the roster's secondary identities.
{
  const want=new Set(secondaries.map(w=>norm(w.name)));
  const have=new Set(fallback.map(f=>norm(f.name)));
  for(const n of want) if(!have.has(n)) errors.push(`fallback sidearms missing roster secondary "${n}"`);
  for(const n of have) if(!want.has(n)) errors.push(`fallback sidearms contain unknown secondary "${n}"`);
}
for(const f of fallback){
  const roster=secondaries.find(w=>norm(w.id)===norm(f.id)||norm(w.name)===norm(f.name));
  const d=roster?findDef(audits.Secondary,roster):null;
  if(!roster||!d){errors.push(`${f.id}: fallback cannot map to audited sidearm`);continue;}
  if(Math.abs(Number(f.rpm)-Number(d.rpm))>0.01) errors.push(`${f.id}: fallback RPM ${f.rpm} != audit ${d.rpm}`);
}

// Architecture invariants. These protect the exact failure modes found in v1.6.
if(!app.includes('function validateCombatCacheObject(cache)')) errors.push('app missing strict combat-cache integrity gate');
if(!app.includes('cache requires atomic local source snapshot')) errors.push('app cache gate does not require the atomic local source snapshot');
if(!app.includes('modeled !== expected')) errors.push('cache gate does not require complete modeled roster');
if(!app.includes('rawOrRoster?.cls === "Secondary" || rawOrRoster?.cls === "Sidearm"')) errors.push('60-point Sidearm/Secondary budget invariant missing');
// Cache-first ordering: the exhaustive cache row must be consulted before the
// class-audit fallback. The row is selected by the active ranking strategy, so
// the call carries a strategy argument, but the ordering requirement is the
// same one this gate has always enforced.
const rankPos=app.indexOf('let combat = raw ? cachedCombat(raw, d, strategy) : null;');
const auditPos=app.indexOf('if (!combat) combat = auditedRosterCombat(roster, raw, d);',rankPos);
if(rankPos<0||auditPos<rankPos) errors.push('AUTO META is not cache-first');
if(!app.includes('function rankingStrategy()')) errors.push('AUTO META ranking cannot follow the selected priority');
if(!app.includes('function flightTimeMs(distanceM, velocityMps, dragPerMeter)')) errors.push('generic projectile flight model missing');
if(!/a\.combat\.triggerTtk\s*\?\?\s*Infinity/.test(app) || !/b\.combat\.triggerTtk\s*\?\?\s*Infinity/.test(app)) errors.push('AUTO META is not trigger-to-impact TTK first');
if(app.includes('if (!combat && raw) combat = combatAtDistance(raw, d);')) errors.push('AUTO META still permits raw cadence/damage bypass');
if(!app.includes('category !== "__all__" || x.combat.ballisticsExact === true')) errors.push('cross-class AUTO does not require verified ballistics');
if(!app.includes('cachedBuild(raw, d, requiredAttachmentId, strategy)')) errors.push('optimized build path bypasses exhaustive cache for required lethal attachments/strategy');
if(!builder.includes("if (w.cls === 'Sniper Rifle') modified = applyVerifiedSniperLethality(modified);")) errors.push('exhaustive builder does not enforce audited sniper cadence/damage');
if(!builder.includes('const sniperInterval=Number(w?._sniperAuditDef?.shotIntervalMs);')) errors.push('exhaustive builder can leak raw sniper RPM into TTK');

// Optional strict post-build cache gate.
const cachePath=process.argv[2];
// Identity-set reconciliation: official expected vs trusted source vs
// combat-eligible vs cache. Replaces the old "must be exactly 62" constant.
const ledgerDoc=await json('data/patch-delta-ledger.json').catch(()=>null);
const sourceWeapons=await json('data/weapons.json');
const auditsByCanonicalClass={...audits, Sidearm:audits.Secondary};
const cacheIdsForSets=cachePath ? Object.keys((await json(cachePath))?.weapons??{}) : null;
const weaponSets=buildWeaponSets({roster:current, weapons:sourceWeapons, ledger:ledgerDoc, audits:auditsByCanonicalClass, cacheIds:cacheIdsForSets});
const ledgerPendingWeaponKeys=new Set();
for(const p of ledgerDoc?.patches??[]) for(const ch of p.changes??[]){
  if(ch.check?.type==='weaponPresent' && ch.check.weaponId && !sourceWeapons.some(w=>setNorm(w.id)===setNorm(ch.check.weaponId))){
    ledgerPendingWeaponKeys.add(setNorm(ch.check.weaponId));
  }
}
const setFindings=evaluateWeaponSets(weaponSets,{ledgerPendingWeaponKeys});
for(const e of setFindings.errors) errors.push(e);
for(const w of setFindings.warnings) console.warn('note:',w);
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
      const lethal=cw?.bestLethal?.[String(meter)];
      if(!lethal||!cw?.builds?.[lethal.buildId]) { errors.push(`${cw?.id||'unknown'}: missing manual max-lethality ${meter}m`); break; }
      if(!Number.isFinite(Number(lethal.triggerTtk))||Number(lethal.triggerTtk)<Number(lethal.ttk)) { errors.push(`${cw.id}@${meter}: invalid manual triggerTtk`); break; }
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

  // Two different winners exist by design:
  // - bestLethal = BUILD MY GUN / strict fastest range-eligible lethal build.
  // - best = AUTO Laserbeam META, which may accept a small trigger->kill tradeoff
  //   for materially better optic fit / recoil-spread controllability.
  // The old post-build gate incorrectly required AUTO best to always equal the
  // fastest mechanical TTK baseline, contradicting the v1.9+ ranking policy.
  for(const [cls,a] of Object.entries(audits)) for(const [id,d] of Object.entries(a.weapons??{})) {
    const opt=d?.optimized; if(!opt?.ranges) continue;
    const roster=current.roster.find(w=>norm(w.id)===norm(id)||norm(w.name)===norm(d.name)||norm(w.id)===norm(d.upstreamId));
    if(!roster) continue;
    const cw=cacheEntries.find(x=>norm(x.id)===norm(roster.id)||norm(x.name)===norm(roster.name)||norm(x.id)===norm(d.upstreamId));
    if(!cw) continue;
    for(const r of opt.ranges){
      for(let meter=Number(r.min);meter<=Number(r.max);meter++){
        const lethal=cw.bestLethal?.[String(meter)]; if(!lethal) continue;
        if(Number(lethal.ttk)>Number(r.ttk)) {
          errors.push(`${roster.id}@${meter}: max-lethality TTK ${lethal.ttk} slower than independently verified optimized ${r.ttk}`);
          break;
        }
      }
    }
  }

  // Enforce the actual AUTO policy against the strict lethal winner. AUTO may
  // be slower only inside the explicit 12% trigger->kill window, and only when
  // the selected build improves optic fit or Beam Index. This prevents a
  // repeated #1 weapon from surviving on a scoring bug while still allowing
  // the intentional laserbeam tradeoff.
  for(const cw of cacheEntries){
    for(let meter=1;meter<=300;meter++){
      const auto=cw.best?.[String(meter)], lethal=cw.bestLethal?.[String(meter)];
      if(!auto||!lethal) continue;
      const at=Number(auto.triggerTtk), lt=Number(lethal.triggerTtk);
      if(!Number.isFinite(at)||!Number.isFinite(lt)) continue;
      if(at>lt+1e-6){
        const near=lt>0 ? at/lt<=1.120001 : false;
        if(!near){ errors.push(`${cw.id}@${meter}: AUTO trigger TTK ${at} exceeds 12% laserbeam window over max-lethality ${lt}`); break; }
        const autoCost=laserbeamUtilityCost(at,Number(auto.beamIndex));
        const lethalCost=laserbeamUtilityCost(lt,Number(lethal.beamIndex));
        if(!(autoCost<=lethalCost+1e-9)){
          errors.push(`${cw.id}@${meter}: AUTO sacrifices lethality without enough Beam improvement under stable 55/45 utility (${autoCost} > ${lethalCost})`);
          break;
        }
      }
    }
  }
}

if(errors.length){
  console.error('GLOBAL INTEGRITY AUDIT FAILED');
  for(const e of errors) console.error('-',e);
  if(cachePath){
    try{
      const c=await json(cachePath);
      await writeFile('data/global-integration-diagnostics.json',JSON.stringify({
        generatedAt:new Date().toISOString(),
        cachePath,
        errors,
        cacheSource:c?.source??null,
        cacheAudit:c?.audit??null,
      },null,2));
      console.error('Exact diagnostics written to data/global-integration-diagnostics.json');
    }catch(e){ console.error('Could not write global integration diagnostics:',e?.message||e); }
  }
  process.exit(1);
}
console.log(`GLOBAL INTEGRITY PASS • roster ${current.roster.length}/${current.rosterCount} • combat-eligible ${weaponSets.counts.combatEligible} (${weaponSets.counts.primaries} primaries + ${weaponSets.counts.sidearms} sidearms) • all audit mappings covered • cache-first + trigger-to-impact META wiring locked${cachePath?' • exhaustive cache complete':''}`);
