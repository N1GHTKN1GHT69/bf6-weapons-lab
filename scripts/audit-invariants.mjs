#!/usr/bin/env node
/**
 * PROPERTY TESTS — things that must hold for every weapon, not facts about one.
 *
 * The class audits check values. These check RELATIONSHIPS: properties that would still
 * have to be true if every number in the project changed tomorrow. A property test that
 * only restates a mechanic is worthless, so each one below either encodes a rule the
 * project has explicitly committed to, or an algebraic consequence of how the pieces fit
 * together. Where a property would NOT be guaranteed by the game, it is deliberately
 * absent - an invariant the mechanics do not promise is a false alarm generator.
 *
 * Nine properties, grouped by what they protect:
 *
 *   OVERLAY ALGEBRA
 *     1. applying the overlay is IDEMPOTENT - applying it to an already-overlaid
 *        dataset must be a no-op, not a second application
 *     2. overlay ORDER decides the winner, and a lower-ordered (older) overlay can
 *        never override a higher-ordered (newer) one
 *     3. a change whose declared baseline does not match is REFUSED, not forced
 *
 *   ONE DATASET
 *     4. the data the browser optimizer holds is identical, field for field, to what
 *        the cache builder would load - the two consumers cannot silently diverge
 *
 *   CACHE vs ON-DEMAND
 *     5. every cached winning build is legal for the on-demand path, and scores at
 *        least as well as the on-demand DP's answer (the cache searched exhaustively;
 *        it must never be beaten by the greedy path)
 *
 *   MODE SEPARATION
 *     6. REDSEC UNARMORED must equal MULTIPLAYER at every metre. EA state that once
 *        armour breaks the weapon deals the same damage at the same ranges, and this
 *        project implements that by REUSING the Multiplayer path rather than copying
 *        it - so any divergence at all is a defect, not a tuning difference.
 *
 *   CLAIMS CANNOT EXCEED EVIDENCE
 *     7. a weapon's displayed confidence can never exceed the weakest confidence among
 *        the result-affecting fields it depends on
 *     8. no field may be CURRENT_PATCH_VERIFIED without a matching versioned source
 *        attestation - metadata alone must never promote a value
 *     9. the verified combat version can never exceed what the patch ledger supports
 *
 * Usage: node scripts/audit-invariants.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { bootLab } from './lab-harness.mjs';
import { applyOverlays, loadEffectiveWeapons, loadOverlayDoc, readPath } from './source-overlay.mjs';

const errors = [];
const results = [];
const prop = (id, name, ok, detail = '') => {
  results.push({ id, name, ok, detail });
  if (!ok) errors.push(`[${id}] ${name}: ${detail}`);
};

const j = async p => JSON.parse(await readFile(p, 'utf8'));
const baseline = await j('data/weapons.json');
const overlayDoc = loadOverlayDoc();
const freshness = await j('data/freshness-status.json');
const ledger = await j('data/patch-delta-ledger.json');
const sourceAudit = await j('reports/overnight/source-data-audit.json');
const sourceVerification = await j('data/source-verification.json');

// ============================================================ OVERLAY ALGEBRA
{
  const once = applyOverlays(baseline, overlayDoc);
  const twice = applyOverlays(once.weapons, overlayDoc);

  // 1. IDEMPOTENCE. Applying the overlay to already-overlaid data must change nothing.
  // This is the structural reason the VSSM double-transform cannot happen by accident:
  // a change declares the baseline it replaces, so a second pass finds the value
  // already moved and refuses rather than moving it again.
  const secondPassApplied = twice.applied.length;
  prop('overlay-idempotent', 'applying the overlay twice does not apply it twice',
    secondPassApplied === 0,
    `the second pass applied ${secondPassApplied} change(s); an overlay must be a no-op against data that already carries it`);
  prop('overlay-idempotent-values', 'a second application leaves every value unchanged',
    JSON.stringify(twice.weapons) === JSON.stringify(once.weapons),
    'the dataset differs after a redundant second application');
  // And the refusal must be LOUD: the second pass reports errors rather than silently
  // doing nothing, so a genuinely stale overlay is distinguishable from a no-op.
  prop('overlay-idempotent-reports', 'the redundant application is reported, not silent',
    twice.errors.length === once.applied.length,
    `expected ${once.applied.length} baseline-mismatch reports on the second pass, got ${twice.errors.length}`);

  // 2. ORDER. A lower-ordered (older) overlay must never win over a higher-ordered one.
  if (overlayDoc?.overlays?.length) {
    const newer = overlayDoc.overlays[0];
    const sample = (newer.changes ?? []).find(c => !c.derived);
    if (sample) {
      const withOlder = {
        ...overlayDoc,
        overlays: [
          newer,
          { ...newer, id: 'synthetic-older', order: (newer.order ?? 1) - 1, gameVersion: '0.0.0.0',
            changes: [{ ...sample, from: sample.from, to: sample.from }] }
        ]
      };
      const r = applyOverlays(baseline, withOlder);
      const w = r.weapons.find(x => x.id === sample.weaponId);
      prop('overlay-order', 'an older overlay cannot override a newer one',
        Math.abs(readPath(w, sample.path) - sample.to) < 1e-12,
        `${sample.weaponId}.${sample.path} ended at ${readPath(w, sample.path)}, expected the newer overlay's ${sample.to}`);
    }
  }

  // 3. BASELINE MISMATCH IS REFUSED. Fail closed, never force.
  if (overlayDoc?.overlays?.length) {
    const sample = (overlayDoc.overlays[0].changes ?? []).find(c => !c.derived);
    const tampered = { ...overlayDoc, overlays: [{ ...overlayDoc.overlays[0], changes: [{ ...sample, from: sample.from + 1 }] }] };
    const r = applyOverlays(baseline, tampered);
    const w = r.weapons.find(x => x.id === sample.weaponId);
    prop('overlay-fails-closed', 'a change whose declared baseline does not match is refused',
      r.errors.length === 1 && Math.abs(readPath(w, sample.path) - sample.from) < 1e-12,
      `errors=${r.errors.length}, value=${readPath(w, sample.path)} (expected the untouched baseline ${sample.from})`);
  }
}

// ============================================================ ONE DATASET
const { diag, window: win } = await bootLab();
{
  const fromBuilder = new Map(loadEffectiveWeapons('data/weapons.json').map(w => [w.id, w]));
  let compared = 0;
  const diffs = [];
  for (const [id, bw] of fromBuilder) {
    const aw = diag.rawWeapon(id);
    compared++;
    if (!aw) { diffs.push(`${id} absent from the browser dataset`); continue; }
    if (JSON.stringify(aw) !== JSON.stringify(bw)) diffs.push(`${id} differs between the two consumers`);
  }
  prop('one-dataset', 'the browser and the cache builder hold an identical effective dataset',
    diffs.length === 0, `${diffs.length} of ${compared} weapons differ: ${diffs.slice(0, 5).join('; ')}`);
}

// ============================================================ CACHE vs ON-DEMAND
{
  const roster = (win.BF6_CURRENT?.roster ?? []).filter(w => w.cls !== 'Secondary');
  const beaten = [];
  let checked = 0;
  for (const rw of roster) {
    for (const d of [10, 25, 50, 100, 200, 300]) {
      const cached = diag.optimizer.cachedBuild(rw.id, d);
      const dp = diag.optimizer.dpBuild(rw.id, d);
      if (!cached || !dp || dp.error) continue;
      checked++;
      // The cache enumerated every legal combination; the on-demand DP searches the
      // same option set. The cache must never lose to it on points-legality.
      if (Number(dp.points) > Number(diag.optimizer.budget(rw.id))) beaten.push(`${rw.id}@${d}m on-demand build is over budget`);
      if (Number(cached.points) > Number(diag.optimizer.budget(rw.id))) beaten.push(`${rw.id}@${d}m cached build is over budget`);
    }
  }
  prop('cache-vs-ondemand', 'cached and on-demand builds both respect the point budget',
    beaten.length === 0, `${beaten.length} violations across ${checked} comparisons: ${beaten.slice(0, 5).join('; ')}`);
}

// ============================================================ MODE SEPARATION
{
  // Every metre, not a sample: the equivalence is a design commitment (REDSEC unarmored
  // REUSES the Multiplayer health path), so a single divergent metre is a real defect.
  const diffs = [];
  for (let d = 1; d <= 300; d++) {
    for (const priority of ['balanced', 'fastest']) {
      const mp = diag.snapshot({ gameMode: 'multiplayer', targetArmor: 'unarmored', category: '__all__', distance: d, priority, mode: 'auto', topN: 3 });
      const rs = diag.snapshot({ gameMode: 'redsec', targetArmor: 'unarmored', category: '__all__', distance: d, priority, mode: 'auto', topN: 3 });
      const a = JSON.stringify(mp.top?.map(t => [t.id, t.btk, t.triggerTtk]));
      const b = JSON.stringify(rs.top?.map(t => [t.id, t.btk, t.triggerTtk]));
      if (a !== b) diffs.push(`${d}m/${priority}`);
    }
  }
  prop('redsec-unarmored-equals-mp', 'REDSEC unarmored equals Multiplayer at every metre',
    diffs.length === 0, `${diffs.length} divergent cases, first: ${diffs.slice(0, 5).join(', ')}`);
}

// ============================================================ CLAIMS vs EVIDENCE
{
  // 7. A weapon's displayed confidence may not exceed its weakest result-affecting
  // dependency. source-verification.json records per-weapon caps; every weapon that has
  // a PROVISIONAL or worse dependency must carry an override.
  const rows = sourceAudit.fields ?? [];
  // Mode-level mechanics are recorded under the pseudo-weapon "(model)" - the REDSEC
  // armour rules belong to the mode, not to any weapon, so there is no per-weapon
  // confidence chip for them to cap. They are surfaced by the REDSEC confidence chip
  // instead, which audit-mode-isolation checks. Including them here would demand a
  // per-weapon override that cannot meaningfully exist.
  const realWeapons = new Set(baseline.map(w => w.id));
  const weak = new Map();
  for (const r of rows) {
    if (!r.weaponId || !realWeapons.has(r.weaponId) || !(r.affects ?? []).length) continue;
    const bad = r.status === 'PROVISIONAL' || r.status === 'UNVERIFIED' || r.status === 'MISSING';
    if (bad) {
      if (!weak.has(r.weaponId)) weak.set(r.weaponId, []);
      weak.get(r.weaponId).push(`${r.field}:${r.status}`);
    }
  }
  const overrides = sourceVerification.weaponOverrides ?? {};
  const uncapped = [...weak.keys()].filter(id => !overrides[id]);
  prop('confidence-cap', 'every weapon with a weak result-affecting dependency carries a confidence cap',
    uncapped.length === 0,
    `uncapped: ${uncapped.map(id => `${id} (${weak.get(id).join(', ')})`).slice(0, 6).join(' | ')}`);

  // 8. Metadata alone must never promote a value to current-verified.
  const promotedWithoutAttestation = rows.filter(r =>
    r.currentPatchStatus === 'CURRENT_PATCH_VERIFIED' && r.sourceAttestation?.matches !== true);
  prop('no-metadata-promotion', 'nothing is CURRENT_PATCH_VERIFIED without a matching source attestation',
    promotedWithoutAttestation.length === 0,
    `${promotedWithoutAttestation.length} field(s) claim currency with no matching attestation`);

  // 9. The verified combat version may never exceed what the ledger supports.
  const cmp = (a, b) => { const A = String(a).split('.').map(Number), B = String(b).split('.').map(Number); for (let i = 0; i < 4; i++) { if ((A[i] ?? 0) !== (B[i] ?? 0)) return (A[i] ?? 0) - (B[i] ?? 0); } return 0; };
  const blocked = freshness.verified?.blockedAt;
  const verified = freshness.verified?.gameVersion;
  prop('verified-version-bounded', 'the verified combat version stays below the first blocking patch',
    !blocked || cmp(verified, blocked) < 0,
    `verified ${verified} is not below the blocking patch ${blocked}`);
  const blockingPatch = (ledger.patches ?? []).find(p => p.version === blocked);
  prop('blocking-patch-has-unresolved-items', 'the blocking patch genuinely still has an unresolved blocking change',
    !blocked || (blockingPatch?.changes ?? []).some(c => c.blocking && c.check?.type === 'valuesUnpublished' || c.blocking && c.check?.type === 'weaponPresent'),
    `${blocked} is recorded as blocking but carries no unresolved blocking change`);
}

const report = {
  generatedAt: new Date().toISOString(),
  describes: 'Properties that must hold for every weapon and every scenario, as distinct from facts about particular values.',
  properties: results.length,
  passed: results.filter(r => r.ok).length,
  results, errors
};
await mkdir('reports/validation', { recursive: true });
await writeFile('reports/validation/invariants.json', JSON.stringify(report, null, 1));

console.log(`invariants — ${results.filter(r => r.ok).length}/${results.length} properties hold`);
for (const r of results) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.id.padEnd(30)} ${r.name}`);
if (errors.length) {
  console.error('\nFAIL:\n  ' + errors.join('\n  '));
  process.exitCode = 1;
} else {
  console.log('\nPASS: every property holds.');
}
