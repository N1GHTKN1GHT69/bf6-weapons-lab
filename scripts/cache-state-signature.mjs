// Exact cache-state key for BF6 exhaustive build deduplication.
// IMPORTANT: only fields that can change the optimizer's lethal, Beam, optic,
// handling or explicit utility ranking may appear here. Display metadata such
// as `_label` must never enter this key or mechanically identical builds stop
// deduplicating.
export function scoringStateSignature(w, attSet) {
  const adsDyn = w?.spreadDyn?.ads ?? null;
  const adsSpread = w?.spread?.adsStand ?? null;
  return JSON.stringify({
    // Lethality / cadence / ballistics
    dmg:w?.dmg, pellets:w?.pellets ?? 1, rpm:w?.rpm, fireMode:w?.fireMode,
    burstRounds:w?.burstRounds, burstBurstsPerMinute:w?.burstBurstsPerMinute, burstRpm:w?.burstRpm,
    bulletVel:w?.bulletVel, limbMult:w?._limbMult ?? 1,
    shotgunAmmo:w?._shotgunAmmoId ?? null,
    shotgunCadence:w?._shotgunAuditDef?.cadence ?? null,
    sniperCadence:w?._sniperAuditDef?.shotIntervalMs ?? null,
    sniperCurve:w?._sniperAuditDef?.curve ?? null,
    // Recoil / ADS spread mechanics actually consumed by Beam Index
    recoilV:w?.recoilV, recoilVar:w?.recoilVar, recoilIncAds:w?.recoilIncAds,
    adsSpread, adsDyn,
    adsRecoilDecayMult:w?._adsRecoilDecayMult ?? 1,
    adsSpreadDecayBoost:w?._adsSpreadDecayBoost ?? 0,
    spreadFiringDecCoefMult:w?._spreadFiringDecCoefMult ?? 1,
    spreadFiringDecOffsetMult:w?._spreadFiringDecOffsetMult ?? 1,
    movingAdsMinSpreadDeg:w?._movingAdsMinSpreadDeg ?? null,
    // Handling values used by practicalScore()
    mag:w?.mag, tacRld:w?.tacRld,
    adsTimeMs:w?._adsTimeMs ?? w?.adsTime ?? null,
    // Policy/utility inputs that intentionally influence winners
    sight:attSet?.sight, ammo:attSet?.ammo,
    utility:{
      rangeFinder:attSet?.light==='range_finder',
      bipod:['bipod','bipod_sr'].includes(attSet?.grip),
      adsBolt:attSet?.ergo==='ads_bolt',
      magFlare:attSet?.ergo==='mag_flare'
    }
  });
}
