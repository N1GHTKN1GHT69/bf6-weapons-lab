#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const statusPath = resolve(process.env.BF6_FRESHNESS_STATUS || 'data/freshness-status.json');
const cachePath = resolve(process.env.BF6_COMBAT_CACHE || 'data/combat-cache.json');
const manifestPath = resolve(process.env.BF6_SOURCE_MANIFEST || 'data/source-manifest.json');
const read = async p => JSON.parse(await readFile(p, 'utf8'));
const status = await read(statusPath);
const cache = await read(cachePath);
const manifest = await read(manifestPath);
if (cache?.audit?.pass !== true) throw new Error('cannot promote freshness: combat cache is not passing');
if (!cache?.source?.gameVersion) throw new Error('cannot promote freshness: cache gameVersion missing');
if (!cache?.source?.commit || cache.source.commit !== manifest?.commit) throw new Error('cannot promote freshness: cache/source-manifest upstream commit mismatch');
const officialVersion = status?.official?.gameVersion || null;
const cacheVersion = cache?.source?.gameVersion || null;
const impact = status?.combatImpact || 'unknown';
if (officialVersion && cacheVersion && officialVersion !== cacheVersion && impact !== 'no-combat-change-detected') {
  throw new Error(`cannot promote freshness: official BF6 ${officialVersion} is newer/different from verified combat model ${cacheVersion} (${impact})`);
}

const now = new Date().toISOString();
status.verified = {
  ...(status.verified || {}),
  gameVersion: cache.source.gameVersion,
  verifiedAt: now,
  upstreamCommit: cache.source.commit,
  basis: 'BF6 Weapons Lab class audits, official patch overlays, REDSEC rules and exhaustive combat-cache validation'
};
status.upstream = { ...(status.upstream || {}), verifiedCommit: cache.source.commit, observedCommit: cache.source.commit, declaredGameVersions: manifest?.upstreamBaseline?.sourceVersions ?? status?.upstream?.declaredGameVersions ?? [] };
status.pending = null;
if (status?.official?.gameVersion === cache.source.gameVersion) {
  status.state = 'verified';
  status.combatImpact = 'verified-current';
} else if (status.combatImpact === 'no-combat-change-detected') {
  status.state = 'current-no-combat-change-detected';
} else {
  status.state = 'verification-pending';
}
await writeFile(statusPath, `${JSON.stringify(status, null, 2)}\n`);
console.log(`FRESHNESS PROMOTE PASS • verified ${cache.source.gameVersion} • upstream ${cache.source.commit.slice(0,12)} • state ${status.state}`);
