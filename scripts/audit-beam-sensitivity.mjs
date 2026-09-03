#!/usr/bin/env node
/**
 * Sensitivity-driven worklist for the recoil/spread family.
 *
 * recoilV, recoilVar and spreadMax are the largest block of result-affecting
 * fields carried forward from the pinned 1.3.3.0 snapshot with no live-version
 * confirmation. They reach BALANCED ranking through one path only - the cached
 * beam index - so this quantifies, per weapon, how much error each can absorb
 * before the answer the Lab gives actually changes.
 *
 * That converts "186 unverified fields" into a ranked list of the handful whose
 * accuracy genuinely decides a recommendation, so research effort goes where it
 * changes an outcome rather than being spread evenly across the roster.
 *
 * Method: scale the stored beam primitive, recompute beamIndex with the exact
 * production formula, re-rank, and record whether the winner or top-3 moves.
 * The factors are PROBES of tolerance, never claims that any value is wrong.
 *
 * Writes reports/patch-delta/beam-sensitivity.{json,csv}.
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { bootLab } from './lab-harness.mjs';

const { diag, window: win } = await bootLab();
const weapons = JSON.parse(await readFile('data/weapons.json', 'utf8'));
const sourceVerification = JSON.parse(await readFile('data/source-verification.json', 'utf8'));

// Each probed primitive, and the raw source field(s) that feed it.
const PRIMITIVES = [
  { primitive: 'recoil', fields: ['recoilV'], note: 'transformed recoil amount; also drives unpredictableRecoil via sin(variation)' },
  { primitive: 'recoilVariationDeg', fields: ['recoilVar'], note: 'directional recoil variation; drives unpredictableRecoil' },
  { primitive: 'effectiveAdsSpreadDeg', fields: ['spreadMax'], note: 'effective sustained ADS spread from the spread simulation' }
];
// Probe band. Balance patches commonly move a recoil/spread value by O(10-25%),
// so this brackets that range - it is a tolerance probe, not a measurement.
const FACTORS = [0.75, 0.9, 1.1, 1.25];
const DISTANCES = [10, 25, 50, 100];
const PRIORITY = 'balanced'; // recoil/spread uncertainty threatens BALANCED, not raw FASTEST KILL

const roster = (win.BF6_CURRENT?.roster ?? []).filter(w => w.cls !== 'Secondary');
const q = d => ({ gameMode: 'multiplayer', category: '__all__', distance: d, priority: PRIORITY, topN: 8 });

// ---- baseline: who wins, who is top-3, at each probed distance -------------
const baseline = new Map();
const baselineWins = new Map(), baselineTop3 = new Map();
for (const d of DISTANCES) {
  const s = diag.snapshot(q(d));
  const top = s.top.map(t => t.id);
  baseline.set(d, { winner: top[0], top3: top.slice(0, 3) });
  baselineWins.set(top[0], (baselineWins.get(top[0]) || 0) + 1);
  for (const id of top.slice(0, 3)) baselineTop3.set(id, (baselineTop3.get(id) || 0) + 1);
}

const rows = [];
for (const rw of roster) {
  const raw = weapons.find(w => w.id === rw.id);
  if (!raw) continue;

  for (const p of PRIMITIVES) {
    let winnerFlips = 0, top3Changes = 0, scenarios = 0;
    const flipDetail = [];

    for (const d of DISTANCES) {
      const base = baseline.get(d);
      for (const f of FACTORS) {
        let s;
        try { s = diag.perturbBeamPrimitive(rw.id, p.primitive, f, q(d)); }
        catch { continue; }
        if (!s || s.error || !s.top?.length) continue;
        scenarios++;
        const top = s.top.map(t => t.id);
        if (top[0] !== base.winner) {
          winnerFlips++;
          flipDetail.push({ distance: d, factor: f, was: base.winner, now: top[0] });
        }
        if (top.slice(0, 3).join(',') !== base.top3.join(',')) top3Changes++;
      }
    }

    // Only the perturbed weapon's own fields are at issue, but a flip can also
    // be caused BY it (it overtakes/loses to someone). Both matter for research
    // priority: either way this weapon's accuracy decided the answer.
    const priorityScore = winnerFlips * 3 + top3Changes;
    if (!scenarios) continue;

    const currentValues = p.fields.map(fl => `${fl}=${raw[fl] ?? 'n/a'}`).join(' ');
    const override = sourceVerification.weaponOverrides?.[rw.id] ?? null;
    rows.push({
      weapon: rw.name,
      weaponId: rw.id,
      cls: rw.cls,
      primitive: p.primitive,
      fields: p.fields.join('|'),
      currentValue: currentValues,
      sourceVersion: '1.3.3.0 (pinned Sym.gg game-file snapshot)',
      currentStatus: override ? override.status : 'PATCH_RECONCILED_NO_KNOWN_DELTA',
      plausibleUncertainty: `probe +/-10% and +/-25% of the operative primitive`,
      scenariosProbed: scenarios,
      top3Changes,
      winnerFlips,
      // A uniform scale over a weapon's cached rows is monotonic, so it cannot
      // reorder that weapon's OWN builds. Build-flip sensitivity would need a
      // cache rebuild under perturbed source values, which is upstream-gated.
      optimizedBuildFlips: 'not measurable without a cache rebuild (upstream-gated)',
      baselineWins: baselineWins.get(rw.id) || 0,
      baselineTop3Appearances: baselineTop3.get(rw.id) || 0,
      priorityScore,
      flipDetail: flipDetail.slice(0, 6)
    });
  }
}

rows.sort((a, b) => b.priorityScore - a.priorityScore || b.baselineWins - a.baselineWins || a.weapon.localeCompare(b.weapon));

const withFlips = rows.filter(r => r.winnerFlips > 0);
const summary = {
  generatedAt: new Date().toISOString(),
  method: 'Scale a stored beam primitive, recompute beamIndex with the exact production formula from build-combat-cache.mjs, re-rank, record winner/top-3 movement. Factors are tolerance probes, not measurements.',
  priority: PRIORITY,
  distancesProbed: DISTANCES,
  factorsProbed: FACTORS,
  primitivesProbed: PRIMITIVES.map(p => `${p.primitive} <- ${p.fields.join('|')}`),
  weaponsProbed: new Set(rows.map(r => r.weaponId)).size,
  combinationsProbed: rows.reduce((a, r) => a + r.scenariosProbed, 0),
  entriesWithAnyWinnerFlip: withFlips.length,
  weaponsWhoseAccuracyCanDecideAWinner: [...new Set(withFlips.map(r => r.weaponId))],
  baselineWinners: [...baselineWins.entries()].map(([id, n]) => ({ weaponId: id, winsAcrossProbedDistances: n })),
  top15: rows.slice(0, 15).map(r => ({
    weapon: r.weapon, primitive: r.primitive, fields: r.fields,
    winnerFlips: r.winnerFlips, top3Changes: r.top3Changes, priorityScore: r.priorityScore,
    baselineWins: r.baselineWins
  }))
};

await mkdir('reports/patch-delta', { recursive: true });
await writeFile('reports/patch-delta/beam-sensitivity.json', JSON.stringify({ summary, rows }, null, 1));
const cols = ['weapon', 'weaponId', 'cls', 'primitive', 'fields', 'currentValue', 'sourceVersion', 'currentStatus', 'plausibleUncertainty', 'scenariosProbed', 'top3Changes', 'winnerFlips', 'optimizedBuildFlips', 'baselineWins', 'baselineTop3Appearances', 'priorityScore'];
await writeFile('reports/patch-delta/beam-sensitivity.csv',
  [cols.join(','), ...rows.map(r => cols.map(c => JSON.stringify(r[c] ?? '')).join(','))].join('\n'));

console.log(JSON.stringify(summary, null, 1));
console.log('\nWritten: reports/patch-delta/beam-sensitivity.{json,csv}');
