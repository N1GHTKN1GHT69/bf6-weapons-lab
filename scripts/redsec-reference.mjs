/**
 * Independent REDSEC reference maths.
 *
 * Deliberately implemented from data/weapons.json + data/redsec-model.json ONLY.
 * It never imports, executes or reads app.js, so when it agrees with the
 * production engine that agreement is real evidence rather than one bug
 * validating a copy of itself.
 */

/** Curve evaluation reimplemented from the documented curve semantics. */
export function damageAt(raw, curve, d) {
  const pts = curve
    .map((p, i) => ({ r: Number(p.r), d: Number(p.d), i }))
    .filter(p => Number.isFinite(p.r) && Number.isFinite(p.d))
    .sort((a, b) => a.r - b.r || a.i - b.i);
  if (!pts.length) return null;
  const source = String(raw?.damageSource || '');
  const linear = /linear/i.test(source);
  const blend = /1\s*m\s*blend/i.test(source);
  if (linear || blend) {
    if (d <= pts[0].r) return pts[0].d;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      if (d <= b.r) {
        if (b.r === a.r) return b.d;
        if (blend && (b.r - a.r) > 1.01) return a.d;
        const t = (d - a.r) / (b.r - a.r);
        return a.d + (b.d - a.d) * Math.max(0, Math.min(1, t));
      }
    }
    return pts.at(-1).d;
  }
  if (d <= pts[0].r) return pts[0].d;
  let prev = pts[0];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (d < p.r) return prev.d;
    if (d === p.r) return p.d;
    prev = p;
  }
  return prev.d;
}

export function chestMultiplier(model, cls) {
  const groups = model?.damageVsArmor?.chestMultipliers || {};
  for (const rec of Object.values(groups)) {
    if (Array.isArray(rec?.classes) && rec.classes.includes(cls)) return Number(rec.value);
  }
  return 1;
}

function alignedCarbineDamage(model, raw, weapons) {
  const cfg = model?.damageVsArmor?.carbineCloseRangeAlignment?.weaponOverrides?.[raw?.id];
  if (!cfg?.referenceWeaponId) return null;
  const ref = weapons.find(w => w.id === cfg.referenceWeaponId);
  if (!Array.isArray(ref?.dmg) || !ref.dmg.length) return null;
  const first = Number(ref.dmg[0]?.d);
  const changed = ref.dmg.find(p => Number.isFinite(Number(p?.d)) && Number(p.d) !== first);
  const v = Number(changed?.d);
  return Number.isFinite(v) && v > 0 ? v : null;
}

/** Damage-vs-armor curve: drop leading auto step (policy), then shift +10 m. */
export function armorCurve(model, raw, weapons, closeRange, fireMode = raw?.fireMode) {
  if (!Array.isArray(raw?.dmg) || !raw.dmg.length) return null;
  const shift = Number(model?.damageVsArmor?.rangeShiftMeters?.value);
  if (!Number.isFinite(shift)) return null;
  let pts = raw.dmg.map(p => ({ r: Number(p.r), d: Number(p.d) }))
    .filter(p => Number.isFinite(p.r) && Number.isFinite(p.d));
  if (!pts.length) return null;
  const dropModes = model?.damageVsArmor?.removeFirstCloseRangeStep?.appliesToFireModes ?? [];
  if (closeRange === 'remove' && dropModes.includes(fireMode)) {
    const first = pts[0].d;
    const at = pts.findIndex(p => p.d !== first);
    if (at > 0) {
      pts = pts.slice(at);
      const aligned = alignedCarbineDamage(model, raw, weapons);
      if (Number.isFinite(aligned) && pts.length) {
        const own = pts[0].d;
        pts = pts.map(p => p.d === own ? { ...p, d: aligned } : p);
      }
    }
  }
  const shifted = pts.map(p => ({ r: Math.max(0, p.r + shift), d: p.d }));
  if (shifted[0].r > 0) shifted.unshift({ r: 0, d: shifted[0].d });
  return shifted;
}

export function armorDamageAt(model, raw, weapons, d, closeRange, fireMode = raw?.fireMode) {
  const curve = armorCurve(model, raw, weapons, closeRange, fireMode);
  if (!curve) return null;
  const per = damageAt(raw, curve, d);
  if (per == null) return null;
  return per * Math.max(1, Number(raw?.pellets) || 1) * chestMultiplier(model, raw?.cls);
}

/**
 * Shot-by-shot armoured resolution, written as a plain simulation loop that
 * shares no code with the production implementation.
 */
export function armoredResolve({ armorHp, armorDamage, healthDamage, healthHp = 100, spillover = 'none' }) {
  if (!(armorDamage > 0) || !(healthDamage > 0)) return null;
  let armor = armorHp, health = healthHp, shots = 0, armorShots = 0, carried = 0;
  while (health > 0 && shots < 400) {
    shots++;
    if (armor > 0) {
      armorShots++;
      const used = Math.min(armor, armorDamage);
      armor -= armorDamage;
      if (armor <= 0 && spillover === 'proportional') {
        carried = healthDamage * ((armorDamage - used) / armorDamage);
        health -= carried;
      }
      continue;
    }
    health -= healthDamage;
  }
  return { shotsToBreakArmor: armorShots, healthBtk: shots - armorShots, btk: shots, carriedHealthDamage: carried };
}

/** Closed-form cross-check of the loop above (no-spillover reading only). */
export function closedFormBtk(armorHp, armorDamage, healthDamage, healthHp = 100) {
  return Math.ceil(armorHp / armorDamage) + Math.ceil(healthHp / healthDamage);
}
