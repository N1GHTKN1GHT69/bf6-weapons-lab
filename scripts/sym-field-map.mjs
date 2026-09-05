/**
 * The ONE mapping from Sym source stat names to this project's weapon schema.
 *
 * Three consumers share it, and they must not drift:
 *   scripts/build-source-overlay.mjs   derives what to ingest
 *   scripts/audit-source-overlay.mjs   re-verifies what was ingested
 *   scripts/watch-source-workbook.mjs  decides whether a source change matters
 *
 * That last one is why this lives in its own module. A freshness watcher that
 * hashed the whole workbook would fire on a formatting tweak, a new chart tab or
 * a recalculated timestamp. Fingerprinting exactly the fields below - the ones
 * that can actually reach a combat number - is what makes "did anything we use
 * change?" answerable without rebuilding anything.
 *
 * Every entry is either name-identical (ADSRecoilAmount -> recoil.ads.amount) or
 * structurally unambiguous (ADSStandBaseMin/Max are the two elements of
 * spread.adsStand). Validated before use: across the 55 weapons the workbook
 * archives at 1.3.3.0 these pairings agree with our upstream mirror on 3630 of
 * 3630 comparisons.
 */

/** @type {{stat: string, path: string, combat: boolean}[]} */
export const SYM_FIELD_MAP = [];
const put = (stat, path) => SYM_FIELD_MAP.push({ stat, path, combat: true });

put('velocity', 'bulletVel');
put('RoF', 'rpm');
put('MagSize', 'mag');
put('ReloadSpeed', 'reloadSpeed');
put('ADSStandBaseMin', 'spread.adsStand[0]');
put('ADSStandBaseMax', 'spread.adsStand[1]');
put('ADSStandMoveMin', 'spread.adsMove[0]');
put('ADSStandMoveMax', 'spread.adsMove[1]');
put('HIPStandBaseMin', 'spread.hipStand[0]');
put('HIPStandBaseMax', 'spread.hipStand[1]');
put('HIPStandMoveMin', 'spread.hipMove[0]');
put('HIPStandMoveMax', 'spread.hipMove[1]');
for (const [sheetSuffix, ours] of [
  ['Inc', 'inc'], ['IdleTime', 'idleTime'], ['IdleDecCoef', 'idleCoef'], ['IdleDecExp', 'idleExp'],
  ['IdleDecOffset', 'idleOffset'], ['FiringDecCoef', 'firingCoef'], ['FiringDecExp', 'firingExp'],
  ['FiringDecOffset', 'firingOffset'], ['NotFiringDecCoef', 'notFiringCoef'], ['NotFiringDecExp', 'notFiringExp'],
  ['NotFiringDecOffset', 'notFiringOffset'], ['DistExp', 'distExp']
]) {
  put(`ADSBaseSpread${sheetSuffix}`, `spreadDyn.ads.${ours}`);
  put(`HIPBaseSpread${sheetSuffix}`, `spreadDyn.hip.${ours}`);
}
put('ADSBaseFirstShotMul', 'spreadDyn.ads.firstShotMul');
put('HIPBaseFirstShotMul', 'spreadDyn.hip.firstShotMul');
for (const [sheetSuffix, ours] of [
  ['Direction', 'dir'], ['Amount', 'amount'], ['AmountMultiplier', 'amountMult'],
  ['AmountMultiplierExponent', 'amountExp'], ['DirectionVariation', 'dirVar'],
  ['DirectionVariationMultiplier', 'dirVarMult'], ['DirectionVariationMultiplierExponent', 'dirVarExp'],
  ['DecreaseNorm', 'decNorm'], ['DecreaseExponent', 'decExp'], ['DecreaseTimeExponent', 'decTimeExp'],
  ['DecreaseOffset', 'decOffset'], ['Duration', 'duration'], ['DecreaseFactor', 'decFactor']
]) {
  put(`ADSRecoil${sheetSuffix}`, `recoil.ads.${ours}`);
  put(`HIPRecoil${sheetSuffix}`, `recoil.hip.${ours}`);
}
put('ADSShootingRecoilDecreaseScale', 'recoil.ads.shootingDecScale');
put('HIPShootingRecoilDecreaseScale', 'recoil.hip.shootingDecScale');

/** The stat names alone, deduplicated - what the watcher fingerprints. */
export const SYM_COMBAT_STATS = [...new Set(SYM_FIELD_MAP.map(f => f.stat))].sort();

/**
 * Mirror fields: top-level duplicates of a nested primitive. Verified to hold for
 * all 62 weapons in the current mirror, so if the nested value moves the duplicate
 * must move with it or the record becomes self-inconsistent.
 */
export const MIRROR_FIELDS = [
  { path: 'recoilDir', of: 'recoil.ads.dir' },
  { path: 'recoilVar', of: 'recoil.ads.dirVar' },
  { path: 'recoilIncAds', of: 'spreadDyn.ads.inc' },
  { path: 'spreadMax', of: 'spread.adsStand[1]' }
];

/**
 * Canonical numeric form for fingerprinting.
 *
 * The workbook is a spreadsheet: the same value can come back as 0.36 or
 * 0.36000000000000004 after an unrelated recalculation, and a column reformat can
 * change how many decimals the CSV export prints. Rounding to 9 significant digits
 * before hashing absorbs both without hiding a real change - the smallest genuine
 * delta observed in this source is 0.069%, seven orders of magnitude above it.
 */
export function canonicalNumber(v) {
  // Number('') is 0. An empty spreadsheet cell is ABSENT, not zero, and letting it
  // canonicalise to "0" would make clearing a cell look like setting it to zero.
  if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (n === 0) return '0';
  return n.toPrecision(9).replace(/(\.\d*?)0+(e|$)/, '$1$2').replace(/\.(e|$)/, '$1');
}
