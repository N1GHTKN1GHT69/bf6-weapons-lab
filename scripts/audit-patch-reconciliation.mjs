#!/usr/bin/env node
/**
 * BF6 Weapons Lab — patch reconciliation gate.
 *
 * Proves the verifiedCombatVersion algorithm is deterministic and cannot be
 * talked into promoting an unreconciled combat patch. Every scenario below runs
 * the real reconciler against a synthetic ledger and asserts the outcome, so a
 * future edit that weakens promotion fails the build.
 */
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const errors = [];
const eq = (label, got, want) => { if (got !== want) errors.push(`${label}: expected ${want}, got ${got}`); };

const [ledger, status, app] = await Promise.all([
  readFile('data/patch-delta-ledger.json', 'utf8').then(JSON.parse),
  readFile('data/freshness-status.json', 'utf8').then(JSON.parse),
  readFile('app.js', 'utf8')
]);

// --- 1. The three version concepts must stay distinct ----------------------
if (!status?.official?.gameVersion) errors.push('freshness status has no live game version');
if (!status?.verified?.gameVersion) errors.push('freshness status has no verified combat version');
if (!Array.isArray(status?.upstream?.declaredGameVersions) || !status.upstream.declaredGameVersions.length) {
  errors.push('upstream declared baseline is not recorded separately from the verified combat version');
}
if (status.upstream.declaredGameVersions.includes(status.verified.gameVersion) && status.official.gameVersion === status.verified.gameVersion) {
  errors.push('the three version concepts have collapsed into one value');
}
// The live version must never silently become the verified version.
if (status.official.gameVersion !== status.verified.gameVersion && status.state === 'verified') {
  errors.push('state claims verified while live and verified versions differ');
}

// --- 2. Ledger integrity ---------------------------------------------------
const versions = ledger.patches.map(p => p.version);
if (new Set(versions).size !== versions.length) errors.push('duplicate patch versions in ledger');
for (const p of ledger.patches) {
  if (!p.officialSource?.startsWith('https://www.ea.com/')) errors.push(`${p.version} has no authoritative EA source`);
  for (const ch of p.changes ?? []) {
    if (!ch.check?.type) errors.push(`${p.version}: change "${ch.mechanic}" has no deterministic check`);
    if (ch.blocking === undefined) errors.push(`${p.version}: change "${ch.mechanic}" does not declare whether it blocks promotion`);
    // A change that cannot be checked deterministically must block.
    if (ch.check?.type === 'valuesUnpublished' && ch.blocking !== true) {
      errors.push(`${p.version}: "${ch.mechanic}" has unpublished values but does not block promotion`);
    }
  }
}

// --- 3. Run the real reconciler against synthetic ledgers ------------------
const dir = await mkdtemp(join(tmpdir(), 'bf6-recon-'));
async function reconcile(patches, baseline = '1.3.3.0') {
  const path = join(dir, `ledger-${Math.random().toString(36).slice(2)}.json`);
  await writeFile(path, JSON.stringify({ schema: 1, upstreamDeclaredBaseline: baseline, upstreamSnapshotRetrieved: '2026-07-25', patches }, null, 2));
  const out = execFileSync(process.execPath, ['scripts/reconcile-patches.mjs'], {
    env: { ...process.env, BF6_PATCH_LEDGER: path }, encoding: 'utf8'
  });
  return String(out.match(/VERIFIED COMBAT VERSION\s*:\s*([0-9.]+)/)?.[1] ?? '');
}

const noCombat = v => ({ version: v, releaseDate: '2026-01-01', officialSource: 'https://www.ea.com/x', combatRelevant: false, changes: [{ mechanic: 'ui', blocking: false, check: { type: 'notModelled', reason: 'ui only' } }] });
const presentWeapon = (v, id) => ({ version: v, releaseDate: '2026-01-01', officialSource: 'https://www.ea.com/x', combatRelevant: true, changes: [{ mechanic: 'new weapon', blocking: true, description: `${id} added`, check: { type: 'weaponPresent', weaponId: id } }] });
const missingWeapon = (v, id) => ({ version: v, releaseDate: '2026-01-01', officialSource: 'https://www.ea.com/x', combatRelevant: true, changes: [{ mechanic: 'new weapon', blocking: true, description: `${id} added`, check: { type: 'weaponPresent', weaponId: id } }] });
const unpublished = v => ({ version: v, releaseDate: '2026-01-01', officialSource: 'https://www.ea.com/x', combatRelevant: true, changes: [{ mechanic: 'balance', blocking: true, description: 'values changed', check: { type: 'valuesUnpublished', reason: 'no numbers published' } }] });
const overlay = v => ({ version: v, releaseDate: '2026-01-01', officialSource: 'https://www.ea.com/x', combatRelevant: true, changes: [{ mechanic: 'attachment rule', blocking: true, description: 'rule', check: { type: 'overlayRule', token: 'BLOCKED_UNTIL_PATCH = new Set(["ef88:match_trigger", "brod3:match_trigger"])' } }] });

// a non-combat patch safely advances the reconciled version
eq('non-combat patch advances reconciliation', await reconcile([noCombat('1.4.1.0'), noCombat('1.4.1.5')]), '1.4.1.5');
// a combat patch whose weapon really exists advances
eq('represented new weapon advances', await reconcile([presentWeapon('1.4.1.0', 'brod3')]), '1.4.1.0');
// a combat patch whose weapon is absent blocks, and stops the chain there
eq('missing new weapon blocks promotion', await reconcile([missingWeapon('1.4.1.0', 'interdictor')]), '1.3.3.0');
// an unresolved patch blocks every later patch even if the later one is fine
eq('unresolved patch blocks all later patches', await reconcile([presentWeapon('1.4.1.0', 'brod3'), unpublished('1.4.2.0'), noCombat('1.4.2.5')]), '1.4.1.0');
// unpublished values can never be promoted by inference
eq('unpublished balance values block promotion', await reconcile([unpublished('1.4.1.0')]), '1.3.3.0');
// an explicit verified overlay counts as represented
eq('explicit verified overlay advances', await reconcile([overlay('1.4.1.0')]), '1.4.1.0');
// stale upstream baseline metadata can coexist with newer proven coverage
eq('stale baseline metadata does not cap proven coverage', await reconcile([presentWeapon('1.4.1.0', 'brod3'), presentWeapon('1.4.1.5', 'ef88')], '1.3.3.0'), '1.4.1.5');
// with nothing after the baseline, the baseline itself is the answer
eq('empty chain returns the baseline', await reconcile([]), '1.3.3.0');
await rm(dir, { recursive: true, force: true });

// --- 4. The real ledger's own outcome must match the shipped status --------
try { execFileSync(process.execPath, ['scripts/reconcile-patches.mjs', '--check'], { stdio: 'pipe' }); }
catch (e) { errors.push(`shipped freshness status does not match the ledger: ${String(e.stdout || e.message).trim().split('\n').slice(-2).join(' ')}`); }

// --- 5. Known-good production state stays usable ---------------------------
// A pending combat patch must not disable the site or void the cache.
if (!app.includes('freshnessUi()')) errors.push('app does not surface freshness state');
if (!/keeps the last known-good calculations/i.test(app)) errors.push('app no longer explains that pending verification keeps last known-good calculations');
if (app.includes('state.combatCache = null') && !app.includes('validateCombatCacheObject')) {
  errors.push('freshness state appears able to void the combat cache');
}

if (errors.length) {
  console.error('PATCH RECONCILIATION AUDIT FAILED');
  errors.forEach(e => console.error('-', e));
  process.exit(1);
}
console.log(`PATCH RECONCILIATION PASS • ${ledger.patches.length} patches after ${ledger.upstreamDeclaredBaseline} • verified combat ${status.verified.gameVersion}${status.verified.blockedAt ? ` (blocked at ${status.verified.blockedAt})` : ''} • live ${status.official.gameVersion} • 8 promotion scenarios gated`);
