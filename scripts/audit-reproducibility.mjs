#!/usr/bin/env node
/**
 * REPRODUCIBILITY — separate what the pipeline actually decided from when it ran.
 *
 * Every generated artifact in this repository is stamped with a `generatedAt`, so a
 * plain `git diff` after any gate run shows dozens of "changed" files that decided
 * nothing. That noise is not cosmetic: it is the reason a real result change can pass
 * unnoticed in a diff, and it is why .gitattributes already exists to stop line-ending
 * churn from doing the same thing.
 *
 * This computes a SEMANTIC HASH of each artifact - its content with the known
 * nondeterministic metadata stripped - and pins it. Regenerating an artifact must then
 * either reproduce the semantic hash exactly, or show a diff that is genuinely about
 * results.
 *
 * WHAT COUNTS AS NONDETERMINISTIC, and why each is allowed:
 *   generatedAt / reconciledAt / verifiedAt / capturedAt / lastCheckedAt / detectedAt
 *     wall-clock stamps recording WHEN a deterministic computation ran.
 *   retrieval.capturedAt
 *     when a third-party source was fetched.
 * Nothing else is exempt. A value that varies between runs for any other reason is a
 * reproducibility defect, not noise to be filtered.
 *
 * WHAT THIS DOES NOT CLAIM. It does not re-run the pipeline; that is what
 * `build-source-overlay.mjs --check`, `capture-sheetonmyface.mjs --verify` and the
 * Combat Engine's own rebuild do. This makes the RESULT of those reproductions
 * comparable across machines and sessions by removing the one thing that legitimately
 * differs.
 *
 * Usage:
 *   node scripts/audit-reproducibility.mjs
 *   node scripts/audit-reproducibility.mjs --write   record the current semantic hashes
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const PIN = 'data/reproducibility-pin.json';

/** Artifacts whose semantic content must be reproducible. */
const ARTIFACTS = [
  { file: 'data/source-overlays.json', producedBy: 'scripts/build-source-overlay.mjs', reproducedBy: 'node scripts/build-source-overlay.mjs --check' },
  { file: 'data/ranking-policy.json', producedBy: 'scripts/audit-ranking-policy-pin.mjs --write', reproducedBy: 'node scripts/audit-ranking-policy-pin.mjs' },
  { file: 'data/sources/sheetonmyface-bf6-workbook.json', producedBy: 'scripts/capture-sheetonmyface.mjs', reproducedBy: 'node scripts/capture-sheetonmyface.mjs --verify (requires network)' },
  { file: 'data/sources/workbook-watch-state.json', producedBy: 'scripts/watch-source-workbook.mjs --write', reproducedBy: 'node scripts/audit-freshness-watchers.mjs' },
  { file: 'data/combat-cache.json', producedBy: 'scripts/build-combat-cache.mjs (62-job matrix)', reproducedBy: 'node scripts/audit-cache-recompute.mjs' },
  { file: 'data/source-manifest.json', producedBy: 'scripts/sync-from-upstream.mjs', reproducedBy: 'node scripts/audit-source-integrity.mjs' },
  { file: 'data/patch-delta-ledger.json', producedBy: 'hand-authored, machine-checked', reproducedBy: 'node scripts/audit-provenance-consistency.mjs' },
  { file: 'data/freshness-status.json', producedBy: 'scripts/reconcile-patches.mjs --write', reproducedBy: 'node scripts/reconcile-patches.mjs --check' }
];

/**
 * Keys stripped before hashing, with the reason each is legitimately variable.
 *
 * `contentHash` needs justifying, because exempting a hash looks like exempting exactly
 * the thing this gate exists to watch. It is the SHA-256 of EA's patch-notes page body,
 * and it is an EXTERNAL OBSERVATION rather than something this pipeline decided - the
 * same category as a timestamp. Measured: the normalised body is byte-stable across
 * repeated fetches in one session (4/4 identical), but oscillates between two values
 * across CDN edges over days, which produced bot commits and a semantic-drift failure
 * with no BF6 change behind it.
 *
 * What still catches a REAL EA change is untouched: `official.gameVersion` is parsed
 * from the update listing, and `combatImpact` / `matchedTerms` are classified from the
 * article text. All three stay in the hash. A new patch moves them; a re-rendered page
 * does not. Exempting the page hash removes the false alarm without removing the alarm.
 */
const NONDETERMINISTIC = new Set([
  'generatedAt', 'reconciledAt', 'verifiedAt', 'capturedAt', 'lastCheckedAt',
  'detectedAt', 'checkedAt', 'ranAt', 'modelVerifiedAt', 'manifestGeneratedAt', 'cacheGeneratedAt',
  'contentHash'
]);

/**
 * Content hash with timestamps removed, recursively. Object keys are sorted so that a
 * re-serialisation in a different key order is not mistaken for a content change.
 */
function semanticHash(value) {
  const strip = v => {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      const out = {};
      for (const k of Object.keys(v).sort()) {
        if (NONDETERMINISTIC.has(k)) continue;
        out[k] = strip(v[k]);
      }
      return out;
    }
    return v;
  };
  return createHash('sha256').update(JSON.stringify(strip(value))).digest('hex');
}

const errors = [];
const current = {};
for (const a of ARTIFACTS) {
  let text;
  try { text = await readFile(a.file, 'utf8'); }
  catch { errors.push(`${a.file}: missing`); continue; }
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (e) { errors.push(`${a.file}: not valid JSON (${e.message})`); continue; }
  current[a.file] = {
    semanticHash: semanticHash(parsed),
    bytes: Buffer.byteLength(text),
    producedBy: a.producedBy,
    reproducedBy: a.reproducedBy
  };
}

const doc = {
  schema: 1,
  purpose: 'Semantic hashes of every generated artifact, with wall-clock timestamps stripped, so a re-run on another machine can be compared on what it DECIDED rather than on when it ran.',
  nondeterministicKeysStripped: [...NONDETERMINISTIC].sort(),
  artifacts: current
};

if (process.argv.includes('--write')) {
  await writeFile(PIN, JSON.stringify(doc, null, 1) + '\n');
  console.log(`wrote ${PIN} — ${Object.keys(current).length} artifacts`);
  process.exit(errors.length ? 1 : 0);
}

let pinned = null;
try { pinned = JSON.parse(await readFile(PIN, 'utf8')); }
catch { errors.push(`${PIN} is missing. Run: node scripts/audit-reproducibility.mjs --write`); }

const drift = [];
if (pinned) {
  for (const [file, cur] of Object.entries(current)) {
    const was = pinned.artifacts?.[file];
    if (!was) { drift.push(`${file}: newly generated, not in the pin`); continue; }
    if (was.semanticHash !== cur.semanticHash) {
      drift.push(`${file}: semantic content changed (${was.semanticHash.slice(0, 12)}... -> ${cur.semanticHash.slice(0, 12)}...) — this is a RESULT change, not timestamp noise`);
    }
  }
  for (const file of Object.keys(pinned.artifacts ?? {})) {
    if (!current[file]) drift.push(`${file}: pinned but no longer present`);
  }
}

await mkdir('reports/validation', { recursive: true });
await writeFile('reports/validation/reproducibility.json', JSON.stringify({
  generatedAt: new Date().toISOString(), current: doc, drift, errors
}, null, 1));

console.log(`reproducibility — ${Object.keys(current).length} generated artifacts, timestamps excluded from the hash`);
for (const [file, c] of Object.entries(current)) {
  const same = pinned?.artifacts?.[file]?.semanticHash === c.semanticHash;
  console.log(`  ${pinned ? (same ? 'same ' : 'MOVED') : '  -  '} ${file.padEnd(46)} ${c.semanticHash.slice(0, 16)}...`);
}
if (drift.length) {
  console.error('\nSEMANTIC DRIFT — these artifacts decided something different:\n  ' + drift.join('\n  '));
  console.error('\nIf the change is intended, re-pin with: node scripts/audit-reproducibility.mjs --write');
}
if (errors.length) console.error('\nERRORS:\n  ' + errors.join('\n  '));
if (errors.length || drift.length) process.exitCode = 1;
else console.log('\nPASS: every generated artifact is semantically identical to its pin.');
