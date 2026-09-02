#!/usr/bin/env node
import { scoringStateSignature } from './cache-state-signature.mjs';

const baseWeapon = {
  id:'m250', dmg:[{r:0,d:26.05}], pellets:1, rpm:674.999, fireMode:'auto',
  bulletVel:724, recoilV:0.72, recoilVar:35.9, recoilIncAds:0.409,
  spread:{adsStand:[0.05,11]},
  spreadDyn:{ads:{inc:0.409,firingCoef:1.2,firingExp:2.5,firingOffset:2.7,notFiringCoef:0,notFiringExp:.25,notFiringOffset:7.2}},
  mag:50, tacRld:5.75, adsTime:360, _adsTimeMs:433,
  _limbMult:.84, _adsRecoilDecayMult:1, _adsSpreadDecayBoost:0,
  _spreadFiringDecCoefMult:1, _spreadFiringDecOffsetMult:1,
  _movingAdsMinSpreadDeg:.32,
  _label:'M250 (Attachment A)', _worldSpot:54, _minimapSpot:150,
};
const baseAtts={sight:'std_optic',ammo:'standard',light:'none',grip:'none',ergo:'none'};
const sig=scoringStateSignature(baseWeapon,baseAtts);
const failures=[];
function same(label, patchW={}, patchA={}) {
  const got=scoringStateSignature({...baseWeapon,...patchW},{...baseAtts,...patchA});
  if(got!==sig) failures.push(`${label}: display/non-ranking metadata changed the dedupe key`);
}
function diff(label, patchW={}, patchA={}) {
  const got=scoringStateSignature({...baseWeapon,...patchW},{...baseAtts,...patchA});
  if(got===sig) failures.push(`${label}: ranking mechanic failed to change the dedupe key`);
}
// The v2.5 bug: attachment names in _label must NOT block exact mechanical dedupe.
same('_label', {_label:'M250 (Totally Different Attachment Names)'});
same('spotting metadata', {_worldSpot:0,_minimapSpot:0});
same('health regen metadata', {_healthRegenDelayS:99});
// Every family consumed by ranking must remain distinguished.
diff('damage', {dmg:[{r:0,d:30}]});
diff('rpm', {rpm:700});
diff('velocity', {bulletVel:800});
diff('recoil', {recoilV:.5});
diff('variation', {recoilVar:10});
diff('spread per shot', {recoilIncAds:.2});
diff('spread dynamics', {spreadDyn:{ads:{...baseWeapon.spreadDyn.ads,firingOffset:3.1}}});
diff('recoil recovery', {_adsRecoilDecayMult:1.2});
diff('moving spread', {_movingAdsMinSpreadDeg:.22});
diff('magazine', {mag:100});
diff('reload', {tacRld:4});
diff('ads time', {_adsTimeMs:300});
diff('optic', {}, {sight:'var_high'});
diff('ammo', {}, {ammo:'penetration'});
diff('range finder utility', {}, {light:'range_finder'});
diff('bipod utility', {}, {grip:'bipod'});

if(failures.length){
  console.error('CACHE STATE DEDUPE FAIL');
  for(const f of failures) console.error(' -',f);
  process.exit(1);
}
console.log('CACHE STATE DEDUPE PASS — display labels/metadata collapse; lethal/recoil/spread/optic/handling mechanics remain distinct.');
