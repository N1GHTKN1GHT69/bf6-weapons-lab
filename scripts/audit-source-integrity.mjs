#!/usr/bin/env node
/**
 * Verify the pinned source snapshot against its own recorded hashes.
 *
 * WHY THIS GATE EXISTS. data/source-manifest.json has always recorded a SHA-256 for
 * each mirrored upstream file. Nothing ever checked them. Mutation testing made the
 * consequence concrete: editing an attachment's point cost, granting a weapon a slot it
 * has no compatibility for, and promoting a wholly-assumed attachment to verified ALL
 * survived the entire 30-gate suite. Every one of those is a single-byte edit to
 * data/attachments.json, and every one would have been caught by comparing the file to
 * the hash sitting beside it.
 *
 * validate-combat-cache.mjs compares the upstream COMMIT, which proves which revision
 * was checked out - not that the files still hold that revision's contents. This closes
 * the difference.
 *
 * WHY IT MATTERS BEYOND TIDINESS. These four files are the entire factual basis of the
 * product. They are declared to be a byte-identical mirror of upstream, and several
 * other gates reason from that assumption: the source overlay's baseline check, the
 * cache/source identity check, and the coverage audit all trust that the mirror is what
 * the manifest says it is. An unverified mirror makes those checks conditional on
 * something nobody was testing.
 *
 * LINE ENDINGS. The manifest hashes are produced on Linux (LF). A Windows checkout can
 * hold CRLF for the same committed content, so comparison is LF-normalised - the same
 * rule scripts/source-overlay.mjs uses for the overlay baseline. Hashing raw bytes
 * would fail on exactly one of the two platforms and teach everyone to ignore it.
 *
 * Usage: node scripts/audit-source-integrity.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { contentSha256 } from './source-overlay.mjs';

const manifest = JSON.parse(await readFile('data/source-manifest.json', 'utf8'));
const errors = [];
const checked = [];

const recorded = manifest.sha256 ?? {};
if (!Object.keys(recorded).length) errors.push('data/source-manifest.json records no file hashes at all');

for (const [name, expected] of Object.entries(recorded)) {
  let text;
  try { text = await readFile(`data/${name}`, 'utf8'); }
  catch { errors.push(`${name}: recorded in the manifest but missing from data/`); continue; }
  const actual = contentSha256(text);
  checked.push({ file: `data/${name}`, expected, actual, match: actual === expected });
  if (actual !== expected) {
    errors.push(`data/${name} does not match its recorded hash.\n      manifest: ${expected}\n      actual:   ${actual}\n      Either the file was edited by hand - the mirror must stay byte-identical to upstream, so newer values belong in data/source-overlays.json - or the snapshot was re-synced without regenerating the manifest.`);
  }
}

// The manifest must cover every mirrored file, or a file could be edited freely simply
// by never having been listed.
const MIRRORED = ['weapons.json', 'attachments.json', 'ammo.json', 'ballistics.json'];
for (const name of MIRRORED) {
  if (!(name in recorded)) errors.push(`data/${name} is a mirrored upstream file but carries no hash in the manifest, so nothing constrains its contents`);
}

// Declared counts must match the data, so a truncated or extended roster is visible
// even if someone regenerated the hashes.
try {
  const weapons = JSON.parse(await readFile('data/weapons.json', 'utf8'));
  if (Number.isInteger(manifest.counts?.weapons) && weapons.length !== manifest.counts.weapons) {
    errors.push(`data/weapons.json holds ${weapons.length} weapons but the manifest declares ${manifest.counts.weapons}`);
  }
  const ballistics = JSON.parse(await readFile('data/ballistics.json', 'utf8'));
  const ids = (ballistics.weaponIds ?? []).length;
  if (Number.isInteger(manifest.counts?.ballisticsWeaponIds) && ids !== manifest.counts.ballisticsWeaponIds) {
    errors.push(`data/ballistics.json lists ${ids} verified-ballistics weapons but the manifest declares ${manifest.counts.ballisticsWeaponIds}`);
  }
} catch (e) {
  errors.push(`could not read a mirrored file for the count check: ${String(e.message || e)}`);
}

const report = {
  generatedAt: new Date().toISOString(),
  manifestGeneratedAt: manifest.generatedAt ?? null,
  upstream: { repository: manifest.repository ?? null, commit: manifest.commit ?? null },
  hashRule: 'SHA-256 over LF-normalised file text, matching how scripts/sync-from-upstream.mjs produces the manifest on Linux.',
  filesChecked: checked.length,
  files: checked,
  errors
};
await mkdir('reports/validation', { recursive: true });
await writeFile('reports/validation/source-integrity.json', JSON.stringify(report, null, 1));

console.log(`source integrity — ${checked.length} mirrored files against data/source-manifest.json (upstream ${String(manifest.commit).slice(0, 8)})`);
for (const c of checked) console.log(`  ${c.match ? 'ok  ' : 'FAIL'} ${c.file.padEnd(26)} ${c.actual.slice(0, 16)}...`);
if (errors.length) {
  console.error('\nFAIL:\n  ' + errors.join('\n  '));
  process.exitCode = 1;
} else {
  console.log('\nPASS: every mirrored source file matches the hash recorded beside it.');
}
