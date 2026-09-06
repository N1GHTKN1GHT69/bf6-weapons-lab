#!/usr/bin/env node
/**
 * CLASS-AUDIT PIN PROVENANCE — which audited value is actually operative, and where did
 * it come from?
 *
 * WHY THIS EXISTS, AND A CORRECTION. The previous pass measured that halving every
 * `raw.dmg` tier changed nothing on the ranked path, and concluded that class audits
 * SHADOW the raw damage. That conclusion was too strong, and this tool exists partly to
 * correct it.
 *
 * The measurement was taken through `diag.perturb`, which deliberately bypasses the
 * exhaustive cache - so what it actually observed was the FALLBACK path, where
 * `auditedRosterCombat` supplies the numbers. In production with a valid cache, ranking
 * reads the CACHE first (`cachedCombat`), and the cache was built from `raw.dmg` through
 * the upstream damage function for most classes. So for those classes `raw.dmg` is
 * operative after all, and the audit `ranges` are an independent RE-DERIVATION that
 * happens to agree - which is exactly what makes them a useful cross-check rather than
 * an override.
 *
 * The exceptions are real and matter:
 *   Shotguns  the audit's ammoProfiles ARE operative. The cache carries 89.6 for the
 *             M87A1 at 25 m where the raw per-pellet curve gives 5.6; the audit supplies
 *             the shell-level profile the engine uses.
 *   Snipers   the audit's curve and shotIntervalMs feed the cache build directly
 *             (_sniperAuditDef), overriding the upstream nominal RPM/damage path.
 *   DMRs      the audit `ranges` are a rounded restatement and DIVERGE slightly from raw
 *             (LMR27: 27.30 audited vs 27.5 raw at 25 m). The cache follows raw, so the
 *             audit rounding is a display/cross-check artefact, not the operative value.
 *
 * HOW OPERATIVENESS IS DECIDED - mechanically, never by reading a comment:
 *   for every weapon and distance, compare the CACHED value against the value derived
 *   from the raw curve and the value derived from the audit pin.
 *     cache == raw only    -> RAW OPERATIVE (audit is a concordant cross-check or diverges harmlessly)
 *     cache == audit only  -> AUDIT OPERATIVE (a genuine override)
 *     both agree           -> CONCORDANT (indistinguishable; the audit confirms rather than overrides)
 *     neither              -> UNEXPLAINED (a finding)
 *
 * Usage: node scripts/audit-class-audit-provenance.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { steppedDamageAt, sniperDamageAt, ttkMs, pairedShotgunTtkMs } from './reference-engine.mjs';
import { loadEffectiveWeapons } from './source-overlay.mjs';

const j = async p => JSON.parse(await readFile(p, 'utf8'));
const cache = await j('data/combat-cache.json');
const weapons = loadEffectiveWeapons('data/weapons.json');
const capture = await j('data/sources/sheetonmyface-bf6-workbook.json').catch(() => null);

const AUDIT_FILES = {
  'Assault Rifle': 'assault', Carbine: 'carbine', SMG: 'smg', LMG: 'lmg',
  DMR: 'dmr', 'Sniper Rifle': 'sniper', Shotgun: 'shotgun', Sidearm: 'sidearm', Secondary: 'sidearm'
};
const audits = {};
for (const [cls, f] of Object.entries(AUDIT_FILES)) {
  if (audits[cls]) continue;
  audits[cls] = await j(`data/${f}-audit.json`).catch(() => null);
}

const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
function auditDefFor(w) {
  const a = audits[w.cls];
  if (!a?.weapons) return null;
  for (const [k, d] of Object.entries(a.weapons)) {
    if (norm(k) === norm(w.id) || norm(d?.name) === norm(w.name) || norm(d?.upstreamId) === norm(w.id)) {
      return { audit: a, file: `data/${AUDIT_FILES[w.cls]}-audit.json`, key: k, def: d };
    }
  }
  return null;
}

/** What the source workbook publishes for this weapon, when it covers it. */
const liveVersion = capture?.tabs?.['Sym.gg Data']?.gameVersions?.[0] ?? null;
function sourceRow(w) {
  if (!capture || !liveVersion) return null;
  for (const name of Object.keys(capture.values[liveVersion])) {
    if (norm(name) === norm(w.name) || norm(name) === norm(w.id) || norm(name) === norm(String(w.name).replace('/', ''))) {
      return { name, row: capture.values[liveVersion][name] };
    }
  }
  return null;
}

const DISTANCES = [1, 10, 25, 50, 75, 100, 150, 200, 300];
const near = (a, b, tol = 0.02) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tol;

const pins = [];
const errors = [];
const unexplained = [];

for (const w of weapons) {
  const cw = cache.weapons?.[w.id];
  const found = auditDefFor(w);
  if (!found) { errors.push(`${w.id}: no class-audit definition found in ${AUDIT_FILES[w.cls] ?? '(no audit for class)'}`); continue; }
  const { def, file, audit } = found;
  const src = sourceRow(w);

  // ---------------------------------------------------------------- DAMAGE
  if (cw) {
    let rawOnly = 0, auditOnly = 0, concordant = 0, neither = 0, compared = 0;
    const samples = [];
    for (const d of DISTANCES) {
      const row = cw.best?.[String(d)];
      if (!row || !Number.isFinite(row.damage)) continue;
      compared++;
      const rawD = def.curve ? sniperDamageAt(def.curve, d) : steppedDamageAt(w.dmg, d);
      const rawStep = steppedDamageAt(w.dmg, d);
      // Shotguns carry a PER-AMMO profile, and the cache follows the profile for the
      // ammo the winning build actually equips. Comparing against the default `ranges`
      // reports a false mismatch whenever the winner picked slugs or flechette - which
      // is what an earlier version of this tool did on the M1014 and the 18.5KS-K.
      let auditD = null;
      const ammoId = cw.builds?.[row.buildId]?.atts?.ammo;
      const profile = def.ammoProfiles?.[ammoId] ?? null;
      if (profile?.ranges) { const r = profile.ranges.find(x => d >= x.min && d <= x.max); auditD = r ? Number(r.damage) : null; }
      else if (Array.isArray(def.ranges)) { const r = def.ranges.find(x => d >= x.min && d <= x.max); auditD = r ? Number(r.damage) : null; }
      else if (Array.isArray(def.curve)) auditD = sniperDamageAt(def.curve, d);
      const mRaw = near(row.damage, rawStep);
      const mAudit = auditD != null && near(row.damage, auditD);
      if (mRaw && mAudit) concordant++;
      else if (mRaw) rawOnly++;
      else if (mAudit) auditOnly++;
      else { neither++; if (samples.length < 3) samples.push({ d, cached: row.damage, fromRaw: rawStep, fromAudit: auditD }); }
      void rawD;
    }
    const verdict = neither > 0 ? 'UNEXPLAINED'
      : auditOnly > 0 && rawOnly === 0 ? 'AUDIT OPERATIVE'
      : rawOnly > 0 && auditOnly === 0 ? 'RAW OPERATIVE'
      : concordant === compared ? 'CONCORDANT'
      : 'MIXED';
    if (verdict === 'UNEXPLAINED') unexplained.push({ weaponId: w.id, field: 'damage', samples });
    pins.push({
      weaponId: w.id, weapon: w.name, cls: w.cls, field: 'damage', auditFile: file,
      auditRepresentation: Array.isArray(def.curve) ? 'linear curve' : Array.isArray(def.ranges) ? `${def.ranges.length} range bands` : '(none)',
      distancesCompared: compared, matchedRawOnly: rawOnly, matchedAuditOnly: auditOnly, matchedBoth: concordant, matchedNeither: neither,
      operative: verdict,
      movesPublishedResults: true,
      consumers: ['combat cache damage rows', 'BTK', 'TTK', 'ranking'],
      sourceOfRecord: def.curveSource ?? w.damageSource ?? '(weapon record damageSource)',
      currentness: 'the SOURCE of the damage curve is not published by the Sym dump at any version; see the coverage audit. The audit pin itself is a re-derivation, not an independent source.',
      samples
    });
  }

  // ---------------------------------------------------------------- CADENCE
  {
    const auditRpm = Number(def.rpm ?? def.displayRpm);
    const auditInterval = Number(def.shotIntervalMs);
    const cadence = Array.isArray(def.cadence) ? null : def.cadence;
    const rawRpm = Number(w.rpm);
    const srcRoF = src?.row?.RoF, srcSingle = src?.row?.SingleRoF;
    // Which one does the cache follow? Recompute a TTK both ways and compare.
    let operative = 'NOT COMPARED', evidence = '';
    const cwRow = cw?.best?.['25'];
    const build = cwRow ? cw.builds?.[cwRow.buildId] : null;
    if (cwRow && build && Number.isFinite(cwRow.btk) && cwRow.btk > 1) {
      const stats = { ...build.stats, burstRpm: w.burstRpm, burstBurstsPerMinute: w.burstBurstsPerMinute };
      const fromRaw = ttkMs(stats, cwRow.btk, null);
      const fromInterval = Number.isFinite(auditInterval) && auditInterval > 0 ? ttkMs(stats, cwRow.btk, auditInterval) : null;
      // A double-barrel fires two shells fast, then waits out the reload cycle, so its
      // cadence is PAIRED rather than constant. Treating it as constant reported the
      // DB-12 as unexplained when the model is simply a different shape.
      const fromCadence = cadence?.type === 'constant' && Number(cadence.rpm) > 0
        ? ttkMs(stats, cwRow.btk, 60000 / Number(cadence.rpm))
        : cadence?.type === 'paired'
          ? pairedShotgunTtkMs(cadence, cwRow.btk)
          : null;
      const mRaw = near(cwRow.ttk, fromRaw, 1);
      const mInt = fromInterval != null && near(cwRow.ttk, fromInterval, 1);
      const mCad = fromCadence != null && near(cwRow.ttk, fromCadence, 1);
      operative = mInt && !mRaw ? 'AUDIT INTERVAL OPERATIVE'
        : mCad && !mRaw ? 'AUDIT CADENCE OPERATIVE'
        : mRaw && (mInt || mCad) ? 'CONCORDANT'
        : mRaw ? 'RAW RPM OPERATIVE'
        : 'UNEXPLAINED';
      evidence = `cached ttk ${cwRow.ttk} at ${cwRow.btk} btk; from build rpm ${fromRaw}${fromInterval != null ? `, from audited interval ${fromInterval}` : ''}${fromCadence != null ? `, from audited cadence ${fromCadence}` : ''}`;
      if (operative === 'UNEXPLAINED') unexplained.push({ weaponId: w.id, field: 'cadence', evidence });
    }
    pins.push({
      weaponId: w.id, weapon: w.name, cls: w.cls, field: 'cadence', auditFile: file,
      auditedRpm: Number.isFinite(auditRpm) ? auditRpm : null,
      auditedShotIntervalMs: Number.isFinite(auditInterval) ? auditInterval : null,
      auditedCadence: cadence ?? null,
      rawRpm,
      sourcePublishes: srcRoF != null ? { RoF: srcRoF, SingleRoF: srcSingle } : null,
      matchesSource: srcRoF != null ? (near(rawRpm, Number(srcRoF), Math.abs(rawRpm) * 1e-5) ? 'raw rpm = source RoF'
        : near(rawRpm, Number(srcSingle), Math.abs(rawRpm) * 1e-5) ? 'raw rpm = source SingleRoF (fire-mode state)' : 'NO MATCH') : 'source does not cover this weapon',
      operative, evidence,
      movesPublishedResults: true,
      consumers: ['TTK', 'ranking'],
      currentness: srcRoF != null ? `source-verified at ${liveVersion}` : 'no current source covers this weapon'
    });
  }

  // ---------------------------------------------------------------- VELOCITY
  {
    // Compare LIKE WITH LIKE. The DMR audit records baseVelocity AND equippedVelocity,
    // the latter being the base figure times a barrel multiplier (760 -> 950 for a +25%
    // barrel, 760 -> 608 for a -20% short barrel). An earlier version preferred
    // equippedVelocity and reported four DMRs as diverging from raw when they do not:
    // every baseVelocity matches both the raw record and the source exactly.
    const auditVel = Number(def.bulletVel ?? def.baseVelocity);
    const equippedVel = Number(def.equippedVelocity);
    const srcVel = src?.row?.velocity;
    if (Number.isFinite(auditVel) || Number.isFinite(Number(srcVel))) {
      pins.push({
        weaponId: w.id, weapon: w.name, cls: w.cls, field: 'bulletVel', auditFile: file,
        auditedValue: Number.isFinite(auditVel) ? auditVel : null,
        auditedEquippedValue: Number.isFinite(equippedVel) ? equippedVel : null,
        equippedIsDerived: Number.isFinite(equippedVel) && Number.isFinite(auditVel) && equippedVel !== auditVel
          ? `equipped = base x ${(equippedVel / auditVel).toFixed(4)} (a barrel multiplier, not an independent value)` : null,
        rawValue: Number(w.bulletVel),
        sourceValue: srcVel ?? null,
        agreement: Number.isFinite(auditVel) && near(auditVel, Number(w.bulletVel), 1) ? 'audit base = raw'
          : Number.isFinite(auditVel) ? 'AUDIT DIVERGES FROM RAW' : 'audit does not pin velocity',
        sourceAgreement: srcVel != null ? (near(Number(w.bulletVel), Number(srcVel), 1) ? 'raw = source' : 'RAW DIVERGES FROM SOURCE') : 'not covered',
        provenanceNote: def.bulletVelSource ?? null,
        history: def.bulletVelHistory ?? null,
        movesPublishedResults: true,
        consumers: ['flight time', 'trigger-to-kill', 'ranking'],
        currentness: srcVel != null ? `source-verified at ${liveVersion}` : 'no current source covers this weapon'
      });
    }
  }
}

// ------------------------------------------------------------------ rollup
const byField = {};
for (const p of pins) {
  const k = `${p.cls}|${p.field}`;
  (byField[k] ??= { cls: p.cls, field: p.field, weapons: 0, verdicts: {} });
  byField[k].weapons++;
  const v = p.operative ?? p.agreement ?? 'n/a';
  byField[k].verdicts[v] = (byField[k].verdicts[v] ?? 0) + 1;
}

const report = {
  generatedAt: new Date().toISOString(),
  question: 'For every class-audit pin, is the AUDIT value or the RAW value the one production actually uses - and what is each one\'s provenance?',
  method: 'Operativeness is decided by comparing the CACHED production value against a value derived from the raw record and a value derived from the audit pin, at nine distances. Reading comments is not evidence.',
  correctsPreviousFinding: 'The previous pass concluded that class audits SHADOW raw.dmg. That was measured through diag.perturb, which bypasses the cache, so it described the FALLBACK path. In production the cache is primary and was built from raw.dmg for most classes. The genuine audit overrides are shotgun ammoProfiles and the sniper curve/interval.',
  sourceVersion: liveVersion,
  pinCount: pins.length,
  rollup: Object.values(byField),
  unexplained,
  pins,
  errors
};
await mkdir('reports/validation', { recursive: true });
await writeFile('reports/validation/class-audit-provenance.json', JSON.stringify(report, null, 1));

console.log(`class-audit provenance — ${pins.length} pins across ${weapons.length} weapons\n`);
console.log('  CLASS            FIELD      VERDICTS');
for (const r of Object.values(byField).sort((a, b) => a.cls.localeCompare(b.cls) || a.field.localeCompare(b.field))) {
  console.log(`  ${r.cls.padEnd(16)} ${r.field.padEnd(10)} ${Object.entries(r.verdicts).map(([k, v]) => `${k} x${v}`).join(', ')}`);
}
if (unexplained.length) {
  console.error(`\nUNEXPLAINED (${unexplained.length}) — the cached value matches neither the raw nor the audited derivation:`);
  for (const u of unexplained.slice(0, 12)) console.error(`  ${u.weaponId} ${u.field}: ${JSON.stringify(u.samples ?? u.evidence).slice(0, 200)}`);
}
if (errors.length) console.error('\nERRORS:\n  ' + errors.join('\n  '));
console.log('\nwrote reports/validation/class-audit-provenance.json');
process.exitCode = (unexplained.length || errors.length) ? 1 : 0;
