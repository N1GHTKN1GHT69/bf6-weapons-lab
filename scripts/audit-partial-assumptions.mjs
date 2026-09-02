#!/usr/bin/env node
import { stripPartialAssumptions, hasPartialAssumptionMarker } from './verified-source-sanitizer.mjs';

const fixture = {
  BARRELS: [
    { id:'heavy', name:'Heavy', pts:10, spreadIncMult:0.667, velMult:1,
      spreadFiringDecCoefMult:1.71, spreadFiringDecOffsetMult:0.667,
      assumedFields:{ spreadFiringDecCoefMult:true, spreadFiringDecOffsetMult:true } },
    { id:'heavy_ext', name:'Heavy Extended', pts:10, spreadIncMult:0.667, velMult:1.25,
      spreadFiringDecCoefMult:1.71, spreadFiringDecOffsetMult:0.667,
      assumedFields:['spreadFiringDecCoefMult','spreadFiringDecOffsetMult'] },
    { id:'totally_assumed', name:'Assumed Option', pts:5, assumed:true, recoilFoo:123 },
  ],
  WEAPON_ATTS:{ m250:{ barrel:['heavy','heavy_ext'], barrelDef:'heavy' } },
};
const stats={strippedFields:0,touchedRecords:0};
const clean=stripPartialAssumptions(fixture,stats);
const heavy=clean.BARRELS.find(x=>x.id==='heavy');
const ext=clean.BARRELS.find(x=>x.id==='heavy_ext');
const whole=clean.BARRELS.find(x=>x.id==='totally_assumed');
function assert(ok,msg){ if(!ok) throw new Error(msg); }
assert(heavy && ext,'M250 required barrels must survive partial-assumption sanitization');
assert(heavy.spreadIncMult===0.667 && heavy.velMult===1,'verified Heavy fields were not preserved');
assert(ext.spreadIncMult===0.667 && ext.velMult===1.25,'verified Heavy Extended fields were not preserved');
assert(!('spreadFiringDecCoefMult' in heavy) && !('spreadFiringDecOffsetMult' in heavy),'Heavy assumed fields were not stripped');
assert(!('spreadFiringDecCoefMult' in ext) && !('spreadFiringDecOffsetMult' in ext),'Heavy Extended assumed fields were not stripped');
assert(whole.assumed===true,'whole-option assumed marker must remain so caller can fail closed/exclude the option');
assert(stats.strippedFields===4,`expected 4 stripped fields, got ${stats.strippedFields}`);
assert(!hasPartialAssumptionMarker(clean),'partial assumption markers remain after sanitization');
console.log(`PARTIAL ASSUMPTION SANITIZER PASS: ${stats.touchedRecords} records, ${stats.strippedFields} unverified fields stripped; verified M250 barrel mechanics preserved.`);
