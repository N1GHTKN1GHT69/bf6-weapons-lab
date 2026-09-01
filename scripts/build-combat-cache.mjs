#!/usr/bin/env node
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const upstream = resolve(process.argv[2] || process.env.BF6_ANALYZER_DIR || '.upstream/bf6-analyzer');
const outDir = resolve(process.argv[3] || 'data');
const DIST_MIN = 1;
const DIST_MAX = 300;
const PRIMARY_BUDGET = 100;
const SIDEARM_BUDGET = 60;
const MAX_CANONICAL_COMBOS_PER_WEAPON = 5_000_000;

const json = async p => JSON.parse(await readFile(p, 'utf8'));
const weapons = await json(join(upstream, 'data/weapons.json'));
const atts = await json(join(upstream, 'data/attachments.json'));
const ammo = await json(join(upstream, 'data/ammo.json'));
const balance = await json(join(upstream, 'data/balance_tables.json'));
const recoilDecay = await json(join(upstream, 'data/recoil_decay.json'));

const applyMod = await import(pathToFileURL(join(upstream, 'sim/applyAttachments.js')).href);
const damageMod = await import(pathToFileURL(join(upstream, 'sim/damage.js')).href);
const coreMod = await import(pathToFileURL(join(upstream, 'sim/core.js')).href);
const loadoutMod = await import(pathToFileURL(join(upstream, 'sim/loadout.js')).href);

const {
  setAttachmentContext, applyAttachments,
} = applyMod;
const { damagePerShotAtRange } = damageMod;
const { shotIntervalAfter, setSimContext } = coreMod;
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
    if (data.assumed === true || (Array.isArray(data.assumedFields) && data.assumedFields.length)) continue;
    const sig = functionalSignature(slot, data);
    const prev = keep.get(sig);
    if (!prev || pts < prev.pts || (pts === prev.pts && String(id).localeCompare(String(prev.id)) < 0)) {
      keep.set(sig, { id, pts, data });
    }
  }
  return [...keep.values()];
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
  for (const [slot, list] of Object.entries(ids)) {
    result[slot] = dedupeDominated(slot, w, [...new Set(list)]);
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

function ttkMs(w, btk) {
  if (!Number.isFinite(btk) || btk <= 0 || !w?.rpm) return null;
  let sec = 0;
  for (let shot=1; shot<btk; shot++) sec += shotIntervalAfter(w, shot);
  return Math.round(sec * 1000);
}
function combatProfile(w) {
  const rows = [];
  for (let d=DIST_MIN; d<=DIST_MAX; d++) {
    const damage = damagePerShotAtRange(w, d);
    const chestBtk = damage > 0 ? Math.ceil((100 - 1e-9) / damage) : null;
    const lowDamage = damage != null ? damage * (w._limbMult ?? 1) : null;
    const lowBtk = lowDamage > 0 ? Math.ceil((100 - 1e-9) / lowDamage) : null;
    rows.push({
      d,
      damage: damage == null ? null : +damage.toFixed(4),
      btk: chestBtk,
      ttk: chestBtk ? ttkMs(w, chestBtk) : null,
      lowBtk,
      lowTtk: lowBtk ? ttkMs(w, lowBtk) : null,
    });
  }
  return rows;
}

function practicalScore(w, distance, attsSet) {
  // This is only a tie-break AFTER TTK/BTK/damage. It is derived from transformed
  // weapon mechanics, never from community popularity or third-party rankings.
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
  return score;
}

function betterAtDistance(a, b) {
  if (!b) return true;
  // Hard independent-meta order: fastest ideal chest TTK first.
  if (a.ttk !== b.ttk) return (a.ttk ?? Infinity) < (b.ttk ?? Infinity);
  if (a.btk !== b.btk) return (a.btk ?? Infinity) < (b.btk ?? Infinity);
  if (a.damage !== b.damage) return (a.damage ?? -Infinity) > (b.damage ?? -Infinity);
  if (a.lowTtk !== b.lowTtk) return (a.lowTtk ?? Infinity) < (b.lowTtk ?? Infinity);
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
    commit: (() => { try { return execFileSync('git',['-C',upstream,'rev-parse','HEAD'],{encoding:'utf8'}).trim(); } catch { return null; } })(),
    policy: 'Raw weapon/attachment facts and upstream simulator math only. No tier lists, popularity, usage, creator rankings, or community meta scores are inputs.'
  },
  rules: {
    distances: [DIST_MIN,DIST_MAX],
    primaryBudget: PRIMARY_BUDGET,
    sidearmBudget: SIDEARM_BUDGET,
    weaponRankOrder: ['ideal chest TTK','BTK','damage/shot','low-body TTK','mechanical delivery tie-break'],
    attachmentPolicy: 'All legal user-visible combinations are counted. Speculative/assumed attachment mechanics are excluded from verified AUTO META; functionally identical or strictly more-expensive verified duplicates are safely collapsed before simulation.'
  },
  audit: { weaponsSource: weapons.length, modeled:0, incomplete:0, rawLegalCombinations:'0', canonicalCombinationsEvaluated:0, distancesPerWeapon:DIST_MAX-DIST_MIN+1, errors:[] },
  weapons: {}
};
let rawTotal = 0n;

for (const w of weapons) {
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
  const buildDict = {};
  const profileCache = new Map();
  let canonicalCount = 0;
  const picks = [];

  function visit(i, used) {
    if (used + minRemaining[i] > budget) return;
    if (i === slots.length) {
      canonicalCount++;
      if (canonicalCount > MAX_CANONICAL_COMBOS_PER_WEAPON) throw new Error(`${w.id}: canonical combination guard exceeded ${MAX_CANONICAL_COMBOS_PER_WEAPON}`);
      const attSet = toAttSet(picks, w);
      const exactPts = computeAttPts(attSet, w, { ...atts, ...ammo });
      if (exactPts !== used || exactPts > budget) throw new Error(`${w.id}: point mismatch ${used} vs ${exactPts}`);
      const modified = applyAttachments(w, attSet);
      const buildId = buildIdFor(attSet);
      const lethalityKey = JSON.stringify({
        dmg:modified.dmg, pellets:modified.pellets ?? 1, rpm:modified.rpm, fireMode:modified.fireMode,
        burstRounds:modified.burstRounds, burstBurstsPerMinute:modified.burstBurstsPerMinute,
        burstRpm:modified.burstRpm, limb:modified._limbMult ?? 1,
      });
      let profile = profileCache.get(lethalityKey);
      if (!profile) { profile = combatProfile(modified); profileCache.set(lethalityKey, profile); }
      for (const row of profile) {
        const candidate = {
          buildId, points:exactPts, damage:row.damage, btk:row.btk, ttk:row.ttk,
          lowBtk:row.lowBtk, lowTtk:row.lowTtk,
          practical: practicalScore(modified,row.d,attSet),
        };
        if (betterAtDistance(candidate,best[row.d])) best[row.d] = candidate;
      }
      // Store full build only if it is currently a winner somewhere. Final cleanup later.
      if (best.some(x=>x?.buildId===buildId)) {
        buildDict[buildId] = {
          id:buildId, points:exactPts, atts:attSet,
          picks:picks.map(p=>{ const d=optionData(p.slot,w,p.id) ?? {id:p.id,name:p.id}; return {slot:p.slot,id:p.id,name:d.name ?? p.id,pts:p.pts}; }),
          stats:{ rpm:modified.rpm, bulletVel:modified.bulletVel, recoilV:modified.recoilV, recoilVar:modified.recoilVar,
            recoilIncAds:modified.recoilIncAds, adsTimeMs:modified._adsTimeMs ?? modified.adsTime ?? null,
            movingAdsMinSpreadDeg:modified._movingAdsMinSpreadDeg ?? null, mag:modified.mag, tacRld:modified.tacRld,
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
    const winningIds = new Set(best.filter(Boolean).map(x=>x.buildId));
    for (const id of Object.keys(buildDict)) if (!winningIds.has(id)) delete buildDict[id];
    results.weapons[w.id] = {
      id:w.id,name:w.name,cls:w.cls,budget,status:'modeled',
      rawLegalCombinations:String(rawCount), canonicalCombinationsEvaluated:canonicalCount,
      uniqueLethalityProfiles:profileCache.size,
      builds:buildDict,
      best:Object.fromEntries(best.slice(DIST_MIN).map((x,idx)=>[String(idx+DIST_MIN),x])),
    };
    results.audit.modeled++;
    results.audit.canonicalCombinationsEvaluated += canonicalCount;
    console.log(`${w.id.padEnd(14)} raw=${String(rawCount).padStart(10)} canonical=${String(canonicalCount).padStart(8)} profiles=${String(profileCache.size).padStart(5)} winners=${String(winningIds.size).padStart(4)}`);
  } catch (err) {
    results.audit.incomplete++;
    results.audit.errors.push(String(err.message || err));
    results.weapons[w.id] = { id:w.id,name:w.name,cls:w.cls,budget,status:'error',reason:String(err.message||err),rawLegalCombinations:String(rawCount) };
    console.error(err);
  }
}
results.audit.rawLegalCombinations = String(rawTotal);
results.audit.pass = results.audit.errors.length === 0;
await mkdir(outDir,{recursive:true});
await writeFile(join(outDir,'combat-cache.json'), JSON.stringify(results));
await writeFile(join(outDir,'combat-audit.json'), JSON.stringify({generatedAt:results.generatedAt,source:results.source,rules:results.rules,audit:results.audit},null,2));
console.log('\nAUDIT', JSON.stringify(results.audit,null,2));
if (!results.audit.pass) process.exitCode = 2;
