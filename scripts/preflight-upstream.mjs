#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { auditPointData } from './point-audit.mjs';

const upstream = resolve(process.argv[2] || process.env.BF6_ANALYZER_DIR || '.upstream/bf6-analyzer');
const errors=[];
const norm=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]/g,'');
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const requiredData=['weapons.json','attachments.json','ammo.json','balance_tables.json','recoil_decay.json','ballistics.json'];
const data={};
for(const name of requiredData){
  try{ data[name]=await json(join(upstream,'data',name)); }
  catch(err){ errors.push(`${name}: ${err.message}`); }
}
if(errors.length){
  console.error('UPSTREAM PREFLIGHT FAILED'); errors.forEach(e=>console.error('-',e)); process.exit(1);
}
const weapons=data['weapons.json'], atts=data['attachments.json'], ammo=data['ammo.json'], ballistics=data['ballistics.json'];
if(!Array.isArray(weapons)||!weapons.length) errors.push('weapons.json must be a non-empty array');
if(new Set((weapons??[]).map(w=>w.id)).size !== (weapons??[]).length) errors.push('duplicate upstream weapon ids');
if(!(atts?.WEAPON_ATTS&&typeof atts.WEAPON_ATTS==='object')) errors.push('attachments.json missing WEAPON_ATTS');
if(!(atts?.WEAPON_MAG&&typeof atts.WEAPON_MAG==='object')) errors.push('attachments.json missing WEAPON_MAG');
if(!(ammo?.WEAPON_AMMO&&typeof ammo.WEAPON_AMMO==='object')) errors.push('ammo.json missing WEAPON_AMMO');
const pointReport=auditPointData(atts,ammo);
for(const w of pointReport.warnings??[]) console.warn(`POINT WARNING: ${w}`);
for(const e of pointReport.errors??[]) errors.push(`point data: ${e}`);
if(!(Number(ballistics?.baseDragPerMeter)>=0)||!Array.isArray(ballistics?.weaponIds)) errors.push('ballistics.json invalid contract');

// Load the app roster without a browser.
try{
  const src=await readFile('roster-data.js','utf8');
  const context={window:{}}; vm.runInNewContext(src,context,{filename:'roster-data.js'});
  const roster=context.window.BF6_CURRENT?.roster??[];
  const rosterKeys=new Map();
  for(const w of roster) for(const key of [w.id,w.name,...(w.aliases??[])]) rosterKeys.set(norm(key),w);
  const unmapped=[];
  for(const w of weapons){ if(!rosterKeys.has(norm(w.id))&&!rosterKeys.has(norm(w.name))) unmapped.push(`${w.id} (${w.name})`); }
  if(unmapped.length) errors.push(`upstream weapons missing from app roster: ${unmapped.join(', ')}`);
  const matchedRoster=new Set();
  for(const w of weapons){ const r=rosterKeys.get(norm(w.id))??rosterKeys.get(norm(w.name)); if(r) matchedRoster.add(r.id); }
  // A roster weapon may legitimately be absent upstream while the patch ledger
  // still holds its patch pending. That is the fail-closed state, not an error.
  // No weapon id is hardcoded here, so a new weapon arriving upstream needs no
  // source edit: it simply stops being pending.
  let ledgerPending=new Set();
  try{
    const ledger=JSON.parse(await readFile('data/patch-delta-ledger.json','utf8'));
    for(const p of ledger?.patches??[]) for(const ch of p.changes??[]){
      if(ch.check?.type==='weaponPresent'&&ch.check.weaponId) ledgerPending.add(norm(ch.check.weaponId));
    }
  }catch{ /* ledger optional */ }
  const missing=roster.filter(w=>!matchedRoster.has(w.id)&&!ledgerPending.has(norm(w.id)));
  if(missing.length) errors.push(`roster weapons missing upstream records with no patch-ledger delta: ${missing.map(w=>w.id).join(', ')}`);
  const pendingStill=roster.filter(w=>!matchedRoster.has(w.id)&&ledgerPending.has(norm(w.id)));
  if(pendingStill.length) console.warn(`note: awaiting upstream records for ${pendingStill.map(w=>w.id).join(', ')} (patch ledger holds these pending)`);
} catch(err){ errors.push(`roster mapping preflight: ${err.message}`); }

for(const w of weapons??[]){
  if(!atts.WEAPON_ATTS?.[w.id]) errors.push(`${w.id}: missing WEAPON_ATTS compatibility`);
  if(!atts.WEAPON_MAG?.[w.id]?.mags || !Object.keys(atts.WEAPON_MAG[w.id].mags).length) errors.push(`${w.id}: missing WEAPON_MAG choices`);
  if(!ammo.WEAPON_AMMO?.[w.id]?.ammo || !Object.keys(ammo.WEAPON_AMMO[w.id].ammo).length) errors.push(`${w.id}: missing WEAPON_AMMO choices`);
}

const requiredExports={
  'sim/applyAttachments.js':['setAttachmentContext','applyAttachments'],
  'sim/damage.js':['damagePerShotAtRange'],
  'sim/core.js':['shotIntervalAfter','setSimContext','selectedRecoilAmountFor','selectedRecoilVariationFor','effectiveSpreadMax'],
  'sim/ballistics.js':['flightTimeAtDistance'],
  'sim/loadout.js':['computeAttPts'],
};
for(const [rel,names] of Object.entries(requiredExports)){
  try{
    const mod=await import(pathToFileURL(join(upstream,rel)).href);
    for(const name of names) if(typeof mod[name]!=='function') errors.push(`${rel}: missing function export ${name}`);
  }catch(err){ errors.push(`${rel}: import failed: ${err.message}`); }
}

if(errors.length){
  console.error('UPSTREAM PREFLIGHT FAILED');
  for(const e of errors.slice(0,150)) console.error('-',e);
  process.exit(1);
}
console.log(`UPSTREAM PREFLIGHT PASS • weapons ${weapons.length} • point schema PASS • roster mapping PASS • simulator exports PASS`);
