#!/usr/bin/env node
/**
 * BF6 Weapons Lab — patch-delta reconciliation.
 *
 * Computes verifiedCombatVersion deterministically from data/patch-delta-ledger.json
 * against the actual repository dataset. Nothing here infers that a change is
 * present because a version label says so, and no LLM judgement is used at
 * production time: every check is a concrete lookup in the shipped data.
 *
 * Promotion rule (spec section 6): the verified combat version advances through
 * a patch only when every blocking delta in it is either represented in the
 * current dataset or implemented as an explicit verified overlay. The first
 * patch with an unresolved blocking delta stops the chain, and the verified
 * version is the last fully reconciled patch before it.
 *
 * Usage:
 *   node scripts/reconcile-patches.mjs            # report
 *   node scripts/reconcile-patches.mjs --write    # also update freshness status
 *   node scripts/reconcile-patches.mjs --check    # CI gate: status must match
 */
import { readFile, writeFile } from 'node:fs/promises';

const LEDGER = process.env.BF6_PATCH_LEDGER || 'data/patch-delta-ledger.json';
const STATUS = process.env.BF6_FRESHNESS_STATUS || 'data/freshness-status.json';
const readJson = async p => JSON.parse(await readFile(p, 'utf8'));

const norm = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

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

const [ledger, weapons, attachments, ammo, app] = await Promise.all([
  readJson(LEDGER),
  readJson('data/weapons.json'),
  readJson('data/attachments.json'),
  readJson('data/ammo.json'),
  readFile('app.js', 'utf8')
]);

const weaponByKey = new Map();
for (const w of weapons) { weaponByKey.set(norm(w.id), w); weaponByKey.set(norm(w.name), w); }
const findWeapon = id => weaponByKey.get(norm(id)) ?? null;

/** Every check is a concrete lookup. No inference, no version-label trust. */
function runCheck(check) {
  switch (check?.type) {
    case 'weaponPresent': {
      const w = findWeapon(check.weaponId);
      return w
        ? { ok: true, evidence: `data/weapons.json contains ${w.id} (${w.name}, ${w.cls})` }
        : { ok: false, evidence: `data/weapons.json has no record for "${check.weaponId}"` };
    }
    case 'attachmentCompat': {
      const missing = [];
      for (const wid of check.weaponIds ?? []) {
        const w = findWeapon(wid);
        const list = w ? attachments.WEAPON_ATTS?.[w.id]?.[check.slot] : null;
        if (!Array.isArray(list) || !list.includes(check.attachmentId)) missing.push(wid);
      }
      return missing.length
        ? { ok: false, evidence: `${check.attachmentId} missing from ${check.slot} compatibility for: ${missing.join(', ')}` }
        : { ok: true, evidence: `${check.attachmentId} present in ${check.slot} compatibility for all ${(check.weaponIds ?? []).length} named weapons` };
    }
    case 'attachmentPresent': {
      const pools = [...Object.values(attachments).filter(Array.isArray), ammo.AMMO ?? []];
      const hit = pools.some(list => list.some(x => x?.id === check.attachmentId));
      return hit
        ? { ok: true, evidence: `attachment record ${check.attachmentId} exists` }
        : { ok: false, evidence: `no attachment record for ${check.attachmentId}` };
    }
    case 'overlayRule': {
      const hit = app.includes(check.token);
      return hit
        ? { ok: true, evidence: 'explicit verified overlay present in app.js' }
        : { ok: false, evidence: `app.js is missing the overlay token: ${check.token}` };
    }
    case 'notModelled':
      return { ok: true, evidence: `outside the combat model by design — ${check.reason}` };
    case 'valuesUnpublished':
      return { ok: false, evidence: `cannot be verified deterministically — ${check.reason}` };
    default:
      return { ok: false, evidence: `unknown check type "${check?.type}"` };
  }
}

const patches = [...ledger.patches].sort((a, b) => compareVersion(a.version, b.version));
const rows = [];
let verified = ledger.upstreamDeclaredBaseline;
let stopped = false;
let firstBlocker = null;

for (const patch of patches) {
  const results = (patch.changes ?? []).map(ch => ({ ch, res: runCheck(ch.check) }));
  const unresolved = results.filter(({ ch, res }) => ch.blocking && !res.ok);
  const required = results.filter(({ ch }) => ch.blocking).length;
  const status = !patch.combatRelevant ? 'NO COMBAT EFFECT'
    : unresolved.length === 0 ? 'VERIFIED PRESENT'
    : 'PENDING';
  rows.push({ version: patch.version, releaseDate: patch.releaseDate, combatRelevant: !!patch.combatRelevant, required, unresolved: unresolved.map(u => u.ch.description), status, results });
  if (!stopped && unresolved.length === 0) verified = patch.version;
  else if (!stopped && unresolved.length) { stopped = true; firstBlocker = patch.version; }
}

const doc = {
  schema: 1,
  reconciledAt: new Date().toISOString(),
  upstreamDeclaredBaseline: ledger.upstreamDeclaredBaseline,
  upstreamSnapshotRetrieved: ledger.upstreamSnapshotRetrieved,
  verifiedCombatVersion: verified,
  blockedAt: firstBlocker,
  patches: rows.map(r => ({
    version: r.version, releaseDate: r.releaseDate, combatRelevant: r.combatRelevant,
    requiredDeltas: r.required, status: r.status, unresolved: r.unresolved,
    evidence: r.results.map(({ ch, res }) => ({ mechanic: ch.mechanic, blocking: !!ch.blocking, ok: res.ok, evidence: res.evidence }))
  }))
};

if (process.argv.includes('--write')) {
  const status = await readJson(STATUS);
  status.verified = { ...(status.verified || {}), gameVersion: verified, reconciledThrough: verified, blockedAt: firstBlocker };
  status.upstream = { ...(status.upstream || {}), declaredGameVersions: [ledger.upstreamDeclaredBaseline] };
  status.patchReconciliation = { verifiedCombatVersion: verified, blockedAt: firstBlocker, reconciledAt: doc.reconciledAt, patches: doc.patches.map(p => ({ version: p.version, status: p.status, unresolved: p.unresolved })) };
  const official = status?.official?.gameVersion;
  status.state = official && compareVersion(official, verified) > 0 ? 'verification-pending' : 'verified';
  status.combatImpact = status.state === 'verified' ? 'verified-current' : 'combat-relevant-or-unknown';
  await writeFile(STATUS, `${JSON.stringify(status, null, 2)}\n`);
}

if (process.argv.includes('--check')) {
  const status = await readJson(STATUS);
  const errors = [];
  if (status?.verified?.gameVersion !== verified) errors.push(`freshness verified.gameVersion is ${status?.verified?.gameVersion}, but the ledger only supports ${verified}`);
  if (status?.patchReconciliation?.verifiedCombatVersion !== verified) errors.push('freshness patchReconciliation is stale; rerun scripts/reconcile-patches.mjs --write');
  const official = status?.official?.gameVersion;
  if (official && compareVersion(official, verified) > 0 && status.state === 'verified') {
    errors.push(`state claims "verified" while live ${official} is ahead of reconciled ${verified}`);
  }
  if (errors.length) {
    console.error('PATCH RECONCILIATION CHECK FAILED');
    errors.forEach(e => console.error('-', e));
    process.exit(1);
  }
}

console.log(`\nVERSION   | COMBAT? | REQUIRED | STATUS`);
console.log(`----------|---------|----------|--------------------`);
for (const r of doc.patches) {
  console.log(`${r.version.padEnd(9)} | ${(r.combatRelevant ? 'yes' : 'no').padEnd(7)} | ${String(r.requiredDeltas).padEnd(8)} | ${r.status}${r.unresolved.length ? ` (${r.unresolved.length} unresolved)` : ''}`);
}
console.log(`\nupstream declared baseline : ${doc.upstreamDeclaredBaseline} (snapshot retrieved ${doc.upstreamSnapshotRetrieved})`);
console.log(`VERIFIED COMBAT VERSION    : ${verified}${firstBlocker ? `  (blocked at ${firstBlocker})` : ''}`);
if (firstBlocker) {
  console.log(`\nUnresolved deltas at ${firstBlocker}:`);
  for (const u of doc.patches.find(p => p.version === firstBlocker).unresolved) console.log(`  - ${u}`);
}
