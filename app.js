(() => {
  "use strict";

  const REMOTE = {
    weapons: "https://raw.githubusercontent.com/raymdl/BF6-Weapon-Analyzer/refs/heads/main/data/weapons.json",
    attachments: "https://raw.githubusercontent.com/raymdl/BF6-Weapon-Analyzer/refs/heads/main/data/attachments.json",
    ammo: "https://raw.githubusercontent.com/raymdl/BF6-Weapon-Analyzer/refs/heads/main/data/ammo.json",
    ballistics: "https://raw.githubusercontent.com/raymdl/BF6-Weapon-Analyzer/refs/heads/main/data/ballistics.json"
  };

  const CURRENT = window.BF6_CURRENT || { roster: [], primaryClasses: [] };
  const LOADOUT = window.BF6_LOADOUT_DATA || { classes: {}, fallbackSecondaries: [], secondaryRoles: {} };
  const $ = id => document.getElementById(id);

  const state = {
    category: "__all__",
    weaponId: null,
    selectionMode: "auto",
    // Top-level combat scenario. Both fields are first-class optimizer inputs:
    // they reach ranking, attachment selection and every displayed value.
    gameMode: "multiplayer",
    targetArmor: "unarmored",
    redsecModel: null,
    sourceVerification: null,
    // The loaded data/source-overlays.json document, and the result of applying
    // it. Display-facing code reads these to say which game version the numbers
    // on screen actually come from.
    sourceOverlay: null,
    overlayApplication: null,
    freshness: null,
    // One canonical fighting distance in meters. The slider, the preset
    // shortcuts and the custom numeric input all write this single value, and
    // the optimizer always reads exactly this value. There is deliberately no
    // parallel preset/slider/optimizer distance that could drift apart.
    distance: 25,
    // "auto" keeps each mode's historical strategy default. PRIORITY only ever
    // selects between the two strategies the engine already implements.
    priority: "auto",
    // Historical defaults of the on-demand optimizer's handling preferences.
    preferences: { stayAds: true, movingAds: true, stealth: false, bigMag: false },
    classChoice: "auto",
    context: "mixed",
    // Set when renderPrimaryBuild() cannot produce a build, so a fault is not
    // reported downstream as an ordinary "cache pending" state.
    lastBuildError: null,
    rawWeapons: [],
    attachments: null,
    ammo: null,
    ballistics: null,
    combatCache: null,
    assaultAudit: null,
    carbineAudit: null,
    smgAudit: null,
    lmgAudit: null,
    dmrAudit: null,
    sniperAudit: null,
    sidearmAudit: null,
    shotgunAudit: null,
    // Display-only attachment naming audit. Never read by the optimizer.
    nameAudit: null,
    source: { freshness: "loading", redsec: "loading", weapons: "loading", attachments: "loading", ammo: "loading", ballistics: "loading", combat: "loading", assaultAudit: "loading", carbineAudit: "loading", smgAudit: "loading", lmgAudit: "loading", dmrAudit: "loading", sniperAudit: "loading", sidearmAudit: "loading", shotgunAudit: "loading", nameAudit: "loading", sourceOverlays: "loading" }
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

  const MANUAL_RANGE_PROFILES = [
    { d:10, label:"CQB" },
    { d:25, label:"CLOSE" },
    { d:50, label:"MID" },
    { d:100, label:"LONG" },
    { d:150, label:"EXTREME" }
  ];

  const BLOCKED_UNTIL_PATCH = new Set(["ef88:match_trigger", "brod3:match_trigger"]);

  function normalizeName(v) {
    return String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function aliasKey(v) {
    const n = normalizeName(v);
    const aliases = {
      l115a3: "l115", l115: "l115",
      m60: "m60", tr7: "tr7", "185ksk": "185ksk", "18_5ksk": "185ksk", ks18k: "185ksk"
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

  function setChip(id, text, cls = "", title = "") {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
    el.className = `data-chip ${cls}`.trim();
    if (title) el.title = title; else el.removeAttribute("title");
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

  function validateCombatCacheObject(cache) {
    const errors = [];
    const atomicKinds = ["weapons","attachments","ammo","ballistics"];
    const nonLocal = atomicKinds.filter(kind => state.source[kind] !== "local");
    if (nonLocal.length) errors.push(`cache requires atomic local source snapshot; non-local: ${nonLocal.join(", ")}`);
    if (!cache?.audit?.pass) errors.push("audit.pass is false");
    const expected = Number(cache?.audit?.weaponsSource);
    const modeled = Number(cache?.audit?.modeled);
    const incomplete = Number(cache?.audit?.incomplete);
    if (!Number.isInteger(expected) || expected <= 0) errors.push("invalid weaponsSource");
    // The exhaustive simulator can only model weapons present in the current raw
    // Analyzer feed. Empirical roster-only weapons (currently Interdictor) are
    // deliberately excluded from VERIFIED AUTO rather than invalidating the whole cache.
    const expectedRawRoster = CURRENT.roster.filter(r => rawForRoster(r)).length;
    if (expected !== expectedRawRoster) errors.push(`cache raw-roster ${expected}/${expectedRawRoster}`);
    if (cache?.source?.gameVersion !== CURRENT.liveVersion) errors.push(`cache version ${cache?.source?.gameVersion || "missing"}/${CURRENT.liveVersion}`);
    if (cache?.source?.rankingModel !== "laserbeam-v4-stable-utility-range-optics") errors.push(`ranking model ${cache?.source?.rankingModel || "missing"}/laserbeam-v4-stable-utility-range-optics`);
    if (cache?.source?.manualBuildModel !== "range-lethality-v2") errors.push(`manual build model ${cache?.source?.manualBuildModel || "missing"}/range-lethality-v2`);
    if (cache?.source?.opticModel !== "tier-range-fit-v1") errors.push(`optic model ${cache?.source?.opticModel || "missing"}/tier-range-fit-v1`);
    if (!Number.isInteger(modeled) || modeled !== expected) errors.push(`modeled ${modeled}/${expected}`);
    if (!Number.isInteger(incomplete) || incomplete !== 0) errors.push(`incomplete ${incomplete}`);
    if (cache?.audit?.errors?.length) errors.push(`audit errors ${cache.audit.errors.length}`);
    if (cache?.audit?.distancesPerWeapon !== 300) errors.push("expected 300 distances per weapon");
    const entries = Object.values(cache?.weapons ?? {});
    if (Number.isInteger(expected) && entries.length !== expected) errors.push(`weapon entries ${entries.length}/${expected}`);
    const rosterKeys = new Set(CURRENT.roster.flatMap(w => [aliasKey(w.id), aliasKey(w.name), ...(w.aliases || []).map(aliasKey)]));
    for (const w of entries) {
      if (!rosterKeys.has(aliasKey(w?.id)) && !rosterKeys.has(aliasKey(w?.name))) { errors.push(`${w?.id || w?.name || "unknown"}: not in current roster`); continue; }
      if (w?.status !== "modeled") { errors.push(`${w?.id || "unknown"}: ${w?.status || "missing status"}`); continue; }
      for (let d=1; d<=300; d++) {
        const row=w.best?.[String(d)];
        if (!row) { errors.push(`${w.id}: missing ${d}m`); break; }
        if (!Number.isFinite(Number(row.points)) || Number(row.points) > Number(w.budget)) { errors.push(`${w.id}@${d}: invalid points`); break; }
        if (!w.builds?.[row.buildId]) { errors.push(`${w.id}@${d}: missing winning build`); break; }
        if (!Number.isFinite(Number(row.ttk)) || Number(row.ttk) < 0 || !Number.isFinite(Number(row.triggerTtk)) || Number(row.triggerTtk) < Number(row.ttk) || !Number.isFinite(Number(row.flightMs)) || Number(row.flightMs) < 0 || !Number.isFinite(Number(row.btk)) || Number(row.btk) < 1) { errors.push(`${w.id}@${d}: invalid ballistic lethality`); break; }
        if (!Number.isFinite(Number(row.beamIndex)) || Number(row.beamIndex) < 0 || !Number.isFinite(Number(row.effectiveAdsSpreadDeg)) || Number(row.effectiveAdsSpreadDeg) < 0) { errors.push(`${w.id}@${d}: invalid beam metrics`); break; }
        if (!Number.isFinite(Number(row.opticFit)) || Number(row.opticFit) < 0 || Number(row.opticFit) > 100 || !row.sightId) { errors.push(`${w.id}@${d}: invalid range-optic metrics`); break; }
        if (w.cls !== "Sidearm" && row.opticEligible !== true) { errors.push(`${w.id}@${d}: AUTO winner has range-ineligible optic ${row.sightId}`); break; }
        const lethal=w.bestLethal?.[String(d)];
        if (!lethal || !w.builds?.[lethal.buildId]) { errors.push(`${w.id}@${d}: missing manual max-lethality winner`); break; }
        if (!Number.isFinite(Number(lethal.points)) || Number(lethal.points) > Number(w.budget)) { errors.push(`${w.id}@${d}: invalid manual winner points`); break; }
        if (Number(w.builds[lethal.buildId].points) !== Number(lethal.points)) { errors.push(`${w.id}@${d}: manual winner/build point mismatch`); break; }
        if (!Number.isFinite(Number(lethal.triggerTtk)) || Number(lethal.triggerTtk) < Number(lethal.ttk) || !Number.isFinite(Number(lethal.btk)) || Number(lethal.btk) < 1) { errors.push(`${w.id}@${d}: invalid manual lethality winner`); break; }
        if (!Number.isFinite(Number(lethal.opticFit)) || Number(lethal.opticFit) < 0 || Number(lethal.opticFit) > 100 || !lethal.sightId) { errors.push(`${w.id}@${d}: invalid manual range-optic winner`); break; }
        if (w.cls !== "Sidearm" && lethal.opticEligible !== true) { errors.push(`${w.id}@${d}: manual winner has range-ineligible optic ${lethal.sightId}`); break; }
      }
    }
    return { ok: errors.length === 0, errors };
  }

  async function loadCombatCache() {
    try {
      const cache = await fetchJson("./data/combat-cache.json", 5000);
      if (cache?.status === "pending") {
        state.source.combat = "pending";
        return null;
      }
      const gate = validateCombatCacheObject(cache);
      if (gate.ok) {
        state.combatCache = cache;
        state.source.combat = "ready";
        return cache;
      }
      console.warn("Combat cache rejected:", gate.errors.slice(0, 10));
      state.source.combat = "invalid";
      return null;
    } catch (_) {
      state.source.combat = "failed";
      return null;
    }
  }

  async function loadAssaultAudit() {
    // Prefer the GitHub Action runtime gate when it exists. The checked-in
    // assault-audit.json is the fixed independently verified baseline.
    try {
      const runtime = await fetchJson("./data/assault-audit-runtime.json", 2500);
      if (runtime?.pass && runtime?.class === "Assault Rifle") {
        const baseline = await fetchJson("./data/assault-audit.json", 2500);
        if (baseline?.pass && baseline?.weapons) {
          state.assaultAudit = { ...baseline, runtime };
          state.source.assaultAudit = "runtime-pass";
          return state.assaultAudit;
        }
      }
    } catch (_) {}
    try {
      const audit = await fetchJson("./data/assault-audit.json", 5000);
      if (audit?.pass && audit?.class === "Assault Rifle" && audit?.weapons) {
        state.assaultAudit = audit;
        state.source.assaultAudit = "baseline-pass";
        return audit;
      }
      state.source.assaultAudit = "invalid";
      return null;
    } catch (_) {
      state.source.assaultAudit = "failed";
      return null;
    }
  }

  async function loadCarbineAudit() {
    // Prefer the GitHub Action runtime gate when it exists. The checked-in
    // carbine-audit.json is the fixed independently verified baseline.
    try {
      const runtime = await fetchJson("./data/carbine-audit-runtime.json", 2500);
      if (runtime?.pass && runtime?.class === "Carbine") {
        const baseline = await fetchJson("./data/carbine-audit.json", 2500);
        if (baseline?.pass && baseline?.weapons) {
          state.carbineAudit = { ...baseline, runtime };
          state.source.carbineAudit = "runtime-pass";
          return state.carbineAudit;
        }
      }
    } catch (_) {}
    try {
      const audit = await fetchJson("./data/carbine-audit.json", 5000);
      if (audit?.pass && audit?.class === "Carbine" && audit?.weapons) {
        state.carbineAudit = audit;
        state.source.carbineAudit = "baseline-pass";
        return audit;
      }
      state.source.carbineAudit = "invalid";
      return null;
    } catch (_) {
      state.source.carbineAudit = "failed";
      return null;
    }
  }

  async function loadSmgAudit() {
    // Prefer the GitHub Action runtime gate when it exists. The checked-in
    // smg-audit.json is the fixed independently verified baseline.
    try {
      const runtime = await fetchJson("./data/smg-audit-runtime.json", 2500);
      if (runtime?.pass && runtime?.class === "SMG") {
        const baseline = await fetchJson("./data/smg-audit.json", 2500);
        if (baseline?.pass && baseline?.weapons) {
          state.smgAudit = { ...baseline, runtime };
          state.source.smgAudit = "runtime-pass";
          return state.smgAudit;
        }
      }
    } catch (_) {}
    try {
      const audit = await fetchJson("./data/smg-audit.json", 5000);
      if (audit?.pass && audit?.class === "SMG" && audit?.weapons) {
        state.smgAudit = audit;
        state.source.smgAudit = "baseline-pass";
        return audit;
      }
      state.source.smgAudit = "invalid";
      return null;
    } catch (_) {
      state.source.smgAudit = "failed";
      return null;
    }
  }

  async function loadLmgAudit() {
    // Prefer the GitHub Action runtime gate when it exists. The checked-in
    // lmg-audit.json is the fixed independently verified baseline.
    try {
      const runtime = await fetchJson("./data/lmg-audit-runtime.json", 2500);
      if (runtime?.pass && runtime?.class === "LMG") {
        const baseline = await fetchJson("./data/lmg-audit.json", 2500);
        if (baseline?.pass && baseline?.weapons) {
          state.lmgAudit = { ...baseline, runtime };
          state.source.lmgAudit = "runtime-pass";
          return state.lmgAudit;
        }
      }
    } catch (_) {}
    try {
      const audit = await fetchJson("./data/lmg-audit.json", 5000);
      if (audit?.pass && audit?.class === "LMG" && audit?.weapons) {
        state.lmgAudit = audit;
        state.source.lmgAudit = "baseline-pass";
        return audit;
      }
      state.source.lmgAudit = "invalid";
      return null;
    } catch (_) {
      state.source.lmgAudit = "failed";
      return null;
    }
  }

  async function loadDmrAudit() {
    try {
      const runtime = await fetchJson("./data/dmr-audit-runtime.json", 2500);
      if (runtime?.pass && runtime?.class === "DMR") {
        const baseline = await fetchJson("./data/dmr-audit.json", 2500);
        if (baseline?.pass && baseline?.weapons) {
          state.dmrAudit = { ...baseline, runtime };
          state.source.dmrAudit = "runtime-pass";
          return state.dmrAudit;
        }
      }
    } catch (_) {}
    try {
      const audit = await fetchJson("./data/dmr-audit.json", 5000);
      if (audit?.pass && audit?.class === "DMR" && audit?.weapons) {
        state.dmrAudit = audit;
        state.source.dmrAudit = "baseline-pass";
        return audit;
      }
      state.source.dmrAudit = "invalid";
      return null;
    } catch (_) {
      state.source.dmrAudit = "failed";
      return null;
    }
  }

  async function loadSniperAudit() {
    try {
      const runtime = await fetchJson("./data/sniper-audit-runtime.json", 2500);
      if (runtime?.pass && runtime?.class === "Sniper Rifle") {
        const baseline = await fetchJson("./data/sniper-audit.json", 2500);
        if (baseline?.pass && baseline?.weapons) {
          state.sniperAudit = { ...baseline, runtime };
          state.source.sniperAudit = "runtime-pass";
          return state.sniperAudit;
        }
      }
    } catch (_) {}
    try {
      const audit = await fetchJson("./data/sniper-audit.json", 5000);
      if (audit?.pass && audit?.class === "Sniper Rifle" && audit?.weapons) {
        state.sniperAudit = audit;
        state.source.sniperAudit = "baseline-pass";
        return audit;
      }
      state.source.sniperAudit = "invalid";
      return null;
    } catch (_) {
      state.source.sniperAudit = "failed";
      return null;
    }
  }

  async function loadSidearmAudit() {
    try {
      const runtime = await fetchJson("./data/sidearm-audit-runtime.json", 2500);
      if (runtime?.pass && runtime?.class === "Sidearm") {
        const baseline = await fetchJson("./data/sidearm-audit.json", 2500);
        if (baseline?.pass && baseline?.weapons) {
          state.sidearmAudit = { ...baseline, runtime };
          state.source.sidearmAudit = "runtime-pass";
          return state.sidearmAudit;
        }
      }
    } catch (_) {}
    try {
      const audit = await fetchJson("./data/sidearm-audit.json", 5000);
      if (audit?.pass && audit?.class === "Sidearm" && audit?.weapons) {
        state.sidearmAudit = audit;
        state.source.sidearmAudit = "baseline-pass";
        return audit;
      }
      state.source.sidearmAudit = "invalid";
      return null;
    } catch (_) {
      state.source.sidearmAudit = "failed";
      return null;
    }
  }

  async function loadShotgunAudit() {
    try {
      const runtime = await fetchJson("./data/shotgun-audit-runtime.json", 2500);
      if (runtime?.pass && runtime?.class === "Shotgun") {
        const baseline = await fetchJson("./data/shotgun-audit.json", 2500);
        if (baseline?.pass && baseline?.weapons) {
          state.shotgunAudit = { ...baseline, runtime };
          state.source.shotgunAudit = "runtime-pass";
          return state.shotgunAudit;
        }
      }
    } catch (_) {}
    try {
      const audit = await fetchJson("./data/shotgun-audit.json", 5000);
      if (audit?.pass && audit?.class === "Shotgun" && audit?.weapons) {
        state.shotgunAudit = audit;
        state.source.shotgunAudit = "baseline-pass";
        return audit;
      }
      state.source.shotgunAudit = "invalid";
      return null;
    } catch (_) {
      state.source.shotgunAudit = "failed";
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Attachment display-name verification.
  //
  // Loaded and applied strictly as presentation metadata. It is never consulted
  // by buildOptions(), scoreOption(), optimize(), cachedBuild() or any ranking
  // function, so an unverified name can never remove an attachment from
  // candidate evaluation, change its point cost or modifiers, or reorder a
  // build. Identity stays the attachmentId; the display string is separate.
  // ---------------------------------------------------------------------------
  async function loadAttachmentNameAudit() {
    try {
      const audit = await fetchJson("./data/attachment-name-audit.json", 4000);
      if (audit?.attachments && audit.affectsOptimizer === false) {
        const byKey = new Map();
        for (const rec of audit.attachments) byKey.set(`${rec.internalType}:${rec.attachmentId}`, rec);
        state.nameAudit = { ...audit, byKey };
        state.source.nameAudit = "loaded";
        return state.nameAudit;
      }
      state.source.nameAudit = "invalid";
      return null;
    } catch (_) {
      state.source.nameAudit = "failed";
      return null;
    }
  }

  async function loadRedsecModel() {
    try {
      const m = await fetchJson("./data/redsec-model.json", 4000);
      if (m?.armor?.battleRoyale?.totalHp && m?.damageVsArmor?.rangeShiftMeters?.value != null) {
        state.redsecModel = m;
        state.source.redsec = "loaded";
        return m;
      }
      state.source.redsec = "invalid";
      return null;
    } catch (_) {
      state.source.redsec = "failed";
      return null;
    }
  }


  /**
   * End-to-end source-data verification state, produced by
   * scripts/audit-source-data.mjs. The optimizer and ranking engine are
   * separately validated; this describes the FACTS they consume, so the UI can
   * never present a validated algorithm over stale or unverified inputs as a
   * verified answer.
   */
  async function loadSourceVerification() {
    try {
      const v = await fetchJson("./data/source-verification.json", 4000);
      if ((v?.schema === 1 || v?.schema === 2) && typeof v.endToEndStatus === "string") {
        state.sourceVerification = v;
        state.source.sourceVerification = "loaded";
        return v;
      }
      state.source.sourceVerification = "invalid";
      return null;
    } catch (_) {
      state.source.sourceVerification = "failed";
      return null;
    }
  }

  /**
   * Versioned source overlays (data/source-overlays.json).
   *
   * data/weapons.json is a byte-identical mirror of the upstream feed and must
   * stay that way - the manifest hashes it and the Combat Engine re-syncs it.
   * Values newer than that mirror therefore live in an overlay carrying its own
   * game version, publisher and per-change provenance, applied here on load.
   */
  async function loadSourceOverlays() {
    try {
      const doc = await fetchJson("./data/source-overlays.json", 4000);
      if (doc?.schema === 1 && Array.isArray(doc.overlays)) {
        state.sourceOverlay = doc;
        state.source.sourceOverlays = "loaded";
        return doc;
      }
      state.source.sourceOverlays = "invalid";
      return null;
    } catch (_) {
      // No overlay file, or unreachable. The pristine baseline is still a valid
      // dataset - it is simply older - so this is not a fault, it is a state.
      state.source.sourceOverlays = "absent";
      return null;
    }
  }

  /**
   * Apply the overlay document through the ONE shared applier in source-overlay.js
   * (the same module scripts/build-combat-cache.mjs uses via scripts/source-overlay.mjs,
   * so the browser and the exhaustive cache can never disagree about the data).
   *
   * Fails closed: any change whose declared baseline no longer matches the mirror
   * is skipped and recorded, never forced.
   */
  function applySourceOverlays(baseline, doc) {
    state.overlayApplication = null;
    if (!doc) return baseline;
    const api = window.BF6_SOURCE_OVERLAY;
    if (!api || typeof api.applyOverlays !== "function") {
      state.source.sourceOverlays = "applier-missing";
      return baseline;
    }
    const result = api.applyOverlays(baseline, doc);
    state.overlayApplication = {
      applied: result.applied.length,
      errors: result.errors,
      versions: result.versions
    };
    if (result.errors.length) {
      state.source.sourceOverlays = "conflict";
      // A conflicting overlay means the baseline moved underneath it. Keep the
      // partial-but-verified result rather than either forcing the stale values
      // in or discarding correctly-applied ones; the gate blocks this in CI.
    }
    return result.weapons;
  }

  async function loadFreshnessStatus() {
    try {
      const f = await fetchJson("./data/freshness-status.json", 3000);
      if (f?.schema === 1 && f?.official?.gameVersion && f?.verified?.gameVersion) {
        state.freshness = f;
        state.source.freshness = "loaded";
        return f;
      }
      state.source.freshness = "invalid";
      return null;
    } catch (_) {
      state.source.freshness = "failed";
      return null;
    }
  }

  function freshnessUi() {
    const f = state.freshness;
    const official = f?.official?.gameVersion || CURRENT.liveVersion || "—";
    const verified = f?.verified?.gameVersion || CURRENT.liveVersion || "—";
    const st = f?.state || "unknown";
    if (st === "verified") return { cls: "ok", chip: `LIVE ${official} • VERIFIED`, official, verified, state: st, note: "Official BF6 version matches the verified combat model." };
    if (st === "current-no-combat-change-detected") return { cls: "ok", chip: `LIVE ${official} • COMBAT CURRENT`, official, verified, state: st, note: `Official update ${official} detected; no combat-relevant change was found in its changelog. Combat math remains verified through ${verified}.` };
    if (st === "source-update-pending") return { cls: "warn", chip: `SOURCE UPDATE • VERIFYING`, official, verified, state: st, note: "A newer analyzer snapshot is being validated. The site remains on the last known-good combat data until it passes." };
    if (st === "verification-pending") {
      const blocked = f?.verified?.blockedAt;
      return {
        cls: "warn",
        chip: `LIVE ${official} • COMBAT ${verified}`,
        official, verified, state: st, blockedAt: blocked || null,
        note: blocked
          ? `Battlefield ${official} is live. Combat data is reconciled through ${verified}; ${blocked} introduced combat changes that are not represented in the current dataset, so the verified version deliberately stops before it.`
          : `A newer BF6 update was detected. Combat-relevant changes are not promoted until the full verification pipeline passes.`
      };
    }
    return { cls: "warn", chip: `LIVE ${official} • STATUS CHECK`, official, verified, state: st, note: "Freshness status is unavailable or incomplete; verified calculations remain fail-closed." };
  }

  function nameRecord(opt) {
    if (!opt || !state.nameAudit) return null;
    return state.nameAudit.byKey.get(`${opt.slot}:${opt.id}`)
      ?? state.nameAudit.attachments.find(r => r.attachmentId === opt.id)
      ?? null;
  }

  const NAME_STATUS_UI = {
    GAME_VERIFIED_EXACT: { chip: "EXACT BF6 NAME", cls: "ok", note: "Confirmed against the current Battlefield 6 in-game display string." },
    SOURCE_CORROBORATED: { chip: "SOURCE NAME", cls: "", note: "Carried verbatim from the pinned, hash-verified BF6 source data. Not yet confirmed against the live in-game string." },
    UNVERIFIED: { chip: "NAME UNVERIFIED", cls: "warn", note: "Exact attachment name pending verification. The mechanics, point cost and ranking of this attachment are unaffected." },
    INTERNAL_PLACEHOLDER: { chip: "CATEGORY LABEL", cls: "warn", note: "Internal category/tier label, not a verified Battlefield 6 attachment name." },
    MISMATCH: { chip: "NAME CONFLICT", cls: "bad", note: "Sources disagree about this attachment's exact name. The conflict is left visible rather than guessed." },
    PENDING: { chip: "NAME AUDIT PENDING", cls: "", note: "The attachment naming audit has not loaded, so name confidence is unknown." }
  };

  /**
   * Resolve what to show for an attachment. The verified exact BF6 name wins
   * when one exists; otherwise the current source string is shown as-is and
   * visibly marked unverified. Nothing here is ever tidied up or simplified.
   */
  function attachmentDisplay(opt) {
    const rec = nameRecord(opt);
    const fallback = opt?.name || prettifyId(opt?.id);
    if (!rec) return { name: fallback, status: "PENDING", ui: NAME_STATUS_UI.PENDING, record: null };
    const trusted = rec.verificationStatus === "GAME_VERIFIED_EXACT" || rec.verificationStatus === "SOURCE_CORROBORATED";
    const name = trusted && rec.verifiedExactName ? rec.verifiedExactName : rec.currentDisplayName || fallback;
    return { name, status: rec.verificationStatus, ui: NAME_STATUS_UI[rec.verificationStatus] ?? NAME_STATUS_UI.PENDING, record: rec };
  }

  /** Build-level naming confidence. Display only; the build itself is unchanged. */
  function buildNameConfidence(picks) {
    const real = (picks || []).filter(p => p.id !== "none");
    if (!state.nameAudit) return { level: "PENDING", label: "NAME AUDIT PENDING", cls: "", verified: 0, exact: 0, total: real.length };
    const statuses = real.map(p => attachmentDisplay(p).status);
    // Source-corroborated counts as a named attachment for build-level rollup;
    // the per-card chip still distinguishes it from in-game confirmation.
    const verified = statuses.filter(s => s === "GAME_VERIFIED_EXACT" || s === "SOURCE_CORROBORATED").length;
    // Kept separate so the UI can never present source corroboration as an
    // in-game exact-name confirmation.
    const exact = statuses.filter(s => s === "GAME_VERIFIED_EXACT").length;
    if (statuses.includes("MISMATCH")) return { level: "UNVERIFIED", label: "NAME CONFLICT", cls: "bad", verified, exact, total: real.length };
    if (!real.length || verified === real.length) return { level: "VERIFIED", label: "NAMES SOURCED", cls: "ok", verified, exact, total: real.length };
    if (verified === 0) return { level: "UNVERIFIED", label: "NAMES UNVERIFIED", cls: "warn", verified, exact, total: real.length };
    return { level: "PARTIALLY_VERIFIED", label: "PARTIALLY VERIFIED", cls: "warn", verified, exact, total: real.length };
  }

  // ---------------------------------------------------------------------------
  // PRIORITY. The engine implements exactly two attachment/ranking strategies
  // and this control exposes those and nothing else. No new weights, penalties
  // or scoring components are introduced to support a simpler label.
  //   BALANCED     -> "laserbeam": pool-stable 55% trigger->kill / 45% Beam Index
  //   FASTEST KILL -> "lethal":    strict trigger->kill first, Beam breaks ties
  // ---------------------------------------------------------------------------
  const PRIORITY_STRATEGY = { balanced: "laserbeam", fastest: "lethal" };

  function defaultStrategy() {
    return state.selectionMode === "manual" ? "lethal" : "laserbeam";
  }

  function activeStrategy() {
    return PRIORITY_STRATEGY[state.priority] ?? defaultStrategy();
  }

  /**
   * Strategy for this PRIORITY. It selects two things, and both matter:
   *
   *   1. WHICH cached row each weapon is ranked on - `best` for BALANCED,
   *      `bestLethal` for FASTEST KILL.
   *   2. WHICH comparator rankWeapons() sorts with - the 55/45 laserbeam
   *      utility for BALANCED, trigger-to-kill for FASTEST KILL.
   *
   * (2) was previously missing: the comparator was always the balanced utility,
   * so FASTEST KILL returned a non-fastest weapon in 411 of 672 sweep cases
   * while the control read "Lowest kill time". audit-meta-sweep.mjs now fails if
   * a FASTEST KILL winner is not the fastest killer, or if the order is not
   * non-decreasing in trigger-to-kill.
   */
  function rankingStrategy() {
    return PRIORITY_STRATEGY[state.priority] ?? "laserbeam";
  }

  function activePriorityKey() {
    if (state.priority !== "auto") return state.priority;
    return defaultStrategy() === "lethal" ? "fastest" : "balanced";
  }

  async function loadData() {
    // Deliberately independent. One bad source must never erase the catalog or the other data.
    const [weapons, attachments, ammo, ballistics, sourceOverlays] = await Promise.all([
      loadOne("weapons"), loadOne("attachments"), loadOne("ammo"), loadOne("ballistics"), loadSourceOverlays()
    ]);

    // The weapons feed is a pristine mirror of upstream. Newer verified values
    // ride on top of it as versioned overlays so the mirror stays byte-identical
    // and the effective dataset stays reproducible as mirror + overlays.
    // See source-overlay.js. A failed overlay load leaves the baseline in place;
    // it never silently half-applies.
    state.rawWeapons = applySourceOverlays(Array.isArray(weapons) ? weapons : [], sourceOverlays);
    state.attachments = attachments && typeof attachments === "object" ? attachments : null;
    state.ammo = ammo && typeof ammo === "object" ? ammo : null;
    state.ballistics = ballistics && typeof ballistics === "object" ? ballistics : null;
    await Promise.all([loadFreshnessStatus(), loadCombatCache(), loadAssaultAudit(), loadCarbineAudit(), loadSmgAudit(), loadLmgAudit(), loadDmrAudit(), loadSniperAudit(), loadSidearmAudit(), loadShotgunAudit(), loadAttachmentNameAudit(), loadRedsecModel(), loadSourceVerification()]);

    const matched = CURRENT.roster.filter(r => rawForRoster(r)).length;
    if (state.rawWeapons.length) setChip("statsChip", `STATS ${matched}/${CURRENT.roster.length}`, matched >= 60 ? "ok" : "warn");
    else setChip("statsChip", "STATS FEED DOWN", "bad");
    if (state.assaultAudit?.pass || state.carbineAudit?.pass || state.smgAudit?.pass || state.lmgAudit?.pass || state.dmrAudit?.pass || state.sniperAudit?.pass || state.sidearmAudit?.pass || state.shotgunAudit?.pass) {
      const primaries = CURRENT.roster.filter(w => w.cls !== "Secondary");
      const fullyVerified = primaries.filter(w => {
        const audit=auditForClass(w.cls);
        const def=audit ? auditedDefForRoster(w,rawForRoster(w)) : null;
        return !!def && audit?.crossClassEligible !== false && def.confidence !== "empirical-current";
      }).length;
      const empirical = primaries.filter(w => auditedDefForRoster(w,rawForRoster(w))?.confidence === "empirical-current").length;
      // This VERIFIED count and the ALL VERIFIED tab count are deliberately
      // different numbers, so the chip says which one it is. The chip counts
      // weapons with a verified class model; the tab counts weapons that can
      // actually be ranked in the current scope, which additionally requires
      // exact projectile ballistics.
      setChip("rosterChip",
        `ROSTER ${CURRENT.roster.length}/${CURRENT.rosterCount} • VERIFIED ${fullyVerified}/${primaries.length}${empirical ? ` • EMPIRICAL ${empirical}` : ""}`,
        "ok",
        `${fullyVerified} of ${primaries.length} primaries have a verified class combat model. That is a roster-health figure, not the ranking scope: the ALL VERIFIED tab shows how many can actually be ranked cross-class, which also requires exact projectile ballistics. Hover a weapon-class tab for the exclusions.`);
    } else {
      setChip("rosterChip", `ROSTER ${CURRENT.roster.length}/${CURRENT.rosterCount}`, CURRENT.roster.length === CURRENT.rosterCount ? "ok" : "warn");
    }

    if (state.combatCache) {
      const a = state.combatCache.audit;
      setChip("buildChip", `META ENGINE ${a.modeled}/${a.weaponsSource}`, a.errors?.length ? "warn" : "ok");
    } else if (state.source.combat === "pending") setChip("buildChip", "META ENGINE BUILDING", "warn");
    else if (state.attachments && state.ammo) setChip("buildChip", "LIVE BUILD FALLBACK", "warn");
    else if (state.attachments || state.ammo) setChip("buildChip", "BUILD DATA PARTIAL", "warn");
    else setChip("buildChip", "BUILD DATA DOWN", "bad");
    const fresh = freshnessUi();
    setChip("freshnessChip", fresh.chip, fresh.cls);
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
    return (rawOrRoster?.cls === "Secondary" || rawOrRoster?.cls === "Sidearm") ? 60 : 100;
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
    if (raw.cls === "Shotgun" && state.shotgunAudit?.pass) {
      const verified = new Set(state.shotgunAudit.verifiedAmmoIds || []);
      options.ammo = options.ammo.filter(x => verified.has(x.id));
    }

    // ONE legality policy, the same object the exhaustive cache builder uses via
    // scripts/verified-source-sanitizer.mjs. See attachment-legality.js.
    //
    //   assumed: true   -> the whole option is speculative; exclude it.
    //   assumedFields   -> strip only those fields; keep the option and every
    //                      verified field on it.
    //
    // This path previously treated any assumedFields as whole-option assumption
    // and dropped the option, which hid 13 partially-assumed records from the
    // on-demand optimizer and left M250 - whose only two barrels are both
    // partially assumed - with no legal barrel at all. The cache builder never
    // had that defect, which is why the two disagreed. It also removes the need
    // for the old hand-written VSSM exception: full_auto_vssm's verified
    // fire-mode/RPM transform now survives generically, because only its assumed
    // recoilDecreaseFactorOverride is stripped.
    const legality = LEGALITY();
    for (const [slot, list] of Object.entries(options)) {
      options[slot] = list
        .map(opt => {
          const ok = legality.legalOption(opt, pointCost);
          return ok ? { ...ok, slot } : null;
        })
        .filter(Boolean);
      if (!options[slot].length) throw new Error(`${slot}: no verified point-cost choices`);
    }
    return options;
  }

  /** The shared legality policy, or a hard failure - never a silent fallback. */
  function LEGALITY() {
    const p = window.BF6_ATTACHMENT_LEGALITY;
    if (!p || typeof p.legalOption !== "function") {
      throw new Error("Attachment legality policy unavailable (attachment-legality.js not loaded)");
    }
    return p;
  }

  function isAssumedOption(opt) {
    return LEGALITY().isWhollyAssumed(opt);
  }

  /**
   * Attachments in a build whose upstream record marks one or more modifier
   * fields as assumed rather than verified.
   *
   * The exhaustive cache builder admits these; buildOptions() in the on-demand
   * optimizer rejects them. While those two policies disagree, a build that
   * contains one must not be labelled fully VERIFIED - the label would be
   * claiming a confidence the data does not support.
   */
  function assumedPicksIn(raw, picks) {
    const legality = LEGALITY();
    const out = [];
    for (const p of picks || []) {
      if (!p || p.id === "none") continue;
      const item = catalogItem(p.slot, p.id);
      if (!item) continue;
      const fields = legality.assumedFieldNames(item);
      if (legality.isWhollyAssumed(item) || fields.length) {
        out.push({ slot: p.slot, id: p.id, fields });
      }
    }
    return out;
  }

  function dedupeOptions(list) {
    const seen = new Set();
    return list.filter(x => {
      const k = `${x.id}:${x.slot}`;
      if (seen.has(k)) return false;
      seen.add(k); return true;
    });
  }

  // Handling preferences for the on-demand (non-exhaustive) attachment
  // optimizer. These defaults are the engine's historical values. They are held
  // in state rather than read from the DOM so that the presence or absence of a
  // UI control can never change optimizer behaviour.
  function preference(id) {
    if (Object.prototype.hasOwnProperty.call(state.preferences, id)) return !!state.preferences[id];
    return !!$(id)?.checked;
  }

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

  function opticRangeFit(id, d) {
    const distance=Math.max(1,Number(d)||1);
    // Range-fit policy over the Analyzer's coarse optic tiers. The upstream data
    // does not currently expose exact magnification/FOV for most primaries, so
    // this is deliberately labeled optimizer policy rather than datamined fact.
    if (id === "iron") return distance <= 15 ? 100 : distance <= 25 ? 85 : distance <= 40 ? 55 : distance <= 60 ? 25 : 0;
    if (id === "std_optic") return distance <= 15 ? 90 : distance <= 35 ? 100 : distance <= 60 ? 90 : distance <= 85 ? 70 : distance <= 110 ? 45 : 20;
    if (id === "var_low") return distance <= 15 ? 55 : distance <= 35 ? 85 : distance <= 75 ? 100 : distance <= 110 ? 90 : distance <= 150 ? 70 : 50;
    if (id === "var_high") return distance <= 20 ? 15 : distance <= 40 ? 45 : distance <= 60 ? 75 : distance <= 90 ? 95 : distance <= 180 ? 100 : 95;
    if (id === "thermal") return distance <= 15 ? 45 : distance <= 40 ? 70 : distance <= 100 ? 90 : distance <= 160 ? 80 : 65;
    if (id === "therm_hyb") return distance <= 15 ? 45 : distance <= 40 ? 75 : distance <= 100 ? 95 : distance <= 160 ? 100 : 90;
    return 60;
  }

  function minimumOpticFit(raw, d) {
    if (raw?.cls === "Sidearm" || raw?.cls === "Secondary") return 0;
    const distance=Math.max(1,Number(d)||1);
    if (distance <= 20) return 45;
    if (distance <= 60) return 50;
    if (distance <= 120) return 55;
    return 60;
  }

  function opticScore(opt, raw, d) {
    const fit=opticRangeFit(opt.id,d);
    const min=minimumOpticFit(raw,d);
    // Strong enough that mechanically-neutral cheap irons cannot dominate a
    // long-range fallback build solely by freeing Pick points.
    return fit * 4 - (fit < min ? 500 : 0);
  }

  function scoreOption(opt, raw, d) {
    const w = blendedWeights(d);
    let s = 0;

    const auditedOpt = auditedClassOptimized(raw, d);
    if (auditedOpt?.attachmentId && opt.id === auditedOpt.attachmentId) s += 100000;

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

    if (opt.slot === "sight") s += opticScore(opt, raw, d);
    s += behaviorScore(opt, raw, d);
    return s;
  }

  function auditForClass(cls) {
    if (cls === "Assault Rifle" && state.assaultAudit?.pass) return state.assaultAudit;
    if (cls === "Carbine" && state.carbineAudit?.pass) return state.carbineAudit;
    if (cls === "SMG" && state.smgAudit?.pass) return state.smgAudit;
    if (cls === "LMG" && state.lmgAudit?.pass) return state.lmgAudit;
    if (cls === "DMR" && state.dmrAudit?.pass) return state.dmrAudit;
    if (cls === "Sniper Rifle" && state.sniperAudit?.pass) return state.sniperAudit;
    if ((cls === "Secondary" || cls === "Sidearm") && state.sidearmAudit?.pass) return state.sidearmAudit;
    if (cls === "Shotgun" && state.shotgunAudit?.pass) return state.shotgunAudit;
    return null;
  }

  function auditedDefForRoster(roster, raw = null) {
    const cls = roster?.cls || raw?.cls;
    const audit = auditForClass(cls);
    if (!audit?.weapons) return null;
    const ids = [raw?.id, roster?.id, raw?.name, roster?.name].filter(Boolean).map(aliasKey);
    for (const [id, def] of Object.entries(audit.weapons)) {
      if (ids.includes(aliasKey(id)) || ids.includes(aliasKey(def?.name))) return def;
    }
    return null;
  }

  function auditedClassDef(raw) {
    return auditedDefForRoster(rosterForRaw(raw), raw);
  }

  function auditedCurveDamage(curve, d) {
    const pts = (curve || []).map(x => ({ r:Number(x.r), d:Number(x.d) }))
      .filter(x => Number.isFinite(x.r) && Number.isFinite(x.d)).sort((a,b)=>a.r-b.r);
    if (!pts.length) return null;
    const meter = Number(d);
    if (meter <= pts[0].r) return pts[0].d;
    for (let i=1;i<pts.length;i++) {
      const a=pts[i-1], b=pts[i];
      if (meter <= b.r) {
        if (b.r === a.r) return b.d;
        const t=(meter-a.r)/(b.r-a.r);
        return a.d+(b.d-a.d)*Math.max(0,Math.min(1,t));
      }
    }
    return pts.at(-1).d;
  }

  function auditedRosterCombat(roster, raw = null, d = state.distance) {
    const audit = auditForClass(roster?.cls || raw?.cls);
    const def = auditedDefForRoster(roster, raw);
    if (!audit || !def) return null;
    const meter = Math.max(1, Math.min(300, Math.round(Number(d) || 25)));

    // Snipers use linearly interpolated sweet-spot curves and independently
    // audited effective shot-to-shot cadence. Do not derive sniper TTK from
    // the Analyzer's internal raw RPM field.
    if (Array.isArray(def.curve) && Number.isFinite(Number(def.shotIntervalMs))) {
      const damage = auditedCurveDamage(def.curve, meter);
      if (!Number.isFinite(Number(damage)) || Number(damage) <= 0) return null;
      const btk = Math.ceil((100 - 1e-9) / Number(damage));
      const ttk = btk <= 1 ? 0 : Math.round((btk - 1) * Number(def.shotIntervalMs));
      const lowMult = Number(audit.lowBodyMultiplier || .67);
      const lowDamage = Number(damage) * lowMult;
      const lowBtk = Math.ceil((100 - 1e-9) / lowDamage);
      const lowTtk = lowBtk <= 1 ? 0 : Math.round((lowBtk - 1) * Number(def.shotIntervalMs));
      return {
        damage:Number(damage), btk, ttk, rpm:Number(def.displayRpm ?? def.rpm),
        shotIntervalMs:Number(def.shotIntervalMs), lowDamage, lowBtk, lowTtk, lowMult,
        mag:Number(raw?.mag ?? def.mag)||null, bulletVel:Number(raw?.bulletVel ?? def.bulletVel)||null,
        adsTime:Number(raw?.adsTime ?? def.adsTime)||null, source:`${(roster?.cls || raw?.cls).toLowerCase().replace(/\s+/g,"-")}-audit`,
        confidence:def.confidence || "audited"
      };
    }

    const r = (def.ranges || []).find(x => meter >= x.min && meter <= x.max);
    if (!r || !raw) return null;
    const lowMult = lowBodyMultiplier(raw);
    const lowDamage = Number(r.damage) * lowMult;
    const lowBtk = lowDamage > 0 ? Math.ceil((100 - 1e-9) / lowDamage) : null;
    const lowTtkRaw = lowBtk ? timeToNthShot(raw, lowBtk) : null;
    const auditedPellets = raw.cls === "Shotgun" ? Number(def.pellets || raw.pellets || 1) : 1;
    const auditedRpm = Number(def.rpm ?? def.cadence?.rpm ?? def.cadence?.sustainedRpm);
    return {
      damage:r.damage, pelletDamage:raw.cls === "Shotgun" && auditedPellets > 1 ? Number(r.damage) / auditedPellets : null, pellets:auditedPellets,
      btk:r.btk, ttk:r.ttk, rpm:Number.isFinite(auditedRpm) ? auditedRpm : def.rpm,
      lowDamage, lowBtk, lowTtk:Number.isFinite(lowTtkRaw) ? Math.round(lowTtkRaw) : null, lowMult,
      mag:Number(raw.mag)||null,
      bulletVel:Number((raw.cls === "DMR" ? def.equippedVelocity : null) ?? raw.bulletVel ?? def.bulletVel)||null,
      adsTime:Number((raw.cls === "DMR" ? def.adsTime : null) ?? raw.adsTime ?? def.adsTime)||null,
      source:`${raw.cls.toLowerCase().replace(/\s+/g,"-")}-audit`
    };
  }

  function auditedClassCombat(raw, d = state.distance) {
    return raw ? auditedRosterCombat(rosterForRaw(raw), raw, d) : null;
  }

  function auditedClassOptimized(raw, d = state.distance) {
    const def = auditedClassDef(raw);
    if (!def?.optimized) return null;
    const meter = Math.max(1, Math.min(300, Math.round(Number(d) || 25)));
    const r = (def.optimized.ranges || []).find(x => meter >= x.min && meter <= x.max);
    return r ? {
      damage:r.damage,btk:r.btk,ttk:r.ttk,rpm:r.rpm ?? def.optimized.rpm,
      attachment:r.attachment ?? def.optimized.attachment,attachmentId:r.attachmentId ?? def.optimized.attachmentId,points:r.points ?? def.optimized.points,mode:def.optimized.mode,
      source:`${raw.cls.toLowerCase().replace(/\s+/g,"-")}-audit-optimized`
    } : null;
  }

  function ballisticAlias(id) {
    const n=String(id || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const aliases={ "185ksk":"ks18k", "kts100mk8":"kts100" };
    return aliases[n] || n;
  }

  function ballisticDragPerMeter(cls, ammoId = "standard") {
    const b=state.ballistics;
    if (!b) return null;
    if (ammoId === "long_range" && Number.isFinite(Number(b?.ammoDragPerMeter?.long_range))) return Number(b.ammoDragPerMeter.long_range);
    if (ammoId === "penetration" && Number.isFinite(Number(b?.ammoDragPerMeter?.penetration?.[cls]))) return Number(b.ammoDragPerMeter.penetration[cls]);
    return Number.isFinite(Number(b.baseDragPerMeter)) ? Number(b.baseDragPerMeter) : null;
  }

  function ballisticVerified(raw, roster = null) {
    const ids=new Set((state.ballistics?.weaponIds || []).map(ballisticAlias));
    const candidates=[raw?.id, roster?.id, raw?.name, roster?.name].filter(Boolean).map(ballisticAlias);
    return candidates.some(x=>ids.has(x));
  }

  // Battlefield's measured projectile model is dv/dt = -k*v^2. For a level
  // shot, travel time is expm1(k*d)/(k*v). This is the same closed form used
  // by the current BF6 Weapon Analyzer ballistics module.
  function flightTimeMs(distanceM, velocityMps, dragPerMeter) {
    const d=Math.max(0,Number(distanceM)||0), v=Number(velocityMps), k=Number(dragPerMeter);
    if (!(v>0) || !(k>=0)) return null;
    return (k===0 ? d/v : Math.expm1(k*d)/(k*v))*1000;
  }

  function addTriggerKill(roster, raw, combat, distanceM = state.distance, ammoId = "standard", velocityOverride = null) {
    if (!combat || !Number.isFinite(Number(combat.ttk))) return combat;
    const def=auditedDefForRoster(roster,raw);
    const velocity=Number(velocityOverride ?? combat.bulletVel ?? raw?.bulletVel ?? def?.bulletVel ?? def?.equippedVelocity);
    const drag=ballisticDragPerMeter(roster?.cls || raw?.cls, ammoId);
    const flight=flightTimeMs(distanceM,velocity,drag);
    if (!Number.isFinite(flight)) return {...combat,mechTtk:Number(combat.ttk),triggerTtk:null,flightMs:null,ballisticsExact:false};
    return {
      ...combat,
      mechTtk:Number(combat.ttk),
      triggerTtk:Number(combat.ttk)+flight,
      flightMs:flight,
      dragPerMeter:drag,
      bulletVel:velocity || combat.bulletVel || null,
      ballisticsExact:ballisticVerified(raw,roster)
    };
  }

  function dmrFlightTimeMs(def, distanceM, useEquippedVelocity = true) {
    const velocity=Number(useEquippedVelocity ? (def?.equippedVelocity ?? def?.baseVelocity) : def?.baseVelocity);
    const drag=Number(def?.ballisticsVerified === true ? (def?.dragPerMeter ?? state.ballistics?.baseDragPerMeter) : state.ballistics?.baseDragPerMeter);
    return flightTimeMs(distanceM,velocity,drag);
  }

  function dmrTriggerKill(roster, raw, combat, distanceM = state.distance, optimized = false) {
    if ((roster?.cls || raw?.cls) !== "DMR" || !combat) return null;
    const def = auditedDefForRoster(roster, raw);
    if (!def) return null;
    const enriched=addTriggerKill(roster,raw,combat,distanceM,"standard",def.equippedVelocity ?? def.baseVelocity);
    if (!Number.isFinite(enriched?.triggerTtk)) return null;
    return { ms:enriched.triggerTtk, flightMs:enriched.flightMs, exact:def.ballisticsVerified===true, optimized, velocity:enriched.bulletVel };
  }

  function cacheWeapon(raw) {
    return raw ? state.combatCache?.weapons?.[raw.id] ?? null : null;
  }

  function cachedCombat(raw, d = state.distance, strategy = "laserbeam") {
    const cw = cacheWeapon(raw);
    const key=String(Math.max(1, Math.min(300, Math.round(Number(d) || 25))));
    const row = strategy === "lethal" ? cw?.bestLethal?.[key] : cw?.best?.[key];
    return row ? { damage:row.damage, btk:row.btk, ttk:row.ttk, mechTtk:row.ttk, triggerTtk:row.triggerTtk, flightMs:row.flightMs, ballisticsExact:row.ballisticsExact, lowBtk:row.lowBtk, lowTtk:row.lowTtk, beamIndex:row.beamIndex, recoil:row.recoil, recoilVariationDeg:row.recoilVariationDeg, unpredictableRecoil:row.unpredictableRecoil, effectiveAdsSpreadDeg:row.effectiveAdsSpreadDeg, movingAdsMinSpreadDeg:row.movingAdsMinSpreadDeg, opticFit:row.opticFit, opticEligible:row.opticEligible, sightId:row.sightId, sightName:row.sightName, source:"exhaustive-cache" } : null;
  }


  function fallbackBeamIndex(raw, d = state.distance) {
    if (!raw) return null;
    const recoil=Math.max(0,Number(raw.recoilV)||0);
    const variation=Math.max(0,Number(raw.recoilVar)||0);
    const unpredictable=recoil*Math.sin(Math.min(90,variation)*Math.PI/180);
    const sips=Math.max(0,Number(raw.recoilIncAds)||0);
    const moving=Math.max(0,Number(raw?._movingAdsMinSpreadDeg ?? raw?.spread?.adsMove?.[0])||0);
    const baseSpread=Math.max(0,Number(raw?.spread?.adsStand?.[0])||0);
    const rangeT=Math.min(1,Math.max(1,Number(d)||1)/120);
    // Fallback only. The exhaustive cache uses the Analyzer's transformed recoil
    // and effective-spread simulator for the winning attachment build.
    return recoil*(1+0.35*rangeT)
      + unpredictable*(1.25+0.75*rangeT)
      + (baseSpread+sips)*(1.25+1.75*rangeT)
      + moving*(0.35+0.65*rangeT);
  }

  function cachedWinningStats(raw, d = state.distance, strategy = "laserbeam") {
    const cw = cacheWeapon(raw);
    const key=String(Math.max(1, Math.min(300, Math.round(Number(d) || 25))));
    const row = strategy === "lethal" ? cw?.bestLethal?.[key] : cw?.best?.[key];
    return row ? cw?.builds?.[row.buildId]?.stats ?? null : null;
  }

  function cachedBuild(raw, d = state.distance, requiredAttachmentId = null, strategy = "laserbeam") {
    const cw = cacheWeapon(raw);
    const key = String(Math.max(1, Math.min(300, Math.round(Number(d) || 25))));
    const row = strategy === "lethal" ? cw?.bestLethal?.[key] : cw?.best?.[key];
    const b = row ? cw?.builds?.[row.buildId] : null;
    if (!row || !b) return null;
    if (requiredAttachmentId) {
      const ids = new Set([...(Array.isArray(b.picks) ? b.picks.map(x=>x.id) : []), ...Object.values(b.atts ?? {})].filter(Boolean));
      if (!ids.has(requiredAttachmentId)) return null;
    }
    const picks = Array.isArray(b.picks) ? b.picks.map(x=>({...x})) : [];
    if (!picks.length) {
      for (const slot of ["sight","muzzle","barrel","grip","laser","light","ergo","mag","ammo"]) {
        const id=b.atts?.[slot];
        if (id == null) continue;
        let opt=null;
        if (slot === "mag") opt = { id, ...(state.attachments?.WEAPON_MAG?.[raw.id]?.mags?.[id] ?? {}), slot };
        else if (slot === "ammo") {
          const a=(state.ammo?.AMMO ?? []).find(x=>x.id===id) ?? {id,name:prettifyId(id)};
          opt={...a,pts:state.ammo?.WEAPON_AMMO?.[raw.id]?.ammo?.[id] ?? 0,slot};
        } else {
          const key=CATALOG_KEYS[slot];
          opt={...((state.attachments?.[key] ?? []).find(x=>x.id===id) ?? {id,name:prettifyId(id),pts:0}),slot};
        }
        picks.push(opt);
      }
    }
    return { score:row.practical ?? 0, points:b.points, picks, audit:{ok:true,total:b.points,budget:cw.budget,errors:[]}, exhaustive:true, combat:row };
  }

  function optimize(raw, d = state.distance, strategy = "laserbeam") {
    const auditedOpt = auditedClassOptimized(raw, d);
    const requiredAttachmentId = auditedOpt?.attachmentId || null;
    // A valid exhaustive cache is authoritative for the actual winning attachment
    // build. If an independently audited lethal transform is required, only accept
    // a cached winner that contains that exact attachment.
    const cached = cachedBuild(raw, d, requiredAttachmentId, strategy);
    if (cached) return cached;
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

    let candidates = dp.map((x, points) => x ? { ...x, points } : null).filter(Boolean);
    if (requiredAttachmentId) candidates = candidates.filter(c => c.picks.some(x => x.id === requiredAttachmentId));
    if (!candidates.length) throw new Error(requiredAttachmentId ? `Verified TTK build requires ${requiredAttachmentId}, but no legal point build contains it` : "No legal attachment combination fits the point budget");
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
    if (opt.genericOpticTier) bits.push(`Range-aware optic tier; fit ${Math.round(opticRangeFit(opt.id,state.distance))}/100 @ ${state.distance}m. Exact sight magnification/FOV is not in the current source.`);
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

    const source = String(raw?.damageSource || "");
    const linear = /linear/i.test(source);
    const oneMeterBlend = /1\s*m\s*blend/i.test(source);

    // Sniper sweet-spot curves are continuous linear curves. Shotgun buckshot
    // curves use one-meter transition blends between pellet-damage tiers.
    if (linear || oneMeterBlend) {
      if (d <= pts[0].r) return pts[0].d;
      for (let i=1;i<pts.length;i++) {
        const a=pts[i-1], b=pts[i];
        if (d <= b.r) {
          if (b.r === a.r) return b.d;
          // For shotgun sources, only interpolate the explicit 1 m blend;
          // otherwise hold the prior tier flat.
          if (oneMeterBlend && (b.r-a.r) > 1.01) return a.d;
          const t=(d-a.r)/(b.r-a.r);
          return a.d + (b.d-a.d)*Math.max(0,Math.min(1,t));
        }
      }
      return pts[pts.length-1].d;
    }

    // Most automatic-weapon curves are stepped and encode a discontinuity by
    // repeating the same range twice. The first point at a repeated endpoint is
    // the outgoing/high tier, so exactly 21m stays in the 21m tier and the lower
    // tier begins immediately after it. The old <= loop incorrectly selected the
    // second duplicate and dropped damage one meter too early.
    if (d <= pts[0].r) return pts[0].d;
    let previous = pts[0];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (d < p.r) return previous.d;
      if (d === p.r) return p.d; // first duplicate encountered = outgoing tier
      previous = p;
    }
    return previous.d;
  }

  const SHOTGUN_CADENCE = {
    m87a1: { rpm:94 },
    m1014: { rpm:200 },
    "185ksk": { rpm:300 },
    // DB-12 fires the two shells in a pair at ~360 RPM, then cycles the next
    // pair. Two pairs per 1.6 s gives the live 150 RPM sustained cadence.
    db12: { rpm:150, pairRpm:360, pairCycleMs:800 }
  };

  function lowBodyMultiplier(raw) {
    if (!raw) return 1;
    if (raw.cls === "Shotgun" || raw.cls === "Sidearm") return 1;
    if (raw.cls === "DMR") return .91;
    if (raw.cls === "Sniper Rifle") return .67;
    return .84; // automatic primaries: stomach / limbs in BF6 1.3.3+
  }

  function timeToNthShot(raw, shots) {
    if (!Number.isFinite(shots) || shots <= 1) return 0;

    // Burst-only weapons need the gap between bursts. Using raw intra-burst RPM
    // continuously understates their TTK whenever the kill crosses a burst gap.
    if (raw?.fireMode === "burst" && Number(raw?.burstRounds) > 0 && Number(raw?.burstBurstsPerMinute) > 0) {
      const burstRounds = Number(raw.burstRounds);
      const intraRpm = Number(raw.burstRpm || raw.rpm);
      const burstStartMs = 60000 / Number(raw.burstBurstsPerMinute);
      const intraMs = 60000 / intraRpm;
      const idx = shots - 1;
      return Math.floor(idx / burstRounds) * burstStartMs + (idx % burstRounds) * intraMs;
    }

    // The DB-12 has a very fast second shell within each dual-tube pair, then a
    // slower pump/cycle before the next pair.
    if (raw?.id === "db12") {
      const m = SHOTGUN_CADENCE.db12;
      const idx = shots - 1;
      return Math.floor(idx / 2) * m.pairCycleMs + (idx % 2) * (60000 / m.pairRpm);
    }

    const override = SHOTGUN_CADENCE[raw?.id];
    const rpm = Number(override?.rpm ?? raw?.rpm);
    return rpm > 0 ? (shots - 1) * 60000 / rpm : null;
  }

  function combatAtDistance(raw, d) {
    const pelletDamage = damageAtDistance(raw, d);
    const pellets = Math.max(1, Number(raw?.pellets) || 1);
    // Shotgun source curves are per pellet. "damage" below is ideal maximum
    // shell damage if every pellet connects; pelletDamage remains available for
    // transparency and future spread/expected-TTK modeling.
    const chestDamage = pelletDamage == null ? null : pelletDamage * pellets;
    const chestBtk = chestDamage && chestDamage > 0 ? Math.ceil(100 / chestDamage) : null;
    const chestTtk = chestBtk ? timeToNthShot(raw, chestBtk) : null;

    const lowMult = lowBodyMultiplier(raw);
    const lowDamage = chestDamage == null ? null : chestDamage * lowMult;
    const lowBtk = lowDamage && lowDamage > 0 ? Math.ceil(100 / lowDamage) : null;
    const lowTtk = lowBtk ? timeToNthShot(raw, lowBtk) : null;

    const cadence = SHOTGUN_CADENCE[raw?.id]?.rpm ?? Number(raw?.rpm);
    return {
      damage:chestDamage, pelletDamage, pellets,
      btk:chestBtk, ttk:chestTtk,
      lowDamage, lowBtk, lowTtk, lowMult,
      rpm:Number.isFinite(Number(cadence)) ? Number(cadence) : null,
      mag:Number(raw?.mag) || null
    };
  }

  // ===========================================================================
  // REDSEC COMBAT PROFILE
  //
  // Multiplayer and REDSEC share one weapon base profile. Only damage against
  // ARMOR differs, exactly as EA's REDSEC armor update describes:
  //
  //   * armor is a separate 80 HP layer (2 plates x 40 HP) in Battle Royale
  //   * damage-vs-armor uses the same step damages at ranges shifted +10 m
  //   * for automatic weapons the leading close-range max-damage step is dropped
  //   * once armor is gone, soldier-health damage and ranges are identical to
  //     the rest of Battlefield 6, so REDSEC unarmored reuses the Multiplayer
  //     health path unchanged rather than duplicating it
  //
  // Every mechanic is read from data/redsec-model.json. Nothing here invents an
  // armor multiplier, a spillover rule, or a generic extra-health value.
  // ===========================================================================

  const GAME_MODES = { multiplayer: "MULTIPLAYER", redsec: "REDSEC" };
  const ARMOR_STATES = { unarmored: "UNARMORED", plates2: "2 PLATES" };

  function redsecModel() { return state.redsecModel; }

  /** Armor pool for the selected target state, or null when unarmored. */
  function armorPool(armorState = state.targetArmor) {
    if (state.gameMode !== "redsec" || armorState === "unarmored") return null;
    const br = redsecModel()?.armor?.battleRoyale;
    if (!br || !Number.isFinite(Number(br.totalHp))) return null;
    return {
      plates: Number(br.plates),
      hpPerPlate: Number(br.hpPerPlate),
      totalHp: Number(br.totalHp)
    };
  }

  /**
   * Damage-vs-armor curve, derived from the weapon's soldier-health curve by
   * the two transforms EA documents. Returns a dmg-shaped array so the existing
   * damageAtDistance() step logic can evaluate it unchanged.
   */
  /**
   * The two REDSEC mechanics EA has not published exactly. Both alternatives
   * below are built only from values already in the data - the weapon's own two
   * damage steps, and the bullet's own two damage values - so neither invents a
   * number. They exist so the sensitivity analysis can measure how much the
   * remaining uncertainty actually moves a recommendation.
   */
  const REDSEC_INTERPRETATIONS = {
    closeRange: {
      remove: "Leading close-range max-damage step dropped (literal reading of EA's \"removed\"/\"flattened\").",
      keep: "Leading step retained, range shift only (bounds EA's alternative \"significantly reduced\" wording)."
    },
    spillover: {
      none: "The shot that destroys armour damages armour only; the next shot begins on health.",
      proportional: "The fraction of the shot's armour damage not needed to break armour carries into health, scaled by that same shot's health-damage value."
    }
  };
  // Set only by the sensitivity harness; null in all normal operation.
  const REDSEC_OVERRIDE = { closeRange: null, spillover: null };
  function defaultCloseRange() {
    if (REDSEC_OVERRIDE.closeRange) return REDSEC_OVERRIDE.closeRange;
    return redsecModel()?.damageVsArmor?.removeFirstCloseRangeStep?.policy === "remove" ? "remove" : "keep";
  }
  function defaultSpillover() {
    if (REDSEC_OVERRIDE.spillover) return REDSEC_OVERRIDE.spillover;
    const rec = (redsecModel()?.unresolved ?? []).find(u => u.implementedPolicy);
    return rec?.implementedPolicy === "proportional" ? "proportional" : "none";
  }

  function armorChestMultiplier(raw) {
    const groups = redsecModel()?.damageVsArmor?.chestMultipliers;
    if (!groups || !raw?.cls) return 1;
    for (const rec of Object.values(groups)) {
      if (!Array.isArray(rec?.classes) || !rec.classes.includes(raw.cls)) continue;
      const value = Number(rec.value);
      if (Number.isFinite(value) && value > 0) return value;
    }
    return 1;
  }

  function alignedCarbineCloseRangeDamage(raw) {
    const cfg = redsecModel()?.damageVsArmor?.carbineCloseRangeAlignment?.weaponOverrides?.[raw?.id];
    if (!cfg?.referenceWeaponId) return null;
    const ref = state.rawWeapons.find(w => w.id === cfg.referenceWeaponId);
    if (!Array.isArray(ref?.dmg) || !ref.dmg.length) return null;
    const first = Number(ref.dmg[0]?.d);
    const changed = ref.dmg.find(p => Number.isFinite(Number(p?.d)) && Number(p.d) !== first);
    const value = Number(changed?.d);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function armorDamageCurve(raw, closeRange = defaultCloseRange(), effectiveFireMode = raw?.fireMode) {
    const model = redsecModel()?.damageVsArmor;
    if (!model || !Array.isArray(raw?.dmg) || !raw.dmg.length) return null;
    const shift = Number(model.rangeShiftMeters?.value);
    if (!Number.isFinite(shift)) return null;

    let pts = raw.dmg
      .map(p => ({ r: Number(p.r), d: Number(p.d) }))
      .filter(p => Number.isFinite(p.r) && Number.isFinite(p.d));
    if (!pts.length) return null;

    // Rule B: for automatic weapons drop the leading maximum-damage step so the
    // second step's damage applies from 0 m. Applied before the range shift so
    // the surviving boundaries are the ones that move.
    const dropModes = model.removeFirstCloseRangeStep?.appliesToFireModes ?? [];
    if (closeRange === "remove" && dropModes.includes(effectiveFireMode)) {
      const first = pts[0].d;
      const changeAt = pts.findIndex(p => p.d !== first);
      if (changeAt > 0) {
        pts = pts.slice(changeAt);
        // EA explicitly documents one exception to simply flattening a
        // Carbine to its own second tier: a Carbine caliber variant keeps its
        // close-range armour damage aligned to the corresponding non-Carbine
        // caliber. The model names the affected weapon/reference pair; the
        // current numeric value is derived from the current weapon curves.
        const aligned = alignedCarbineCloseRangeDamage(raw);
        if (Number.isFinite(aligned) && pts.length) {
          const ownFirst = pts[0].d;
          pts = pts.map(p => p.d === ownFirst ? { ...p, d: aligned } : p);
        }
      }
    }

    // Rule A: shift every drop-off threshold outward. The curve must still start
    // at 0 m, so the leading tier simply extends inward.
    const shifted = pts.map(p => ({ r: Math.max(0, p.r + shift), d: p.d }));
    if (shifted[0].r > 0) shifted.unshift({ r: 0, d: shifted[0].d });
    return shifted;
  }

  /** Per-shot damage against armor at an exact distance. */
  function armorDamageAtDistance(raw, d, closeRange = defaultCloseRange(), effectiveFireMode = raw?.fireMode) {
    const curve = armorDamageCurve(raw, closeRange, effectiveFireMode);
    if (!curve) return null;
    // Reuse the weapon's own curve semantics (stepped vs linear vs pellet blend)
    // by evaluating through the same function the health path uses.
    const shim = { dmg: curve, damageSource: raw?.damageSource, pellets: raw?.pellets };
    const per = damageAtDistance(shim, d);
    if (per == null) return null;
    return per * Math.max(1, Number(raw?.pellets) || 1) * armorChestMultiplier(raw);
  }

  function timeToNthShotForBuild(raw, shots, buildStats = null) {
    const mode = buildStats?.fireMode ?? raw?.fireMode;
    const rpm = Number(buildStats?.rpm);
    if (Number.isFinite(rpm) && rpm > 0 && mode !== "burst" && raw?.id !== "db12" && !SHOTGUN_CADENCE[raw?.id]) {
      return (shots - 1) * 60000 / rpm;
    }
    return timeToNthShot(raw, shots);
  }

  /**
   * Shot-by-shot REDSEC combat against an armored target.
   *
   * Armor and health are separate layers with different damage curves, so this
   * walks the actual shot sequence rather than dividing a combined health pool.
   * Leftover damage from the shot that destroys armor is NOT carried into
   * health: converting between the two damage scales would require a rule the
   * source does not publish. That policy is recorded in data/redsec-model.json.
   */
  function redsecArmoredCombat(raw, d, opts = {}) {
    const closeRange = opts.closeRange ?? defaultCloseRange();
    const spillover = opts.spillover ?? defaultSpillover();
    const effectiveFireMode = opts.effectiveFireMode ?? raw?.fireMode;
    const pool = opts.pool ?? armorPool(opts.armorState);
    const healthPerShot = opts.healthDamage ?? combatAtDistance(raw, d)?.damage;
    const armorPerShot = armorDamageAtDistance(raw, d, closeRange, effectiveFireMode);
    if (!pool || !Number.isFinite(Number(healthPerShot)) || Number(healthPerShot) <= 0) return null;
    if (!Number.isFinite(Number(armorPerShot)) || Number(armorPerShot) <= 0) return null;

    const a = Number(armorPerShot), h = Number(healthPerShot);
    // Plates are consumed in order so per-plate behaviour can be added later
    // without changing callers; with no spillover this equals one 80 HP pool.
    let remainingArmor = pool.totalHp;
    let remainingHealth = 100;
    let shots = 0, shotsIntoArmor = 0, carriedHealthDamage = 0;
    const log = [];
    while (remainingHealth > 0 && shots < 400) {
      shots++;
      if (remainingArmor > 0) {
        shotsIntoArmor++;
        const usedOnArmor = Math.min(remainingArmor, a);
        remainingArmor -= a;
        if (remainingArmor <= 0 && spillover === "proportional") {
          // The unused fraction of this shot's armour damage carries into
          // health, scaled by the same shot's own health-damage value. No new
          // constant is introduced: both numbers come from this bullet.
          const carried = h * ((a - usedOnArmor) / a);
          carriedHealthDamage = carried;
          remainingHealth -= carried;
        }
        log.push({ shot: shots, layer: "armor", armorDamage: a, armorRemaining: Math.max(0, remainingArmor), healthCarried: remainingArmor <= 0 && spillover === "proportional" ? carriedHealthDamage : 0 });
        continue;
      }
      remainingHealth -= h;
      log.push({ shot: shots, layer: "health", healthDamage: h, healthRemaining: Math.max(0, remainingHealth) });
    }

    return {
      shotsToBreakArmor: shotsIntoArmor,
      armorDamagePerShot: a,
      healthDamagePerShot: h,
      healthBtk: shots - shotsIntoArmor,
      btk: shots,
      armorTotalHp: pool.totalHp,
      plates: pool.plates,
      hpPerPlate: pool.hpPerPlate,
      spilloverPolicy: spillover,
      closeRangePolicy: closeRange,
      effectiveFireMode,
      armorChestMultiplier: armorChestMultiplier(raw),
      carriedHealthDamage,
      log
    };
  }

  /**
   * Full REDSEC combat row for one weapon at an exact distance, shaped like the
   * Multiplayer combat rows so every downstream consumer works unchanged.
   *
   * REDSEC UNARMORED returns the Multiplayer row itself: EA state that soldier
   * health damage and ranges are unchanged, so this is reuse, not duplication.
   */
  function redsecCombat(raw, d, armorState = state.targetArmor, mpRow = null, buildStats = null, interp = {}) {
    const base = mpRow;
    if (!base) return null;
    if (armorState === "unarmored") return { ...base, gameMode: "redsec", targetArmor: "unarmored", armorModel: null };

    const effectiveFireMode = buildStats?.fireMode ?? mpRow?.fireMode ?? raw?.fireMode;
    const armored = redsecArmoredCombat(raw, d, { armorState, healthDamage: base.damage, effectiveFireMode, ...interp });
    if (!armored) return null;

    // Timing uses the winning build's transformed cadence when available, which
    // is the same cadence the Multiplayer row was timed with.
    const timed = timeToNthShotForBuild(raw, armored.btk, buildStats);
    const mechTtk = Number.isFinite(Number(timed)) ? Number(timed) : null;
    const flightMs = Number(base.flightMs);
    const triggerTtk = Number.isFinite(mechTtk) && Number.isFinite(flightMs) ? mechTtk + flightMs : mechTtk;

    // Low-body figures follow the same armor sequence with the low-body health
    // damage the Multiplayer model already computes.
    const lowHealth = Number(base.lowDamage);
    let lowBtk = null, lowTtk = null;
    if (Number.isFinite(lowHealth) && lowHealth > 0) {
      lowBtk = armored.shotsToBreakArmor + Math.ceil(100 / lowHealth);
      lowTtk = timeToNthShotForBuild(raw, lowBtk, buildStats);
    }

    return {
      ...base,
      gameMode: "redsec",
      targetArmor: armorState,
      effectiveFireMode,
      damage: base.damage,
      btk: armored.btk,
      ttk: mechTtk,
      mechTtk,
      triggerTtk,
      lowBtk: lowBtk ?? base.lowBtk,
      lowTtk: lowTtk ?? base.lowTtk,
      armorModel: armored
    };
  }

  /**
   * Re-rank the engine's own validated build set for this weapon using REDSEC
   * lethality. The candidate set, modifiers, point costs, budgets and optic
   * eligibility are exactly the ones the exhaustive Multiplayer cache already
   * validated; only the combat values fed to the existing comparators change.
   * No new scoring weight is introduced.
   */
  function redsecBuildRows(raw, d, strategy) {
    const cw = cacheWeapon(raw);
    if (!cw?.builds) return null;
    const key = String(Math.max(1, Math.min(300, Math.round(Number(d) || 25))));
    const mpBest = cw.best?.[key], mpLethal = cw.bestLethal?.[key];
    if (!mpBest && !mpLethal) return null;

    const rows = [];
    for (const [buildId, b] of Object.entries(cw.builds)) {
      // Each cached build already carries the Multiplayer row it produced at
      // this distance only for the winners, so recompute the shared fields from
      // the build's own transformed stats plus the weapon's damage curves.
      const mpRow = buildMpRowForBuild(cw, b, d, buildId);
      if (!mpRow) continue;
      const rc = state.targetArmor === "unarmored"
        ? { ...mpRow, gameMode: "redsec", targetArmor: "unarmored", armorModel: null }
        : redsecCombat(raw, d, state.targetArmor, mpRow, b.stats);
      if (!rc || !Number.isFinite(Number(rc.triggerTtk))) continue;
      rows.push({ ...rc, buildId, points: b.points, opticFit: mpRow.opticFit, opticEligible: mpRow.opticEligible, beamIndex: mpRow.beamIndex, practical: mpRow.practical });
    }
    if (!rows.length) return null;

    if (strategy === "lethal") {
      return rows.slice().sort((a, b) => betterRedsecLethal(a, b) ? -1 : 1)[0];
    }
    // Balanced mirrors the engine's anchored policy: the strict lethal winner
    // sets the floor, and only builds within the same 12% ceiling may compete on
    // the 55/45 utility.
    const lethal = rows.slice().sort((a, b) => betterRedsecLethal(a, b) ? -1 : 1)[0];
    const floor = Number(lethal?.triggerTtk);
    if (!Number.isFinite(floor)) return lethal ?? null;
    const ceiling = floor <= 0 ? floor : floor * REDSEC_AUTO_MAX_TTK_RATIO + 1e-9;
    let winner = null;
    for (const c of rows) {
      if (!Number.isFinite(Number(c.triggerTtk)) || Number(c.triggerTtk) > ceiling) continue;
      if (betterRedsecAuto(c, winner)) winner = c;
    }
    return winner ?? lethal ?? null;
  }

  // Mirrors scripts/auto-selection-policy.mjs, which the exhaustive builder uses.
  const REDSEC_AUTO_MAX_TTK_RATIO = 1.12;

  function betterRedsecLethal(a, b) {
    if (!b) return true;
    if (a.opticEligible !== b.opticEligible) return !!a.opticEligible;
    if (a.triggerTtk !== b.triggerTtk) return (a.triggerTtk ?? Infinity) < (b.triggerTtk ?? Infinity);
    if (a.ttk !== b.ttk) return (a.ttk ?? Infinity) < (b.ttk ?? Infinity);
    if (a.btk !== b.btk) return (a.btk ?? Infinity) < (b.btk ?? Infinity);
    if (a.damage !== b.damage) return (a.damage ?? -Infinity) > (b.damage ?? -Infinity);
    if (a.lowTtk !== b.lowTtk) return (a.lowTtk ?? Infinity) < (b.lowTtk ?? Infinity);
    if (a.beamIndex !== b.beamIndex) return (a.beamIndex ?? Infinity) < (b.beamIndex ?? Infinity);
    return (a.points ?? Infinity) < (b.points ?? Infinity);
  }

  function betterRedsecAuto(a, b) {
    if (!b) return true;
    if (a.opticEligible !== b.opticEligible) return !!a.opticEligible;
    const ac = laserbeamUtilityCost(a.triggerTtk, a.beamIndex);
    const bc = laserbeamUtilityCost(b.triggerTtk, b.beamIndex);
    if (Math.abs(ac - bc) > 1e-12) return ac < bc;
    if (a.opticFit !== b.opticFit) return (a.opticFit ?? -Infinity) > (b.opticFit ?? -Infinity);
    if (a.triggerTtk !== b.triggerTtk) return (a.triggerTtk ?? Infinity) < (b.triggerTtk ?? Infinity);
    if (a.beamIndex !== b.beamIndex) return (a.beamIndex ?? Infinity) < (b.beamIndex ?? Infinity);
    if (a.btk !== b.btk) return (a.btk ?? Infinity) < (b.btk ?? Infinity);
    return (a.points ?? Infinity) < (b.points ?? Infinity);
  }

  /**
   * Reconstruct the Multiplayer combat row for an arbitrary cached build at an
   * exact distance. The cache stores per-distance rows only for its winners, so
   * non-winning builds are evaluated with the same primitives the cache used:
   * the weapon's damage curve plus that build's transformed stats.
   */
  function buildMpRowForBuild(cw, build, d, buildId) {
    const key = String(Math.max(1, Math.min(300, Math.round(Number(d) || 25))));
    for (const row of [cw.best?.[key], cw.bestLethal?.[key]]) {
      if (row && row.buildId === buildId) return { ...row };
    }
    const raw = state.rawWeapons.find(w => w.id === cw.id);
    if (!raw) return null;
    const base = combatAtDistance(raw, d);
    if (!base || !Number.isFinite(Number(base.damage))) return null;
    const st = build.stats || {};
    const mech = timeToNthShotForBuild(raw, base.btk, st);
    const vel = Number(st.bulletVel ?? raw.bulletVel);
    const drag = ballisticDragPerMeter(raw.cls, "standard");
    const flightMs = Number.isFinite(vel) && vel > 0 && Number.isFinite(drag) ? flightTimeMs(d, vel, drag) : null;
    const sight = Array.isArray(build.picks) ? build.picks.find(p => p.slot === "sight") : null;
    const fit = sight ? opticRangeFit(sight.id, d) : NaN;
    return {
      damage: base.damage, btk: base.btk, ttk: mech, mechTtk: mech,
      fireMode: st.fireMode ?? raw.fireMode,
      flightMs, triggerTtk: Number.isFinite(mech) && Number.isFinite(flightMs) ? mech + flightMs : mech,
      ballisticsExact: ballisticVerified(raw), lowBtk: base.lowBtk, lowTtk: base.lowTtk,
      lowDamage: base.lowDamage,
      beamIndex: Number(st.beam?.beamIndex ?? NaN),
      opticFit: Number.isFinite(fit) ? fit : null,
      opticEligible: Number.isFinite(fit) ? fit >= minimumOpticFit(raw, d) : true,
      practical: 0, bulletVel: vel, source: "redsec-rebuild"
    };
  }

  // Scenario-scoped memo. The key carries every field that changes the result,
  // so a REDSEC 2-plate row can never be served for a Multiplayer request.
  const scenarioMemo = new Map();
  function clearScenarioMemo() { scenarioMemo.clear(); redsecStabilityMemo.clear(); }

  const redsecStabilityMemo = new Map();

  /**
   * Is the ARMOURED ranking winner stable across the interpretations EA has not
   * published?
   *
   * redsecDependencies() answers a narrower question - whether the SELECTED
   * weapon's own numbers move. In AUTO META the engine also chooses the weapon,
   * so a recommendation is only robust if the winner itself survives both
   * readings. At 25 m it does not: closeRange="remove" wins with one weapon and
   * "keep" with another, while every individual weapon's own result may look
   * stable. Reporting that as "robust" would understate the uncertainty.
   *
   * Returns true / false, or null when the question does not apply.
   */
  function redsecWinnerStable(category = state.category, d = state.distance) {
    if (state.gameMode !== "redsec" || state.targetArmor !== "plates2") return null;
    if (state.selectionMode !== "auto") return null;
    const key = `stab|${category}|${d}|${rankingStrategy()}`;
    if (redsecStabilityMemo.has(key)) return redsecStabilityMemo.get(key);
    const winners = new Set();
    try {
      for (const closeRange of ["remove", "keep"]) {
        for (const spillover of ["none", "proportional"]) {
          clearScenarioMemo();
          REDSEC_OVERRIDE.closeRange = closeRange;
          REDSEC_OVERRIDE.spillover = spillover;
          winners.add(rankWeapons(category, d)[0]?.roster?.id ?? null);
        }
      }
    } catch (_) {
      return null;
    } finally {
      REDSEC_OVERRIDE.closeRange = null;
      REDSEC_OVERRIDE.spillover = null;
      scenarioMemo.clear();
    }
    const stable = winners.size === 1;
    redsecStabilityMemo.set(key, stable);
    return stable;
  }
  function memoScenario(key, fn) {
    if (scenarioMemo.has(key)) return scenarioMemo.get(key);
    const v = fn();
    scenarioMemo.set(key, v);
    return v;
  }

  /**
   * The combat row for the CURRENT scenario. This is what ranking consumes, so
   * game mode and armor state are active during ranking itself rather than
   * being applied to a Multiplayer result afterwards.
   */
  function scenarioCombat(raw, d, strategy, mpRow, winStats) {
    if (state.gameMode !== "redsec" || !mpRow) return mpRow;
    // Verified: REDSEC soldier-health damage and ranges are unchanged, so the
    // unarmored scenario reuses the Multiplayer row itself.
    if (state.targetArmor === "unarmored") return { ...mpRow, gameMode: "redsec", targetArmor: "unarmored", armorModel: null };
    return memoScenario(`combat|${scenarioKey({ weaponId: raw?.id, distance: d, strategy })}`, () => {
      const picked = redsecBuildRows(raw, d, strategy);
      if (picked) return picked;
      return redsecCombat(raw, d, state.targetArmor, mpRow, winStats);
    });
  }

  /**
   * The attachment build for the current scenario, shaped exactly like
   * cachedBuild()'s result so every consumer works unchanged.
   *
   * Multiplayer and REDSEC unarmored return the existing optimizer result: EA
   * verify the soldier-health path is identical, so the Multiplayer winner is
   * the correct answer there. REDSEC armoured re-ranks the engine's own
   * validated build set on REDSEC lethality and returns that winner, so a
   * REDSEC result never reports a Multiplayer build or a Multiplayer TTK.
   */
  function scenarioBuild(raw, d, strategy, mpResult) {
    if (state.gameMode !== "redsec" || state.targetArmor !== "plates2") return mpResult;
    const cw = cacheWeapon(raw);
    const row = redsecBuildRows(raw, d, strategy);
    const b = row?.buildId ? cw?.builds?.[row.buildId] : null;
    if (!row || !b) {
      // No REDSEC winner could be resolved: re-time the Multiplayer build under
      // armour rather than silently presenting Multiplayer numbers.
      if (!mpResult) return null;
      const rc = redsecCombat(raw, d, state.targetArmor, mpResult.combat, cachedWinningStats(raw, d, strategy));
      return rc ? { ...mpResult, combat: rc } : mpResult;
    }
    const picks = Array.isArray(b.picks) ? b.picks.map(x => ({ ...x })) : [];
    return {
      score: row.practical ?? 0,
      points: b.points,
      picks,
      audit: { ok: true, total: b.points, budget: cw.budget, errors: [] },
      exhaustive: true,
      combat: row
    };
  }

  /**
   * Which unresolved REDSEC mechanics does THIS result actually depend on?
   *
   * A blanket "partially verified" on every REDSEC result is misleading: a
   * 150 m engagement never touches the close-range automatic rule, and many
   * results have the same BTK under either spillover reading. Confidence is
   * therefore computed from the mechanics the specific numbers really use.
   */
  function redsecDependencies(raw, d, combatRow) {
    if (state.gameMode !== "redsec" || state.targetArmor !== "plates2" || !raw || !combatRow) return null;
    const health = Number(combatRow.damage);
    if (!Number.isFinite(health) || health <= 0) return null;
    const effectiveFireMode = combatRow.effectiveFireMode ?? combatRow.fireMode ?? raw.fireMode;
    const base = { armorState: state.targetArmor, healthDamage: health, effectiveFireMode };
    const run = (closeRange, spillover) => redsecArmoredCombat(raw, d, { ...base, closeRange, spillover });

    const cur = run(defaultCloseRange(), defaultSpillover());
    if (!cur) return null;
    const altClose = run(defaultCloseRange() === "remove" ? "keep" : "remove", defaultSpillover());
    const altSpill = run(defaultCloseRange(), defaultSpillover() === "none" ? "proportional" : "none");

    const closeRangeMatters = !!altClose && altClose.btk !== cur.btk;
    const spilloverMatters = !!altSpill && altSpill.btk !== cur.btk;
    // The close-range rule is only *invoked* when the weapon is automatic and
    // the shot actually lands inside the affected band.
    const closeRangeInvoked = !!(redsecModel()?.damageVsArmor?.removeFirstCloseRangeStep?.appliesToFireModes ?? []).includes(effectiveFireMode)
      && !!altClose && altClose.armorDamagePerShot !== cur.armorDamagePerShot;
    const sniperSweetSpotUnverified = raw.cls === "Sniper Rifle" && /sweet-spot/i.test(String(raw.damageSource || ""));
    const carbineAlignmentApplied = !!redsecModel()?.damageVsArmor?.carbineCloseRangeAlignment?.weaponOverrides?.[raw.id]
      && closeRangeInvoked;

    return {
      btk: cur.btk,
      effectiveFireMode,
      closeRangeInvoked,
      closeRangeMatters,
      spilloverMatters,
      sniperSweetSpotUnverified,
      carbineAlignmentApplied,
      armorChestMultiplier: cur.armorChestMultiplier,
      btkIfCloseRangeKept: altClose?.btk ?? null,
      btkIfSpillover: altSpill?.btk ?? null,
      robust: !closeRangeMatters && !spilloverMatters && !sniperSweetSpotUnverified
    };
  }

  /** Provenance of each mechanic this scenario relies on. Display only. */
  function redsecProvenance(deps) {
    const m = redsecModel();
    if (!m) return [];
    const rows = [
      ["Armour HP", "VERIFIED", `${m.armor.battleRoyale.plates} plates x ${m.armor.battleRoyale.hpPerPlate} HP, stated by EA.`],
      ["Armour range shift", "VERIFIED", `+${m.damageVsArmor.rangeShiftMeters.value} m on every drop-off threshold, stated by EA.`],
      ["Soldier health after armour", m.soldierHealth.confidence === "verified" ? "VERIFIED" : "ASSUMED", "EA state health damage and ranges are unchanged from the rest of Battlefield 6."]
    ];
    if (!deps) return rows;
    rows.splice(2, 0, ["Chest-vs-armour multiplier", "VERIFIED CURRENT", `${Number(deps.armorChestMultiplier).toFixed(2)}x for this weapon class, from BF6 Update 1.3.3.0.`]);
    rows.push(["Close-range armour damage", deps.closeRangeInvoked ? (deps.closeRangeMatters ? "DERIVED — AFFECTS THIS RESULT" : "DERIVED — NOT MATERIAL HERE") : "NOT INVOKED",
      deps.closeRangeInvoked
        ? `EA describe the automatic close-range step as "reduced or removed" without publishing a table. Removed is implemented. Keeping the step instead would give ${deps.btkIfCloseRangeKept} BTK versus ${deps.btk}.`
        : "This distance and fire mode do not use the uncertain close-range step."]);
    rows.push(["Armour-break transition", deps.spilloverMatters ? "UNVERIFIED — AFFECTS THIS RESULT" : "UNVERIFIED — NOT MATERIAL HERE",
      deps.spilloverMatters
        ? `No source states whether leftover damage carries into health. No spillover is modelled; proportional spillover would give ${deps.btkIfSpillover} BTK versus ${deps.btk}.`
        : `No source states whether leftover damage carries into health, but both readings give ${deps.btk} BTK here.`]);
    if (deps.carbineAlignmentApplied) {
      rows.push(["Carbine close-range alignment", "VERIFIED RULE", "EA explicitly says the 7.62x39mm Carbine variant aligns its close-range armour damage to the non-Carbine caliber instead of flattening to the Carbine's lower tier. Current values are derived from the synced weapon curves."]);
    }
    if (deps.sniperSweetSpotUnverified) {
      rows.push(["Sniper sweet-spot armour range", "UNVERIFIED — CONFIDENCE LIMIT", "EA verifies +10 m for damage drop-off thresholds, but does not state whether the rising/onset control points of a non-monotonic sniper sweet-spot curve also shift. This armoured sniper result remains provisional until a REDSEC-specific curve or test resolves that geometry."]);
    }
    return rows;
  }

  /** Scenario identity. Any field that changes the calculation must appear here. */
  function scenarioKey(extra = {}) {
    return [
      extra.gameMode ?? state.gameMode,
      (extra.gameMode ?? state.gameMode) === "redsec" ? (extra.targetArmor ?? state.targetArmor) : "n/a",
      extra.distance ?? state.distance,
      extra.strategy ?? activeStrategy(),
      extra.weaponId ?? state.weaponId ?? "-",
      extra.category ?? state.category
    ].join("|");
  }

  function scenarioLabel() {
    if (state.gameMode !== "redsec") return `${GAME_MODES.multiplayer} · ${state.distance}m`;
    return `${GAME_MODES.redsec} · ${state.distance}m · ${ARMOR_STATES[state.targetArmor] ?? state.targetArmor}`;
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

  function laserbeamUtilityCost(triggerTtk, beamIndex) {
    const t = Math.max(1e-6, Number(triggerTtk));
    const b = Math.max(0.05, Number(beamIndex));
    if (!Number.isFinite(t) || !Number.isFinite(b)) return Infinity;
    return Math.pow(t, 0.55) * Math.pow(b, 0.45);
  }

  /**
   * Deterministic reason this primary is outside the ranking scope, or null when
   * it is in scope. Roster-level exclusions only; combat-level exclusions live in
   * combatScopeExclusion() because they need an evaluated combat row.
   *
   * Every exclusion the ranking performs goes through these two functions, so the
   * count the UI advertises and the count actually ranked are derived from the
   * same predicate and cannot drift apart.
   */
  function rosterScopeExclusion(w, category = state.category) {
    if (w.cls === "Secondary") return "secondary";
    if (category !== "__all__" && w.cls !== category) return "out-of-scope-class";
    const classAudit = auditForClass(w.cls);
    if (!classAudit) return "no-class-audit";
    if (auditedDefForRoster(w, rawForRoster(w))?.confidence === "empirical-current") return "empirical-current-not-verified";
    if (category === "__all__" && classAudit.crossClassEligible === false) return "class-excluded-from-cross-class";
    return null;
  }

  /** Deterministic combat-level exclusion reason, or null when rankable. */
  function combatScopeExclusion(x, category = state.category) {
    if (!x?.combat) return "no-combat-row";
    const c = x.combat;
    if (!Number.isFinite(c.ttk) || !Number.isFinite(c.triggerTtk) || !Number.isFinite(c.damage)) return "incomplete-combat-values";
    if (category === "__all__" && c.ballisticsExact !== true) return "ballistics-not-exact";
    return null;
  }

  function buildRankPool(category = state.category, d = state.distance) {
    return CURRENT.roster
      .filter(w => rosterScopeExclusion(w, category) === null)
      .map(roster => {
        // Rank the build the user is actually being shown. With the default
        // priority this is the historical `best` row; FASTEST KILL ranks the
        // engine's existing `bestLethal` rows instead. Same ranking formula,
        // same cached engine outputs - only which existing row is read changes.
        const strategy = rankingStrategy();
        const raw = rawForRoster(roster);
        let combat = raw ? cachedCombat(raw, d, strategy) : null;
        if (!combat) combat = auditedRosterCombat(roster, raw, d);
        if (!state.combatCache && raw) combat = auditedClassOptimized(raw, d) || combat;
        const def = auditedDefForRoster(roster, raw);
        const winStats = raw ? cachedWinningStats(raw, d, strategy) : null;
        // Game mode and armor state are applied here, before any ranking value
        // is derived, so REDSEC ranks on REDSEC lethality.
        combat = scenarioCombat(raw, d, strategy, combat, winStats);
        const velocity = Number(winStats?.bulletVel ?? (roster.cls === "DMR" ? def?.equippedVelocity : null) ?? raw?.bulletVel ?? def?.bulletVel) || 0;
        if (combat && !Number.isFinite(Number(combat.triggerTtk))) combat = addTriggerKill(roster, raw, combat, d, "standard", velocity);
        const ads = Number(winStats?.adsTimeMs ?? (roster.cls === "DMR" ? def?.adsTime : null) ?? raw?.adsTime ?? def?.adsTime);
        const beamIndex = Number(combat?.beamIndex ?? winStats?.beam?.beamIndex ?? fallbackBeamIndex(raw,d));
        // Unknown ADS time is NULL, not 9999. Four weapons (M16A4, PP-19, RPK-74M,
      // L115) have no adsTime in any source, and a 9999 sentinel silently ranked
      // them last on that tie-break - which asserts they are the slowest to aim
      // rather than admitting the value is unknown. Absence is now neutral: the
      // comparison falls through to the next key.
      return { roster, raw, combat, velocity, ads:Number.isFinite(ads) ? ads : null, beamIndex:Number.isFinite(beamIndex)?beamIndex:null };
      })
      .filter(x => combatScopeExclusion(x, category) === null);
  }

  /**
   * The set actually rankable in this scope, with a deterministic reason for
   * every primary that is not. This is the single source the UI count uses.
   */
  function rankScopeReport(category = state.category, d = state.distance) {
    const included = [], excluded = [];
    for (const w of CURRENT.roster) {
      const scopeReason = rosterScopeExclusion(w, category);
      if (scopeReason) {
        if (scopeReason !== "secondary" && scopeReason !== "out-of-scope-class") excluded.push({ id: w.id, name: w.name, cls: w.cls, reason: scopeReason });
        continue;
      }
      included.push(w.id);
    }
    const pool = buildRankPool(category, d);
    const ranked = new Set(pool.map(x => x.roster.id));
    for (const id of included) {
      if (ranked.has(id)) continue;
      const w = CURRENT.roster.find(r => r.id === id);
      const raw = rawForRoster(w);
      const strategy = rankingStrategy();
      let combat = raw ? cachedCombat(raw, d, strategy) : null;
      if (!combat) combat = auditedRosterCombat(w, raw, d);
      combat = scenarioCombat(raw, d, strategy, combat, raw ? cachedWinningStats(raw, d, strategy) : null);
      excluded.push({ id: w.id, name: w.name, cls: w.cls, reason: combatScopeExclusion({ combat }, category) || "excluded-by-ranking" });
    }
    return { category, distance: d, rankable: ranked.size, excluded, totalPrimaries: CURRENT.roster.filter(w => w.cls !== "Secondary").length };
  }

  function rankWeapons(category = state.category, d = state.distance) {
    const pool = buildRankPool(category, d);
    if (!pool.length) return [];

    // Cross-class-eligible class views use the exact same reference pace as AUTO
    // ALL, so merely filtering the UI cannot change the 55/45 tradeoff or reorder
    // two weapons. Non-cross-class groups (for example Shotguns) keep a local pace.
    const classAudit = category === "__all__" ? null : auditForClass(category);
    const useGlobalReference = category === "__all__" || classAudit?.crossClassEligible !== false;
    const referencePool = useGlobalReference ? buildRankPool("__all__", d) : pool;
    const referenceTtks = referencePool.map(x=>Number(x.combat.triggerTtk)).filter(Number.isFinite);
    const globalFastest = referenceTtks.length ? Math.min(...referenceTtks) : Math.min(...pool.map(x=>Number(x.combat.triggerTtk)));

    const scoreRows = x => {
      const t = Number(x.combat.triggerTtk);
      const baseCost = laserbeamUtilityCost(t, x.beamIndex);
      const offPace = t > globalFastest * 1.25 + 10;
      const metaCost = baseCost * (offPace ? 1.35 : 1);
      return { ...x, metaCost, offPace };
    };
    const rankedPool = pool.map(scoreRows);
    const referenceCosts = referencePool.map(scoreRows).map(x=>x.metaCost).filter(Number.isFinite);
    const bestReferenceCost = referenceCosts.length ? Math.min(...referenceCosts) : Math.min(...rankedPool.map(x=>x.metaCost));
    for (const x of rankedPool) {
      x.laserScore = Number.isFinite(x.metaCost) && x.metaCost > 0 ? 100 * bestReferenceCost / x.metaCost : 0;
      x.metaScore = x.laserScore; // legacy display field; ranking uses metaCost directly.
    }
    // Deterministic tail shared by both comparators. Never reaches a coin flip:
    // BTK, then chest damage, then velocity, then ADS time.
    const tieBreak = (a,b) =>
      a.combat.btk-b.combat.btk ||
      b.combat.damage-a.combat.damage ||
      b.velocity-a.velocity ||
      // Neutral when either side's ADS time is unknown.
      ((a.ads == null || b.ads == null) ? 0 : a.ads-b.ads);

    // Two comparators, one per PRIORITY, over the same rows.
    //
    //   BALANCED (laserbeam) - unchanged: the 55/45 trigger-to-kill / Beam Index
    //   utility decides, and trigger-to-kill breaks utility ties.
    //
    //   FASTEST KILL (lethal) - trigger-to-kill decides outright, and Beam Index
    //   breaks only a genuine lethality tie. This is what the control has always
    //   said it does ("Lowest kill time, even if it kicks harder"); until now
    //   PRIORITY changed only which cached build row was read, so the ordering
    //   key stayed the balanced utility and the winner was frequently not the
    //   fastest killer. No new weight or penalty is introduced here: both values
    //   are ones the engine already computes.
    const TTK_TIE_EPSILON_MS = 1e-9; // float noise only, never a tolerance band
    const ttk = x => Number(x.combat.triggerTtk ?? Infinity);
    const beam = x => Number(x.beamIndex ?? Infinity);
    const lethalFirst = (a,b) => {
      const d = ttk(a)-ttk(b);
      if (Math.abs(d) > TTK_TIE_EPSILON_MS) return d;
      return beam(a)-beam(b) || tieBreak(a,b);
    };
    const balancedFirst = (a,b) =>
      a.metaCost-b.metaCost ||
      ttk(a)-ttk(b) ||
      beam(a)-beam(b) ||
      tieBreak(a,b);

    const comparator = rankingStrategy() === "lethal" ? lethalFirst : balancedFirst;
    return rankedPool.sort(comparator).map((x,i)=>({...x,rankScore:Math.max(0,100-i)}));
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

  function renderControlMetrics(roster, raw, combat) {
    const box = $("controlMetrics");
    const note = $("controlSourceNote");
    if (!box || !note) return;
    if (!raw && !combat) {
      note.textContent = "Recoil/spread source unavailable";
      box.innerHTML = `<div class="control-metric"><span>CONTROL DATA</span><strong>—</strong><small>No recoil/spread values are fabricated when source data is missing.</small></div>`;
      return;
    }

    const exhaustive = combat?.source === "exhaustive-cache";
    const recoil = exhaustive && Number.isFinite(Number(combat?.recoil)) ? Number(combat.recoil) : null;
    const variation = exhaustive && Number.isFinite(Number(combat?.recoilVariationDeg)) ? Number(combat.recoilVariationDeg) : null;
    const unpredictable = exhaustive && Number.isFinite(Number(combat?.unpredictableRecoil)) ? Number(combat.unpredictableRecoil) : null;
    const effSpread = exhaustive && Number.isFinite(Number(combat?.effectiveAdsSpreadDeg)) ? Number(combat.effectiveAdsSpreadDeg) : null;
    const moving = exhaustive && Number.isFinite(Number(combat?.movingAdsMinSpreadDeg)) ? Number(combat.movingAdsMinSpreadDeg) : null;
    const beamIndex = Number.isFinite(Number(combat?.beamIndex)) ? Number(combat.beamIndex) : fallbackBeamIndex(raw, state.distance);
    const opticFit = exhaustive && Number.isFinite(Number(combat?.opticFit)) ? Number(combat.opticFit) : null;

    note.textContent = exhaustive
      ? "Winning attachment build • transformed recoil + spread • ↓ lower is better except Optic Fit"
      : "Base/fallback weapon control only • exhaustive winning-build recoil telemetry pending";

    const rows = exhaustive ? [
      ["BEAM INDEX ↓", Number.isFinite(beamIndex) ? beamIndex.toFixed(3) : "—", "Lower = more laser-like mechanical behavior at this exact distance."],
      ["ADS RECOIL ↓", recoil != null ? recoil.toFixed(3) : "—", "Winning-build recoil magnitude from the Analyzer mechanics."],
      ["RECOIL VARIATION ↓", variation != null ? `${variation.toFixed(1)}°` : "—", "Lower = more repeatable recoil direction."],
      ["UNPREDICTABLE RECOIL ↓", unpredictable != null ? unpredictable.toFixed(3) : "—", "Lateral/unpredictable component derived from recoil × directional variation."],
      ["SUSTAINED ADS SPREAD ↓", effSpread != null ? `${effSpread.toFixed(3)}°` : "—", "Effective ADS spread after repeated fire and recovery."],
      ["MOVING ADS SPREAD ↓", moving != null ? `${moving.toFixed(3)}°` : "—", "Minimum ADS spread while moving."],
      ["OPTIC FIT ↑", opticFit != null ? `${Math.round(opticFit)}/100` : "—", "Higher = better range suitability for the selected optic tier."],
      ["CONTROL SOURCE", "EXHAUSTIVE", "These values are for the actual winning attachment build, not the naked gun."]
    ] : [
      ["BEAM INDEX ↓", Number.isFinite(beamIndex) ? beamIndex.toFixed(3) : "—", "Fallback approximation from the base weapon because the exhaustive winner is not active."],
      ["BASE VERT RECOIL ↓", Number.isFinite(Number(raw?.recoilV)) ? Number(raw.recoilV).toFixed(3) : "—", "Base weapon vertical recoil; winning-build transformed recoil pending."],
      ["BASE RECOIL VAR ↓", Number.isFinite(Number(raw?.recoilVar)) ? `${Number(raw.recoilVar).toFixed(1)}°` : "—", "Base directional variation; lower is more repeatable."],
      ["BASE ADS SPREAD ↓", Number.isFinite(Number(raw?.spread?.adsStand?.[0])) ? `${Number(raw.spread.adsStand[0]).toFixed(3)}°` : "—", "Base standing ADS minimum spread."],
      ["MOVING ADS SPREAD ↓", Number.isFinite(Number(raw?._movingAdsMinSpreadDeg ?? raw?.spread?.adsMove?.[0])) ? `${Number(raw?._movingAdsMinSpreadDeg ?? raw.spread.adsMove[0]).toFixed(3)}°` : "—", "Base moving ADS minimum spread."],
      ["WINNING-BUILD RECOIL", "PENDING", "The UI will not pretend the on-demand heuristic build has exact transformed recoil telemetry."],
      ["OPTIC FIT ↑", Number.isFinite(Number(combat?.opticFit)) ? `${Math.round(Number(combat.opticFit))}/100` : "—", "0–100 range suitability when a verified winning optic is available."],
      ["CONTROL SOURCE", "FALLBACK", "Useful for direction only; verified AUTO uses exhaustive transformed mechanics when cache is active."]
    ];
    box.innerHTML = rows.map(([k,v,sub]) => `<div class="control-metric"><span>${k}</span><strong>${v}</strong><small>${sub}</small></div>`).join("");
  }

  /**
   * Single resolution of the combat row the UI displays, shared by the headline
   * key stats and the Advanced Stats panel so the two can never disagree. This
   * only selects between values the engine already produced; it performs no new
   * combat math of its own.
   */
  function resolveDisplayCombat(roster, raw) {
    if (!roster) return { classAudit: null, auditDef: null, audited: null, cached: null, cachedStats: null, optimized: null, displayVelocity: NaN, combat: null, strategy: activeStrategy() };
    const classAudit = auditForClass(roster.cls);
    const auditDef = auditedDefForRoster(roster, raw);
    const audited = auditedRosterCombat(roster, raw, state.distance);
    // PRIORITY resolves to one of the two strategies the engine already has;
    // with the default "auto" priority this is exactly the historical per-mode
    // strategy, so the detail panel keeps agreeing with the recommendation.
    const detailStrategy = activeStrategy();
    const cached = raw ? cachedCombat(raw, state.distance, detailStrategy) : null;
    // A validated exhaustive winner is authoritative, then the independent class
    // audit, then raw data only when no audited path exists.
    let c = cached || audited || (raw && !classAudit ? combatAtDistance(raw, state.distance) : null);
    const optimized = c && raw && !cached ? auditedClassOptimized(raw, state.distance) : null;
    const cachedStats = raw ? cachedWinningStats(raw, state.distance, detailStrategy) : null;
    // Same scenario transform the ranking used, so the headline result and the
    // ranking can never disagree about which scenario they describe.
    c = scenarioCombat(raw, state.distance, detailStrategy, c, cachedStats);
    const deps = redsecDependencies(raw, state.distance, c);
    const displayVelocity = c ? Number(cachedStats?.bulletVel ?? (roster.cls === "DMR" ? auditDef?.equippedVelocity : null) ?? c.bulletVel ?? raw?.bulletVel ?? auditDef?.bulletVel) : NaN;
    if (c && !Number.isFinite(Number(c.triggerTtk))) c = addTriggerKill(roster, raw, c, state.distance, "standard", displayVelocity);
    return { classAudit, auditDef, audited, cached, cachedStats, optimized, displayVelocity, combat: c, strategy: detailStrategy, deps };
  }

  function renderWeaponIntel(roster, raw, resolved = resolveDisplayCombat(roster, raw)) {
    $("dashboardWeapon").textContent = roster.name;
    $("weaponDescription").textContent = roster.desc || "Current BF6 weapon catalog entry.";
    const badge = $("weaponDataBadge");
    const { classAudit, auditDef, audited, cached, optimized } = resolved;

    if (!raw && !audited) {
      badge.textContent = "STATS DATA PENDING";
      badge.className = "source-badge warn";
      $("combatNumbers").innerHTML = emptyStats("Exact raw stats are not available from the current analyzer feed yet.");
      $("statBars").innerHTML = `<div class="why-item"><strong>Catalog available, stat feed missing</strong><span>The weapon remains selectable; the site does not replace it with sample data.</span></div>`;
      $("rawStats").innerHTML = "";
      renderControlMetrics(roster, raw, null);
      return;
    }

    const ver = sourceVersion(raw);
    if (classAudit?.pass) {
      const short = roster.cls === "Assault Rifle" ? "AR" : roster.cls === "Sniper Rifle" ? "SNIPER" : roster.cls.toUpperCase();
      const empirical = auditDef?.confidence === "empirical-current" ? " • EMPIRICAL CURRENT" : "";
      badge.textContent = `${short} TTK AUDITED ${classAudit.gameVersion}${empirical}`;
      badge.className = auditDef?.confidence === "empirical-current" ? "source-badge warn" : "source-badge ok";
    } else {
      badge.textContent = ver ? `RAW SOURCE ${ver}` : "RAW DATA LOADED";
      badge.className = ver && ver !== CURRENT.liveVersion ? "source-badge warn" : "source-badge ok";
    }

    const c = resolved.combat;
    if (!c) {
      $("combatNumbers").innerHTML = emptyStats("The audited combat model is not available for this exact weapon yet.");
      $("statBars").innerHTML = "";
      $("rawStats").innerHTML = "";
      renderControlMetrics(roster, raw, null);
      return;
    }
    const damageLabel = c.pellets > 1 ? "MAX SHELL" : "CHEST DMG";
    const damageSub = c.pellets > 1 ? `${c.pelletDamage?.toFixed(1) ?? "—"} × ${c.pellets} pellets @ ${state.distance}m` : `@ ${state.distance}m`;
    const mechText = c.ttk == null ? "—" : c.btk === 1 ? "0 ms" : `${Math.round(c.ttk)} ms`;
    const triggerText = Number.isFinite(Number(c.triggerTtk)) ? `${Math.round(c.triggerTtk)} ms` : "—";
    const ttkSub = roster.cls === "Sniper Rifle" ? "audited bolt cadence • first hit → kill" : (c.pellets > 1 ? "ideal full-pellet chest" : "ideal chest • first hit → kill");
    const rof = c.rpm == null ? "—" : (Math.abs(Number(c.rpm)-Math.round(Number(c.rpm))) > .05 ? Number(c.rpm).toFixed(1) : Math.round(c.rpm));
    const flightDetail = Number.isFinite(Number(c.flightMs))
      ? `${c.ballisticsExact ? "verified" : "provisional"} BF6 drag • ${Math.round(c.flightMs)}ms flight • ${Math.round(c.bulletVel)}m/s`
      : "projectile timing unavailable";
    const combat = [
      [damageLabel, c.damage == null ? "—" : Number(c.damage).toFixed(Number(c.damage) % 1 ? 1 : 0), damageSub],
      ["CHEST BTK", c.btk ?? "—", "100 HP • unarmored"],
      ["TRIGGER→KILL", triggerText, `trigger pull → lethal impact • ${flightDetail}`],
      ["MECH TTK", mechText, `${ttkSub} • projectile flight excluded`],
      ["ROF", rof, roster.cls === "Sniper Rifle" ? "effective follow-up cadence" : (raw?.id === "db12" ? "150 sustained • 360 pair" : "internal RPM")],
      ["MAG", c.mag ?? raw?.mag ?? auditDef?.mag ?? "—", "base rounds"]
    ];
    if (optimized && Number.isFinite(Number(optimized.ttk)) && Number(optimized.ttk) !== Number(c.ttk)) {
      combat.splice(4,0,["OPT MECH TTK", optimized.btk === 1 ? "0 ms" : `${Math.round(optimized.ttk)} ms`, optimized.attachment ? `${optimized.attachment}${optimized.rpm ? ` • ${Math.round(optimized.rpm)} RPM` : ""} • flight excluded` : "exhaustive winning build • flight excluded"]);
    }
    $("combatNumbers").innerHTML = combat.map(([k, v, sub]) => `<div class="combat-stat"><span>${k}</span><strong>${v}</strong><small>${sub}</small></div>`).join("");

    if (raw) {
      const bars = relativeBars(raw);
      $("statBars").innerHTML = [
        ["HIPFIRE", bars.hip], ["PRECISION", bars.precision], ["CONTROL", bars.control], ["MOBILITY", bars.mobility]
      ].map(([name, val]) => `<div class="statbar"><label>${name}</label><div class="bartrack"><i style="width:${val ?? 0}%"></i></div><output>${val ?? "—"}</output></div>`).join("");
    } else {
      $("statBars").innerHTML = `<div class="why-item"><strong>Handling bars pending</strong><span>TTK is independently audited, but ${escapeHtml(roster.name)} is not yet in the Analyzer feed. The site will not fabricate recoil/spread bars.</span></div>`;
    }

    renderControlMetrics(roster, raw, c);

    const lowTtkText = c.lowTtk == null ? "—" : c.lowBtk === 1 ? "1 SHOT" : `${Math.round(c.lowTtk)} ms`;
    const velocity = Number((roster.cls === "DMR" ? auditDef?.equippedVelocity : null) ?? c.bulletVel ?? raw?.bulletVel ?? auditDef?.bulletVel);
    const ads = Number((roster.cls === "DMR" ? auditDef?.adsTime : null) ?? c.adsTime ?? raw?.adsTime ?? auditDef?.adsTime);
    const rawStats = [
      ["Velocity", Number.isFinite(velocity) ? `${Math.round(velocity)} m/s` : "—"],
      ["ADS", Number.isFinite(ads) ? `${Math.round(ads)} ms` : "—"],
      ["Low-body TTK", `${lowTtkText} (${c.lowBtk ?? "—"} BTK)`],
      ["Tac reload", raw?.tacRld ? `${Number(raw.tacRld).toFixed(2)} s` : "—"],
      ["Vert recoil", Number.isFinite(Number(raw?.recoilV)) ? Number(raw.recoilV).toFixed(3) : "—"],
      ["Recoil var.", Number.isFinite(Number(raw?.recoilVar)) ? Number(raw.recoilVar).toFixed(1) : "—"],
      ["Fire mode", raw?.fireMode || auditDef?.mode || "—"]
    ];
    $("rawStats").innerHTML = rawStats.map(([k, v]) => `<div class="raw"><span>${k}</span><strong>${v}</strong></div>`).join("");
  }

  // ===========================================================================
  // ATTACHMENT EXPLANATION LAYER
  //
  // Everything here is OUTPUT derived from a decision the optimizer has already
  // made. It is never an input: no function below is called by buildOptions(),
  // scoreOption(), optimize(), cachedBuild(), rankWeapons() or any other engine
  // path, and none of it can change a candidate, modifier, point cost or rank.
  //
  // Direction is normalised so that UP always means BETTER for the player, even
  // where the underlying number is an inverse metric. The polarity of every
  // field below is taken from the sign the engine's own scoreOption() applies
  // to it, so "lower vertical recoil" is presented as "Recoil Control up",
  // never as "Vertical Recoil down".
  // ===========================================================================

  const EFFECT_FIELDS = [
    // field,                      characteristic,           better when,  percentage form
    ["adsRecoilTierMod",           "Recoil Control",         "higher", null],
    ["adsRecoilVariationTierMod",  "Recoil Predictability",  "higher", null],
    ["adsRecoilDecayMult",         "Recoil Recovery",        "higher", v => (v - 1) * 100],
    ["adsTimeTierMod",             "ADS Speed",              "higher", null],
    ["adsTimeTierShift",           "ADS Speed",              "lower",  null],
    ["movingAdsSpreadTierMod",     "Moving Accuracy",        "higher", null],
    ["adsMoveSpeedTierShift",      "ADS Move Speed",         "lower",  null],
    ["hipSpreadTierMod",           "Hipfire Accuracy",       "lower",  null],
    ["hipSpreadDecayBoost",        "Hipfire Recovery",       "higher", null],
    ["adsSpreadDecayBoost",        "ADS Spread Recovery",    "higher", null],
    ["spreadIncMult",              "Spread Control",         "lower",  v => (1 - v) * 100],
    ["velTierMod",                 "Bullet Velocity",        "higher", null],
    ["velMult",                    "Bullet Velocity",        "higher", v => (v - 1) * 100],
    ["reloadSpeedTier",            "Reload Speed",           "higher", null],
    ["reloadSpeedMult",            "Reload Speed",           "higher", v => (v - 1) * 100],
    ["sprintRecoveryTierShift",    "Sprint-to-Fire",         "lower",  null],
    ["visualRecoil",               "Sight Picture",          "lower",  null],
    ["healthRegenDelayS",          "Health Regen Delay",     "lower",  null],
    ["worldSpot",                  "Concealment",            "lower",  null],
    ["minimapSpot",                "Minimap Concealment",    "lower",  null]
  ];

  // Fields whose direction cannot be established from evidence in this
  // repository are deliberately not shown rather than guessed at.
  const UNRESOLVED_EFFECT_FIELDS = new Set(["sway", "spreadFiringDecCoefMult", "spreadFiringDecOffsetMult", "laserVisible"]);

  /** Fields the source itself marks as assumed are never presented as effects. */
  function assumedFieldSet(rec) {
    const f = rec?.assumedFields;
    if (Array.isArray(f)) return new Set(f.map(String));
    if (f && typeof f === "object") return new Set(Object.keys(f));
    return new Set();
  }

  /** This weapon's default ammo record, the only valid baseline for ammo deltas. */
  function defaultAmmoRecord(raw) {
    const def = state.ammo?.WEAPON_AMMO?.[raw?.id]?.def;
    if (!def) return null;
    return (state.ammo?.AMMO ?? []).find(x => x.id === def) ?? null;
  }

  /** Full catalog record for a pick. Display use only; identity stays the id. */
  function attachmentRecord(raw, pick) {
    if (!pick) return null;
    if (pick.slot === "mag") return state.attachments?.WEAPON_MAG?.[raw?.id]?.mags?.[pick.id] ?? null;
    if (pick.slot === "ammo") return (state.ammo?.AMMO ?? []).find(x => x.id === pick.id) ?? null;
    return catalogItem(pick.slot, pick.id) ?? null;
  }

  function fmtPct(n) {
    const v = Math.abs(Number(n));
    if (!Number.isFinite(v) || v < 0.5) return null;
    return `${v < 10 ? v.toFixed(1).replace(/\.0$/, "") : Math.round(v)}%`;
  }

  /**
   * Normalised benefit/drawback list for one attachment.
   * dir "up" = this characteristic improves, "down" = it gets worse.
   */
  function attachmentEffects(raw, pick) {
    const rec = attachmentRecord(raw, pick);
    if (!rec) return { effects: [], neutral: false, assumed: false, record: null };
    const assumed = assumedFieldSet(rec);
    const out = [];
    const seen = new Map();

    const push = (label, better, delta) => {
      if (!better) return;
      const prev = seen.get(label);
      if (prev) { if (!prev.delta && delta) prev.delta = delta; return; }
      const e = { label, dir: better, delta: delta || null };
      seen.set(label, e);
      out.push(e);
    };

    for (const [field, label, betterWhen, pct] of EFFECT_FIELDS) {
      if (assumed.has(field)) continue;
      const v = Number(rec[field]);
      if (!Number.isFinite(v)) continue;
      const neutralValue = (field === "velMult" || field === "spreadIncMult" || field === "reloadSpeedMult" || field === "adsRecoilDecayMult") ? 1 : 0;
      if (v === neutralValue) continue;
      // worldSpot/minimapSpot are absolute detection values, only meaningful
      // against the no-attachment baseline for the same slot.
      if (field === "worldSpot" || field === "minimapSpot") {
        const base = Number(catalogItem(pick.slot, "none")?.[field]);
        if (!Number.isFinite(base) || base === v) continue;
        push(label, v < base ? "up" : "down", null);
        continue;
      }
      const improves = betterWhen === "higher" ? v > neutralValue : v < neutralValue;
      push(label, improves ? "up" : "down", pct ? fmtPct(pct(v)) : null);
    }

    // Magazine capacity is only meaningful against this weapon's base capacity.
    if (pick.slot === "mag" && Number.isFinite(Number(rec.mag)) && Number.isFinite(Number(raw?.mag))) {
      const diff = Number(rec.mag) - Number(raw.mag);
      if (diff !== 0) push("Magazine", diff > 0 ? "up" : "down", `${diff > 0 ? "+" : ""}${diff} rounds`);
    }
    if (rec.suppressor === true) push("Concealment", "up", null);

    // Ammo multipliers are absolute values, not deltas. The only honest
    // baseline is this weapon's own default ammo, so standard ammo shows no
    // change rather than a fabricated penalty against an imaginary 1.0.
    const ammoBase = pick.slot === "ammo" ? defaultAmmoRecord(raw) : null;
    const numeric = v => (v == null || typeof v === "boolean" || v === "" ? NaN : Number(v));
    const compare = (label, key, pick3) => {
      const v = numeric(pick3(rec));
      if (!Number.isFinite(v)) return;
      const baseRaw = ammoBase ? numeric(pick3(ammoBase)) : 1;
      const base = Number.isFinite(baseRaw) ? baseRaw : 1;
      if (base === 0 || v === base) return;
      push(label, v > base ? "up" : "down", fmtPct((v - base) / Math.abs(base) * 100));
    };
    compare("Headshot Damage", "hsMult", r => r.hsMult);
    compare("Penetration", "collateralMult", r => r.collateralMult?.[raw?.cls]);
    if (Number.isFinite(Number(rec.tacRldOverrideMs)) && Number.isFinite(Number(raw?.tacRld))) {
      const base = Number(raw.tacRld) * 1000;
      const v = Number(rec.tacRldOverrideMs);
      if (Math.round(v) !== Math.round(base)) push("Reload Speed", v < base ? "up" : "down", fmtPct((base - v) / base * 100));
    }

    const neutral = rec.noEffect === true || (!out.length && !rec.setsFireModeAuto && !rec.setsFireModeBurst);
    return { effects: out, neutral, assumed: assumed.size > 0 || rec.assumed === true, record: rec };
  }

  /** True when nothing about this attachment can move damage, BTK or fire rate. */
  function isLethalityNeutral(rec) {
    if (!rec) return false;
    const lethal = ["damageMult", "dmgMult", "damageMultiplier", "dmgMultiplier", "rpmMult", "rateOfFireMult", "rofMult", "damageAdd", "dmgAdd", "autoRpm", "setsFireModeAuto", "setsFireModeBurst", "hsMult"];
    return !lethal.some(k => rec[k] != null && rec[k] !== 1 && rec[k] !== false);
  }

  function effectPhrase(list, max = 2) {
    const names = list.slice(0, max).map(e => e.delta ? `${e.label.toLowerCase()} (${e.delta})` : e.label.toLowerCase());
    if (!names.length) return "";
    if (names.length === 1) return names[0];
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }

  /**
   * Why the optimizer kept this attachment. Built from the attachment's real
   * modifiers, its point cost against the real budget, the selected distance,
   * the active strategy and the engine's own selection rules. It never claims a
   * factor decided anything unless that factor is present in the data.
   */
  function attachmentReason(raw, pick, ctx) {
    const { effects, neutral, record } = attachmentEffects(raw, pick);
    const ups = effects.filter(e => e.dir === "up");
    const downs = effects.filter(e => e.dir === "down");
    const pts = pointCost(pick) ?? 0;
    const d = ctx.distance ?? state.distance;
    const strict = ctx.strategy === "lethal";
    const bits = [];

    if (ctx.requiredId && pick.id === ctx.requiredId) {
      return `Required. ${raw?.name || "This weapon"}'s independently audited lethal transform depends on this exact attachment, so every legal build must include it.`;
    }

    if (pick.slot === "sight") {
      const fit = Number(ctx.opticFit);
      const fitText = Number.isFinite(fit) ? `It rates ${Math.round(fit)}/100 for ${d}m` : `It clears the range-suitability gate for ${d}m`;
      const eff = record?.noEffect === true
        ? "This sight tier changes no weapon mechanics"
        : ups.length ? `It also improves ${effectPhrase(ups)}` : "This sight tier changes no weapon mechanics";
      return `${fitText}, which is what the engine requires before a build can win at this range. ${eff}, so its ${pts} points buy sight suitability rather than performance.`;
    }

    if (neutral && !ups.length && !downs.length) {
      return pts === 0
        ? "Costs nothing and changes nothing mechanically, so it is kept as the free baseline for this slot."
        : `Carries no mechanical change in the current source data, so its ${pts} points are spent on utility rather than measurable performance.`;
    }

    if (ups.length) bits.push(`Improves ${effectPhrase(ups)}`);
    if (downs.length) bits.push(`${ups.length ? "at the cost of" : "Costs you"} ${effectPhrase(downs)}`);
    let sentence = bits.join(" ") + `, for ${pts} of the build's ${ctx.budget} points.`;

    const controlish = ups.some(e => /Recoil|Spread|Accuracy|Sight Picture/.test(e.label));
    const speedish = ups.some(e => /ADS Speed|Sprint|Reload/.test(e.label));
    if (strict) {
      sentence += isLethalityNeutral(record)
        ? ` Fastest kill was already locked in by other slots, so this slot went to the best remaining option that cannot slow the kill down.`
        : ` It was kept because it does not lengthen the ${Math.round(ctx.triggerTtk)} ms kill at ${d}m.`;
    } else if (controlish) {
      sentence += ` Balanced mode trades a little kill speed for control, and at ${d}m this is control the ranking actually rewards.`;
    } else if (speedish) {
      sentence += ` Handling like this matters more the closer the fight, and ${d}m is close enough for it to count.`;
    } else {
      sentence += ` It fits the ${ctx.budget}-point cap without displacing anything the ranking values more at ${d}m.`;
    }
    return sentence;
  }

  /** Real, measured differences between the base weapon and the winning build. */
  function buildDeltas(raw, resolved) {
    const st = resolved?.cachedStats;
    if (!raw || !st) return [];
    const rows = [];
    const add = (label, base, now, betterWhen, unit) => {
      const b = Number(base), n = Number(now);
      if (!Number.isFinite(b) || !Number.isFinite(n) || b === 0 || Math.abs(n - b) < 1e-9) return;
      const improves = betterWhen === "higher" ? n > b : n < b;
      const magnitude = unit === "rounds" ? `${n - b > 0 ? "+" : ""}${Math.round(n - b)} rounds`
        : unit === "ms" ? `${Math.round(Math.abs(n - b))} ms ${improves ? "faster" : "slower"}`
        : fmtPct(Math.abs(n - b) / Math.abs(b) * 100);
      if (!magnitude) return;
      rows.push({ label, dir: improves ? "up" : "down", delta: magnitude });
    };
    add("Recoil Control", raw.recoilV, st.recoilV, "lower");
    add("Recoil Per Shot", raw.recoilIncAds, st.recoilIncAds, "lower");
    add("ADS Speed", raw.adsTime, st.adsTimeMs, "lower", "ms");
    add("Bullet Velocity", raw.bulletVel, st.bulletVel, "higher");
    add("Moving Accuracy", raw?.spread?.adsMove?.[0], st.movingAdsMinSpreadDeg, "lower");
    add("Reload Speed", raw.tacRld, st.tacRld, "lower");
    add("Fire Rate", raw.rpm, st.rpm, "higher");
    add("Magazine", raw.mag, st.mag, "higher", "rounds");
    return rows;
  }

  /**
   * One plain-language statement of what the whole attachment combination is
   * trying to achieve, generated from the measured build-vs-base differences
   * and the strategy that selected it.
   */
  function whyThisBuild(roster, raw, resolved, result) {
    if (!result || !roster) return "No build is available yet, so no strategy is claimed.";
    const c = result.combat || resolved?.combat;
    const deltas = buildDeltas(raw, resolved);
    const gains = deltas.filter(x => x.dir === "up");
    const costs = deltas.filter(x => x.dir === "down");
    const strict = activeStrategy() === "lethal";
    const d = state.distance;
    const bits = [];

    const ttk = Number(c?.triggerTtk);
    const kill = Number.isFinite(ttk) ? `${Math.round(ttk)} ms kill time at ${d}m` : `kill time at ${d}m`;
    bits.push(strict
      ? `This build takes the quickest kill ${roster.name} can reach at ${d}m and spends everything left over on whatever cannot slow it down.`
      : `This build keeps ${roster.name}'s ${kill} and spends the rest of the points on making the gun easier to hold on target.`);

    if (gains.length) bits.push(`Against the bare weapon it gains ${effectPhrase(gains, 3)}.`);
    if (costs.length) bits.push(`It gives up ${effectPhrase(costs, 2)} to get there.`);
    else if (gains.length) bits.push("Nothing measurable was given up to get there.");

    if (!result.exhaustive) bits.push("The exhaustive attachment cache has not validated for this weapon, so this is an on-demand result rather than a verified winner.");
    return bits.join(" ");
  }

  function emptyStats(message) {
    return `<div class="combat-stat" style="grid-column:1/-1"><span>DATA STATUS</span><strong style="font-size:15px">PENDING</strong><small>${escapeHtml(message)}</small></div>`;
  }

  function renderPrimaryBuild(roster, raw, resolved = null, ranked = []) {
    // Budget comes from the engine, never from a hardcoded number.
    const budget = raw ? budgetFor(raw) : budgetFor(roster);
    $("buildTitle").textContent = `${roster.name} • ${state.distance}m`;
    $("pointsLimit").textContent = `/${budget}`;
    if (!raw || !state.attachments || !state.ammo) {
      renderBuildPending("primary", raw ? "Attachment/ammo feed unavailable." : "Weapon stats/compatibility are not in the current source yet.");
      $("whySummary").textContent = "No build is available for this weapon yet, so no reason is claimed.";
      return null;
    }

    try {
      const result = scenarioBuild(raw, state.distance, activeStrategy(), optimize(raw, state.distance, activeStrategy()));
      if (!result) throw new Error("No legal build could be resolved for this scenario");
      $("pointsUsed").textContent = result.points;
      $("pointsMeter").style.width = `${Math.min(100, result.points / budget * 100)}%`;
      const audit = $("pointAuditBadge");
      if (result.exhaustive) {
        const sight=result.picks.find(x=>x.slot==="sight");
        const fit=Number(result.combat?.opticFit ?? (sight ? opticRangeFit(sight.id,state.distance) : NaN));
        audit.textContent = `VERIFIED RANGE BUILD • ${result.points}/${budget} • ${sight ? attachmentDisplay(sight).name : "OPTIC"}${Number.isFinite(fit)?` • OPTIC FIT ${Math.round(fit)}/100`:""} • ${state.distance}m`;
        audit.className = "audit-line ok";
      } else {
        audit.textContent = `ON-DEMAND BUILD • ${result.points}/${budget} • EXHAUSTIVE LETHALITY CACHE PENDING`;
        audit.className = "audit-line";
      }
      const ctx = {
        strategy: activeStrategy(),
        budget,
        distance: state.distance,
        opticFit: result.combat?.opticFit ?? null,
        triggerTtk: result.combat?.triggerTtk ?? resolved?.combat?.triggerTtk ?? NaN,
        requiredId: auditedClassOptimized(raw, state.distance)?.attachmentId || null
      };
      $("attachmentGrid").innerHTML = result.picks
        .filter(x => x.id !== "none")
        .map(opt => attachmentCard(opt, raw, ctx)).join("");
      renderWhy(raw, result, roster, ranked);
      const summary = $("whySummary");
      if (summary) summary.textContent = whySummary(roster, resolved, result, ranked);
      const buildWhy = $("buildWhy");
      if (buildWhy) buildWhy.textContent = whyThisBuild(roster, raw, resolved, result);
      const buildFx = $("buildEffects");
      if (buildFx) buildFx.innerHTML = effectChips(buildDeltas(raw, resolved));
      state.lastBuildError = null;
      return result;
    } catch (err) {
      // This catch exists for the legitimate data condition "no legal build for
      // this weapon yet". It also catches genuine faults, so the reason is
      // recorded rather than being reported downstream as a benign cache state.
      state.lastBuildError = { weaponId: roster?.id ?? null, distance: state.distance, message: String(err && err.message || err) };
      renderBuildPending("primary", err.message);
      $("whySummary").textContent = "No build could be produced, so no reason is claimed.";
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
      $("whyList").innerHTML = `<div class="why-item"><strong>Why no build?</strong><span>${escapeHtml(reason)} The ${CURRENT.roster.length}-weapon catalog remains intact while build data catches up.</span></div>`;
    } else {
      $("secondaryPointsUsed").textContent = "—";
      $("secondaryPointsMeter").style.width = "0%";
      $("secondaryAudit").textContent = "SIDEARM BUILD DATA PENDING • NO POINTS GUESSED";
      $("secondaryAudit").className = "audit-line bad";
      $("secondaryAttachmentGrid").innerHTML = `<div class="attachment-card" style="grid-column:1/-1"><span>DATA STATUS</span><strong>No fabricated sidearm build</strong><small>${escapeHtml(reason)}</small></div>`;
    }
  }

  /**
   * Attachment card. The exact BF6 name is shown verbatim when verified; an
   * unverified or internal label is shown exactly as the source provides it and
   * is visibly marked, never cleaned up, simplified or swapped for a guess.
   */
  /** Compact green-up / red-down chips. Up always means better for the player. */
  function effectChips(effects) {
    if (!effects.length) return `<i class="fx none">no measurable effect</i>`;
    return effects.map(e =>
      `<i class="fx ${e.dir}"><b>${e.dir === "up" ? "↑" : "↓"}</b>${escapeHtml(e.label)}${e.delta ? ` <s>${escapeHtml(e.delta)}</s>` : ""}</i>`
    ).join("");
  }

  function attachmentCard(opt, raw = null, ctx = null) {
    const d = attachmentDisplay(opt);
    const clean = d.status === "GAME_VERIFIED_EXACT";
    const flag = clean ? "" :
      `<em class="name-flag ${d.ui.cls}" title="${escapeHtml(d.ui.note)}">${escapeHtml(d.ui.chip)}</em>`;
    const { effects, assumed } = raw ? attachmentEffects(raw, opt) : { effects: [], assumed: false };
    const reason = raw && ctx ? attachmentReason(raw, opt, ctx) : attachmentNote(opt);
    const flagged = d.status === "UNVERIFIED" || d.status === "INTERNAL_PLACEHOLDER" || d.status === "MISMATCH";
    return `<div class="attachment-card${flagged ? " unverified-name" : ""}">` +
      `<span>${escapeHtml(SLOT_LABELS[opt.slot] || opt.slot)}<b>${pointCost(opt)}p</b></span>` +
      `<strong>${escapeHtml(d.name)}</strong>${flag}` +
      `<div class="fx-row">${effectChips(effects)}</div>` +
      `<small><b>Why:</b> ${escapeHtml(reason)}${assumed ? " Some of this attachment's source values are marked unverified and are not shown as effects." : ""}</small>` +
      `</div>`;
  }

  /**
   * Full scoring breakdown. Every row is a value the ranking or the winning
   * build actually produced; nothing is asserted to have "changed the decision"
   * unless the underlying number exists.
   */
  function scoringFactors(roster, result, ranked) {
    const rows = [];
    const me = ranked.find(x => x.roster.id === roster?.id);
    const c = result?.combat || me?.combat;
    if (me) {
      if (Number.isFinite(Number(me.laserScore))) rows.push({ title: "Laser Score (higher is better)", text: `${Math.round(me.laserScore)}/100. Pool-stable efficiency score: 55% exact-distance trigger→kill and 45% Beam Index, measured against the same global reference pool for every class filter.` });
      if (Number.isFinite(Number(me.metaCost))) rows.push({ title: "Ranking cost (lower is better)", text: `${Number(me.metaCost).toFixed(3)} = triggerTtk^0.55 × BeamIndex^0.45${me.offPace ? " × 1.35 off-pace penalty" : ""}.` });
      rows.push({ title: "Kill-pace penalty", text: me.offPace
        ? "Applied. This weapon is more than 25% (+10 ms) slower than the fastest trigger→kill in the reference pool, so its ranking cost carries a fixed 35% penalty."
        : "Not applied. This weapon is within 25% (+10 ms) of the fastest trigger→kill in the reference pool." });
      if (Number.isFinite(Number(me.beamIndex))) rows.push({ title: "Beam Index (lower is better)", text: `${Number(me.beamIndex).toFixed(3)}. Absolute mechanical instability from recoil magnitude, directional variation and effective ADS spread at ${state.distance}m.` });
    }
    if (c) {
      if (Number.isFinite(Number(c.triggerTtk))) rows.push({ title: "Trigger→Kill", text: `${Math.round(c.triggerTtk)} ms at ${state.distance}m${Number.isFinite(Number(c.flightMs)) ? `, of which ${Math.round(c.flightMs)} ms is projectile flight (${c.ballisticsExact ? "verified" : "provisional"} BF6 drag)` : ""}.` });
      if (Number.isFinite(Number(c.ttk))) rows.push({ title: "Mechanical TTK", text: `${c.btk === 1 ? "0 ms — one shot" : `${Math.round(c.ttk)} ms`}. First damaging chest hit to lethal chest hit; projectile flight excluded.` });
      if (Number.isFinite(Number(c.opticFit))) rows.push({ title: "Optic fit", text: `${Math.round(c.opticFit)}/100 for ${state.distance}m${c.opticEligible === false ? " — below the range-eligibility gate" : ""}. This is an optimizer policy over the source's optic tiers, not claimed magnification data.` });
      if (Number.isFinite(Number(c.effectiveAdsSpreadDeg))) rows.push({ title: "Sustained ADS spread", text: `${Number(c.effectiveAdsSpreadDeg).toFixed(3)}° after spread growth and recovery, with ${Number(c.recoil ?? NaN).toFixed(3)} recoil and ${Number(c.recoilVariationDeg ?? NaN).toFixed(1)}° directional variation on the winning build.` });
    }
    if (result) rows.push({ title: "Point budget", text: `${result.points} of ${result.audit?.budget ?? "—"} points spent across ${result.picks.filter(p => p.id !== "none").length} attachments. The budget is a hard cap and the build is re-checked against it after selection.` });
    {
      const assumed = assumedPicksIn(rawForRoster(roster), result?.picks || []);
      if (assumed.length) rows.push({
        title: "Assumed modifiers",
        text: `${assumed.map(a => a.id).join(", ")} carry upstream modifier fields marked assumed rather than measured (${[...new Set(assumed.flatMap(a => a.fields))].join(", ") || "unspecified"}). Those fields are stripped before any calculation, by the same policy the exhaustive cache uses, so no unverified number reaches this result. The attachment's verified modifiers are applied in full. The build is labelled partially verified because the attachment's behaviour is not completely characterised, not because the maths used a guess.`
      });
    }
    return rows;
  }

  function renderWhy(raw, result, roster = rosterWeapon(), ranked = []) {
    const top = [...result.picks].filter(x => x.id !== "none").sort((a, b) => b.score - a.score).slice(0, 5);
    const items = [{
      title: state.selectionMode === "manual" ? "Weapon locked — attachments only" : "Lethality first",
      text: state.selectionMode === "manual"
        ? (result.exhaustive
          ? `You chose ${raw.name || rosterWeapon()?.name || "this weapon"}. AUTO cannot replace it. This is the exhaustive winning legal attachment build for ${state.distance}m, with a sight appropriate to the selected range, kill speed protected first, and recoil/spread used to favor the more laser-like build when lethal performance is close.`
          : `You chose ${raw.name || rosterWeapon()?.name || "this weapon"}. AUTO cannot replace it. The on-demand attachment build is available now, but it is not labeled the most-lethal exhaustive winner until the combat cache passes.`)
        : "The weapon recommendation prioritizes exact-distance kill speed while transformed recoil/spread prevents tiny paper-TTK advantages from automatically beating a much more controllable gun."
    }, {
      title: `${state.distance}m target distance`,
      text: distanceExplanation(state.distance)
    },
    ...scoringFactors(roster, result, ranked),
    ...top.filter(x => x.score > 0).map(x => ({ title: attachmentDisplay(x).name, text: attachmentNote(x) }))];
    $("whyList").innerHTML = items.map(x => `<div class="why-item"><strong>${escapeHtml(x.title)}</strong><span>${escapeHtml(x.text)}</span></div>`).join("");
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

  /** "A" or "An" for a display noun; SMG/LMG read as initialisms. */
  function article(word) {
    const w = String(word || "").trim();
    return /^[AEIOU]/i.test(w) || /^(SMG|LMG|RPG)/.test(w) ? "An" : "A";
  }

  function renderCompleteLoadout(roster) {
    const key = selectedClass(roster);
    const c = LOADOUT.classes[key];
    if (!c) return;
    const path = [...(c.paths || [])].sort((a, b) => scoreLoadoutItem(b) - scoreLoadoutItem(a))[0];
    const gadgets = chooseTwoGadgets(c);
    const throwable = [...(c.throwables || [])].sort((a, b) => scoreLoadoutItem(b) - scoreLoadoutItem(a))[0];

    // REDSEC does not use a Multiplayer-style pre-match loadout: EA state the
    // player picks Class, Training Path, sidearm and melee in the infiltration
    // helicopter, and loots primaries and gadgets in-match. Only the genuinely
    // selectable items are shown, so the app never implies an illegal loadout.
    const redsec = state.gameMode === "redsec";
    const lo = state.redsecModel?.loadout;
    $("classTitle").textContent = redsec ? `${c.name} pre-drop setup` : `${c.name} complete loadout`;
    document.querySelector(".full-loadout-card .kicker").textContent = redsec ? "PRE-DROP LOADOUT" : "COMPLETE LOADOUT";
    $("classFit").textContent = state.classChoice === "auto" ? "AUTO BEST FIT" : "MANUAL CLASS";
    const pills = redsec
      ? [["CLASS", c.name], ["TRAINING PATH", path?.name || "—"], ["SIGNATURE TRAIT", c.signatureGadget]]
      : [
        ["CLASS", c.name], ["TRAINING", path?.name || "—"], ["SIGNATURE", c.signatureGadget],
        ["GADGET 1", gadgets[0]?.name || "—"], ["GADGET 2", gadgets[1]?.name || "—"], ["THROWABLE", throwable?.name || "—"]
      ];
    $("loadoutLine").innerHTML = pills.map(([k, v]) => `<div class="loadout-pill"><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></div>`).join("");

    // One headline sentence, then one dense row per item. The same information
    // as before in roughly a third of the vertical space.
    const matches = c.signatureCategory === roster.cls;
    const headline = redsec
      ? `${c.name} + ${path?.name || "its default training"}. In REDSEC you drop with a sidearm and melee only and loot your primary, so this is what you actually pick in the helicopter. ` +
        (matches
          ? `${article(c.name)} ${c.name} class chest most often yields ${article(c.signatureCategory).toLowerCase()} ${c.signatureCategory}, which is exactly what ${roster.name} is — so this class is the most likely way to end up holding it.`
          : `Class chests for ${c.name} favour ${c.signatureCategory}s, so ${roster.name} will usually come from world loot, a mission reward or a custom weapon drop rather than your class chest.`)
      : (matches
        ? `${c.name} + ${path?.name || "its default training"} — ${c.weaponBenefit} That lines up directly with ${roster.name}.`
        : `${c.name} + ${path?.name || "its default training"} — ${c.weaponBenefit} ${c.role}`);
    const lead = $("loadoutWhy");
    if (lead) lead.textContent = headline;

    const rows = (redsec
      ? [
        [path?.name, path?.why],
        [c.signatureGadget, c.signatureTrait],
        ["Primary weapon", lo?.primaryAcquisition || "Looted in-match rather than equipped before the drop."]
      ]
      : [
        [path?.name, path?.why],
        [c.signatureGadget, c.signatureTrait],
        [gadgets[0]?.name, gadgets[0]?.why],
        [gadgets[1]?.name, gadgets[1]?.why],
        [throwable?.name, throwable?.why]
      ]).filter(([n, w]) => n && w);
    $("loadoutExplanations").innerHTML = rows.length
      ? rows.map(([n, w]) => `<div class="reason-row"><strong>${escapeHtml(n)}</strong><span>${escapeHtml(w)}</span></div>`).join("")
      : `<div class="reason-row"><strong>No per-item reasons</strong><span>The current loadout data does not record a reason for these items.</span></div>`;
  }

  function secondaryTargetDistance() {
    if (state.distance >= 70) return 10;
    if (state.distance <= 25) return 45;
    return 20;
  }

  function chooseSecondary() {
    const rawSecondaries = state.rawWeapons.filter(w => w.cls === "Sidearm" || w.cls === "Secondary");
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
    const raw = state.rawWeapons.find(w => aliasKey(w.id) === aliasKey(rec.weapon.id)) ||
      state.rawWeapons.find(w => aliasKey(w.name) === aliasKey(rec.weapon.name)) || null;
    $("secondaryTitle").textContent = rec.weapon.name;
    const target = secondaryTargetDistance();
    const secKicker = document.querySelector(".secondary-card .kicker");
    if (secKicker) secKicker.textContent = state.gameMode === "redsec" ? "STARTING SIDEARM" : "SECONDARY";
    $("secondaryWhy").textContent = state.gameMode === "redsec"
      ? `${rec.role?.why || "Selected to cover the primary weapon's weak range."} In REDSEC you drop with this and nothing else, so it is a real pre-drop choice. Build is optimized around ~${target}m.`
      : `${rec.role?.why || "Selected to cover the primary weapon's weak range."} Sidearm build is optimized around ~${target}m as a complement to your ${state.distance}m primary setup.`;

    if (!raw || !state.attachments || !state.ammo) return renderBuildPending("secondary", raw ? "Attachment/ammo feed unavailable." : "Exact sidearm attachment data unavailable.");
    try {
      // The sidearm budget is independent of the primary budget and comes from
      // the same engine rule, not a hardcoded number.
      const sidearmBudget = budgetFor(raw);
      const result = optimize(raw, target, "laserbeam");
      $("secondaryPointsUsed").textContent = result.points;
      $("secondaryPointsMeter").style.width = `${Math.min(100, result.points / sidearmBudget * 100)}%`;
      const sidearmGate = state.sidearmAudit?.pass ? ` • TTK AUDITED ${state.sidearmAudit.gameVersion}` : " • TTK AUDIT PENDING";
      const names = buildNameConfidence(result.picks);
      $("secondaryAudit").textContent = `POINT MATH PASS • ${result.points}/${sidearmBudget} • SIDEARM BUDGET${sidearmGate}${names.total ? ` • NAMES ${names.verified}/${names.total} EXACT` : ""}`;
      $("secondaryAudit").className = "audit-line ok";
      const secCtx = {
        strategy: "laserbeam", budget: sidearmBudget, distance: target,
        opticFit: result.combat?.opticFit ?? null,
        triggerTtk: result.combat?.triggerTtk ?? NaN,
        requiredId: auditedClassOptimized(raw, target)?.attachmentId || null
      };
      $("secondaryAttachmentGrid").innerHTML = result.picks.filter(x => x.id !== "none").map(o => attachmentCard(o, raw, secCtx)).join("");
      const limit = document.querySelector("#secondaryPointsUsed + span");
      if (limit) limit.textContent = `/${sidearmBudget}`;
    } catch (err) {
      renderBuildPending("secondary", err.message);
    }
  }

  function renderWarnings(roster, raw) {
    const warnings = [];
    const fresh = freshnessUi();
    if (fresh.state === "verification-pending") warnings.push(`BF6 ${fresh.official} is live, while combat data is reconciled through ${fresh.verified}${fresh.blockedAt ? ` (${fresh.blockedAt} introduced combat changes that are not represented in the current dataset)` : ""}. The site keeps the last known-good calculations rather than relabelling them for the newer patch.`);
    if (fresh.state === "source-update-pending") warnings.push("A newer analyzer source snapshot was detected and is being verified. The current site stays on the last known-good snapshot until the rebuild passes.");
    if (state.source.weapons === "failed") warnings.push("Weapon stat feed is unavailable. All 63 catalog weapons remain visible, but raw stat/TTK panels are pending.");
    if (state.source.attachments === "failed" || state.source.ammo === "failed") warnings.push("Attachment or ammo feed is unavailable, so the optimizer will not fabricate a point build.");
    if (!state.combatCache) warnings.push("The exhaustive 1–300m combat cache is not ready yet. Until the GitHub audit finishes, the site falls back to the live on-demand engine and does not label results as exhaustive meta.");
    const classAudit = auditForClass(roster.cls);
    if (roster.cls === "Assault Rifle" && classAudit?.pass) warnings.push("ASSAULT AUDIT PASS: base chest damage/BTK/TTK were independently checked across 1–300m for all 11 Assault Rifles. M16A4 A3 full-auto is tracked separately from base burst TTK.");
    if (roster.cls === "Carbine" && classAudit?.pass) warnings.push("CARBINE AUDIT PASS: base chest damage/BTK/TTK were independently checked across 1–300m for all 9 Carbines, including BROD 3.");
    if (roster.cls === "SMG" && classAudit?.pass) warnings.push("SMG AUDIT PASS: base chest damage/BTK/TTK were independently checked across 1–300m for all 10 current SMGs. Burst-mode attachments remain excluded from verified TTK until their cadence is independently validated.");
    if (roster.cls === "LMG" && classAudit?.pass) warnings.push("LMG AUDIT PASS: base chest damage/BTK/TTK were independently checked across 1–300m for all 10 current LMGs. M250 no-falloff and the newer M121 A2/RPK-74M breakpoints are explicitly verified.");
    if (roster.cls === "DMR" && classAudit?.pass) warnings.push("DMR RECHECK PASS: mechanical TTK is independently verified across 1–300m. The site now separates first-hit→kill MECH TTK from distance-sensitive TRIGGER→KILL so projectile travel is not silently omitted.");
    if (roster.cls === "Sniper Rifle" && classAudit?.pass) warnings.push("SNIPER AUDIT PASS: all 6 current sniper rifles were checked at every meter from 1–300m using linear sweet-spot damage and audited effective bolt cadence. No guessed Recon rechamber multiplier is applied.");
    if (!classAudit) warnings.push(`${roster.cls} TTK audit is still pending. Values remain visible for testing, but this class is not yet allowed into the cross-class verified meta.`);
    const ver = sourceVersion(raw);
    if (ver && ver !== CURRENT.liveVersion) {
      if (classAudit?.pass) warnings.push(`Raw analyzer provenance reports ${ver}, but ${roster.cls} chest damage/BTK/TTK has been independently audited for live ${CURRENT.liveVersion}. Non-lethality mechanics remain source-version sensitive.`);
      else warnings.push(`This weapon's damage provenance reports ${ver}; live BF6 is ${CURRENT.liveVersion}. Use the recommendation as version-sensitive, not guaranteed current meta.`);
    }
    if (roster.id === "interdictor" && state.sniperAudit?.pass) warnings.push("INTERDICTOR: TTK is available from an empirical-current model constrained to current 31 RPM / 732 m/s / 150 max damage and observed 106–164m chest OHK plus 120–150m all-body OHK. Its raw attachment/recoil model is still pending, so no fabricated Pick-100 build is shown.");
    if (roster.id === "miniscout" && state.sniperAudit?.pass) warnings.push("MINI SCOUT CADENCE: the audit adds EA's official +100ms minimum time between shots to the upstream 51-RPM nominal interval, producing about 47 effective RPM for TTK.");
    if (roster.id === "ef88") warnings.push("1.4.2.5 rule: Match Trigger must not alter EF88 full-auto fire rate; the verified optimizer excludes any source interpretation that does.");
    if (roster.id === "brod3") warnings.push("1.4.2.5 rule: Match Trigger must not alter BROD 3 full-auto fire; the Carbine audit fails closed if a source claims otherwise.");
    if (roster.id === "grtcps" && state.dmrAudit?.pass) warnings.push("GRT-CPS VERIFIED: current upstream and independent checks agree on 4 BTK / 500ms mechanical chest TTK. The old stale-3-BTK warning is retired.");
    if (roster.id === "vssm" && state.dmrAudit?.pass) warnings.push("VSSM BALLISTICS PENDING: 800-RPM Folding Stock mechanical TTK is verified, but the upstream verified projectile-drag list does not yet include VSSM. TRIGGER→KILL is therefore shown only as a no-drag lower bound (≥), not a fabricated exact value.");
    if (roster.id === "vssm" && state.dmrAudit?.pass) warnings.push("VSSM FOLDING STOCK: 40 points, verified full-auto conversion at 800 RPM. The optimized TTK shown by this site is tied to that exact attachment and the recommended build is required to include it.");
    const card = $("warningCard");
    if (!warnings.length) { card.classList.add("hidden"); card.innerHTML = ""; return; }
    card.classList.remove("hidden");
    card.innerHTML = `<strong>DATA CHECK:</strong> ${warnings.map(escapeHtml).join(" ")}`;
  }

  function renderRangeNote(roster) {
    const note = roster.officialRange;
    const empirical = roster.empiricalRange;
    const el = $("officialRangeNote");
    if (Array.isArray(empirical) && empirical.length === 2) {
      const inRange = state.distance >= empirical[0] && state.distance <= empirical[1];
      const chest = Array.isArray(roster.chestRange) ? ` Chest one-shot testing currently spans ${roster.chestRange[0]}–${roster.chestRange[1]}m.` : "";
      el.innerHTML = `<strong>LIVE RANGE NOTE:</strong> ${escapeHtml(roster.name)} currently shows an all-body one-shot window around ${empirical[0]}–${empirical[1]}m.${chest} ${inRange ? "Your selected distance is inside the all-body window." : "Your selected distance is outside the all-body window."}`;
    } else if (Array.isArray(note) && note.length === 2) {
      const inRange = state.distance >= note[0] && state.distance <= note[1];
      if (roster.cls === "Sniper Rifle") {
        el.innerHTML = `<strong>ONE-SHOT SWEET SPOT: ${note[0]}–${note[1]}m</strong> • ${escapeHtml(roster.name)} can cross into a 1-shot chest window here, so TTK can drop sharply even though closer is normally easier. ${inRange ? "YOUR TARGET IS INSIDE THE SWEET SPOT." : "Your target is outside the sweet spot."}`;
      } else {
        el.innerHTML = `<strong>EA RANGE NOTE:</strong> ${escapeHtml(roster.name)} is described as strongest around ${note[0]}–${note[1]}m. ${inRange ? "Your selected distance is inside that window." : "Your selected distance is outside that window."}`;
      }
    } else {
      // No range-specific finding exists for this weapon. The distance control
      // already explains that presets are shortcuts, so nothing is repeated here.
      el.textContent = "";
    }
  }

  // ===========================================================================
  // LEVEL 2 — THE ANSWER
  // The result section states what to use before any diagnostics. Every value
  // here comes from live application state; nothing is hardcoded.
  // ===========================================================================

  function fmtDamage(v) {
    if (!Number.isFinite(Number(v))) return "—";
    const n=Number(v);
    return n.toFixed(n%1?1:0);
  }

  function fmtMs(v) {
    return Number.isFinite(Number(v)) ? `${Math.round(Number(v))} ms` : "—";
  }

  function scopeLabel() {
    return state.category === "__all__"
      ? (state.selectionMode === "manual" ? "ALL PRIMARIES" : "ALL VERIFIED CLASSES")
      : tabLabel(state.category).toUpperCase();
  }

  function priorityLabel() {
    return activePriorityKey() === "fastest" ? "FASTEST KILL" : "BALANCED";
  }

  /** Compact restatement of the inputs this result was produced from. */
  function renderInputStamp() {
    const el = $("inputStamp");
    if (!el) return;
    el.textContent = `${state.selectionMode === "manual" ? "BUILD MY GUN" : "AUTO META"} • ${scopeLabel()} • ${priorityLabel()}`;
  }

  function renderAnswerHeadline(roster, ranked) {
    const scopeEl = $("resultScope"), nameEl = $("resultWeapon"), subEl = $("resultSubline");
    if (!scopeEl || !nameEl || !subEl) return;
    if (!roster) {
      scopeEl.textContent = "RESULT";
      nameEl.textContent = "—";
      subEl.textContent = "Weapon data is not available yet.";
      return;
    }
    nameEl.textContent = roster.name;
    if (state.selectionMode === "manual") {
      scopeEl.textContent = state.gameMode === "redsec" ? "YOUR WEAPON TO SEEK" : "YOUR WEAPON";
      subEl.textContent = `${roster.cls} • ${scenarioLabel()} • this weapon stays locked`;
      return;
    }
    scopeEl.textContent = state.gameMode === "redsec" ? "BEST WEAPON TO SEEK" : "BEST WEAPON";
    const rank = ranked.findIndex(x => x.roster.id === roster.id);
    const scope = state.category === "__all__" ? "weapon" : `${tabLabel(state.category).toLowerCase()}`;
    subEl.textContent = ranked.length && rank === 0
      ? `Best ${scope} out of ${ranked.length} ranked • ${scenarioLabel()}`
      : `${roster.cls} • ${scenarioLabel()}`;
  }

  /**
   * The six metrics a player actually decides on. Deeper telemetry stays
   * available under Advanced Stats rather than crowding the answer.
   */
  function renderKeyStats(roster, raw, resolved) {
    const box = $("keyStats");
    if (!box) return;
    const c = resolved?.combat;
    if (!c) {
      box.innerHTML = `<div class="key-stat wide"><span>DATA STATUS</span><strong>PENDING</strong><small>No combat values are fabricated when the audited model is unavailable.</small></div>`;
      return;
    }
    const velocity = Number(resolved.displayVelocity);
    // Prefer the winning build's transformed stats when the exhaustive cache is
    // active, then the combat row, then base weapon data. All already computed.
    const stats = resolved.cachedStats;
    const rpmRaw = stats?.rpm ?? c.rpm ?? raw?.rpm ?? resolved.auditDef?.rpm;
    const rpm = Number.isFinite(Number(rpmRaw)) ? Number(rpmRaw) : null;
    const mag = stats?.mag ?? c.mag ?? raw?.mag ?? resolved.auditDef?.mag ?? null;
    const damageLabel = c.pellets > 1 ? "MAX SHELL" : "DAMAGE";
    const rows = [
      ["TRIGGER→KILL", fmtMs(c.triggerTtk), `trigger pull → lethal impact at ${state.distance}m`, "lead"],
      ["BTK", c.btk ?? "—", "bullets to kill • 100 HP unarmored"],
      [damageLabel, fmtDamage(c.damage), c.pellets > 1 ? `${fmtDamage(c.pelletDamage)} × ${c.pellets} pellets` : `per shot at ${state.distance}m`],
      ["VELOCITY", Number.isFinite(velocity) ? `${Math.round(velocity)} m/s` : "—", Number.isFinite(Number(c.flightMs)) ? `${Math.round(c.flightMs)} ms flight` : "projectile timing pending"],
      ["RPM", rpm == null ? "—" : (Math.abs(rpm - Math.round(rpm)) > .05 ? rpm.toFixed(1) : String(Math.round(rpm))), roster.cls === "Sniper Rifle" ? "effective follow-up cadence" : "rounds per minute"],
      ["MAGAZINE", mag ?? "—", "rounds"]
    ];
    box.innerHTML = rows.map(([k, v, sub, cls]) => `<div class="key-stat ${cls || ""}"><span>${escapeHtml(k)}</span><strong>${escapeHtml(String(v))}</strong><small>${escapeHtml(sub)}</small></div>`).join("");
  }

  /**
   * Makes the effect of the optimize-priority visible even when the winner does
   * not move, so a correctly-wired control never looks like a dead one. Every
   * number shown is read from the two rankings the engine actually produced.
   */
  function renderPriorityDelta(roster, ranked, buildResult) {
    const el = $("priorityDelta");
    if (!el) return;
    if (state.selectionMode === "manual" || state.priority === "auto" || !ranked.length) { el.textContent = ""; el.className = "priority-delta"; return; }

    const other = state.priority === "fastest" ? "balanced" : "fastest";
    const keep = state.priority;
    let otherRanked = [];
    let otherBuild = null;
    try {
      state.priority = other;
      otherRanked = rankWeapons(state.category, state.distance);
      const raw = rawForRoster(roster);
      if (raw && state.attachments && state.ammo) { try { otherBuild = optimize(raw, state.distance, activeStrategy()); } catch (_) { otherBuild = null; } }
    } finally { state.priority = keep; }

    const otherLabel = other === "fastest" ? "Fastest kill" : "Balanced";
    const mine = ranked[0], theirs = otherRanked[0];
    if (!theirs) { el.textContent = ""; return; }

    const bits = [];
    if (mine.roster.id !== theirs.roster.id) {
      bits.push(`Different best weapon: ${mine.roster.name} instead of ${theirs.roster.name} under ${otherLabel}.`);
      const a = Number(mine.combat?.triggerTtk), b = Number(theirs.combat?.triggerTtk);
      if (Number.isFinite(a) && Number.isFinite(b)) bits.push(`${Math.round(a)} ms to kill versus ${Math.round(b)} ms.`);
    } else {
      bits.push(`Same best weapon — ${mine.roster.name} still leads.`);
      const a = Number(mine.combat?.triggerTtk), b = Number(theirs.combat?.triggerTtk);
      if (Number.isFinite(a) && Number.isFinite(b) && Math.round(a) !== Math.round(b)) {
        bits.push(`Its kill time moved ${Math.round(b)} ms → ${Math.round(a)} ms.`);
      }
      const orderA = ranked.slice(0, 5).map(x => x.roster.id).join(",");
      const orderB = otherRanked.slice(0, 5).map(x => x.roster.id).join(",");
      if (orderA !== orderB) {
        const gained = ranked.slice(1, 5).find(x => {
          const was = otherRanked.findIndex(y => y.roster.id === x.roster.id);
          const now = ranked.findIndex(y => y.roster.id === x.roster.id);
          return was === -1 || now < was;
        });
        bits.push(gained ? `The order below it changed — ${gained.roster.name} moved up.` : "The order below it changed.");
      } else if (buildResult && otherBuild) {
        const pa = buildResult.picks.filter(x => x.id !== "none").map(x => x.id).sort().join("|");
        const pb = otherBuild.picks.filter(x => x.id !== "none").map(x => x.id).sort().join("|");
        if (pa !== pb) bits.push("Its attachment build changed.");
        else bits.push("Nothing changed here — the same build already wins both ways at this distance.");
      } else {
        bits.push("Nothing changed here — the same build already wins both ways at this distance.");
      }
    }
    el.textContent = bits.join(" ");
    el.className = "priority-delta shown";
  }

  /** Data-confidence chip for the whole recommendation. Never hides uncertainty. */
  function renderConfidence(resolved, buildResult) {
    const chip = $("confidenceChip");
    if (!chip) return;
    const names = buildNameConfidence(buildResult?.picks || []);
    const exhaustive = buildResult?.exhaustive === true;
    const audited = resolved?.classAudit?.pass === true;
    const empirical = resolved?.auditDef?.confidence === "empirical-current";
    const armored = state.gameMode === "redsec" && state.targetArmor === "plates2";
    const deps = resolved?.deps ?? null;
    let level, text;
    if (!resolved?.combat) { level = "bad"; text = "UNVERIFIED — NO AUDITED MODEL"; }
    else if (state.gameMode === "redsec" && !state.redsecModel) { level = "bad"; text = "UNVERIFIED — REDSEC MODEL NOT LOADED"; }
    // Confidence reflects the mechanics this specific result actually depends
    // on, not a blanket label applied to every REDSEC scenario.
    // Robust means BOTH: this weapon's own numbers hold under the unpublished
    // mechanics, AND (in AUTO META) the engine would still pick this weapon.
    else if (armored && ((deps && !deps.robust) || redsecWinnerStable() === false)) {
      level = "warn"; text = "PROVISIONAL REDSEC RANKING";
    }
    else if (armored) { level = "ok"; text = "REDSEC — ROBUST TO ARMOUR UNCERTAINTY"; }
    // A missing build is not the same as a non-exhaustive one. Reporting a
    // failed build as "cache pending" told the user a data-freshness story for
    // what was actually a build failure.
    else if (!buildResult) { level = "bad"; text = "NO BUILD PRODUCED"; }
    else if (!exhaustive) { level = "warn"; text = "FALLBACK — EXHAUSTIVE BUILD CACHE PENDING"; }
    else if (!audited || empirical) { level = "warn"; text = "PARTIALLY VERIFIED — CLASS AUDIT INCOMPLETE"; }
    else if (names.level === "VERIFIED") { level = "ok"; text = "VERIFIED"; }
    else if (names.level === "UNVERIFIED" && names.cls === "bad") { level = "bad"; text = "PARTIALLY VERIFIED — NAME CONFLICT"; }
    // "SOURCED", not "EXACT": names.verified counts SOURCE_CORROBORATED as well
    // as GAME_VERIFIED_EXACT, and the audit's own status definitions say a
    // source-corroborated string is explicitly NOT an exact in-game claim.
    // Saying EXACT here asserted a confidence the data does not carry.
    else { level = "warn"; text = `PARTIALLY VERIFIED — ${names.verified}/${names.total} NAMES SOURCED`; }
    // A build can only ever be downgraded here, never upgraded: if it contains
    // attachments whose modifiers upstream marks as assumed, the headline must
    // not read as fully verified.
    const assumed = assumedPicksIn(rawForRoster(rosterWeapon()), buildResult?.picks || []);
    if (assumed.length && level === "ok") {
      level = "warn";
      text = `PARTIALLY VERIFIED — ${assumed.length} ASSUMED MODIFIER${assumed.length === 1 ? "" : "S"}`;
    }
    // END-TO-END CAP — DEPENDENCY-AWARE.
    //
    // Everything above judges the ALGORITHM: is this the best legal build, is
    // the armour maths robust, are the names sourced. None of it judges the
    // FACTS the algorithm consumed for THIS weapon specifically. A blanket cap
    // whenever any weapon anywhere had stale data would downgrade every other
    // weapon's result over a fact that cannot touch it. Instead this weapon's
    // own override (from data/source-verification.json, computed only for
    // weapons whose own result-affecting fields carry an unresolved
    // current-patch delta) is consulted; a weapon with no override has none -
    // its result is not capped merely because some OTHER weapon's data is
    // stale. This can only ever downgrade.
    const sv = state.sourceVerification;
    const weaponId = rosterWeapon()?.id ?? null;
    const override = sv?.weaponOverrides?.[weaponId] ?? null;
    // Always disclosed when present, not only when it would be the sole reason
    // for a downgrade: a weapon already PARTIALLY VERIFIED for its attachment
    // names must not have its separate source-data problem silently absorbed
    // into that other warning. Never upgrades severity past what it already is.
    if (override) {
      if (level === "ok") level = "warn";
      text = `${text} — SOURCE DATA ${override.status}`;
    }
    const sourceNote = !sv
      ? " Source-data verification state unavailable."
      : override
        ? ` Source data for this weapon: ${override.status} (${override.fields.join(", ")}). ${(override.reasons || []).join("; ")}.`
        : ` Source data for this weapon: current. Checked against the full patch-delta ledger through ${sv.liveGameVersion ?? "the live game version"}; no unresolved delta names it.`;

    chip.textContent = text;
    chip.className = `confidence-chip ${level}`;
    const assumedNote = assumed.length
      ? ` Build contains ${assumed.map(a => `${a.id} (${a.fields.join(", ") || "assumed"})`).join("; ")}: upstream marks these modifier fields as assumed rather than measured, so they are stripped before any calculation. The attachment's verified modifiers are used in full; its behaviour is simply not completely characterised.`
      : "";
    chip.title = (names.total ? `${names.verified}/${names.total} attachment names carried verbatim from trusted BF6 source data. ${names.exact ?? 0} confirmed against the live in-game string.` : "") + assumedNote + sourceNote;

    const legend = $("nameLegend");
    if (legend) {
      legend.innerHTML = names.total
        ? `Attachment names: <b>${names.verified}/${names.total}</b> carried verbatim from verified BF6 source data. None are yet confirmed against the live in-game string, and category/tier labels are marked as such. Names are never cleaned up or guessed. <b>Name confidence does not change the build:</b> candidates, modifiers, point costs and ranking are identical either way.`
        : "";
    }
  }

  /** Runners-up only. Rank #1 is the answer above and is not repeated here. */
  function renderAlternatives(ranked, roster) {
    const box = $("alternativesList");
    const card = $("alternativesCard");
    const title = $("alternativesTitle");
    if (!box || !card) return;
    if (state.selectionMode === "manual") {
      card.classList.add("hidden");
      box.innerHTML = "";
      return;
    }
    card.classList.remove("hidden");
    const others = ranked.filter(x => x.roster.id !== roster?.id).slice(0, 4);
    if (title) title.textContent = `Next best at ${state.distance}m`;
    if (!others.length) {
      box.innerHTML = `<div class="alt-row empty"><strong>No alternatives available</strong><span>Only one weapon currently qualifies for this ranking scope.</span></div>`;
      return;
    }
    box.innerHTML = others.map((x, i) => {
      const t = Number(x.combat?.triggerTtk);
      return `<button type="button" class="alt-row" data-alt-weapon="${escapeHtml(x.roster.id)}">
        <span class="alt-rank">#${i + 2}</span>
        <span class="alt-name"><strong>${escapeHtml(x.roster.name)}</strong><small>${escapeHtml(x.roster.cls)}</small></span>
        <span class="alt-metric"><strong>${fmtMs(t)}</strong><small>trigger→kill ↓</small></span>
        <span class="alt-metric"><strong>${x.combat?.btk ?? "—"}</strong><small>BTK ↓</small></span>
        <span class="alt-metric"><strong>${Number.isFinite(Number(x.beamIndex)) ? Number(x.beamIndex).toFixed(2) : "—"}</strong><small>beam index ↓</small></span>
        <span class="alt-metric"><strong>${Number.isFinite(Number(x.laserScore)) ? Math.round(x.laserScore) : "—"}</strong><small>laser score ↑</small></span>
      </button>`;
    }).join("");
  }

  /** Plain-language reason built only from factors the result actually shows. */
  function whySummary(roster, resolved, buildResult, ranked) {
    const c = resolved?.combat;
    if (!roster || !c) return "No recommendation is available yet, so no explanation is claimed.";
    const bits = [];
    const t = Number(c.triggerTtk);
    if (state.selectionMode === "manual") {
      bits.push(`You locked ${roster.name}, so the engine optimized only its legal attachments for ${state.distance}m.`);
    } else {
      const rank = ranked.findIndex(x => x.roster.id === roster.id);
      if (rank === 0 && ranked.length > 1) {
        const runnerUp = Number(ranked[1]?.combat?.triggerTtk);
        const beat = Number.isFinite(t) && Number.isFinite(runnerUp) && runnerUp > t
          ? `reaching a lethal hit ${Math.round(runnerUp - t)} ms sooner than ${ranked[1].roster.name}`
          : `winning on the combined kill-speed and control score against ${ranked[1].roster.name}`;
        bits.push(`At ${state.distance}m, ${roster.name} wins by ${beat}.`);
      } else {
        bits.push(`${roster.name} is the current selection at ${state.distance}m.`);
      }
    }
    if (Number.isFinite(t)) bits.push(`It needs ${c.btk} hit${c.btk === 1 ? "" : "s"} and ${Math.round(t)} ms from trigger pull to lethal impact${Number.isFinite(Number(c.flightMs)) ? `, including ${Math.round(c.flightMs)} ms of projectile flight` : ""}.`);
    const beam = Number(resolved.cached?.beamIndex ?? c.beamIndex);
    if (Number.isFinite(beam)) {
      const pool = ranked.map(x => Number(x.beamIndex)).filter(Number.isFinite);
      const better = pool.filter(v => v > beam).length;
      if (pool.length > 1) bits.push(`Its recoil and spread behaviour is steadier than ${better} of the other ${pool.length - 1} ranked weapons at this distance (beam index ${beam.toFixed(2)}, lower is better).`);
    }
    if (buildResult?.exhaustive) {
      const fit = Number(c.opticFit);
      bits.push(`The ${buildResult.points}-point build shown is the verified exhaustive winner for this exact distance${Number.isFinite(fit) ? `, using a sight rated ${Math.round(fit)}/100 for ${state.distance}m` : ""}.`);
    } else if (buildResult) {
      bits.push(`The ${buildResult.points}-point build is an on-demand result; the exhaustive attachment cache has not validated, so it is not called a verified winner.`);
    }
    return bits.join(" ");
  }

  // ===========================================================================
  // INPUT CONTROLS
  // ===========================================================================

  function renderGameMode() {
    const redsec = state.gameMode === "redsec";
    document.querySelectorAll("#gameModeGroup button[data-gamemode]").forEach(b => {
      const on = b.dataset.gamemode === state.gameMode;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    const block = $("armorBlock");
    if (block) block.hidden = !redsec; // armour is a REDSEC-only concept
    document.querySelectorAll("#armorGroup button[data-armor]").forEach(b => {
      const on = b.dataset.armor === state.targetArmor;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    const note = $("gameModeNote");
    if (note) note.textContent = redsec
      ? "Battle royale rules: targets can carry armour plates."
      : "Standard Battlefield 6 multiplayer soldier.";
    const anote = $("armorNote");
    if (anote) {
      const pool = state.redsecModel?.armor?.battleRoyale;
      anote.textContent = state.targetArmor === "plates2" && pool
        ? `${pool.plates} plates x ${pool.hpPerPlate} HP = ${pool.totalHp} HP of armour on top of soldier health.`
        : "Soldier health only — plates already broken.";
    }
    const chip = $("scenarioChip");
    if (chip) {
      chip.textContent = scenarioLabel();
      chip.className = `scenario-chip ${redsec ? "redsec" : "mp"}`;
    }
  }

  /** Compact armour summary. Shot-by-shot detail stays in Advanced Stats. */
  function renderArmorSummary(resolved) {
    const box = $("armorSummary");
    if (!box) return;
    const am = resolved?.combat?.armorModel;
    if (state.gameMode !== "redsec" || state.targetArmor !== "plates2" || !am) { box.innerHTML = ""; box.className = "armor-summary"; return; }
    box.className = "armor-summary shown";
    // Armour damage is shown next to health damage on purpose. Without it the
    // panel reads as a contradiction: the headline damage metric is the SOLDIER
    // HEALTH figure, so "17.1 damage" beside "80 armour HP" and "6 shots to
    // break" looks like arithmetic that does not work. Armour uses its own
    // damage curve and its own class multiplier, and that is the number the
    // break count is actually derived from.
    const mult = Number(am.armorChestMultiplier);
    const multNote = Number.isFinite(mult) && mult !== 1
      ? ` (${am.healthDamagePerShot.toFixed(2)} x ${mult} chest-vs-armour)`
      : "";
    const spillLabel = am.spilloverPolicy === "proportional" ? "carries into health" : "does not carry into health";
    box.innerHTML =
      `<span class="armor-title">${escapeHtml(ARMOR_STATES.plates2)}</span>` +
      `<span class="armor-fact"><b>${am.armorDamagePerShot.toFixed(2)}</b><small>armour damage / shot</small></span>` +
      `<span class="armor-fact"><b>${am.healthDamagePerShot.toFixed(2)}</b><small>health damage / shot</small></span>` +
      `<span class="armor-fact"><b>${am.armorTotalHp} HP</b><small>armour (${am.plates} x ${am.hpPerPlate})</small></span>` +
      `<span class="armor-fact"><b>${am.shotsToBreakArmor}</b><small>shots to break armour</small></span>` +
      `<span class="armor-fact"><b>${am.healthBtk}</b><small>then shots to kill</small></span>` +
      `<span class="armor-fact"><b>${am.btk}</b><small>total BTK</small></span>` +
      `<span class="armor-fact armor-rule" title="${escapeHtml(`Armour damage per shot = health damage${multNote}. Leftover damage on the breaking shot ${spillLabel}; this mechanic is unpublished, so the conservative reading is used and no conversion is invented.`)}"><b>SPILLOVER: ${am.spilloverPolicy === "proportional" ? "ON" : "OFF"}</b><small>armour-break rule (unverified)</small></span>`;
  }

  /** Optional armour comparison, live-calculated, never hardcoded. */
  function renderArmorComparison(roster, raw, resolved) {
    const box = $("armorCompare");
    if (!box) return;
    const wrap = $("armorCompareWrap");
    if (wrap) wrap.hidden = state.gameMode !== "redsec";
    if (state.gameMode !== "redsec" || !raw) { box.innerHTML = ""; const l = $("armorShotLog"); if (l) l.innerHTML = ""; return; }
    const keep = state.targetArmor;
    const rows = [];
    try {
      for (const st of ["unarmored", "plates2"]) {
        state.targetArmor = st;
        clearScenarioMemo();
        const r = resolveDisplayCombat(roster, raw);
        const c = r?.combat;
        rows.push({
          label: ARMOR_STATES[st],
          btk: c?.btk ?? null,
          ttk: Number.isFinite(Number(c?.triggerTtk)) ? Math.round(Number(c.triggerTtk)) : null,
          active: st === keep
        });
      }
    } finally { state.targetArmor = keep; clearScenarioMemo(); }
    const log = $("armorShotLog");
    if (log) {
      const am = resolved?.combat?.armorModel;
      log.innerHTML = am
        ? `<p>Shot-by-shot: ${am.shotsToBreakArmor} shot${am.shotsToBreakArmor === 1 ? "" : "s"} of ${am.armorDamagePerShot.toFixed(2)} armour damage strip ${am.armorTotalHp} HP of plates, then ${am.healthBtk} shot${am.healthBtk === 1 ? "" : "s"} of ${am.healthDamagePerShot.toFixed(2)} soldier-health damage. Leftover damage from the shot that breaks armour is not carried into health: the two layers use different damage curves and no conversion rule is published, so none is invented.</p>`
        : "";
    }
    box.innerHTML = rows.map(r =>
      `<div class="armor-compare-row${r.active ? " active" : ""}"><span>${escapeHtml(r.label)}</span><strong>${r.btk ?? "—"} BTK</strong><strong>${r.ttk == null ? "—" : r.ttk + " ms"}</strong></div>`
    ).join("");
  }

  function renderModeSwitch() {
    const autoBtn=$("autoModeBtn"), manualBtn=$("manualModeBtn");
    const isManual = state.selectionMode === "manual";
    if (autoBtn) { autoBtn.classList.toggle("active", !isManual); autoBtn.setAttribute("aria-pressed", String(!isManual)); }
    if (manualBtn) { manualBtn.classList.toggle("active", isManual); manualBtn.setAttribute("aria-pressed", String(isManual)); }

    const picker=$("weaponPickerBlock");
    if (picker) picker.hidden = !isManual;
    const lockNote=$("weaponLockNote");
    if (lockNote) lockNote.textContent = isManual ? "Locked — AUTO cannot replace it" : "";

    const action=$("optimizeBtn");
    if (action) action.textContent = isManual
      ? `OPTIMIZE ${(rosterWeapon()?.name || "MY GUN").toUpperCase()}`
      : "FIND BEST LOADOUT";
  }

  function renderPriority() {
    const active = activePriorityKey();
    document.querySelectorAll("#priorityGroup button[data-priority]").forEach(b => {
      const on = b.dataset.priority === active;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    const note=$("priorityNote");
    if (note) note.textContent = active === "fastest"
      ? "Picks the quickest kill at this distance; control only breaks ties."
      : "Weighs kill speed and recoil/spread control together.";
  }

  /** Keeps every distance surface showing the one canonical value. */
  function renderDistance() {
    const slider=$("distanceSlider"), custom=$("distanceCustom"), readout=$("distanceValue");
    if (slider && Number(slider.value) !== state.distance) slider.value = state.distance;
    if (custom && document.activeElement !== custom && Number(custom.value) !== state.distance) custom.value = state.distance;
    if (readout) readout.textContent = state.distance;
    document.querySelectorAll("#distancePresets button[data-distance]").forEach(b => {
      // A preset is only "active" when the canonical distance is exactly that
      // value, so a custom distance never falsely appears to be a preset.
      const on = Number(b.dataset.distance) === state.distance;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    const label=$("distanceLabel");
    if (label) label.textContent = "Fighting distance";
  }

  /** Explains, only where it applies, why shotguns are absent from ALL VERIFIED. */
  function renderScopeNote() {
    const el = $("scopeNote");
    if (!el) return;
    const crossClass = state.selectionMode === "auto" && state.category === "__all__";
    el.textContent = crossClass
      ? "Shotguns currently rank within their own class until pellet spread/hit probability is modelled."
      : "";
    el.classList.toggle("shown", crossClass);
  }

  // ===========================================================================
  // LEVEL 3 — DATA & AUDIT
  // ===========================================================================

  function renderDataAudit() {
    const grid=$("methodGrid");
    if (grid) {
      const cache = state.combatCache;
      const primaries = CURRENT.roster.filter(w => w.cls !== "Secondary");
      const secondaries = CURRENT.roster.length - primaries.length;
      const matched = CURRENT.roster.filter(r => rawForRoster(r)).length;
      const budgetSample = rawForRoster(rosterWeapon());
      const rows = [
        ["LIVE GAME", freshnessUi().official, state.freshness?.official?.publishedDate ? `EA update published ${state.freshness.official.publishedDate}` : "Latest detected official version"],
        ["COMBAT VERIFIED", freshnessUi().verified, freshnessUi().note],
        ["UPSTREAM DECLARED BASELINE", (state.freshness?.upstream?.declaredGameVersions || []).join(", ") || "—", "What the analyzer snapshot's own metadata claims. Post-baseline deltas are proven separately below rather than trusted from this label."],
        ["FRESHNESS", String(freshnessUi().state).replaceAll("-", " ").toUpperCase(), state.freshness?.detectedAt ? `last state change ${String(state.freshness.detectedAt).slice(0, 16).replace("T", " ")} UTC` : "freshness watcher status"],
        ["CATALOG", `${CURRENT.roster.length} / ${CURRENT.rosterCount} weapons`, `${primaries.length} primaries + ${secondaries} secondaries • always visible`],
        ["STAT COVERAGE", `${matched} / ${CURRENT.roster.length}`, "weapons matched to the analyzer stat feed"],
        ["META ENGINE", cache ? `${cache.audit?.modeled ?? "—"} / ${cache.audit?.weaponsSource ?? "—"} modeled` : "FALLBACK ACTIVE", cache ? `${cache.rules?.distances?.[0] ?? 1}–${cache.rules?.distances?.[1] ?? 300}m exhaustive cache` : "exhaustive cache not validated"],
        ["PRIMARY BUDGET", `${budgetSample ? budgetFor(budgetSample) : (cache?.rules?.primaryBudget ?? 100)} points`, "hard cap enforced per build"],
        ["SECONDARY BUDGET", `${cache?.rules?.sidearmBudget ?? 60} points`, "different from primaries"],
        ["ATTACHMENT NAMES", state.nameAudit ? `${state.nameAudit.counts.SOURCE_CORROBORATED} / ${state.nameAudit.total} sourced` : "AUDIT PENDING", state.nameAudit ? `${state.nameAudit.counts.GAME_VERIFIED_EXACT} in-game confirmed • ${state.nameAudit.counts.UNVERIFIED} unverified • ${state.nameAudit.counts.INTERNAL_PLACEHOLDER} category labels • ${state.nameAudit.counts.MISMATCH} conflicts` : "naming audit not loaded"]
      ];
      grid.innerHTML = rows.map(([k, v, sub]) => `<div><span>${escapeHtml(k)}</span><strong>${escapeHtml(String(v))}</strong><small>${escapeHtml(sub)}</small></div>`).join("");
    }

    const prov=$("provenanceGrid");
    if (prov) {
      const cache = state.combatCache;
      const items = [
        ["ANALYZER SOURCE", cache?.source?.repository || "—"],
        ["UPSTREAM VERIFIED", state.freshness?.verified?.upstreamCommit ? String(state.freshness.verified.upstreamCommit).slice(0, 12) : (cache?.source?.commit ? String(cache.source.commit).slice(0, 12) : "—")],
        ["UPSTREAM OBSERVED", state.freshness?.upstream?.observedCommit ? String(state.freshness.upstream.observedCommit).slice(0, 12) : "—"],
        ["UPSTREAM DECLARED BASELINE", (state.freshness?.upstream?.declaredGameVersions || []).join(", ") || "—"],
        ["RANKING MODEL", cache?.source?.rankingModel || "fallback"],
        ["OPTIC MODEL", cache?.source?.opticModel || "—"],
        ["MANUAL BUILD MODEL", cache?.source?.manualBuildModel || "—"],
        ["CACHE GENERATED", cache?.generatedAt ? String(cache.generatedAt).slice(0, 10) : "—"],
        ["NAME AUDIT POLICY", state.nameAudit?.policyVersion || "pending"],
        ["FEED STATUS", Object.entries(state.source).filter(([, v]) => v === "failed" || v === "invalid").map(([k]) => k).join(", ") || "all sources loaded"]
      ];
      prov.innerHTML = items.map(([k, v]) => `<div class="prov"><span>${escapeHtml(k)}</span><strong>${escapeHtml(String(v))}</strong></div>`).join("");
    }

    const pl=$("patchLedger");
    if (pl) {
      const rec = state.freshness?.patchReconciliation;
      if (!rec?.patches?.length) { pl.innerHTML = ""; pl.hidden = true; }
      else {
        pl.hidden = false;
        const verdict = rec.blockedAt
          ? `Combat reconciled through ${rec.verifiedCombatVersion}. ${rec.blockedAt} introduced combat changes that are not represented in the current dataset, so the verified version stops before it.`
          : `Every official patch after the upstream baseline is reconciled through ${rec.verifiedCombatVersion}.`;
        pl.innerHTML = `<div class="stat-bars-head"><b>PATCH RECONCILIATION</b><span>${escapeHtml(verdict)}</span></div>` +
          `<div class="reason-list">${rec.patches.map(p => `<div class="reason-row"><strong>${escapeHtml(p.version)} — ${escapeHtml(p.status)}</strong><span>${p.unresolved?.length ? escapeHtml(p.unresolved.join(" • ")) : "No unresolved combat delta."}</span></div>`).join("")}</div>`;
      }
    }

    const rp=$("redsecProvenance");
    if (rp) {
      if (state.gameMode !== "redsec") { rp.innerHTML = ""; rp.hidden = true; }
      else {
        rp.hidden = false;
        const deps = state.lastDeps ?? null;
        const rows = redsecProvenance(deps);
        const verdict = state.targetArmor !== "plates2"
          ? "REDSEC unarmored reuses the verified Multiplayer soldier-health path, so no armour assumption applies to this result."
          : deps?.robust
            ? "This ranking is robust to the known armour-model uncertainty: every supported interpretation gives the same bullets to kill."
            : "This ranking depends on an unresolved armour mechanic and is shown as provisional.";
        rp.innerHTML = `<div class="stat-bars-head"><b>REDSEC MECHANIC PROVENANCE</b><span>${escapeHtml(verdict)}</span></div>` +
          `<div class="reason-list">${rows.map(([k, v, why]) => `<div class="reason-row"><strong>${escapeHtml(k)} — ${escapeHtml(v)}</strong><span>${escapeHtml(why)}</span></div>`).join("")}</div>`;
      }
    }

    const headline=$("dataAuditHeadline");
    if (headline) {
      const failed = Object.values(state.source).filter(v => v === "failed" || v === "invalid").length;
      headline.textContent = state.combatCache
        ? `Exhaustive engine active${failed ? ` • ${failed} feed issue${failed === 1 ? "" : "s"}` : ""}`
        : "Fallback engine active — exhaustive cache pending";
    }
  }

  /**
   * Preview of this weapon at the standard reference ranges. These are shortcuts
   * into the same canonical fighting distance, not a second distance setting.
   */
  function renderManualRangeProfiles() {
    const box=$("manualRangeProfiles");
    if (!box) return;
    if (state.selectionMode !== "manual") { box.classList.add("hidden"); box.innerHTML=""; return; }
    const roster=rosterWeapon(), raw=rawForRoster(roster);
    box.classList.remove("hidden");
    if (!roster || !raw) {
      box.innerHTML=`<div class="manual-range-head"><div><span>THIS WEAPON AT OTHER DISTANCES</span><strong>Build data pending</strong></div><small>${escapeHtml(roster?.name || "Weapon")} is locked, but exact attachment data is unavailable.</small></div>`;
      return;
    }
    const auditedOptAt = d => auditedClassOptimized(raw,d);
    const cards=MANUAL_RANGE_PROFILES.map(({d,label})=>{
      const req=auditedOptAt(d)?.attachmentId || null;
      const result=cachedBuild(raw,d,req,"lethal");
      if (!result?.combat) {
        return `<button type="button" class="range-build pending ${state.distance===d?"active":""}" data-profile-distance="${d}"><span>${label}</span><strong>${d}m</strong><b>BUILD CACHE PENDING</b><small>Jump the fighting distance here</small></button>`;
      }
      const c=result.combat;
      const names=result.picks.filter(x=>x.id!=="none").slice(0,3).map(x=>attachmentDisplay(x).name).join(" • ") || "No-point baseline";
      const kill=Number.isFinite(Number(c.triggerTtk)) ? `${Math.round(c.triggerTtk)}ms kill` : `${Math.round(c.ttk||0)}ms mech`;
      const beam=Number.isFinite(Number(c.beamIndex)) ? ` • BeamIdx ${Number(c.beamIndex).toFixed(2)}↓` : "";
      const sight=result.picks.find(x=>x.slot==="sight");
      const fit=Number(c.opticFit ?? (sight ? opticRangeFit(sight.id,d) : NaN));
      const optic=sight ? attachmentDisplay(sight).name : "Optic pending";
      return `<button type="button" class="range-build ${state.distance===d?"active":""}" data-profile-distance="${d}"><span>${label}</span><strong>${d}m</strong><b>${kill}${beam}${Number.isFinite(fit)?` • Optic ${Math.round(fit)}/100`:""}</b><small>${escapeHtml(optic)} • ${escapeHtml(names)}</small></button>`;
    }).join("");
    box.innerHTML=`<div class="manual-range-head"><div><span>THIS WEAPON AT OTHER DISTANCES</span><strong>${escapeHtml(roster.name)} stays locked</strong></div><small>${state.combatCache ? "Preview of the verified range-aware lethal winner at each reference range. Selecting one moves the same fighting distance control above — it is not a separate setting." : "Range previews unlock verified winners when the exhaustive combat cache passes; your selected-distance build still works above."}</small></div><div class="manual-range-grid">${cards}</div>`;
  }

  // ===========================================================================
  // COMPOSITION
  // ===========================================================================

  function renderAll() {
    clearScenarioMemo();
    renderGameMode();
    renderModeSwitch();
    renderPriority();
    renderDistance();
    renderScopeNote();
    renderInputStamp();

    const roster = rosterWeapon();
    if (!roster) {
      renderAnswerHeadline(null, []);
      renderDataAudit();
      return;
    }
    const raw = rawForRoster(roster);
    const ranked = rankWeapons(state.category, state.distance);
    const resolved = resolveDisplayCombat(roster, raw);

    renderAnswerHeadline(roster, ranked);
    renderKeyStats(roster, raw, resolved);
    renderRangeNote(roster);
    const buildResult = renderPrimaryBuild(roster, raw, resolved, ranked);
    state.lastDeps = resolved?.deps ?? null;
    renderConfidence(resolved, buildResult);
    renderArmorSummary(resolved);
    renderArmorComparison(roster, raw, resolved);
    renderPriorityDelta(roster, ranked, buildResult);
    renderAlternatives(ranked, roster);
    renderWeaponIntel(roster, raw, resolved);
    renderManualRangeProfiles();
    renderCompleteLoadout(roster);
    renderSecondary();
    renderWarnings(roster, raw);
    renderDataAudit();
  }

  function categoryRoster() {
    return CURRENT.roster.filter(w => w.cls !== "Secondary" && (state.category === "__all__" || w.cls === state.category));
  }

  /**
   * Tab counts.
   *
   * In AUTO META a tab's number is the number of weapons that scope can actually
   * rank, taken from the same predicate the ranking itself uses. It previously
   * showed a looser "verified" count, so ALL VERIFIED could advertise 55 while
   * the result underneath said "best out of 48". The two numbers now come from
   * one function and every excluded weapon carries a deterministic reason,
   * surfaced on the tab's tooltip.
   *
   * BUILD MY GUN deliberately opens the entire catalogue, so there the counts
   * stay the full roster counts.
   */
  function tabScopeCount(category) {
    if (state.selectionMode === "manual") {
      const n = category === "__all__"
        ? CURRENT.roster.filter(w => w.cls !== "Secondary").length
        : CURRENT.roster.filter(w => w.cls === category).length;
      return { count: n, excluded: [] };
    }
    try {
      const r = rankScopeReport(category, state.distance);
      return { count: r.rankable, excluded: r.excluded };
    } catch (_) {
      const n = category === "__all__"
        ? CURRENT.roster.filter(w => w.cls !== "Secondary").length
        : CURRENT.roster.filter(w => w.cls === category).length;
      return { count: n, excluded: [] };
    }
  }

  const EXCLUSION_LABEL = {
    "empirical-current-not-verified": "not verified (empirical-current data)",
    "class-excluded-from-cross-class": "class excluded from cross-class ranking",
    "ballistics-not-exact": "no verified projectile ballistics",
    "no-class-audit": "no audited class model",
    "incomplete-combat-values": "incomplete combat values",
    "no-combat-row": "no combat row at this distance"
  };

  function exclusionTitle(excluded) {
    if (!excluded?.length) return "";
    const by = new Map();
    for (const e of excluded) {
      const k = EXCLUSION_LABEL[e.reason] || e.reason;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(e.name);
    }
    return [...by].map(([k, v]) => `${v.join(", ")} — ${k}`).join(" | ");
  }

  function populateTabs() {
    const tabs = $("weaponTabs");
    // BUILD MY GUN opens the whole catalogue; AUTO META's cross-class scope is
    // restricted to classes eligible for verified cross-class ranking.
    const allLabel = state.selectionMode === "manual" ? "ALL" : "ALL VERIFIED";
    const allScope = tabScopeCount("__all__");
    const allTitle = exclusionTitle(allScope.excluded);
    const all = `<button type="button" data-category="__all__" class="${state.category === "__all__" ? "active" : ""}" aria-pressed="${state.category === "__all__"}"${allTitle ? ` title="${escapeHtml(`Excluded: ${allTitle}`)}"` : ""}>${allLabel} <em>${allScope.count}</em></button>`;
    const cats = CURRENT.primaryClasses.map(cls => {
      const scope = tabScopeCount(cls);
      const title = exclusionTitle(scope.excluded);
      const on = cls === state.category;
      return `<button type="button" data-category="${escapeHtml(cls)}" class="${on ? "active" : ""}" aria-pressed="${on}"${title ? ` title="${escapeHtml(`Excluded: ${title}`)}"` : ""}>${escapeHtml(tabLabel(cls))} <em>${scope.count}</em></button>`;
    }).join("");
    tabs.innerHTML = all + cats;
  }

  function tabLabel(cls) {
    const map = { "Assault Rifle": "Assault", Carbine: "Carbine", SMG: "SMG", LMG: "LMG", DMR: "DMR", "Sniper Rifle": "Sniper", Shotgun: "Shotgun" };
    return map[cls] || cls;
  }

  function populateWeaponSelect(keepId = null) {
    const list = categoryRoster();
    if (state.selectionMode === "manual" && keepId && !list.some(w=>w.id===keepId)) state.selectionMode="auto";
    if (state.selectionMode === "auto") resolveAutoWeapon();
    else if (keepId && list.some(w=>w.id===keepId)) state.weaponId=keepId;
    else if (!list.some(w=>w.id===state.weaponId)) state.weaponId=list[0]?.id || null;

    $("weaponSelect").innerHTML = list.map(w => {
        const raw=rawForRoster(w);
        const audited=auditedDefForRoster(w,raw);
        const suffix=raw ? "" : audited ? " • build data pending" : " • data pending";
        return `<option value="${escapeHtml(w.id)}">${escapeHtml(w.name)}${suffix}</option>`;
      }).join("");
    $("weaponSelect").value = state.weaponId || "";
  }

  /**
   * The one and only writer of the canonical fighting distance. The slider, the
   * preset shortcuts, the custom numeric input and the range previews all route
   * through here, so no second distance value can exist to drift out of sync.
   */
  function setDistance(d) {
    const next = Math.max(1, Math.min(300, Math.round(Number(d))));
    if (!Number.isFinite(next)) return;
    state.distance = next;
    clearScenarioMemo();
    if (state.selectionMode === "auto") resolveAutoWeapon();
    populateWeaponSelect(state.weaponId);
    renderAll();
  }

  function bind() {
    $("weaponTabs").addEventListener("click", e => {
      const btn = e.target.closest("button[data-category]");
      if (!btn) return;
      state.category = btn.dataset.category;
      if (state.selectionMode === "auto") {
        resolveAutoWeapon();
        populateWeaponSelect();
      } else {
        const list=categoryRoster();
        if (!list.some(w=>w.id===state.weaponId)) state.weaponId=list[0]?.id || state.weaponId;
        populateWeaponSelect(state.weaponId);
      }
      populateTabs();
      renderAll();
    });
    $("autoModeBtn")?.addEventListener("click", () => {
      state.selectionMode="auto";
      resolveAutoWeapon();
      populateTabs();
      populateWeaponSelect();
      renderAll();
    });
    $("manualModeBtn")?.addEventListener("click", () => {
      // Lock whatever weapon is currently on screen; subsequent range changes
      // optimize attachments only and never replace the gun.
      state.selectionMode="manual";
      state.category="__all__"; // BUILD MY GUN opens the entire primary catalog.
      if (!state.weaponId) state.weaponId=categoryRoster()[0]?.id || null;
      populateTabs();
      populateWeaponSelect(state.weaponId);
      renderAll();
    });
    $("manualRangeProfiles")?.addEventListener("click", e => {
      const btn=e.target.closest("button[data-profile-distance]");
      if (btn) setDistance(btn.dataset.profileDistance);
    });
    $("alternativesList")?.addEventListener("click", e => {
      const btn=e.target.closest("button[data-alt-weapon]");
      if (!btn) return;
      // Inspecting a runner-up is an explicit weapon choice, so it locks the gun
      // exactly like picking it in BUILD MY GUN would.
      state.selectionMode="manual";
      state.category="__all__";
      state.weaponId=btn.dataset.altWeapon;
      populateTabs();
      populateWeaponSelect(state.weaponId);
      renderAll();
      $("answerCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("weaponSelect").addEventListener("change", e => {
      state.selectionMode="manual";
      state.weaponId=e.target.value;
      populateWeaponSelect(state.weaponId);
      renderAll();
    });
    $("distanceSlider").addEventListener("input", e => setDistance(e.target.value));
    $("distanceCustom")?.addEventListener("input", e => {
      const v = Number(e.target.value);
      if (!Number.isFinite(v) || v < 1 || v > 300) return; // wait for a usable value
      setDistance(v);
    });
    $("distanceCustom")?.addEventListener("blur", e => { e.target.value = state.distance; });
    $("distancePresets").addEventListener("click", e => {
      const btn = e.target.closest("button[data-distance]");
      if (btn) setDistance(btn.dataset.distance);
    });
    $("gameModeGroup")?.addEventListener("click", e => {
      const btn = e.target.closest("button[data-gamemode]");
      if (!btn || btn.dataset.gamemode === state.gameMode) return;
      state.gameMode = btn.dataset.gamemode;
      // Leaving REDSEC must not strand an armour state that no longer applies.
      if (state.gameMode !== "redsec") state.targetArmor = "unarmored";
      clearScenarioMemo();
      if (state.selectionMode === "auto") resolveAutoWeapon();
      populateTabs();
      populateWeaponSelect(state.weaponId);
      renderAll();
    });
    $("armorGroup")?.addEventListener("click", e => {
      const btn = e.target.closest("button[data-armor]");
      if (!btn || btn.dataset.armor === state.targetArmor) return;
      state.targetArmor = btn.dataset.armor;
      clearScenarioMemo();
      if (state.selectionMode === "auto") resolveAutoWeapon();
      populateWeaponSelect(state.weaponId);
      renderAll();
    });
    $("priorityGroup")?.addEventListener("click", e => {
      const btn = e.target.closest("button[data-priority]");
      if (!btn) return;
      state.priority = btn.dataset.priority;
      clearScenarioMemo();
      if (state.selectionMode === "auto") resolveAutoWeapon();
      populateWeaponSelect(state.weaponId);
      renderAll();
    });
    $("classSelect").addEventListener("change", e => { state.classChoice = e.target.value; renderAll(); });
    $("contextSelect").addEventListener("change", e => { state.context = e.target.value; renderAll(); });
    $("optimizeBtn").addEventListener("click", () => {
      renderAll();
      $("answerCard")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function escapeHtml(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
  }

  // Read-only regression/diagnostics surface used by the baseline comparison
  // harness and by visual QA. It reads the same engine functions the UI uses,
  // restores every field it touches, and is never an input to ranking,
  // attachment scoring, point budgets or any displayed value.
  function loadoutSnapshot(roster) {
    if (!roster) return null;
    const key = selectedClass(roster);
    const c = LOADOUT.classes[key];
    if (!c) return null;
    const path = [...(c.paths || [])].sort((a, b) => scoreLoadoutItem(b) - scoreLoadoutItem(a))[0];
    const gadgets = chooseTwoGadgets(c);
    const throwable = [...(c.throwables || [])].sort((a, b) => scoreLoadoutItem(b) - scoreLoadoutItem(a))[0];
    return { classKey: key, className: c.name, training: path?.name ?? null, signature: c.signatureGadget ?? null, gadgets: gadgets.map(g => g?.name ?? null), throwable: throwable?.name ?? null };
  }

  function secondarySnapshot() {
    const rec = chooseSecondary();
    if (!rec) return null;
    const raw = state.rawWeapons.find(w => aliasKey(w.id) === aliasKey(rec.weapon.id)) ||
      state.rawWeapons.find(w => aliasKey(w.name) === aliasKey(rec.weapon.name)) || null;
    let build = null;
    if (raw && state.attachments && state.ammo) {
      try {
        const r = optimize(raw, secondaryTargetDistance(), "laserbeam");
        build = { points: r.points, exhaustive: !!r.exhaustive, picks: r.picks.map(p => ({ slot: p.slot, id: p.id, pts: pointCost(p) })) };
      } catch (err) { build = { error: String(err && err.message || err) }; }
    }
    return { name: rec.weapon?.name ?? null, build };
  }

  window.BF6_LAB_DIAG = {
    version: 1,
    ready: () => state.source.weapons !== "loading",
    env: () => ({
      cacheActive: !!state.combatCache,
      cacheCommit: state.combatCache?.source?.commit ?? null,
      rankingModel: state.combatCache?.source?.rankingModel ?? null,
      gameVersion: state.combatCache?.source?.gameVersion ?? null,
      modeled: state.combatCache?.audit?.modeled ?? null,
      rosterCount: CURRENT.roster.length,
      primaryCount: CURRENT.roster.filter(w => w.cls !== "Secondary").length,
      classes: CURRENT.primaryClasses.slice(),
      source: { ...state.source },
      // Which source overlays the numbers on screen actually carry, and whether
      // any change failed its baseline check. Exposed so gates can assert the
      // shipped app really applied what the overlay document declares.
      overlay: state.overlayApplication
        ? { ...state.overlayApplication, declared: state.sourceOverlay?.overlays?.map(o => ({ id: o.id, gameVersion: o.gameVersion, changes: o.changes?.length ?? 0, enabled: o.enabled !== false })) ?? [] }
        : null
    }),
    /** The effective (baseline + overlay) weapon record, for provenance gates. */
    rawWeapon: id => state.rawWeapons.find(w => w.id === id) ?? null,
    redsec: {
      model: () => state.redsecModel,
      armorCurve: weaponId => armorDamageCurve(state.rawWeapons.find(w => w.id === weaponId)),
      armorDamageAt: (weaponId, d) => armorDamageAtDistance(state.rawWeapons.find(w => w.id === weaponId), d),
      /**
       * Armoured resolution under an EXPLICIT interpretation of the two
       * mechanics EA has not published. Passing closeRange/spillover lets an
       * experiment designer compute what each competing reading predicts, which
       * is what makes an in-game discrimination test possible.
       */
      armored: (weaponId, d, armorState = "plates2", interp = {}) => {
        const raw = state.rawWeapons.find(w => w.id === weaponId);
        const keep = { g: state.gameMode, a: state.targetArmor };
        try {
          state.gameMode = "redsec"; state.targetArmor = armorState;
          const opts = { armorState };
          if (interp.closeRange) opts.closeRange = interp.closeRange;
          if (interp.spillover) opts.spillover = interp.spillover;
          return redsecArmoredCombat(raw, d, opts);
        } finally { state.gameMode = keep.g; state.targetArmor = keep.a; }
      }
    },
    /** Sensitivity across the supported interpretations of the two open mechanics. */
    redsecSensitivity(query = {}) {
      const keep = { g: state.gameMode, a: state.targetArmor, c: state.category, d: state.distance, m: state.selectionMode, p: state.priority };
      try {
        state.gameMode = "redsec"; state.targetArmor = "plates2";
        state.selectionMode = "auto";
        if (query.category != null) state.category = query.category;
        if (query.distance != null) state.distance = query.distance;
        if (query.priority != null) state.priority = query.priority;
        const combos = [];
        for (const closeRange of ["remove", "keep"]) {
          for (const spillover of ["none", "proportional"]) {
            clearScenarioMemo();
            REDSEC_OVERRIDE.closeRange = closeRange;
            REDSEC_OVERRIDE.spillover = spillover;
            const ranked = rankWeapons(state.category, state.distance);
            combos.push({
              closeRange, spillover,
              winner: ranked[0]?.roster?.id ?? null,
              winnerName: ranked[0]?.roster?.name ?? null,
              btk: ranked[0]?.combat?.btk ?? null,
              ttk: Number.isFinite(Number(ranked[0]?.combat?.triggerTtk)) ? Math.round(Number(ranked[0].combat.triggerTtk)) : null,
              top3: ranked.slice(0, 3).map(x => x.roster.id)
            });
          }
        }
        const winners = new Set(combos.map(c => c.winner));
        const top3s = new Set(combos.map(c => c.top3.join(",")));
        const btks = new Set(combos.map(c => c.btk));
        return {
          category: state.category, distance: state.distance, priority: state.priority,
          combos,
          winnerStable: winners.size === 1,
          top3Stable: top3s.size === 1,
          btkStable: btks.size === 1,
          robust: winners.size === 1 && top3s.size === 1
        };
      } finally {
        REDSEC_OVERRIDE.closeRange = null; REDSEC_OVERRIDE.spillover = null;
        state.gameMode = keep.g; state.targetArmor = keep.a; state.category = keep.c;
        state.distance = keep.d; state.selectionMode = keep.m; state.priority = keep.p;
        clearScenarioMemo();
      }
    },
    /**
     * Complete, manually reproducible REDSEC audit trail for ONE weapon at ONE
     * exact distance. Every intermediate value the armoured result depends on is
     * returned, so a reader can recompute the final BTK/TTK by hand from this
     * object alone. It calls the production combat path only; it computes
     * nothing of its own beyond restating the formulae it used.
     */
    /**
     * Optimizer primitives, so an audit can enumerate the true optimum over the
     * SAME candidate set / point costs / scores the production optimizer uses and
     * compare. Exposes the DP path explicitly because optimize() returns the
     * exhaustive cache winner when one is valid.
     */
    optimizer: {
      budget: weaponId => budgetFor(state.rawWeapons.find(w => w.id === weaponId)),
      options: (weaponId, d = 25) => {
        const raw = state.rawWeapons.find(w => w.id === weaponId);
        if (!raw) return null;
        const keep = state.distance;
        try {
          state.distance = d;
          const opts = buildOptions(raw);
          const out = {};
          for (const [slot, list] of Object.entries(opts)) {
            out[slot] = list.map(o => ({ id: o.id, name: o.name ?? null, pts: pointCost(o), score: scoreOption(o, raw, d) }));
          }
          return out;
        } finally { state.distance = keep; }
      },
      /** Production DP result, with the exhaustive cache deliberately bypassed. */
      dpBuild: (weaponId, d = 25, strategy = "laserbeam") => {
        const raw = state.rawWeapons.find(w => w.id === weaponId);
        if (!raw) return null;
        const keepCache = state.combatCache, keepD = state.distance;
        try {
          state.combatCache = null;
          state.distance = d;
          const r = optimize(raw, d, strategy);
          return { points: r.points, score: r.score, audit: r.audit, picks: r.picks.map(p => ({ slot: p.slot, id: p.id, pts: pointCost(p), score: p.score })) };
        } catch (err) {
          return { error: String(err && err.message || err) };
        } finally { state.combatCache = keepCache; state.distance = keepD; }
      },
      /** The exhaustive-cache winner for the same query, when one exists. */
      cachedBuild: (weaponId, d = 25, strategy = "laserbeam") => {
        const raw = state.rawWeapons.find(w => w.id === weaponId);
        if (!raw) return null;
        const keep = state.distance;
        try {
          state.distance = d;
          const r = cachedBuild(raw, d, null, strategy);
          if (!r) return null;
          return { points: r.points, exhaustive: !!r.exhaustive, picks: r.picks.map(p => ({ slot: p.slot, id: p.id, pts: pointCost(p) })), combat: r.combat ? { ...r.combat } : null };
        } finally { state.distance = keep; }
      }
    },

    /**
     * Drive the real render pipeline for one scenario and return the text the
     * user would actually see in the panels that carry combat meaning. Lets UI
     * regressions be caught with string assertions instead of pixel tests.
     */
    render(query = {}) {
      const keep = { c: state.category, d: state.distance, g: state.gameMode, a: state.targetArmor, m: state.selectionMode, p: state.priority, w: state.weaponId };
      try {
        clearScenarioMemo();
        if (query.gameMode != null) state.gameMode = query.gameMode;
        if (query.targetArmor != null) state.targetArmor = query.targetArmor;
        if (state.gameMode !== "redsec") state.targetArmor = "unarmored";
        if (query.category != null) state.category = query.category;
        if (query.distance != null) state.distance = Math.max(1, Math.min(300, Math.round(Number(query.distance))));
        if (query.priority != null) state.priority = query.priority;
        state.selectionMode = query.mode ?? "auto";
        if (state.selectionMode === "auto") resolveAutoWeapon();
        else if (query.weaponId != null) state.weaponId = query.weaponId;
        renderAll();
        const txt = id => String($(id)?.innerHTML ?? $(id)?.textContent ?? "");
        return {
          scenarioChip: String($("scenarioChip")?.textContent ?? ""),
          confidenceChip: String($("confidenceChip")?.textContent ?? ""),
          armorSummary: txt("armorSummary"),
          armorShotLog: txt("armorShotLog"),
          armorCompare: txt("armorCompare"),
          weaponTabs: txt("weaponTabs"),
          dashboardWeapon: String($("dashboardWeapon")?.textContent ?? ""),
          armorNote: String($("armorNote")?.textContent ?? ""),
          buildError: state.lastBuildError ? { ...state.lastBuildError } : null,
          attachmentGrid: txt("attachmentGrid"),
          nameLegend: txt("nameLegend"),
          pointAuditBadge: String($("pointAuditBadge")?.textContent ?? "")
        };
      } finally {
        state.category = keep.c; state.distance = keep.d; state.gameMode = keep.g;
        state.targetArmor = keep.a; state.selectionMode = keep.m; state.priority = keep.p;
        state.weaponId = keep.w; clearScenarioMemo();
      }
    },

    /**
     * Temporarily perturb one raw weapon field, evaluate, and restore.
     *
     * The source-data audit asserts which fields can move which outputs. This
     * lets that map be MEASURED instead: if a field the audit calls
     * result-moving can be changed with no observable effect, either the map is
     * wrong or the field is silently ignored - and both are worth knowing.
     *
     * Restores the previous value unconditionally, including on throw.
     */
    perturb(weaponId, field, value, query = {}) {
      const raw = state.rawWeapons.find(w => w.id === weaponId);
      if (!raw) return { error: "unknown weapon id" };
      const had = Object.prototype.hasOwnProperty.call(raw, field);
      const previous = raw[field];
      const keepCache = state.combatCache;
      try {
        // The exhaustive cache holds precomputed rows, so a source perturbation
        // is only observable on the on-demand path. That is also the path a
        // rebuilt cache would follow, so this measures the same dependency.
        state.combatCache = null;
        raw[field] = value;
        clearScenarioMemo();
        return this.snapshot({ mode: "manual", weaponId, ...query });
      } finally {
        if (had) raw[field] = previous; else delete raw[field];
        state.combatCache = keepCache;
        clearScenarioMemo();
      }
    },

    /**
     * Sensitivity probe on the OPERATIVE beam-index primitives.
     *
     * recoilV, recoilVar and spreadMax reach BALANCED ranking only through the
     * cached beam index, via primitives the cache builder stores alongside it:
     *
     *   recoilV   -> recoil            (and unpredictable = recoil*sin(varDeg))
     *   recoilVar -> recoilVariationDeg (and unpredictable)
     *   spreadMax -> effectiveAdsSpreadDeg
     *
     * Perturbing the raw weapon field cannot show this, because production reads
     * the precomputed cache. So this scales the stored primitive and recomputes
     * beamIndex with the EXACT production formula from build-combat-cache.mjs,
     * then re-ranks. That measures the real dependency a cache rebuild would
     * follow.
     *
     * The factor is a PROBE, not a claim about any actual change. The field ->
     * primitive relationship is monotonic but not necessarily linear (effSpread
     * comes from a spread simulation seeded by spreadMax), so a factor is
     * interpreted as "this much error in the operative primitive", not "this
     * much error in the source field".
     */
    perturbBeamPrimitive(weaponId, primitive, factor, query = {}) {
      const raw = state.rawWeapons.find(w => w.id === weaponId);
      const cw = raw ? cacheWeapon(raw) : null;
      if (!cw) return { error: "no cached weapon" };
      const touched = [];
      const recompute = row => {
        if (!row || typeof row !== "object") return;
        const recoil0 = Number(row.recoil), varDeg0 = Number(row.recoilVariationDeg);
        const eff0 = Number(row.effectiveAdsSpreadDeg), moving0 = Number(row.movingAdsMinSpreadDeg);
        if (![recoil0, varDeg0, eff0, moving0].every(Number.isFinite)) return;
        let recoil = recoil0, varDeg = varDeg0, eff = eff0;
        if (primitive === "recoil") recoil = recoil0 * factor;
        else if (primitive === "recoilVariationDeg") varDeg = Math.min(90, varDeg0 * factor);
        else if (primitive === "effectiveAdsSpreadDeg") eff = eff0 * factor;
        else return;
        const unpredictable = recoil * Math.sin(Math.min(90, varDeg) * Math.PI / 180);
        // Exact formula from scripts/build-combat-cache.mjs beamMetricsFromPrimitives().
        const rangeT = Math.min(1, Math.max(1, Number(row._d) || Number(query.distance) || 25) / 120);
        const beam = (recoil * (1.00 + 0.35 * rangeT))
          + (unpredictable * (1.25 + 0.75 * rangeT))
          + (eff * (2.00 + 2.50 * rangeT))
          + (moving0 * (0.35 + 0.65 * rangeT));
        touched.push([row, row.beamIndex]);
        row.beamIndex = +beam.toFixed(6);
      };
      try {
        for (const src of ["best", "bestLethal"]) {
          for (const [k, row] of Object.entries(cw[src] ?? {})) {
            if (row && typeof row === "object") { row._d = Number(k); recompute(row); }
          }
        }
        clearScenarioMemo();
        return this.snapshot({ ...query, mode: "auto" });
      } finally {
        for (const [row, prev] of touched) row.beamIndex = prev;
        for (const src of ["best", "bestLethal"]) {
          for (const row of Object.values(cw[src] ?? {})) { if (row) delete row._d; }
        }
        clearScenarioMemo();
      }
    },

    /** Eligibility/count reconciliation for one scope. */
    scope(query = {}) {
      const keep = { c: state.category, d: state.distance, g: state.gameMode, a: state.targetArmor, m: state.selectionMode, p: state.priority };
      try {
        clearScenarioMemo();
        if (query.gameMode != null) state.gameMode = query.gameMode;
        if (query.targetArmor != null) state.targetArmor = query.targetArmor;
        if (state.gameMode !== "redsec") state.targetArmor = "unarmored";
        if (query.category != null) state.category = query.category;
        if (query.distance != null) state.distance = Math.max(1, Math.min(300, Math.round(Number(query.distance))));
        if (query.priority != null) state.priority = query.priority;
        state.selectionMode = query.mode ?? "auto";
        return rankScopeReport(state.category, state.distance);
      } finally {
        state.category = keep.c; state.distance = keep.d; state.gameMode = keep.g;
        state.targetArmor = keep.a; state.selectionMode = keep.m; state.priority = keep.p;
        clearScenarioMemo();
      }
    },
    redsecTrace(weaponId, d, armorState = "plates2", priority = "auto") {
      const keep = { g: state.gameMode, a: state.targetArmor, d: state.distance, w: state.weaponId, m: state.selectionMode, p: state.priority };
      try {
        clearScenarioMemo();
        state.gameMode = "redsec";
        state.targetArmor = armorState;
        state.distance = Math.max(1, Math.min(300, Math.round(Number(d) || 25)));
        state.selectionMode = "manual";
        state.weaponId = weaponId;
        state.priority = priority;
        const roster = CURRENT.roster.find(w => w.id === weaponId) || null;
        const raw = state.rawWeapons.find(w => w.id === weaponId) || null;
        if (!roster && !raw) return { weaponId, error: "unknown weapon id" };
        const strategy = activeStrategy();
        const resolved = roster ? resolveDisplayCombat(roster, raw) : null;
        const c = resolved?.combat ?? null;
        const am = c?.armorModel ?? null;
        const stats = raw ? cachedWinningStats(raw, state.distance, strategy) : null;
        const rpm = Number(stats?.rpm ?? c?.rpm ?? raw?.rpm);
        const shotIntervalMs = Number.isFinite(rpm) && rpm > 0 ? 60000 / rpm : null;
        const base = raw ? combatAtDistance(raw, state.distance) : null;
        return {
          weaponId, weaponName: roster?.name ?? raw?.name ?? null,
          weaponClass: roster?.cls ?? raw?.cls ?? null,
          gameMode: "redsec", armorState, distanceM: state.distance,
          priority, strategy, scenario: scenarioKey(),
          fireMode: { declared: raw?.fireMode ?? null, effective: am?.effectiveFireMode ?? c?.effectiveFireMode ?? null },
          health: {
            poolHp: 100,
            baseDamageAt0m: Array.isArray(raw?.dmg) && raw.dmg.length ? Number(raw.dmg[0].d) : null,
            rawDamageAtDistance: base?.damage ?? null,
            damageAtDistance: c?.damage ?? null,
            curve: Array.isArray(raw?.dmg) ? raw.dmg.map(x => ({ r: Number(x.r), d: Number(x.d) })) : null
          },
          armor: am ? {
            totalHp: am.armorTotalHp, plates: am.plates, hpPerPlate: am.hpPerPlate,
            chestMultiplier: am.armorChestMultiplier,
            pellets: Math.max(1, Number(raw?.pellets) || 1),
            rangeShiftMeters: Number(redsecModel()?.damageVsArmor?.rangeShiftMeters?.value ?? NaN),
            closeRangePolicy: am.closeRangePolicy,
            spilloverPolicy: am.spilloverPolicy,
            curve: armorDamageCurve(raw, am.closeRangePolicy, am.effectiveFireMode),
            damagePerShot: am.armorDamagePerShot,
            shotsToBreakArmor: am.shotsToBreakArmor,
            carriedHealthDamage: am.carriedHealthDamage,
            healthShotsAfterBreak: am.healthBtk,
            log: am.log
          } : null,
          btk: c?.btk ?? null,
          timing: {
            rpm: Number.isFinite(rpm) ? rpm : null,
            shotIntervalMs,
            velocityMs: Number(resolved?.displayVelocity ?? stats?.bulletVel ?? raw?.bulletVel ?? NaN) || null,
            flightMs: Number.isFinite(Number(c?.flightMs)) ? Number(c.flightMs) : null,
            firingMs: c?.mechTtk ?? c?.ttk ?? null,
            mechTtk: c?.mechTtk ?? c?.ttk ?? null,
            triggerTtk: c?.triggerTtk ?? null
          },
          formula: {
            armorDamagePerShot: "healthStepDamageAt(distance, curveShiftedBy +rangeShiftMeters) * pellets * chestMultiplier",
            shotsToBreakArmor: "ceil(armorTotalHp / armorDamagePerShot)",
            healthShotsAfterBreak: "ceil(100 / healthDamageAtDistance)   [spillover=none]",
            btk: "shotsToBreakArmor + healthShotsAfterBreak",
            firingMs: "(btk - 1) * 60000 / rpm",
            triggerTtk: "firingMs + flightMs"
          },
          confidence: raw ? redsecProvenance(redsecDependencies(raw, state.distance, c)) : null
        };
      } finally {
        state.gameMode = keep.g; state.targetArmor = keep.a; state.distance = keep.d;
        state.weaponId = keep.w; state.selectionMode = keep.m; state.priority = keep.p;
        clearScenarioMemo();
      }
    },
    snapshot(query = {}) {
      const keep = { category: state.category, weaponId: state.weaponId, selectionMode: state.selectionMode, distance: state.distance, priority: state.priority, context: state.context, classChoice: state.classChoice, gameMode: state.gameMode, targetArmor: state.targetArmor };
      try {
        clearScenarioMemo();
        if (query.gameMode != null) state.gameMode = query.gameMode;
        if (query.targetArmor != null) state.targetArmor = query.targetArmor;
        if (state.gameMode !== "redsec") state.targetArmor = "unarmored";
        if (query.category != null) state.category = query.category;
        if (query.mode != null) state.selectionMode = query.mode;
        if (query.priority != null) state.priority = query.priority;
        if (query.context != null) state.context = query.context;
        if (query.classChoice != null) state.classChoice = query.classChoice;
        if (query.distance != null) state.distance = Math.max(1, Math.min(300, Math.round(Number(query.distance))));
        if (query.mode === "auto") resolveAutoWeapon();
        else if (query.weaponId != null) state.weaponId = query.weaponId;

        const ranked = rankWeapons(state.category, state.distance);
        const roster = rosterWeapon();
        const raw = rawForRoster(roster);
        const strategy = activeStrategy();
        let build = null;
        try {
          const r = raw && state.attachments && state.ammo ? scenarioBuild(raw, state.distance, strategy, optimize(raw, state.distance, strategy)) : null;
          if (r) build = {
            points: r.points,
            exhaustive: !!r.exhaustive,
            picks: r.picks.map(p => ({ slot: p.slot, id: p.id, name: p.name ?? null, pts: pointCost(p) })),
            combat: r.combat ? { ...r.combat } : null
          };
        } catch (err) { build = { error: String(err && err.message || err) }; }
        return {
          query: { ...query },
          scenario: scenarioKey(),
          gameMode: state.gameMode,
          targetArmor: state.targetArmor,
          armorModel: roster ? (resolveDisplayCombat(roster, raw)?.combat?.armorModel ?? null) : null,
          distance: state.distance,
          weaponId: state.weaponId,
          weaponName: roster?.name ?? null,
          weaponClass: roster?.cls ?? null,
          rankedCount: ranked.length,
          top: ranked.slice(0, Math.max(1, Number(query.topN) || 5)).map(x => ({
            id: x.roster.id, name: x.roster.name, cls: x.roster.cls,
            triggerTtk: x.combat?.triggerTtk ?? null, mechTtk: x.combat?.ttk ?? null,
            btk: x.combat?.btk ?? null, damage: x.combat?.damage ?? null,
            beamIndex: x.beamIndex ?? null, laserScore: x.laserScore ?? null,
            metaCost: x.metaCost ?? null, velocity: x.velocity ?? null, offPace: !!x.offPace
          })),
          build,
          loadout: loadoutSnapshot(roster),
          secondary: secondarySnapshot()
        };
      } finally {
        state.category = keep.category; state.weaponId = keep.weaponId;
        state.selectionMode = keep.selectionMode; state.distance = keep.distance;
        state.priority = keep.priority; state.context = keep.context; state.classChoice = keep.classChoice;
        state.gameMode = keep.gameMode; state.targetArmor = keep.targetArmor;
        clearScenarioMemo();
      }
    }
  };

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
    populateTabs();
    populateWeaponSelect();
    renderAll();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  init();
})();
