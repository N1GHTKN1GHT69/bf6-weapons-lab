#!/usr/bin/env node
/**
 * Watch Sym.gg for a newer BF6 dataset.
 *
 * Sym is the upstream publisher of the numbers this project ingests, and their
 * BF6 data currently stops at 1.3.3.0. When they publish a 1.4.x patch-notes
 * page, every one of our outstanding high-impact values becomes resolvable from
 * a published source - so knowing the moment that happens is worth automating.
 *
 * How, without a browser: sym.gg is a client-rendered SPA, but the route chunk
 * carrying the BF6 patch-notes payload is a plain static asset, and Vite content-
 * hashes its filename. So a single HTTP GET tells us three things at once:
 *
 *   200 + same content hash -> unchanged, nothing to do
 *   200 + different hash    -> chunk rebuilt, re-read the versions inside it
 *   404                     -> filename changed, i.e. the chunk was rebuilt;
 *                              rediscover it (see REDISCOVERY below)
 *
 * The chunk also embeds the patch version strings it documents, so a newer
 * version appearing inside it is direct evidence Sym has published new data.
 *
 * REDISCOVERY (only needed on a 404): load https://sym.gg/games/bf6/patch-notes
 * in a browser and run, in the console:
 *   performance.getEntriesByType('resource').filter(r=>/\.js$/.test(r.name))
 * then fetch each and keep the one containing "ADSRecoilAmount".
 *
 * Never fails the build on a network problem - an unreachable third party is not
 * a defect in this repository. It exits non-zero ONLY on the good news case, so
 * it can be wired to notify.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const STATE = 'data/sources/sym-watch-state.json';
const state = JSON.parse(await readFile(STATE, 'utf8'));

const url = state.chunkUrl;
let res, body;
try {
  res = await fetch(url, { redirect: 'follow' });
  body = res.ok ? await res.text() : null;
} catch (err) {
  console.log(`sym watch: network unreachable (${String(err.message || err)}). Not a repository defect; exiting cleanly.`);
  process.exit(0);
}

if (res.status === 404) {
  console.log(`sym watch: CHUNK FILENAME CHANGED (404 on ${url}).`);
  console.log('Sym rebuilt the BF6 patch-notes chunk, which usually means new content.');
  console.log('Rediscover the chunk (see REDISCOVERY in this file), then re-capture into data/sources/.');
  process.exit(1);
}
if (!res.ok || !body) {
  console.log(`sym watch: unexpected HTTP ${res.status}. Treating as inconclusive, not a defect.`);
  process.exit(0);
}

const sha = createHash('sha256').update(body).digest('hex');
const versions = [...new Set(body.match(/\b1\.\d+\.\d+\.\d+\b/g) ?? [])].sort();

const cmp = (a, b) => {
  const A = a.split('.').map(Number), B = b.split('.').map(Number);
  for (let i = 0; i < 4; i++) { if ((A[i] ?? 0) !== (B[i] ?? 0)) return (A[i] ?? 0) - (B[i] ?? 0); }
  return 0;
};
const newer = versions.filter(v => cmp(v, state.knownLatestVersion) > 0);

console.log(`sym watch: ${url}`);
console.log(`  HTTP 200, ${body.length} bytes, sha256 ${sha.slice(0, 16)}...`);
console.log(`  versions embedded: ${versions.join(', ') || '(none found)'}`);
console.log(`  known latest     : ${state.knownLatestVersion}`);

if (newer.length) {
  console.log(`\n*** SYM HAS PUBLISHED NEWER BF6 DATA: ${newer.join(', ')} ***`);
  console.log('Re-capture the patch-notes page into data/sources/sym-bf6-<version>.json,');
  console.log('repoint SOURCE in scripts/audit-source-reconciliation.mjs, and re-run it.');
  console.log('That would resolve the outstanding high-impact recoil/spread values from a');
  console.log('published source, with no gameplay capture required.');
  process.exit(1);
}

if (sha !== state.chunkSha256) {
  console.log('\nsym watch: chunk CONTENT changed but no newer version string found.');
  console.log('Possibly a cosmetic rebuild. Worth a look, but not necessarily new data.');
  if (process.argv.includes('--write')) {
    state.chunkSha256 = sha; state.lastCheckedAt = new Date().toISOString();
    await writeFile(STATE, JSON.stringify(state, null, 1) + '\n');
    console.log('Recorded the new hash (--write).');
  }
  process.exit(0);
}

console.log('\nPASS: unchanged. Sym still publishes nothing newer than ' + state.knownLatestVersion + ' for BF6.');
