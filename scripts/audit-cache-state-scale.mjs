#!/usr/bin/env node
import { scoringStateSignature } from './cache-state-signature.mjs';
const base={id:'m250',dmg:[{r:0,d:26.05}],pellets:1,rpm:674.999,fireMode:'auto',bulletVel:724,recoilV:.72,recoilVar:35.9,recoilIncAds:.409,spread:{adsStand:[.05,11]},spreadDyn:{ads:{inc:.409,firingCoef:1.2,firingExp:2.5,firingOffset:2.7,notFiringCoef:0,notFiringExp:.25,notFiringOffset:7.2}},mag:50,tacRld:5.75,_adsTimeMs:433,_limbMult:.84,_movingAdsMinSpreadDeg:.32};
const a={sight:'std_optic',ammo:'standard',light:'none',grip:'none',ergo:'none'};
const states=new Set();
for(let i=0;i<100000;i++) states.add(scoringStateSignature({...base,_label:`M250 fake build ${i}`,_worldSpot:i%55,_minimapSpot:150-(i%10)},a));
if(states.size!==1){console.error(`CACHE STATE SCALE FAIL: 100000 display variants produced ${states.size} scoring states`);process.exit(1);}
states.add(scoringStateSignature({...base,recoilV:.71,_label:'real mechanic changed'},a));
if(states.size!==2){console.error(`CACHE STATE SCALE FAIL: recoil change did not create second state (${states.size})`);process.exit(1);}
console.log('CACHE STATE SCALE PASS — 100,000 display-only variants collapse to 1 state; a real recoil change creates a distinct state.');
