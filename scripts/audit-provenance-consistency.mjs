#!/usr/bin/env node
/**
 * Cross-check the provenance claims against each other.
 *
 * WHY THIS GATE EXISTS. Mutation testing flipped `numericWeaponStatDelta` to false on
 * update 1.4.2.0 - the patch whose whole significance is that it changed weapon numbers
 * - and every gate passed. That flag is not decorative: it is the BRIDGE that lets a
 * value attested at an older version be reported as current for the live game. A false
 * bridge silently upgrades the confidence of hundreds of fields.
 *
 * The flag was checkable all along, because the ledger already records, per patch, what
 * that patch did. A patch cannot simultaneously say "no numeric weapon statistic
 * changed" and carry a change whose own check ingests numeric values for it. This gate
 * makes the several provenance records contradict each other out loud instead of
 * quietly disagreeing.
 *
 * The checks:
 *   1. numericWeaponStatDelta:false is incompatible with that patch carrying a
 *      sourceOverlay check (numbers were ingested) or an unresolved valuesUnpublished
 *      item about weapon statistics (numbers changed and we could not get them).
 *   2. numericWeaponStatDelta:false must cite evidence, and the evidence must claim the
 *      changelog was actually read - not merely that nothing was noticed.
 *   3. Every overlay's game version must appear in the ledger, so a value cannot be
 *      ingested "at" a patch the project has never reconciled.
 *   4. The overlay's stated source artifact must exist and match the hash recorded in
 *      the overlay, so the provenance chain has no dangling link.
 *   5. Freshness must not claim a numerical source version the overlay does not carry.
 *
 * Usage: node scripts/audit-provenance-consistency.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { contentSha256 } from './source-overlay.mjs';

const j = async p => JSON.parse(await readFile(p, 'utf8'));
const ledger = await j('data/patch-delta-ledger.json');
const freshness = await j('data/freshness-status.json');
const overlayDoc = await j('data/source-overlays.json').catch(() => null);

const errors = [];
const checks = [];
const check = (name, ok, detail) => { checks.push({ name, ok, detail }); if (!ok) errors.push(`${name}: ${detail}`); };

// ---- 1 & 2: the bridge flag must agree with what the patch itself records ----------
for (const p of ledger.patches ?? []) {
  const changes = p.changes ?? [];
  const ingestsNumbers = changes.some(c => c.check?.type === 'sourceOverlay');
  const unresolvedNumbers = changes.some(c => c.blocking && c.check?.type === 'valuesUnpublished');
  const addsWeapons = changes.some(c => c.check?.type === 'weaponPresent');

  if (p.numericWeaponStatDelta === false) {
    check(`${p.version} bridge vs ingested values`, !ingestsNumbers,
      'claims no numeric weapon-stat change, but carries a sourceOverlay check - numeric values were ingested for this exact patch');
    check(`${p.version} bridge vs unresolved values`, !unresolvedNumbers,
      'claims no numeric weapon-stat change, but carries an unresolved valuesUnpublished item - EA changed a value and no number was obtainable');
    check(`${p.version} bridge vs new weapons`, !addsWeapons,
      'claims no numeric weapon-stat change, but adds a weapon; a new weapon record is numeric weapon data by definition');
    const ev = String(p.numericWeaponStatDeltaEvidence ?? '');
    check(`${p.version} bridge evidence`, /changelog|patch notes/i.test(ev) && /(fetch|read|classif)/i.test(ev),
      `evidence does not state that the official changelog was fetched and read in full: "${ev.slice(0, 120)}"`);
  } else if (p.numericWeaponStatDelta === true) {
    check(`${p.version} declared delta is substantiated`, ingestsNumbers || unresolvedNumbers || addsWeapons,
      'declares a numeric weapon-stat change but records no change that would produce one');
  } else {
    check(`${p.version} bridge classified`, false,
      'carries no numericWeaponStatDelta finding, so any value attested before it cannot be bridged past it');
  }
}

// ---- 3: an overlay may only claim a version the ledger knows ----------------------
if (overlayDoc) {
  const known = new Set((ledger.patches ?? []).map(p => p.version));
  for (const o of overlayDoc.overlays ?? []) {
    check(`overlay ${o.id} version is reconciled`, known.has(o.gameVersion),
      `ingests values "at" ${o.gameVersion}, which the patch ledger does not contain - the version label is unreconciled`);
  }

  // ---- 4: the provenance chain must have no dangling link ------------------------
  for (const o of overlayDoc.overlays ?? []) {
    if (!o.sourceArtifact) { check(`overlay ${o.id} names an artifact`, false, 'no sourceArtifact recorded'); continue; }
    let text = null;
    try { text = await readFile(o.sourceArtifact, 'utf8'); }
    catch { check(`overlay ${o.id} artifact exists`, false, `${o.sourceArtifact} is referenced but missing`); continue; }
    check(`overlay ${o.id} artifact exists`, true, o.sourceArtifact);
    if (o.sourceArtifactSha256) {
      check(`overlay ${o.id} artifact hash`, contentSha256(text) === o.sourceArtifactSha256,
        `${o.sourceArtifact} does not match the hash recorded in the overlay (${contentSha256(text).slice(0, 16)}... vs ${String(o.sourceArtifactSha256).slice(0, 16)}...)`);
    }
  }

  // ---- 5: freshness must not overstate the numerical source ----------------------
  const ns = freshness.numericalSource;
  if (ns) {
    const enabled = (overlayDoc.overlays ?? []).filter(o => o.enabled !== false);
    check('freshness numerical source matches an enabled overlay',
      enabled.some(o => o.gameVersion === ns.gameVersion),
      `freshness advertises numbers sourced at ${ns.gameVersion}, but no enabled overlay carries that version`);
    check('freshness numerical source change count matches',
      enabled.some(o => o.gameVersion === ns.gameVersion && (o.changes ?? []).length === ns.changes),
      `freshness advertises ${ns.changes} changes at ${ns.gameVersion}; the overlay carries a different number`);
    // The bridge shown to users must be the one the ledger actually supports.
    if (ns.bridgedToLive?.current === true) {
      const live = ns.bridgedToLive.liveGameVersion;
      const cmp = (a, b) => { const A = String(a).split('.').map(Number), B = String(b).split('.').map(Number); for (let i = 0; i < 4; i++) { if ((A[i] ?? 0) !== (B[i] ?? 0)) return (A[i] ?? 0) - (B[i] ?? 0); } return 0; };
      const between = (ledger.patches ?? []).filter(p => cmp(p.version, ns.gameVersion) > 0 && cmp(p.version, live) <= 0);
      const unbridged = between.filter(p => p.numericWeaponStatDelta !== false);
      check('advertised bridge is supported by the ledger', unbridged.length === 0,
        `the UI reports ${ns.gameVersion} numbers as current for ${live}, but ${unbridged.map(p => p.version).join(', ')} carry no no-change finding`);
    }
  }
}

const report = {
  generatedAt: new Date().toISOString(),
  describes: 'Cross-checks between the patch ledger, the source overlay and the freshness status. Each record is checked against the others rather than against itself.',
  checks, errors
};
await mkdir('reports/validation', { recursive: true });
await writeFile('reports/validation/provenance-consistency.json', JSON.stringify(report, null, 1));

console.log(`provenance consistency — ${checks.filter(c => c.ok).length}/${checks.length} cross-checks hold`);
for (const c of checks) if (!c.ok) console.log(`  FAIL ${c.name}`);
if (errors.length) {
  console.error('\nFAIL:\n  ' + errors.join('\n  '));
  process.exitCode = 1;
} else {
  console.log('\nPASS: the ledger, the overlay and the freshness status all tell the same story.');
}
