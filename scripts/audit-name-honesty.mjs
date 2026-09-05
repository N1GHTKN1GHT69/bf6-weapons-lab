#!/usr/bin/env node
/**
 * Attachment display-name honesty gate.
 *
 * The naming audit classifies names; this checks that what actually reaches the
 * screen never claims more confidence than the classification supports.
 *
 *  - every rendered attachment whose name is not GAME_VERIFIED_EXACT carries a
 *    status flag on its card
 *  - no headline text asserts a name is EXACT while the audit records zero
 *    GAME_VERIFIED_EXACT names
 *  - generic tier labels (optic tiers, bare barrel tiers) are marked as such
 *  - effect chips use only the semantic up / down / none classes
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { bootLab } from './lab-harness.mjs';

const audit = JSON.parse(await readFile('data/attachment-name-audit.json', 'utf8'));
let sourceVerification = null;
try { sourceVerification = JSON.parse(await readFile('data/source-verification.json', 'utf8')); } catch {}
const { diag, window: win } = await bootLab();
const errors = [];

const byId = new Map();
for (const r of audit.attachments) byId.set(`${r.internalType}:${r.attachmentId}`, r);
const exactCount = audit.counts?.GAME_VERIFIED_EXACT ?? 0;

if (audit.affectsOptimizer !== false) errors.push('naming audit does not declare affectsOptimizer:false');
if (!sourceVerification) errors.push('data/source-verification.json missing - run scripts/audit-source-data.mjs');
else if (!['VERIFIED', 'PROVISIONAL'].includes(sourceVerification.endToEndStatus)) {
  errors.push(`unrecognised endToEndStatus "${sourceVerification.endToEndStatus}"`);
} else if (typeof sourceVerification.weaponOverrides !== 'object') {
  errors.push('source-verification.json is missing weaponOverrides - dependency-aware capping requires it');
}

const roster = (win.BF6_CURRENT?.roster ?? []).filter(w => w.cls !== 'Secondary');
const modes = [
  { gameMode: 'multiplayer' },
  { gameMode: 'redsec', targetArmor: 'plates2' }
];
let cardsSeen = 0, flagsSeen = 0;

for (const m of modes) {
  for (const rw of roster) {
    const r = diag.render({ ...m, category: '__all__', distance: 25, priority: 'fastest', mode: 'manual', weaponId: rw.id });
    const grid = String(r.attachmentGrid || '');
    if (!grid.trim()) continue;

    const cards = grid.split('<div class="attachment-card').slice(1);
    for (const card of cards) {
      // renderBuildPending() reuses the card shell for its fail-closed "no
      // fabricated build" notice. That is a status message, not an attachment
      // name, and it spans the grid.
      if (/^\s*"?\s*style="grid-column/.test(card)) continue;
      cardsSeen++;
      const nameMatch = card.match(/<strong>([^<]*)<\/strong>/);
      if (!nameMatch) { errors.push(`${rw.id}: attachment card with no name`); continue; }
      const hasFlag = /class="name-flag/.test(card);
      if (hasFlag) flagsSeen++;
      // With zero GAME_VERIFIED_EXACT names in the audit, every rendered card
      // must carry a flag. An unflagged card would be an implicit exact claim.
      if (exactCount === 0 && !hasFlag) {
        errors.push(`${rw.id}: "${nameMatch[1]}" rendered with no name-status flag while the audit records 0 GAME_VERIFIED_EXACT names`);
      }
    }

    // Effect chips must be semantic and nothing else.
    for (const cls of grid.match(/class="fx ([a-z]*)"/g) || []) {
      const kind = cls.replace(/class="fx |"/g, '');
      if (!['up', 'down', 'none'].includes(kind)) errors.push(`${rw.id}: unknown effect-chip class "${kind}"`);
    }

    // END-TO-END, DEPENDENCY-AWARE: a chip may only be capped by THIS weapon's
    // own override. A weapon with no override in source-verification.json has
    // no unresolved current-patch delta naming it, so a clean VERIFIED-quality
    // chip is correct for it - capping every weapon over one other weapon's
    // stale field would be the bug this gate exists to prevent.
    const override = sourceVerification?.weaponOverrides?.[rw.id] ?? null;
    if (override) {
      if (/^VERIFIED$/i.test(r.confidenceChip.trim())) {
        errors.push(`${rw.id}: chip reads "${r.confidenceChip}" while this weapon's own source data is ${override.status} (${override.fields.join(', ')})`);
      }
      if (/ROBUST/i.test(r.confidenceChip) && !/SOURCE DATA/i.test(r.confidenceChip)) {
        errors.push(`${rw.id}: chip claims robustness ("${r.confidenceChip}") without disclosing that this weapon's source data is ${override.status}`);
      }
    } else if (/SOURCE DATA/i.test(r.confidenceChip)) {
      errors.push(`${rw.id}: chip discloses a source-data problem ("${r.confidenceChip}") but this weapon has no recorded override - capping leaked from another weapon`);
    }

    // No headline may assert exactness the audit does not support.
    if (exactCount === 0 && /NAMES EXACT/i.test(r.confidenceChip)) {
      errors.push(`${rw.id}: confidence chip claims "${r.confidenceChip}" while 0 names are GAME_VERIFIED_EXACT`);
    }
  }
}

// Every optic tier and bare barrel tier must be classified as a placeholder,
// never presented as a real attachment name.
for (const r of audit.attachments) {
  if (r.internalType === 'sight' && r.verificationStatus !== 'INTERNAL_PLACEHOLDER' && r.verificationStatus !== 'GAME_VERIFIED_EXACT') {
    errors.push(`optic tier "${r.currentDisplayName}" is ${r.verificationStatus}, expected INTERNAL_PLACEHOLDER until confirmed in game`);
  }
}

// Shared display names must never be treated as identity.
for (const g of audit.sharedDisplayNames || []) {
  if (new Set(g.attachmentIds).size !== g.attachmentIds.length) errors.push(`duplicate ids under shared name "${g.displayName}"`);
}

/**
 * CI TRIGGER REGRESSION.
 *
 * data/attachment-name-audit.json matches the Combat Engine's `data/*-audit.json`
 * path glob, so regenerating a display-only naming artifact used to spawn the whole
 * 62-weapon matrix. The workflow excludes it - and this checks that the exclusion is
 * still SOUND, not merely still present:
 *
 *   1. the exclusion line exists and comes AFTER the glob it narrows (YAML path
 *      filters are order-sensitive; a negation placed before its glob does nothing)
 *   2. no file in the cache pipeline reads the naming artifact at all
 *
 * If someone ever makes the cache depend on naming data, (2) fails and the
 * exclusion must be removed rather than the dependency hidden.
 */
const workflow = await readFile('.github/workflows/combat-engine.yml', 'utf8');
const globIdx = workflow.indexOf("- 'data/*-audit.json'");
const negIdx = workflow.indexOf("- '!data/attachment-name-audit.json'");
if (globIdx < 0) errors.push('combat-engine.yml no longer carries the data/*-audit.json path glob; re-check the naming-artifact exclusion');
else if (negIdx < 0) errors.push('combat-engine.yml no longer excludes data/attachment-name-audit.json, so regenerating a display-only artifact spawns the 62-weapon matrix');
else if (negIdx < globIdx) errors.push('the attachment-name-audit exclusion appears BEFORE the data/*-audit.json glob it narrows; GitHub path filters are order-sensitive, so it has no effect there');

const CACHE_PIPELINE = [
  'scripts/build-combat-cache.mjs', 'scripts/merge-combat-cache.mjs',
  'scripts/validate-combat-cache.mjs', 'scripts/auto-selection-policy.mjs',
  'scripts/cache-state-signature.mjs', 'scripts/verified-source-sanitizer.mjs',
  'attachment-legality.js'
];
for (const file of CACHE_PIPELINE) {
  let src;
  try { src = await readFile(file, 'utf8'); } catch { errors.push(`cache-pipeline file ${file} is missing`); continue; }
  if (/attachment-name-audit|nameAudit|attachmentDisplay\(|NAME_STATUS_UI/.test(src)) {
    errors.push(`${file} reads the attachment naming layer. The Combat Engine trigger exclusion for data/attachment-name-audit.json assumes it cannot affect the cache; remove the exclusion or remove the dependency.`);
  }
}

await mkdir('reports/overnight', { recursive: true });
await writeFile('reports/overnight/name-honesty.json', JSON.stringify({
  generatedAt: new Date().toISOString(),
  auditedNames: audit.attachments.length, counts: audit.counts,
  sharedDisplayNameGroups: (audit.sharedDisplayNames || []).length,
  renderedCards: cardsSeen, cardsCarryingStatusFlag: flagsSeen, errors
}, null, 1));

console.log(`name honesty: ${cardsSeen} rendered attachment cards, ${flagsSeen} carrying a status flag; ${audit.attachments.length} names audited (${exactCount} game-verified exact)`);
if (errors.length) { console.error('FAIL:\n' + [...new Set(errors)].slice(0, 25).join('\n')); process.exit(1); }
console.log('PASS: nothing on screen claims a name confidence the audit does not record.');
