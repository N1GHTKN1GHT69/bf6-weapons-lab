#!/usr/bin/env node
/**
 * BOUNDARY AND FLOATING-POINT TESTING.
 *
 * Off-by-one errors do not live in the middle of a range; they live at the edges. This
 * walks every edge the model has - damage breakpoints, the ends of the distance range,
 * exact budget limits, and the peculiar near-integer RPM values this dataset carries -
 * and checks the behaviour on both sides of each one.
 *
 * WHY THE RPM VALUES MATTER HERE. The source publishes rates as 449.999, 799.999,
 * 830.7692307692307. Those are not typos: they are how the game's own tables express
 * 450, 800 and 10800/13. Any code that rounds, truncates or compares them carelessly
 * produces a shot interval a fraction of a millisecond out, which compounds over a
 * five-shot burst into a visible TTK difference. The VSSM pair in particular
 * (449.999 semi / 799.999 full-auto) is the difference between two fire modes, so a
 * comparison that collapsed them would be a correctness bug, not a rounding nit.
 *
 * WHAT IS CHECKED
 *   1. DAMAGE BREAKPOINTS. At every breakpoint r in every weapon's curve, evaluate
 *      r-1, r and r+1. The repeated-breakpoint rule (two points sharing an r) must
 *      hold: AT the shared distance the outgoing tier applies, and the lower tier
 *      starts at r+1. Damage must never change between two adjacent metres that
 *      contain no breakpoint.
 *   2. DISTANCE RANGE ENDS. 1 m and 300 m must be evaluable; 0 and 301 must clamp
 *      rather than throw or produce a hole.
 *   3. EXACT BUDGET. A build costing exactly the budget is legal; one costing
 *      budget+1 must not appear. Checked against every cached build.
 *   4. RPM REPRESENTATION. Shot intervals derived from 449.999 vs 450 must differ by
 *      less than the display resolution, and the VSSM's two rates must never collapse.
 *   5. BTK QUANTISATION. Damage exactly dividing 100 must not round up an extra shot -
 *      the classic ceil(100/20) = 5, not 6.
 *   6. CACHE ROUND-TRIP. Serialising and reparsing the cache must preserve every value
 *      exactly; a float that does not survive JSON is a value the product cannot ship.
 *
 * Usage: node scripts/audit-boundaries.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { steppedDamageAt, btkFor, shotIntervalSec, flightSeconds } from './reference-engine.mjs';
import { loadEffectiveWeapons } from './source-overlay.mjs';

const cache = JSON.parse(await readFile('data/combat-cache.json', 'utf8'));
const weapons = loadEffectiveWeapons('data/weapons.json');
const errors = [];
const notes = [];
const counters = {};
const bump = k => { counters[k] = (counters[k] ?? 0) + 1; };
const fail = (kind, msg) => { bump(`FAIL:${kind}`); if (errors.length < 40) errors.push(`[${kind}] ${msg}`); };

// ---------------------------------------------------------------- 1. breakpoints
for (const w of weapons) {
  const pts = (w.dmg ?? []).map(p => ({ r: Number(p.r), d: Number(p.d) })).filter(p => Number.isFinite(p.r));
  if (!pts.length) continue;
  const breakpoints = [...new Set(pts.map(p => p.r))].sort((a, b) => a - b);

  for (const r of breakpoints) {
    const before = steppedDamageAt(w.dmg, r - 1);
    const at = steppedDamageAt(w.dmg, r);
    const after = steppedDamageAt(w.dmg, r + 1);
    bump('breakpointsProbed');
    for (const [label, v] of [['r-1', before], ['r', at], ['r+1', after]]) {
      if (v == null || !Number.isFinite(v) || v <= 0) fail('breakpoint-value', `${w.id} at ${label} of breakpoint ${r}: damage ${v}`);
    }
    // Damage must never RISE across a breakpoint for a stepped (non-sniper) curve.
    // Snipers use an audited linear sweet-spot curve and are excluded - their damage
    // legitimately rises with distance.
    if (w.cls !== 'Sniper Rifle' && Number.isFinite(before) && Number.isFinite(after) && after > before + 1e-9) {
      fail('breakpoint-rises', `${w.id} damage rises across breakpoint ${r}: ${before} -> ${after}`);
    }
    // The repeated-breakpoint rule: where two points share an r, AT r the outgoing
    // (first) tier applies and the next tier starts at r+1.
    const shared = pts.filter(p => p.r === r);
    if (shared.length > 1) {
      bump('repeatedBreakpoints');
      if (Math.abs(at - shared[0].d) > 1e-9) {
        fail('repeated-breakpoint', `${w.id} at shared breakpoint ${r}: got ${at}, expected the outgoing tier ${shared[0].d}`);
      }
      if (Math.abs(after - shared[shared.length - 1].d) > 1e-9) {
        fail('repeated-breakpoint', `${w.id} just past shared breakpoint ${r}: got ${after}, expected the incoming tier ${shared[shared.length - 1].d}`);
      }
    }
  }

  // Between breakpoints nothing may move.
  for (let i = 0; i < breakpoints.length - 1; i++) {
    const lo = breakpoints[i] + 1, hi = breakpoints[i + 1] - 1;
    if (hi <= lo) continue;
    const mid = Math.floor((lo + hi) / 2);
    bump('interBreakpointProbes');
    if (Math.abs(steppedDamageAt(w.dmg, lo) - steppedDamageAt(w.dmg, mid)) > 1e-9 ||
        Math.abs(steppedDamageAt(w.dmg, mid) - steppedDamageAt(w.dmg, hi)) > 1e-9) {
      fail('inter-breakpoint-drift', `${w.id} damage changes between breakpoints ${lo}-${hi} with no breakpoint in between`);
    }
  }
}

// ------------------------------------------------------------- 2. range ends
for (const [id, w] of Object.entries(cache.weapons ?? {})) {
  for (const strategy of ['best', 'bestLethal']) {
    for (const d of [1, 300]) {
      bump('rangeEndProbes');
      if (!w[strategy]?.[String(d)]) fail('range-end', `${id} ${strategy} has no row at the ${d === 1 ? 'first' : 'last'} supported metre (${d})`);
    }
    for (const d of [0, 301]) {
      if (w[strategy]?.[String(d)]) fail('range-overrun', `${id} ${strategy} carries a row at ${d}m, outside the declared 1-300 range`);
    }
  }
}
// The reference flight model must behave at the ends rather than returning junk.
bump('flightEdgeProbes');
if (flightSeconds(700, 0.0035, 0) !== 0) fail('flight-zero', 'flight time at 0 m is not exactly 0');
if (!Number.isFinite(flightSeconds(700, 0.0035, 300))) fail('flight-max', 'flight time at 300 m is not finite');
if (flightSeconds(700, 0, 100) !== 100 / 700) fail('flight-nodrag', 'with zero drag the flight time is not distance/velocity');
if (flightSeconds(0, 0.0035, 100) !== null) fail('flight-guard', 'a zero muzzle velocity did not return null');

// ------------------------------------------------------------- 3. exact budget
for (const [id, w] of Object.entries(cache.weapons ?? {})) {
  const budget = Number(w.budget);
  let atBudget = 0;
  for (const b of Object.values(w.builds ?? {})) {
    bump('buildBudgetProbes');
    if (Number(b.points) > budget) fail('over-budget', `${id} build ${b.id} costs ${b.points} against a ${budget} budget`);
    if (Number(b.points) === budget) atBudget++;
  }
  // A budget nothing ever reaches would mean the optimizer is leaving points unspent
  // everywhere, which is worth knowing even though it is not an error.
  if (!atBudget) notes.push(`${id}: no cached build spends the full ${budget}-point budget`);
}

// --------------------------------------------------------- 4. RPM representation
{
  const cases = [
    { label: 'VSSM semi-auto', rpm: 449.999, nominal: 450 },
    { label: 'VSSM full-auto', rpm: 799.999, nominal: 800 },
    { label: 'BROD 3 / M433', rpm: 830.7692307692307, nominal: 10800 / 13 },
    { label: 'EF88', rpm: 675, nominal: 10800 / 16 }
  ];
  for (const c of cases) {
    bump('rpmProbes');
    const a = shotIntervalSec({ rpm: c.rpm, fireMode: 'auto' }, 1);
    const b = shotIntervalSec({ rpm: c.nominal, fireMode: 'auto' }, 1);
    const deltaMsOver5Shots = Math.abs(a - b) * 1000 * 4;
    // Four intervals is a five-shot kill, the common case. The published and nominal
    // forms must agree far inside the 1 ms the UI displays.
    if (deltaMsOver5Shots > 0.1) {
      fail('rpm-representation', `${c.label}: ${c.rpm} vs nominal ${c.nominal} differ by ${deltaMsOver5Shots.toFixed(4)} ms over a 5-shot kill`);
    }
  }
  // The VSSM's two rates must never be treated as the same number.
  bump('vssmRateSeparation');
  const semi = shotIntervalSec({ rpm: 449.999, fireMode: 'semi' }, 1);
  const auto = shotIntervalSec({ rpm: 799.999, fireMode: 'auto' }, 1);
  if (Math.abs(semi - auto) < 1e-6) fail('vssm-rates-collapsed', 'the VSSM semi and full-auto shot intervals are indistinguishable');
}

// ------------------------------------------------------- 5. BTK quantisation
{
  const cases = [
    { damage: 20, expect: 5, why: '100/20 is exactly 5 and must not round up to 6' },
    { damage: 25, expect: 4, why: 'exact division' },
    { damage: 100, expect: 1, why: 'a one-shot kill' },
    { damage: 33.333333333333336, expect: 3, why: 'a float that is a hair under 100/3 must still be 3' },
    { damage: 20.000000001, expect: 5, why: 'a hair over an exact divisor stays 5' },
    { damage: 19.999999999, expect: 6, why: 'a genuine hair under 20 needs a sixth shot' },
    { damage: 0, expect: null, why: 'zero damage cannot kill' },
    { damage: -5, expect: null, why: 'negative damage is not a kill' }
  ];
  for (const c of cases) {
    bump('btkProbes');
    const got = btkFor(c.damage);
    if (got !== c.expect) fail('btk-quantisation', `damage ${c.damage}: expected ${c.expect} (${c.why}) but got ${got}`);
  }
}

// --------------------------------------------------------- 6. cache round-trip
{
  const sample = [];
  for (const [id, w] of Object.entries(cache.weapons ?? {})) {
    for (const d of [1, 37, 100, 233, 300]) {
      const r = w.best?.[String(d)];
      if (r) sample.push({ id, d, r });
    }
  }
  for (const s of sample) {
    bump('roundTripProbes');
    const again = JSON.parse(JSON.stringify(s.r));
    for (const [k, v] of Object.entries(s.r)) {
      if (typeof v === 'number' && again[k] !== v) {
        fail('round-trip', `${s.id}@${s.d}m ${k}: ${v} did not survive a JSON round trip (${again[k]})`);
      }
    }
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  describes: 'Behaviour at every edge the model has: damage breakpoints (both sides and exactly on), the ends of the supported distance range, exact point budgets, the near-integer RPM values this dataset carries, BTK quantisation, and cache serialisation.',
  probes: counters,
  notes,
  errors
};
await mkdir('reports/validation', { recursive: true });
await writeFile('reports/validation/boundaries.json', JSON.stringify(report, null, 1));

console.log('boundary and floating-point tests');
for (const [k, v] of Object.entries(counters)) console.log(`  ${k.padEnd(26)} ${v}`);
for (const n of notes.slice(0, 10)) console.log(`  note: ${n}`);
if (notes.length > 10) console.log(`  ... and ${notes.length - 10} more notes`);
if (errors.length) {
  console.error('\nFAIL:\n  ' + errors.join('\n  '));
  process.exitCode = 1;
} else {
  console.log('\nPASS: every boundary behaves, on both sides and exactly on.');
}
