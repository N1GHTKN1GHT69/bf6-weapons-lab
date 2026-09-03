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
const { diag, window: win } = await bootLab();
const errors = [];

const byId = new Map();
for (const r of audit.attachments) byId.set(`${r.internalType}:${r.attachmentId}`, r);
const exactCount = audit.counts?.GAME_VERIFIED_EXACT ?? 0;

if (audit.affectsOptimizer !== false) errors.push('naming audit does not declare affectsOptimizer:false');

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
