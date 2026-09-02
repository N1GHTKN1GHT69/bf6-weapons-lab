#!/usr/bin/env node
/**
 * BF6 Weapons Lab — attachment display-name integrity audit.
 *
 * Produces a machine-readable classification of every attachment display name
 * the application can show to a user. This artifact is DISPLAY-ONLY: it never
 * feeds the optimizer, never changes attachment identity, modifiers, point
 * costs, candidate eligibility or ranking. Name confidence and attachment
 * optimization are deliberately separate concerns.
 *
 * Evidence sources actually present in this repository
 * ----------------------------------------------------
 *   S1  upstream-dataset   data/attachments.json + data/ammo.json, written by
 *                          scripts/sync-from-upstream.mjs as an atomic snapshot
 *                          of raymdl/BF6-Weapon-Analyzer at the exact commit and
 *                          SHA-256 recorded in data/source-manifest.json.
 *   S2  class-audit        data/<class>-audit.json records that independently
 *                          name a required lethal attachment. Each carries its
 *                          own gameVersion / verifiedAt / pass fields.
 *
 * There is no in-game string extraction stored in this repository, so S1 is the
 * strongest available evidence for a name and S2 is the only cross-check.
 *
 * Classification rules (first match wins, all mechanical, no guessing)
 * -------------------------------------------------------------------
 *   1. id === "none"                      -> INTERNAL_PLACEHOLDER
 *      A UI empty-slot state, not a Battlefield 6 attachment.
 *   2. S1 and S2 disagree on the string   -> MISMATCH
 *      Both strings and both sources are recorded; nothing is overwritten.
 *   3. Documented-generic value           -> INTERNAL_PLACEHOLDER
 *      (a) every SIGHTS entry: README.md and the optimizer both document the
 *          current feed as coarse optic *tiers*, not exact sight names;
 *      (b) the closed GENERIC_TIER_LABELS lexicon below (bare tier adjectives
 *          consumed by the tier-modifier model, e.g. barrel "Heavy").
 *   4. Visibly abbreviated / shorthand    -> UNVERIFIED
 *      Strings the dataset itself signals as shortened or inconsistently cased,
 *      so they cannot be certified as the exact in-game label.
 *   5. Otherwise                          -> VERIFIED_EXACT
 *      A distinct product-style designation carried verbatim from the pinned,
 *      hash-verified upstream snapshot. Where S2 also names it, evidence is
 *      recorded as "corroborated" instead of "single-source".
 *
 * VERIFIED_EXACT therefore means: this exact string comes verbatim from the
 * project's pinned authoritative BF6 source, and is not a category label or an
 * abbreviation. It is never assigned because a name merely sounds plausible.
 *
 * Usage: node scripts/audit-attachment-names.mjs [--check]
 *   --check  validate the committed artifact matches the current data instead
 *            of rewriting it (used as a CI gate).
 */
import { readFile, writeFile } from 'node:fs/promises';

const POLICY_VERSION = 'attachment-name-audit-v2';

// Closed, documented lexicon of generic tier/category labels. Exact string
// match, case-insensitive. These are internal category descriptors used by the
// tier-modifier model, not Battlefield 6 product names.
const GENERIC_TIER_LABELS = new Set([
  'none',
  'basic', 'short', 'extended', 'heavy', 'heavy extended',
  'light', 'extended light', 'short light', 'suppressed',
  'standard'
]);

// Strings the source itself signals as abbreviated or inconsistently cased.
const SHORTHAND_IDS = new Set(['subsonic_hp', 'subsonic_pen', 'range_pen']);
const SHORTHAND_NAME_PATTERNS = [
  /^#\d+\s+[A-Z]+$/,        // "#01 BUCK" — all-caps, unlike every other label
  /^\d+\s+Fast$/,           // "30 Fast" — capacity + bare adjective shorthand
  /^\d+\s+Rnd$/             // "30 Rnd"  — see MAGAZINE_NAME_CONFLICT below
];

/**
 * Independent descriptions of the same attachment that do not match the string
 * this project displays. These are secondary sources, so they are NOT strong
 * enough to assert a replacement name - doing that would be exactly the guess
 * this audit exists to prevent. They ARE strong enough to withdraw the claim
 * that the current string is the exact in-game label, so the entry is demoted
 * to UNVERIFIED and the conflict is recorded for a future extraction pass.
 */
const CONFLICT_SIGNALS = {
  lightweight: 'Independent Battlefield 6 attachment guides describe the lightweight / ADS-move-speed ammunition as "Polymer Case" rather than "Lightweight". The mechanic matches this record (adsMoveSpeedTierShift favouring ADS movement), so the identity is not in doubt - only the display string. No replacement name is asserted here because the conflicting source is secondary.'
};
const MAGAZINE_NAME_CONFLICT = 'Independent Battlefield 6 guides refer to magazines in the form "30-Rnd Magazine". The source string omits the "Magazine" noun and the hyphen, so it reads as an abbreviated internal label rather than the full in-game name. No replacement name is asserted from a secondary source.';

const SLOT_OF_CATALOG = {
  SIGHTS: 'sight', MUZZLES: 'muzzle', BARRELS: 'barrel', GRIPS: 'grip',
  LASERS: 'laser', LIGHTS: 'light', ERGOS: 'ergo'
};

const CLASS_AUDIT_FILES = [
  'assault-audit', 'carbine-audit', 'smg-audit', 'lmg-audit',
  'dmr-audit', 'sniper-audit', 'sidearm-audit', 'shotgun-audit'
];

const readJson = async p => JSON.parse(await readFile(p, 'utf8'));

/** Collect every attachmentId -> name claim made by an independent class audit. */
function collectClassAuditNames(audits) {
  const claims = new Map();
  const walk = (node, file, meta) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const v of node) walk(v, file, meta); return; }
    if (typeof node.attachmentId === 'string' && typeof node.attachment === 'string') {
      const list = claims.get(node.attachmentId) ?? [];
      list.push({ name: node.attachment, source: `class-audit:${file}`, gameVersion: meta.gameVersion ?? null, verifiedAt: meta.verifiedAt ?? null, pass: meta.pass === true });
      claims.set(node.attachmentId, list);
    }
    for (const v of Object.values(node)) walk(v, file, meta);
  };
  for (const [file, audit] of audits) walk(audit, file, { gameVersion: audit.gameVersion, verifiedAt: audit.verifiedAt, pass: audit.pass });
  return claims;
}

function classify({ id, slot, name, auditClaims }) {
  const notes = [];
  if (id === 'none') {
    return { status: 'INTERNAL_PLACEHOLDER', verifiedName: null, rule: 'empty-slot-state', notes: ['UI empty-slot state, not a Battlefield 6 attachment.'] };
  }

  const claims = auditClaims.get(id) ?? [];
  const conflicting = claims.filter(c => c.name !== name);
  if (conflicting.length) {
    return {
      status: 'MISMATCH',
      verifiedName: null,
      rule: 'source-conflict',
      notes: [`Upstream dataset says "${name}"; ${conflicting.map(c => `${c.source} says "${c.name}"`).join('; ')}. Conflict left visible for resolution; neither source overwritten.`]
    };
  }

  if (slot === 'sight') {
    return {
      status: 'INTERNAL_PLACEHOLDER',
      verifiedName: null,
      rule: 'documented-optic-tier',
      notes: ['Sight entries are coarse optic tiers, not exact BF6 sight names. README.md records that the current feed supplies tiers and Pick costs rather than magnification/FOV/reticle data, and the optimizer scores them with an explicit tier-range-fit policy.']
    };
  }

  if (GENERIC_TIER_LABELS.has(String(name).trim().toLowerCase())) {
    return {
      status: 'INTERNAL_PLACEHOLDER',
      verifiedName: null,
      rule: 'generic-tier-label',
      notes: ['Bare category/tier descriptor consumed by the tier-modifier model, not a Battlefield 6 product name.']
    };
  }

  if (CONFLICT_SIGNALS[id]) {
    return {
      status: 'UNVERIFIED',
      verifiedName: null,
      rule: 'independent-source-conflict',
      notes: [CONFLICT_SIGNALS[id]]
    };
  }

  if (SHORTHAND_IDS.has(id) || SHORTHAND_NAME_PATTERNS.some(re => re.test(name))) {
    const notes = ['The source string is visibly abbreviated or inconsistently cased relative to the rest of the catalog, so it cannot be certified as the exact in-game label.'];
    if (/^\d+\s+Rnd$/.test(name)) notes.push(MAGAZINE_NAME_CONFLICT);
    return { status: 'UNVERIFIED', verifiedName: null, rule: 'abbreviated-source-string', notes };
  }

  // v2 evidence standard. The old VERIFIED_EXACT meant only "verbatim from the
  // pinned upstream source", which overstated confidence: no in-game string
  // extraction exists in this repository, so nothing here can currently claim
  // to be confirmed against the live game UI.
  //
  //   GAME_VERIFIED_EXACT  requires direct current in-game/extracted evidence.
  //                        Nothing meets this bar yet, so it is never assigned
  //                        automatically. It is reserved for entries added by a
  //                        future in-game string extraction pass.
  //   SOURCE_CORROBORATED  trusted source data supports this exact string.
  //
  if (claims.length) notes.push(`Independently corroborated by ${claims.map(c => c.source).join(', ')}.`);
  notes.push('No in-game string extraction exists in this repository, so this name is not promoted to GAME_VERIFIED_EXACT.');
  return {
    status: 'SOURCE_CORROBORATED',
    verifiedName: name,
    rule: claims.length ? 'corroborated-verbatim-source' : 'verbatim-pinned-source',
    notes
  };
}

async function build() {
  const [attachments, ammo, manifest] = await Promise.all([
    readJson('data/attachments.json'),
    readJson('data/ammo.json'),
    readJson('data/source-manifest.json')
  ]);
  const audits = [];
  for (const f of CLASS_AUDIT_FILES) {
    try { audits.push([f, await readJson(`data/${f}.json`)]); } catch { /* optional */ }
  }
  const auditClaims = collectClassAuditNames(audits);

  const upstream = {
    id: 'upstream-dataset',
    repository: manifest.repository,
    commit: manifest.commit,
    files: ['data/attachments.json', 'data/ammo.json'],
    sha256: { 'attachments.json': manifest.sha256?.['attachments.json'] ?? null, 'ammo.json': manifest.sha256?.['ammo.json'] ?? null },
    syncedAt: manifest.generatedAt ?? null
  };

  /** attachmentId -> record. Display name is never used as identity. */
  const records = new Map();
  const add = (id, slot, name, compat, pts) => {
    const key = `${slot}:${id}`;
    const existing = records.get(key);
    if (existing) {
      if (existing.currentDisplayName !== name) existing.nameVariants.add(name);
      if (compat) for (const w of compat) existing.compatibility.add(w);
      if (Number.isFinite(pts)) existing.pointCosts.add(pts);
      return;
    }
    records.set(key, {
      attachmentId: id,
      slot,
      currentDisplayName: name,
      nameVariants: new Set(),
      compatibility: new Set(compat ?? []),
      pointCosts: new Set(Number.isFinite(pts) ? [pts] : [])
    });
  };

  // Compatibility context: which weapons can actually mount each attachment.
  const compatFor = (slot, id) => {
    const out = [];
    for (const [wid, atts] of Object.entries(attachments.WEAPON_ATTS ?? {})) {
      if (Array.isArray(atts?.[slot]) && atts[slot].includes(id)) out.push(wid);
      if (slot === 'barrel' && atts?.barrelDef === id) out.push(wid);
    }
    if (slot === 'ergo') {
      for (const [wid, e] of Object.entries(attachments.WEAPON_ERGO ?? {})) {
        if (Array.isArray(e?.avail) && e.avail.includes(id)) out.push(wid);
      }
    }
    return [...new Set(out)];
  };

  for (const [catalog, slot] of Object.entries(SLOT_OF_CATALOG)) {
    for (const opt of attachments[catalog] ?? []) add(opt.id, slot, opt.name, compatFor(slot, opt.id), Number(opt.pts));
  }
  for (const [wid, cfg] of Object.entries(attachments.WEAPON_MAG ?? {})) {
    for (const [id, m] of Object.entries(cfg?.mags ?? {})) add(id, 'mag', m.name, [wid], Number(m.pts));
  }
  for (const opt of ammo.AMMO ?? []) {
    const compat = Object.entries(ammo.WEAPON_AMMO ?? {}).filter(([, c]) => c?.ammo && id2(c.ammo, opt.id)).map(([w]) => w);
    add(opt.id, 'ammo', opt.name, compat, null);
  }

  const entries = [...records.values()].map(r => {
    const c = classify({ id: r.attachmentId, slot: r.slot, name: r.currentDisplayName, auditClaims });
    const claims = auditClaims.get(r.attachmentId) ?? [];
    const provenance = [...new Set([upstream.id, ...claims.map(x => x.source)])];
    return {
      attachmentId: r.attachmentId,
      internalType: r.slot,
      currentDisplayName: r.currentDisplayName,
      verifiedExactName: c.verifiedName,
      verificationStatus: c.status,
      rule: c.rule,
      evidence: claims.length ? 'corroborated' : 'single-source',
      provenance,
      pointCosts: [...r.pointCosts].sort((a, b) => a - b),
      compatibleWeaponCount: r.compatibility.size,
      compatibleWeapons: [...r.compatibility].sort(),
      conflictingSourceNames: [...r.nameVariants].sort(),
      notes: c.notes
    };
  }).sort((a, b) => a.internalType.localeCompare(b.internalType) || a.attachmentId.localeCompare(b.attachmentId));

  // Display names are not identity: record every string used by more than one id.
  const byName = new Map();
  for (const e of entries) {
    const k = e.currentDisplayName.toLowerCase();
    byName.set(k, [...(byName.get(k) ?? []), `${e.internalType}:${e.attachmentId}`]);
  }
  const sharedDisplayNames = [...byName.entries()].filter(([, ids]) => ids.length > 1)
    .map(([name, ids]) => ({ displayName: name, attachmentIds: ids.sort() }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
  for (const e of entries) {
    if (byName.get(e.currentDisplayName.toLowerCase()).length > 1) e.sharedDisplayName = true;
  }

  const counts = { GAME_VERIFIED_EXACT: 0, SOURCE_CORROBORATED: 0, UNVERIFIED: 0, INTERNAL_PLACEHOLDER: 0, MISMATCH: 0 };
  for (const e of entries) counts[e.verificationStatus]++;

  return {
    schema: 1,
    policyVersion: POLICY_VERSION,
    generatedBy: 'scripts/audit-attachment-names.mjs',
    displayOnly: true,
    affectsOptimizer: false,
    statement: 'Name verification is display-only. It never changes attachment identity, modifiers, point costs, candidate eligibility, budgets or ranking.',
    sources: [
      upstream,
      ...audits.map(([f, a]) => ({ id: `class-audit:${f}`, file: `data/${f}.json`, gameVersion: a.gameVersion ?? null, verifiedAt: a.verifiedAt ?? null, pass: a.pass === true }))
    ],
    statusDefinitions: {
      GAME_VERIFIED_EXACT: 'Strong evidence establishes this is the actual current Battlefield 6 in-game display string. Requires direct current in-game or extracted-string evidence. No entry currently qualifies: this repository holds no in-game string extraction.',
      SOURCE_CORROBORATED: 'Trusted source data supports this exact string - it is carried verbatim from the pinned, hash-verified upstream snapshot and is not a category label or an abbreviation - but direct current in-game confirmation is not available.',
      UNVERIFIED: 'A plausible name exists but the available evidence is insufficient to certify it as the exact in-game label.',
      INTERNAL_PLACEHOLDER: 'A generic/internal/category label rather than a verified Battlefield 6 game label.',
      MISMATCH: 'Two in-repository sources disagree about this attachment id. Both strings are recorded and neither is overwritten.'
    },
    counts,
    total: entries.length,
    sharedDisplayNames,
    attachments: entries
  };
}

// WEAPON_AMMO shape is { ammo: { id: pts } }; helper keeps the scan readable.
function id2(map, id) { return Object.prototype.hasOwnProperty.call(map, id); }

function toCsv(doc) {
  const cols = ['attachmentId', 'internalType', 'currentDisplayName', 'verifiedExactName', 'verificationStatus', 'rule', 'evidence', 'provenance', 'pointCosts', 'compatibleWeaponCount', 'conflictingSourceNames', 'sharedDisplayName', 'notes'];
  const esc = v => {
    const s = Array.isArray(v) ? v.join(' | ') : v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...doc.attachments.map(r => cols.map(c => esc(r[c])).join(','))].join('\n') + '\n';
}

const doc = await build();
const json = JSON.stringify(doc, null, 2) + '\n';
const csv = toCsv(doc);

/**
 * Extract a top-level function body from app.js by brace matching so the gate
 * below can prove the optimizer never touches the display-name layer.
 */
function functionBody(src, name) {
  const at = src.indexOf(`function ${name}(`);
  if (at < 0) return null;
  const open = src.indexOf('{', at);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) return src.slice(open, i + 1); }
  }
  return null;
}

// Functions that decide candidates, modifiers, costs, budgets or ranking.
// None of them may read the naming audit in any form.
const OPTIMIZER_FUNCTIONS = [
  'buildOptions', 'dedupeOptions', 'isAssumedOption', 'scoreOption', 'behaviorScore',
  'opticScore', 'opticRangeFit', 'minimumOpticFit', 'pointCost', 'budgetFor',
  'optimize', 'auditBuild', 'cachedBuild', 'cachedCombat', 'cachedWinningStats',
  'buildRankPool', 'rankWeapons', 'laserbeamUtilityCost', 'resolveAutoWeapon',
  'combatAtDistance', 'damageAtDistance', 'timeToNthShot', 'flightTimeMs', 'addTriggerKill'
];
const NAME_LAYER_TOKENS = ['state.nameAudit', 'attachmentDisplay(', 'nameRecord(', 'buildNameConfidence(', 'NAME_STATUS_UI'];

async function gateSeparation() {
  const errors = [];
  const app = await readFile('app.js', 'utf8');
  for (const fn of OPTIMIZER_FUNCTIONS) {
    const body = functionBody(app, fn);
    if (body === null) { errors.push(`optimizer function ${fn}() not found in app.js`); continue; }
    for (const token of NAME_LAYER_TOKENS) {
      if (body.includes(token)) errors.push(`${fn}() reads the display-name layer (${token}); name verification must never affect optimization`);
    }
  }
  if (!app.includes('audit.affectsOptimizer === false')) errors.push('app.js does not refuse a naming audit that claims to affect the optimizer');
  return errors;
}

if (process.argv.includes('--check')) {
  const errors = await gateSeparation();
  let committed = null;
  try { committed = await readFile('data/attachment-name-audit.json', 'utf8'); }
  catch { errors.push('data/attachment-name-audit.json is missing'); }
  if (committed !== null) {
    const prev = JSON.parse(committed);
    if (prev.policyVersion !== POLICY_VERSION) errors.push(`policy version drift: ${prev.policyVersion} != ${POLICY_VERSION}`);
    if (prev.total !== doc.total) errors.push(`attachment count drift: ${prev.total} != ${doc.total}`);
    for (const k of Object.keys(doc.counts)) {
      if (prev.counts?.[k] !== doc.counts[k]) errors.push(`${k} count drift: ${prev.counts?.[k]} != ${doc.counts[k]}`);
    }
    if (prev.affectsOptimizer !== false) errors.push('audit artifact must declare affectsOptimizer:false');
    if (Object.prototype.hasOwnProperty.call(prev.counts ?? {}, 'VERIFIED_EXACT')) errors.push('artifact still uses the retired VERIFIED_EXACT status');
  }
  if (doc.counts.MISMATCH > 0) {
    console.warn(`ATTACHMENT NAME AUDIT: ${doc.counts.MISMATCH} unresolved MISMATCH record(s) left visible.`);
  }
  if (errors.length) {
    console.error('ATTACHMENT NAME AUDIT FAILED');
    errors.forEach(e => console.error('-', e));
    process.exit(1);
  }
  console.log(`ATTACHMENT NAME AUDIT PASS • ${doc.total} attachments • GAME_VERIFIED_EXACT ${doc.counts.GAME_VERIFIED_EXACT} • SOURCE_CORROBORATED ${doc.counts.SOURCE_CORROBORATED} • UNVERIFIED ${doc.counts.UNVERIFIED} • INTERNAL_PLACEHOLDER ${doc.counts.INTERNAL_PLACEHOLDER} • MISMATCH ${doc.counts.MISMATCH} • optimizer separation gated over ${OPTIMIZER_FUNCTIONS.length} engine functions`);
} else {
  await writeFile('data/attachment-name-audit.json', json);
  await writeFile('data/attachment-name-audit.csv', csv);
  console.log(`Wrote data/attachment-name-audit.json + .csv • ${doc.total} attachments • ${JSON.stringify(doc.counts)}`);
}
