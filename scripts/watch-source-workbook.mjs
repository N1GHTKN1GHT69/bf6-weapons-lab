#!/usr/bin/env node
/**
 * Watch the SheetOnMyFace workbook - the carrier of Sym's newest BF6 data.
 *
 * WHY A SECOND WATCHER. scripts/watch-sym-source.mjs watches sym.gg's own public
 * patch-notes chunk. That watcher is correct but STRUCTURALLY INCOMPLETE, and this
 * project proved it the hard way: sym.gg's public site still carries only 1.3.3.0
 * while a 1.4.2.0 Sym dump had been publicly available in this workbook for weeks.
 * Watching only the publisher's own site can never see data the publisher
 * distributes through another channel. Both watchers now run; neither is alone.
 *
 * WHAT MAKES THIS CHEAP AND QUIET. It fetches ONE tab (~50KB) and fingerprints
 * only the ~66 stats that can actually reach a combat number (scripts/sym-field-map.mjs),
 * canonicalised to 9 significant digits. So it does NOT fire on:
 *   - a recalculated timestamp or a formatting change
 *   - a new chart tab, renamed column, or edit to any other sheet
 *   - float noise from an unrelated spreadsheet recalculation
 *   - changes to stats this project does not model
 * It DOES fire on a new Version string, or on any modelled value moving.
 *
 * EXIT CODES, chosen so CI can wire it to a notification:
 *   0  nothing to do, OR the source was unreachable (a third party being down is
 *      not a defect in this repository, and must never fail the build or be
 *      mistaken for a new patch)
 *   1  GOOD NEWS: a newer version, or a modelled value changed. Re-capture and
 *      re-derive the overlay.
 *
 * Usage:  node scripts/watch-source-workbook.mjs
 *         node scripts/watch-source-workbook.mjs --write   (record the new state)
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { TABS, csvUrl, parseCSV, readSymTab } from './capture-sheetonmyface.mjs';
import { SYM_COMBAT_STATS, canonicalNumber } from './sym-field-map.mjs';

const STATE = 'data/sources/workbook-watch-state.json';
const CAPTURE = 'data/sources/sheetonmyface-bf6-workbook.json';

/**
 * Hash of every modelled stat for every weapon, in a deterministic order, with
 * each number canonicalised. Two workbooks with the same combat content produce
 * the same digest no matter how the sheet is formatted or ordered.
 */
export function combatFingerprint(valuesByWeapon) {
  const lines = [];
  for (const weapon of Object.keys(valuesByWeapon).sort()) {
    for (const stat of SYM_COMBAT_STATS) {
      const raw = valuesByWeapon[weapon][stat];
      if (raw === undefined || raw === null || raw === '') continue;
      const c = canonicalNumber(raw);
      lines.push(`${weapon}\t${stat}\t${c === null ? String(raw) : c}`);
    }
  }
  return { digest: createHash('sha256').update(lines.join('\n')).digest('hex'), fields: lines.length, lines };
}

/**
 * Returns the process exit code: 0 = nothing to do or source unreachable,
 * 1 = a newer version or a modelled value moved.
 *
 * Every exit is a RETURN, never process.exit(): forcing exit while the fetch
 * connection is still tearing down aborts the Node process on Windows.
 */
async function main() {
  const cmpVersion = (a, b) => {
    const A = String(a).split('.').map(Number), B = String(b).split('.').map(Number);
    for (let i = 0; i < 4; i++) { if ((A[i] ?? 0) !== (B[i] ?? 0)) return (A[i] ?? 0) - (B[i] ?? 0); }
    return 0;
  };

  let state;
  try { state = JSON.parse(await readFile(STATE, 'utf8')); }
  catch {
    // First run: seed the state from the committed capture so the very first check
    // compares against what the repository actually ingested, not against nothing.
    const capture = JSON.parse(await readFile(CAPTURE, 'utf8'));
    const version = Object.keys(capture.values).filter(v => capture.tabs['Sym.gg Data'].gameVersions.includes(v))[0];
    state = {
      schema: 1,
      purpose: 'Watch state for the SheetOnMyFace workbook, the public carrier of Sym\'s newest BF6 data. See scripts/watch-source-workbook.mjs.',
      workbookUrl: capture.source.url,
      knownSheetVersion: capture.source.sheetVersion,
      knownGameVersion: version,
      combatFingerprint: combatFingerprint(capture.values[version]).digest,
      combatFields: combatFingerprint(capture.values[version]).fields,
      lastCheckedAt: null
    };
  }

  let body;
  try {
    const res = await fetch(csvUrl(TABS.live), { redirect: 'follow' });
    if (!res.ok) {
      console.log(`workbook watch: unexpected HTTP ${res.status}. Treating as inconclusive, not a defect.`);
      return 0;
    }
    body = await res.text();
  } catch (err) {
    console.log(`workbook watch: unreachable (${String(err.message || err)}). An unreachable third party is not a repository defect; exiting cleanly.`);
    return 0;
  }

  let tab;
  try {
    tab = readSymTab(parseCSV(body));
  } catch (err) {
    console.log(`workbook watch: the live tab no longer parses as the expected transposed layout (${String(err.message || err)}).`);
    console.log('Treating as inconclusive rather than as a data change. Inspect the workbook manually.');
    return 0;
  }

  if (tab.versions.length !== 1) {
    console.log(`workbook watch: the live tab now carries ${tab.versions.length} versions (${tab.versions.join(', ')}) instead of one.`);
    console.log('That is a structural change, not a value change. Inspect before ingesting.');
    return 1;
  }

  const version = tab.versions[0];
  const fp = combatFingerprint(tab.values[version]);

  console.log(`workbook watch: ${csvUrl(TABS.live)}`);
  console.log(`  HTTP 200, ${body.length} bytes, ${tab.weapons.length} weapons, ${tab.statRows} stat rows`);
  console.log(`  live game version : ${version}   (known ${state.knownGameVersion})`);
  console.log(`  combat fingerprint: ${fp.digest.slice(0, 16)}... over ${fp.fields} modelled values   (known ${String(state.combatFingerprint).slice(0, 16)}...)`);

  const versionMoved = cmpVersion(version, state.knownGameVersion) > 0;
  const versionChanged = version !== state.knownGameVersion;
  const valuesChanged = fp.digest !== state.combatFingerprint;

  if (!versionChanged && !valuesChanged) {
    console.log('\nPASS: unchanged. No modelled value moved and the version is the same. No rebuild warranted.');
    if (process.argv.includes('--write')) {
      state.lastCheckedAt = new Date().toISOString();
      await writeFile(STATE, JSON.stringify(state, null, 1) + '\n');
    }
    return 0;
  }

  // Something moved. Say exactly what, so the follow-up is a decision and not a hunt.
  if (versionChanged) {
    console.log(`\n*** WORKBOOK GAME VERSION ${versionMoved ? 'ADVANCED' : 'CHANGED'}: ${state.knownGameVersion} -> ${version} ***`);
  }
  if (valuesChanged) {
    console.log('\n*** MODELLED VALUES CHANGED ***');
    const capture = JSON.parse(await readFile(CAPTURE, 'utf8')).values[state.knownGameVersion] ?? {};
    const changed = [];
    for (const weapon of Object.keys(tab.values[version]).sort()) {
      for (const stat of SYM_COMBAT_STATS) {
        const now = canonicalNumber(tab.values[version][weapon]?.[stat]);
        const was = canonicalNumber(capture[weapon]?.[stat]);
        if (now === was) continue;
        changed.push(`${weapon} ${stat}: ${was ?? '(absent)'} -> ${now ?? '(absent)'}`);
      }
    }
    console.log(`  ${changed.length} modelled value(s) differ from the committed capture:`);
    for (const c of changed.slice(0, 40)) console.log(`    ${c}`);
    if (changed.length > 40) console.log(`    ... and ${changed.length - 40} more`);
  }

  console.log('\nNEXT STEPS (nothing is ingested automatically):');
  console.log('  1. node scripts/capture-sheetonmyface.mjs      re-freeze the source');
  console.log('  2. node scripts/build-source-overlay.mjs        re-derive the overlay mechanically');
  console.log('  3. node scripts/audit-source-overlay.mjs        re-gate it (incl. the VSSM two-state check)');
  console.log('  4. rerun the Combat Engine so the cache matches the new effective dataset');

  if (process.argv.includes('--write')) {
    state.knownGameVersion = version;
    state.combatFingerprint = fp.digest;
    state.combatFields = fp.fields;
    state.lastCheckedAt = new Date().toISOString();
    await writeFile(STATE, JSON.stringify(state, null, 1) + '\n');
    console.log(`\nRecorded the new state in ${STATE} (--write).`);
  }
  return 1;

}

// Only reach for the network when run as a command. scripts/audit-freshness-watchers.mjs
// imports combatFingerprint from here to test it offline, and a gate must never
// depend on a third party being up.
if ((process.argv[1] ?? '').replace(/\\/g, '/').endsWith('watch-source-workbook.mjs')) {
  process.exitCode = await main();
}
