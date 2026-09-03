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

// Everything sourced from the pinned snapshot inherits its patch lag.
for (const r of all) {
  const snapshotBacked = /snapshot|game-file|ballistics|class audit/i.test(r.sourceType || '');
  r.snapshotVersion = snapshotBacked ? SNAPSHOT_VERSION : null;
  r.stale = snapshotBacked && cmpVer(SNAPSHOT_VERSION, LIVE_VERSION) < 0;
  r.lastVerified = LAST_VERIFIED;
}

// ---- aggregates ----
const byStatus = {};
for (const r of all) byStatus[r.status] = (byStatus[r.status] || 0) + 1;

const movesResult = r => (r.affects ?? []).length > 0;
const uncertain = r => r.status === 'PROVISIONAL' || r.status === 'UNVERIFIED' || r.status === 'MISSING';

const priority = all
  .filter(r => uncertain(r) && movesResult(r))
  .sort((a, b) => {
    const rank = s => ({ MISSING: 0, UNVERIFIED: 1, PROVISIONAL: 2 })[s] ?? 3;
    const weight = r => (r.affects.includes('weaponWinner') ? 2 : 0) + (r.affects.includes('BTK') ? 2 : 0) + (r.affects.includes('TTK') ? 1 : 0);
    return rank(a.status) - rank(b.status) || weight(b) - weight(a);
  });

const notVerifiedButMoves = all.filter(r => r.status !== 'VERIFIED' && movesResult(r)).length;

const summary = {
  generatedAt: new Date().toISOString(),
  liveGameVersion: LIVE_VERSION,
  pinnedSnapshotVersion: SNAPSHOT_VERSION,
  snapshotAdopted: SNAPSHOT_DATE,
  combatVerifiedThrough: VERIFIED_THROUGH,
  blockedAt: BLOCKED_AT,
  patchesWithUnrepresentedCombatDeltas: unrepresentedPatches,
  weaponsAudited: weapons.length,
  fieldsAudited: all.length,
  coverage: byStatus,
  fieldsThatCanMoveAResult: all.filter(movesResult).length,
  fieldsThatCanMoveAResultAndAreNotVerified: notVerifiedButMoves,
  staleFields: all.filter(r => r.stale).length,
  topPriority: priority.slice(0, 12).map(r => ({ weapon: r.weapon, field: r.field, status: r.status, affects: r.affects, why: r.why }))
};

// The end-to-end verification state the application reads. A fully validated
// algorithm over stale or unverified inputs is still an unverified ANSWER, and
// this file is what stops the UI implying otherwise.
const endToEnd = {
  schema: 1,
  generatedAt: summary.generatedAt,
  liveGameVersion: LIVE_VERSION,
  pinnedSnapshotVersion: SNAPSHOT_VERSION,
  combatVerifiedThrough: VERIFIED_THROUGH,
  patchesWithUnrepresentedCombatDeltas: unrepresentedPatches,
  coverage: byStatus,
  fieldsThatCanMoveAResult: summary.fieldsThatCanMoveAResult,
  fieldsThatCanMoveAResultAndAreNotVerified: notVerifiedButMoves,
  staleFields: summary.staleFields,
  // Derived, never hand-set.
  endToEndStatus:
    (notVerifiedButMoves === 0 && summary.staleFields === 0) ? 'VERIFIED' : 'PROVISIONAL',
  reasons: [
    summary.staleFields > 0
      ? `${summary.staleFields} of ${all.length} fields come from a ${SNAPSHOT_VERSION} snapshot while the live game is ${LIVE_VERSION}${unrepresentedPatches.length ? ` (unrepresented combat patches: ${unrepresentedPatches.join(', ')})` : ''}`
      : null,
    notVerifiedButMoves > 0
      ? `${notVerifiedButMoves} of ${summary.fieldsThatCanMoveAResult} result-moving fields are not independently re-derived`
      : null
  ].filter(Boolean)
};
await writeFile('data/source-verification.json', JSON.stringify(endToEnd, null, 1) + '\n');

await mkdir('reports/overnight', { recursive: true });
await writeFile('reports/overnight/source-data-audit.json', JSON.stringify({ summary, fields: all }, null, 1));
const cols = ['weaponId', 'weapon', 'cls', 'field', 'value', 'status', 'confidence', 'sourceType', 'source', 'reDerivedBy', 'snapshotVersion', 'stale', 'lastVerified', 'affects', 'why'];
await writeFile('reports/overnight/source-data-audit.csv',
  [cols.join(','), ...all.map(r => cols.map(c => JSON.stringify(Array.isArray(r[c]) ? r[c].join('|') : (r[c] ?? '')).replace(/\n/g, ' ')).join(','))].join('\n'));

console.log(JSON.stringify(summary, null, 1));

// Gate: nothing may claim VERIFIED without a recorded re-derivation.
const bogus = all.filter(r => r.status === 'VERIFIED' && !r.reDerivedBy && r.sourceType !== 'official first-party');
if (bogus.length) {
  console.error(`\nFAIL: ${bogus.length} fields claim VERIFIED with no recorded independent re-derivation`);
  for (const b of bogus.slice(0, 10)) console.error(`  ${b.weapon} ${b.field}`);
  process.exit(1);
}
console.log('\nPASS: every VERIFIED field records an independent re-derivation or a first-party source.');
