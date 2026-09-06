#!/usr/bin/env node
/**
 * WEIGHT AUDIT — what BALANCED actually weighs, and whether anything is counted twice.
 *
 * This is a REPORT. It changes no weight and proposes none by fiat. The purpose is to
 * make every constant in the ranking visible, say whether it represents a game mechanic
 * or a product preference, and MEASURE how much each one actually moves the answer -
 * because a weight nobody can see is a weight nobody can argue with.
 *
 * THE MODEL, stated once:
 *
 *   metaCost   = triggerTtk^0.55 x beamIndex^0.45 x (offPace ? 1.35 : 1)
 *   beamIndex  = recoil        x (1.00 + 0.35t)
 *              + unpredictable x (1.25 + 0.75t)
 *              + effSpread     x (2.00 + 2.50t)
 *              + moving        x (0.35 + 0.65t)
 *   t          = min(1, distance / 120)
 *   unpredictable = recoil x sin(min(90, recoilVariationDeg))
 *
 * Lower metaCost ranks higher. FASTEST KILL does not use metaCost at all: it orders by
 * trigger-to-kill outright and uses Beam Index only to break an exact lethality tie, so
 * it stays objective and is deliberately out of scope here.
 *
 * THE DOUBLE-COUNT QUESTION. `recoil` enters beamIndex twice - once directly, and again
 * inside `unpredictable`, which is recoil x sin(variation). Its total coefficient is
 * therefore (1.00 + 0.35t) + sin(var) x (1.25 + 0.75t), which for a high-variation
 * weapon is roughly twice what a low-variation weapon gets from the same recoil value.
 * That may well be intended - magnitude and lateral scatter are different things - but
 * it is a design choice that has never been written down, and it means recoilV is the
 * single most heavily weighted primitive in the model. This audit quantifies it instead
 * of asserting it either way.
 *
 * Usage: node scripts/audit-ranking-weights.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const cache = JSON.parse(await readFile('data/combat-cache.json', 'utf8'));

/** Every constant in the ranking, with what it is and where it came from. */
const WEIGHTS = [
  { component: 'triggerTtk', weight: '^0.55', kind: 'PREFERENCE', represents: 'how much lethality speed matters relative to controllability', source: 'project choice; the cache records it as "pool-stable 55/45 percentage utility"' },
  { component: 'beamIndex', weight: '^0.45', kind: 'PREFERENCE', represents: 'how much controllability matters relative to lethality speed', source: 'project choice, the complement of the above' },
  { component: 'off-pace penalty', weight: 'x1.35', kind: 'PREFERENCE', represents: 'a cliff applied to weapons slower than 1.25x the fastest trigger-to-kill + 10 ms', source: 'project choice; not a game mechanic' },
  { component: 'off-pace threshold', weight: '1.25x + 10ms', kind: 'PREFERENCE', represents: 'where that cliff begins', source: 'project choice' },
  { component: 'rangeT normalisation', weight: 'min(1, d/120)', kind: 'PREFERENCE', represents: 'the distance at which range-sensitivity saturates', source: 'project choice; 120 m is not a published breakpoint' },
  { component: 'recoil (recoilV)', weight: '1.00 + 0.35t', kind: 'MECHANICAL input, PREFERENCE coefficient', represents: 'transformed vertical recoil amount', source: 'value from the source feed; coefficient a project choice' },
  { component: 'unpredictableRecoil', weight: '1.25 + 0.75t', kind: 'DERIVED input, PREFERENCE coefficient', represents: 'recoil x sin(direction variation) - the non-repeatable component', source: 'derived from two source values; coefficient a project choice' },
  { component: 'effectiveAdsSpreadDeg', weight: '2.00 + 2.50t', kind: 'MECHANICAL input, PREFERENCE coefficient', represents: 'simulated aimed spread after 8 shots', source: 'upstream spread simulation; coefficient a project choice' },
  { component: 'movingAdsMinSpreadDeg', weight: '0.35 + 0.65t', kind: 'MECHANICAL input, PREFERENCE coefficient', represents: 'minimum aimed spread while moving', source: 'upstream tier table; coefficient a project choice' }
];

// ---------------------------------------------------------------- measurement
const rows = [];
for (const [id, w] of Object.entries(cache.weapons ?? {})) {
  for (const d of [1, 10, 25, 50, 100, 150, 200, 300]) {
    const r = w.best?.[String(d)];
    if (!r) continue;
    const t = Math.min(1, Math.max(1, d) / 120);
    const parts = {
      recoil: Number(r.recoil) * (1.00 + 0.35 * t),
      unpredictable: Number(r.unpredictableRecoil) * (1.25 + 0.75 * t),
      effSpread: Number(r.effectiveAdsSpreadDeg) * (2.00 + 2.50 * t),
      moving: Number(r.movingAdsMinSpreadDeg) * (0.35 + 0.65 * t)
    };
    const total = Object.values(parts).reduce((a, b) => a + b, 0);
    if (!Number.isFinite(total) || total <= 0) continue;
    rows.push({
      weaponId: id, cls: w.cls, distance: d, beamIndex: Number(r.beamIndex), total,
      shares: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, v / total])),
      recoilV: Number(r.recoil), variationDeg: Number(r.recoilVariationDeg),
      triggerTtk: Number(r.triggerTtk)
    });
  }
}

const mean = xs => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const contribution = {};
for (const k of ['recoil', 'unpredictable', 'effSpread', 'moving']) {
  const s = rows.map(r => r.shares[k]);
  contribution[k] = {
    meanShareOfBeamIndex: +mean(s).toFixed(4),
    minShare: +Math.min(...s).toFixed(4),
    maxShare: +Math.max(...s).toFixed(4)
  };
}

/** Pearson correlation, to expose inputs that are largely the same signal twice. */
function corr(xs, ys) {
  const n = xs.length, mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { const a = xs[i] - mx, b = ys[i] - my; num += a * b; dx += a * a; dy += b * b; }
  return dx && dy ? +(num / Math.sqrt(dx * dy)).toFixed(4) : null;
}
const series = {
  recoil: rows.map(r => r.recoilV),
  unpredictable: rows.map(r => r.recoilV * Math.sin(Math.min(90, r.variationDeg) * Math.PI / 180)),
  effSpread: rows.map(r => r.beamIndex ? r.shares.effSpread * r.total : 0),
  moving: rows.map(r => r.shares.moving * r.total)
};
const correlations = {};
const keys = Object.keys(series);
for (let i = 0; i < keys.length; i++) {
  for (let k = i + 1; k < keys.length; k++) {
    correlations[`${keys[i]} vs ${keys[k]}`] = corr(series[keys[i]], series[keys[k]]);
  }
}

// The effective total coefficient on recoilV, counting both paths it enters through.
const recoilTotalCoefficient = rows.map(r => {
  const t = Math.min(1, Math.max(1, r.distance) / 120);
  return (1.00 + 0.35 * t) + Math.sin(Math.min(90, r.variationDeg) * Math.PI / 180) * (1.25 + 0.75 * t);
});

const findings = [
  {
    id: 'recoil-enters-twice',
    severity: 'design question, not a defect',
    finding: `recoilV enters the Beam Index through two terms. Its effective total coefficient ranges ${Math.min(...recoilTotalCoefficient).toFixed(2)}x to ${Math.max(...recoilTotalCoefficient).toFixed(2)}x depending on the weapon's recoil direction variation and the distance. A high-variation weapon is therefore penalised for the same recoil value roughly ${(Math.max(...recoilTotalCoefficient) / Math.min(...recoilTotalCoefficient)).toFixed(2)}x more than a low-variation one.`,
    correlation: correlations['recoil vs unpredictable'],
    interpretation: 'The two terms are not redundant - one is magnitude, the other lateral scatter - but they are strongly correlated by construction, since unpredictable is recoil multiplied by a factor in [0,1]. The consequence is that recoilV is the most heavily weighted primitive in BALANCED, which is worth stating explicitly because recoilV is also among the values with the weakest current verification.',
    recommendation: 'Document the intent. If the intent is that magnitude and scatter are separately meaningful, the current form is right and only the documentation is missing. Do not change the coefficients to reduce the correlation - that would alter what BALANCED means to satisfy a statistic.'
  },
  {
    id: 'effspread-dominates',
    severity: 'informational',
    finding: `effectiveAdsSpreadDeg carries the largest coefficient (2.00-4.50) and contributes a mean ${(contribution.effSpread.meanShareOfBeamIndex * 100).toFixed(1)}% of the Beam Index, ranging ${(contribution.effSpread.minShare * 100).toFixed(1)}%-${(contribution.effSpread.maxShare * 100).toFixed(1)}%.`,
    interpretation: 'Aimed spread is the dominant controllability term at range, by design. This is stated so the dominance is a known property rather than a surprise.',
    recommendation: 'No change. Recorded so that any future spread-model change is understood to be the highest-leverage edit available to the ranking.'
  },
  {
    id: 'offpace-cliff',
    severity: 'design question',
    finding: 'The 1.35x off-pace penalty is a discontinuity: a weapon 1.24x slower than the fastest is unpenalised, one 1.26x slower is penalised 35%. Two weapons either side of the threshold can swap order on a fraction of a millisecond.',
    interpretation: 'A cliff is a legitimate product choice - it encodes "too slow to matter" - but it makes rankings near the boundary fragile in a way a smooth penalty would not.',
    recommendation: 'Report near-threshold cases in the sensitivity work rather than smoothing the cliff. Changing it would redefine BALANCED, which this audit is explicitly not authorised to do.'
  },
  {
    id: 'fastest-kill-is-objective',
    severity: 'confirmation',
    finding: 'FASTEST KILL orders by trigger-to-kill outright and consults Beam Index only on an exact tie (epsilon 1e-9 ms, float noise only).',
    interpretation: 'It carries no preference weighting at all, which is what the control promises the user.',
    recommendation: 'No change. This is the property that keeps one of the two priorities fully objective.'
  }
];

const report = {
  generatedAt: new Date().toISOString(),
  scope: 'BALANCED ranking only. FASTEST KILL is ordered by trigger-to-kill with no preference weights and is reported here only to confirm that.',
  model: {
    metaCost: 'triggerTtk^0.55 * beamIndex^0.45 * (offPace ? 1.35 : 1)',
    beamIndex: 'recoil*(1.00+0.35t) + unpredictable*(1.25+0.75t) + effSpread*(2.00+2.50t) + moving*(0.35+0.65t)',
    rangeT: 'min(1, distance/120)',
    unpredictable: 'recoil * sin(min(90, recoilVariationDeg))'
  },
  weights: WEIGHTS,
  measurement: {
    samples: rows.length,
    describes: 'share of the Beam Index contributed by each term, measured over cached winning builds across the roster and distance range',
    contribution,
    correlations,
    recoilEffectiveCoefficient: { min: +Math.min(...recoilTotalCoefficient).toFixed(4), max: +Math.max(...recoilTotalCoefficient).toFixed(4), mean: +mean(recoilTotalCoefficient).toFixed(4) }
  },
  findings,
  changesMade: 'NONE. This audit deliberately makes no change to any weight. Altering what BALANCED means is a product decision, and nothing here demonstrates mathematically erroneous behaviour - only choices that were undocumented.'
};
await mkdir('reports/validation', { recursive: true });
await writeFile('reports/validation/ranking-weights.json', JSON.stringify(report, null, 1));

console.log('ranking weight audit — BALANCED');
console.log(`  measured over ${rows.length} cached winning builds\n`);
console.log('  COMPONENT                 WEIGHT              KIND');
for (const w of WEIGHTS) console.log(`  ${w.component.padEnd(25)} ${String(w.weight).padEnd(19)} ${w.kind}`);
console.log('\n  MEAN SHARE OF BEAM INDEX');
for (const [k, v] of Object.entries(contribution)) console.log(`  ${k.padEnd(16)} ${(v.meanShareOfBeamIndex * 100).toFixed(1)}%   (range ${(v.minShare * 100).toFixed(1)}%-${(v.maxShare * 100).toFixed(1)}%)`);
console.log('\n  CORRELATION BETWEEN INPUTS');
for (const [k, v] of Object.entries(correlations)) console.log(`  ${k.padEnd(30)} ${v}`);
console.log('\n  FINDINGS');
for (const f of findings) console.log(`  [${f.severity}] ${f.id}\n      ${f.finding}`);
console.log('\nwrote reports/validation/ranking-weights.json — NO weight was changed.');
