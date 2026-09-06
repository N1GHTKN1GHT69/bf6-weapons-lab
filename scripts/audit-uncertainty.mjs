#!/usr/bin/env node
/**
 * UNCERTAINTY PROPAGATION — does an unresolved value actually change the answer?
 *
 * "Unverified" and "matters" are different claims, and conflating them makes a coverage
 * report useless in both directions: it inflates the apparent risk of values nothing
 * depends on, and hides the few that can flip a recommendation. This sweeps each
 * unresolved value across a DEFENSIBLE range and classifies the result:
 *
 *   ROBUST     the recommendation is unchanged across the entire credible range
 *   SENSITIVE  the recommendation changes within the credible range
 *   UNKNOWN    no defensible range exists, so no sweep is possible
 *
 * THE HARD RULE: a range is only swept when the evidence supplies one. Inventing
 * "+/-20%" so a value can be classified would manufacture a precision the project does
 * not have and would present a guess as a measurement. Most unresolved values here are
 * UNKNOWN, and that is the honest answer rather than a gap in this tool.
 *
 * WHERE A RANGE GENUINELY EXISTS:
 *
 *   1. MISSING adsTime (M16A4, PP-19, RPK-74M, L115). The field is absent, not wrong.
 *      Its true value is bounded by what the same weapon class actually exhibits, and
 *      that bound comes from the dataset rather than from an assumption. The sweep runs
 *      the observed class minimum to the class maximum.
 *   2. THE TWO UNPUBLISHED REDSEC MECHANICS. EA state the close-range rule and the
 *      armour-break behaviour qualitatively without numbers, but the alternatives are
 *      DISCRETE and both are already implemented: close-range remove-vs-keep, spillover
 *      none-vs-proportional. Sweeping four combinations is exhaustive, not a guess.
 *
 * Everything else - damage curves for donor-estimated weapons, the Match Grade Ammo
 * interaction, the VSSM limb multipliers - has no published bound at any evidence tier.
 * Those are reported UNKNOWN with the reason, and are deliberately not swept.
 *
 * Usage: node scripts/audit-uncertainty.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { bootLab } from './lab-harness.mjs';

const { diag, window: win } = await bootLab();
const weapons = JSON.parse(await readFile('data/weapons.json', 'utf8'));
const coverage = JSON.parse(await readFile('reports/overnight/source-data-audit.json', 'utf8'));

const DISTANCES = [10, 25, 50, 100, 150, 200, 300];
const findings = [];

/** The ranked order at a query, as a comparable signature. */
const order = q => (diag.snapshot({ category: '__all__', mode: 'auto', topN: 5, ...q }).top ?? []).map(t => t.id).join('>');

// ============================================================ 1. missing adsTime
{
  const missing = weapons.filter(w => w.adsTime == null || !Number.isFinite(Number(w.adsTime)));
  for (const w of missing) {
    // `p.adsTime != null` is load-bearing: Number(null) is 0 and Number.isFinite(0) is
    // true, so filtering on finiteness alone silently admits every weapon whose adsTime
    // is ABSENT as though it were 0 ms. That put an impossible 0 at the bottom of the
    // credible range on three of the four weapons here.
    const peers = weapons
      .filter(p => p.cls === w.cls && p.adsTime != null && Number.isFinite(Number(p.adsTime)) && Number(p.adsTime) > 0)
      .map(p => Number(p.adsTime));
    if (peers.length < 3) {
      findings.push({
        field: 'adsTime', weaponId: w.id, classification: 'UNKNOWN',
        reason: `only ${peers.length} class peers carry an adsTime, too few to bound the value from the data`
      });
      continue;
    }
    const lo = Math.min(...peers), hi = Math.max(...peers);
    const probes = [lo, Math.round((lo + hi) / 2), hi];
    const moved = [];
    for (const d of DISTANCES) {
      for (const priority of ['balanced', 'fastest']) {
        const seen = new Set();
        for (const v of probes) {
          // perturb() bypasses the cache, which is the only path a source value can be
          // observed on - and the path a rebuilt cache would follow.
          const s = diag.perturb(w.id, 'adsTime', v, { category: '__all__', distance: d, priority, topN: 5 });
          seen.add((s.top ?? []).map(t => t.id).join('>'));
        }
        if (seen.size > 1) moved.push(`${d}m/${priority}`);
      }
    }
    findings.push({
      field: 'adsTime', weaponId: w.id, cls: w.cls,
      credibleRange: [lo, hi], rangeBasis: `observed minimum and maximum adsTime among the ${peers.length} ${w.cls}s that carry one`,
      probes,
      classification: moved.length ? 'SENSITIVE' : 'ROBUST',
      affectedCases: moved,
      reason: moved.length
        ? `the ranked order changes within the credible range at ${moved.length} of ${DISTANCES.length * 2} probed cases`
        : `the ranked order is identical at every probed value across the whole credible range`
    });
  }
}

// ==================================================== 2. the two REDSEC unknowns
{
  const cases = [];
  for (const d of DISTANCES) {
    for (const priority of ['balanced', 'fastest']) {
      const s = diag.redsecSensitivity({ category: '__all__', distance: d, priority });
      cases.push({
        distance: d, priority,
        winnerStable: s.winnerStable, top3Stable: s.top3Stable, btkStable: s.btkStable,
        winners: [...new Set(s.combos.map(c => c.winner))],
        combos: s.combos.map(c => `${c.closeRange}/${c.spillover}=${c.winner}`)
      });
    }
  }
  const unstable = cases.filter(c => !c.winnerStable);
  findings.push({
    field: 'redsecCloseRangeRule + armourBreakSpillover', weaponId: '(REDSEC 2-plate model)',
    credibleRange: 'discrete: closeRange remove|keep x spillover none|proportional (4 combinations, exhaustive)',
    rangeBasis: 'EA state both mechanics qualitatively without numbers; the alternatives are discrete and both readings are implemented, so the sweep is complete rather than sampled',
    classification: unstable.length ? 'SENSITIVE' : 'ROBUST',
    affectedCases: unstable.map(c => `${c.distance}m/${c.priority}: ${c.winners.join(' or ')}`),
    reason: unstable.length
      ? `the AUTO winner depends on which unpublished reading is correct at ${unstable.length} of ${cases.length} probed cases`
      : 'the AUTO winner is the same under all four readings at every probed case',
    detail: cases
  });
}

// ================================================ 3. everything else: UNKNOWN
{
  const blockers = coverage.summary?.currentVerificationBlockers ?? [];
  for (const b of blockers) {
    if (b.field === 'adsTime') continue; // handled above with a real range
    findings.push({
      field: b.field, weaponId: `(${b.weapons} weapons)`,
      classification: 'UNKNOWN',
      reason: `${b.reason} No published bound exists at any evidence tier, so no defensible range can be swept. Inventing one would present a guess as a measurement.`,
      fieldsAffected: b.fields
    });
  }
}

const byClass = {};
for (const f of findings) byClass[f.classification] = (byClass[f.classification] ?? 0) + 1;
const sensitive = findings.filter(f => f.classification === 'SENSITIVE');
const robust = findings.filter(f => f.classification === 'ROBUST');

const report = {
  generatedAt: new Date().toISOString(),
  method: 'Each unresolved value is swept across a range the EVIDENCE supplies - never an invented one - and the ranked order is compared across the range. Values with no defensible bound are reported UNKNOWN rather than assigned a fabricated tolerance.',
  distancesProbed: DISTANCES,
  classification: byClass,
  headline: {
    decisionRelevant: sensitive.map(f => `${f.weaponId} ${f.field}`),
    provenIrrelevantOverTheirCredibleRange: robust.map(f => `${f.weaponId} ${f.field}`),
    unquantifiable: findings.filter(f => f.classification === 'UNKNOWN').map(f => f.field)
  },
  findings
};
await mkdir('reports/validation', { recursive: true });
await writeFile('reports/validation/uncertainty.json', JSON.stringify(report, null, 1));

console.log('uncertainty propagation');
for (const [k, v] of Object.entries(byClass)) console.log(`  ${k.padEnd(10)} ${v}`);
console.log('\n  SENSITIVE — unresolved and capable of changing a recommendation:');
if (!sensitive.length) console.log('    (none)');
for (const f of sensitive) console.log(`    ${String(f.weaponId).padEnd(26)} ${f.field}\n        ${f.reason}`);
console.log('\n  ROBUST — unresolved but proven not to matter across the whole credible range:');
if (!robust.length) console.log('    (none)');
for (const f of robust) console.log(`    ${String(f.weaponId).padEnd(26)} ${f.field} (range ${JSON.stringify(f.credibleRange)})`);
console.log('\n  UNKNOWN — no defensible range exists; deliberately not swept:');
for (const f of findings.filter(x => x.classification === 'UNKNOWN')) console.log(`    ${f.field}`);
console.log('\nwrote reports/validation/uncertainty.json');
