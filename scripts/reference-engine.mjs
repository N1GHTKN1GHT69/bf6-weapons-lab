/**
 * INDEPENDENT reference implementation of the core combat math.
 *
 * WHY THIS EXISTS. The browser optimizer and the exhaustive cache builder already
 * cross-check each other, but they share the same underlying simulator functions - so a
 * bug in that shared code produces two confidently identical wrong answers. Nothing in
 * the repository could currently notice. This file re-implements the math from the
 * DOCUMENTED MECHANICS rather than by calling the production code, so a disagreement
 * means one of the two is wrong and it is worth finding out which.
 *
 * WHAT "INDEPENDENT" MEANS HERE, precisely:
 *   - It imports nothing from scripts/build-combat-cache.mjs, app.js, or the upstream
 *     sim/ modules. Everything below is written from the model description.
 *   - It is NOT independent of the MODEL. Where this project has chosen a formula
 *     (the Beam Index weighting, the optic-fit policy), re-implementing it can only
 *     confirm arithmetic, never validate the choice. Those are listed in
 *     SHARED_ASSUMPTIONS and must never be described as independently verified.
 *
 * The genuinely independent parts are the ones with an external ground truth:
 * the stepped damage curve, ceil-based BTK, cadence/shot-interval timing, and the
 * closed-form drag flight time.
 */

/**
 * Assumptions this reference SHARES with production. Agreement on these is arithmetic
 * agreement only. Stated here so a green run is never over-read.
 */
export const SHARED_ASSUMPTIONS = [
  'Beam Index weighting (the 1.00/0.35, 1.25/0.75, 2.00/2.50, 0.35/0.65 range coefficients) is a project ranking policy, not a game mechanic. Re-deriving it proves the arithmetic, not the model.',
  'The 120 m rangeT normalisation is likewise a project choice.',
  'Chest damage assumes 100 HP and no headshot/limb variation; low-body uses the audited limb multiplier.',
  'Attachment-modified per-shot damage is taken from the cache row, because attachment damage transforms live in the upstream simulator and are not re-derived here.',
  'The drag constant and the projectile model form dv/dt = -k*v^2 come from the upstream ballistics documentation; only the closed-form solution is re-derived.'
];

/**
 * Damage at a distance from a stepped curve.
 *
 * The rule for a REPEATED breakpoint distance (two points with the same `r`) is that
 * at exactly that distance the FIRST/outgoing tier applies, and the lower tier starts
 * just after it. Implemented here from that description.
 */
export function steppedDamageAt(dmgPoints, distanceM) {
  const pts = (dmgPoints ?? [])
    .map((x, i) => ({ r: Number(x.r), d: Number(x.d), i }))
    .filter(p => Number.isFinite(p.r) && Number.isFinite(p.d))
    .sort((a, b) => a.r - b.r || a.i - b.i);
  if (!pts.length) return null;
  if (distanceM <= pts[0].r) return pts[0].d;
  let previous = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (distanceM < p.r) return previous.d;
    if (distanceM === p.r) return p.d;
    previous = p;
  }
  return previous.d;
}

/** Linear sniper curve between audited control points (the sniper audit's own model). */
export function sniperDamageAt(curve, distanceM) {
  const pts = (curve ?? []).map(p => ({ r: Number(p.r), d: Number(p.d) })).sort((a, b) => a.r - b.r);
  if (!pts.length) return null;
  if (distanceM <= pts[0].r) return pts[0].d;
  if (distanceM >= pts[pts.length - 1].r) return pts[pts.length - 1].d;
  for (let i = 1; i < pts.length; i++) {
    if (distanceM <= pts[i].r) {
      const a = pts[i - 1], b = pts[i];
      if (b.r === a.r) return b.d;
      return a.d + (b.d - a.d) * ((distanceM - a.r) / (b.r - a.r));
    }
  }
  return pts[pts.length - 1].d;
}

/**
 * Bullets to kill a 100 HP target.
 * The 1e-9 slack matters: with damage exactly 20, 100/20 is 5 and must stay 5 rather
 * than becoming 6 through a floating-point hair over the integer.
 */
export function btkFor(damagePerShot, hp = 100) {
  const dmg = Number(damagePerShot);
  if (!Number.isFinite(dmg) || dmg <= 0) return null;
  return Math.ceil((hp - 1e-9) / dmg);
}

/**
 * Seconds between shot `shotIndex` and the next one (1-based).
 *
 * Automatic/semi weapons fire at a constant interval. A burst weapon fires its rounds
 * at the burst rate, then waits out the remainder of the burst cycle - so the gap after
 * the LAST round of a burst is the cycle time minus the time the burst itself consumed,
 * never shorter than one normal interval.
 */
export function shotIntervalSec(stats, shotIndex) {
  const isBurst = stats.fireMode === 'burst';
  const shotRpm = isBurst && stats.burstRpm ? Number(stats.burstRpm) : Number(stats.rpm ?? 600);
  if (!Number.isFinite(shotRpm) || shotRpm <= 0) return null;
  const normalInterval = 60 / shotRpm;
  const burstRounds = isBurst ? Number(stats.burstRounds ?? 0) : 0;
  const burstsPerMinute = Number(stats.burstBurstsPerMinute ?? 0);
  if (!(burstRounds > 1) || !(burstsPerMinute > 0)) return normalInterval;
  const shotInBurst = (shotIndex - 1) % burstRounds;
  if (shotInBurst < burstRounds - 1) return normalInterval;
  const burstCycle = 60 / burstsPerMinute;
  const elapsedWithinBurst = (burstRounds - 1) * normalInterval;
  return Math.max(normalInterval, burstCycle - elapsedWithinBurst);
}

/**
 * Mechanical time from the first round leaving the barrel to the killing round leaving
 * the barrel: the sum of the intervals BETWEEN shots. A one-shot kill is 0 ms.
 *
 * `overrideIntervalMs` covers the audited fixed cadences (bolt-action snipers, shotgun
 * constant cadence) where the class audit supplies the interval directly.
 */
export function ttkMs(stats, btk, overrideIntervalMs = null) {
  if (!Number.isFinite(btk) || btk <= 0) return null;
  if (btk === 1) return 0;
  if (Number.isFinite(overrideIntervalMs) && overrideIntervalMs > 0) {
    return Math.round((btk - 1) * overrideIntervalMs);
  }
  let sec = 0;
  for (let shot = 1; shot < btk; shot++) {
    const iv = shotIntervalSec(stats, shot);
    if (iv == null) return null;
    sec += iv;
  }
  return Math.round(sec * 1000);
}

/** Paired shotgun cadence: alternating pair-cycle and within-pair intervals. */
export function pairedShotgunTtkMs(cadence, btk) {
  if (!Number.isFinite(btk) || btk <= 1) return 0;
  const idx = btk - 1;
  return Math.round(Math.floor(idx / 2) * Number(cadence.pairCycleMs) + (idx % 2) * (60000 / Number(cadence.pairRpm)));
}

/**
 * Level-flight time to a horizontal distance under quadratic drag.
 *
 * dv/dt = -k v^2 with v(0) = v0 integrates to v(x) = v0 * e^(-k x), and
 * t(x) = (e^(k x) - 1) / (k v0). Written with expm1 so small k*x stays accurate.
 * With k = 0 it degenerates to x / v0.
 */
export function flightSeconds(velocityMps, dragPerMeter, distanceM) {
  const v = Number(velocityMps), k = Number(dragPerMeter), x = Number(distanceM);
  if (!Number.isFinite(v) || v <= 0 || !Number.isFinite(k) || k < 0 || !Number.isFinite(x) || x < 0) return null;
  if (x === 0) return 0;
  return k === 0 ? x / v : Math.expm1(k * x) / (k * v);
}

/**
 * Beam Index. PROJECT POLICY, not a game mechanic - see SHARED_ASSUMPTIONS.
 * Re-derived here so a corrupted cached value is detectable, nothing more.
 */
export function beamIndexFor({ recoil, unpredictable, effSpread, moving }, distanceM) {
  const rangeT = Math.min(1, Math.max(1, Number(distanceM) || 1) / 120);
  return (Number(recoil) * (1.00 + 0.35 * rangeT))
    + (Number(unpredictable) * (1.25 + 0.75 * rangeT))
    + (Number(effSpread) * (2.00 + 2.50 * rangeT))
    + (Number(moving) * (0.35 + 0.65 * rangeT));
}

/** Recoil that is not repeatable: the lateral component of the polar recoil vector. */
export function unpredictableRecoilFor(recoilAmount, variationDeg) {
  return Number(recoilAmount) * Math.sin(Math.min(90, Number(variationDeg)) * Math.PI / 180);
}
