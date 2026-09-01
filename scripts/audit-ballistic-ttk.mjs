#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const ballistic = JSON.parse(await readFile('data/ballistics.json','utf8'));
const sniper = JSON.parse(await readFile('data/sniper-audit.json','utf8'));
const errors=[];
const verified=new Set((ballistic.weaponIds||[]).map(x=>String(x).toLowerCase().replace(/[^a-z0-9]/g,'')));
const drag=Number(ballistic.baseDragPerMeter);
function flightMs(v,d,k=drag){
  if(!(Number(v)>0)||!(Number(k)>=0)) return null;
  return (k===0 ? d/Number(v) : Math.expm1(k*d)/(k*Number(v)))*1000;
}
function damageAt(def,d){
  const pts=[...(def.curve||[])].sort((a,b)=>Number(a.r)-Number(b.r));
  if(!pts.length)return null;
  if(d<=Number(pts[0].r))return Number(pts[0].d);
  for(let i=1;i<pts.length;i++){
    const a=pts[i-1],b=pts[i];
    if(d<=Number(b.r)){
      const span=Number(b.r)-Number(a.r);
      if(span===0)return Number(b.d);
      const t=(d-Number(a.r))/span;
      return Number(a.d)+(Number(b.d)-Number(a.d))*t;
    }
  }
  return Number(pts.at(-1).d);
}
function mech(def,d){
  const dmg=damageAt(def,d);
  const btk=Math.ceil((100-1e-9)/dmg);
  return {damage:dmg,btk,ms:btk<=1?0:(btk-1)*Number(def.shotIntervalMs)};
}

if(!(drag>=0)) errors.push('invalid base drag');
for(const id of ['m2010esr','sv98','psr','miniscout','l115']) if(!verified.has(id)) errors.push(`${id}: missing from verified ballistics list`);

const expectedIntervals={
  m2010esr:60000/43,
  sv98:60000/38,
  psr:60000/38,
  l115:60000/46,
};
for(const [id,expected] of Object.entries(expectedIntervals)){
  const actual=Number(sniper.weapons?.[id]?.shotIntervalMs);
  if(!Number.isFinite(actual) || Math.abs(actual-expected)>1) errors.push(`${id}: audited interval ${actual} != effective cadence ${expected}`);
}

const mini=sniper.weapons?.miniscout;
if(!mini) errors.push('Mini Scout audit missing');
else {
  const expected=60000/51+100;
  if(Math.abs(Number(mini.shotIntervalMs)-expected)>1) errors.push(`Mini Scout interval ${mini.shotIntervalMs} != 51RPM raw +100ms (${expected})`);
  const vals=[];
  for(const d of [10,25,50,100,150]){
    const m=mech(mini,d), f=flightMs(mini.bulletVel,d), t=m.ms+f;
    vals.push({d,mech:m.ms,flight:f,trigger:t});
    if(!(t>m.ms)) errors.push(`Mini Scout@${d}: trigger TTK does not include positive flight time`);
  }
  for(let i=1;i<vals.length;i++) if(!(vals[i].trigger>vals[i-1].trigger)) errors.push(`Mini Scout trigger TTK not increasing: ${vals[i-1].d}->${vals[i].d}`);
  if(Math.round(vals[0].mech)===1176) errors.push('stale raw 51RPM Mini Scout cadence leaked into audited path');
}

for(const id of ['m2010esr','psr','l115']){
  const def=sniper.weapons?.[id];
  if(!def) { errors.push(`${id}: missing audit`); continue; }
  const m=mech(def,100), f=flightMs(def.bulletVel,100), t=m.ms+f;
  if(m.btk===1 && !(t>0)) errors.push(`${id}@100: one-shot trigger TTK still zero`);
  if(m.btk===1 && !(f>0)) errors.push(`${id}@100: missing projectile flight`);
}

const examples={};
for(const [id,def] of Object.entries(sniper.weapons||{})){
  if(!verified.has(String(id).toLowerCase().replace(/[^a-z0-9]/g,''))) continue;
  examples[id]={};
  for(const d of [10,25,50,100,150]){
    const m=mech(def,d), f=flightMs(def.bulletVel,d);
    examples[id][d]={damage:+m.damage.toFixed(2),btk:m.btk,mechMs:Math.round(m.ms),flightMs:Math.round(f),triggerTtkMs:Math.round(m.ms+f)};
  }
}

if(errors.length){
  console.error('BALLISTIC TTK AUDIT FAILED');
  for(const e of errors) console.error('-',e);
  process.exit(1);
}
console.log('BALLISTIC TTK PASS');
console.log(JSON.stringify({baseDragPerMeter:drag,examples},null,2));
