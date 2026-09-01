export const PRIMARY_BUDGET = 100;
export const SECONDARY_BUDGET = 60;

// These values are a drift alarm, not authority. A legitimate BF6 patch may change them.
const KNOWN_COSTS = {
  SIGHTS: { iron:5, std_optic:10, var_low:20, var_high:25, thermal:25, therm_hyb:35 },
  LIGHTS: { range_finder:15 },
  ERGOS: { mag_flare:10, mag_catch:5, match_trigger:15, ads_bolt:30, buffer:5 },
  LASERS: { "5mw_red":10, "5mw_green":10, "50mw_violet":10, "50mw_green":20, "50mw_blue":20, "120mw_blue":30 }
};

function validPts(v) {
  return Number.isInteger(v) && v >= 0 && v <= PRIMARY_BUDGET;
}

export function auditPointData(attachments, ammo) {
  const errors = [];
  const warnings = [];
  const catalogs = ["SIGHTS","MUZZLES","BARRELS","GRIPS","LASERS","LIGHTS","ERGOS"];

  for (const key of catalogs) {
    const arr = attachments?.[key];
    if (!Array.isArray(arr)) { errors.push(`Missing attachment catalog ${key}`); continue; }
    for (const item of arr) {
      if (!validPts(Number(item.pts))) errors.push(`${key}/${item.id || item.name}: invalid point cost ${item.pts}`);
    }
  }

  for (const [catalog, expected] of Object.entries(KNOWN_COSTS)) {
    const byId = new Map((attachments?.[catalog] || []).map(x => [x.id, x]));
    for (const [id, pts] of Object.entries(expected)) {
      const item = byId.get(id);
      if (item && Number(item.pts) !== pts) warnings.push(`${catalog}/${id}: known value was ${pts}, source now reports ${item.pts}; review before calling it current in-game verified.`);
    }
  }

  for (const [weaponId, magData] of Object.entries(attachments?.WEAPON_MAG || {})) {
    if (!magData?.mags || !Object.keys(magData.mags).length) errors.push(`${weaponId}: no magazine point table`);
    for (const [magId, mag] of Object.entries(magData?.mags || {})) {
      if (!validPts(Number(mag.pts)) || Number(mag.pts) === 0) errors.push(`${weaponId}/mag/${magId}: invalid point cost ${mag.pts}`);
    }
  }

  for (const [weaponId, ammoData] of Object.entries(ammo?.WEAPON_AMMO || {})) {
    if (!ammoData?.ammo || !Object.keys(ammoData.ammo).length) errors.push(`${weaponId}: no ammo point table`);
    for (const [ammoId, pts] of Object.entries(ammoData?.ammo || {})) {
      if (!validPts(Number(pts))) errors.push(`${weaponId}/ammo/${ammoId}: invalid point cost ${pts}`);
    }
  }

  if (!(attachments?.WEAPON_ATTS && typeof attachments.WEAPON_ATTS === "object")) errors.push("Missing WEAPON_ATTS compatibility map");
  return { ok: errors.length === 0, errors, warnings };
}
