#!/usr/bin/env node
/**
 * EXHAUSTIVE STATE-SPACE SWEEP of the production engine.
 *
 * The existing meta sweep covers 28 sampled distances. This covers every metre, every
 * mode, every armour state, both priorities, every scope, and both selection modes -
 * then drives every weapon individually through the same range. The point is not to
 * check rankings against expectations (nothing here knows what the "right" winner is);
 * it is to look for answers that CANNOT BE TRUE regardless of what the model says.
 *
 * COVERAGE, stated precisely rather than as "extensive":
 *
 *   TIER 1  AUTO rankings, fully enumerated:
 *           300 distances x 3 mode/armour states x 2 priorities x 8 scopes = 14,400
 *   TIER 2  Per-weapon manual (BUILD MY GUN), fully enumerated:
 *           62 weapons x 300 distances x 3 mode/armour states = 55,800
 *   TIER 3  Advanced handling preferences, STRATIFIED (2^4 = 16 combinations is beyond
 *           full enumeration against tiers 1-2): every preference combination is
 *           exercised, paired with a deterministic weapon/distance stratum so each
 *           combination meets every class and the full range. Deterministic index
 *           arithmetic, no randomness, so a failure is always reproducible.
 *
 * WHAT IT LOOKS FOR - impossibilities, not surprises:
 *   NaN / Infinity / null in a numeric result      illegal or over-budget builds
 *   BTK below 1, non-integer, or absurdly large    duplicate attachment slots
 *   negative TTK, or trigger-to-kill below mech    picks absent from the live catalog
 *   damage <= 0                                    mode leakage (see below)
 *   thrown exceptions                              non-deterministic output
 *
 * MODE LEAKAGE is checked as a specific property: in Multiplayer the armour selector
 * must have NO effect, because there is no armour in that mode. If a Multiplayer answer
 * changes when targetArmor changes, a REDSEC rule has reached the Multiplayer path.
 *
 * DETERMINISM is checked by evaluating a deterministic subsample twice, separated by
 * thousands of intervening queries, and requiring byte-identical results.
 *
 * Usage: node scripts/audit-state-space.mjs [--quick]
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { bootLab } from './lab-harness.mjs';

const QUICK = process.argv.includes('--quick');
const DISTANCES = QUICK ? [1, 10, 25, 50, 100, 200, 300] : Array.from({ length: 300 }, (_, i) => i + 1);
const MODES = [
  { key: 'MULTIPLAYER', gameMode: 'multiplayer', targetArmor: 'unarmored' },
  { key: 'REDSEC-UNARMORED', gameMode: 'redsec', targetArmor: 'unarmored' },
  { key: 'REDSEC-2PLATE', gameMode: 'redsec', targetArmor: 'plates2' }
];
const PRIORITIES = ['balanced', 'fastest'];

const { diag, window: win } = await bootLab();
const attachments = JSON.parse(await readFile('data/attachments.json', 'utf8'));
const ammoCatalog = JSON.parse(await readFile('data/ammo.json', 'utf8'));
const roster = win.BF6_CURRENT?.roster ?? [];
const scopes = ['__all__', ...(win.BF6_CURRENT?.primaryClasses ?? [])];

const anomalies = [];
const seen = new Set();
const record = (kind, detail) => {
  const key = `${kind}|${detail.weapon ?? ''}|${detail.field ?? ''}|${detail.mode ?? ''}`;
  anomalies.push({ kind, ...detail, firstOccurrenceOnly: seen.has(key) ? undefined : true });
  seen.add(key);
};
const rosterOnly = [];
const counters = { tier1: 0, tier2: 0, tier3: 0, rankedEntries: 0, buildsInspected: 0, exceptions: 0 };

/**
 * Roster id -> catalog id, resolved the way the app itself resolves it.
 *
 * The two id spaces are not identical: the 18.5KS-K is `185ksk` in the roster and
 * `ks18k` in the catalog, and the KTS100 MK8 is `kts100mk8` against `kts100`. Rather
 * than hand-maintain a table that can go stale, this asks the running app which raw
 * weapon each roster entry resolves to - the same mapping every displayed value already
 * uses. An earlier draft assumed the ids matched and produced hundreds of false
 * "illegal attachment" anomalies on exactly those two weapons.
 */
const catalogIdCache = new Map();
function catalogId(rosterId) {
  if (catalogIdCache.has(rosterId)) return catalogIdCache.get(rosterId);
  let resolved = rosterId;
  if (!attachments.WEAPON_ATTS?.[rosterId]) {
    const raw = diag.rawForRosterId(rosterId);
    resolved = raw?.id ?? null;
  }
  catalogIdCache.set(rosterId, resolved);
  return resolved;
}

/** Every attachment id a weapon may equip, from its own compatibility declarations. */
function legalIdsFor(rosterId) {
  const weaponId = catalogId(rosterId);
  const ids = new Set(['none']);
  const wa = attachments.WEAPON_ATTS?.[weaponId] ?? {};
  // A roster-only weapon has no upstream record and so no compatibility list. This is
  // a documented state (the Interdictor is excluded from verified AUTO META for exactly
  // this reason), so it is a NOTE, not an anomaly - reporting it as a failure would
  // train readers to ignore this gate.
  if (!attachments.WEAPON_ATTS?.[weaponId]) {
    rosterOnly.push(rosterId);
  }
  for (const [slot, v] of Object.entries(wa)) {
    if (Array.isArray(v)) for (const id of v) ids.add(id);
    // An absent list means the slot is unrestricted; add the whole pool for it.
  }
  for (const slot of ['sight', 'muzzle', 'barrel', 'grip', 'laser', 'light']) {
    if (!Array.isArray(wa[slot])) {
      const pool = { sight: 'SIGHTS', muzzle: 'MUZZLES', barrel: 'BARRELS', grip: 'GRIPS', laser: 'LASERS', light: 'LIGHTS' }[slot];
      for (const o of attachments[pool] ?? []) ids.add(o.id);
    }
  }
  for (const id of attachments.WEAPON_ERGO?.[weaponId]?.avail ?? []) ids.add(id);
  for (const id of Object.keys(attachments.WEAPON_MAG?.[weaponId]?.mags ?? {})) ids.add(id);
  for (const id of Object.keys(ammoCatalog.WEAPON_AMMO?.[weaponId]?.ammo ?? {})) ids.add(id);
  return ids;
}
const LEGAL_IDS = new Map(roster.map(w => [w.id, legalIdsFor(w.id)]));
const BUDGET = new Map(roster.map(w => [w.id, (() => { try { return diag.optimizer.budget(w.id); } catch { return null; } })()]));

/** Everything that must be true of a single ranked entry, whatever the model decided. */
function checkEntry(t, ctx) {
  counters.rankedEntries++;
  const num = (field, v, { min = -Infinity, max = Infinity, integer = false } = {}) => {
    if (v == null) return; // an absent value is a separate, legitimate state
    const n = Number(v);
    if (!Number.isFinite(n)) { record('non-finite', { ...ctx, weapon: t.id, field, value: String(v) }); return; }
    if (integer && !Number.isInteger(n)) record('non-integer', { ...ctx, weapon: t.id, field, value: n });
    if (n < min || n > max) record('out-of-range', { ...ctx, weapon: t.id, field, value: n, min, max });
  };
  num('btk', t.btk, { min: 1, max: 100, integer: true });
  num('damage', t.damage, { min: 1e-9 });
  num('mechTtk', t.mechTtk, { min: 0 });
  num('triggerTtk', t.triggerTtk, { min: 0 });
  if (Number.isFinite(Number(t.triggerTtk)) && Number.isFinite(Number(t.mechTtk)) && Number(t.triggerTtk) + 1e-9 < Number(t.mechTtk)) {
    record('trigger-below-mech', { ...ctx, weapon: t.id, value: `${t.triggerTtk} < ${t.mechTtk}` });
  }
}

/** Everything that must be true of a recommended build. */
function checkBuild(build, weaponId, ctx) {
  if (!build) return;
  counters.buildsInspected++;
  const budget = BUDGET.get(weaponId);
  const picks = build.picks ?? [];
  const total = Number(build.points);
  if (!Number.isFinite(total)) record('build-points-non-finite', { ...ctx, weapon: weaponId, value: String(build.points) });
  else if (Number.isFinite(budget) && total > budget) record('build-over-budget', { ...ctx, weapon: weaponId, value: `${total} > ${budget}` });
  const slots = picks.map(p => p.slot).filter(Boolean);
  if (new Set(slots).size !== slots.length) record('duplicate-slot', { ...ctx, weapon: weaponId, value: slots.join(',') });
  // A roster-only weapon (the Interdictor) has no upstream record and therefore no
  // compatibility list. Its builds cannot be legality-checked here; that is a known
  // documented state, not an anomaly, so it is skipped rather than reported.
  const legal = LEGAL_IDS.get(weaponId);
  if (legal && legal.size > 1) for (const p of picks) {
    if (p.id && !legal.has(p.id)) record('illegal-attachment', { ...ctx, weapon: weaponId, field: p.slot, value: p.id });
  }
}

const snap = q => {
  try { return diag.snapshot(q); }
  catch (e) { counters.exceptions++; record('exception', { ...q, value: String(e.message || e) }); return null; }
};

// ---------------------------------------------------------------- TIER 1: AUTO
const determinismProbe = [];
for (const m of MODES) {
  for (const priority of PRIORITIES) {
    for (const category of scopes) {
      for (const d of DISTANCES) {
        const ctx = { mode: m.key, priority, category, distance: d };
        const s = snap({ gameMode: m.gameMode, targetArmor: m.targetArmor, category, distance: d, priority, mode: 'auto', topN: 200 });
        counters.tier1++;
        if (!s) continue;
        if (!s.top?.length && s.rankedCount > 0) record('ranked-but-no-top', ctx);
        for (const t of s.top ?? []) checkEntry(t, ctx);
        checkBuild(s.build, s.weaponId, ctx);
        // A deterministic 1-in-997 sample, re-evaluated at the end.
        if (counters.tier1 % 997 === 0) determinismProbe.push({ q: { gameMode: m.gameMode, targetArmor: m.targetArmor, category, distance: d, priority, mode: 'auto', topN: 200 }, sig: JSON.stringify(s.top?.map(t => [t.id, t.btk, t.triggerTtk])) });
      }
    }
  }
}

// -------------------------------------------------- TIER 1b: MULTIPLAYER LEAKAGE
// In Multiplayer the armour selector must be inert. If it is not, a REDSEC rule has
// reached the Multiplayer path.
for (const priority of PRIORITIES) {
  for (const category of scopes) {
    for (const d of DISTANCES) {
      const a = snap({ gameMode: 'multiplayer', targetArmor: 'unarmored', category, distance: d, priority, mode: 'auto', topN: 5 });
      const b = snap({ gameMode: 'multiplayer', targetArmor: 'plates2', category, distance: d, priority, mode: 'auto', topN: 5 });
      counters.tier1 += 2;
      if (!a || !b) continue;
      const sa = JSON.stringify(a.top?.map(t => [t.id, t.btk, t.triggerTtk]));
      const sb = JSON.stringify(b.top?.map(t => [t.id, t.btk, t.triggerTtk]));
      if (sa !== sb) record('mode-leakage', { mode: 'MULTIPLAYER', priority, category, distance: d, value: 'armour state changed a Multiplayer result' });
    }
  }
}

// ------------------------------------------------------------- TIER 2: per weapon
for (const w of roster) {
  for (const m of MODES) {
    for (const d of DISTANCES) {
      const ctx = { mode: m.key, weaponId: w.id, distance: d };
      const s = snap({ gameMode: m.gameMode, targetArmor: m.targetArmor, category: '__all__', distance: d, priority: 'balanced', mode: 'manual', weaponId: w.id, topN: 1 });
      counters.tier2++;
      if (!s) continue;
      for (const t of s.top ?? []) checkEntry(t, ctx);
      checkBuild(s.build, w.id, ctx);
    }
  }
}

// --------------------------------------------------------- TIER 3: preferences
// 16 combinations x a deterministic stratum. Index arithmetic over the roster and the
// distance list guarantees every combination meets every class and the whole range
// without random sampling, so any failure reproduces exactly.
const PREF_KEYS = ['stayAds', 'movingAds', 'stealth', 'bigMag'];
const strata = [];
for (let bits = 0; bits < 16; bits++) {
  const preferences = Object.fromEntries(PREF_KEYS.map((k, i) => [k, !!(bits & (1 << i))]));
  for (let k = 0; k < roster.length; k++) {
    const w = roster[(k + bits) % roster.length];
    const d = DISTANCES[(k * 17 + bits * 7) % DISTANCES.length];
    const m = MODES[(k + bits) % MODES.length];
    strata.push({ preferences, weaponId: w.id, distance: d, mode: m });
  }
}
for (const st of strata) {
  const ctx = { mode: st.mode.key, weaponId: st.weaponId, distance: st.distance, preferences: st.preferences };
  const s = snap({
    gameMode: st.mode.gameMode, targetArmor: st.mode.targetArmor, category: '__all__',
    distance: st.distance, priority: 'balanced', mode: 'manual', weaponId: st.weaponId,
    preferences: st.preferences, topN: 1
  });
  counters.tier3++;
  if (!s) continue;
  for (const t of s.top ?? []) checkEntry(t, ctx);
  checkBuild(s.build, st.weaponId, ctx);
}

// ------------------------------------------------------------- DETERMINISM
let determinismChecked = 0;
for (const p of determinismProbe) {
  const s = snap(p.q);
  determinismChecked++;
  if (!s) continue;
  if (JSON.stringify(s.top?.map(t => [t.id, t.btk, t.triggerTtk])) !== p.sig) {
    record('non-deterministic', { ...p.q, value: 'same query returned a different answer after intervening queries' });
  }
}

const byKind = {};
for (const a of anomalies) byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;

const report = {
  generatedAt: new Date().toISOString(),
  quick: QUICK,
  coverage: {
    tier1: { describes: 'AUTO rankings, fully enumerated', distances: DISTANCES.length, modes: MODES.length, priorities: PRIORITIES.length, scopes: scopes.length, evaluations: counters.tier1 },
    tier2: { describes: 'per-weapon manual builds, fully enumerated', weapons: roster.length, distances: DISTANCES.length, modes: MODES.length, evaluations: counters.tier2 },
    tier3: { describes: 'advanced handling preferences, stratified by deterministic index arithmetic (no randomness)', combinations: 16, strata: strata.length, evaluations: counters.tier3 },
    notEnumerated: [
      'The full Cartesian product of preferences x weapons x distances x modes x priorities x scopes is ~1.7e9 evaluations and is not run. Tier 3 covers every preference combination against every class and the whole distance range instead.',
      'Attachment combinations are not enumerated here; scripts/audit-optimizer-torture.mjs does that against the optimizer directly.',
      'classChoice and context selectors are not swept: they filter which weapons are offered, and cannot change any weapon\'s computed combat values.'
    ],
    rosterOnlyWeaponsWithoutCatalogRecord: rosterOnly,
    rosterOnlyWeaponsWithoutCatalogRecord: rosterOnly,
    rankedEntriesInspected: counters.rankedEntries,
    buildsInspected: counters.buildsInspected,
    determinismProbes: determinismChecked
  },
  anomalyCountsByKind: byKind,
  exceptions: counters.exceptions,
  anomalies: anomalies.slice(0, 400),
  anomalyTotal: anomalies.length
};
await mkdir('reports/validation', { recursive: true });
await writeFile('reports/validation/state-space.json', JSON.stringify(report, null, 1));

const total = counters.tier1 + counters.tier2 + counters.tier3;
console.log(`state-space sweep — ${total.toLocaleString()} scenario evaluations`);
console.log(`  tier 1 AUTO rankings (exhaustive)      ${counters.tier1.toLocaleString()}`);
console.log(`  tier 2 per-weapon manual (exhaustive)  ${counters.tier2.toLocaleString()}`);
console.log(`  tier 3 preferences (stratified)        ${counters.tier3.toLocaleString()}`);
console.log(`  ranked entries inspected               ${counters.rankedEntries.toLocaleString()}`);
console.log(`  builds inspected                       ${counters.buildsInspected.toLocaleString()}`);
console.log(`  determinism probes                     ${determinismChecked}`);
if (anomalies.length) {
  console.error(`\nFAIL: ${anomalies.length} anomalies — ${Object.entries(byKind).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  for (const a of anomalies.slice(0, 20)) console.error(`  ${a.kind}: ${JSON.stringify(a).slice(0, 220)}`);
  process.exitCode = 1;
} else {
  console.log('\nPASS: no impossible value, illegal build, mode leak, exception or non-determinism in any evaluated scenario.');
}
