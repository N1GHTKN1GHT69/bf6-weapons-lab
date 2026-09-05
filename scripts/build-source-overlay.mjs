#!/usr/bin/env node
/**
 * Derive the 1.4.2.0 source overlay mechanically from the frozen workbook capture.
 *
 * INPUT   data/sources/sheetonmyface-bf6-workbook.json   (scripts/capture-sheetonmyface.mjs)
 *         data/weapons.json                              (pristine upstream mirror)
 * OUTPUT  data/source-overlays.json                      (the applied change)
 *         reports/patch-delta/sym-1420-delta.json|.csv   (the full audit trail)
 *
 * Nothing here is hand-entered. Every value written to the overlay is read out of
 * the capture; every value it replaces is read out of the mirror. The only
 * hand-authored content is the FIELD MAP (which sheet stat corresponds to which
 * schema path) and the EXCLUSIONS (with reasons), both stated explicitly below so
 * they can be argued with.
 *
 * Usage:  node scripts/build-source-overlay.mjs
 *         node scripts/build-source-overlay.mjs --check   (re-derive; fail if the
 *                                                          committed overlay differs)
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { readPath, contentSha256 } from './source-overlay.mjs';
import { SYM_FIELD_MAP, MIRROR_FIELDS } from './sym-field-map.mjs';

const CAPTURE = 'data/sources/sheetonmyface-bf6-workbook.json';
const OVERLAY_OUT = 'data/source-overlays.json';
const BASE_VERSION = '1.3.3.0';
const NEW_VERSION = '1.4.2.0';

/**
 * The field map, the mirror-duplicate list and the numeric canonicalisation all
 * live in scripts/sym-field-map.mjs so this deriver and the freshness watcher
 * cannot disagree about which source values matter. A watcher blind to a field
 * this script ingests would be worse than no watcher at all.
 */
const MAP = SYM_FIELD_MAP;

const MIRRORS = MIRROR_FIELDS;

/**
 * COMPUTED FIELDS — genuine functions of other primitives.
 * recoilV holds to <1e-9 for all 62 weapons in the current mirror, so it is the
 * upstream feed's own transform, not an approximation of ours.
 */
const COMPUTED = [
  {
    path: 'recoilV',
    dependsOn: ['recoil.ads.amount', 'recoil.ads.amountMult', 'recoil.ads.amountExp'],
    rule: 'recoilV = recoil.ads.amount * recoil.ads.amountMult ^ recoil.ads.amountExp',
    fn: w => readPath(w, 'recoil.ads.amount') * Math.pow(readPath(w, 'recoil.ads.amountMult'), readPath(w, 'recoil.ads.amountExp'))
  }
];

/**
 * EXCLUSIONS — differences that exist in the comparison but must NOT be ingested.
 * Each states the reason. This list is the whole of the hand judgement in this
 * script; everything else is mechanical.
 */
const EXCLUSIONS = [
  {
    match: (weaponId, stat) => weaponId === 'vssm' && stat === 'RoF',
    reason: 'DIFFERENT FIRE-MODE STATE, NOT A PATCH DELTA. The workbook publishes three rates: ' +
      'RoF 799.999, BurstRoF 799.999 and SingleRoF 449.999. Our stored rpm 449.999 is SingleRoF exactly, ' +
      'and the catalog attachment full_auto_vssm ("Folding Stock", 40 pts, setsFireModeAuto) already carries ' +
      'autoRpm 799.999 - the workbook RoF exactly. Both states are therefore already represented. Writing ' +
      'RoF into the base record would make the semi-auto base fire at the full-auto rate and would double-count ' +
      'the conversion. VSSM is the only weapon in the roster whose RoF and SingleRoF differ, which is what makes ' +
      'this discriminable at all. Corroborated independently by the weapon record’s own provenance note ' +
      '("rpm 450 is the in-game semi-auto rate; the datamined table lists 800, which the captures show is the ' +
      'Folding Stock full-auto rate").'
  }
];

/**
 * REPRESENTATION-ONLY THRESHOLD.
 * The workbook stores rounded figures (830.769, 674.999, 44.08160187) where our
 * mirror carries the exact quotient (830.7692307692307, 675, 44.0816018658339).
 * Ingesting those would LOSE precision. A relative difference below 1e-5 is the
 * workbook's display rounding, not a value change: the real deltas found here are
 * all above 0.9%, five orders of magnitude clear of it.
 */
const REPRESENTATION_REL = 1e-5;

const sha256 = contentSha256;
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const rel = (from, to) => (from === 0 ? null : (to - from) / Math.abs(from));

const capture = JSON.parse(await readFile(CAPTURE, 'utf8'));
const captureSha = sha256(await readFile(CAPTURE, 'utf8'));
const weaponsText = await readFile('data/weapons.json', 'utf8');
const weapons = JSON.parse(weaponsText);
const manifest = JSON.parse(await readFile('data/source-manifest.json', 'utf8'));

const live = capture.values[NEW_VERSION];
const archive = capture.values[BASE_VERSION];
if (!live) throw new Error(`capture has no ${NEW_VERSION} values`);
if (!archive) throw new Error(`capture has no ${BASE_VERSION} values`);

const byName = new Map();
for (const w of weapons) { byName.set(norm(w.name), w); byName.set(norm(w.id), w); }
const resolve = sheetName => byName.get(norm(sheetName)) || byName.get(norm(sheetName.replace('/', '')));

// ---------------------------------------------------------------- provenance test
// Before deriving anything, prove the workbook's own history agrees with ours:
// compare the ARCHIVED 1.3.3.0 rows against the mirror over the same field map.
const provenance = { compared: 0, agreed: 0, conflicts: [] };
for (const [sheetName, vals] of Object.entries(archive)) {
  const w = resolve(sheetName);
  if (!w) continue;
  for (const { stat, path } of MAP) {
    const theirs = vals[stat];
    if (typeof theirs !== 'number') continue;
    const ours = readPath(w, path);
    if (typeof ours !== 'number') continue;
    provenance.compared++;
    if (Math.abs(ours - theirs) <= Math.abs(ours) * REPRESENTATION_REL || Math.abs(ours - theirs) < 1e-9) provenance.agreed++;
    else provenance.conflicts.push({ weaponId: w.id, stat, path, ours, sheet: theirs });
  }
}

// ------------------------------------------------------------- sheet-internal delta
// The workbook against ITSELF: 1.3.3.0 archive vs 1.4.2.0 live, every stat, every
// weapon present in both. This is the cleanest possible statement of what the patch
// changed, because both sides come from one publisher with one convention.
const internal = { compared: 0, identical: 0, changes: [] };
for (const [sheetName, oldVals] of Object.entries(archive)) {
  const newVals = live[sheetName];
  if (!newVals) continue;
  for (const stat of capture.statNames) {
    const a = oldVals[stat], b = newVals[stat];
    if (a === undefined || b === undefined) continue;
    internal.compared++;
    if (a === b) { internal.identical++; continue; }
    internal.changes.push({ sheetName, weaponId: resolve(sheetName)?.id ?? null, stat, from: a, to: b, rel: rel(Number(a), Number(b)) });
  }
}
const newWeapons = Object.keys(live).filter(n => !archive[n]);

// ------------------------------------------------------------------- mirror delta
// The mirror against the 1.4.2.0 live tab over the mapped fields. This is what
// actually has to be ingested, and it is a superset of the sheet-internal delta
// because four weapons (EF88, BROD 3, VSSM, Interdictor) postdate the archive.
const rows = [];
for (const [sheetName, vals] of Object.entries(live)) {
  const w = resolve(sheetName);
  if (!w) { rows.push({ sheetName, weaponId: null, verdict: 'NOT_IN_ROSTER' }); continue; }
  for (const { stat, path, combat } of MAP) {
    const sheet = vals[stat];
    if (typeof sheet !== 'number') continue;
    const ours = readPath(w, path);
    if (typeof ours !== 'number') { rows.push({ weaponId: w.id, stat, path, ours: ours ?? null, sheet, verdict: 'NO_BASELINE_VALUE', combat }); continue; }
    if (Math.abs(ours - sheet) < 1e-12) continue;

    const inArchive = archive[sheetName]?.[stat];
    const row = {
      weaponId: w.id, sheetName, stat, path, ours, sheet,
      archive1330: inArchive === undefined ? null : inArchive,
      absChange: sheet - ours, relChange: rel(ours, sheet), combat: !!combat
    };
    const excluded = EXCLUSIONS.find(e => e.match(w.id, stat));
    if (excluded) { row.verdict = 'EXCLUDED'; row.reason = excluded.reason; }
    else if (Math.abs(ours - sheet) <= Math.abs(ours) * REPRESENTATION_REL) {
      row.verdict = 'REPRESENTATION_ONLY';
      row.reason = `The workbook rounds this figure; our mirror carries it exactly. Relative difference ${(row.relChange * 100).toExponential(2)}%, far below the ${REPRESENTATION_REL} display-rounding threshold. Ingesting it would LOSE precision.`;
    } else if (inArchive === undefined) {
      row.verdict = 'INGEST_NO_ARCHIVE_ROW';
      row.reason = 'This weapon has no 1.3.3.0 archive row (it postdates that dump), so the change cannot be shown as a sheet-internal patch delta. It is ingested on the strength of source quality instead: the mirror value is donor-estimated or datamined pre-1.4.2.0, while this is the original publisher’s figure at an explicitly stated 1.4.2.0.';
    } else if (Math.abs(Number(inArchive) - ours) < 1e-9) {
      row.verdict = 'INGEST_PATCH_DELTA';
      row.reason = `The workbook's own 1.3.3.0 archive carries our exact value (${inArchive}) and its 1.4.2.0 tab carries ${sheet}. A single-source before/after: this is the patch change itself.`;
    } else {
      row.verdict = 'REVIEW_BASELINE_DISAGREES';
      row.reason = `The workbook's 1.3.3.0 archive (${inArchive}) disagrees with our mirror (${ours}), so the 1.4.2.0 figure cannot be attributed to this patch. NOT ingested.`;
    }
    rows.push(row);
  }
}

const ingest = rows.filter(r => r.verdict === 'INGEST_PATCH_DELTA' || r.verdict === 'INGEST_NO_ARCHIVE_ROW');

// ------------------------------------------------------- derived + mirror follow-ups
// Apply the direct changes to a scratch copy, then read off what the mirror
// duplicates and the computed fields must become. Deriving them rather than
// declaring them by hand is what stops recoilV drifting out of step with its inputs.
const scratch = JSON.parse(JSON.stringify(weapons));
const scratchById = new Map(scratch.map(w => [w.id, w]));
const writeScratch = (id, path, value) => {
  const w = scratchById.get(id);
  const parts = path.split('.');
  let cur = w;
  for (let i = 0; i < parts.length - 1; i++) {
    const m = /^([A-Za-z0-9_]+)\[(\d+)\]$/.exec(parts[i]);
    cur = m ? cur[m[1]][Number(m[2])] : cur[parts[i]];
  }
  const last = parts[parts.length - 1];
  const lm = /^([A-Za-z0-9_]+)\[(\d+)\]$/.exec(last);
  if (lm) cur[lm[1]][Number(lm[2])] = value; else cur[last] = value;
};
for (const r of ingest) writeScratch(r.weaponId, r.path, r.sheet);

const follow = [];
const touched = new Set(ingest.map(r => r.weaponId));
for (const id of touched) {
  const before = weapons.find(w => w.id === id);
  const after = scratchById.get(id);
  for (const m of MIRRORS) {
    const want = readPath(after, m.of);
    const have = readPath(after, m.path);
    if (typeof want !== 'number' || typeof have !== 'number') continue;
    if (Math.abs(want - have) < 1e-12) continue;
    follow.push({ weaponId: id, path: m.path, from: readPath(before, m.path), to: want, derived: `mirror of ${m.of}`, dependsOn: [m.of] });
    writeScratch(id, m.path, want);
  }
  for (const c of COMPUTED) {
    const want = c.fn(after);
    const have = readPath(after, c.path);
    if (!Number.isFinite(want) || typeof have !== 'number') continue;
    if (Math.abs(want - have) < 1e-12) continue;
    follow.push({ weaponId: id, path: c.path, from: readPath(before, c.path), to: want, derived: c.rule, dependsOn: c.dependsOn });
    writeScratch(id, c.path, want);
  }
}

// ------------------------------------------------------------------- overlay document
const changes = [
  ...ingest.map(r => ({
    weaponId: r.weaponId, path: r.path, from: r.ours, to: r.sheet,
    sourceStat: r.stat, evidence: r.verdict, affectsCombat: r.combat, derived: null
  })),
  ...follow.map(f => ({
    weaponId: f.weaponId, path: f.path, from: f.from, to: f.to,
    sourceStat: null, evidence: 'DERIVED_FROM_INGESTED_PRIMITIVES', affectsCombat: true,
    derived: f.derived, dependsOn: f.dependsOn
  }))
].sort((a, b) => a.weaponId.localeCompare(b.weaponId) || a.path.localeCompare(b.path));

const overlayDoc = {
  schema: 1,
  purpose: 'Versioned, provenance-carrying patches applied on top of the pristine upstream mirror in data/weapons.json. The mirror is never edited; the effective dataset is always reproducible as mirror + ordered overlays. See source-overlay.js.',
  generator: 'scripts/build-source-overlay.mjs',
  baseline: {
    dataset: 'data/weapons.json',
    sha256: sha256(weaponsText),
    mirrorOf: manifest.repository,
    mirrorCommit: manifest.commit,
    representsUpstreamDeclared: BASE_VERSION,
    note: 'The upstream feed declares a 1.3.3.0 baseline; data/patch-delta-ledger.json shows its content window actually reaches 1.4.1.5. Overlays carry it forward from there.'
  },
  overlays: [
    {
      id: 'sym-1.4.2.0',
      order: 1,
      enabled: true,
      gameVersion: NEW_VERSION,
      publisherOfRecord: 'sym.gg',
      carrier: `${capture.source.name} v${capture.source.sheetVersion}`,
      carrierUrl: capture.source.url,
      sourceArtifact: CAPTURE,
      sourceArtifactSha256: captureSha,
      confidence: 'source-verified-current',
      confidenceBasis: [
        `The workbook's archived ${BASE_VERSION} rows agree with our mirror on ${provenance.agreed}/${provenance.compared} mapped field comparisons, so its version labelling is faithful to the dataset we already hold.`,
        `Against itself the workbook changes only ${internal.changes.length} of ${internal.compared} values between ${BASE_VERSION} and ${NEW_VERSION}, so the ${NEW_VERSION} tab is a real refresh and not a re-import with different conventions.`,
        'EA update 1.4.2.0 states "Weapon statistics updates for the EF88, BROD, and VSSM" - the three weapons carrying most of this overlay.',
        'Single source. Not independently corroborated by a second publisher: sym.gg is the only outlet that publishes these primitives at all, and its own public site still stops at ' + BASE_VERSION + '.'
      ],
      changeCount: changes.length,
      weapons: [...new Set(changes.map(c => c.weaponId))].sort(),
      changes,
      excluded: rows.filter(r => r.verdict === 'EXCLUDED' || r.verdict === 'REPRESENTATION_ONLY' || r.verdict === 'REVIEW_BASELINE_DISAGREES' || r.verdict === 'NO_BASELINE_VALUE')
        .map(r => ({ weaponId: r.weaponId, path: r.path, sourceStat: r.stat, ours: r.ours, sheet: r.sheet, verdict: r.verdict, reason: r.reason }))
    }
  ]
};

// ------------------------------------------------------------------------- reports
const report = {
  generatedAt: new Date().toISOString(),
  capture: { file: CAPTURE, sha256: captureSha, sheetVersion: capture.source.sheetVersion, capturedAt: capture.retrieval.capturedAt, endpoints: capture.retrieval.endpoints },
  historicalProvenance: {
    describes: `our mirror vs the workbook's archived ${BASE_VERSION} rows, over the mapped field set`,
    compared: provenance.compared, agreed: provenance.agreed, conflicts: provenance.conflicts
  },
  sheetInternalDelta: {
    describes: `the workbook against itself: archived ${BASE_VERSION} vs live ${NEW_VERSION}, all ${capture.statNames.length} stats, weapons present in both`,
    compared: internal.compared, identical: internal.identical, changed: internal.changes.length, changes: internal.changes,
    weaponsOnlyInNewVersion: newWeapons
  },
  mirrorDelta: {
    describes: `our mirror vs the live ${NEW_VERSION} tab, over the mapped field set`,
    mappedStats: MAP.length,
    rows,
    counts: rows.reduce((a, r) => { a[r.verdict] = (a[r.verdict] || 0) + 1; return a; }, {})
  },
  derivedFollowUps: follow,
  overlayChangeCount: changes.length
};

const csv = ['weaponId,sourceStat,path,from,to,absChange,pctChange,verdict,affectsCombat'];
for (const r of rows) {
  if (!r.path) continue;
  csv.push([r.weaponId, r.stat, r.path, r.ours, r.sheet, r.absChange ?? '', r.relChange == null ? '' : (r.relChange * 100).toFixed(4), r.verdict, r.combat ?? ''].join(','));
}
for (const f of follow) csv.push([f.weaponId, '(derived)', f.path, f.from, f.to, f.to - f.from, f.from ? ((f.to - f.from) / Math.abs(f.from) * 100).toFixed(4) : '', 'DERIVED', 'true'].join(','));

const nextText = JSON.stringify(overlayDoc, null, 1) + '\n';

if (process.argv.includes('--check')) {
  const current = await readFile(OVERLAY_OUT, 'utf8');
  if (current === nextText) {
    console.log(`PASS: ${OVERLAY_OUT} is exactly what the capture re-derives (${changes.length} changes).`);
  } else {
    console.error(`FAIL: ${OVERLAY_OUT} does not match a fresh derivation from ${CAPTURE}.`);
    console.error('Re-run scripts/build-source-overlay.mjs and review the diff.');
    process.exit(1);
  }
} else {
  await mkdir('reports/patch-delta', { recursive: true });
  await writeFile(OVERLAY_OUT, nextText);
  await writeFile('reports/patch-delta/sym-1420-delta.json', JSON.stringify(report, null, 1));
  await writeFile('reports/patch-delta/sym-1420-delta.csv', csv.join('\n') + '\n');
  console.log(`wrote ${OVERLAY_OUT} and reports/patch-delta/sym-1420-delta.json|.csv`);
}

console.log(`\nHISTORICAL PROVENANCE (mirror vs workbook archive ${BASE_VERSION})`);
console.log(`  ${provenance.agreed}/${provenance.compared} agree, ${provenance.conflicts.length} conflicts`);
for (const c of provenance.conflicts.slice(0, 10)) console.log(`    ${c.weaponId} ${c.stat}: ours ${c.ours} vs sheet ${c.sheet}`);

console.log(`\nSHEET-INTERNAL DELTA ${BASE_VERSION} -> ${NEW_VERSION} (all ${capture.statNames.length} stats)`);
console.log(`  ${internal.identical}/${internal.compared} identical, ${internal.changes.length} changed`);
for (const c of internal.changes) console.log(`    ${c.sheetName} ${c.stat}: ${c.from} -> ${c.to}`);
console.log(`  weapons present only at ${NEW_VERSION}: ${newWeapons.join(', ') || '(none)'}`);

console.log(`\nMIRROR DELTA (over ${MAP.length} mapped stats)`);
for (const [k, v] of Object.entries(report.mirrorDelta.counts)) console.log(`  ${k.padEnd(26)} ${v}`);
console.log(`\nOVERLAY: ${changes.length} changes across ${overlayDoc.overlays[0].weapons.join(', ')}`);
console.log(`  direct ${ingest.length}, derived ${follow.length}`);
