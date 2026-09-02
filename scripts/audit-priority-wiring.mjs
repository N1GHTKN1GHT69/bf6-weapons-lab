#!/usr/bin/env node
/**
 * BF6 Weapons Lab — control wiring audit.
 *
 * Every user-facing optimization/context control must reach real engine or
 * loadout logic. This gate exists because four "Advanced Priorities" toggles
 * were once shipped that could not change anything: with the exhaustive combat
 * cache active, optimize() always returns a cached winner before reaching the
 * scoreOption() path those toggles fed, so they were measurably dead
 * (0 changes across 23 weapon/class/distance cases each).
 *
 * The gate asserts three things:
 *   1. No dead controls. Every interactive control in index.html is bound in
 *      app.js and traced to a named consumer in the manifest below.
 *   2. Correct wiring. PRIORITY reaches weapon ranking, not only the attachment
 *      build, and only ever selects strategies the engine already computes.
 *   3. Separation. The explanation/reasoning layer is OUTPUT only - no engine
 *      function may read it, so reasoning can never become an optimizer input.
 */
import { readFile } from 'node:fs/promises';

const [app, index] = await Promise.all([readFile('app.js', 'utf8'), readFile('index.html', 'utf8')]);
const errors = [];

/** Extract a top-level function body from app.js by brace matching. */
function functionBody(src, name) {
  const at = src.indexOf(`function ${name}(`);
  if (at < 0) return null;
  const open = src.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(open, i + 1); }
  }
  return null;
}

/**
 * Every interactive control the interface exposes, with the consumer that gives
 * it a purpose. A control with no demonstrated consumer must be removed, not
 * left on screen.
 */
const CONTROL_MANIFEST = [
  { control: 'autoModeBtn',     state: 'state.selectionMode', consumer: 'defaultStrategy',   affects: 'weapon selection mode' },
  { control: 'manualModeBtn',   state: 'state.selectionMode', consumer: 'defaultStrategy',   affects: 'weapon lock' },
  { control: 'weaponTabs',      state: 'state.category',      consumer: 'buildRankPool',     affects: 'weapon eligibility + ranking scope' },
  { control: 'weaponSelect',    state: 'state.weaponId',      consumer: 'rosterWeapon',      affects: 'which weapon is optimized' },
  { control: 'distanceSlider',  state: 'state.distance',      consumer: 'cachedBuild',       affects: 'exact-distance combat + build' },
  { control: 'distanceCustom',  state: 'state.distance',      consumer: 'cachedBuild',       affects: 'exact-distance combat + build' },
  { control: 'distancePresets', state: 'state.distance',      consumer: 'cachedBuild',       affects: 'exact-distance combat + build' },
  { control: 'priorityGroup',   state: 'state.priority',      consumer: 'rankingStrategy',   affects: 'weapon ranking + attachment build' },
  { control: 'classSelect',     state: 'state.classChoice',   consumer: 'selectedClass',     affects: 'complete loadout class' },
  { control: 'contextSelect',   state: 'state.context',       consumer: 'scoreLoadoutItem',  affects: 'training, gadgets and throwable' },
  { control: 'optimizeBtn',     state: null,                  consumer: 'renderAll',         affects: 're-runs and scrolls to the result' }
];

// 1. No dead controls -----------------------------------------------------
for (const { control, state, consumer } of CONTROL_MANIFEST) {
  if (!index.includes(`id="${control}"`)) { errors.push(`control ${control} is listed in the manifest but not present in index.html`); continue; }
  if (!app.includes(`$("${control}")`)) errors.push(`control ${control} is rendered but never bound in app.js`);
  if (state && !app.includes(state)) errors.push(`control ${control} writes ${state}, which app.js never reads`);
  if (!app.includes(`function ${consumer}(`)) errors.push(`control ${control} claims consumer ${consumer}(), which does not exist`);
}

// Any select or checkbox in the markup must appear in the manifest.
const declaredIds = new Set(CONTROL_MANIFEST.map(c => c.control));
for (const m of index.matchAll(/<(select|input)\b[^>]*\bid="([^"]+)"/g)) {
  const [, tag, id] = m;
  if (tag === 'input' && /type="(range|number)"/.test(m[0]) === false && /type="checkbox"/.test(m[0]) === false) continue;
  if (!declaredIds.has(id)) errors.push(`control ${id} exists in index.html but has no traced purpose in the manifest`);
}

// The four historically dead preference toggles must not return to the UI
// without a demonstrated effect.
for (const dead of ['stayAds', 'movingAds', 'stealth', 'bigMag']) {
  if (index.includes(`id="${dead}"`)) errors.push(`${dead} is back in the UI; it cannot change anything while the exhaustive cache is active`);
}
// Removing them must stay mathematically inert for the on-demand optimizer.
if (!app.includes('preferences: { stayAds: true, movingAds: true, stealth: false, bigMag: false }')) {
  errors.push('on-demand optimizer preference defaults are no longer held in state; removing the UI controls would change fallback behaviour');
}
const prefBody = functionBody(app, 'preference');
if (!prefBody || !prefBody.includes('state.preferences')) errors.push('preference() is not state-backed');

// 2. PRIORITY must reach weapon ranking, not only the attachment build ------
if (!app.includes('const PRIORITY_STRATEGY = { balanced: "laserbeam", fastest: "lethal" };')) {
  errors.push('PRIORITY no longer maps exactly onto the two strategies the engine computes');
}
const rankPool = functionBody(app, 'buildRankPool');
if (!rankPool) errors.push('buildRankPool() not found');
else {
  if (!rankPool.includes('rankingStrategy()')) errors.push('buildRankPool() ignores the selected priority, so PRIORITY cannot affect weapon ranking');
  if (!rankPool.includes('cachedCombat(raw, d, strategy)')) errors.push('buildRankPool() does not rank the combat row the priority selects');
  if (!rankPool.includes('cachedWinningStats(raw, d, strategy)')) errors.push('buildRankPool() tie-breaks on stats from a different build than it ranks');
}
const rankStrat = functionBody(app, 'rankingStrategy');
if (!rankStrat || !rankStrat.includes('PRIORITY_STRATEGY[state.priority] ?? "laserbeam"')) {
  errors.push('rankingStrategy() must default to the historical laserbeam ranking when no explicit priority is chosen');
}
// A changed priority must never leave a stale result on screen.
if (!app.includes('function renderPriorityDelta')) errors.push('no feedback exists to show what a priority change did');
if (!app.includes('state.priority = btn.dataset.priority;') || !app.includes('renderAll();')) {
  errors.push('changing priority does not re-run the optimizer');
}

// 3. Reasoning is output, never input --------------------------------------
const ENGINE_FUNCTIONS = [
  'buildOptions', 'dedupeOptions', 'scoreOption', 'behaviorScore', 'opticScore', 'opticRangeFit',
  'minimumOpticFit', 'pointCost', 'budgetFor', 'optimize', 'auditBuild', 'cachedBuild',
  'cachedCombat', 'cachedWinningStats', 'buildRankPool', 'rankWeapons', 'laserbeamUtilityCost',
  'resolveAutoWeapon', 'combatAtDistance', 'damageAtDistance', 'timeToNthShot', 'flightTimeMs', 'addTriggerKill'
];
const REASONING_TOKENS = ['attachmentEffects(', 'attachmentReason(', 'buildDeltas(', 'whyThisBuild(', 'effectChips(', 'attachmentDisplay(', 'EFFECT_FIELDS', 'scoringFactors('];
for (const fn of ENGINE_FUNCTIONS) {
  const body = functionBody(app, fn);
  if (body === null) { errors.push(`engine function ${fn}() not found in app.js`); continue; }
  for (const token of REASONING_TOKENS) {
    if (body.includes(token)) errors.push(`${fn}() reads the explanation layer (${token}); reasoning must be output, never optimizer input`);
  }
}

// Effect polarity must be declared, not inferred ad hoc at render time.
if (!app.includes('const EFFECT_FIELDS')) errors.push('effect direction table is missing');
for (const pair of [
  ['"adsRecoilTierMod",           "Recoil Control",         "higher"', 'recoil control polarity'],
  ['"adsTimeTierShift",           "ADS Speed",              "lower"', 'ADS time shift polarity'],
  ['"hipSpreadTierMod",           "Hipfire Accuracy",       "lower"', 'hipfire spread polarity'],
  ['"spreadIncMult",              "Spread Control",         "lower"', 'spread increase polarity']
]) {
  if (!app.includes(pair[0])) errors.push(`${pair[1]} is not declared as an inverse-aware normalised characteristic`);
}

if (errors.length) {
  console.error('CONTROL WIRING AUDIT FAILED');
  errors.forEach(e => console.error('-', e));
  process.exit(1);
}
console.log(`CONTROL WIRING PASS • ${CONTROL_MANIFEST.length} controls traced to a consumer • PRIORITY reaches ranking + build • no dead preference toggles • reasoning gated out of ${ENGINE_FUNCTIONS.length} engine functions`);
