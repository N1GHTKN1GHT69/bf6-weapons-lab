#!/usr/bin/env node
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = await mkdtemp(join(tmpdir(), 'bf6-freshness-'));
const statusPath = join(root, 'freshness-status.json');
const manifestPath = join(root, 'source-manifest.json');
const listingPath = join(root, 'listing.html');
const articlePath = join(root, 'article.html');
const cachePath = join(root, 'combat-cache.json');
const errors = [];

const baseStatus = {
  schema: 1,
  official: { gameVersion: '1.4.2.5', publishedDate: '2026-08-31', url: 'old' },
  verified: { gameVersion: '1.4.2.5', verifiedAt: '2026-09-02T00:00:00Z', upstreamCommit: 'aaa', basis: 'test' },
  upstream: { verifiedCommit: 'aaa' }, state: 'verified', combatImpact: 'verified-current', matchedTerms: [], pending: null
};
await writeFile(statusPath, JSON.stringify(baseStatus));
await writeFile(manifestPath, JSON.stringify({ commit: 'aaa' }));
await writeFile(listingPath, '<a href="/games/battlefield/battlefield-6/news/battlefield-6-game-update-1-4-3-0">BATTLEFIELD 6 GAME UPDATE 1.4.3.0</a>');
await writeFile(articlePath, '<main><h1>BATTLEFIELD 6 GAME UPDATE 1.4.3.0</h1><p>September 15, 2026</p><h2>WEAPONS</h2><p>Attachment damage behavior adjusted.</p></main>');

function run(env, args = ['--write']) {
  const r = spawnSync(process.execPath, [resolve('scripts/check-freshness.mjs'), ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
  if (r.status !== 0) errors.push(`check-freshness exited ${r.status}: ${r.stderr || r.stdout}`);
  return r;
}
run({ BF6_FRESHNESS_STATUS: statusPath, BF6_SOURCE_MANIFEST: manifestPath, BF6_EA_LISTING_FILE: listingPath, BF6_EA_ARTICLE_FILE: articlePath, UPSTREAM_SHA: 'bbb', BF6_UPSTREAM_DATA_CHANGED: 'true' });
let s = JSON.parse(await readFile(statusPath, 'utf8'));
if (s.official?.gameVersion !== '1.4.3.0') errors.push('failed to detect newer EA version');
if (s.state !== 'verification-pending') errors.push(`combat-relevant update should be verification-pending, got ${s.state}`);
if (s.pending?.upstreamCommit !== 'bbb') errors.push('new upstream SHA was not recorded as pending');

// A repeat with the same pending SHA must not immediately request another expensive rebuild.
const outPath = join(root, 'gh-output.txt');
run({ BF6_FRESHNESS_STATUS: statusPath, BF6_SOURCE_MANIFEST: manifestPath, BF6_EA_LISTING_FILE: listingPath, BF6_EA_ARTICLE_FILE: articlePath, UPSTREAM_SHA: 'bbb', BF6_UPSTREAM_DATA_CHANGED: 'true', GITHUB_OUTPUT: outPath, BF6_REBUILD_RETRY_HOURS: '6' });
const out = await readFile(outPath, 'utf8');
if (!/needs_rebuild=false/.test(out)) errors.push('same pending upstream SHA should suppress duplicate rebuild within retry window');

// Promotion must fail closed while the official combat-relevant version is ahead of the cache model.
await writeFile(cachePath, JSON.stringify({ audit: { pass: true }, source: { gameVersion: '1.4.2.5', commit: 'bbb' } }));
await writeFile(manifestPath, JSON.stringify({ commit: 'bbb' }));
const promote = spawnSync(process.execPath, [resolve('scripts/promote-freshness.mjs')], {
  encoding: 'utf8', env: { ...process.env, BF6_FRESHNESS_STATUS: statusPath, BF6_SOURCE_MANIFEST: manifestPath, BF6_COMBAT_CACHE: cachePath }
});
if (promote.status === 0) errors.push('promotion should fail when official combat-relevant version is ahead of verified cache');

// A newer official patch with no combat-relevant changelog entries should not
// force an expensive rebuild or falsely mark the last verified combat model bad.
const quietStatusPath = join(root, 'freshness-quiet.json');
const quietListingPath = join(root, 'listing-quiet.html');
const quietArticlePath = join(root, 'article-quiet.html');
await writeFile(quietStatusPath, JSON.stringify(baseStatus));
await writeFile(manifestPath, JSON.stringify({ commit: 'aaa' }));
await writeFile(quietListingPath, '<a href="/games/battlefield/battlefield-6/news/battlefield-6-game-update-1-4-3-1">BATTLEFIELD 6 GAME UPDATE 1.4.3.1</a>');
await writeFile(quietArticlePath, '<main><h1>BATTLEFIELD 6 GAME UPDATE 1.4.3.1</h1><p>September 16, 2026</p><h2>CHANGELOG</h2><h3>UI & HUD</h3><p>Fixed a menu icon.</p><h3>STABILITY</h3><p>Improved server stability.</p></main>');
run({ BF6_FRESHNESS_STATUS: quietStatusPath, BF6_SOURCE_MANIFEST: manifestPath, BF6_EA_LISTING_FILE: quietListingPath, BF6_EA_ARTICLE_FILE: quietArticlePath, UPSTREAM_SHA: 'aaa', BF6_UPSTREAM_DATA_CHANGED: 'false' });
const quiet = JSON.parse(await readFile(quietStatusPath, 'utf8'));
if (quiet.state !== 'current-no-combat-change-detected') errors.push(`non-combat patch should carry combat model forward without rebuild, got ${quiet.state}`);
if (quiet.pending) errors.push('non-combat patch should not create a pending source rebuild');

// A docs-only analyzer commit must not launch the 62-weapon exhaustive rebuild.
const docsStatusPath = join(root, 'freshness-docs.json');
const docsOutPath = join(root, 'gh-output-docs.txt');
await writeFile(docsStatusPath, JSON.stringify(baseStatus));
await writeFile(listingPath, '<a href="/games/battlefield/battlefield-6/news/battlefield-6-game-update-1-4-2-5">BATTLEFIELD 6 GAME UPDATE 1.4.2.5</a>');
await writeFile(articlePath, '<main><h1>BATTLEFIELD 6 GAME UPDATE 1.4.2.5</h1><p>August 31, 2026</p><h2>CHANGELOG</h2><h3>WEAPONS</h3><p>Match Trigger behavior.</p></main>');
run({ BF6_FRESHNESS_STATUS: docsStatusPath, BF6_SOURCE_MANIFEST: manifestPath, BF6_EA_LISTING_FILE: listingPath, BF6_EA_ARTICLE_FILE: articlePath, UPSTREAM_SHA: 'docs-only-new-sha', BF6_UPSTREAM_DATA_CHANGED: 'false', GITHUB_OUTPUT: docsOutPath });
const docsOut = await readFile(docsOutPath, 'utf8');
if (!/needs_rebuild=false/.test(docsOut)) errors.push('docs-only analyzer commit should not trigger exhaustive rebuild');

// Bootstrap the current article fingerprint without downgrading an already
// verified model, then prove an in-place revision of the same EA version is detected.
const reviseStatusPath = join(root, 'freshness-revise.json');
const reviseOutPath = join(root, 'gh-output-revise.txt');
await writeFile(reviseStatusPath, JSON.stringify(baseStatus));
run({ BF6_FRESHNESS_STATUS: reviseStatusPath, BF6_SOURCE_MANIFEST: manifestPath, BF6_EA_LISTING_FILE: listingPath, BF6_EA_ARTICLE_FILE: articlePath, UPSTREAM_SHA: 'aaa', BF6_UPSTREAM_DATA_CHANGED: 'false' });
let revised = JSON.parse(await readFile(reviseStatusPath, 'utf8'));
if (revised.state !== 'verified' || !revised.official?.contentHash) errors.push('current article hash bootstrap should preserve verified state');
await writeFile(articlePath, '<main><h1>BATTLEFIELD 6 GAME UPDATE 1.4.2.5</h1><p>August 31, 2026</p><h2>CHANGELOG</h2><h3>WEAPONS</h3><p>Match Trigger behavior.</p><p>Damage changed for a weapon.</p></main>');
run({ BF6_FRESHNESS_STATUS: reviseStatusPath, BF6_SOURCE_MANIFEST: manifestPath, BF6_EA_LISTING_FILE: listingPath, BF6_EA_ARTICLE_FILE: articlePath, UPSTREAM_SHA: 'aaa', BF6_UPSTREAM_DATA_CHANGED: 'false', GITHUB_OUTPUT: reviseOutPath });
revised = JSON.parse(await readFile(reviseStatusPath, 'utf8'));
if (revised.state !== 'verification-pending') errors.push(`same-version EA changelog revision should become verification-pending, got ${revised.state}`);
const reviseOut = await readFile(reviseOutPath, 'utf8');
if (!/article_revision_changed=true/.test(reviseOut)) errors.push('same-version EA changelog revision was not surfaced');

if (errors.length) {
  console.error('FRESHNESS AUDIT FAILED');
  for (const e of errors) console.error('-', e);
  await rm(root, { recursive: true, force: true });
  process.exit(1);
}
console.log('FRESHNESS AUDIT PASS • combat/non-combat patches • same-version EA revisions • docs-only source commits • duplicate rebuild suppression • stale promotion fails closed');
await rm(root, { recursive: true, force: true });
