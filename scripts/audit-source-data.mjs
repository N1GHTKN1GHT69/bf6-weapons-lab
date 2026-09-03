#!/usr/bin/env node
/**
 * Weapon factual source-data audit.
 *
 * The optimizer and ranking engine are now validated to a high standard. This
 * audits the layer underneath them: the FACTS they consume. A perfectly
 * validated algorithm over uncertain inputs still produces an uncertain answer,
 * and this file exists so that distinction can never be blurred again.
 *
 * For every field AUTO META depends on it records value, source, source type,
 * verification status, confidence and last-verified date, drawn ONLY from
 * provenance markers already present in the data. Nothing is upgraded because a
 * value "looks right", and no value is changed here at all - this script is
 * read-only with respect to game data.
 *
 * Status vocabulary (deliberately narrow):
 *
 *   VERIFIED         pinned first-party/game-file snapshot AND independently
 *                    re-derived by a passing class audit that covers this field
 *   HIGH_CONFIDENCE  pinned, hash-locked trusted snapshot, no contradicting
 *                    marker, but not independently re-derived
 *   PROVISIONAL      modelled or derived by this project, or carrying an
 *                    explicit "estimated"/"empirical-current" marker
 *   UNVERIFIED       present with no usable provenance, or marked assumed
 *   MISSING          the engine needs it and it is absent
 *
 * A separate STALENESS axis records that a field's snapshot predates the live
 * game version. A field can be VERIFIED against 1.3.3.0 and still be stale.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const j = async p => JSON.parse(await readFile(p, 'utf8'));

const [weapons, ammo, ballistics, manifest, freshness, ledger, redsec] = await Promise.all([
  j('data/weapons.json'), j('data/ammo.json'), j('data/ballistics.json'),
  j('data/source-manifest.json'), j('data/freshness-status.json'),
  j('data/patch-delta-ledger.json'), j('data/redsec-model.json')
]);

const classAudits = {};
for (const [cls, path] of Object.entries({
  'Assault Rifle': 'data/assault-audit.json', Carbine: 'data/carbine-audit.json',
  SMG: 'data/smg-audit.json', LMG: 'data/lmg-audit.json', DMR: 'data/dmr-audit.json',
  'Sniper Rifle': 'data/sniper-audit.json', Shotgun: 'data/shotgun-audit.json',
  Secondary: 'data/sidearm-audit.json'
})) classAudits[cls] = await j(path);

const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const auditDef = (cls, w) => {
  const a = classAudits[cls];
  if (!a?.weapons) return null;
  const keys = new Set([w.id, w.name].map(norm));
  for (const [id, d] of Object.entries(a.weapons)) {
    if (keys.has(norm(id)) || keys.has(norm(d?.name)) || keys.has(norm(d?.upstreamId))) return d;
  }
  return null;
};

const SNAPSHOT_VERSION = (manifest.upstreamBaseline?.sourceVersions ?? []).join(', ') || 'unknown';
const LIVE_VERSION = freshness.official?.gameVersion ?? 'unknown';
const VERIFIED_THROUGH = freshness.verified?.reconciledThrough ?? 'unknown';
const BLOCKED_AT = freshness.verified?.blockedAt ?? null;
const SNAPSHOT_DATE = manifest.upstreamBaseline?.adoptedAsBaseline ?? null;
const LAST_VERIFIED = freshness.verified?.verifiedAt ?? null;

// Patches whose combat deltas are NOT represented in the pinned snapshot.
const unrepresentedPatches = (ledger.patches ?? [])
  .filter(p => p.combatRelevant === true || p.affectsCombat === true)
  .filter(p => {
    const v = p.version ?? p.gameVersion;
    return BLOCKED_AT && cmpVer(v, BLOCKED_AT) >= 0;
  })
  .map(p => p.version ?? p.gameVersion);

function cmpVer(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/**
 * What each field can move. Structural, and stated per field so a reader can
 * challenge any single claim rather than a blanket assertion.
 */
const IMPACT = {
  dmg:        { affects: ['BTK', 'TTK', 'weaponWinner', 'attachmentWinner'], why: 'damage at distance sets BTK directly, and BTK drives TTK, ranking and which ammo/barrel wins' },
  baseDamage: { affects: ['BTK', 'TTK', 'weaponWinner'], why: 'first tier of the same curve' },
  rpm:        { affects: ['TTK', 'weaponWinner'], why: 'shot interval is (btk-1)*60000/rpm; BTK itself is unaffected' },
  bulletVel:  { affects: ['TTK', 'weaponWinner', 'attachmentWinner'], why: 'projectile flight time is added to trigger-to-kill, and barrel/ammo velocity modifiers are scored against it' },
  pellets:    { affects: ['BTK', 'TTK', 'weaponWinner'], why: 'per-shot damage is per-pellet damage x pellets' },
  fireMode:   { affects: ['TTK', 'weaponWinner', 'redsecArmour'], why: 'selects burst/auto cadence, and gates the REDSEC close-range armour rule which applies only to auto' },
  adsTime:    { affects: ['weaponWinner'], why: 'ranking tie-break only' },
  recoilV:    { affects: ['weaponWinner', 'attachmentWinner'], why: 'feeds Beam Index, which is 45% of the BALANCED ranking' },
  recoilVar:  { affects: ['weaponWinner', 'attachmentWinner'], why: 'feeds Beam Index' },
  spreadMax:  { affects: ['weaponWinner', 'attachmentWinner'], why: 'feeds Beam Index' },
  mag:        { affects: [], why: 'initial trigger-to-kill never spans a reload; magazine size does not enter BTK or TTK' },
  tacRld:     { affects: [], why: 'reload time is displayed, not used in initial TTK' },
  emptyRld:   { affects: [], why: 'reload time is displayed, not used in initial TTK' },
  ammoProfile:{ affects: ['BTK', 'TTK', 'attachmentWinner'], why: 'ammo can change per-shot damage and velocity, so it changes the winning build' },
  sweetSpot:  { affects: ['BTK', 'TTK', 'weaponWinner'], why: 'sniper one-shot windows change BTK discontinuously with distance' },
  redsecArmourRule: { affects: ['BTK', 'TTK', 'weaponWinner'], why: 'armour damage curve derivation changes shots-to-break and therefore total BTK' }
};

const rows = [];
const add = r => rows.push(r);

for (const w of weapons) {
  const cls = w.cls;
  const def = auditDef(cls, w);
  const classPass = classAudits[cls]?.pass === true;
  const prov = w.provenance ?? null;
  const estimated = prov?.status === 'estimated';
  const empirical = def?.confidence === 'empirical-current';
  const ballisticExact = (ballistics.weaponIds ?? []).map(norm).includes(norm(w.id));

  const base = { weaponId: w.id, weapon: w.name, cls };

  // ---- damage curve ----
  const dmgFromGameFile = /game-file curve/i.test(w.damageSource ?? '');
  const dmgStatus = estimated ? 'PROVISIONAL'
    : (dmgFromGameFile && classPass && def) ? 'VERIFIED'
    : dmgFromGameFile ? 'HIGH_CONFIDENCE'
    : 'PROVISIONAL';
  add({
    ...base, field: 'dmg',
    value: `${(w.dmg ?? []).length} tiers, ${w.dmg?.[0]?.d ?? '?'} max`,
    source: w.damageSource ?? '(none)',
    sourceType: estimated ? 'project-derived (donor model)' : dmgFromGameFile ? 'pinned game-file snapshot' : 'in-game reading',
    status: dmgStatus,
    confidence: estimated ? 'donor/estimated' : (w.damageStatus ?? 'unknown'),
    reDerivedBy: classPass && def ? `${cls} class audit` : null,
    ...IMPACT.dmg
  });

  // ---- cadence ----
  add({
    ...base, field: 'rpm', value: w.rpm,
    source: manifest.repository, sourceType: 'pinned upstream snapshot',
    status: (classPass && def && (def.rpm != null || def.shotIntervalMs != null)) ? 'VERIFIED' : 'HIGH_CONFIDENCE',
    confidence: empirical ? 'empirical-current' : 'snapshot',
    reDerivedBy: classPass && def ? `${cls} class audit` : null,
    ...IMPACT.rpm
  });

  // ---- projectile velocity ----
  add({
    ...base, field: 'bulletVel', value: w.bulletVel,
    source: ballisticExact ? 'data/ballistics.json verified list' : manifest.repository,
    sourceType: ballisticExact ? 'verified ballistics list' : 'pinned upstream snapshot',
    status: w.bulletVel == null ? 'MISSING' : ballisticExact ? 'VERIFIED' : 'PROVISIONAL',
    confidence: ballisticExact ? 'verified-exact' : 'not in verified ballistics list',
    reDerivedBy: ballisticExact ? 'ballistic TTK audit' : null,
    ...IMPACT.bulletVel
  });

  // ---- magazine / reload (kept in the inventory precisely to show they cannot move a result) ----
  for (const [f, v] of [['mag', w.mag], ['tacRld', w.tacRld], ['emptyRld', w.emptyRld]]) {
    add({
      ...base, field: f, value: v,
      source: manifest.repository, sourceType: 'pinned upstream snapshot',
      status: v == null ? 'MISSING' : 'HIGH_CONFIDENCE',
      confidence: 'snapshot', reDerivedBy: null, ...IMPACT[f]
    });
  }

  // ---- recoil / spread primitives (Beam Index inputs) ----
  for (const f of ['recoilV', 'recoilVar', 'spreadMax', 'adsTime']) {
    add({
      ...base, field: f, value: w[f],
      source: manifest.repository, sourceType: 'pinned upstream snapshot',
      status: w[f] == null ? 'MISSING' : 'HIGH_CONFIDENCE',
      confidence: 'snapshot; not independently re-derived', reDerivedBy: null, ...IMPACT[f]
    });
  }

  // ---- fire mode ----
  add({
    ...base, field: 'fireMode', value: w.fireMode,
    source: manifest.repository, sourceType: 'pinned upstream snapshot',
    status: w.fireMode == null ? 'MISSING' : 'HIGH_CONFIDENCE',
    confidence: 'snapshot', reDerivedBy: null, ...IMPACT.fireMode
  });

  // ---- pellets (shotguns) ----
  if (cls === 'Shotgun') {
    add({
      ...base, field: 'pellets', value: w.pellets,
      source: w.damageSource ?? manifest.repository, sourceType: 'pinned game-file snapshot',
      status: w.pellets == null ? 'MISSING' : classPass ? 'VERIFIED' : 'HIGH_CONFIDENCE',
      confidence: 'shotgun audit; pellet SPREAD and hit probability remain unmodelled',
      reDerivedBy: classPass ? 'Shotgun class audit' : null, ...IMPACT.pellets
    });
  }

  // ---- sniper sweet spot ----
  if (cls === 'Sniper Rifle') {
    add({
      ...base, field: 'sweetSpot',
      value: def?.curve ? `${def.curve.length}-point curve` : null,
      source: classAudits['Sniper Rifle']?.source ?? 'Sniper class audit',
      sourceType: 'class audit over pinned snapshot',
      status: !def?.curve ? 'MISSING' : empirical ? 'PROVISIONAL' : 'VERIFIED',
      confidence: empirical ? 'empirical-current, excluded from verified AUTO' : 'audited',
      reDerivedBy: 'Sniper class audit', ...IMPACT.sweetSpot
    });
  }

  // ---- ammo profile ----
  const wa = ammo.WEAPON_AMMO?.[w.id];
  add({
    ...base, field: 'ammoProfile',
    value: wa ? `${Object.keys(wa.ammo ?? {}).length} options, default ${wa.def}` : null,
    source: manifest.repository, sourceType: 'pinned upstream snapshot',
    status: !wa ? 'MISSING' : 'HIGH_CONFIDENCE',
    confidence: 'snapshot; point costs pinned, per-ammo damage transforms not independently re-derived',
    reDerivedBy: null, ...IMPACT.ammoProfile
  });
}

// ---- REDSEC-specific values, which are model-level rather than per-weapon ----
const redsecRows = [
  { field: 'armourTotalHp', value: redsec.armor?.battleRoyale?.totalHp, status: 'VERIFIED', source: 'EA REDSEC armor community update', sourceType: 'official first-party', confidence: 'stated by EA', ...IMPACT.redsecArmourRule },
  { field: 'armourRangeShiftM', value: redsec.damageVsArmor?.rangeShiftMeters?.value, status: 'VERIFIED', source: 'EA REDSEC armor community update', sourceType: 'official first-party', confidence: 'stated by EA', ...IMPACT.redsecArmourRule },
  { field: 'chestVsArmourMultipliers', value: 'auto 0.84 / DMR 0.91 / sniper 0.67', status: 'VERIFIED', source: 'BF6 Game Update 1.3.3.0', sourceType: 'official first-party', confidence: 'verified-current', ...IMPACT.redsecArmourRule },
  { field: 'closeRangeAutoRule', value: redsec.damageVsArmor?.removeFirstCloseRangeStep?.policy, status: 'PROVISIONAL', source: 'EA REDSEC armor community update ("reduce or remove", unquantified)', sourceType: 'official first-party, qualitative only', confidence: 'DERIVED - one of two readings; changes the armoured winner at some distances', ...IMPACT.redsecArmourRule },
  { field: 'armourBreakSpillover', value: 'none', status: 'UNVERIFIED', source: 'no source addresses it', sourceType: 'none', confidence: 'conservative default; invents no conversion', ...IMPACT.redsecArmourRule },
  { field: 'sniperSweetSpotUnderArmourShift', value: 'shift-all-control-points', status: 'UNVERIFIED', source: 'no source addresses it', sourceType: 'none', confidence: 'armoured sweet-spot sniper results stay provisional', ...IMPACT.sweetSpot }
].map(r => ({ weaponId: '(model)', weapon: 'REDSEC model', cls: 'REDSEC', reDerivedBy: null, ...r }));

const all = [...rows, ...redsecRows];

// ---- Dependency-aware current-patch status (Phase 9/10) -------------------
// A blanket "stale because the snapshot predates the live version" verdict
// treats a weapon nothing has changed for the same as EF88's donor-model
// damage curve. scripts/audit-current-patch-coverage.mjs checked the FULL
// patch ledger against every weapon and recorded which ones are actually named
// by an unresolved, result-affecting delta. Only those get downgraded here.
let patchCoverage = null;
try { patchCoverage = JSON.parse(await readFile('data/current-patch-coverage.json', 'utf8')); }
catch { /* run scripts/audit-current-patch-coverage.mjs first; falls back to blanket staleness below */ }
const affectedFields = new Map(); // weaponId -> Set of field-name fragments named as affected
if (patchCoverage) {
  for (const w of patchCoverage.weaponsAffectedByUnresolvedDelta ?? []) {
    const set = new Set();
    for (const item of w.items) for (const f of item.fields ?? []) {
      // Field entries are free text like "dmg" or "ammo:long_range (proven inert)".
      // Take the leading token before any punctuation/space as the field key.
      const key = String(f).split(/[\s:(]/)[0];
      if (key) set.add(key);
    }
    affectedFields.set(w.weaponId, set);
  }
}

/**
 * Current-patch status taxonomy — CORRECTED 2026-09-03.
 *
 * The previous version mapped status==='VERIFIED' (pinned snapshot value that a
 * class audit re-derives) straight to CURRENT_1_4_2_5_VERIFIED. That was wrong
 * and materially overstated confidence: the class audits re-derive from the SAME
 * pinned 1.3.3.0 snapshot, so agreement between them proves internal
 * consistency, not currency. "No published delta names this field" is also not
 * evidence the field is current - it is evidence that nobody has told us it
 * changed, which is a weaker and different claim.
 *
 * The buckets below are therefore ordered by the STRENGTH OF EVIDENCE ABOUT
 * CURRENCY, and two things are now required rather than inferred:
 *
 *   CURRENT_PATCH_VERIFIED   demands evidence attributable to the CURRENT live
 *                            version - a 1.4.2.5-era measurement, extraction or
 *                            first-party numeric statement. Re-deriving old data
 *                            never qualifies, however rigorously.
 *   VERIFIED_UNCHANGED       demands an AFFIRMATIVE, recorded, targeted check of
 *                            the intervening patches for this specific mechanic,
 *                            finding no change. Incidental silence is not enough.
 *
 * Everything whose only claim is "the ledger names no delta" lands in
 * PATCH_RECONCILED_NO_KNOWN_DELTA and is NOT counted as verified-current.
 */
const ledgerComplete = patchCoverage?.ledgerCompleteness?.verified === true;
const effectiveSnapshotVersion = patchCoverage?.effectiveSnapshotCurrency?.effectiveVersionAtLeast ?? SNAPSHOT_VERSION;
const SNAPSHOT_EXTRACTED = patchCoverage?.effectiveSnapshotCurrency?.extractedOn ?? null;

const CURRENT_PATCH_STATUS = {
  CURRENT_VERIFIED: 'CURRENT_PATCH_VERIFIED',
  VERIFIED_UNCHANGED: 'VERIFIED_UNCHANGED',
  RECONCILED: 'PATCH_RECONCILED_NO_KNOWN_DELTA',
  STALE: 'STALE_NEEDS_RECHECK',
  PROVISIONAL: 'PROVISIONAL',
  MISSING: 'MISSING_UNSUPPORTED'
};

/**
 * Mechanics with an affirmative, recorded, targeted check across every patch
 * between the snapshot and the live version. Each entry names the evidence, so
 * the claim can be challenged rather than taken on trust. Nothing is added here
 * without such a check on record.
 */
const AFFIRMATIVE_UNCHANGED_EVIDENCE = {
  chestVsArmourMultipliers: 'data/redsec-model.json records a targeted check of the 1.4.1.0, 1.4.1.5, 1.4.2.0 and 1.4.2.5 changelogs specifically for armor-chest multiplier changes, finding none (checked 2026-09-02).',
  armourTotalHp: 'EA REDSEC armor update is the standing first-party spec; the 1.4.2.0 and 1.4.2.5 changelogs were fetched and read in full on 2026-09-03 and document no REDSEC armour change.',
  armourRangeShiftM: 'Same targeted changelog reads as armourTotalHp: the +10 m drop-off shift is restated by no later patch and contradicted by none.'
};

for (const r of all) {
  const snapshotBacked = /snapshot|game-file|ballistics|class audit/i.test(r.sourceType || '');
  r.snapshotVersion = snapshotBacked ? SNAPSHOT_VERSION : null;
  r.stale = snapshotBacked && cmpVer(SNAPSHOT_VERSION, LIVE_VERSION) < 0; // kept for backward compatibility only
  r.lastVerified = LAST_VERIFIED;

  if (r.status === 'MISSING') { r.currentPatchStatus = CURRENT_PATCH_STATUS.MISSING; r.currencyEvidence = 'field absent from every checked source'; continue; }
  if (r.status === 'PROVISIONAL' || r.status === 'UNVERIFIED') { r.currentPatchStatus = CURRENT_PATCH_STATUS.PROVISIONAL; r.currencyEvidence = 'known uncertainty in the value or mechanic itself, independent of patch currency'; continue; }

  // A specific unresolved delta names this exact field.
  const namedFields = affectedFields.get(r.weaponId);
  if (namedFields && [...namedFields].some(f => r.field === f || r.field.startsWith(f))) {
    r.currentPatchStatus = CURRENT_PATCH_STATUS.STALE;
    r.currencyEvidence = 'an unresolved published patch delta names this field; value carried forward because no replacement number exists at any evidence tier';
    continue;
  }

  // Affirmative targeted check on record -> VERIFIED_UNCHANGED.
  if (AFFIRMATIVE_UNCHANGED_EVIDENCE[r.field]) {
    r.currentPatchStatus = CURRENT_PATCH_STATUS.VERIFIED_UNCHANGED;
    r.currencyEvidence = AFFIRMATIVE_UNCHANGED_EVIDENCE[r.field];
    continue;
  }

  // Everything else: the ledger is reconciled and names no delta, which is the
  // honest extent of the claim. NOT current-verified.
  r.currentPatchStatus = CURRENT_PATCH_STATUS.RECONCILED;
  // Reconciliation strength matters: a check across a VERIFIED-COMPLETE patch
  // set is far stronger than incidental silence, and it is what lets a
  // reconciled field support HIGH CONFIDENCE trust. It still is not measurement.
  r.reconciliationStrength = ledgerComplete ? 'complete-ledger-targeted-check' : 'incidental-no-delta-found';
  r.effectiveSnapshotVersion = effectiveSnapshotVersion;
  r.currencyEvidence = snapshotBacked
    ? `value from the pinned snapshot (declared ${SNAPSHOT_VERSION}, extracted ${SNAPSHOT_EXTRACTED ?? 'n/a'}, effective content >= ${effectiveSnapshotVersion}); every patch through ${LIVE_VERSION} was enumerated${ledgerComplete ? ' and the set verified COMPLETE' : ''} and none names a change affecting this field. No ${LIVE_VERSION} measurement or extraction exists, so this is reconciliation, not verification.`
    : `no published change affecting it through ${LIVE_VERSION}; not independently confirmed against the live game`;
}

// Nothing may claim CURRENT_PATCH_VERIFIED without live-version evidence. No
// field currently qualifies: there is no 1.4.2.5 game-file extraction, no
// in-game measurement on record, and EA published no numbers in 1.4.2.0 or
// 1.4.2.5. This gate exists so that stops being an assumption and starts being
// an assertion something has to satisfy.
const currentVerifiedClaims = all.filter(r => r.currentPatchStatus === CURRENT_PATCH_STATUS.CURRENT_VERIFIED);

// ---- aggregates ----
const byStatus = {};
for (const r of all) byStatus[r.status] = (byStatus[r.status] || 0) + 1;
const byCurrentPatchStatus = {};
for (const r of all) byCurrentPatchStatus[r.currentPatchStatus] = (byCurrentPatchStatus[r.currentPatchStatus] || 0) + 1;

const movesResult = r => (r.affects ?? []).length > 0;
const uncertain = r => r.status === 'PROVISIONAL' || r.status === 'UNVERIFIED' || r.status === 'MISSING';
const currentPatchUncertain = r => r.currentPatchStatus === CURRENT_PATCH_STATUS.STALE || r.currentPatchStatus === CURRENT_PATCH_STATUS.PROVISIONAL || r.currentPatchStatus === CURRENT_PATCH_STATUS.MISSING;

const priority = all
  .filter(r => uncertain(r) && movesResult(r))
  .sort((a, b) => {
    const rank = s => ({ MISSING: 0, UNVERIFIED: 1, PROVISIONAL: 2 })[s] ?? 3;
    const weight = r => (r.affects.includes('weaponWinner') ? 2 : 0) + (r.affects.includes('BTK') ? 2 : 0) + (r.affects.includes('TTK') ? 1 : 0);
    return rank(a.status) - rank(b.status) || weight(b) - weight(a);
  });

const notVerifiedButMoves = all.filter(r => r.status !== 'VERIFIED' && movesResult(r)).length;

// ---- TWO SEPARATE HEADLINE METRICS, never merged --------------------------
//
// Merging these was the error being corrected. They answer different questions
// and differ by roughly two orders of magnitude:
//
//   KNOWN PATCH-DELTA COVERAGE      "has every published change been reconciled
//                                    against this field?"  -> high
//   CURRENT NUMERICAL VERIFICATION  "has this field's NUMBER been confirmed
//                                    against the live game?" -> very low
//
// A single blended percentage would let the first silently vouch for the second.
const resultAffecting = all.filter(movesResult);
const S = CURRENT_PATCH_STATUS;
const countRA = st => resultAffecting.filter(r => r.currentPatchStatus === st).length;

const raCurrentVerified = countRA(S.CURRENT_VERIFIED);
const raVerifiedUnchanged = countRA(S.VERIFIED_UNCHANGED);
const raReconciled = countRA(S.RECONCILED);
const raStale = countRA(S.STALE);
const raProvisional = countRA(S.PROVISIONAL);
const raMissing = countRA(S.MISSING);

// Reconciled against the published record: everything except fields with an
// outstanding named delta, a known mechanic-level uncertainty, or no value.
const knownPatchDeltaCovered = raCurrentVerified + raVerifiedUnchanged + raReconciled;
// Confirmed against the live version, or affirmatively checked as unchanged
// through it. Carrying an old value forward does NOT count here.
const currentNumericallyVerified = raCurrentVerified + raVerifiedUnchanged;

const affectedWeaponIds = new Set(patchCoverage?.weaponsAffectedByUnresolvedDelta?.map(w => w.weaponId) ?? []);

const summary = {
  generatedAt: new Date().toISOString(),
  liveGameVersion: LIVE_VERSION,
  pinnedSnapshotVersion: SNAPSHOT_VERSION,
  snapshotAdopted: SNAPSHOT_DATE,
  combatVerifiedThrough: VERIFIED_THROUGH,
  blockedAt: BLOCKED_AT,
  patchesWithUnrepresentedCombatDeltas: unrepresentedPatches,
  weaponsAudited: weapons.length,
  weaponsAffectedByUnresolvedDelta: affectedWeaponIds.size,
  weaponsWithNoKnownDelta: weapons.length - affectedWeaponIds.size,
  fieldsAudited: all.length,
  coverage: byStatus,
  currentPatchCoverage: byCurrentPatchStatus,
  fieldsThatCanMoveAResult: resultAffecting.length,
  fieldsThatCanMoveAResultAndAreNotVerified: notVerifiedButMoves,
  resultAffectingBreakdown: {
    CURRENT_PATCH_VERIFIED: raCurrentVerified,
    VERIFIED_UNCHANGED: raVerifiedUnchanged,
    PATCH_RECONCILED_NO_KNOWN_DELTA: raReconciled,
    STALE_NEEDS_RECHECK: raStale,
    PROVISIONAL: raProvisional,
    MISSING_UNSUPPORTED: raMissing
  },
  headline: {
    knownPatchDeltaCoveragePercent: Math.round(100 * knownPatchDeltaCovered / resultAffecting.length),
    knownPatchDeltaCoverageMeaning: 'Share of result-affecting fields with no outstanding published patch delta against them. Says nothing about whether the number itself is current.',
    currentNumericalVerificationPercent: Math.round(100 * currentNumericallyVerified / resultAffecting.length),
    currentNumericalVerificationMeaning: 'Share of result-affecting fields whose value is either confirmed against the live version or affirmatively checked as unchanged through it. Carrying an old value forward on the absence of a delta does NOT count.',
    doNotMerge: 'These two figures measure different things and must always be reported separately.'
  },
  ledgerCompletenessVerified: ledgerComplete,
  effectiveSnapshotVersion,
  staleFields: all.filter(r => r.stale).length,
  topPriority: priority.slice(0, 12).map(r => ({ weapon: r.weapon, field: r.field, status: r.status, currentPatchStatus: r.currentPatchStatus, affects: r.affects, why: r.why }))
};

// The end-to-end verification state the application reads, made DEPENDENCY-
// AWARE (Phase 10): a per-weapon override only exists for a weapon whose own
// result-affecting fields carry an unresolved current-patch delta. A weapon
// absent from weaponOverrides has none - its Multiplayer result is not capped
// merely because some OTHER weapon's data is stale.
const weaponOverrides = {};
for (const w of weapons) {
  const ownRows = all.filter(r => r.weaponId === w.id && movesResult(r));
  if (!ownRows.length) continue;
  const stale = ownRows.filter(r => r.currentPatchStatus === CURRENT_PATCH_STATUS.STALE);
  const missing = ownRows.filter(r => r.currentPatchStatus === CURRENT_PATCH_STATUS.MISSING);
  const provisional = ownRows.filter(r => r.currentPatchStatus === CURRENT_PATCH_STATUS.PROVISIONAL);
  if (!stale.length && !missing.length && !provisional.length) continue; // fully current — no override
  const status = missing.length ? 'MISSING' : stale.length ? 'STALE_NEEDS_RECHECK' : 'PROVISIONAL';
  weaponOverrides[w.id] = {
    status,
    fields: [...stale, ...missing, ...provisional].map(r => r.field),
    reasons: [...stale, ...missing, ...provisional].map(r => `${r.field}: ${r.confidence}`)
  };
}

const endToEnd = {
  schema: 2,
  generatedAt: summary.generatedAt,
  liveGameVersion: LIVE_VERSION,
  pinnedSnapshotVersion: SNAPSHOT_VERSION,
  combatVerifiedThrough: VERIFIED_THROUGH,
  patchesWithUnrepresentedCombatDeltas: unrepresentedPatches,
  coverage: byStatus,
  currentPatchCoverage: byCurrentPatchStatus,
  fieldsThatCanMoveAResult: summary.fieldsThatCanMoveAResult,
  fieldsThatCanMoveAResultAndAreNotVerified: notVerifiedButMoves,
  resultAffectingBreakdown: summary.resultAffectingBreakdown,
  headline: summary.headline,
  staleFields: summary.staleFields,
  weaponsAffectedByUnresolvedDelta: [...affectedWeaponIds],
  // Global summary flag, kept for gates that want one word. VERIFIED only when
  // NO weapon carries an override; per-weapon capping is authoritative for the
  // UI and lives in weaponOverrides below.
  endToEndStatus: Object.keys(weaponOverrides).length === 0 ? 'VERIFIED' : 'PROVISIONAL',
  reasons: [
    affectedWeaponIds.size > 0
      ? `${affectedWeaponIds.size} of ${weapons.length} weapons carry an unresolved published patch delta (see weaponOverrides). The other ${weapons.length - affectedWeaponIds.size} are patch-reconciled with no known delta - which is NOT the same as numerically verified against ${LIVE_VERSION}: only ${currentNumericallyVerified} of ${resultAffecting.length} result-affecting fields have live-version or affirmative-unchanged evidence`
      : null,
    notVerifiedButMoves > 0
      ? `${notVerifiedButMoves} of ${summary.fieldsThatCanMoveAResult} result-moving fields are not independently re-derived`
      : null
  ].filter(Boolean),
  weaponOverrides
};
await writeFile('data/source-verification.json', JSON.stringify(endToEnd, null, 1) + '\n');

await mkdir('reports/overnight', { recursive: true });
await writeFile('reports/overnight/source-data-audit.json', JSON.stringify({ summary, fields: all }, null, 1));
const cols = ['weaponId', 'weapon', 'cls', 'field', 'value', 'status', 'currentPatchStatus', 'reconciliationStrength', 'effectiveSnapshotVersion', 'currencyEvidence', 'confidence', 'sourceType', 'source', 'reDerivedBy', 'snapshotVersion', 'lastVerified', 'affects', 'why'];
await writeFile('reports/overnight/source-data-audit.csv',
  [cols.join(','), ...all.map(r => cols.map(c => JSON.stringify(Array.isArray(r[c]) ? r[c].join('|') : (r[c] ?? '')).replace(/\n/g, ' ')).join(','))].join('\n'));

console.log(JSON.stringify(summary, null, 1));

// Any CURRENT_PATCH_VERIFIED claim must name live-version evidence. Today none
// does, and that is the correct state - but this fails loudly if a future edit
// promotes a field without the evidence to back it.
if (currentVerifiedClaims.length) {
  const unbacked = currentVerifiedClaims.filter(r => !/1\.4\.2\.5|live[- ]game|in-game measurement|extraction/i.test(r.currencyEvidence || ''));
  if (unbacked.length) {
    console.error(`
FAIL: ${unbacked.length} field(s) claim CURRENT_PATCH_VERIFIED without naming live-version evidence`);
    for (const u of unbacked.slice(0, 10)) console.error(`  ${u.weapon} ${u.field}: ${u.currencyEvidence}`);
    process.exit(1);
  }
}

// Gate: nothing may claim VERIFIED without a recorded re-derivation.
const bogus = all.filter(r => r.status === 'VERIFIED' && !r.reDerivedBy && r.sourceType !== 'official first-party');
if (bogus.length) {
  console.error(`\nFAIL: ${bogus.length} fields claim VERIFIED with no recorded independent re-derivation`);
  for (const b of bogus.slice(0, 10)) console.error(`  ${b.weapon} ${b.field}`);
  process.exit(1);
}
console.log('\nPASS: every VERIFIED field records an independent re-derivation or a first-party source.');
