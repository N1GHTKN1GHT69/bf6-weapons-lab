/**
 * Field-level CURRENCY: for a given weapon field, which game version is the value
 * on screen actually attested at, and by what?
 *
 * This exists because "verified" and "current" are different claims and the project
 * has already been burned by conflating them. A class audit re-deriving a value from
 * the same pinned snapshot proves internal consistency, not currency. "No published
 * patch names this field" proves nobody told us it changed, which is weaker still.
 *
 * The only thing that makes a value CURRENT is an attestation from a source that
 * states its own game version - and, crucially, our stored value MATCHING it. Source
 * coverage is not attestation: a source can cover a weapon and disagree with us.
 * attestField() therefore compares, and only reports currency on an exact match.
 *
 * Two-step claim, both steps required:
 *
 *   1. ATTESTED AT   the source capture publishes this exact value at version V.
 *   2. BRIDGED TO    every patch strictly after V, up to the live version, has a
 *                    recorded first-party check finding no numeric weapon-stat
 *                    change. Without that bridge, a value attested at V is current
 *                    for V and nothing later.
 *
 * Step 2 is what lets 1.4.2.0-sourced numbers be honestly called current for a live
 * 1.4.2.5 game, and it is a checkable assertion rather than an assumption.
 */
import { readFileSync } from 'node:fs';
import { readPath } from './source-overlay.mjs';

/**
 * Audit field name -> how to read it out of the source capture.
 *
 * `stat` reads one published stat directly. `derive` computes it from several,
 * using the same rule the dataset itself obeys (verified to <1e-9 across all 62
 * weapons before being relied on here).
 *
 * `statByWeapon` is the documented exception mechanism. The VSSM is the only
 * weapon whose published RoF and SingleRoF differ, because it is the only one with
 * a fire-mode conversion; the base record holds the semi-auto rate, so SingleRoF is
 * the stat that attests it. See scripts/audit-source-overlay.mjs for the gate that
 * keeps those two states from collapsing into one.
 */
export const CURRENCY_FIELDS = {
  rpm: { stat: 'RoF', statByWeapon: { vssm: 'SingleRoF' } },
  bulletVel: { stat: 'velocity' },
  mag: { stat: 'MagSize' },
  recoilVar: { stat: 'ADSRecoilDirectionVariation' },
  spreadMax: { stat: 'ADSStandBaseMax' },
  recoilV: {
    derive: v => v.ADSRecoilAmount * Math.pow(v.ADSRecoilAmountMultiplier, v.ADSRecoilAmountMultiplierExponent),
    from: ['ADSRecoilAmount', 'ADSRecoilAmountMultiplier', 'ADSRecoilAmountMultiplierExponent'],
    rule: 'recoilV = ADSRecoilAmount * ADSRecoilAmountMultiplier ^ ADSRecoilAmountMultiplierExponent'
  }
};

/**
 * Tolerance for "our value is the source's value".
 *
 * The workbook stores rounded figures (830.769) where the mirror carries the exact
 * quotient (830.7692307692307). Those are the same number published to different
 * precision, and treating them as a disagreement would deny currency to a value the
 * source plainly attests. Real deltas in this source are all above 0.9%, five orders
 * of magnitude clear of this.
 */
const MATCH_REL = 1e-5;
const matches = (ours, theirs) =>
  typeof ours === 'number' && typeof theirs === 'number' &&
  (Math.abs(ours - theirs) < 1e-9 || Math.abs(ours - theirs) <= Math.abs(ours) * MATCH_REL);

const norm = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

export function loadCapture(file = 'data/sources/sheetonmyface-bf6-workbook.json') {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
}

const cmpVer = (a, b) => {
  const A = String(a).split('.').map(Number), B = String(b).split('.').map(Number);
  for (let i = 0; i < 4; i++) { if ((A[i] ?? 0) !== (B[i] ?? 0)) return (A[i] ?? 0) - (B[i] ?? 0); }
  return 0;
};

/**
 * The BRIDGE: is a value attested at `sourceVersion` still current at `liveVersion`?
 *
 * Requires every ledger patch strictly after sourceVersion and up to liveVersion to
 * carry `numericWeaponStatDelta: false` with recorded evidence. A patch we have not
 * classified breaks the bridge - deliberately, because silence is not a check.
 *
 * Returns { current: boolean, intervening: [...], reason }.
 */
export function bridgeToLive(ledger, sourceVersion, liveVersion) {
  if (cmpVer(sourceVersion, liveVersion) >= 0) {
    return { current: true, intervening: [], reason: `the source states version ${sourceVersion}, which is not older than the live version ${liveVersion}` };
  }
  const intervening = (ledger.patches ?? []).filter(p => cmpVer(p.version, sourceVersion) > 0 && cmpVer(p.version, liveVersion) <= 0);
  const unclassified = intervening.filter(p => p.numericWeaponStatDelta !== false);
  if (unclassified.length) {
    return {
      current: false,
      intervening: intervening.map(p => p.version),
      reason: `patch(es) ${unclassified.map(p => p.version).join(', ')} between ${sourceVersion} and ${liveVersion} do not carry a recorded numericWeaponStatDelta:false finding, so values attested at ${sourceVersion} cannot be claimed current for ${liveVersion}`
    };
  }
  return {
    current: true,
    intervening: intervening.map(p => p.version),
    reason: intervening.length
      ? `every patch between ${sourceVersion} and ${liveVersion} (${intervening.map(p => p.version).join(', ')}) carries a recorded first-party check finding no numeric weapon-stat change`
      : `no patch shipped between ${sourceVersion} and ${liveVersion}`
  };
}

/**
 * Attest one (weapon, field) against the capture.
 *
 * Returns null when the source does not cover it. Returns { matches:false } when the
 * source covers it and DISAGREES - which is a finding, not an absence, and callers
 * must not silently treat it as unattested.
 */
export function attestField(capture, weapon, field, sourceVersion) {
  const spec = CURRENCY_FIELDS[field];
  if (!spec || !capture) return null;
  const values = capture.values?.[sourceVersion];
  if (!values) return null;

  let sheetName = null;
  for (const name of Object.keys(values)) {
    if (norm(name) === norm(weapon.name) || norm(name) === norm(weapon.id) || norm(name) === norm(String(weapon.name).replace('/', ''))) { sheetName = name; break; }
  }
  if (!sheetName) return null;
  const row = values[sheetName];

  let theirs, stat, rule = null;
  if (spec.derive) {
    if (spec.from.some(s => typeof row[s] !== 'number')) return null;
    theirs = spec.derive(row);
    stat = spec.from.join(' * ');
    rule = spec.rule;
  } else {
    stat = spec.statByWeapon?.[weapon.id] ?? spec.stat;
    theirs = row[stat];
    if (typeof theirs !== 'number') return null;
  }

  const ours = readPath(weapon, field);
  return {
    gameVersion: sourceVersion,
    sourceName: capture.source?.name ?? null,
    publisherOfRecord: capture.source?.publisherOfRecord ?? null,
    sourceStat: stat,
    rule,
    sourceValue: theirs,
    ourValue: typeof ours === 'number' ? ours : null,
    matches: matches(ours, theirs),
    sheetName
  };
}
