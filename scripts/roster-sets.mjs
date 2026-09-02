/**
 * BF6 Weapons Lab — weapon identity sets.
 *
 * Roster correctness used to be expressed as hard-coded counts (56 primaries,
 * 7 secondaries, 62 cache-eligible). Counts cannot detect a substitution: a
 * legitimate weapon disappearing while an unknown one appears keeps the total
 * identical. Every invariant here is therefore expressed over weapon IDENTITY
 * sets, and the counts that remain are derived for reporting only.
 *
 * The sets, per the reconciliation model:
 *   officialExpected  weapons established by curated roster provenance, plus
 *                     any NEW_WEAPON delta recorded in the patch ledger
 *   trustedSource     weapons supplied by the current combat dataset
 *   combatEligible    trusted-source weapons with every required combat field,
 *                     a recognised class, and no empirical-only confidence
 *   cache             weapons actually represented in the exhaustive cache
 *   uiMetadata        weapons carrying optional presentation metadata
 *
 * Nothing here decides that unknown upstream data is correct. A source weapon
 * with no official provenance is quarantined, never promoted.
 */

export const norm = v => String(v ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Roster and source name the sidearm class differently; this is the only mapping. */
export const CLASS_ALIASES = { secondary: 'Sidearm', sidearm: 'Sidearm' };
export const canonicalClass = cls => CLASS_ALIASES[String(cls ?? '').toLowerCase()] ?? String(cls ?? '');

/** Combat fields the optimizer cannot run without. Optional UI metadata is not here. */
export const REQUIRED_COMBAT_FIELDS = ['dmg', 'rpm', 'bulletVel', 'mag'];

export function missingCombatFields(raw) {
  const missing = [];
  if (!Array.isArray(raw?.dmg) || !raw.dmg.length ||
      !raw.dmg.every(p => Number.isFinite(Number(p?.r)) && Number.isFinite(Number(p?.d)))) missing.push('dmg');
  for (const f of ['rpm', 'bulletVel', 'mag']) if (!(Number(raw?.[f]) > 0)) missing.push(f);
  if (!raw?.cls) missing.push('cls');
  return missing;
}

/**
 * Build every identity set plus the relationships between them.
 *
 * @param {object} input
 *   roster        BF6_CURRENT (curated provenance roster)
 *   weapons       data/weapons.json
 *   ledger        data/patch-delta-ledger.json (optional)
 *   audits        { [canonicalClass]: auditJson } (optional, for eligibility)
 *   cacheIds      ids present in the exhaustive cache (optional)
 */
export function buildWeaponSets({ roster, weapons, ledger = null, audits = {}, cacheIds = null }) {
  const recognisedClasses = new Set([
    ...(roster?.primaryClasses ?? []).map(canonicalClass),
    'Sidearm'
  ]);

  const rosterEntries = (roster?.roster ?? []).map(w => ({
    id: w.id, key: norm(w.id), name: w.name, nameKey: norm(w.name),
    cls: canonicalClass(w.cls),
    // Optional presentation metadata. Never required for combat ingestion.
    uiMetadata: { unlock: w.unlock ?? null, desc: w.desc ?? null }
  }));

  // Weapons the official patch ledger says exist, even if the curated roster or
  // the trusted source has not caught up yet.
  const ledgerWeapons = [];
  for (const p of ledger?.patches ?? []) {
    for (const ch of p.changes ?? []) {
      if (ch.check?.type === 'weaponPresent' && ch.check.weaponId) {
        ledgerWeapons.push({ id: ch.check.weaponId, key: norm(ch.check.weaponId), patch: p.version, blocking: !!ch.blocking });
      }
    }
  }

  const officialExpected = new Map();
  for (const e of rosterEntries) officialExpected.set(e.key, { ...e, provenance: 'curated-roster' });
  for (const l of ledgerWeapons) {
    if (!officialExpected.has(l.key)) officialExpected.set(l.key, { id: l.id, key: l.key, name: l.id, nameKey: l.key, cls: null, uiMetadata: {}, provenance: `patch-ledger:${l.patch}` });
    else officialExpected.get(l.key).ledgerPatch = l.patch;
  }

  const sourceByKey = new Map();
  for (const w of weapons ?? []) {
    sourceByKey.set(norm(w.id), w);
    if (!sourceByKey.has(norm(w.name))) sourceByKey.set(norm(w.name), w);
  }
  const trustedSource = new Map();
  for (const w of weapons ?? []) trustedSource.set(norm(w.id), w);

  const resolveSource = expected => sourceByKey.get(expected.key) ?? sourceByKey.get(expected.nameKey) ?? null;

  // --- relationships -------------------------------------------------------
  const expectedMissingFromSource = [];   // official weapon the dataset lacks
  const combatEligible = new Map();
  const ineligible = [];

  for (const e of officialExpected.values()) {
    const raw = resolveSource(e);
    if (!raw) {
      const pendingPatch = ledgerWeapons.find(l => l.key === e.key)?.patch ?? null;
      expectedMissingFromSource.push({ id: e.id, name: e.name, provenance: e.provenance, pendingPatch });
      continue;
    }
    const missing = missingCombatFields(raw);
    const cls = canonicalClass(raw.cls);
    if (missing.length) { ineligible.push({ id: raw.id, reason: `missing required combat fields: ${missing.join(', ')}` }); continue; }
    if (!recognisedClasses.has(cls)) { ineligible.push({ id: raw.id, reason: `unrecognised class "${raw.cls}"` }); continue; }
    // Empirical-only confidence is modelled but excluded from cache generation.
    const audit = audits?.[cls] ?? null;
    const def = audit ? findAuditDef(audit, e, raw) : null;
    if (def?.confidence === 'empirical-current') { ineligible.push({ id: raw.id, reason: 'empirical-current confidence' }); continue; }
    combatEligible.set(norm(raw.id), { id: raw.id, name: raw.name, cls });
  }

  // Source weapons with no official provenance must be quarantined, not trusted.
  const expectedKeys = new Set();
  for (const e of officialExpected.values()) {
    expectedKeys.add(e.key);
    expectedKeys.add(e.nameKey);
  }
  const unexpectedSource = [];
  for (const w of weapons ?? []) {
    if (!expectedKeys.has(norm(w.id)) && !expectedKeys.has(norm(w.name))) {
      unexpectedSource.push({ id: w.id, name: w.name, cls: w.cls });
    }
  }

  const eligibleIds = new Set(combatEligible.keys());
  let cacheDelta = null;
  if (cacheIds) {
    const cache = new Set([...cacheIds].map(norm));
    cacheDelta = {
      missingFromCache: [...eligibleIds].filter(id => !cache.has(id)),
      extraInCache: [...cache].filter(id => !eligibleIds.has(id))
    };
  }

  const byClass = {};
  for (const v of combatEligible.values()) byClass[v.cls] = (byClass[v.cls] ?? 0) + 1;

  return {
    recognisedClasses: [...recognisedClasses],
    officialExpected: [...officialExpected.values()],
    trustedSourceIds: [...trustedSource.keys()],
    combatEligible: [...combatEligible.values()],
    combatEligibleIds: [...eligibleIds],
    ineligible,
    expectedMissingFromSource,
    unexpectedSource,
    cacheDelta,
    // Derived for reporting only. Never an invariant.
    counts: {
      officialExpected: officialExpected.size,
      trustedSource: trustedSource.size,
      combatEligible: combatEligible.size,
      primaries: [...combatEligible.values()].filter(w => w.cls !== 'Sidearm').length,
      sidearms: [...combatEligible.values()].filter(w => w.cls === 'Sidearm').length,
      byClass
    }
  };
}

function findAuditDef(audit, expected, raw) {
  const keys = new Set([expected.key, expected.nameKey, norm(raw?.id), norm(raw?.name)]);
  for (const [id, d] of Object.entries(audit?.weapons ?? {})) {
    if (keys.has(norm(id)) || keys.has(norm(d?.name)) || keys.has(norm(d?.upstreamId))) return d;
  }
  return null;
}

/**
 * Turn the sets into pass/fail findings. A weapon missing from the source is
 * only tolerated when the patch ledger already records it as an unresolved
 * delta: that is the same evidence that holds verifiedCombatVersion back.
 */
export function evaluateWeaponSets(sets, { ledgerPendingWeaponKeys = new Set() } = {}) {
  const errors = [], warnings = [];

  for (const m of sets.expectedMissingFromSource) {
    if (ledgerPendingWeaponKeys.has(norm(m.id))) {
      warnings.push(`${m.id} is officially expected (${m.provenance}) but absent from the trusted source; the patch ledger already holds ${m.pendingPatch ?? 'its patch'} pending.`);
    } else {
      errors.push(`${m.id} is officially expected (${m.provenance}) but missing from the trusted combat source, and no patch-ledger delta accounts for it`);
    }
  }
  for (const u of sets.unexpectedSource) {
    errors.push(`QUARANTINE: source weapon "${u.id}" (${u.name}) has no official provenance in the curated roster or patch ledger`);
  }
  for (const i of sets.ineligible) {
    warnings.push(`${i.id} is not combat-eligible: ${i.reason}`);
  }
  if (sets.cacheDelta) {
    if (sets.cacheDelta.missingFromCache.length) errors.push(`combat-eligible weapons absent from the cache: ${sets.cacheDelta.missingFromCache.join(', ')}`);
    if (sets.cacheDelta.extraInCache.length) errors.push(`cache contains weapons that are not combat-eligible: ${sets.cacheDelta.extraInCache.join(', ')}`);
  }
  if (!sets.combatEligible.length) errors.push('no combat-eligible weapons resolved');
  for (const w of sets.combatEligible) {
    if (!sets.recognisedClasses.includes(w.cls)) errors.push(`${w.id}: class "${w.cls}" is not a recognised optimizer class`);
  }
  return { errors, warnings };
}
