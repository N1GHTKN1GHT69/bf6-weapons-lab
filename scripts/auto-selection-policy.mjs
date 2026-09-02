// Shared AUTO build-selection policy. This module is imported by the production
// exhaustive builder and the final-gate regression so the tested policy cannot
// silently diverge from runtime behavior.
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
  if(a.opticFit!==b.opticFit) return (a.opticFit??-Infinity)>(b.opticFit??-Infinity);
  if(a.beamIndex!==b.beamIndex) return (a.beamIndex??Infinity)<(b.beamIndex??Infinity);
  if(a.triggerTtk!==b.triggerTtk) return (a.triggerTtk??Infinity)<(b.triggerTtk??Infinity);
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
export function selectAnchoredAuto(bucketMap,lethal,maxTradeoff=1.12){
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
