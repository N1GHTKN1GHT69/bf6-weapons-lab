#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

const STATUS_PATH = resolve(process.env.BF6_FRESHNESS_STATUS || 'data/freshness-status.json');
const MANIFEST_PATH = resolve(process.env.BF6_SOURCE_MANIFEST || 'data/source-manifest.json');
const EA_UPDATES_URL = process.env.BF6_EA_UPDATES_URL || 'https://www.ea.com/games/battlefield/battlefield-6/news?type=game-updates';
const write = process.argv.includes('--write');
const now = new Date();

const json = async (p, fallback = null) => {
  try { return JSON.parse(await readFile(p, 'utf8')); } catch { return fallback; }
};

function versionParts(v) {
  const p = String(v || '').split('.').map(Number);
  return p.length === 4 && p.every(Number.isInteger) ? p : null;
}
function compareVersion(a, b) {
  const A = versionParts(a), B = versionParts(b);
  if (!A || !B) return String(a || '').localeCompare(String(b || ''));
  for (let i = 0; i < 4; i++) if (A[i] !== B[i]) return A[i] - B[i];
  return 0;
}
function maxVersion(values) {
  return [...new Set(values.filter(v => versionParts(v)))].sort(compareVersion).at(-1) || null;
}
function slugVersion(v) { return String(v).replaceAll('.', '-'); }
function isoDateFromText(text) {
  const month = '(January|February|March|April|May|June|July|August|September|October|November|December)';
  const m = String(text).match(new RegExp(`${month}\\s+(\\d{1,2}),\\s+(20\\d{2})`, 'i'));
  if (!m) return null;
  const d = new Date(`${m[1]} ${m[2]}, ${m[3]} 00:00:00 UTC`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
async function fetchText(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      cache: 'no-store',
      signal: ctrl.signal,
      headers: { 'user-agent': 'bf6-weapons-lab-freshness/1.0', 'accept': 'text/html,application/xhtml+xml' }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(timer); }
}
function latestVersionFromListing(html) {
  const slugVersions = [];
  for (const m of String(html).matchAll(/battlefield-6-game-update-(\d+)-(\d+)-(\d+)-(\d+)/gi)) {
    slugVersions.push(`${Number(m[1])}.${Number(m[2])}.${Number(m[3])}.${Number(m[4])}`);
  }
  if (slugVersions.length) return maxVersion(slugVersions);
  const fallback = [...String(html).matchAll(/\b(\d+\.\d+\.\d+\.\d+)\b/g)].map(m => m[1]);
  return maxVersion(fallback);
}
function normalizedArticleBody(text) {
  const src = String(text || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
  const lower = src.toLowerCase();
  const changelogAt = lower.lastIndexOf('changelog');
  return (changelogAt >= 0 ? src.slice(changelogAt) : src).trim();
}
function textHash(text) { return createHash('sha256').update(String(text || '')).digest('hex'); }
function classifyCombatImpact(text) {
  const whole = String(text || '').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  const body = normalizedArticleBody(text).toLowerCase();
  const terms = [
    'weapons', 'weapon:', 'attachment', 'ammunition', 'ammo', 'damage',
    'rate of fire', 'rpm', 'recoil', 'spread', 'bullet', 'projectile',
    'velocity', 'reload', 'magazine', 'headshot', 'armor', 'armour', 'plate',
    'match trigger'
  ];
  const matched = terms.filter(t => body.includes(t));
  if (/\bnew weapons?\b/.test(whole)) matched.push('new weapon');
  const unique = [...new Set(matched)];
  return { impact: unique.length ? 'combat-relevant-or-unknown' : 'no-combat-change-detected', matched: unique };
}
async function detectUpstreamDataChange(manifest, observedCommit, verifiedCommit) {
  const override = String(process.env.BF6_UPSTREAM_DATA_CHANGED || '').trim().toLowerCase();
  if (override === 'true' || override === 'false') return { known: true, changed: override === 'true', changedFiles: [] };
  // Git commits are immutable: if the observed upstream SHA is exactly the
  // snapshot we already verified, the data files cannot have changed. Avoid
  // four raw-file downloads on the normal hourly no-change path.
  if (observedCommit && verifiedCommit && observedCommit === verifiedCommit) {
    return { known: true, changed: false, changedFiles: [] };
  }
  const expected = manifest?.sha256 || {};
  const files = ['weapons.json','attachments.json','ammo.json','ballistics.json'];
  if (!files.every(name => typeof expected[name] === 'string' && expected[name])) return { known: false, changed: false, changedFiles: [] };
  try {
    const rows = await Promise.all(files.map(async name => {
      const url = `https://raw.githubusercontent.com/raymdl/BF6-Weapon-Analyzer/refs/heads/main/data/${name}`;
      const text = await fetchText(url, 20000);
      return { name, hash: textHash(text) };
    }));
    const changedFiles = rows.filter(x => x.hash !== expected[x.name]).map(x => x.name);
    return { known: true, changed: changedFiles.length > 0, changedFiles };
  } catch (err) {
    console.warn(`Upstream data fingerprint warning: ${err.message}`);
    return { known: false, changed: false, changedFiles: [] };
  }
}
function pendingAgeHours(status) {
  const t = Date.parse(status?.pending?.rebuildRequestedAt || '');
  return Number.isFinite(t) ? (Date.now() - t) / 3_600_000 : Infinity;
}
function out(name, value) {
  const path = process.env.GITHUB_OUTPUT;
  const text = `${name}=${String(value)}\n`;
  if (path) appendFileSync(path, text);
  else console.log(text.trim());
}

const status = await json(STATUS_PATH, { schema: 1, official: {}, verified: {}, upstream: {}, state: 'unknown', pending: null });
const manifest = await json(MANIFEST_PATH, {});
let listing;
try { listing = process.env.BF6_EA_LISTING_FILE ? await readFile(resolve(process.env.BF6_EA_LISTING_FILE), 'utf8') : await fetchText(EA_UPDATES_URL); }
catch (err) {
  console.error(`FRESHNESS CHECK FAILED: EA update listing unavailable: ${err.message}`);
  process.exit(2); // fail closed; never alter freshness state on an unreachable source
}
const officialVersion = latestVersionFromListing(listing);
if (!officialVersion) {
  console.error('FRESHNESS CHECK FAILED: no Battlefield four-part game version found on EA update listing');
  process.exit(2);
}
const articleUrl = `https://www.ea.com/games/battlefield/battlefield-6/news/battlefield-6-game-update-${slugVersion(officialVersion)}`;
let article = '';
try { article = process.env.BF6_EA_ARTICLE_FILE ? await readFile(resolve(process.env.BF6_EA_ARTICLE_FILE), 'utf8') : await fetchText(articleUrl); } catch (err) { console.warn(`EA article fetch warning: ${err.message}`); }
const officialDate = isoDateFromText(article) || status?.official?.publishedDate || null;
const classification = article ? classifyCombatImpact(article) : { impact: 'unknown', matched: [] };
const articleBodyHash = article ? textHash(normalizedArticleBody(article)) : null;
const observedUpstream = String(process.env.UPSTREAM_SHA || '').trim() || null;
const verifiedUpstream = manifest?.commit || status?.verified?.upstreamCommit || status?.upstream?.verifiedCommit || null;
const officialChanged = status?.official?.gameVersion !== officialVersion;
const articleRevisionChanged = !officialChanged && !!(articleBodyHash && status?.official?.contentHash && articleBodyHash !== status.official.contentHash);
const bootstrapArticleHash = !officialChanged && !!(articleBodyHash && !status?.official?.contentHash);
const upstreamCommitChanged = !!(observedUpstream && verifiedUpstream && observedUpstream !== verifiedUpstream);
const upstreamData = await detectUpstreamDataChange(manifest, observedUpstream, verifiedUpstream);
const upstreamChanged = upstreamData.known ? upstreamData.changed : false;
const samePending = upstreamChanged && status?.pending?.upstreamCommit === observedUpstream;
const retryDue = samePending && pendingAgeHours(status) >= Number(process.env.BF6_REBUILD_RETRY_HOURS || 6);
const needsRebuild = upstreamChanged && (!samePending || retryDue);

let next = structuredClone(status);
next.schema = 1;
if (officialChanged || articleRevisionChanged || bootstrapArticleHash) {
  if (officialChanged || articleRevisionChanged) next.detectedAt = now.toISOString();
  next.official = { gameVersion: officialVersion, publishedDate: officialDate, url: articleUrl, contentHash: articleBodyHash || status?.official?.contentHash || null };
  // Bootstrapping a hash for the already-verified current article must not
  // downgrade a model merely because its changelog contains weapon terms.
  if (!bootstrapArticleHash || officialChanged) {
    next.combatImpact = classification.impact;
    next.matchedTerms = classification.matched.slice(0, 30);
    if (officialVersion === next?.verified?.gameVersion && !articleRevisionChanged) next.state = 'verified';
    else if (classification.impact === 'no-combat-change-detected') next.state = 'current-no-combat-change-detected';
    else next.state = 'verification-pending';
  }
}
if (needsRebuild && observedUpstream) {
  next.upstream = { ...(next.upstream || {}), observedCommit: observedUpstream, changedFiles: upstreamData.changedFiles };
}
if (needsRebuild) {
  next.pending = { ...(next.pending || {}), upstreamCommit: observedUpstream, rebuildRequestedAt: now.toISOString() };
  if (next.state === 'verified') next.state = 'source-update-pending';
}

const before = JSON.stringify(status);
const after = JSON.stringify(next);
const statusChanged = before !== after;
if (write && statusChanged) await writeFile(STATUS_PATH, `${JSON.stringify(next, null, 2)}\n`);

out('official_version', officialVersion);
out('official_changed', officialChanged);
out('upstream_commit_changed', upstreamCommitChanged);
out('upstream_changed', upstreamChanged);
out('upstream_data_known', upstreamData.known);
out('article_revision_changed', articleRevisionChanged);
out('needs_rebuild', needsRebuild);
out('status_changed', statusChanged);
out('combat_impact', classification.impact);
console.log(`FRESHNESS PASS • EA ${officialVersion}${officialChanged ? ' NEW' : articleRevisionChanged ? ' REVISED' : ''} • upstream ${observedUpstream ? observedUpstream.slice(0,12) : 'unknown'}${upstreamChanged ? ` DATA CHANGED (${upstreamData.changedFiles.join(',') || 'override'})` : upstreamCommitChanged ? ' commit-only change' : ''} • rebuild ${needsRebuild ? 'YES' : 'NO'}`);
