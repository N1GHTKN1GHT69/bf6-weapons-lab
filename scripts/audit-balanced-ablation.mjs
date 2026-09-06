#!/usr/bin/env node
/**
 * BALANCED FORMULA AUDIT — is recoilV counted twice, and does it matter?
 *
 * THE QUESTION. recoilV enters the Beam Index through two terms:
 *
 *     beamIndex = recoil        x (1.00 + 0.35t)          <- direct
 *               + unpredictable x (1.25 + 0.75t)          <- unpredictable = recoil x sin(variation)
 *               + effSpread     x (2.00 + 2.50t)
 *               + moving        x (0.35 + 0.65t)
 *
 * so its effective coefficient is (1.00 + 0.35t) + sin(var) x (1.25 + 0.75t). Whether
 * that is DESIGN (magnitude and lateral scatter are different qualities) or an
 * ACCIDENTAL DOUBLE COUNT (the same penalty charged twice) cannot be settled by looking
 * at the formula. It is settled by asking whether the second term carries information
 * the first does not.
 *
 * METHOD - exact, not simulated. Every input to the Beam Index is stored per row in the
 * combat cache (recoil, unpredictableRecoil, effectiveAdsSpreadDeg, movingAdsMinSpreadDeg),
 * and the full BALANCED cost is metaCost = triggerTtk^0.55 x beamIndex^0.45 with a 1.35x
 * off-pace penalty. So each ablation can be computed exactly from cached telemetry and
 * re-ranked, with no need to edit or re-run the engine.
 *
 *   FULL            the shipped model, reproduced from cached telemetry as a control
 *   NO_UNPREDICT    drop the unpredictable term entirely
 *   NO_DIRECT       drop the direct recoil term entirely
 *   DECORRELATED    replace unpredictable with sin(variation) alone, so the term carries
 *                   ONLY the scatter angle and no longer re-multiplies recoil magnitude
 *   NO_SPREAD       drop effective spread, as a scale control - it should move rankings a
 *                   lot, and if it does not, the harness is measuring nothing
 *
 * READING THE RESULT
 *   If NO_UNPREDICT barely moves rankings, the term is near-redundant with the direct
 *   one and the double count is real but inconsequential.
 *   If it moves rankings substantially AND DECORRELATED moves them differently, the two
 *   terms carry distinct information and the design is doing real work.
 *
 * NOTHING IS CHANGED BY THIS SCRIPT. It reports. Altering what BALANCED means is a
 * product decision, and a large coefficient is not by itself a defect.
 *
 * Usage: node scripts/audit-balanced-ablation.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const cache = JSON.parse(await readFile('data/combat-cache.json', 'utf8'));
// Every metre, not a sample. The ablation is pure arithmetic over cached telemetry, so
// exhaustive costs almost nothing - and "the winner never changes" is a claim that
// deserves the whole range behind it rather than 14 spot checks.
const DISTANCES = Array.from({ length: 300 }, (_, i) => i + 1);

const VARIANTS = {
  FULL: (r, t) => r.recoil * (1.00 + 0.35 * t) + r.unpredictableRecoil * (1.25 + 0.75 * t) + r.effectiveAdsSpreadDeg * (2.00 + 2.50 * t) + r.movingAdsMinSpreadDeg * (0.35 + 0.65 * t),
  NO_UNPREDICT: (r, t) => r.recoil * (1.00 + 0.35 * t) + r.effectiveAdsSpreadDeg * (2.00 + 2.50 * t) + r.movingAdsMinSpreadDeg * (0.35 + 0.65 * t),
  NO_DIRECT: (r, t) => r.unpredictableRecoil * (1.25 + 0.75 * t) + r.effectiveAdsSpreadDeg * (2.00 + 2.50 * t) + r.movingAdsMinSpreadDeg * (0.35 + 0.65 * t),
  // sin(variation) recovered from the stored pair: unpredictable = recoil x sin(var).
  DECORRELATED: (r, t) => {
    const sinVar = r.recoil > 0 ? r.unpredictableRecoil / r.recoil : 0;
    return r.recoil * (1.00 + 0.35 * t) + sinVar * (1.25 + 0.75 * t) + r.effectiveAdsSpreadDeg * (2.00 + 2.50 * t) + r.movingAdsMinSpreadDeg * (0.35 + 0.65 * t);
  },
  NO_SPREAD: (r, t) => r.recoil * (1.00 + 0.35 * t) + r.unpredictableRecoil * (1.25 + 0.75 * t) + r.movingAdsMinSpreadDeg * (0.35 + 0.65 * t)
};

/**
 * The AUTO META pool: the same exclusions production applies. Shotguns rank only within
 * their own class (pellet hit probability is unmodelled), the Interdictor is
 * empirical-current, and EF88/BROD 3/VSSM lack verified projectile ballistics.
 */
const EXCLUDED = new Set(['m87a1', 'm1014', 'ks18k', 'db12', 'interdictor', 'ef88', 'brod3', 'vssm']);
const pool = Object.entries(cache.weapons ?? {})
  .filter(([id, w]) => w.cls !== 'Sidearm' && !EXCLUDED.has(id))
  .map(([id, w]) => ({ id, cls: w.cls, w }));

const utility = (ttk, beam, fastest) => {
  const t = Math.max(1e-6, ttk), b = Math.max(0.05, beam);
  const base = Math.pow(t, 0.55) * Math.pow(b, 0.45);
  return base * (t > fastest * 1.25 + 10 ? 1.35 : 1);
};

function rankAt(distance, variantFn) {
  const t = Math.min(1, Math.max(1, distance) / 120);
  const rows = [];
  for (const p of pool) {
    const r = p.w.best?.[String(distance)];
    if (!r || !Number.isFinite(r.triggerTtk)) continue;
    rows.push({ id: p.id, cls: p.cls, ttk: Number(r.triggerTtk), beam: variantFn(r, t) });
  }
  if (!rows.length) return [];
  const fastest = Math.min(...rows.map(x => x.ttk));
  for (const x of rows) x.cost = utility(x.ttk, x.beam, fastest);
  rows.sort((a, b) => a.cost - b.cost || a.ttk - b.ttk || a.beam - b.beam);
  return rows;
}

// ------------------------------------------------------------------ ablation
const baseline = {};
for (const d of DISTANCES) baseline[d] = rankAt(d, VARIANTS.FULL);

const ablation = [];
for (const [name, fn] of Object.entries(VARIANTS)) {
  if (name === 'FULL') continue;
  let winnerChanges = 0, top3Changes = 0, totalPositionMoves = 0, maxMove = 0;
  const winnerExamples = [];
  for (const d of DISTANCES) {
    const base = baseline[d], alt = rankAt(d, fn);
    if (!base.length || !alt.length) continue;
    if (base[0].id !== alt[0].id) {
      winnerChanges++;
      if (winnerExamples.length < 5) winnerExamples.push({ distance: d, was: base[0].id, becomes: alt[0].id });
    }
    if (base.slice(0, 3).map(x => x.id).join('>') !== alt.slice(0, 3).map(x => x.id).join('>')) top3Changes++;
    const posBase = new Map(base.map((x, i) => [x.id, i]));
    for (let i = 0; i < alt.length; i++) {
      const move = Math.abs((posBase.get(alt[i].id) ?? i) - i);
      if (move) { totalPositionMoves++; maxMove = Math.max(maxMove, move); }
    }
  }
  ablation.push({
    variant: name,
    winnerChangedAtDistances: winnerChanges, ofDistances: DISTANCES.length,
    top3ChangedAtDistances: top3Changes,
    totalPositionMoves, maxPositionMove: maxMove,
    winnerExamples
  });
}

// -------------------------------------------------------- contribution shares
const contributions = [];
for (const d of [10, 25, 50, 100, 200, 300]) {
  const t = Math.min(1, Math.max(1, d) / 120);
  const top = baseline[d]?.slice(0, 5) ?? [];
  for (const x of top) {
    const r = pool.find(p => p.id === x.id).w.best[String(d)];
    const parts = {
      recoilDirect: r.recoil * (1.00 + 0.35 * t),
      recoilViaUnpredictable: r.unpredictableRecoil * (1.25 + 0.75 * t),
      effSpread: r.effectiveAdsSpreadDeg * (2.00 + 2.50 * t),
      moving: r.movingAdsMinSpreadDeg * (0.35 + 0.65 * t)
    };
    const total = Object.values(parts).reduce((a, b) => a + b, 0);
    contributions.push({
      distance: d, weaponId: x.id, rank: baseline[d].indexOf(x) + 1, beamIndex: +total.toFixed(6),
      shares: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, +(v / total).toFixed(4)])),
      recoilTotalShare: +((parts.recoilDirect + parts.recoilViaUnpredictable) / total).toFixed(4)
    });
  }
}

// ------------------------------------------------------------- near ties
const nearTies = [];
for (const d of DISTANCES) {
  const rows = baseline[d];
  for (let i = 0; i + 1 < Math.min(rows.length, 6); i++) {
    const margin = (rows[i + 1].cost - rows[i].cost) / rows[i].cost;
    if (margin < 0.01) {
      nearTies.push({
        distance: d, rank: i + 1, a: rows[i].id, b: rows[i + 1].id,
        marginPercent: +(margin * 100).toFixed(4),
        note: margin < 0.001 ? 'within 0.1% - effectively a coin flip on the current inputs' : 'within 1%'
      });
    }
  }
}

// --------------------------------------------------------------- verdict
const noUnpredict = ablation.find(a => a.variant === 'NO_UNPREDICT');
const decorrelated = ablation.find(a => a.variant === 'DECORRELATED');
const noSpread = ablation.find(a => a.variant === 'NO_SPREAD');
const controlWorks = noSpread.winnerChangedAtDistances > 0 || noSpread.totalPositionMoves > 0;

/**
 * The verdict is stated against the three options the brief names, and it distinguishes
 * two things an earlier draft ran together: whether the term carries INFORMATION, and
 * whether it is DECISIVE. A term can be non-redundant and still never change the answer
 * a user reads, and saying so plainly is more useful than forcing it into A or B.
 */
let verdict, reasoning;
const distinctFromDecorrelated = decorrelated.winnerChangedAtDistances !== noUnpredict.winnerChangedAtDistances
  || decorrelated.totalPositionMoves !== noUnpredict.totalPositionMoves;
if (!controlWorks) {
  verdict = 'INCONCLUSIVE';
  reasoning = 'The NO_SPREAD control changed nothing, so the harness is not measuring what it claims. No conclusion can be drawn about the recoil terms.';
} else if (noUnpredict.winnerChangedAtDistances === 0 && noUnpredict.top3ChangedAtDistances === 0 && noUnpredict.totalPositionMoves === 0) {
  verdict = 'B — ACCIDENTAL DOUBLE COUNT, INERT';
  reasoning = `Dropping the unpredictable term changes nothing at all across ${DISTANCES.length} distances. It carries no information the direct term does not.`;
} else if (noUnpredict.winnerChangedAtDistances === 0 && distinctFromDecorrelated) {
  verdict = 'C — DISTINCT INFORMATION, BUT NEVER DECISIVE FOR THE WINNER';
  reasoning = `The term is NOT redundant: decorrelating it - keeping the scatter angle but not re-multiplying by recoil magnitude - gives a different result again (${decorrelated.winnerChangedAtDistances} winner changes, ${decorrelated.totalPositionMoves} position moves) than dropping it (${noUnpredict.winnerChangedAtDistances}, ${noUnpredict.totalPositionMoves}). So the second term genuinely encodes magnitude-weighted scatter rather than duplicating magnitude. BUT across all ${DISTANCES.length} distances, dropping it changes the BALANCED winner ZERO times; it moves ${noUnpredict.totalPositionMoves} positions lower down the order and alters the top 3 at ${noUnpredict.top3ChangedAtDistances} distances. The double count is real, it is not accidental duplication, and it does not decide the headline recommendation.`;
} else if (distinctFromDecorrelated) {
  verdict = 'A — INTENTIONAL AND LOAD-BEARING';
  reasoning = `Dropping the unpredictable term changes the winner at ${noUnpredict.winnerChangedAtDistances} of ${DISTANCES.length} distances, and decorrelating it produces a different result again (${decorrelated.winnerChangedAtDistances} winner changes). The two terms carry distinct information and the second is decisive.`;
} else {
  verdict = 'C — PARTIALLY DISTINCT BUT HIGHLY CORRELATED';
  reasoning = 'Dropping the unpredictable term moves rankings, but decorrelating it produces the same movement, which is what you would expect if the term is dominated by the recoil magnitude it re-multiplies rather than by the scatter angle.';
}

const report = {
  generatedAt: new Date().toISOString(),
  question: 'Is recoilV double-counted in BALANCED, and is the second contribution load-bearing?',
  method: 'Every Beam Index input is stored per row in the combat cache, so each ablation is computed EXACTLY from cached telemetry and re-ranked. No engine edit, no simulation.',
  poolSize: pool.length,
  poolExclusions: 'Sidearms, shotguns (class-scoped until pellet hit probability is modelled), the Interdictor (empirical-current) and EF88/BROD 3/VSSM (no verified projectile ballistics) - the same exclusions production applies to AUTO META.',
  distances: DISTANCES,
  ablation,
  controlValid: controlWorks,
  contributions,
  nearTies,
  verdict, reasoning,
  changesMade: 'NONE. This audit changes no coefficient. A large or duplicated coefficient is a product decision unless it is mathematically erroneous, and nothing here demonstrates an error.',
  recommendation: verdict.startsWith('B')
    ? 'The term is inert. Removing it would simplify the model without changing any published result - but that is still a change to what BALANCED means, so it belongs to the human decision after the real-game audit, not to this pass.'
    : 'KEEP THE CURRENT FORM AND DOCUMENT THE INTENT. The two terms are recoil magnitude and magnitude-weighted scatter; they are not interchangeable, so this is not accidental duplication. Whether the second term DESERVES to influence sub-winner ordering as much as it does is a product question, and it now has a measured answer to be decided against rather than an argument from the shape of the formula. No code change in this pass.'
};
await mkdir('reports/validation', { recursive: true });
await writeFile('reports/validation/balanced-ablation.json', JSON.stringify(report, null, 1));

console.log(`BALANCED ablation — ${pool.length} ranked weapons x ${DISTANCES.length} distances, exact from cached telemetry\n`);
console.log('  VARIANT         WINNER CHANGES   TOP3 CHANGES   POSITION MOVES   MAX MOVE');
for (const a of ablation) {
  console.log(`  ${a.variant.padEnd(15)} ${String(`${a.winnerChangedAtDistances}/${a.ofDistances}`).padEnd(16)} ${String(a.top3ChangedAtDistances).padEnd(14)} ${String(a.totalPositionMoves).padEnd(16)} ${a.maxPositionMove}`);
}
console.log(`\n  control (NO_SPREAD moves rankings): ${controlWorks ? 'yes - the harness measures something' : 'NO - RESULTS ARE MEANINGLESS'}`);
const rs = contributions.map(c => c.recoilTotalShare);
console.log(`  recoil's combined share of the Beam Index for top-5 weapons: ${(Math.min(...rs) * 100).toFixed(1)}% - ${(Math.max(...rs) * 100).toFixed(1)}%`);
console.log(`  near ties within 1%: ${nearTies.length}${nearTies.length ? ` (tightest ${Math.min(...nearTies.map(n => n.marginPercent)).toFixed(4)}%)` : ''}`);
console.log(`\n  VERDICT: ${verdict}`);
console.log(`  ${reasoning}`);
console.log(`\n  ${report.recommendation}`);
console.log('\nwrote reports/validation/balanced-ablation.json — NO coefficient was changed.');
