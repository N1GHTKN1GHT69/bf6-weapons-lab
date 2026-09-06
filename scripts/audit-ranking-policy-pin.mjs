#!/usr/bin/env node
/**
 * Pin every constant that decides what BALANCED means.
 *
 * WHY THIS GATE EXISTS. Mutation testing changed the medium-range recoil weight in
 * BASE_WEIGHTS from 5.5 to 8.0 and all 30 gates passed. That is worse than it first
 * looks, and better: the change is invisible TODAY because a valid exhaustive cache
 * short-circuits the on-demand optimizer, so no displayed value moves. It would take
 * effect on the next Combat Engine run, silently, with a green history behind it.
 *
 * A latent change that only manifests after a rebuild is the hardest kind to trace back
 * to its cause, so the weights are pinned here rather than left to be noticed later.
 *
 * WHAT IS PINNED, and why each one matters:
 *   BASE_WEIGHTS       the per-range attachment scoring preferences. They decide which
 *                      attachment wins, which is most of what a user acts on.
 *   utility exponents  triggerTtk^0.55 x beamIndex^0.45 - the lethality/control trade.
 *   off-pace penalty   the 1.35x cliff and the 1.25x + 10 ms threshold that triggers it.
 *   beam coefficients  the four range-dependent Beam Index terms, in BOTH the browser
 *                      fallback and the cache builder, because they must not drift apart.
 *   rangeT divisor     the 120 m saturation distance.
 *
 * NONE of these is a game mechanic. Every one is a product decision about how to weigh
 * real mechanics against each other, which is exactly why they deserve to be a reviewed,
 * versioned artifact instead of scattered literals. Changing one is legitimate; changing
 * one WITHOUT noticing is not, and that is all this gate prevents.
 *
 * Updating the pin is deliberate: `--write` regenerates data/ranking-policy.json, and
 * the diff shows precisely which preference moved.
 *
 * Usage:
 *   node scripts/audit-ranking-policy-pin.mjs
 *   node scripts/audit-ranking-policy-pin.mjs --write
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const PIN = 'data/ranking-policy.json';
const app = await readFile('app.js', 'utf8');
const builder = await readFile('scripts/build-combat-cache.mjs', 'utf8');
const errors = [];

/**
 * Parse the BASE_WEIGHTS literal out of app.js.
 *
 * Reading the source rather than executing it keeps this gate independent of whether
 * the value happens to be exposed for diagnostics, and means the pin describes what is
 * WRITTEN in the file - which is what a reviewer reads in a diff.
 */
function parseBaseWeights(src) {
  const start = src.indexOf('const BASE_WEIGHTS = {');
  if (start < 0) return null;
  // Walk braces so a nested object cannot terminate the match early.
  let depth = 0, i = src.indexOf('{', start), end = -1;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) return null;
  const body = src.slice(src.indexOf('{', start), end);
  const out = {};
  for (const m of body.matchAll(/(\w+)\s*:\s*\{([^{}]*)\}/g)) {
    const band = m[1];
    out[band] = {};
    for (const kv of m[2].matchAll(/(\w+)\s*:\s*(-?[\d.]+)/g)) out[band][kv[1]] = Number(kv[2]);
  }
  return Object.keys(out).length ? out : null;
}

const baseWeights = parseBaseWeights(app);
if (!baseWeights) errors.push('could not locate the BASE_WEIGHTS literal in app.js - the pin cannot be verified');

/** A named constant extracted by regex, so a missing one is an error rather than a silent zero. */
function grab(label, src, re, file) {
  const m = src.match(re);
  if (!m) { errors.push(`${label}: not found in ${file} - the ranking policy has been restructured and this pin is stale`); return null; }
  return m.slice(1).map(Number);
}

const constants = {
  utilityExponents: grab('utility exponents', app, /Math\.pow\(t,\s*([\d.]+)\)\s*\*\s*Math\.pow\(b,\s*([\d.]+)\)/, 'app.js'),
  offPacePenalty: grab('off-pace penalty', app, /baseCost\s*\*\s*\(offPace\s*\?\s*([\d.]+)\s*:\s*1\)/, 'app.js'),
  offPaceThreshold: grab('off-pace threshold', app, /globalFastest\s*\*\s*([\d.]+)\s*\+\s*(\d+)/, 'app.js'),
  beamCoefficientsBuilder: grab('beam coefficients (cache builder)', builder,
    /recoil \* \(([\d.]+) \+ ([\d.]+) \* rangeT\)\)\s*\+\s*\(unpredictable \* \(([\d.]+) \+ ([\d.]+) \* rangeT\)\)\s*\+\s*\(effSpread \* \(([\d.]+) \+ ([\d.]+) \* rangeT\)\)\s*\+\s*\(moving \* \(([\d.]+) \+ ([\d.]+) \* rangeT\)\)/, 'scripts/build-combat-cache.mjs'),
  beamCoefficientsBrowserFallback: grab('beam coefficients (browser fallback)', app,
    /recoil\*\(1\+([\d.]+)\*rangeT\)\s*\+\s*unpredictable\*\(([\d.]+)\+([\d.]+)\*rangeT\)\s*\+\s*\(baseSpread\+sips\)\*\(([\d.]+)\+([\d.]+)\*rangeT\)\s*\+\s*moving\*\(([\d.]+)\+([\d.]+)\*rangeT\)/, 'app.js'),
  rangeTDivisorBuilder: grab('rangeT divisor (cache builder)', builder, /Number\(distance\) \|\| 1\) \/ (\d+)\)/, 'scripts/build-combat-cache.mjs'),
  rangeTDivisorBrowser: grab('rangeT divisor (browser fallback)', app, /Number\(d\)\|\|1\)\/(\d+)\)/, 'app.js')
};

const policy = {
  schema: 1,
  purpose: 'Every constant that decides what BALANCED means. None is a game mechanic; all are product decisions about how to weigh real mechanics against each other. Pinned so a change is a reviewed diff rather than a silent drift that only surfaces after the next cache rebuild.',
  note: 'FASTEST KILL is deliberately absent: it orders by trigger-to-kill outright and consults Beam Index only to break an exact tie, so it carries no preference weighting to pin.',
  baseWeights,
  constants,
  fingerprint: null
};
policy.fingerprint = createHash('sha256').update(JSON.stringify({ baseWeights, constants })).digest('hex');

if (process.argv.includes('--write')) {
  await mkdir('data', { recursive: true });
  await writeFile(PIN, JSON.stringify(policy, null, 1) + '\n');
  console.log(`wrote ${PIN} — fingerprint ${policy.fingerprint.slice(0, 16)}...`);
  process.exit(errors.length ? 1 : 0);
}

let pinned = null;
try { pinned = JSON.parse(await readFile(PIN, 'utf8')); }
catch { errors.push(`${PIN} is missing. Run: node scripts/audit-ranking-policy-pin.mjs --write`); }

if (pinned) {
  if (pinned.fingerprint !== policy.fingerprint) {
    const diffs = [];
    for (const band of Object.keys(policy.baseWeights ?? {})) {
      for (const [k, v] of Object.entries(policy.baseWeights[band])) {
        const was = pinned.baseWeights?.[band]?.[k];
        if (was !== v) diffs.push(`BASE_WEIGHTS.${band}.${k}: pinned ${was} -> current ${v}`);
      }
    }
    for (const [k, v] of Object.entries(policy.constants)) {
      const was = JSON.stringify(pinned.constants?.[k]);
      if (was !== JSON.stringify(v)) diffs.push(`${k}: pinned ${was} -> current ${JSON.stringify(v)}`);
    }
    errors.push(`the ranking policy has changed:\n      ${diffs.join('\n      ')}\n      If this was intended, run: node scripts/audit-ranking-policy-pin.mjs --write   and review the diff.`);
  }
  // The two Beam Index implementations must agree on the coefficients they SHARE.
  //
  // The spread term is deliberately excluded from this comparison, and that exclusion
  // is principled rather than an oversight: the cache builder weighs a SIMULATED
  // effective spread (2.00 + 2.50t), while the browser fallback weighs raw base spread
  // plus per-shot increase (1.25 + 1.75t). Different inputs, so different coefficients
  // are correct - app.js says as much where the fallback is defined. The recoil,
  // unpredictable-recoil and moving terms DO take the same inputs in both, so a
  // divergence there would mean the two paths genuinely disagree.
  const b = policy.constants.beamCoefficientsBuilder, f = policy.constants.beamCoefficientsBrowserFallback;
  if (b && f && (b[0] !== 1 || b[1] !== f[0] || b[2] !== f[1] || b[3] !== f[2] || b[6] !== f[5] || b[7] !== f[6])) {
    errors.push(`the cache builder and the browser fallback Beam Index disagree on their shared coefficients: builder ${JSON.stringify(b)} vs fallback ${JSON.stringify(f)}`);
  }
  if (policy.constants.rangeTDivisorBuilder && policy.constants.rangeTDivisorBrowser &&
      policy.constants.rangeTDivisorBuilder[0] !== policy.constants.rangeTDivisorBrowser[0]) {
    errors.push(`rangeT saturation distance differs: builder ${policy.constants.rangeTDivisorBuilder[0]} m vs browser ${policy.constants.rangeTDivisorBrowser[0]} m`);
  }
}

await mkdir('reports/validation', { recursive: true });
await writeFile('reports/validation/ranking-policy-pin.json', JSON.stringify({ generatedAt: new Date().toISOString(), current: policy, pinnedFingerprint: pinned?.fingerprint ?? null, errors }, null, 1));

console.log(`ranking policy pin — fingerprint ${policy.fingerprint.slice(0, 16)}...`);
if (baseWeights) for (const [band, vals] of Object.entries(baseWeights)) console.log(`  BASE_WEIGHTS.${band.padEnd(7)} ${Object.entries(vals).map(([k, v]) => `${k}:${v}`).join(' ')}`);
for (const [k, v] of Object.entries(constants)) console.log(`  ${k.padEnd(32)} ${JSON.stringify(v)}`);
if (errors.length) {
  console.error('\nFAIL:\n  ' + errors.join('\n  '));
  process.exitCode = 1;
} else {
  console.log('\nPASS: every BALANCED preference matches the reviewed pin, and both Beam Index implementations agree.');
}
