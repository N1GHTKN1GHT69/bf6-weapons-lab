#!/usr/bin/env node
/**
 * Attachment exact-name verification worklist.
 *
 * No name can be promoted to GAME_VERIFIED_EXACT without direct in-game
 * evidence, and this repository holds none. That makes the remaining work a
 * data-capture task rather than an engineering one - so this turns "verify 168
 * names" into an ordered, finite list, heaviest-impact first.
 *
 * Priority is how often an attachment actually appears in a recommended META
 * build, because those are the names a user reads and acts on. An attachment
 * nothing recommends can wait however uncertain its name is.
 *
 * Writes reports/overnight/name-verification-worklist.{json,csv}. Read-only.
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { bootLab } from './lab-harness.mjs';

const { diag, window: win } = await bootLab();
const nameAudit = JSON.parse(await readFile('data/attachment-name-audit.json', 'utf8'));
const freshness = JSON.parse(await readFile('data/freshness-status.json', 'utf8'));

const byKey = new Map();
for (const r of nameAudit.attachments) byKey.set(`${r.internalType}:${r.attachmentId}`, r);

const scopes = ['__all__', ...(win.BF6_CURRENT?.primaryClasses ?? [])];
const DISTANCES = [1, 10, 25, 50, 75, 100, 150, 300];

/** How often each attachment appears in a build the app actually recommends. */
const freq = new Map();
const weaponsSeen = new Map();
for (const [gameMode, targetArmor] of [['multiplayer', 'unarmored'], ['redsec', 'unarmored'], ['redsec', 'plates2']]) {
  for (const priority of ['balanced', 'fastest']) {
    for (const category of scopes) {
      for (const distance of DISTANCES) {
        const s = diag.snapshot({ gameMode, targetArmor, category, distance, priority, mode: 'auto' });
        for (const p of s.build?.picks ?? []) {
          if (!p || p.id === 'none') continue;
          const k = `${p.slot}:${p.id}`;
          freq.set(k, (freq.get(k) || 0) + 1);
          if (!weaponsSeen.has(k)) weaponsSeen.set(k, new Set());
          if (s.weaponId) weaponsSeen.get(k).add(s.weaponId);
        }
      }
    }
  }
}

const NEEDS_WORK = new Set(['SOURCE_CORROBORATED', 'UNVERIFIED', 'INTERNAL_PLACEHOLDER', 'MISMATCH']);

const rows = [];
for (const r of nameAudit.attachments) {
  const key = `${r.internalType}:${r.attachmentId}`;
  const appearances = freq.get(key) ?? 0;
  if (!NEEDS_WORK.has(r.verificationStatus)) continue;
  const isTier = r.verificationStatus === 'INTERNAL_PLACEHOLDER';
  rows.push({
    attachmentId: r.attachmentId,
    internalType: r.internalType,
    currentDisplayName: r.currentDisplayName,
    status: r.verificationStatus,
    rule: r.rule,
    appearancesInRecommendedBuilds: appearances,
    inRecommendedBuilds: appearances > 0,
    compatibleWeaponCount: r.compatibleWeaponCount,
    // Where to go in game to read the string.
    captureOn: (weaponsSeen.get(key) ? [...weaponsSeen.get(key)] : (r.compatibleWeapons ?? []).slice(0, 3)).slice(0, 3),
    requiresTierAmbiguityAck: isTier,
    note: isTier
      ? 'Generic tier/category label. A capture must affirm acknowledgesTierAmbiguity:true, i.e. that it names THIS catalogue entry rather than one member of the category it stands for.'
      : r.verificationStatus === 'UNVERIFIED'
        ? 'Source string is abbreviated or contested; the in-game string is likely to differ, so this capture may also correct the display name.'
        : 'Source string is plausible verbatim; the capture confirms or corrects it.'
  });
}

rows.sort((a, b) =>
  b.appearancesInRecommendedBuilds - a.appearancesInRecommendedBuilds ||
  b.compatibleWeaponCount - a.compatibleWeaponCount ||
  a.attachmentId.localeCompare(b.attachmentId));

const inBuilds = rows.filter(r => r.inRecommendedBuilds);
const summary = {
  generatedAt: new Date().toISOString(),
  liveGameVersion: freshness.official?.gameVersion ?? null,
  totalAuditedNames: nameAudit.attachments.length,
  gameVerifiedExact: nameAudit.counts?.GAME_VERIFIED_EXACT ?? 0,
  needingCapture: rows.length,
  needingCaptureAndRecommended: inBuilds.length,
  scenariosSampled: 3 * 2 * scopes.length * DISTANCES.length,
  coverageIfTopNCaptured: [10, 20, 30].map(n => ({
    captures: n,
    sharePercentOfRecommendedAppearances: Math.round(
      100 * rows.slice(0, n).reduce((a, r) => a + r.appearancesInRecommendedBuilds, 0) /
      Math.max(1, rows.reduce((a, r) => a + r.appearancesInRecommendedBuilds, 0)))
  })),
  top20: inBuilds.slice(0, 20).map(r => ({
    name: r.currentDisplayName, slot: r.internalType, status: r.status,
    appearances: r.appearancesInRecommendedBuilds, captureOn: r.captureOn
  }))
};

await mkdir('reports/overnight', { recursive: true });
await writeFile('reports/overnight/name-verification-worklist.json', JSON.stringify({ summary, worklist: rows }, null, 1));
const cols = ['attachmentId', 'internalType', 'currentDisplayName', 'status', 'appearancesInRecommendedBuilds', 'compatibleWeaponCount', 'captureOn', 'requiresTierAmbiguityAck', 'note'];
await writeFile('reports/overnight/name-verification-worklist.csv',
  [cols.join(','), ...rows.map(r => cols.map(c => JSON.stringify(Array.isArray(r[c]) ? r[c].join('|') : (r[c] ?? ''))).join(','))].join('\n'));

console.log(JSON.stringify(summary, null, 1));
console.log(`\nWorklist: reports/overnight/name-verification-worklist.csv`);
console.log(`Record captures in data/attachment-name-evidence.json; the name audit promotes them automatically.`);
