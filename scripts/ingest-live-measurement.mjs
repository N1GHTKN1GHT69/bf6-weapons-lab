#!/usr/bin/env node
/**
 * Live-measurement ingestion, uncertainty analysis and impact report.
 *
 * Takes raw per-trial screen displacements from data/live-measurements.json,
 * derives the production field value, propagates the MEASUREMENT UNCERTAINTY
 * through the real BALANCED ranking, and reports whether the answer is robust
 * to that uncertainty or decided by it.
 *
 * It deliberately does not treat a measurement as exact. A single derived number
 * with no error band cannot tell you whether it changes a recommendation; an
 * interval can.
 *
 *   node scripts/ingest-live-measurement.mjs            # analyse recorded observations
 *   node scripts/ingest-live-measurement.mjs --self-test # prove the pipeline on synthetic input
 *
 * --self-test fabricates trial numbers to exercise the maths end to end. Its
 * output is clearly labelled and is NEVER written to the evidence file or used
 * to promote anything.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { bootLab } from './lab-harness.mjs';

const SELF_TEST = process.argv.includes('--self-test');

const doc = JSON.parse(await readFile('data/live-measurements.json', 'utf8'));
const weapons = JSON.parse(await readFile('data/weapons.json', 'utf8'));
const freshness = JSON.parse(await readFile('data/freshness-status.json', 'utf8'));
const LIVE = freshness.official?.gameVersion ?? null;

const { diag } = await bootLab();

// ---- statistics -----------------------------------------------------------
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const stdev = a => {
  if (a.length < 2) return NaN;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); // sample sd
};
const sem = a => stdev(a) / Math.sqrt(a.length);

/**
 * Trials needed for a target relative precision, from the observed spread.
 * Derived from the data rather than asserted as a fixed number: n = (1.96*cv/rel)^2.
 */
function trialsNeeded(values, targetRelPrecision = 0.05) {
  const cv = stdev(values) / mean(values);
  if (!Number.isFinite(cv)) return null;
  return Math.max(5, Math.ceil((1.96 * cv / targetRelPrecision) ** 2));
}

/** Ratio of two means, with uncertainty propagated in quadrature. */
function ratioWithError(aVals, bVals) {
  const ma = mean(aVals), mb = mean(bVals);
  const ra = sem(aVals) / ma, rb = sem(bVals) / mb;
  const rel = Math.sqrt(ra * ra + rb * rb);
  return { ratio: ma / mb, relError: rel, absError: (ma / mb) * rel };
}

// ---- impact: propagate the interval through the real ranking ---------------
const DISTANCES = [10, 25, 50, 100];
const q = d => ({ gameMode: 'multiplayer', category: '__all__', distance: d, priority: 'balanced', topN: 8 });

function rankAtFactor(weaponId, factor) {
  const out = {};
  for (const d of DISTANCES) {
    const s = factor === 1
      ? diag.snapshot(q(d))
      : diag.perturbBeamPrimitive(weaponId, 'recoil', factor, q(d));
    out[d] = s?.top?.length ? { winner: s.top[0].id, top3: s.top.slice(0, 3).map(t => t.id) } : null;
  }
  return out;
}

function impactFor(weaponId, storedValue, measured) {
  const centre = measured.value / storedValue;
  const lo = (measured.value - 1.96 * measured.absError) / storedValue;
  const hi = (measured.value + 1.96 * measured.absError) / storedValue;

  const base = rankAtFactor(weaponId, 1);
  const atCentre = rankAtFactor(weaponId, centre);
  const atLo = rankAtFactor(weaponId, lo);
  const atHi = rankAtFactor(weaponId, hi);

  const perDistance = DISTANCES.map(d => {
    const b = base[d], c = atCentre[d], l = atLo[d], h = atHi[d];
    if (!b || !c || !l || !h) return { distance: d, error: 'no ranking' };
    const winnerMoved = c.winner !== b.winner;
    // Sensitive when the 95% interval spans two different winners: the
    // measurement's own uncertainty, not the value, decides the answer.
    const intervalSpansWinners = new Set([l.winner, c.winner, h.winner]).size > 1;
    return {
      distance: d,
      winnerBefore: b.winner,
      winnerAfter: c.winner,
      winnerChanged: winnerMoved,
      top3Before: b.top3,
      top3After: c.top3,
      top3Changed: c.top3.join() !== b.top3.join(),
      winnerAtLowerBound: l.winner,
      winnerAtUpperBound: h.winner,
      verdict: intervalSpansWinners ? 'SENSITIVE' : 'ROBUST'
    };
  });

  return {
    storedValue,
    measuredValue: measured.value,
    deltaPercent: +(((measured.value - storedValue) / storedValue) * 100).toFixed(2),
    ci95: [+(measured.value - 1.96 * measured.absError).toFixed(6), +(measured.value + 1.96 * measured.absError).toFixed(6)],
    scaleFactors: { lower: +lo.toFixed(4), centre: +centre.toFixed(4), upper: +hi.toFixed(4) },
    perDistance,
    scenariosAffected: perDistance.filter(p => p.winnerChanged || p.top3Changed).length,
    overallVerdict: perDistance.some(p => p.verdict === 'SENSITIVE') ? 'SENSITIVE' : 'ROBUST'
  };
}

// ---- derive a value from one observation -----------------------------------
function derive(obs) {
  const w = weapons.find(x => x.id === obs.weaponId);
  if (!w) return { error: `unknown weapon ${obs.weaponId}` };
  const stored = Number(w[obs.field]);
  if (!Number.isFinite(stored)) return { error: `no stored ${obs.field} for ${obs.weaponId}` };

  const trials = (obs.trialsPx ?? []).map(Number).filter(Number.isFinite);
  if (trials.length < 3) return { error: `needs at least 3 trials, got ${trials.length}` };

  if (obs.method === 'ratio-v1') {
    const ref = weapons.find(x => x.id === obs.referenceWeaponId);
    const refTrials = (obs.referenceTrialsPx ?? []).map(Number).filter(Number.isFinite);
    if (!ref) return { error: `unknown reference weapon ${obs.referenceWeaponId}` };
    if (refTrials.length < 3) return { error: `reference needs at least 3 trials, got ${refTrials.length}` };
    const refStored = Number(ref[obs.field]);
    const r = ratioWithError(trials, refTrials);
    const value = refStored * r.ratio;
    return {
      stored, value,
      absError: value * r.relError,
      relError: r.relError,
      n: trials.length,
      refN: refTrials.length,
      meanPx: +mean(trials).toFixed(3),
      sdPx: +stdev(trials).toFixed(3),
      refMeanPx: +mean(refTrials).toFixed(3),
      refSdPx: +stdev(refTrials).toFixed(3),
      trialsNeededForFivePercent: trialsNeeded(trials),
      basis: `${ref.id} stored ${obs.field} ${refStored} x measured px ratio ${r.ratio.toFixed(4)}`
    };
  }

  if (obs.method === 'group-v1') {
    // World-space angular spread from a shot group on a wall at a known
    // distance. Needs no FOV, resolution or magnification: it is measured in
    // the world, not on the screen. Targets effectiveAdsSpreadDeg, the value
    // beamIndex actually consumes - NOT spreadMax, which is a discrete tier
    // index whose mapping to degrees runs through the upstream spread
    // simulation and is confounded by attachments.
    const D = Number(obs.config?.distanceToWallM);
    if (!Number.isFinite(D) || D <= 0) return { error: 'group-v1 requires config.distanceToWallM' };
    // Each trial is a group RADIUS in metres at that distance.
    const degs = trials.map(r => Math.atan(r / D) * 180 / Math.PI);
    const value = mean(degs);
    return {
      stored, value, absError: sem(degs), relError: sem(degs) / value,
      n: degs.length, meanPx: +mean(trials).toFixed(4), sdPx: +stdev(trials).toFixed(4),
      trialsNeededForFivePercent: trialsNeeded(degs),
      basis: `group radius -> angle at ${D} m; world-space, FOV-independent`
    };
  }

  if (obs.method === 'absolute-v1') {
    const { vFovDeg, heightPx } = obs.config ?? {};
    if (!Number.isFinite(Number(vFovDeg)) || !Number.isFinite(Number(heightPx))) {
      return { error: 'absolute-v1 requires config.vFovDeg and config.heightPx' };
    }
    const toDeg = px => Math.atan((px / (Number(heightPx) / 2)) * Math.tan(Number(vFovDeg) / 2 * Math.PI / 180)) * 180 / Math.PI;
    const degs = trials.map(toDeg);
    return {
      stored, value: mean(degs), absError: 1.96 * sem(degs) / 1.96, relError: sem(degs) / mean(degs),
      n: degs.length, meanPx: +mean(trials).toFixed(3), sdPx: +stdev(trials).toFixed(3),
      trialsNeededForFivePercent: trialsNeeded(degs),
      basis: `absolute conversion at vFOV ${vFovDeg} deg, height ${heightPx}px`
    };
  }
  return { error: `unknown method ${obs.method}` };
}

// ---- run -------------------------------------------------------------------
let observations = doc.observations ?? [];
let selfTestNote = null;

if (SELF_TEST) {
  // Synthetic trials that encode a deliberate +18% recoil on L110 relative to
  // B36A4, to exercise derivation, error propagation and the impact report.
  // NOT evidence. Never written back.
  const l110 = weapons.find(w => w.id === 'l110').recoilV;
  const b36 = weapons.find(w => w.id === 'b36a4').recoilV;
  const refPx = [100, 102, 99, 101, 100, 103, 98, 101];
  const trueRatio = (l110 * 1.18) / b36;
  const subjPx = refPx.map((p, i) => +(p * trueRatio * (1 + ((i % 3) - 1) * 0.012)).toFixed(2));
  observations = [{
    weaponId: 'l110', field: 'recoilV', gameVersion: LIVE, capturedAt: 'SELF-TEST',
    method: 'ratio-v1', referenceWeaponId: 'b36a4',
    config: { attachments: 'none (bare)', recoilTierSum: 0, note: 'SYNTHETIC SELF-TEST INPUT' },
    trialsPx: subjPx, referenceTrialsPx: refPx, evidenceRef: 'SELF-TEST (not evidence)'
  }];
  selfTestNote = 'SELF-TEST RUN: trial numbers are synthetic, encode a deliberate +18% on L110, and are not evidence. Nothing is promoted.';
}

const results = [];
for (const obs of observations) {
  const admissible = obs.gameVersion === LIVE;
  const d = derive(obs);
  if (d.error) { results.push({ weaponId: obs.weaponId, field: obs.field, error: d.error }); continue; }
  const impact = impactFor(obs.weaponId, d.stored, d);
  results.push({
    weaponId: obs.weaponId, field: obs.field, method: obs.method,
    gameVersion: obs.gameVersion, admissible,
    admissibilityNote: admissible ? 'captured on the live version' : `captured on ${obs.gameVersion} but live is ${LIVE} - recorded, NOT promoted`,
    measurement: {
      storedValue: d.stored, measuredValue: +d.value.toFixed(6),
      absError: +d.absError.toFixed(6), relErrorPercent: +(d.relError * 100).toFixed(2),
      trials: d.n, referenceTrials: d.refN ?? null,
      meanPx: d.meanPx, sdPx: d.sdPx, refMeanPx: d.refMeanPx ?? null, refSdPx: d.refSdPx ?? null,
      trialsNeededForFivePercentPrecision: d.trialsNeededForFivePercent,
      basis: d.basis
    },
    impact
  });
}

const out = {
  generatedAt: new Date().toISOString(),
  liveGameVersion: LIVE,
  selfTest: SELF_TEST,
  selfTestNote,
  observationsAnalysed: results.length,
  results
};

if (!SELF_TEST) {
  await mkdir('reports/patch-delta', { recursive: true });
  await writeFile('reports/patch-delta/live-measurement-impact.json', JSON.stringify(out, null, 1));
}

if (!results.length) {
  console.log(`No live measurements recorded yet. data/live-measurements.json has an empty observations list, which is the honest state until captures exist.`);
  console.log(`Run with --self-test to verify the pipeline works before capturing anything.`);
  process.exit(0);
}

if (selfTestNote) console.log(`\n*** ${selfTestNote} ***\n`);
for (const r of results) {
  if (r.error) { console.log(`${r.weaponId} ${r.field}: ERROR - ${r.error}`); continue; }
  const m = r.measurement, i = r.impact;
  console.log(`${r.weaponId} ${r.field}  [${r.method}]  ${r.admissible ? 'ADMISSIBLE' : 'NOT PROMOTED'}`);
  console.log(`  stored ${m.storedValue}  ->  measured ${m.measuredValue} +/- ${m.absError}  (${i.deltaPercent >= 0 ? '+' : ''}${i.deltaPercent}%, +/-${m.relErrorPercent}% rel)`);
  console.log(`  n=${m.trials} trials (ref n=${m.referenceTrials}), mean ${m.meanPx}px sd ${m.sdPx}px; ${m.trialsNeededForFivePercentPrecision} trials would give 5% precision`);
  console.log(`  95% CI on the value: [${i.ci95[0]}, ${i.ci95[1]}]`);
  console.log(`  scenarios affected: ${i.scenariosAffected}/${DISTANCES.length}   OVERALL: ${i.overallVerdict}`);
  for (const p of i.perDistance) {
    if (p.error) continue;
    const flag = p.winnerChanged ? 'WINNER CHANGED' : p.top3Changed ? 'top3 changed' : 'no change';
    console.log(`    ${String(p.distance).padStart(3)}m  ${p.winnerBefore} -> ${p.winnerAfter}  [${flag}]  interval: ${p.winnerAtLowerBound}..${p.winnerAtUpperBound}  ${p.verdict}`);
  }
}
if (!SELF_TEST) console.log('\nWritten: reports/patch-delta/live-measurement-impact.json');
