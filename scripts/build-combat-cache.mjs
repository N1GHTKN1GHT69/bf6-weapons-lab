#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { scoringStateSignature } from './cache-state-signature.mjs';
import { stripPartialAssumptions } from './verified-source-sanitizer.mjs';
import { offerAutoBucketCandidate, selectAnchoredAuto } from './auto-selection-policy.mjs';

const upstream = resolve(process.argv[2] || process.env.BF6_ANALYZER_DIR || '.upstream/bf6-analyzer');
const outDir = resolve(process.argv[3] || 'data');
const DIST_MIN = 1;
const DIST_MAX = 300;
const PRIMARY_BUDGET = 100;
const SIDEARM_BUDGET = 60;
const MAX_CANONICAL_COMBOS_PER_WEAPON = Number(process.env.BF6_MAX_CANONICAL_COMBOS || 25_000_000);

// Phase A v2.7 supports exact per-weapon cache generation with mechanics-only state deduplication and verified-field sanitization. GitHub runs one
// isolated matrix job per upstream-backed weapon, then merge-combat-cache.mjs
// recombines them into one cache. Successful weapon shards are reusable across
// retries when the upstream revision and scoring code have not changed. With no
// filter this script still builds the full cache.
const argv = process.argv.slice(4);
function argValue(name){ const i=argv.indexOf(name); return i>=0 ? argv[i+1] : null; }
const CLASS_FILTER = argValue('--class') || process.env.BF6_CLASS_FILTER || null;
const WEAPON_FILTER = argValue('--weapon') || process.env.BF6_WEAPON_FILTER || null;
if (CLASS_FILTER && WEAPON_FILTER) throw new Error('Use either --class or --weapon, not both');
const CACHE_OUT = resolve(argValue('--cache') || process.env.BF6_CACHE_OUT || join(outDir,'combat-cache.json'));
const AUDIT_OUT = resolve(argValue('--audit') || process.env.BF6_AUDIT_OUT || join(outDir,'combat-audit.json'));

const json = async p => JSON.parse(await readFile(p, 'utf8'));
const weapons = await json(join(upstream, 'data/weapons.json'));
const selectedWeapons = WEAPON_FILTER ? weapons.filter(w => w.id === WEAPON_FILTER) : (CLASS_FILTER ? weapons.filter(w => w.cls === CLASS_FILTER) : weapons);
if (WEAPON_FILTER && !selectedWeapons.length) throw new Error(`No upstream weapon matched weapon filter: ${WEAPON_FILTER}`);
if (CLASS_FILTER && !selectedWeapons.length) throw new Error(`No upstream weapons matched class filter: ${CLASS_FILTER}`);
const rawAtts = await json(join(upstream, 'data/attachments.json'));
const rawAmmo = await json(join(upstream, 'data/ammo.json'));
const sourceSanitizeStats = { strippedFields:0, touchedRecords:0 };
const atts = stripPartialAssumptions(rawAtts, sourceSanitizeStats);
const ammo = stripPartialAssumptions(rawAmmo, sourceSanitizeStats);
console.log(`Verified-source sanitization: stripped ${sourceSanitizeStats.strippedFields} assumed fields from ${sourceSanitizeStats.touchedRecords} records; whole-option assumed candidates remain excluded.`);
const balance = await json(join(upstream, 'data/balance_tables.json'));
const recoilDecay = await json(join(upstream, 'data/recoil_decay.json'));
const ballistics = await json(join(upstream, 'data/ballistics.json'));
const auditNames = ['assault','carbine','smg','lmg','dmr','sniper','sidearm','shotgun'];
const classAudits = Object.fromEntries(await Promise.all(auditNames.map(async name => [name, await json(join(outDir, `${name}-audit.json`))])));
for (const [name,a] of Object.entries(classAudits)) if (a?.pass !== true) throw new Error(`${name} audit is not passing`);
const auditVersions = new Set(Object.values(classAudits).map(a => a?.gameVersion).filter(Boolean));
if (auditVersions.size !== 1) throw new Error(`class audit version mismatch: ${[...auditVersions].join(', ') || 'missing'}`);
const GAME_VERSION = [...auditVersions][0];
const shotgunAudit = classAudits.shotgun;
const SHOTGUN_ALIAS = { m87a1:'m87a1', m1014:'m1014', ks18k:'185ksk', db12:'db12' };
function shotgunDef(w){ return w?.cls === 'Shotgun' ? shotgunAudit.weapons?.[SHOTGUN_ALIAS[w.id] ?? w.id] ?? null : null; }

const sniperAudit = classAudits.sniper;
const normId=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]/g,'');
function sniperDef(w){
  if(w?.cls!=='Sniper Rifle') return null;
  const keys=new Set([w.id,w.name].filter(Boolean).map(normId));
  for(const [id,d] of Object.entries(sniperAudit.weapons??{})){
    if(keys.has(normId(id))||keys.has(normId(d?.name))||keys.has(normId(d?.upstreamId))) return d;
  }
  return null;
}
function sniperDamageAt(def,d){
  const pts=(def?.curve??[]).map(x=>({r:Number(x.r),d:Number(x.d)})).filter(x=>Number.isFinite(x.r)&&Number.isFinite(x.d)).sort((a,b)=>a.r-b.r);
  if(!pts.length) return null;
  if(d<=pts[0].r) return pts[0].d;
  for(let i=1;i<pts.length;i++){
    const a=pts[i-1],b=pts[i];
    if(d<=b.r){
      if(b.r===a.r) return b.d;
      const t=(d-a.r)/(b.r-a.r);
      return a.d+(b.d-a.d)*Math.max(0,Math.min(1,t));
    }
  }
  return pts.at(-1).d;
}
function applyVerifiedSniperLethality(w){
  const def=sniperDef(w);
  return def ? {...w,_sniperAuditDef:def} : w;
}

function ballisticAlias(id) {
  const n=String(id ?? '').toLowerCase().replace(/[^a-z0-9]/g,'');
  return ({'185ksk':'ks18k','kts100mk8':'kts100'})[n] ?? n;
}
const BALLISTIC_WEAPON_IDS = new Set((ballistics.weaponIds ?? []).map(ballisticAlias));
function ballisticsExactFor(w){ return BALLISTIC_WEAPON_IDS.has(ballisticAlias(w?.id)) || BALLISTIC_WEAPON_IDS.has(ballisticAlias(w?.name)); }
function dragForBuild(w, attSet){
  const ammoId=attSet?.ammo ?? 'standard';
  if(ammoId==='long_range' && Number.isFinite(Number(ballistics?.ammoDragPerMeter?.long_range))) return Number(ballistics.ammoDragPerMeter.long_range);
  if(ammoId==='penetration' && Number.isFinite(Number(ballistics?.ammoDragPerMeter?.penetration?.[w?.cls]))) return Number(ballistics.ammoDragPerMeter.penetration[w.cls]);
  return Number(ballistics.baseDragPerMeter);
}
function flightMsForBuild(w,attSet,d){
  const velocity=Number(w?.bulletVel), drag=dragForBuild(w,attSet);
  const sec=flightTimeAtDistance({velocityMps:velocity,dragPerMeter:drag,gravityMps2:Number(ballistics.gravityMps2)},Number(d));
  return Number.isFinite(sec) ? sec*1000 : null;
}

const applyMod = await import(pathToFileURL(join(upstream, 'sim/applyAttachments.js')).href);
const damageMod = await import(pathToFileURL(join(upstream, 'sim/damage.js')).href);
const coreMod = await import(pathToFileURL(join(upstream, 'sim/core.js')).href);
const ballisticsMod = await import(pathToFileURL(join(upstream, 'sim/ballistics.js')).href);
const loadoutMod = await import(pathToFileURL(join(upstream, 'sim/loadout.js')).href);

const {
  setAttachmentContext, applyAttachments,
} = applyMod;
const { damagePerShotAtRange } = damageMod;
const { shotIntervalAfter, setSimContext, selectedRecoilAmountFor, selectedRecoilVariationFor, effectiveSpreadMax } = coreMod;
const { flightTimeAtDistance } = ballisticsMod;
const { computeAttPts } = loadoutMod;

const HP_HS_HIGH = new Set(balance.HP_HS_HIGH ?? []);
setAttachmentContext({
  ...atts,
  ...ammo,
  RECOIL_MULT: balance.RECOIL_MULT,
  HIP_SPREAD_TIERS: balance.HIP_SPREAD_TIERS,
  HIP_SPREAD_BASE_IDX: balance.HIP_SPREAD_BASE_IDX,
  HIP_CLS: balance.HIP_CLS,
  BASE_HS_MULT: balance.BASE_HS_MULT,
  COLLATERAL_MULT_OVERRIDE: balance.COLLATERAL_MULT_OVERRIDE,
  HP_HS_HIGH,
  LIMB_CLASS: balance.LIMB_CLASS,
  LIMB_CLASS_MULT: balance.LIMB_CLASS_MULT,
  AUTO_HS_MULT: balance.AUTO_HS_MULT,
  MOVING_ACC_TIERS: balance.MOVING_ACC_TIERS,
  DEFAULT_MOV_TIER: balance.DEFAULT_MOV_TIER,
  ADS_SPD_TIERS: balance.ADS_SPD_TIERS,
  SPRINT_REC_TIERS: balance.SPRINT_REC_TIERS,
  PRIMARY_SPRINT_REC_TIERS: balance.PRIMARY_SPRINT_REC_TIERS,
  SIDEARM_SPRINT_REC_TIERS: balance.SIDEARM_SPRINT_REC_TIERS,
  DEPLOY_TIME_TIERS: balance.DEPLOY_TIME_TIERS,
  ADS_MOVE_TIERS: balance.ADS_MOVE_TIERS,
  DRAW_TIME_AXIS: balance.DRAW_TIME_AXIS,
  RELOAD_SPEED_LADDER: balance.RELOAD_SPEED_LADDER,
  VELOCITY_LADDER: balance.VELOCITY_LADDER,
  HEALTH_REGEN_DELAY_S: balance.HEALTH_REGEN_DELAY_S,
});
setSimContext({
  aimState: 'ads', stanceState: 'stand',
  RECOIL_DEC: recoilDecay.RECOIL_DEC,
  RECOIL_DEC_EXP: recoilDecay.RECOIL_DEC_EXP,
  RECOIL_DEC_TEXP: recoilDecay.RECOIL_DEC_TEXP,
  compensationFn: () => 0,
  platformRecoilMultFn: () => 1,
});

const catalog = {
  sight: atts.SIGHTS ?? [], muzzle: atts.MUZZLES ?? [], barrel: atts.BARRELS ?? [],
  grip: atts.GRIPS ?? [], laser: atts.LASERS ?? [], light: atts.LIGHTS ?? [], ergo: atts.ERGOS ?? [],
  ammo: ammo.AMMO ?? [],
};
const byId = Object.fromEntries(Object.entries(catalog).map(([k, list]) => [k, Object.fromEntries(list.map(x => [x.id, x]))]));

function budgetFor(w) { return w.cls === 'Sidearm' ? SIDEARM_BUDGET : PRIMARY_BUDGET; }
function railItem(id) {
  return byId.laser?.[id] ?? byId.grip?.[id] ?? byId.light?.[id] ?? null;
}
function optionPts(slot, w, id) {
  if (slot === 'mag') return atts.WEAPON_MAG?.[w.id]?.mags?.[id]?.pts ?? null;
  if (slot === 'ammo') return ammo.WEAPON_AMMO?.[w.id]?.ammo?.[id] ?? null;
  if (slot === 'laser') return railItem(id)?.pts ?? null;
  return byId[slot]?.[id]?.pts ?? null;
}
function optionData(slot, w, id) {
  if (slot === 'mag') return atts.WEAPON_MAG?.[w.id]?.mags?.[id] ? { id, ...atts.WEAPON_MAG[w.id].mags[id] } : null;
  if (slot === 'ammo') {
    const base = byId.ammo?.[id];
    const pts = ammo.WEAPON_AMMO?.[w.id]?.ammo?.[id];
    return base && pts != null ? { ...base, pts } : null;
  }
  if (slot === 'laser') return railItem(id);
  return byId[slot]?.[id] ?? null;
}

function functionalSignature(slot, data) {
  if (!data) return 'null';
  // Optics are intentionally NOT collapsed by mechanical noEffect fields. The
  // upstream feed exposes coarse optic tiers (Iron / Standard / Variable Low /
  // Variable High / Thermal / Hybrid), and those tiers have different useful
  // target-distance envelopes even when they do not alter recoil/damage stats.
  if (slot === 'sight') return `sight:${data.id}`;
  const drop = new Set(['id','name','pts','assumed','assumedFields','description','tooltip','source','notes']);
  const obj = {};
  for (const [k,v] of Object.entries(data)) if (!drop.has(k)) obj[k] = v;
  // slot matters because identical-looking fields can mean different mechanics in different slots.
  return `${slot}:${JSON.stringify(obj, Object.keys(obj).sort())}`;
}

function dedupeDominated(slot, w, ids) {
  const keep = new Map();
  for (const id of ids) {
    const data = optionData(slot, w, id);
    const pts = optionPts(slot, w, id);
    if (!data || !Number.isFinite(pts) || pts < 0) continue;
    // Verified AUTO META must never depend on speculative/inferred attachment mechanics.
    // Raw combinations are still counted separately, but assumed options are not simulated
    // as candidates for a winning build until their behavior is validated.
    // Entirely assumed options remain excluded. For partially-assumed records,
    // stripPartialAssumptions() already removed only the unverified fields while
    // preserving verified mechanics (critical for M250 Heavy/Heavy Extended).
    if (data.assumed === true) continue;
    const sig = functionalSignature(slot, data);
    const prev = keep.get(sig);
    if (!prev || pts < prev.pts || (pts === prev.pts && String(id).localeCompare(String(prev.id)) < 0)) {
      keep.set(sig, { id, pts, data });
    }
  }
  return [...keep.values()].sort((a,b)=>a.pts-b.pts || String(a.id).localeCompare(String(b.id)));
}

function slotIdsForWeapon(w) {
  const wa = atts.WEAPON_ATTS?.[w.id];
  if (!wa) return null;
  const allIds = slot => (catalog[slot] ?? []).map(x => x.id);
  const allowed = (slot, required=false) => {
    let ids = Array.isArray(wa[slot]) ? [...wa[slot]] : allIds(slot);
    if (!required && !ids.includes('none') && byId[slot]?.none) ids.unshift('none');
    if (required) ids = ids.filter(id => id !== 'none');
    return ids;
  };

  const out = {
    sight: Array.isArray(wa.sight) && wa.sight.length ? [...wa.sight] : allIds('sight'),
    muzzle: allowed('muzzle'),
    barrel: allowed('barrel', true),
    grip: allowed('grip'),
    laser: allowed('laser'),
    light: allowed('light'),
    ergo: ['none', ...(atts.WEAPON_ERGO?.[w.id]?.avail ?? [])],
    mag: Object.keys(atts.WEAPON_MAG?.[w.id]?.mags ?? {}),
    ammo: Object.keys(ammo.WEAPON_AMMO?.[w.id]?.ammo ?? {}),
  };

  // The analyzer models several guns with a shared rail. In those cases one
  // selected token occupies laser while grip/light are forced to none as appropriate.
  if (wa.laserLightCombined) {
    const merged = [...(wa.laser ?? []), ...(wa.light ?? [])];
    if (wa.laserGripLightCombined) merged.push(...(wa.grip ?? []));
    out.laser = ['none', ...merged.filter(id => id !== 'none')];
    out.light = ['none'];
    if (wa.laserGripLightCombined) out.grip = ['none'];
  }
  return out;
}

function canonicalOptions(w) {
  const ids = slotIdsForWeapon(w);
  if (!ids) return null;
  const result = {};
  const verifiedShotgunAmmo = w.cls === 'Shotgun' ? new Set(shotgunAudit.verifiedAmmoIds ?? []) : null;
  for (const [slot, list] of Object.entries(ids)) {
    const sourceList = slot === 'ammo' && verifiedShotgunAmmo ? list.filter(id => verifiedShotgunAmmo.has(id)) : list;
    result[slot] = dedupeDominated(slot, w, [...new Set(sourceList)]);
    if (!result[slot].length) return null;
  }
  return result;
}

// Count every legal raw combination under the point budget without expanding it.
// This counts user-visible combinations, including functionally redundant options.
function countAllLegalCombinations(w) {
  const ids = slotIdsForWeapon(w);
  if (!ids) return 0n;
  const slots = Object.keys(ids);
  const budget = budgetFor(w);
  let dp = Array(budget + 1).fill(0n); dp[0] = 1n;
  for (const slot of slots) {
    const next = Array(budget + 1).fill(0n);
    for (let used=0; used<=budget; used++) {
      if (!dp[used]) continue;
      for (const id of [...new Set(ids[slot])]) {
        const p = optionPts(slot, w, id);
        if (!Number.isFinite(p) || p < 0 || used + p > budget) continue;
        next[used+p] += dp[used];
      }
    }
    dp = next;
  }
  return dp.reduce((a,b)=>a+b,0n);
}


function toAttSet(picks, w) {
  const wm = atts.WEAPON_MAG?.[w.id];
  const wa = atts.WEAPON_ATTS?.[w.id];
  const a = {
    sight:'iron', muzzle:'none', barrel:wa?.barrelDef ?? 'none', grip:'none', laser:'none', light:'none',
    ammo:ammo.WEAPON_AMMO?.[w.id]?.def ?? 'standard', mag:wm?.def ?? null, ergo:'none'
  };
  for (const p of picks) a[p.slot] = p.id;
  return a;
}

function shotgunRangeAt(ranges,d){ return (ranges ?? []).find(r => d >= Number(r.min) && d <= Number(r.max)) ?? null; }
function shotgunProfileFor(w, ammoId) {
  const def=shotgunDef(w);
  const p=def?.ammoProfiles?.[ammoId];
  return p?.verified ? {def,profile:p} : null;
}
function applyVerifiedShotgunLethality(w, ammoId) {
  const found=shotgunProfileFor(w,ammoId);
  if(!found) return w;
  return { ...w, _shotgunAuditDef:found.def, _shotgunAmmoProfile:found.profile, _shotgunAmmoId:ammoId };
}
function ttkMs(w, btk) {
  if (!Number.isFinite(btk) || btk <= 0) return null;
  const sniperInterval=Number(w?._sniperAuditDef?.shotIntervalMs);
  if(sniperInterval>0) return Math.round((btk-1)*sniperInterval);
  const cad=w?._shotgunAuditDef?.cadence;
  if(cad?.type==='paired'){
    if(btk<=1)return 0;
    const idx=btk-1;
    return Math.round((Math.floor(idx/2)*Number(cad.pairCycleMs)+(idx%2)*(60000/Number(cad.pairRpm))));
  }
  if(cad?.type==='constant' && Number(cad.rpm)>0) return Math.round((btk-1)*60000/Number(cad.rpm));
  if(!w?.rpm)return null;
  let sec = 0;
  for (let shot=1; shot<btk; shot++) sec += shotIntervalAfter(w, shot);
  return Math.round(sec * 1000);
}
function combatProfile(w, attSet) {
  const rows = [];
  for (let d=DIST_MIN; d<=DIST_MAX; d++) {
    let damage, pellets=Number(w?.pellets)||1, pelletDamage=null;
    if(w?._shotgunAmmoProfile){
      const r=shotgunRangeAt(w._shotgunAmmoProfile.ranges,d);
      damage=r ? Number(r.damage) : null;
      pellets=Number(w._shotgunAmmoProfile.pellets)||1;
      pelletDamage=(damage!=null && pellets>1) ? damage/pellets : damage;
    } else if(w?._sniperAuditDef) {
      // Sniper chest lethality/cadence is independently audited. Never let the
      // upstream nominal raw RPM/damage path override the verified bolt timing.
      damage = sniperDamageAt(w._sniperAuditDef,d);
    } else {
      damage = damagePerShotAtRange(w, d);
    }
    const chestBtk = damage > 0 ? Math.ceil((100 - 1e-9) / damage) : null;
    const lowMult = w?._sniperAuditDef ? Number(sniperAudit.lowBodyMultiplier??0.67) : (w?.cls === 'Shotgun' ? 1 : (w._limbMult ?? 1));
    const lowDamage = damage != null ? damage * lowMult : null;
    const lowBtk = lowDamage > 0 ? Math.ceil((100 - 1e-9) / lowDamage) : null;
    const mechTtk=chestBtk ? ttkMs(w,chestBtk) : null;
    const flightMs=flightMsForBuild(w,attSet,d);
    rows.push({
      d,
      damage: damage == null ? null : +damage.toFixed(4), pelletDamage: pelletDamage == null ? null : +pelletDamage.toFixed(4), pellets,
      btk: chestBtk,
      ttk: mechTtk,
      mechTtk,
      flightMs: Number.isFinite(flightMs) ? +flightMs.toFixed(4) : null,
      triggerTtk: Number.isFinite(flightMs) && Number.isFinite(mechTtk) ? +(mechTtk+flightMs).toFixed(4) : null,
      ballisticsExact: ballisticsExactFor(w),
      lowBtk,
      lowTtk: lowBtk ? ttkMs(w, lowBtk) : null,
    });
  }
  return rows;
}

function beamPrimitives(w) {
  // These transformed weapon mechanics do not change with target distance. The
  // older builder recomputed effectiveSpreadMax() for every one of the 300 range
  // rows of every attachment combination, multiplying the expensive spread
  // simulation needlessly. Compute them once per transformed build instead.
  const recoil = Math.max(0, Number(selectedRecoilAmountFor(w)) || 0);
  const variationDeg = Math.max(0, Number(selectedRecoilVariationFor(w)) || 0);
  const unpredictable = recoil * Math.sin(Math.min(90, variationDeg) * Math.PI / 180);
  const effSpread = Math.max(0, Number(effectiveSpreadMax(w, 8)) || 0);
  const moving = Math.max(0, Number(w._movingAdsMinSpreadDeg) || 0);
  return { recoil, variationDeg, unpredictable, effSpread, moving };
}

function beamMetricsFromPrimitives(base, distance) {
  // Range changes how much angular instability matters, not the weapon's base
  // transformed recoil/spread mechanics themselves.
  const { recoil, variationDeg, unpredictable, effSpread, moving } = base;
  const rangeT = Math.min(1, Math.max(1, Number(distance) || 1) / 120);
  const beamIndex = (recoil * (1.00 + 0.35 * rangeT))
    + (unpredictable * (1.25 + 0.75 * rangeT))
    + (effSpread * (2.00 + 2.50 * rangeT))
    + (moving * (0.35 + 0.65 * rangeT));
  return {
    beamIndex:+beamIndex.toFixed(6),
    recoil:+recoil.toFixed(6),
    recoilVariationDeg:+variationDeg.toFixed(6),
    unpredictableRecoil:+unpredictable.toFixed(6),
    effectiveAdsSpreadDeg:+effSpread.toFixed(6),
    movingAdsMinSpreadDeg:+moving.toFixed(6),
  };
}

function opticRangeFit(sightId, distance) {
  const d = Math.max(1, Number(distance) || 1);
  // This is an explicit optimizer policy, not a claimed datamined magnification
  // value. The Analyzer currently exposes coarse sight tiers + Pick points, but
  // not exact optic magnification/FOV for most primary weapons. The policy keeps
  // clearly unsuitable optics from winning merely because they cost fewer points.
  switch (sightId) {
    case 'iron':
      return d <= 15 ? 100 : d <= 25 ? 85 : d <= 40 ? 55 : d <= 60 ? 25 : 0;
    case 'std_optic':
      return d <= 15 ? 90 : d <= 35 ? 100 : d <= 60 ? 90 : d <= 85 ? 70 : d <= 110 ? 45 : 20;
    case 'var_low':
      return d <= 15 ? 55 : d <= 35 ? 85 : d <= 75 ? 100 : d <= 110 ? 90 : d <= 150 ? 70 : 50;
    case 'var_high':
      return d <= 20 ? 15 : d <= 40 ? 45 : d <= 60 ? 75 : d <= 90 ? 95 : d <= 180 ? 100 : 95;
    case 'thermal':
      return d <= 15 ? 45 : d <= 40 ? 70 : d <= 100 ? 90 : d <= 160 ? 80 : 65;
    case 'therm_hyb':
      return d <= 15 ? 45 : d <= 40 ? 75 : d <= 100 ? 95 : d <= 160 ? 100 : 90;
    default:
      // Unknown exact sight IDs are not guessed into a magnification tier. Keep
      // them neutral so weapon-specific compatibility can still be modeled.
      return 60;
  }
}

function minimumOpticFit(w, distance) {
  if (!w || w.cls === 'Sidearm') return 0;
  const d = Math.max(1, Number(distance) || 1);
  if (d <= 20) return 45;
  if (d <= 60) return 50;
  if (d <= 120) return 55;
  return 60;
}

function opticLabel(sightId) {
  return byId.sight?.[sightId]?.name ?? sightId ?? 'Unknown';
}

function practicalScore(w, distance, attsSet) {
  // Secondary utility score. Beam controllability is stored separately and is
  // promoted into weapon/build ranking by the Laserbeam Meta layer.
  const d = Math.max(1, distance);
  const rangeT = Math.min(1, d / 120);
  const closeT = 1 - Math.min(1, d / 45);
  const recoil = Number.isFinite(w.recoilV) ? w.recoilV : 10;
  const variation = Number.isFinite(w.recoilVar) ? w.recoilVar : 100;
  const sips = Number.isFinite(w.recoilIncAds) ? w.recoilIncAds : 2;
  const moving = Number.isFinite(w._movingAdsMinSpreadDeg) ? w._movingAdsMinSpreadDeg : 1;
  const vel = Number.isFinite(w.bulletVel) ? w.bulletVel : 0;
  const ads = Number.isFinite(w._adsTimeMs) ? w._adsTimeMs : (Number.isFinite(w.adsTime) ? w.adsTime : 500);
  const mag = Number.isFinite(w.mag) ? w.mag : 0;
  const reload = Number.isFinite(w.tacRld) ? w.tacRld : 10;
  let score = 0;
  score += -recoil * (22 + 25*rangeT);
  score += -variation * (0.28 + 0.5*rangeT);
  score += -sips * (8 + 16*rangeT);
  score += -moving * (5 + 12*rangeT);
  score += vel * (0.004 + 0.012*rangeT);
  score += -ads * (0.018 + 0.035*closeT);
  score += mag * (0.04 + 0.04*closeT);
  score += -reload * (0.35 + 0.45*closeT);
  // Explicit mechanics are tiny tie-breaks only.
  if (attsSet.light === 'range_finder') score += 4*rangeT;
  if (['bipod','bipod_sr'].includes(attsSet.grip)) score += 3*rangeT;
  if (attsSet.ergo === 'ads_bolt') score += 4*rangeT;
  if (attsSet.ergo === 'mag_flare') score += 1.5;
  // Range-appropriate sighting matters independently of recoil. This prevents
  // a cheap iron sight from winning a 100m build just because the source marks
  // optics as mechanically neutral.
  score += opticRangeFit(attsSet.sight, d) * 0.35;
  return score;
}

function betterLethalAtDistance(a, b) {
  if (!b) return true;
  if (a.opticEligible !== b.opticEligible) return !!a.opticEligible;
  if (a.triggerTtk !== b.triggerTtk) return (a.triggerTtk ?? Infinity) < (b.triggerTtk ?? Infinity);
  if (a.ttk !== b.ttk) return (a.ttk ?? Infinity) < (b.ttk ?? Infinity);
  if (a.btk !== b.btk) return (a.btk ?? Infinity) < (b.btk ?? Infinity);
  if (a.damage !== b.damage) return (a.damage ?? -Infinity) > (b.damage ?? -Infinity);
  if (a.lowTtk !== b.lowTtk) return (a.lowTtk ?? Infinity) < (b.lowTtk ?? Infinity);
  // Equal lethality: first make sure the sight actually fits the selected range,
  // then choose the more controllable / cheaper build.
  if (a.opticFit !== b.opticFit) return (a.opticFit ?? -Infinity) > (b.opticFit ?? -Infinity);
  if (a.beamIndex !== b.beamIndex) return (a.beamIndex ?? Infinity) < (b.beamIndex ?? Infinity);
  if (a.practical !== b.practical) return a.practical > b.practical;
  if (a.points !== b.points) return a.points < b.points;
  return a.buildId < b.buildId;
}

function buildIdFor(attsSet) {
  const text=['sight','muzzle','barrel','grip','laser','light','ergo','mag','ammo'].map(k=>`${k}:${attsSet[k] ?? ''}`).join('|');
  let h=0xcbf29ce484222325n;
  for (const ch of text) { h ^= BigInt(ch.codePointAt(0)); h = BigInt.asUintN(64, h * 0x100000001b3n); }
  return `b_${h.toString(16).padStart(16,'0')}`;
}

const results = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  source: {
    repository: 'raymdl/BF6-Weapon-Analyzer',
    gameVersion: GAME_VERSION,
    rankingModel: 'laserbeam-v4-stable-utility-range-optics',
    opticModel: 'tier-range-fit-v1',
    manualBuildModel: 'range-lethality-v2',
    commit: (() => { try { return execFileSync('git',['-C',upstream,'rev-parse','HEAD'],{encoding:'utf8'}).trim(); } catch { return null; } })(),
    totalWeapons: weapons.length,
    classFilter: CLASS_FILTER,
    weaponFilter: WEAPON_FILTER,
    policy: 'Raw weapon/attachment facts and upstream simulator math only. No tier lists, popularity, usage, creator rankings, or community meta scores are inputs.'
  },
  rules: {
    distances: [DIST_MIN,DIST_MAX],
    primaryBudget: PRIMARY_BUDGET,
    sidearmBudget: SIDEARM_BUDGET,
    weaponRankOrder: ['anchored 12% lethal ceiling','pool-stable 55/45 percentage utility: triggerTtk^0.55 × BeamIndex^0.45','range-eligible optic fit tie-break','trigger-to-lethal-impact chest TTK','mechanical chest TTK','BTK','damage/shot'],
    attachmentPolicy: 'All legal user-visible combinations are counted. Speculative/assumed attachment mechanics are excluded from verified AUTO META; functionally identical or strictly more-expensive verified duplicates are safely collapsed before simulation.',
    manualWeaponPolicy: 'BUILD MY GUN uses a separate range-aware bestLethal winner: a clearly unsuitable optic cannot beat a suitable optic merely on point cost; within range-eligible builds trigger-to-kill stays first, then mechanical TTK/BTK/damage, optic fit, Beam Index and cost.'
  },
  audit: { weaponsSource: selectedWeapons.length, totalWeaponsSource: weapons.length, modeled:0, incomplete:0, rawLegalCombinations:'0', canonicalCombinationsEvaluated:0, distancesPerWeapon:DIST_MAX-DIST_MIN+1, verifiedSourceFieldsStripped:sourceSanitizeStats.strippedFields, verifiedSourceRecordsSanitized:sourceSanitizeStats.touchedRecords, errors:[] },
  weapons: {}
};
let rawTotal = 0n;

for (const w of selectedWeapons) {
  const budget = budgetFor(w);
  const rawCount = countAllLegalCombinations(w);
  rawTotal += rawCount;
  const options = canonicalOptions(w);
  if (!options) {
    results.audit.incomplete++;
    results.weapons[w.id] = { id:w.id,name:w.name,cls:w.cls,budget,status:'incomplete',reason:'missing compatibility/point data',rawLegalCombinations:String(rawCount) };
    continue;
  }
  const slots = Object.keys(options);
  const minRemaining = Array(slots.length+1).fill(0);
  for (let i=slots.length-1;i>=0;i--) minRemaining[i] = minRemaining[i+1] + Math.min(...options[slots[i]].map(o=>o.pts));

  const best = Array(DIST_MAX + 1).fill(null);
  const bestLethal = Array(DIST_MAX + 1).fill(null);
  const autoBuckets = Array.from({length:DIST_MAX+1},()=>new Map());
  const buildDict = {};
  const profileCache = new Map();
  const beamPrimitiveCache = new Map();
  const scoringStateBestPoints = new Map();
  let scoringStatesEvaluated = 0;
  let scoringStatesSkipped = 0;
  let canonicalCount = 0;
  const picks = [];

  function visit(i, used) {
    if (used + minRemaining[i] > budget) return;
    if (i === slots.length) {
      canonicalCount++;
      if (canonicalCount % 250000 === 0) {
        const mem = process.memoryUsage();
        console.log(`${w.id}: canonical progress ${canonicalCount.toLocaleString()} (states ${scoringStatesEvaluated.toLocaleString()}, deduped ${scoringStatesSkipped.toLocaleString()}, heap ${(mem.heapUsed/1048576).toFixed(0)}MB)`);
      }
      if (canonicalCount > MAX_CANONICAL_COMBOS_PER_WEAPON) throw new Error(`${w.id}: canonical combination guard exceeded ${MAX_CANONICAL_COMBOS_PER_WEAPON}`);
      const attSet = toAttSet(picks, w);
      const exactPts = computeAttPts(attSet, w, { ...atts, ...ammo });
      if (exactPts !== used || exactPts > budget) throw new Error(`${w.id}: point mismatch ${used} vs ${exactPts}`);
      let modified = applyAttachments(w, attSet);
      if (w.cls === 'Shotgun') modified = applyVerifiedShotgunLethality(modified, attSet.ammo);
      if (w.cls === 'Sniper Rifle') modified = applyVerifiedSniperLethality(modified);
      const stateSig = scoringStateSignature(modified, attSet);
      const prevStatePts = scoringStateBestPoints.get(stateSig);
      if (prevStatePts != null && prevStatePts <= exactPts) { scoringStatesSkipped++; return; }
      scoringStateBestPoints.set(stateSig, exactPts);
      scoringStatesEvaluated++;
      const buildId = buildIdFor(attSet);
      const lethalityKey = JSON.stringify({
        dmg:modified.dmg, pellets:modified.pellets ?? 1, rpm:modified.rpm, fireMode:modified.fireMode,
        burstRounds:modified.burstRounds, burstBurstsPerMinute:modified.burstBurstsPerMinute,
        burstRpm:modified.burstRpm, limb:modified._limbMult ?? 1, shotgunAmmo:modified._shotgunAmmoId ?? null, shotgunCadence:modified._shotgunAuditDef?.cadence ?? null,
        sniperCadence:modified._sniperAuditDef?.shotIntervalMs ?? null, sniperCurve:modified._sniperAuditDef?.curve ?? null,
        bulletVel:modified.bulletVel, ammo:attSet.ammo, dragPerMeter:dragForBuild(modified,attSet),
      });
      let profile = profileCache.get(lethalityKey);
      if (!profile) { profile = combatProfile(modified,attSet); profileCache.set(lethalityKey, profile); }
      const beamKey = JSON.stringify({
        rpm:modified.rpm, fireMode:modified.fireMode, burstRounds:modified.burstRounds,
        burstBurstsPerMinute:modified.burstBurstsPerMinute, burstRpm:modified.burstRpm,
        recoilV:modified.recoilV, recoilVar:modified.recoilVar, recoilIncAds:modified.recoilIncAds,
        adsSpread:modified.spread?.adsStand ?? null, adsDyn:modified.spreadDyn?.ads ?? null,
        adsRecoilDecayMult:modified._adsRecoilDecayMult ?? 1,
        adsSpreadDecayBoost:modified._adsSpreadDecayBoost ?? 0,
        spreadFiringDecCoefMult:modified._spreadFiringDecCoefMult ?? 1,
        spreadFiringDecOffsetMult:modified._spreadFiringDecOffsetMult ?? 1,
        movingAdsMinSpreadDeg:modified._movingAdsMinSpreadDeg ?? null,
      });
      let beamBase = beamPrimitiveCache.get(beamKey);
      if (!beamBase) { beamBase = beamPrimitives(modified); beamPrimitiveCache.set(beamKey, beamBase); }
      let potentialWinner=false;
      for (const row of profile) {
        const opticFit = opticRangeFit(attSet.sight, row.d);
        const candidate = {
          buildId, points:exactPts, damage:row.damage, btk:row.btk, ttk:row.ttk, mechTtk:row.mechTtk,
          flightMs:row.flightMs, triggerTtk:row.triggerTtk, ballisticsExact:row.ballisticsExact,
          lowBtk:row.lowBtk, lowTtk:row.lowTtk,
          sightId:attSet.sight, sightName:opticLabel(attSet.sight), opticFit,
          opticEligible:opticFit >= minimumOpticFit(modified,row.d),
          practical: practicalScore(modified,row.d,attSet),
          ...beamMetricsFromPrimitives(beamBase,row.d),
        };
        if (betterLethalAtDistance(candidate,bestLethal[row.d])) { bestLethal[row.d] = candidate; potentialWinner=true; }
        if(offerAutoBucketCandidate(autoBuckets[row.d],candidate)) potentialWinner=true;
      }
      // Store full build if it remains a strict-lethal winner or an AUTO bucket
      // candidate. Final cleanup retains only the actual 1-300m winners.
      if (potentialWinner) {
        buildDict[buildId] = {
          id:buildId, points:exactPts, atts:attSet,
          picks:picks.map(p=>{ const d=optionData(p.slot,w,p.id) ?? {id:p.id,name:p.id}; return {slot:p.slot,id:p.id,name:d.name ?? p.id,pts:p.pts}; }),
          stats:{ rpm:modified.rpm, bulletVel:modified.bulletVel, recoilV:modified.recoilV, recoilVar:modified.recoilVar,
            recoilIncAds:modified.recoilIncAds, adsTimeMs:modified._adsTimeMs ?? modified.adsTime ?? null,
            movingAdsMinSpreadDeg:modified._movingAdsMinSpreadDeg ?? null,
            beam:beamMetricsFromPrimitives(beamBase,50), mag:modified.mag, tacRld:modified.tacRld,
            fireMode:modified.fireMode, burstRounds:modified.burstRounds ?? null },
        };
      }
      return;
    }
    const slot = slots[i];
    for (const opt of options[slot]) {
      if (used + opt.pts > budget) continue;
      picks.push({slot,id:opt.id,pts:opt.pts});
      visit(i+1, used+opt.pts);
      picks.pop();
    }
  }

  try {
    visit(0,0);
    for(let d=DIST_MIN;d<=DIST_MAX;d++) best[d]=selectAnchoredAuto(autoBuckets[d],bestLethal[d]);
    const winningIds = new Set([...best.filter(Boolean), ...bestLethal.filter(Boolean)].map(x=>x.buildId));
    for (const id of Object.keys(buildDict)) if (!winningIds.has(id)) delete buildDict[id];
    results.weapons[w.id] = {
      id:w.id,name:w.name,cls:w.cls,budget,status:'modeled',
      rawLegalCombinations:String(rawCount), canonicalCombinationsEvaluated:canonicalCount,
      uniqueLethalityProfiles:profileCache.size, uniqueBeamProfiles:beamPrimitiveCache.size, uniqueScoringStates:scoringStatesEvaluated, scoringStatesDeduped:scoringStatesSkipped,
      builds:buildDict,
      best:Object.fromEntries(best.slice(DIST_MIN).map((x,idx)=>[String(idx+DIST_MIN),x])),
      bestLethal:Object.fromEntries(bestLethal.slice(DIST_MIN).map((x,idx)=>[String(idx+DIST_MIN),x])),
    };
    results.audit.modeled++;
    results.audit.canonicalCombinationsEvaluated += canonicalCount;
    console.log(`${w.id.padEnd(14)} raw=${String(rawCount).padStart(10)} canonical=${String(canonicalCount).padStart(8)} states=${String(scoringStatesEvaluated).padStart(8)} deduped=${String(scoringStatesSkipped).padStart(8)} lethal=${String(profileCache.size).padStart(5)} beam=${String(beamPrimitiveCache.size).padStart(5)} winners=${String(winningIds.size).padStart(4)}`);
  } catch (err) {
    results.audit.incomplete++;
    results.audit.errors.push(String(err.message || err));
    results.weapons[w.id] = { id:w.id,name:w.name,cls:w.cls,budget,status:'error',reason:String(err.message||err),rawLegalCombinations:String(rawCount) };
    console.error(err);
  }
}
results.audit.rawLegalCombinations = String(rawTotal);
results.audit.pass = results.audit.errors.length === 0 && results.audit.incomplete === 0 && results.audit.modeled === results.audit.weaponsSource;
await mkdir(outDir,{recursive:true});
await mkdir(resolve(CACHE_OUT,'..'),{recursive:true});
await mkdir(resolve(AUDIT_OUT,'..'),{recursive:true});
await writeFile(CACHE_OUT, JSON.stringify(results));
await writeFile(AUDIT_OUT, JSON.stringify({generatedAt:results.generatedAt,source:results.source,rules:results.rules,audit:results.audit},null,2));
console.log('\nAUDIT', JSON.stringify(results.audit,null,2));
if (!results.audit.pass) process.exitCode = 2;
