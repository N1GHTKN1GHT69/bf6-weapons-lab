// Shared Laserbeam policy used by the production exhaustive builder and audits.
// The core utility is percentage/ratio based, not min-max normalized against the
// currently visible pool. This makes 55% lethality / 45% control stable.
export const AUTO_MAX_TTK_RATIO = 1.12;
export const WEAPON_OFFPACE_RATIO = 1.25;
export const WEAPON_OFFPACE_SLACK_MS = 10;
export const WEAPON_OFFPACE_COST_MULT = 1.35;
export const BEAM_FLOOR = 0.05;

export function laserbeamUtilityCost(triggerTtk, beamIndex){
  const t=Math.max(1e-6,Number(triggerTtk));
  const b=Math.max(BEAM_FLOOR,Number(beamIndex));
  if(!Number.isFinite(t)||!Number.isFinite(b)) return Infinity;
  return Math.pow(t,0.55)*Math.pow(b,0.45);
}

export function weaponMetaCost(triggerTtk,beamIndex,globalFastest){
  let cost=laserbeamUtilityCost(triggerTtk,beamIndex);
  const t=Number(triggerTtk), f=Number(globalFastest);
  if(Number.isFinite(t)&&Number.isFinite(f)&&t>f*WEAPON_OFFPACE_RATIO+WEAPON_OFFPACE_SLACK_MS){
    cost*=WEAPON_OFFPACE_COST_MULT;
  }
  return cost;
}

export function betterControlAtSameTrigger(a,b){
  if(!b) return true;
  if(a.opticEligible!==b.opticEligible) return !!a.opticEligible;
  if(a.opticFit!==b.opticFit) return (a.opticFit??-Infinity)>(b.opticFit??-Infinity);
  if(a.beamIndex!==b.beamIndex) return (a.beamIndex??Infinity)<(b.beamIndex??Infinity);
  if(a.ttk!==b.ttk) return (a.ttk??Infinity)<(b.ttk??Infinity);
  if(a.btk!==b.btk) return (a.btk??Infinity)<(b.btk??Infinity);
  if(a.damage!==b.damage) return (a.damage??-Infinity)>(b.damage??-Infinity);
  if(a.lowTtk!==b.lowTtk) return (a.lowTtk??Infinity)<(b.lowTtk??Infinity);
  if(a.practical!==b.practical) return a.practical>b.practical;
  if(a.points!==b.points) return a.points<b.points;
  return String(a.buildId)<String(b.buildId);
}
export function betterAutoInsideAnchoredWindow(a,b){
  if(!b) return true;
  if(a.opticEligible!==b.opticEligible) return !!a.opticEligible;
  const ac=laserbeamUtilityCost(a.triggerTtk,a.beamIndex);
  const bc=laserbeamUtilityCost(b.triggerTtk,b.beamIndex);
  if(Math.abs(ac-bc)>1e-12) return ac<bc;
  // Optic fit is a tie-break once both sights are range-eligible; a tiny optic
  // tier preference cannot buy a large lethality sacrifice.
  if(a.opticFit!==b.opticFit) return (a.opticFit??-Infinity)>(b.opticFit??-Infinity);
  if(a.triggerTtk!==b.triggerTtk) return (a.triggerTtk??Infinity)<(b.triggerTtk??Infinity);
  if(a.beamIndex!==b.beamIndex) return (a.beamIndex??Infinity)<(b.beamIndex??Infinity);
  if(a.ttk!==b.ttk) return (a.ttk??Infinity)<(b.ttk??Infinity);
  if(a.btk!==b.btk) return (a.btk??Infinity)<(b.btk??Infinity);
  if(a.damage!==b.damage) return (a.damage??-Infinity)>(b.damage??-Infinity);
  if(a.lowTtk!==b.lowTtk) return (a.lowTtk??Infinity)<(b.lowTtk??Infinity);
  if(a.practical!==b.practical) return a.practical>b.practical;
  if(a.points!==b.points) return a.points<b.points;
  return String(a.buildId)<String(b.buildId);
}
export function offerAutoBucketCandidate(bucketMap,candidate){
  const key=String(candidate.triggerTtk);
  const prior=bucketMap.get(key);
  if(betterControlAtSameTrigger(candidate,prior)){
    bucketMap.set(key,candidate);
    return true;
  }
  return false;
}
export function selectAnchoredAuto(bucketMap,lethal,maxTradeoff=AUTO_MAX_TTK_RATIO){
  if(!lethal||!bucketMap?.size) return null;
  const floor=Number(lethal.triggerTtk);
  if(!Number.isFinite(floor)) return null;
  const ceiling=floor<=0?floor:floor*maxTradeoff+1e-9;
  let winner=null;
  for(const candidate of bucketMap.values()){
    const t=Number(candidate.triggerTtk);
    if(!Number.isFinite(t)||t>ceiling) continue;
    if(betterAutoInsideAnchoredWindow(candidate,winner)) winner=candidate;
  }
  return winner;
}
