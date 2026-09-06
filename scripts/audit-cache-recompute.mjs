#!/usr/bin/env node
/**
 * Recompute every cached row from first principles, with an INDEPENDENT engine.
 *
 * WHY THIS GATE EXISTS. Mutation testing found two real holes:
 *
 *   1. Hand-editing a TTK value inside data/combat-cache.json survived all 30 gates.
 *      The cache is ~17 MB of generated numbers the whole product reads;
 *      validate-combat-cache.mjs only checks STRUCTURAL validity (finite, positive,
 *      within budget), and audit-cache-identity.mjs - despite its name - checks
 *      in-memory scenario-key behaviour, not the file. Nothing verified that a cached
 *      number was the number the model produces.
 *   2. Changing an attachment's point cost in data/attachments.json also survived
 *      everything. The cache carries its own copy of each pick's cost, so the catalog
 *      and the cache can silently disagree and the product prices builds wrongly.
 *
 * Both are closed here. The math comes from scripts/reference-engine.mjs, which
 * re-implements it from documented mechanics rather than by calling the cache builder,
 * so this is a genuine cross-check and not a restatement. Each cached row carries the
 * build stats it came from, so every row is re-derivable without rebuilding the cache
 * (~40 minutes) - this runs in seconds.
 *
 * WHAT IT CHECKS, for the AUTO and max-lethality winner at all 300 distances of all
 * 62 weapons:
 *
 *   btk        = ceil(100 / damage)                             independent
 *   ttk        = summed shot intervals over (btk-1) shots       independent
 *   flightMs   = closed-form quadratic-drag flight time         independent
 *   triggerTtk = ttk + flightMs                                 independent
 *   lowBtk     = ceil(100 / (damage x limb multiplier)), with ONE multiplier per
 *                weapon drawn from the documented table         independent
 *   lowTtk     = the same cadence applied to lowBtk             independent
 *   sniper damage = the audited linear sweet-spot curve         independent
 *   pick costs = the LIVE catalog's costs, not the cache's copy independent
 *   beamIndex  = the documented ranking formula                 SHARED ASSUMPTION
 *   points, budget, one pick per slot, damage shape
 *
 * The beamIndex check is arithmetic only: that formula is this project's ranking
 * policy, so re-deriving it can catch a corrupted number but never validate the model.
 *
 * NOTE ON DAMAGE SHAPE: damage is NOT monotonically decreasing for sniper rifles -
 * they have a sweet spot where damage RISES with distance. An earlier draft asserted
 * monotonicity and produced 158 false failures on the L115, M2010 ESR and PSR. The
 * check is now per class, and the snipers get the stronger treatment instead: their
 * damage is recomputed from the audited curve at every metre.
 *
 * Usage: node scripts/audit-cache-recompute.mjs [--tolerance-ms 1]
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import {
  btkFor, ttkMs, pairedShotgunTtkMs, flightSeconds, beamIndexFor,
  sniperDamageAt, SHARED_ASSUMPTIONS
} from './reference-engine.mjs';
import { loadEffectiveWeapons } from './source-overlay.mjs';

const j = async p => JSON.parse(await readFile(p, 'utf8'));
const [cache, ballistics, sniperAudit, shotgunAudit, attachments, ammoCatalog] = await Promise.all([
  j('data/combat-cache.json'), j('data/ballistics.json'),
  j('data/sniper-audit.json'), j('data/shotgun-audit.json'),
  j('data/attachments.json'), j('data/ammo.json')
]);
const weapons = new Map(loadEffectiveWeapons('data/weapons.json').map(w => [w.id, w]));

const errors = [];
const notes = [];
const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const alias = id => ({ '185ksk': 'ks18k', kts100mk8: 'kts100' })[norm(id)] ?? norm(id);

/** Drag for a build: a data lookup, not a formula. */
function dragFor(cls, ammoId) {
  if (ammoId === 'long_range' && Number.isFinite(Number(ballistics?.ammoDragPerMeter?.long_range))) return Number(ballistics.ammoDragPerMeter.long_range);
  if (ammoId === 'penetration' && Number.isFinite(Number(ballistics?.ammoDragPerMeter?.penetration?.[cls]))) return Number(ballistics.ammoDragPerMeter.penetration[cls]);
  return Number(ballistics.baseDragPerMeter);
}

/** Audited fixed cadences that override the nominal RPM path. */
function auditedCadence(weaponId, cls) {
  if (cls === 'Sniper Rifle') {
    for (const [id, def] of Object.entries(sniperAudit.weapons ?? {})) {
      if (alias(id) === alias(weaponId) && Number(def?.shotIntervalMs) > 0) return { kind: 'interval', intervalMs: Number(def.shotIntervalMs) };
    }
  }
  if (cls === 'Shotgun') {
    for (const [id, def] of Object.entries(shotgunAudit.weapons ?? {})) {
      if (alias(id) !== alias(weaponId)) continue;
      const cad = def?.cadence;
      if (cad?.type === 'paired') return { kind: 'paired', cadence: cad };
      if (cad?.type === 'constant' && Number(cad.rpm) > 0) return { kind: 'interval', intervalMs: 60000 / Number(cad.rpm) };
    }
  }
  return null;
}
const sniperCurveFor = weaponId => {
  for (const [id, def] of Object.entries(sniperAudit.weapons ?? {})) {
    if (alias(id) === alias(weaponId) && Array.isArray(def?.curve)) return def.curve;
  }
  return null;
};

/**
 * The LIVE catalog cost of a pick, so the cache's own copy cannot drift from it unseen.
 *
 * A pick's SLOT is not the same thing as its catalog POOL. Some weapons have a combined
 * rail - the VZ. 61 declares laserGripLightCombined, so grips such as "Stippled Stubby"
 * are legitimately offered in its `laser` slot and appear in WEAPON_ATTS.vz61.laser.
 * An earlier draft looked the id up in the LASERS pool only and reported three false
 * failures. Legality therefore comes from the weapon's own compatibility list, and the
 * cost from whichever pool actually defines the option.
 *
 * Returns { cost, legal } so an ILLEGAL pick is a distinct finding from an UNKNOWN one.
 */
const ERGO_AVAIL = (weaponId) => attachments.WEAPON_ERGO?.[weaponId]?.avail ?? [];
function catalogCost(weaponId, slot, id) {
  if (id === 'none') return { cost: 0, legal: true };
  if (slot === 'mag') {
    const m = attachments.WEAPON_MAG?.[weaponId]?.mags?.[id];
    return { cost: m ? Number(m.pts) : null, legal: !!m };
  }
  if (slot === 'ammo') {
    const pts = ammoCatalog.WEAPON_AMMO?.[weaponId]?.ammo?.[id];
    return { cost: pts === undefined ? null : Number(pts), legal: pts !== undefined };
  }
  // An ABSENT compatibility list means the slot is unrestricted, not empty. Only 7 of
  // 62 weapons declare a `sight` list (the sidearms and the VZ. 61, which are limited
  // to irons and a standard optic); the other 55 take any sight. Treating absence as
  // "nothing is legal" produced a wave of false failures on every weapon with an
  // ordinary optic.
  const compat = slot === 'ergo' ? ERGO_AVAIL(weaponId) : attachments.WEAPON_ATTS?.[weaponId]?.[slot];
  const legal = Array.isArray(compat) ? compat.includes(id) : true;
  for (const pool of ['SIGHTS', 'MUZZLES', 'BARRELS', 'GRIPS', 'LASERS', 'LIGHTS', 'ERGOS']) {
    const opt = (attachments[pool] ?? []).find(o => o?.id === id);
    if (opt) return { cost: Number(opt.pts), legal };
  }
  return { cost: null, legal };
}

/**
 * Documented limb multipliers (upstream balance_tables LIMB_CLASS_MULT). Exactly ONE
 * of these must reproduce every low-body BTK for a weapon; if none does, the low-body
 * figures were not produced by the documented single-multiplier rule.
 */
const LIMB_CANDIDATES = [0.67, 0.84, 0.91, 1];

const TOL_MS = Number(process.argv[process.argv.indexOf('--tolerance-ms') + 1]) || 1;
const near = (a, b, tol) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;

let rowsChecked = 0, valuesChecked = 0;
const perWeapon = [];
const failuresByKind = {};
const fail = (kind, msg) => {
  failuresByKind[kind] = (failuresByKind[kind] ?? 0) + 1;
  if (errors.length < 60) errors.push(`[${kind}] ${msg}`);
  else if (errors.length === 60) errors.push('... further failures suppressed');
};

// Pick costs are a per-build property; check each build once rather than 600 times.
const buildsChecked = new Set();

for (const [id, w] of Object.entries(cache.weapons ?? {})) {
  const cadence = auditedCadence(id, w.cls);
  const sniperCurve = w.cls === 'Sniper Rifle' ? sniperCurveFor(id) : null;
  const eff = weapons.get(id);
  // Burst cadence needs burstBurstsPerMinute, which build.stats does not carry (see
  // the artifact note below). It is a weapon property, not an attachment one, so the
  // effective weapon record is the right source.
  const burstCycle = { burstRpm: eff?.burstRpm, burstBurstsPerMinute: eff?.burstBurstsPerMinute };
  const limbSurvivors = new Set(LIMB_CANDIDATES);
  let weaponRows = 0;

  for (const strategy of ['best', 'bestLethal']) {
    let prevDamage = Infinity;
    for (let d = 1; d <= 300; d++) {
      const row = w[strategy]?.[String(d)];
      if (!row) { fail('missing-row', `${id} ${strategy}@${d}m missing`); continue; }
      const build = w.builds?.[row.buildId];
      if (!build) { fail('missing-build', `${id} ${strategy}@${d}m references unknown build ${row.buildId}`); continue; }
      const stats = { ...build.stats, ...burstCycle };
      rowsChecked++; weaponRows++;

      // ---- BTK from damage ----
      valuesChecked++;
      const expectBtk = btkFor(row.damage);
      if (expectBtk !== row.btk) fail('btk', `${id} ${strategy}@${d}m btk ${row.btk} but ceil(100/${row.damage}) = ${expectBtk}`);

      // ---- mechanical TTK from cadence ----
      valuesChecked++;
      const ttkOf = n => cadence?.kind === 'paired'
        ? pairedShotgunTtkMs(cadence.cadence, n)
        : ttkMs(stats, n, cadence?.kind === 'interval' ? cadence.intervalMs : null);
      const expectTtk = ttkOf(row.btk);
      if (!near(expectTtk, row.ttk, TOL_MS)) fail('ttk', `${id} ${strategy}@${d}m ttk ${row.ttk} but recomputed ${expectTtk} (btk ${row.btk}, rpm ${stats.rpm}, mode ${stats.fireMode})`);
      valuesChecked++;
      if (row.mechTtk !== row.ttk) fail('mechttk', `${id} ${strategy}@${d}m mechTtk ${row.mechTtk} != ttk ${row.ttk}`);

      // ---- flight time from the projectile model ----
      valuesChecked++;
      const sec = flightSeconds(stats.bulletVel, dragFor(w.cls, build.atts?.ammo ?? 'standard'), d);
      if (sec == null) {
        if (row.flightMs != null) fail('flight', `${id} ${strategy}@${d}m has flightMs ${row.flightMs} but no usable projectile model`);
      } else if (!near(sec * 1000, row.flightMs, 0.01)) {
        fail('flight', `${id} ${strategy}@${d}m flightMs ${row.flightMs} but recomputed ${(sec * 1000).toFixed(4)}`);
      }

      // ---- trigger-to-kill ----
      valuesChecked++;
      if (Number.isFinite(row.flightMs) && Number.isFinite(row.ttk) && !near(row.ttk + row.flightMs, row.triggerTtk, 0.01)) {
        fail('triggerttk', `${id} ${strategy}@${d}m triggerTtk ${row.triggerTtk} != ttk ${row.ttk} + flight ${row.flightMs}`);
      }

      // ---- low-body ----
      if (Number.isFinite(row.lowBtk)) {
        valuesChecked++;
        if (row.lowBtk < row.btk) fail('lowbtk', `${id} ${strategy}@${d}m lowBtk ${row.lowBtk} < chest btk ${row.btk}`);
        for (const m of [...limbSurvivors]) {
          if (btkFor(row.damage * m) !== row.lowBtk) limbSurvivors.delete(m);
        }
        valuesChecked++;
        if (!near(ttkOf(row.lowBtk), row.lowTtk, TOL_MS)) fail('lowttk', `${id} ${strategy}@${d}m lowTtk ${row.lowTtk} but recomputed ${ttkOf(row.lowBtk)}`);
      }

      // ---- sniper damage from the audited curve (independent) ----
      if (sniperCurve && (build.atts?.ammo ?? 'standard') === 'standard') {
        valuesChecked++;
        const expectDmg = sniperDamageAt(sniperCurve, d);
        if (expectDmg != null && !near(expectDmg, row.damage, 0.02)) {
          fail('sniper-damage', `${id} ${strategy}@${d}m damage ${row.damage} but the audited curve gives ${expectDmg.toFixed(3)}`);
        }
      }

      // ---- beam index (SHARED ASSUMPTION - ranking policy, not a mechanic) ----
      valuesChecked++;
      const expectBeam = beamIndexFor({ recoil: row.recoil, unpredictable: row.unpredictableRecoil, effSpread: row.effectiveAdsSpreadDeg, moving: row.movingAdsMinSpreadDeg }, d);
      if (!near(expectBeam, row.beamIndex, 1e-5)) fail('beamindex', `${id} ${strategy}@${d}m beamIndex ${row.beamIndex} but recomputed ${expectBeam.toFixed(6)}`);

      // ---- points, budget, slots, and LIVE catalog costs ----
      valuesChecked++;
      if (row.points !== build.points) fail('points-row', `${id} ${strategy}@${d}m row points ${row.points} != build points ${build.points}`);
      if (!buildsChecked.has(row.buildId)) {
        buildsChecked.add(row.buildId);
        const picks = Array.isArray(build.picks) ? build.picks : [];
        const slots = picks.map(p => p.slot);
        if (new Set(slots).size !== slots.length) fail('duplicate-slot', `${id} build ${row.buildId} has two picks in one slot: ${slots.join(',')}`);
        let live = 0;
        for (const p of picks) {
          const { cost, legal } = catalogCost(id, p.slot, p.id);
          valuesChecked += 2;
          if (!legal) fail('pick-illegal', `${id} build ${row.buildId} equips ${p.slot}/${p.id}, which is not in this weapon's compatibility list for that slot`);
          if (cost === null) { fail('pick-not-in-catalog', `${id} build ${row.buildId} pick ${p.slot}/${p.id} is defined in no catalog pool`); continue; }
          if (Number(p.pts) !== cost) fail('pick-cost-drift', `${id} build ${row.buildId} pick ${p.slot}/${p.id} cached at ${p.pts} points but the live catalog says ${cost}`);
          live += cost;
        }
        if (live !== build.points) fail('points-sum', `${id} build ${row.buildId} declares ${build.points} points but the live catalog totals ${live}`);
        if (live > w.budget) fail('over-budget', `${id} build ${row.buildId} costs ${live} at live catalog prices, over the ${w.budget} budget`);
      }

      // ---- damage shape. Snipers legitimately RISE into a sweet spot; others must not.
      valuesChecked++;
      if (Number.isFinite(row.damage)) {
        if (w.cls !== 'Sniper Rifle' && row.damage > prevDamage + 1e-9) {
          fail('damage-monotonic', `${id} ${strategy}@${d}m damage ${row.damage} exceeds ${prevDamage} at the previous metre`);
        }
        prevDamage = row.damage;
      }
    }
  }

  if (!limbSurvivors.size) {
    fail('limb-multiplier', `${id}: no single documented limb multiplier (${LIMB_CANDIDATES.join('/')}) reproduces every low-body BTK`);
  }
  perWeapon.push({ weaponId: id, cls: w.cls, rows: weaponRows, limbMultiplier: [...limbSurvivors] });
}

// ---------------------------------------------------------------------------
// CATALOG SHAPE FINGERPRINT
//
// Mutation testing found that two catalog edits survived every gate: raising an
// attachment's point cost, and granting a weapon a slot it has no compatibility for.
// Both are invisible to a stale cache, because the cache carries its own copy of the
// costs and its builds simply never use the newly-legal option.
//
// The cache does, however, record how many legal attachment combinations each weapon
// had when it was built. That number is a fingerprint of the ENTIRE catalog shape for
// that weapon: every compatibility list, every point cost, every magazine and ammo
// option, and the budget. Recomputing it here from the live catalog and comparing
// makes any catalog change that could alter what is buildable impossible to ship
// against a stale cache.
//
// The counting rules below (an implicit "none" in optional slots, a required barrel,
// combined rails folding grip/light into laser) are catalog CONVENTIONS, re-derived
// from the data's own structure rather than imported from the builder.
// ---------------------------------------------------------------------------
const POOL_FOR_SLOT = { sight: 'SIGHTS', muzzle: 'MUZZLES', barrel: 'BARRELS', grip: 'GRIPS', laser: 'LASERS', light: 'LIGHTS', ergo: 'ERGOS' };
const railItem = id => ['LASERS', 'LIGHTS', 'GRIPS'].map(p => (attachments[p] ?? []).find(o => o?.id === id)).find(Boolean) ?? null;

function slotOptionIds(weaponId) {
  const wa = attachments.WEAPON_ATTS?.[weaponId];
  if (!wa) return null;
  const allIds = slot => (attachments[POOL_FOR_SLOT[slot]] ?? []).map(x => x.id);
  const hasNone = slot => (attachments[POOL_FOR_SLOT[slot]] ?? []).some(o => o?.id === 'none');
  const allowed = (slot, required = false) => {
    let ids = Array.isArray(wa[slot]) ? [...wa[slot]] : allIds(slot);
    if (!required && !ids.includes('none') && hasNone(slot)) ids.unshift('none');
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
    ergo: ['none', ...(attachments.WEAPON_ERGO?.[weaponId]?.avail ?? [])],
    mag: Object.keys(attachments.WEAPON_MAG?.[weaponId]?.mags ?? {}),
    ammo: Object.keys(ammoCatalog.WEAPON_AMMO?.[weaponId]?.ammo ?? {})
  };
  if (wa.laserLightCombined) {
    const merged = [...(wa.laser ?? []), ...(wa.light ?? [])];
    if (wa.laserGripLightCombined) merged.push(...(wa.grip ?? []));
    out.laser = ['none', ...merged.filter(id => id !== 'none')];
    out.light = ['none'];
    if (wa.laserGripLightCombined) out.grip = ['none'];
  }
  return out;
}
function optionPoints(weaponId, slot, id) {
  if (slot === 'mag') return attachments.WEAPON_MAG?.[weaponId]?.mags?.[id]?.pts ?? null;
  if (slot === 'ammo') return ammoCatalog.WEAPON_AMMO?.[weaponId]?.ammo?.[id] ?? null;
  if (slot === 'laser') return railItem(id)?.pts ?? null;
  return (attachments[POOL_FOR_SLOT[slot]] ?? []).find(o => o?.id === id)?.pts ?? null;
}
/** Count every combination that fits the budget. Knapsack over slots, exact big-int. */
function countLegalCombinations(weaponId, budget) {
  const ids = slotOptionIds(weaponId);
  if (!ids) return null;
  let dp = Array(budget + 1).fill(0n); dp[0] = 1n;
  for (const slot of Object.keys(ids)) {
    const next = Array(budget + 1).fill(0n);
    for (let used = 0; used <= budget; used++) {
      if (!dp[used]) continue;
      for (const id of [...new Set(ids[slot])]) {
        const p = optionPoints(weaponId, slot, id);
        if (!Number.isFinite(p) || p < 0 || used + p > budget) continue;
        next[used + p] += dp[used];
      }
    }
    dp = next;
  }
  return dp.reduce((a, b) => a + b, 0n);
}

let catalogWeaponsChecked = 0;
for (const [id, w] of Object.entries(cache.weapons ?? {})) {
  if (w.rawLegalCombinations == null) continue;
  const live = countLegalCombinations(id, Number(w.budget));
  valuesChecked++; catalogWeaponsChecked++;
  if (live == null) { fail('catalog-shape', `${id} has no compatibility record in the live catalog, but the cache holds ${w.rawLegalCombinations} combinations for it`); continue; }
  if (String(live) !== String(w.rawLegalCombinations)) {
    fail('catalog-shape', `${id}: the live catalog yields ${live} legal attachment combinations but the cache was built from ${w.rawLegalCombinations}. The catalog changed after the cache was generated - rerun the Combat Engine.`);
  }
}

notes.push('build.stats does not carry burstBurstsPerMinute, so a burst weapon\'s cached TTK cannot be re-derived from the cache alone; it is read from the effective weapon record here. Adding it to the cache would make the artifact fully self-verifying.');
notes.push(`catalog shape verified for ${catalogWeaponsChecked} weapons by recounting every legal attachment combination from the live catalog and comparing with the count the cache was built from.`);

const report = {
  generatedAt: new Date().toISOString(),
  method: 'Each cached row re-derived with scripts/reference-engine.mjs, which re-implements the math from documented mechanics and imports nothing from the cache builder or app.js. Attachment costs are checked against the LIVE catalog, not the cache\'s own copy.',
  sharedAssumptions: SHARED_ASSUMPTIONS,
  cacheGeneratedAt: cache.generatedAt,
  weapons: perWeapon.length,
  rowsChecked, valuesChecked, buildsChecked: buildsChecked.size,
  toleranceMs: TOL_MS,
  limbMultipliersResolved: Object.fromEntries(perWeapon.map(p => [p.weaponId, p.limbMultiplier])),
  failuresByKind, notes, errors
};
await mkdir('reports/validation', { recursive: true });
await writeFile('reports/validation/cache-recompute.json', JSON.stringify(report, null, 1));

console.log(`cache recompute — ${perWeapon.length} weapons, ${rowsChecked} rows, ${buildsChecked.size} distinct builds, ${valuesChecked} independently recomputed values`);
for (const n of notes) console.log(`  note: ${n}`);
if (errors.length) {
  console.error(`\nFAIL: ${Object.entries(failuresByKind).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.error(errors.slice(0, 25).join('\n'));
  process.exitCode = 1;
} else {
  console.log('\nPASS: every cached value re-derives independently, and every cached attachment cost matches the live catalog.');
  console.log('NOTE: the Beam Index check is arithmetic only - that formula is this project\'s ranking policy, not a game mechanic.');
}
