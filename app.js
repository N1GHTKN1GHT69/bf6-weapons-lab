(() => {
  "use strict";

  const REMOTE = {
    weapons: "https://raw.githubusercontent.com/raymdl/BF6-Weapon-Analyzer/refs/heads/main/data/weapons.json",
    attachments: "https://raw.githubusercontent.com/raymdl/BF6-Weapon-Analyzer/refs/heads/main/data/attachments.json",
    ammo: "https://raw.githubusercontent.com/raymdl/BF6-Weapon-Analyzer/refs/heads/main/data/ammo.json"
  };

  const CURRENT = window.BF6_CURRENT || { roster: [], primaryClasses: [] };
  const LOADOUT = window.BF6_LOADOUT_DATA || { classes: {}, fallbackSecondaries: [], secondaryRoles: {} };
  const $ = id => document.getElementById(id);

  const state = {
    category: "__all__",
    weaponId: null,
    selectionMode: "auto",
    distance: 25,
    classChoice: "auto",
    context: "mixed",
    rawWeapons: [],
    attachments: null,
    ammo: null,
    source: { weapons: "loading", attachments: "loading", ammo: "loading" }
  };

  const CATALOG_KEYS = {
    sight: "SIGHTS", muzzle: "MUZZLES", barrel: "BARRELS", grip: "GRIPS",
    laser: "LASERS", light: "LIGHTS", ergo: "ERGOS"
  };
  const SLOT_LABELS = {
    sight: "Optic", muzzle: "Muzzle", barrel: "Barrel", grip: "Underbarrel",
    laser: "Laser", light: "Accessory", accessory: "Rail Accessory",
    ergo: "Ergonomics", mag: "Magazine", ammo: "Ammo"
  };

  const BEHAVIOR = {
    range_finder: { title: "Range Finder", text: "Displays target distance; value rises sharply for long-range precision work." },
    mag_flare: { title: "Magwell Flare", text: "Preserves sight-picture/reload flow; useful when you prioritize staying ADS." },
    ads_bolt: { title: "DLC Bolt", text: "Lets supported sniper rifles maintain the sight picture while cycling/reloading." },
    buffer: { title: "Aftermarket Buffer", text: "Reduces visual recoil/sight disruption even where projectile behavior is unchanged." },
    mag_catch: { title: "Improved Mag Catch", text: "Faster reload utility." },
    bipod: { title: "Bipod", text: "Positional stability becomes more useful as engagement distance rises." },
    bipod_sr: { title: "Bipod", text: "Positional stability becomes more useful as engagement distance rises." },
    std_supp: { title: "Suppressor", text: "Signature reduction; weighted higher when stealth is selected." },
    long_supp: { title: "Long Suppressor", text: "Signature reduction with long-range tradeoffs." },
    light_supp: { title: "Light Suppressor", text: "Signature reduction with handling tradeoffs." },
    cqb_supp: { title: "CQB Suppressor", text: "Close-range signature reduction." }
  };

  const BASE_WEIGHTS = {
    short:  { ads:6.0, move:3.0, recoil:2.0, recoilVar:1.4, velocity:.4, hip:5.5, reload:4.0, capacity:.12, visual:2.5, sprint:4.5 },
    medium: { ads:3.5, move:4.0, recoil:5.5, recoilVar:4.0, velocity:2.5, hip:1.2, reload:2.5, capacity:.16, visual:3.5, sprint:2.0 },
    long:   { ads:1.5, move:4.5, recoil:6.0, recoilVar:6.0, velocity:6.5, hip:0.0, reload:1.5, capacity:.10, visual:4.5, sprint:.8 }
  };

  const BLOCKED_UNTIL_PATCH = new Set(["ef88:match_trigger", "brod3:match_trigger"]);

  function normalizeName(v) {
    return String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function aliasKey(v) {
    const n = normalizeName(v);
    const aliases = {
      l115a3: "l115", l115: "l115",
      m60: "m60", tr7: "tr7", "185ksk": "185ksk", "18_5ksk": "185ksk"
    };
    return aliases[n] || n;
  }

  function rosterWeapon(id = state.weaponId) {
    return CURRENT.roster.find(w => w.id === id) || null;
  }

  function rawForRoster(roster) {
    if (!roster) return null;
    const targetId = aliasKey(roster.id);
    const targetName = aliasKey(roster.name);
    return state.rawWeapons.find(w => aliasKey(w.id) === targetId) ||
      state.rawWeapons.find(w => aliasKey(w.name) === targetName) || null;
  }

  function rosterForRaw(raw) {
    if (!raw) return null;
    return CURRENT.roster.find(w => aliasKey(w.id) === aliasKey(raw.id)) ||
      CURRENT.roster.find(w => aliasKey(w.name) === aliasKey(raw.name)) || null;
  }

  function setChip(id, text, cls = "") {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.className = `data-chip ${cls}`.trim();
  }

  async function fetchJson(url, timeoutMs = 9000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { cache: "no-store", signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function loadOne(kind) {
    try {
      const local = await fetchJson(`./data/${kind}.json`, 3000);
      state.source[kind] = "local";
      return local;
    } catch (_) {
      try {
        const remote = await fetchJson(REMOTE[kind], 9000);
        state.source[kind] = "remote";
        return remote;
      } catch (err) {
        state.source[kind] = "failed";
        return null;
      }
    }
  }

  async function loadData() {
    // Deliberately independent. One bad source must never erase the catalog or the other data.
    const [weapons, attachments, ammo] = await Promise.all([
      loadOne("weapons"), loadOne("attachments"), loadOne("ammo")
    ]);

    state.rawWeapons = Array.isArray(weapons) ? weapons : [];
    state.attachments = attachments && typeof attachments === "object" ? attachments : null;
    state.ammo = ammo && typeof ammo === "object" ? ammo : null;

    const matched = CURRENT.roster.filter(r => rawForRoster(r)).length;
    if (state.rawWeapons.length) setChip("statsChip", `STATS ${matched}/${CURRENT.roster.length}`, matched >= 60 ? "ok" : "warn");
    else setChip("statsChip", "STATS FEED DOWN", "bad");

    if (state.attachments && state.ammo) setChip("buildChip", "BUILD DATA READY", "ok");
    else if (state.attachments || state.ammo) setChip("buildChip", "BUILD DATA PARTIAL", "warn");
    else setChip("buildChip", "BUILD DATA DOWN", "bad");
  }

  function distanceMix(d = state.distance) {
    const x = Math.max(5, Number(d) || 25);
    if (x <= 10) return { short: 1, medium: 0, long: 0 };
    if (x < 50) {
      const t = (x - 10) / 40;
      return { short: 1 - t, medium: t, long: 0 };
    }
    if (x < 120) {
      const t = (x - 50) / 70;
      return { short: 0, medium: 1 - t, long: t };
    }
    return { short: 0, medium: 0, long: 1 };
  }

  function blendRange(values, d = state.distance) {
    if (!values) return 0;
    const m = distanceMix(d);
    return (Number(values.short) || 0) * m.short +
      (Number(values.medium) || 0) * m.medium +
      (Number(values.long) || 0) * m.long;
  }

  function blendedWeights(d = state.distance) {
    const m = distanceMix(d);
    const out = {};
    for (const key of Object.keys(BASE_WEIGHTS.short)) {
      out[key] = BASE_WEIGHTS.short[key] * m.short + BASE_WEIGHTS.medium[key] * m.medium + BASE_WEIGHTS.long[key] * m.long;
    }
    return out;
  }

  function budgetFor(rawOrRoster) {
    return rawOrRoster?.cls === "Secondary" ? 60 : 100;
  }

  function pointCost(opt) {
    const n = Number(opt?.pts);
    return Number.isFinite(n) && Number.isInteger(n) && n >= 0 ? n : null;
  }

  function catalogItem(slot, id) {
    const key = CATALOG_KEYS[slot];
    const arr = state.attachments?.[key];
    return Array.isArray(arr) ? arr.find(x => x.id === id) || null : null;
  }

  function noAttachment(slot) {
    const actual = catalogItem(slot, "none");
    return actual ? { ...actual, slot } : { id: "none", name: "None", pts: 0, slot, syntheticNone: true };
  }

  function patchBlocked(rawId, attachmentId) {
    const beforeRelease = Date.now() < Date.parse("2026-09-02T00:00:00Z");
    return beforeRelease && BLOCKED_UNTIL_PATCH.has(`${rawId}:${attachmentId}`);
  }

  function buildOptions(raw) {
    if (!raw || !state.attachments || !state.ammo) throw new Error("Build source data unavailable");
    const a = state.attachments;
    const wa = a.WEAPON_ATTS?.[raw.id];
    if (!wa) throw new Error("No weapon-specific attachment compatibility table");

    const options = {};

    // Sidearms expose exact sight compatibility. Most primaries use the analyzer's global optic tiers.
    const sightIds = Array.isArray(wa.sight) && wa.sight.length ? wa.sight : null;
    const sightCatalog = Array.isArray(a.SIGHTS) ? a.SIGHTS : [];
    options.sight = sightIds
      ? sightIds.map(id => catalogItem("sight", id)).filter(Boolean).map(x => ({ ...x, slot: "sight" }))
      : sightCatalog.map(x => ({ ...x, slot: "sight", genericOpticTier: true }));
    if (!options.sight.length) throw new Error("No optic point data");

    const barrelIds = Array.isArray(wa.barrel) ? wa.barrel : [];
    options.barrel = barrelIds.map(id => catalogItem("barrel", id)).filter(Boolean).map(x => ({ ...x, slot: "barrel" }));
    if (!options.barrel.length) throw new Error("No weapon-specific barrel table");

    for (const slot of ["muzzle", "grip"]) {
      const ids = Array.isArray(wa[slot]) ? wa[slot] : [];
      const list = ids
        .filter(id => !patchBlocked(raw.id, id))
        .map(id => catalogItem(slot, id)).filter(Boolean).map(x => ({ ...x, slot }));
      if (!list.some(x => x.id === "none")) list.unshift(noAttachment(slot));
      options[slot] = list;
    }

    // On sidearms the light/laser rail is shared. Treat it as one choice, not two simultaneous attachments.
    if (wa.laserLightCombined) {
      const combined = [];
      for (const slot of ["laser", "light"]) {
        for (const id of (Array.isArray(wa[slot]) ? wa[slot] : [])) {
          const item = catalogItem(slot, id);
          if (item) combined.push({ ...item, slot: "accessory", sourceSlot: slot });
        }
      }
      combined.unshift({ id: "none", name: "None", pts: 0, slot: "accessory" });
      options.accessory = dedupeOptions(combined);
    } else {
      for (const slot of ["laser", "light"]) {
        const ids = Array.isArray(wa[slot]) ? wa[slot] : [];
        const list = ids.map(id => catalogItem(slot, id)).filter(Boolean).map(x => ({ ...x, slot }));
        if (!list.some(x => x.id === "none")) list.unshift(noAttachment(slot));
        options[slot] = list;
      }
    }

    const ergoIds = a.WEAPON_ERGO?.[raw.id]?.avail || [];
    const ergos = ergoIds
      .filter(id => !patchBlocked(raw.id, id))
      .map(id => catalogItem("ergo", id)).filter(Boolean).map(x => ({ ...x, slot: "ergo" }));
    options.ergo = [{ id: "none", name: "None", pts: 0, slot: "ergo" }, ...ergos];

    const magData = a.WEAPON_MAG?.[raw.id];
    if (!magData?.mags || !Object.keys(magData.mags).length) throw new Error("Missing weapon-specific magazine points");
    options.mag = Object.entries(magData.mags).map(([id, x]) => ({ id, ...x, slot: "mag" }));

    const ammoData = state.ammo?.WEAPON_AMMO?.[raw.id];
    const ammoCatalog = Array.isArray(state.ammo?.AMMO) ? state.ammo.AMMO : [];
    if (!ammoData?.ammo || !Object.keys(ammoData.ammo).length) throw new Error("Missing weapon-specific ammunition points");
    options.ammo = Object.entries(ammoData.ammo).map(([id, pts]) => ({
      ...(ammoCatalog.find(x => x.id === id) || { id, name: prettifyId(id) }),
      ...(ammoData.velocityTreatments?.[id] || {}),
      id, pts, slot: "ammo"
    }));

    for (const [slot, list] of Object.entries(options)) {
      options[slot] = list.filter(opt => pointCost(opt) !== null);
      if (!options[slot].length) throw new Error(`${slot}: no valid point-cost choices`);
    }
    return options;
  }

  function dedupeOptions(list) {
    const seen = new Set();
    return list.filter(x => {
      const k = `${x.id}:${x.slot}`;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
  }

  function preference(id) { return !!$(id)?.checked; }

  function behaviorScore(opt, raw, d) {
    let s = 0;
    if (opt.id === "range_finder") {
      if (d < 35) s -= 2;
      else if (d < 70) s += 4;
      else if (d < 120) s += 11;
      else s += 18;
    }
    if (opt.id === "ads_bolt") {
      s += d < 30 ? 2 : d < 70 ? 9 : d < 120 ? 15 : 19;
      if (preference("stayAds")) s += 10;
      if (raw.cls !== "Sniper Rifle") s -= 100;
    }
    if (opt.id === "mag_flare") s += 5 + (preference("stayAds") ? 7 : 0);
    if (opt.id === "mag_catch") s += d < 40 ? 8 : 4;
    if (opt.id === "buffer") s += d < 30 ? 4 : d < 80 ? 8 : 11;
    if (["bipod", "bipod_sr"].includes(opt.id)) s += d < 35 ? -3 : d < 70 ? 4 : d < 120 ? 10 : 14;
    if (opt.suppressor || /supp/.test(opt.id)) s += preference("stealth") ? 13 : 1;
    if (opt.laserVisible && preference("stealth")) s -= 8;

    // Ammo utility that is not fully represented by the generic numerical fields.
    if (opt.slot === "ammo") {
      if (opt.id === "long_range") s += d < 45 ? -3 : d < 80 ? 5 : d < 120 ? 12 : 16;
      if (opt.id === "range_pen") s += d < 50 ? 0 : d < 100 ? 7 : 12;
      if (["subsonic", "subsonic_hp", "subsonic_pen"].includes(opt.id)) {
        s += preference("stealth") ? 15 : 1;
        if (d > 70) s -= 7;
      }
      if (opt.id === "frangible") s += d < 35 ? 5 : d < 70 ? 3 : 0;
      if (opt.id === "synthetic") s += d < 25 ? 1 : 4;
      if (opt.id === "hollow_pt") s += d < 35 ? 4 : d < 70 ? 2 : 0;
      if (opt.id === "buckshot") s += d <= 18 ? 18 : d <= 30 ? 6 : -18;
      if (opt.id === "buckshot_00") s += d <= 22 ? 16 : d <= 38 ? 10 : -12;
      if (opt.id === "flechette") s += d < 15 ? 4 : d <= 50 ? 16 : d <= 70 ? 5 : -8;
      if (opt.id === "slugs") s += d < 20 ? -10 : d < 45 ? 7 : 20;
    }
    return s;
  }

  function opticScore(opt, d) {
    const id = opt.id;
    if (id === "iron") return d <= 15 ? 9 : d <= 30 ? 2 : -7;
    if (id === "std_optic") return d <= 15 ? 7 : d <= 50 ? 11 : d <= 80 ? 5 : -2;
    if (id === "var_low") return d < 20 ? -3 : d <= 80 ? 11 : 7;
    if (id === "var_high") return d < 50 ? -7 : d < 90 ? 7 : 15;
    if (id === "thermal") return d < 20 ? 0 : d < 90 ? 7 : 8;
    if (id === "therm_hyb") return d < 45 ? 1 : 10;
    return 0;
  }

  function scoreOption(opt, raw, d) {
    const w = blendedWeights(d);
    let s = 0;

    // Direct lethality wins first whenever the source exposes it. These keys are
    // intentionally defensive because community datasets use different names.
    const damageMult = Number(opt.damageMult ?? opt.dmgMult ?? opt.damageMultiplier ?? opt.dmgMultiplier);
    const rpmMult = Number(opt.rpmMult ?? opt.rateOfFireMult ?? opt.rofMult);
    const damageAdd = Number(opt.damageAdd ?? opt.dmgAdd);
    if (Number.isFinite(damageMult) && damageMult !== 1) s += (damageMult - 1) * 1200;
    if (Number.isFinite(rpmMult) && rpmMult !== 1) s += (rpmMult - 1) * 1000;
    if (Number.isFinite(damageAdd) && damageAdd !== 0) s += damageAdd * 16;
    s += (Number(opt.adsTimeTierMod) || 0) * w.ads;
    s += (-(Number(opt.adsTimeTierShift) || 0)) * w.ads;
    s += (Number(opt.movingAdsSpreadTierMod) || 0) * (preference("movingAds") ? w.move * 1.6 : w.move * .55);
    s += (-(Number(opt.adsMoveSpeedTierShift) || 0)) * (preference("movingAds") ? w.move * 1.35 : w.move * .5);
    s += (Number(opt.adsRecoilTierMod) || 0) * w.recoil;
    s += (Number(opt.adsRecoilVariationTierMod) || 0) * w.recoilVar;
    s += ((Number(opt.adsRecoilDecayMult) || 1) - 1) * 15 * w.recoil;
    s += (Number(opt.velTierMod) || 0) * w.velocity;
    s += ((Number(opt.velMult) || 1) - 1) * 10 * w.velocity;
    s += (-(Number(opt.hipSpreadTierMod) || 0)) * w.hip;
    s += ((Number(opt.reloadSpeedMult) || 1) - 1) * 35 * w.reload;
    s += (Number(opt.reloadSpeedTier) || 0) * w.reload;
    s += (-(Number(opt.sprintRecoveryTierShift) || 0)) * w.sprint;
    s += (-(Number(opt.visualRecoil) || 0)) * w.visual;

    if (Number.isFinite(Number(opt.mag))) {
      const base = Number(raw.mag) || Number(opt.mag);
      const extra = Number(opt.mag) - base;
      s += extra * (preference("bigMag") ? w.capacity * 3.2 : w.capacity);
    }

    if (opt.slot === "sight") s += opticScore(opt, d);
    s += behaviorScore(opt, raw, d);
    return s;
  }

  function optimize(raw, d = state.distance) {
    const budget = budgetFor(raw);
    const options = buildOptions(raw);
    const slots = Object.keys(options);
    let dp = Array(budget + 1).fill(null);
    dp[0] = { score: 0, picks: [] };

    for (const slot of slots) {
      const next = Array(budget + 1).fill(null);
      for (let used = 0; used <= budget; used++) {
        const cur = dp[used];
        if (!cur) continue;
        for (const opt of options[slot]) {
          const pts = pointCost(opt);
          if (pts === null || used + pts > budget) continue;
          const sc = scoreOption(opt, raw, d);
          const total = used + pts;
          if (!next[total] || cur.score + sc > next[total].score) {
            next[total] = { score: cur.score + sc, picks: [...cur.picks, { ...opt, score: sc }] };
          }
        }
      }
      dp = next;
    }

    const candidates = dp.map((x, points) => x ? { ...x, points } : null).filter(Boolean);
    if (!candidates.length) throw new Error("No legal attachment combination fits the point budget");
    candidates.sort((a, b) => b.score - a.score || a.points - b.points);
    const best = candidates[0];
    best.audit = auditBuild(best, budget);
    if (!best.audit.ok) throw new Error(best.audit.errors.join("; "));
    return best;
  }

  function auditBuild(result, budget) {
    const errors = [];
    const recalculated = result.picks.reduce((sum, x) => {
      const p = pointCost(x);
      if (p === null) errors.push(`${x.id}: unknown point cost`);
      return sum + (p || 0);
    }, 0);
    if (recalculated !== result.points) errors.push(`point total mismatch ${recalculated} vs ${result.points}`);
    if (recalculated > budget) errors.push(`${recalculated}/${budget} exceeds budget`);
    return { ok: !errors.length, total: recalculated, budget, errors };
  }

  function prettifyId(id) {
    return String(id || "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  }

  function attachmentNote(opt) {
    const bits = [];
    if (BEHAVIOR[opt.id]) bits.push(BEHAVIOR[opt.id].text);
    if (opt.genericOpticTier) bits.push("Optic tier abstraction; exact sight model may differ in game.");
    if (opt.adsRecoilTierMod) bits.push(`recoil ${signed(opt.adsRecoilTierMod)} tier`);
    if (opt.adsRecoilVariationTierMod) bits.push(`recoil variation ${signed(opt.adsRecoilVariationTierMod)} tier`);
    if (opt.movingAdsSpreadTierMod) bits.push(`moving ADS ${signed(opt.movingAdsSpreadTierMod)} tier`);
    if (opt.velMult && Number(opt.velMult) !== 1) bits.push(`${signed(Math.round((Number(opt.velMult) - 1) * 100))}% velocity`);
    if (opt.velTierMod) bits.push(`velocity ${signed(opt.velTierMod)} tier`);
    if (opt.reloadSpeedTier) bits.push(`reload ${signed(opt.reloadSpeedTier)} tier`);
    if (opt.mag) bits.push(`${opt.mag} rounds`);
    if (opt.suppressor) bits.push("suppressed");
    if (["subsonic","subsonic_hp","subsonic_pen"].includes(opt.id)) bits.push("subsonic / reduced signature");
    if (opt.id === "long_range") bits.push("long-range ammo utility");
    if (opt.id === "slugs") bits.push("single-projectile shotgun ammo for range");
    if (!bits.length) bits.push(opt.id === "none" ? "No points spent in this slot" : "utility / neutral-stat selection");
    return bits.join(" • ");
  }

  function signed(n) { return Number(n) > 0 ? `+${n}` : String(n); }

  function damageAtDistance(raw, d) {
    if (!Array.isArray(raw?.dmg) || !raw.dmg.length) return null;
    const pts = raw.dmg
      .map((x, i) => ({ r:Number(x.r), d:Number(x.d), i }))
      .filter(x => Number.isFinite(x.r) && Number.isFinite(x.d))
      .sort((a,b) => a.r - b.r || a.i - b.i);
    if (!pts.length) return null;

    // Most automatic-weapon curves are stepped and encode a discontinuity by
    // repeating the same range twice. Sniper sweet-spots are explicitly linear.
    const linear = /linear/i.test(String(raw?.damageSource || ""));
    if (!linear) {
      let val = pts[0].d;
      for (const p of pts) if (p.r <= d) val = p.d;
      return val;
    }

    if (d <= pts[0].r) return pts[0].d;
    for (let i=1;i<pts.length;i++) {
      const a=pts[i-1], b=pts[i];
      if (d <= b.r) {
        if (b.r === a.r) return b.d;
        const t=(d-a.r)/(b.r-a.r);
        return a.d + (b.d-a.d)*Math.max(0,Math.min(1,t));
      }
    }
    return pts[pts.length-1].d;
  }

  function combatAtDistance(raw, d) {
    const damage = damageAtDistance(raw, d);
    const rpm = Number(raw?.rpm);
    const btk = damage && damage > 0 ? Math.ceil(100 / damage) : null;
    const ttk = btk && rpm > 0 ? (btk - 1) * 60000 / rpm : null;
    return { damage, btk, ttk, rpm: Number.isFinite(rpm) ? rpm : null, mag: Number(raw?.mag) || null };
  }

  function norm(value, min, max, invert=false) {
    if (!Number.isFinite(value)) return 0;
    if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) return .5;
    const n = Math.max(0, Math.min(1, (value-min)/(max-min)));
    return invert ? 1-n : n;
  }

  function candidatePool(category = state.category) {
    const roster = CURRENT.roster.filter(w => w.cls !== "Secondary" && (category === "__all__" || w.cls === category));
    return roster.map(r => {
      const raw = rawForRoster(r);
      const c = raw ? combatAtDistance(raw, state.distance) : null;
      return { roster:r, raw, combat:c };
    });
  }

  function rankWeapons(category = state.category, d = state.distance) {
    const pool = CURRENT.roster
      .filter(w => w.cls !== "Secondary" && (category === "__all__" || w.cls === category))
      .map(roster => {
        const raw = rawForRoster(roster);
        const combat = raw ? combatAtDistance(raw, d) : null;
        return { roster, raw, combat };
      })
      .filter(x => x.raw && x.combat && Number.isFinite(x.combat.ttk) && Number.isFinite(x.combat.damage));

    if (!pool.length) return [];
    const ttks=pool.map(x=>x.combat.ttk), damages=pool.map(x=>x.combat.damage), btks=pool.map(x=>x.combat.btk).filter(Number.isFinite);
    const velocities=pool.map(x=>Number(x.raw.bulletVel)).filter(Number.isFinite);
    const adsVals=pool.map(x=>Number(x.raw.adsTime)).filter(Number.isFinite);
    const minT=Math.min(...ttks), maxT=Math.max(...ttks), minD=Math.min(...damages), maxD=Math.max(...damages);
    const minB=Math.min(...btks), maxB=Math.max(...btks);
    const minV=velocities.length?Math.min(...velocities):0, maxV=velocities.length?Math.max(...velocities):1;
    const minA=adsVals.length?Math.min(...adsVals):0, maxA=adsVals.length?Math.max(...adsVals):1;

    for (const x of pool) {
      const ttkScore=norm(x.combat.ttk,minT,maxT,true);
      const damageScore=norm(x.combat.damage,minD,maxD,false);
      const btkScore=norm(x.combat.btk,minB,maxB,true);
      const velocityScore=norm(Number(x.raw.bulletVel),minV,maxV,false);
      const adsScore=norm(Number(x.raw.adsTime),minA,maxA,true);
      // Lethality is deliberately dominant: TTK 70%, damage 20%, BTK 5%.
      // Delivery/handling is only a 5% tie-breaker so a smooth gun cannot outrank
      // a materially faster-killing gun merely because it is easier to handle.
      x.rankScore = 100*(.70*ttkScore + .20*damageScore + .05*btkScore + .03*velocityScore + .02*adsScore);
    }
    return pool.sort((a,b) => b.rankScore-a.rankScore || a.combat.ttk-b.combat.ttk || b.combat.damage-a.combat.damage);
  }

  function resolveAutoWeapon() {
    if (state.selectionMode !== "auto") return;
    const ranked = rankWeapons(state.category, state.distance);
    if (ranked.length) state.weaponId = ranked[0].roster.id;
    else {
      const fallback = CURRENT.roster.find(w => w.cls !== "Secondary" && (state.category === "__all__" || w.cls === state.category));
      state.weaponId = fallback?.id || null;
    }
  }

  function metricInputs(raw) {
    return {
      hip: Number(raw?.spread?.hipStand?.[0]),
      precision: meanFinite([Number(raw?.recoilVar), Number(raw?.recoilIncAds) * 45, Number(raw?.spread?.adsMove?.[0]) * 45]),
      control: meanFinite([Number(raw?.recoilV) * 40, Number(raw?.recoilVar) / 2]),
      mobility: meanFinite([Number(raw?.adsTime), Number(raw?.tacRld) * 100])
    };
  }

  function meanFinite(vals) {
    const good = vals.filter(Number.isFinite);
    return good.length ? good.reduce((a, b) => a + b, 0) / good.length : NaN;
  }

  function relativeBars(raw) {
    const peers = state.rawWeapons.filter(w => w.cls === raw.cls);
    const current = metricInputs(raw);
    const out = {};
    for (const key of ["hip", "precision", "control", "mobility"]) {
      const vals = peers.map(w => metricInputs(w)[key]).filter(Number.isFinite);
      const v = current[key];
      if (!Number.isFinite(v) || vals.length < 2) { out[key] = null; continue; }
      const min = Math.min(...vals), max = Math.max(...vals);
      const frac = max === min ? .5 : (max - v) / (max - min); // lower underlying value = better
      out[key] = Math.round(12 + Math.max(0, Math.min(1, frac)) * 83);
    }
    return out;
  }

  function sourceVersion(raw) {
    const m = String(raw?.damageSource || "").match(/\b\d+\.\d+\.\d+\.\d+\b/);
    return m ? m[0] : null;
  }

  function renderWeaponIntel(roster, raw) {
    $("dashboardWeapon").textContent = roster.name;
    $("weaponDescription").textContent = roster.desc || "Current BF6 weapon catalog entry.";
    const badge = $("weaponDataBadge");

    if (!raw) {
      badge.textContent = roster.id === "interdictor" ? "NEW WEAPON • STATS PENDING" : "STATS DATA PENDING";
      badge.className = "source-badge warn";
      $("combatNumbers").innerHTML = emptyStats("Exact raw stats are not available from the current analyzer feed yet.");
      $("statBars").innerHTML = `<div class="why-item"><strong>Catalog available, stat feed missing</strong><span>The weapon remains selectable; the site does not replace it with sample data.</span></div>`;
      $("rawStats").innerHTML = "";
      return;
    }

    const ver = sourceVersion(raw);
    badge.textContent = ver ? `RAW SOURCE ${ver}` : "RAW DATA LOADED";
    badge.className = ver && ver !== CURRENT.liveVersion ? "source-badge warn" : "source-badge ok";

    const c = combatAtDistance(raw, state.distance);
    const combat = [
      ["DAMAGE", c.damage == null ? "—" : c.damage.toFixed(c.damage % 1 ? 1 : 0), `@ ${state.distance}m`],
      ["BTK", c.btk ?? "—", "100 HP body"],
      ["TTK", c.ttk == null ? "—" : `${Math.round(c.ttk)} ms`, "ideal body"],
      ["ROF", c.rpm == null ? "—" : Math.round(c.rpm), "RPM"],
      ["MAG", c.mag ?? "—", "base rounds"]
    ];
    $("combatNumbers").innerHTML = combat.map(([k, v, s]) => `<div class="combat-stat"><span>${k}</span><strong>${v}</strong><small>${s}</small></div>`).join("");

    const bars = relativeBars(raw);
    $("statBars").innerHTML = [
      ["HIPFIRE", bars.hip], ["PRECISION", bars.precision], ["CONTROL", bars.control], ["MOBILITY", bars.mobility]
    ].map(([name, val]) => `<div class="statbar"><label>${name}</label><div class="bartrack"><i style="width:${val ?? 0}%"></i></div><output>${val ?? "—"}</output></div>`).join("");

    const rawStats = [
      ["Velocity", raw.bulletVel ? `${Math.round(raw.bulletVel)} m/s` : "—"],
      ["ADS", raw.adsTime ? `${Math.round(raw.adsTime)} ms` : "—"],
      ["Tac reload", raw.tacRld ? `${Number(raw.tacRld).toFixed(2)} s` : "—"],
      ["Vert recoil", Number.isFinite(Number(raw.recoilV)) ? Number(raw.recoilV).toFixed(3) : "—"],
      ["Recoil var.", Number.isFinite(Number(raw.recoilVar)) ? Number(raw.recoilVar).toFixed(1) : "—"],
      ["Fire mode", raw.fireMode || "—"]
    ];
    $("rawStats").innerHTML = rawStats.map(([k, v]) => `<div class="raw"><span>${k}</span><strong>${v}</strong></div>`).join("");
  }

  function emptyStats(message) {
    return `<div class="combat-stat" style="grid-column:1/-1"><span>DATA STATUS</span><strong style="font-size:15px">PENDING</strong><small>${escapeHtml(message)}</small></div>`;
  }

  function renderPrimaryBuild(roster, raw) {
    $("buildTitle").textContent = `${roster.name} • ${state.distance}m`;
    $("pointsLimit").textContent = "/100";
    if (!raw || !state.attachments || !state.ammo) return renderBuildPending("primary", raw ? "Attachment/ammo feed unavailable." : "Weapon stats/compatibility are not in the current source yet.");

    try {
      const result = optimize(raw, state.distance);
      $("pointsUsed").textContent = result.points;
      $("pointsMeter").style.width = `${result.points}%`;
      const audit = $("pointAuditBadge");
      audit.textContent = `POINT MATH PASS • ${result.points}/100 • SOURCE COSTS`;
      audit.className = "audit-line ok";
      $("attachmentGrid").innerHTML = result.picks
        .filter(x => x.id !== "none")
        .map(opt => attachmentCard(opt)).join("");
      renderWhy(raw, result);
      return result;
    } catch (err) {
      renderBuildPending("primary", err.message);
      return null;
    }
  }

  function renderBuildPending(which, reason) {
    if (which === "primary") {
      $("pointsUsed").textContent = "—";
      $("pointsMeter").style.width = "0%";
      $("pointAuditBadge").textContent = "BUILD DATA PENDING • NO POINTS GUESSED";
      $("pointAuditBadge").className = "audit-line bad";
      $("attachmentGrid").innerHTML = `<div class="attachment-card" style="grid-column:1/-1"><span>DATA STATUS</span><strong>No fabricated build</strong><small>${escapeHtml(reason)}</small></div>`;
      $("whyList").innerHTML = `<div class="why-item"><strong>Why no build?</strong><span>${escapeHtml(reason)} The 63-gun catalog remains intact while build data catches up.</span></div>`;
    } else {
      $("secondaryPointsUsed").textContent = "—";
      $("secondaryPointsMeter").style.width = "0%";
      $("secondaryAudit").textContent = "SIDEARM BUILD DATA PENDING • NO POINTS GUESSED";
      $("secondaryAudit").className = "audit-line bad";
      $("secondaryAttachmentGrid").innerHTML = `<div class="attachment-card" style="grid-column:1/-1"><span>DATA STATUS</span><strong>No fabricated sidearm build</strong><small>${escapeHtml(reason)}</small></div>`;
    }
  }

  function attachmentCard(opt) {
    return `<div class="attachment-card"><span>${escapeHtml(SLOT_LABELS[opt.slot] || opt.slot)}<b>${pointCost(opt)}p</b></span><strong>${escapeHtml(opt.name || prettifyId(opt.id))}</strong><small>${escapeHtml(attachmentNote(opt))}</small></div>`;
  }

  function renderWhy(raw, result) {
    const top = [...result.picks].filter(x => x.id !== "none").sort((a, b) => b.score - a.score).slice(0, 5);
    const items = [{
      title: "Lethality first",
      text: "The weapon recommendation prioritizes fastest ideal body TTK and damage. Attachments use any verified direct damage/ROF effect first; otherwise they focus on landing that damage reliably at the selected distance."
    }, {
      title: `${state.distance}m target distance`,
      text: distanceExplanation(state.distance)
    }, ...top.filter(x => x.score > 0).map(x => ({ title: x.name || prettifyId(x.id), text: attachmentNote(x) }))];
    $("whyList").innerHTML = items.slice(0, 6).map(x => `<div class="why-item"><strong>${escapeHtml(x.title)}</strong><span>${escapeHtml(x.text)}</span></div>`).join("");
  }

  function distanceExplanation(d) {
    if (d <= 15) return "Handling, hipfire and sprint recovery dominate because fights are extremely close.";
    if (d <= 40) return "Handling still matters, but recoil and moving ADS accuracy begin to matter more.";
    if (d <= 80) return "Control, precision and velocity carry more weight while excessive handling penalties are avoided.";
    if (d <= 130) return "Recoil consistency, velocity, optics and sight-picture utility dominate.";
    return "Extreme-range utility receives the strongest weight: velocity, stability, optic utility, range finding and sight-picture preservation.";
  }

  function scoreClass(classKey, roster) {
    const c = LOADOUT.classes[classKey];
    if (!c) return -Infinity;
    let s = blendRange(c.rangeBias) + Number(c.contextBias?.[state.context] ?? c.contextBias?.mixed ?? 0);
    if (c.signatureCategory === roster.cls) s += 24;
    return s;
  }

  function selectedClass(roster) {
    if (state.classChoice !== "auto") return state.classChoice;
    return Object.keys(LOADOUT.classes).sort((a, b) => scoreClass(b, roster) - scoreClass(a, roster))[0];
  }

  function scoreLoadoutItem(item) {
    const s = item?.score || {};
    return blendRange(s) + Number(s[state.context] ?? s.mixed ?? 0);
  }

  function chooseTwoGadgets(c) {
    const ranked = [...(c.gadgets || [])].sort((a, b) => scoreLoadoutItem(b) - scoreLoadoutItem(a));
    if (!ranked.length) return [];
    const first = ranked[0];
    const second = ranked.find(x => x.id !== first.id && !(c.rules?.maxLauncherGadgets === 1 && first.group === "launcher" && x.group === "launcher"));
    return [first, second].filter(Boolean);
  }

  function renderCompleteLoadout(roster) {
    const key = selectedClass(roster);
    const c = LOADOUT.classes[key];
    if (!c) return;
    const path = [...(c.paths || [])].sort((a, b) => scoreLoadoutItem(b) - scoreLoadoutItem(a))[0];
    const gadgets = chooseTwoGadgets(c);
    const throwable = [...(c.throwables || [])].sort((a, b) => scoreLoadoutItem(b) - scoreLoadoutItem(a))[0];

    $("classTitle").textContent = `${c.name} complete loadout`;
    $("classFit").textContent = state.classChoice === "auto" ? "AUTO BEST FIT" : "MANUAL CLASS";
    const pills = [
      ["CLASS", c.name], ["TRAINING", path?.name || "—"], ["SIGNATURE", c.signatureGadget],
      ["GADGET 1", gadgets[0]?.name || "—"], ["GADGET 2", gadgets[1]?.name || "—"], ["THROWABLE", throwable?.name || "—"]
    ];
    $("loadoutLine").innerHTML = pills.map(([k, v]) => `<div class="loadout-pill"><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></div>`).join("");

    const expl = [
      ["Class advantage", c.signatureCategory === roster.cls ? `${c.weaponBenefit} This directly synergizes with ${roster.name}.` : `${c.weaponBenefit} ${c.role}`],
      [path?.name || "Training", path?.why || "Selected from class training options."],
      [gadgets[0]?.name || "Gadget 1", gadgets[0]?.why || "—"],
      [gadgets[1]?.name || "Gadget 2", gadgets[1]?.why || "—"],
      [throwable?.name || "Throwable", throwable?.why || "—"]
    ];
    $("loadoutExplanations").innerHTML = expl.map(([k, v]) => `<div class="explanation"><strong>${escapeHtml(k)}</strong><p>${escapeHtml(v)}</p></div>`).join("");
  }

  function secondaryTargetDistance() {
    if (state.distance >= 70) return 10;
    if (state.distance <= 25) return 45;
    return 20;
  }

  function chooseSecondary() {
    const rawSecondaries = state.rawWeapons.filter(w => w.cls === "Secondary");
    const pool = (LOADOUT.fallbackSecondaries || []).map(f => {
      const raw = rawSecondaries.find(w => aliasKey(w.id) === aliasKey(f.id)) || rawSecondaries.find(w => aliasKey(w.name) === aliasKey(f.name));
      return raw || f;
    });
    const m = distanceMix(secondaryTargetDistance());
    const primaryLong = state.distance >= 70;
    const primaryShort = state.distance <= 25;

    return pool.map(w => {
      const role = LOADOUT.secondaryRoles?.[w.name] || LOADOUT.secondaryRoles?.[(rosterForRaw(w)?.name)] || {};
      let score = (role.short || 0) * m.short + (role.medium || 0) * m.medium + (role.long || 0) * m.long;
      if (primaryLong) score += Number(role.complementLong || 0);
      if (primaryShort) score += Number(role.complementShort || 0);
      return { weapon: w, role, score };
    }).sort((a, b) => b.score - a.score)[0] || null;
  }

  function renderSecondary() {
    const rec = chooseSecondary();
    if (!rec) return renderBuildPending("secondary", "No secondary data available.");
    const raw = state.rawWeapons.find(w => aliasKey(w.id) === aliasKey(rec.weapon.id)) || null;
    $("secondaryTitle").textContent = rec.weapon.name;
    const target = secondaryTargetDistance();
    $("secondaryWhy").textContent = `${rec.role?.why || "Selected to cover the primary weapon's weak range."} Sidearm build is optimized around ~${target}m as a complement to your ${state.distance}m primary setup.`;

    if (!raw || !state.attachments || !state.ammo) return renderBuildPending("secondary", raw ? "Attachment/ammo feed unavailable." : "Exact sidearm attachment data unavailable.");
    try {
      const result = optimize(raw, target);
      $("secondaryPointsUsed").textContent = result.points;
      $("secondaryPointsMeter").style.width = `${Math.min(100, result.points / 60 * 100)}%`;
      $("secondaryAudit").textContent = `POINT MATH PASS • ${result.points}/60 • SIDEARM BUDGET`;
      $("secondaryAudit").className = "audit-line ok";
      $("secondaryAttachmentGrid").innerHTML = result.picks.filter(x => x.id !== "none").map(attachmentCard).join("");
    } catch (err) {
      renderBuildPending("secondary", err.message);
    }
  }

  function renderWarnings(roster, raw) {
    const warnings = [];
    if (state.source.weapons === "failed") warnings.push("Weapon stat feed is unavailable. All 63 catalog weapons remain visible, but raw stat/TTK panels are pending.");
    if (state.source.attachments === "failed" || state.source.ammo === "failed") warnings.push("Attachment or ammo feed is unavailable, so the optimizer will not fabricate a point build.");
    const ver = sourceVersion(raw);
    if (ver && ver !== CURRENT.liveVersion) warnings.push(`This weapon's damage provenance reports ${ver}; live BF6 is ${CURRENT.liveVersion}. Use the recommendation as version-sensitive, not guaranteed current meta.`);
    if (roster.id === "interdictor" && !raw) warnings.push("Interdictor is in the current roster, but this analyzer feed has not published its raw weapon/attachment model yet.");
    if (["ef88", "brod3"].includes(roster.id) && Date.now() < Date.parse("2026-09-02T00:00:00Z")) warnings.push("Match Trigger is excluded from this weapon through the Sep 1 rollout window because EA has a fix scheduled for its full-auto behavior.");
    const card = $("warningCard");
    if (!warnings.length) { card.classList.add("hidden"); card.innerHTML = ""; return; }
    card.classList.remove("hidden");
    card.innerHTML = `<strong>DATA CHECK:</strong> ${warnings.map(escapeHtml).join(" ")}`;
  }

  function renderRangeNote(roster) {
    const note = roster.officialRange;
    const el = $("officialRangeNote");
    if (Array.isArray(note) && note.length === 2) {
      const inRange = state.distance >= note[0] && state.distance <= note[1];
      el.innerHTML = `<strong>EA RANGE NOTE:</strong> ${escapeHtml(roster.name)} is described as strongest around ${note[0]}–${note[1]}m. ${inRange ? "Your selected distance is inside that window." : "Your selected distance is outside that window."}`;
    } else {
      el.textContent = `Exact target: ${state.distance}m. Quick labels are shortcuts only; the optimizer scores the actual distance.`;
    }
  }

  function renderAutoRecommendation() {
    const box = $("autoRecommendation");
    if (!box) return;
    const ranked = rankWeapons(state.category, state.distance);
    if (state.selectionMode !== "auto") {
      box.className = "auto-recommendation manual";
      box.innerHTML = `<div><span>MANUAL WEAPON LOCK</span><strong>${escapeHtml(rosterWeapon()?.name || "—")}</strong><small>Distance changes will keep this weapon and only re-optimize its attachments. Choose AUTO in the weapon menu to resume automatic weapon switching.</small></div>`;
      return;
    }
    if (!ranked.length) {
      box.className = "auto-recommendation warn";
      box.innerHTML = `<div><span>AUTO RANKING WAITING</span><strong>Weapon stats are not available yet</strong><small>The complete catalog remains selectable manually.</small></div>`;
      return;
    }
    const leader=ranked[0];
    const scope = state.category === "__all__" ? "ALL PRIMARY WEAPONS" : state.category.toUpperCase();
    const top = ranked.slice(0,3).map((x,i)=>`<div class="rank-chip ${i===0?'winner':''}"><span>#${i+1}</span><b>${escapeHtml(x.roster.name)}</b><small>${Math.round(x.combat.ttk)}ms TTK • ${fmtDamage(x.combat.damage)} dmg</small></div>`).join("");
    box.className = "auto-recommendation";
    box.innerHTML = `<div class="auto-main"><span>AUTO BEST • ${escapeHtml(scope)} • ${state.distance}M</span><strong>${escapeHtml(leader.roster.name)}</strong><small>Lethality-first ranking: TTK 70% • damage 20% • BTK 5% • delivery 5%. ${ranked.length}/${categoryRoster().length} weapons currently have enough stat data to rank. Moving the distance can change the winner.</small></div><div class="rank-row">${top}</div>`;
  }

  function fmtDamage(v) {
    if (!Number.isFinite(Number(v))) return "—";
    const n=Number(v);
    return n.toFixed(n%1?1:0);
  }

  function renderHeader(roster) {
    $("weaponClassLabel").textContent = roster.cls;
    $("weaponHeaderName").textContent = roster.name;
    $("weaponUnlock").textContent = roster.unlock || "";
    $("distanceValue").textContent = state.distance;
    renderRangeNote(roster);
  }

  function renderAll() {
    const roster = rosterWeapon();
    if (!roster) return;
    const raw = rawForRoster(roster);
    renderHeader(roster);
    renderAutoRecommendation();
    renderWeaponIntel(roster, raw);
    renderPrimaryBuild(roster, raw);
    renderCompleteLoadout(roster);
    renderSecondary();
    renderWarnings(roster, raw);
  }

  function categoryRoster() {
    return CURRENT.roster.filter(w => w.cls !== "Secondary" && (state.category === "__all__" || w.cls === state.category));
  }

  function populateTabs() {
    const tabs = $("weaponTabs");
    const all = `<button data-category="__all__" class="${state.category === "__all__" ? "active" : ""}">AUTO BEST <em>56</em></button>`;
    const cats = CURRENT.primaryClasses.map(cls => {
      const count=CURRENT.roster.filter(w=>w.cls===cls).length;
      return `<button data-category="${escapeHtml(cls)}" class="${cls === state.category ? "active" : ""}">${escapeHtml(tabLabel(cls))} <em>${count}</em></button>`;
    }).join("");
    tabs.innerHTML = all + cats;
  }

  function tabLabel(cls) {
    const map = { "Assault Rifle": "Assault", Carbine: "Carbine", SMG: "SMG", LMG: "LMG", DMR: "DMR", "Sniper Rifle": "Sniper", Shotgun: "Shotgun" };
    return map[cls] || cls;
  }

  function autoOptionLabel() {
    const scope = state.category === "__all__" ? "ANY WEAPON" : tabLabel(state.category).toUpperCase();
    const winner = rankWeapons(state.category, state.distance)[0]?.roster?.name;
    return winner ? `AUTO — BEST ${scope} @ ${state.distance}m → ${winner}` : `AUTO — BEST ${scope} @ ${state.distance}m`;
  }

  function populateWeaponSelect(keepId = null) {
    const list = categoryRoster();
    if (state.selectionMode === "manual" && keepId && !list.some(w=>w.id===keepId)) state.selectionMode="auto";
    if (state.selectionMode === "auto") resolveAutoWeapon();
    else if (keepId && list.some(w=>w.id===keepId)) state.weaponId=keepId;
    else if (!list.some(w=>w.id===state.weaponId)) state.weaponId=list[0]?.id || null;

    $("weaponSelect").innerHTML = `<option value="__auto__">${escapeHtml(autoOptionLabel())}</option>` +
      list.map(w => `<option value="${escapeHtml(w.id)}">${escapeHtml(w.name)}${rawForRoster(w)?"":" • data pending"}</option>`).join("");
    $("weaponSelect").value = state.selectionMode === "auto" ? "__auto__" : (state.weaponId || "");
  }

  function setDistance(d) {
    state.distance = Math.max(5, Math.min(300, Math.round(Number(d) || 25)));
    $("distanceSlider").value = state.distance;
    $("distanceValue").textContent = state.distance;
    document.querySelectorAll("#distancePresets button").forEach(b => b.classList.toggle("active", Number(b.dataset.distance) === state.distance));
    if (state.selectionMode === "auto") resolveAutoWeapon();
    populateWeaponSelect(state.weaponId);
    renderAll();
  }

  function bind() {
    $("weaponTabs").addEventListener("click", e => {
      const btn = e.target.closest("button[data-category]");
      if (!btn) return;
      state.category = btn.dataset.category;
      state.selectionMode = "auto";
      resolveAutoWeapon();
      populateTabs();
      populateWeaponSelect();
      renderAll();
    });
    $("weaponSelect").addEventListener("change", e => {
      if (e.target.value === "__auto__") {
        state.selectionMode="auto";
        resolveAutoWeapon();
      } else {
        state.selectionMode="manual";
        state.weaponId=e.target.value;
      }
      populateWeaponSelect(state.weaponId);
      renderAll();
    });
    $("distanceSlider").addEventListener("input", e => setDistance(e.target.value));
    $("distancePresets").addEventListener("click", e => {
      const btn = e.target.closest("button[data-distance]");
      if (btn) setDistance(btn.dataset.distance);
    });
    $("classSelect").addEventListener("change", e => { state.classChoice = e.target.value; renderAll(); });
    $("contextSelect").addEventListener("change", e => { state.context = e.target.value; renderAll(); });
    ["stayAds", "movingAds", "stealth", "bigMag"].forEach(id => $(id).addEventListener("change", renderAll));
    $("optimizeBtn").addEventListener("click", () => {
      renderAll();
      $("buildTitle")?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function escapeHtml(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  }

  async function init() {
    state.category = "__all__";
    state.selectionMode = "auto";
    populateTabs();
    resolveAutoWeapon();
    populateWeaponSelect();
    bind();
    renderAll(); // catalog shell appears instantly
    await loadData();
    resolveAutoWeapon();
    populateWeaponSelect();
    renderAll();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  init();
})();
