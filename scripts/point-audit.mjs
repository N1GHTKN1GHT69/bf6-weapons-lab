export const PICK_100_LIMIT = 100;

const FIXED_EXPECTED = {
  SIGHTS: { iron:5, std_optic:10, var_low:20, var_high:25, thermal:25, therm_hyb:35 },
  LIGHTS: { none:0, ads_taclight:5, flashlight:10, hip_taclight:15, range_finder:15 },
  ERGOS: { none:0, rail_cover:5, mag_flare:10, mag_catch:5, match_trigger:15, ads_bolt:30, buffer:5, full_auto:25, fast_deploy:5, fast_deploy_10:10, burst_training:15 },
  BARRELS: { none:0, basic:10, short:15, extended:5, heavy:10, heavy_ext:10, light:20, cryo:20, ext_light:25, short_light:25 },
  MUZZLES: { none:0, sp_brake:5, dp_brake:10, slant_brake:5, tp_brake:10, thread_prot:5, comp_brake:20, linear_comp:10, flash_hider:10, flash_comp:20, std_supp:20, long_supp:25, light_supp:30, cqb_supp:30, compensator:10 },
  GRIPS: { none:0, bipod:10, underslung_mount:10, cmpct_handstop:10, fold_vert:10, slim_handstop:15, adj_angled:15, alloy_vert:20, ribbed_vert:20, fold_stubby:20, ptt_grip_pod:20, "6h64_vert":25, slim_angled:25, full_angled:25, ribbed_stubby:30, canted_stubby:30, qd_grip_pod:30, classic_grip_pod:30, classic_vert:35, stipp_stubby:35, lp_stubby:45 },
  LASERS: { none:0, "5mw_red":10, "5mw_green":10, "50mw_violet":10, "50mw_green":20, "50mw_blue":20, "120mw_blue":30, combo_red:20, combo_green:20 }
};

function validPts(v) {
  return Number.isInteger(v) && v >= 0 && v <= PICK_100_LIMIT && v % 5 === 0;
}

export function auditPointData(attachments, ammo) {
  const errors = [];
  const warnings = [];
  const catalogNames = ["SIGHTS","MUZZLES","BARRELS","GRIPS","LASERS","LIGHTS","ERGOS"];

  for (const key of catalogNames) {
    const arr = attachments?.[key];
    if (!Array.isArray(arr)) { errors.push(`Missing attachment catalog ${key}`); continue; }
    for (const item of arr) {
      if (!validPts(item.pts)) errors.push(`${key}/${item.id || item.name}: invalid point cost ${item.pts}`);
    }
  }

  for (const [catalog, expected] of Object.entries(FIXED_EXPECTED)) {
    const byId = new Map((attachments?.[catalog] || []).map(x => [x.id,x]));
    for (const [id, pts] of Object.entries(expected)) {
      const item = byId.get(id);
      if (item && item.pts !== pts) errors.push(`${catalog}/${id}: expected ${pts}, got ${item.pts}`);
    }
  }

  for (const [weaponId, magData] of Object.entries(attachments?.WEAPON_MAG || {})) {
    if (!magData?.mags || !Object.keys(magData.mags).length) errors.push(`${weaponId}: no magazine point table`);
    for (const [magId, mag] of Object.entries(magData?.mags || {})) {
      if (!validPts(mag.pts) || mag.pts === 0) errors.push(`${weaponId}/mag/${magId}: invalid point cost ${mag.pts}`);
    }
  }

  const fixedAmmo = {standard:5, penetration:5, lightweight:10, long_range:10, range_pen:10, sub_pen:10, frangible:20};
  const variableAmmo = {subsonic:[10,15], hollow_pt:[15,20], synthetic:[20,30], sub_hp:[25,35]};
  for (const [weaponId, ammoData] of Object.entries(ammo?.WEAPON_AMMO || {})) {
    if (!ammoData?.ammo || !Object.keys(ammoData.ammo).length) errors.push(`${weaponId}: no ammo point table`);
    for (const [ammoId, pts] of Object.entries(ammoData?.ammo || {})) {
      if (!validPts(pts) || pts === 0) errors.push(`${weaponId}/ammo/${ammoId}: invalid point cost ${pts}`);
      if (ammoId in fixedAmmo && pts !== fixedAmmo[ammoId]) errors.push(`${weaponId}/ammo/${ammoId}: expected fixed cost ${fixedAmmo[ammoId]}, got ${pts}`);
      if (ammoId in variableAmmo) {
        const [lo,hi] = variableAmmo[ammoId];
        if (pts < lo || pts > hi) errors.push(`${weaponId}/ammo/${ammoId}: expected ${lo}-${hi}, got ${pts}`);
      }
    }
  }

  // Pick-100 mandatory categories: optic, barrel, magazine and ammunition all consume points.
  const sights = attachments?.SIGHTS || [];
  if (sights.some(x => Number(x.pts) <= 0)) errors.push("Optic catalog contains a 0-point choice; optics are a mandatory paid category.");

  for (const [weaponId, wa] of Object.entries(attachments?.WEAPON_ATTS || {})) {
    const barrels = Array.isArray(wa?.barrel) ? wa.barrel : [];
    if (!barrels.length) errors.push(`${weaponId}: no barrel choices mapped`);
    if (barrels.includes("none")) warnings.push(`${weaponId}: source explicitly allows a 0-point barrel; verify in game.`);
  }

  return { ok: errors.length === 0, errors, warnings };
}
