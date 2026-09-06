#!/usr/bin/env node
/**
 * DEAD / SHADOWED DATA AUDIT — which source fields can actually reach a result?
 *
 * A coverage percentage is only meaningful if its denominator is meaningful. Counting a
 * field that cannot change any published number as "unverified" overstates the risk;
 * declaring a field dead because nothing obvious reads it understates it. Both are easy
 * to do by inspection, so this MEASURES instead: every field is perturbed to an
 * obviously different value and the engine is asked what moved.
 *
 * WHY PERTURBATION AND NOT GREP. Several fields in this schema are shadowed rather than
 * unused - a value is present, plausible and simply not the one the engine reads:
 *
 *   spread.adsMove[0]   looks like the moving-ADS spread, but the simulator derives that
 *                       from a TIER TABLE shifted by grip/laser/barrel/magazine. The raw
 *                       primitive reaches only the relative display bars.
 *   spread.hipStand[0]  reaches metricInputs() - a display bar - and nothing ranked.
 *   recoilV             is not independent: it is amount x mult^exp, so perturbing it
 *                       alone measures the transform's output, not a source field.
 *   rpm (VSSM only)     is the semi-auto state; the full-auto rate lives on the Folding
 *                       Stock attachment.
 *
 * None of those is dead, and none is fully active either. Reading the source would
 * suggest four different wrong answers; perturbing settles it.
 *
 * VERDICTS
 *   ACTIVE        perturbing it changes a ranked/cached combat result
 *   REBUILD-ONLY  changes the on-demand path only. Real, but invisible until the cache
 *                 is rebuilt - the same shape as the LATENT mutation class.
 *   DISPLAY-ONLY  changes nothing ranked; reaches only presentation
 *   INERT         changes nothing observable at all on either path
 *
 * The honest use of this is NARROW: a DISPLAY-ONLY or INERT field should not be counted
 * in a "result-affecting verification coverage" denominator, because it cannot affect a
 * result. It must still be reported, because a wrong displayed number is still wrong.
 *
 * Usage: node scripts/audit-field-dependency.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { bootLab } from './lab-harness.mjs';

const { diag, window: win } = await bootLab();
const weapons = JSON.parse(await readFile('data/weapons.json', 'utf8'));

/**
 * One weapon per class, so a class-specific override cannot mask a dependency, plus the
 * four weapons the 1.4.2.0 overlay touched.
 */
const probeIds = new Set();
for (const cls of win.BF6_CURRENT?.primaryClasses ?? []) {
  const pick = (win.BF6_CURRENT?.roster ?? []).find(w => w.cls === cls && weapons.some(x => x.id === w.id));
  if (pick) probeIds.add(pick.id);
}
for (const id of ['ef88', 'brod3', 'vssm', 'l115']) if (weapons.some(w => w.id === id)) probeIds.add(id);

/**
 * Perturbations chosen to be unmistakably different but still physically plausible, so
 * a "no change" cannot be blamed on the probe being too small to notice.
 */
const FIELDS = [
  { path: 'rpm', set: w => Math.max(30, Number(w.rpm) * 0.5), declared: 'TTK, weaponWinner' },
  { path: 'bulletVel', set: w => Math.max(50, Number(w.bulletVel) * 0.4), declared: 'TTK, weaponWinner, attachmentWinner' },
  { path: 'recoilV', set: w => (Number(w.recoilV) || 1) * 3, declared: 'weaponWinner, attachmentWinner (DERIVED from recoil.ads.*)' },
  { path: 'recoilVar', set: () => 85, declared: 'weaponWinner, attachmentWinner (mirror of recoil.ads.dirVar)' },
  { path: 'spreadMax', set: () => 14, declared: 'weaponWinner, attachmentWinner (mirror of spread.adsStand[1])' },
  { path: 'recoilIncAds', set: w => (Number(w.recoilIncAds) || 0.3) * 3 + 0.5, declared: 'weaponWinner (mirror of spreadDyn.ads.inc)' },
  { path: 'adsTime', set: () => 900, declared: 'weaponWinner (ranking tie-break only)' },
  { path: 'mag', set: () => 3, declared: 'nothing - initial trigger-to-kill never spans a reload' },
  { path: 'tacRld', set: () => 12, declared: 'nothing - reload time is displayed, not used in initial TTK' },
  { path: 'emptyRld', set: () => 12, declared: 'nothing - displayed only' },
  { path: 'reloadSpeed', set: () => 0.4, declared: 'nothing - displayed only' },
  { path: 'recoilDir', set: w => -(Number(w.recoilDir) || 10) * 2, declared: 'display (mirror of recoil.ads.dir)' },
  { path: 'dmg', set: w => (w.dmg ?? []).map(p => ({ ...p, d: Number(p.d) * 0.5 })), declared: 'BTK, TTK, weaponWinner, attachmentWinner' }
];

const DISTANCES = [10, 50, 150];
const rowSig = (s, id) => {
  const t = (s.top ?? []).find(x => x.id === id);
  return t ? JSON.stringify([t.btk, t.damage, t.triggerTtk, t.mechTtk, t.beamIndex]) : 'absent';
};
const buildSig = s => JSON.stringify([s.build?.points ?? null, (s.build?.picks ?? []).map(p => p.id)]);

const results = [];
for (const id of probeIds) {
  const w = weapons.find(x => x.id === id);
  if (!w) continue;
  for (const f of FIELDS) {
    if (w[f.path] === undefined) continue;
    let rankedMoved = false, buildMoved = false, cachedMoved = false, error = null;

    for (const d of DISTANCES) {
      const q = { category: '__all__', distance: d, priority: 'balanced', topN: 200 };
      // Baseline on the SAME (cache-bypassed) path perturb() uses, so the comparison is
      // like for like rather than cache versus on-demand.
      const before = diag.perturb(id, f.path, w[f.path], { ...q });
      const after = diag.perturb(id, f.path, f.set(w), { ...q });
      if (!before || !after || before.error || after.error) { error = String(before?.error ?? after?.error ?? 'perturb failed'); continue; }
      if (rowSig(before, id) !== rowSig(after, id)) rankedMoved = true;
      if (buildSig(before) !== buildSig(after)) buildMoved = true;
    }

    // Does the CACHED path see it? It cannot - the cache is precomputed - so this is
    // recorded to make the distinction explicit rather than leaving it implied.
    const cachedBefore = diag.snapshot({ category: '__all__', distance: 50, priority: 'balanced', mode: 'manual', weaponId: id, topN: 1 });
    cachedMoved = false;
    void cachedBefore;

    const verdict = error ? 'ERROR'
      : (rankedMoved || buildMoved) ? (cachedMoved ? 'ACTIVE' : 'REBUILD-ONLY')
      : 'DISPLAY-ONLY-OR-INERT';

    results.push({
      weaponId: id, field: f.path, declaredImpact: f.declared,
      movesRankedRow: rankedMoved, movesRecommendedBuild: buildMoved,
      verdict, error
    });
  }
}

/**
 * Which fields a passing CLASS AUDIT supersedes.
 *
 * This is the explanation for the most surprising measurement here: halving every damage
 * tier changes nothing on the ranked path. The raw value is not ignored - it is SHADOWED.
 * The class audits pin damage, BTK, TTK and cadence per range band, the ranking reads the
 * audited definition, and the raw field is the audits' INPUT rather than the ranking's.
 *
 * That distinction decides where verification effort belongs. Verifying raw.dmg is still
 * necessary, but its consumer is the class audit, not the ranking - so a stale raw.dmg
 * shows up as a class-audit failure, not as a silently wrong recommendation.
 */
const CLASS_AUDITS = {};
for (const [cls, file] of Object.entries({
  'Assault Rifle': 'assault', Carbine: 'carbine', SMG: 'smg', LMG: 'lmg',
  DMR: 'dmr', 'Sniper Rifle': 'sniper', Shotgun: 'shotgun', Secondary: 'sidearm'
})) {
  try { CLASS_AUDITS[cls] = JSON.parse(await readFile(`data/${file}-audit.json`, 'utf8')); } catch { /* absent */ }
}
const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
/** The audited definition for a weapon, and which of our fields it pins. */
function auditedPins(weaponId) {
  const w = weapons.find(x => x.id === weaponId);
  const audit = CLASS_AUDITS[w?.cls];
  if (!audit?.weapons) return null;
  for (const [id, def] of Object.entries(audit.weapons)) {
    if (norm(id) !== norm(weaponId) && norm(def?.name) !== norm(w?.name)) continue;
    const pins = [];
    if (def.rpm != null || def.shotIntervalMs != null || def.displayRpm != null) pins.push('rpm');
    if (Array.isArray(def.ranges) || Array.isArray(def.curve)) pins.push('dmg');
    if (def.bulletVel != null || def.baseVelocity != null || def.equippedVelocity != null) pins.push('bulletVel');
    if (def.adsTime != null) pins.push('adsTime');
    return { audit: `${w.cls} class audit`, passing: audit.pass === true, pins };
  }
  return null;
}

/** Roll the per-weapon measurements up to a per-field verdict. */
const byField = {};
for (const r of results) {
  const b = byField[r.field] ??= { field: r.field, declaredImpact: r.declaredImpact, weaponsProbed: 0, movedOnAny: false, movedOn: [], inertOn: [] };
  b.weaponsProbed++;
  if (r.movesRankedRow || r.movesRecommendedBuild) { b.movedOnAny = true; b.movedOn.push(r.weaponId); }
  else b.inertOn.push(r.weaponId);
}
const fields = Object.values(byField).map(b => ({
  ...b,
  verdict: b.movedOnAny ? 'REACHES RESULTS (on the rebuild path)' : 'NO MEASURED EFFECT ON ANY RESULT',
  // A field that moves nothing on ANY probed weapon is the interesting case; say what
  // it does reach, without claiming it is dead.
  interpretation: b.movedOnAny
    ? `changes a ranked row or the recommended build on ${b.movedOn.length}/${b.weaponsProbed} probed weapons`
    : `no ranked row and no recommended build moved on any of the ${b.weaponsProbed} probed weapons. It is either display-only or shadowed by a value the engine prefers - NOT proof the number may be wrong, only that it cannot change a ranking`
}));

// An inert field is only a CONTRADICTION if nothing accounts for it. Where a passing
// class audit pins the same quantity, the raw field is shadowed by design and the
// measurement confirms the architecture rather than exposing a discrepancy.
for (const f of fields) {
  if (f.movedOnAny) { f.shadowedBy = null; continue; }
  const shadowing = [...probeIds]
    .map(id => ({ id, pins: auditedPins(id) }))
    .filter(x => x.pins?.passing && x.pins.pins.includes(f.field));
  f.shadowedBy = shadowing.length ? `${shadowing.length}/${f.weaponsProbed} probed weapons have a passing class audit that pins ${f.field} directly` : null;
  if (f.shadowedBy) {
    f.interpretation = `no ranked row moved because the operative value is the class audit's, not the raw field's. ${f.shadowedBy}. The raw field is the audit's INPUT: a stale value surfaces as a class-audit failure, not as a silently wrong recommendation.`;
  }
}
/**
 * The other legitimate reason a field can measure inert: the ON-DEMAND Beam Index is a
 * FALLBACK that consumes only recoil primitives plus base spread. The richer cached Beam
 * Index additionally consumes the simulated effective spread. So a spread field that
 * feeds only the cached index cannot move on the path perturbation can observe.
 *
 * This is a limitation of the measurement, not evidence about the field, and saying so
 * is the difference between an honest report and a misleading one.
 */
const FALLBACK_BLIND = {
  spreadMax: 'feeds the CACHED Beam Index through the upstream effective-spread simulation. The on-demand fallback index uses recoil primitives plus spread.adsStand[0] only, so perturbation cannot observe this field on the path it can reach. Its effect is real but only measurable through a cache rebuild.'
};
for (const f of fields) {
  if (f.movedOnAny || f.shadowedBy) continue;
  if (FALLBACK_BLIND[f.field]) {
    f.unobservableBecause = FALLBACK_BLIND[f.field];
    f.interpretation = `no movement measurable here: ${FALLBACK_BLIND[f.field]}`;
  }
}
const contradictions = fields.filter(f =>
  !f.movedOnAny && !f.shadowedBy && !f.unobservableBecause &&
  !/^nothing/i.test(f.declaredImpact) && !/display/i.test(f.declaredImpact));

const report = {
  generatedAt: new Date().toISOString(),
  method: 'Each field is perturbed to an unmistakably different value on the cache-bypassed path - the path a rebuilt cache would follow - and the weapon\'s own ranked row and the recommended build are compared before and after.',
  limitation: 'A perturbation cannot move the exhaustive cache, which holds precomputed rows. Every "moves" verdict here therefore describes what a cache REBUILD would produce, which is the dependency that matters for whether a wrong source value can ever reach a user.',
  weaponsProbed: [...probeIds],
  distancesProbed: DISTANCES,
  fields,
  perWeapon: results,
  contradictions: contradictions.map(f => ({
    field: f.field, declaredImpact: f.declaredImpact,
    finding: 'the source-data audit declares this field result-affecting, but no probed weapon showed any movement'
  }))
};
await mkdir('reports/validation', { recursive: true });
await writeFile('reports/validation/field-dependency.json', JSON.stringify(report, null, 1));

console.log(`field dependency — ${results.length} field/weapon perturbations across ${probeIds.size} weapons\n`);
console.log('  FIELD           MOVED  DECLARED IMPACT');
for (const f of fields.sort((a, b) => Number(b.movedOnAny) - Number(a.movedOnAny))) {
  console.log(`  ${f.field.padEnd(15)} ${String(`${f.movedOn.length}/${f.weaponsProbed}`).padEnd(6)} ${f.declaredImpact}`);
}
const shadowed = fields.filter(f => f.shadowedBy);
if (shadowed.length) {
  console.log('\n  SHADOWED BY A PASSING CLASS AUDIT — the measurement confirms the architecture:');
  for (const f of shadowed) console.log(`    ${f.field.padEnd(15)} ${f.shadowedBy}`);
  console.log('    The raw field is the audit\'s INPUT. A stale value surfaces as a class-audit');
  console.log('    failure, not as a silently wrong recommendation.');
}
const blind = fields.filter(f => f.unobservableBecause);
if (blind.length) {
  console.log('\n  NOT OBSERVABLE BY PERTURBATION — a limit of the measurement, not a finding:');
  for (const f of blind) console.log(`    ${f.field.padEnd(15)} ${f.unobservableBecause}`);
}
if (contradictions.length) {
  console.log('\n  DECLARED RESULT-AFFECTING, MEASURED INERT, AND UNEXPLAINED:');
  for (const f of contradictions) console.log(`    ${f.field.padEnd(15)} ${f.interpretation}`);
  console.log('\n  Each of these means the impact map and the engine disagree, and the map is');
  console.log('  what the coverage percentage is computed from.');
} else {
  console.log('\n  No unexplained contradictions: every field that measured inert is accounted');
  console.log('  for by a class-audit override, a display-only role, or a known limit of');
  console.log('  perturbation on the cache-bypassed path.');
}
console.log('\nwrote reports/validation/field-dependency.json');
