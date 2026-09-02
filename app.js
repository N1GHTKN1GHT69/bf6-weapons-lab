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
    // One canonical fighting distance in meters. The slider, the preset
    // shortcuts and the custom numeric input all write this single value, and
    // the optimizer always reads exactly this value. There is deliberately no
    // parallel preset/slider/optimizer distance that could drift apart.
    distance: 25,
    // "auto" keeps each mode's historical strategy default. PRIORITY only ever
    // selects between the two strategies the engine already implements.
    priority: "auto",
    classChoice: "auto",
    context: "mixed",
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
    source: { weapons: "loading", attachments: "loading", ammo: "loading", ballistics: "loading", combat: "loading", assaultAudit: "loading", carbineAudit: "loading", smgAudit: "loading", lmgAudit: "loading", dmrAudit: "loading", sniperAudit: "loading", sidearmAudit: "loading", shotgunAudit: "loading", nameAudit: "loading" }
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

  function nameRecord(opt) {
    if (!opt || !state.nameAudit) return null;
    return state.nameAudit.byKey.get(`${opt.slot}:${opt.id}`)
      ?? state.nameAudit.attachments.find(r => r.attachmentId === opt.id)
      ?? null;
  }

  const NAME_STATUS_UI = {
    VERIFIED_EXACT: { chip: "EXACT BF6 NAME", cls: "ok", note: "Exact Battlefield 6 attachment name, carried verbatim from the pinned verified source." },
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
    const name = rec.verificationStatus === "VERIFIED_EXACT" && rec.verifiedExactName ? rec.verifiedExactName : rec.currentDisplayName || fallback;
    return { name, status: rec.verificationStatus, ui: NAME_STATUS_UI[rec.verificationStatus] ?? NAME_STATUS_UI.PENDING, record: rec };
  }

  /** Build-level naming confidence. Display only; the build itself is unchanged. */
  function buildNameConfidence(picks) {
    const real = (picks || []).filter(p => p.id !== "none");
    if (!state.nameAudit) return { level: "PENDING", label: "NAME AUDIT PENDING", cls: "", verified: 0, total: real.length };
    const statuses = real.map(p => attachmentDisplay(p).status);
    const verified = statuses.filter(s => s === "VERIFIED_EXACT").length;
    if (statuses.includes("MISMATCH")) return { level: "UNVERIFIED", label: "NAME CONFLICT", cls: "bad", verified, total: real.length };
    if (!real.length || verified === real.length) return { level: "VERIFIED", label: "NAMES VERIFIED", cls: "ok", verified, total: real.length };
    if (verified === 0) return { level: "UNVERIFIED", label: "NAMES UNVERIFIED", cls: "warn", verified, total: real.length };
    return { level: "PARTIALLY_VERIFIED", label: "PARTIALLY VERIFIED", cls: "warn", verified, total: real.length };
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

  function activePriorityKey() {
    if (state.priority !== "auto") return state.priority;
    return defaultStrategy() === "lethal" ? "fastest" : "balanced";
  }

  async function loadData() {
    // Deliberately independent. One bad source must never erase the catalog or the other data.
    const [weapons, attachments, ammo, ballistics] = await Promise.all([
      loadOne("weapons"), loadOne("attachments"), loadOne("ammo"), loadOne("ballistics")
    ]);

    state.rawWeapons = Array.isArray(weapons) ? weapons : [];
    state.attachments = attachments && typeof attachments === "object" ? attachments : null;
    state.ammo = ammo && typeof ammo === "object" ? ammo : null;
    state.ballistics = ballistics && typeof ballistics === "object" ? ballistics : null;
    await Promise.all([loadCombatCache(), loadAssaultAudit(), loadCarbineAudit(), loadSmgAudit(), loadLmgAudit(), loadDmrAudit(), loadSniperAudit(), loadSidearmAudit(), loadShotgunAudit(), loadAttachmentNameAudit()]);

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
      setChip("rosterChip", `ROSTER ${CURRENT.roster.length}/${CURRENT.rosterCount} • VERIFIED ${fullyVerified}/${primaries.length}${empirical ? ` • EMPIRICAL ${empirical}` : ""}`, "ok");
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

    for (const [slot, list] of Object.entries(options)) {
      options[slot] = list.filter(opt => pointCost(opt) !== null && (!isAssumedOption(opt) || auditedAssumedException(raw, opt)));
      if (!options[slot].length) throw new Error(`${slot}: no verified point-cost choices`);
    }
    return options;
  }

  function auditedAssumedException(raw, opt) {
    // VSSM Folding Stock's lethal transform (40p, full-auto, 800 RPM) is independently
    // audited. Upstream still marks a recoil-decay sub-field as assumed, which must not
    // suppress the verified fire-mode/RPM transform itself.
    return !!(state.dmrAudit?.pass && raw?.id === "vssm" && opt?.id === "full_auto_vssm");
  }

  function isAssumedOption(opt) {
    if (!opt || typeof opt !== "object") return false;
    if (opt.assumed === true) return true;
    const fields = opt.assumedFields;
    if (Array.isArray(fields)) return fields.length > 0;
    if (fields && typeof fields === "object") return Object.keys(fields).length > 0;
    return false;
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

  function buildRankPool(category = state.category, d = state.distance) {
    return CURRENT.roster
      .filter(w => {
        if (w.cls === "Secondary") return false;
        if (category !== "__all__" && w.cls !== category) return false;
        const classAudit = auditForClass(w.cls);
        if (!classAudit) return false;
        if (auditedDefForRoster(w, rawForRoster(w))?.confidence === "empirical-current") return false;
        if (category === "__all__" && classAudit.crossClassEligible === false) return false;
        return true;
      })
      .map(roster => {
        const raw = rawForRoster(roster);
        let combat = raw ? cachedCombat(raw, d) : null;
        if (!combat) combat = auditedRosterCombat(roster, raw, d);
        if (!state.combatCache && raw) combat = auditedClassOptimized(raw, d) || combat;
        const def = auditedDefForRoster(roster, raw);
        const winStats = raw ? cachedWinningStats(raw, d) : null;
        const velocity = Number(winStats?.bulletVel ?? (roster.cls === "DMR" ? def?.equippedVelocity : null) ?? raw?.bulletVel ?? def?.bulletVel) || 0;
        if (combat && !Number.isFinite(Number(combat.triggerTtk))) combat = addTriggerKill(roster, raw, combat, d, "standard", velocity);
        const ads = Number(winStats?.adsTimeMs ?? (roster.cls === "DMR" ? def?.adsTime : null) ?? raw?.adsTime ?? def?.adsTime);
        const beamIndex = Number(combat?.beamIndex ?? winStats?.beam?.beamIndex ?? fallbackBeamIndex(raw,d));
        return { roster, raw, combat, velocity, ads:Number.isFinite(ads) ? ads : 9999, beamIndex:Number.isFinite(beamIndex)?beamIndex:null };
      })
      .filter(x => x.combat && Number.isFinite(x.combat.ttk) && Number.isFinite(x.combat.triggerTtk) && Number.isFinite(x.combat.damage))
      .filter(x => category !== "__all__" || x.combat.ballisticsExact === true);
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
    return rankedPool.sort((a,b) =>
      a.metaCost-b.metaCost ||
      (a.combat.triggerTtk??Infinity)-(b.combat.triggerTtk??Infinity) ||
      (a.beamIndex??Infinity)-(b.beamIndex??Infinity) ||
      a.combat.btk-b.combat.btk ||
      b.combat.damage-a.combat.damage ||
      b.velocity-a.velocity || a.ads-b.ads
    ).map((x,i)=>({...x,rankScore:Math.max(0,100-i)}));
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
    const displayVelocity = c ? Number(cachedStats?.bulletVel ?? (roster.cls === "DMR" ? auditDef?.equippedVelocity : null) ?? c.bulletVel ?? raw?.bulletVel ?? auditDef?.bulletVel) : NaN;
    if (c && !Number.isFinite(Number(c.triggerTtk))) c = addTriggerKill(roster, raw, c, state.distance, "standard", displayVelocity);
    return { classAudit, auditDef, audited, cached, cachedStats, optimized, displayVelocity, combat: c, strategy: detailStrategy };
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
      const result = optimize(raw, state.distance, activeStrategy());
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
      $("attachmentGrid").innerHTML = result.picks
        .filter(x => x.id !== "none")
        .map(opt => attachmentCard(opt)).join("");
      renderWhy(raw, result, roster, ranked);
      const summary = $("whySummary");
      if (summary) summary.textContent = whySummary(roster, resolved, result, ranked);
      return result;
    } catch (err) {
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
  function attachmentCard(opt) {
    const d = attachmentDisplay(opt);
    const flag = d.status === "VERIFIED_EXACT" ? "" :
      `<em class="name-flag ${d.ui.cls}" title="${escapeHtml(d.ui.note)}">${escapeHtml(d.ui.chip)}</em>`;
    return `<div class="attachment-card${d.status === "VERIFIED_EXACT" ? "" : " unverified-name"}">` +
      `<span>${escapeHtml(SLOT_LABELS[opt.slot] || opt.slot)}<b>${pointCost(opt)}p</b></span>` +
      `<strong>${escapeHtml(d.name)}</strong>${flag}` +
      `<small>${escapeHtml(attachmentNote(opt))}</small></div>`;
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
    $("secondaryWhy").textContent = `${rec.role?.why || "Selected to cover the primary weapon's weak range."} Sidearm build is optimized around ~${target}m as a complement to your ${state.distance}m primary setup.`;

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
      $("secondaryAttachmentGrid").innerHTML = result.picks.filter(x => x.id !== "none").map(attachmentCard).join("");
      const limit = document.querySelector("#secondaryPointsUsed + span");
      if (limit) limit.textContent = `/${sidearmBudget}`;
    } catch (err) {
      renderBuildPending("secondary", err.message);
    }
  }

  function renderWarnings(roster, raw) {
    const warnings = [];
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
      el.textContent = `Exact target: ${state.distance}m. Quick labels are shortcuts only; ranking uses the actual distance, projectile flight time and verified BF6 drag when available.`;
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
    el.textContent = `${state.selectionMode === "manual" ? "BUILD MY GUN" : "AUTO META"} • ${scopeLabel()} • ${state.distance}m • ${priorityLabel()}`;
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
      scopeEl.textContent = "YOUR WEAPON";
      subEl.textContent = `${roster.cls} • optimized for ${state.distance}m • this weapon stays locked`;
      return;
    }
    scopeEl.textContent = "BEST WEAPON";
    const rank = ranked.findIndex(x => x.roster.id === roster.id);
    const scope = state.category === "__all__" ? "weapon" : `${tabLabel(state.category).toLowerCase()}`;
    subEl.textContent = ranked.length && rank === 0
      ? `Best ${scope} at ${state.distance}m out of ${ranked.length} ranked`
      : `${roster.cls} at ${state.distance}m`;
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

  /** Data-confidence chip for the whole recommendation. Never hides uncertainty. */
  function renderConfidence(resolved, buildResult) {
    const chip = $("confidenceChip");
    if (!chip) return;
    const names = buildNameConfidence(buildResult?.picks || []);
    const exhaustive = buildResult?.exhaustive === true;
    const audited = resolved?.classAudit?.pass === true;
    const empirical = resolved?.auditDef?.confidence === "empirical-current";
    let level, text;
    if (!resolved?.combat) { level = "bad"; text = "UNVERIFIED — NO AUDITED MODEL"; }
    else if (!exhaustive) { level = "warn"; text = "FALLBACK — EXHAUSTIVE BUILD CACHE PENDING"; }
    else if (!audited || empirical) { level = "warn"; text = "PARTIALLY VERIFIED — CLASS AUDIT INCOMPLETE"; }
    else if (names.level === "VERIFIED") { level = "ok"; text = "VERIFIED"; }
    else if (names.level === "UNVERIFIED" && names.cls === "bad") { level = "bad"; text = "PARTIALLY VERIFIED — NAME CONFLICT"; }
    else { level = "warn"; text = `PARTIALLY VERIFIED — ${names.verified}/${names.total} NAMES EXACT`; }
    chip.textContent = text;
    chip.className = `confidence-chip ${level}`;
    chip.title = names.total ? `${names.verified}/${names.total} attachment names verified as exact BF6 labels.` : "";

    const legend = $("nameLegend");
    if (legend) {
      legend.innerHTML = names.total
        ? `Attachment names: <b>${names.verified}/${names.total}</b> verified as exact Battlefield 6 labels. Names marked otherwise are shown exactly as the source provides them and are never cleaned up or guessed. <b>Name confidence does not change the build:</b> candidates, modifiers, point costs and ranking are identical either way.`
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
      ? "Strict kill speed first; recoil and spread only break ties."
      : "55% exact-distance kill speed, 45% recoil and spread control.";
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
        ["LIVE GAME", cache?.source?.gameVersion || CURRENT.liveVersion || "—", CURRENT.liveVersionDate ? `Build gate ${CURRENT.liveVersionDate}` : "Current build gate"],
        ["CATALOG", `${CURRENT.roster.length} / ${CURRENT.rosterCount} weapons`, `${primaries.length} primaries + ${secondaries} secondaries • always visible`],
        ["STAT COVERAGE", `${matched} / ${CURRENT.roster.length}`, "weapons matched to the analyzer stat feed"],
        ["META ENGINE", cache ? `${cache.audit?.modeled ?? "—"} / ${cache.audit?.weaponsSource ?? "—"} modeled` : "FALLBACK ACTIVE", cache ? `${cache.rules?.distances?.[0] ?? 1}–${cache.rules?.distances?.[1] ?? 300}m exhaustive cache` : "exhaustive cache not validated"],
        ["PRIMARY BUDGET", `${budgetSample ? budgetFor(budgetSample) : (cache?.rules?.primaryBudget ?? 100)} points`, "hard cap enforced per build"],
        ["SECONDARY BUDGET", `${cache?.rules?.sidearmBudget ?? 60} points`, "different from primaries"],
        ["ATTACHMENT NAMES", state.nameAudit ? `${state.nameAudit.counts.VERIFIED_EXACT} / ${state.nameAudit.total} exact` : "AUDIT PENDING", state.nameAudit ? `${state.nameAudit.counts.UNVERIFIED} unverified • ${state.nameAudit.counts.INTERNAL_PLACEHOLDER} category labels • ${state.nameAudit.counts.MISMATCH} conflicts` : "naming audit not loaded"]
      ];
      grid.innerHTML = rows.map(([k, v, sub]) => `<div><span>${escapeHtml(k)}</span><strong>${escapeHtml(String(v))}</strong><small>${escapeHtml(sub)}</small></div>`).join("");
    }

    const prov=$("provenanceGrid");
    if (prov) {
      const cache = state.combatCache;
      const items = [
        ["ANALYZER SOURCE", cache?.source?.repository || "—"],
        ["UPSTREAM COMMIT", cache?.source?.commit ? String(cache.source.commit).slice(0, 12) : "—"],
        ["RANKING MODEL", cache?.source?.rankingModel || "fallback"],
        ["OPTIC MODEL", cache?.source?.opticModel || "—"],
        ["MANUAL BUILD MODEL", cache?.source?.manualBuildModel || "—"],
        ["CACHE GENERATED", cache?.generatedAt ? String(cache.generatedAt).slice(0, 10) : "—"],
        ["NAME AUDIT POLICY", state.nameAudit?.policyVersion || "pending"],
        ["FEED STATUS", Object.entries(state.source).filter(([, v]) => v === "failed" || v === "invalid").map(([k]) => k).join(", ") || "all sources loaded"]
      ];
      prov.innerHTML = items.map(([k, v]) => `<div class="prov"><span>${escapeHtml(k)}</span><strong>${escapeHtml(String(v))}</strong></div>`).join("");
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
    renderModeSwitch();
    renderPriority();
    renderDistance();
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
    renderConfidence(resolved, buildResult);
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

  function populateTabs() {
    const tabs = $("weaponTabs");
    const verifiedCount = CURRENT.roster.filter(w => {
      if (w.cls === "Secondary" || !auditForClass(w.cls)) return false;
      return auditedDefForRoster(w, rawForRoster(w))?.confidence !== "empirical-current";
    }).length;
    const allLabel = state.selectionMode === "manual" ? "ALL" : "ALL";
    const all = `<button type="button" data-category="__all__" class="${state.category === "__all__" ? "active" : ""}" aria-pressed="${state.category === "__all__"}">${allLabel} <em>${state.selectionMode === "manual" ? CURRENT.roster.filter(w=>w.cls!=="Secondary").length : verifiedCount}</em></button>`;
    const cats = CURRENT.primaryClasses.map(cls => {
      const count=CURRENT.roster.filter(w=>w.cls===cls).length;
      const on = cls === state.category;
      return `<button type="button" data-category="${escapeHtml(cls)}" class="${on ? "active" : ""}" aria-pressed="${on}">${escapeHtml(tabLabel(cls))} <em>${count}</em></button>`;
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
    $("priorityGroup")?.addEventListener("click", e => {
      const btn = e.target.closest("button[data-priority]");
      if (!btn) return;
      state.priority = btn.dataset.priority;
      if (state.selectionMode === "auto") resolveAutoWeapon();
      populateWeaponSelect(state.weaponId);
      renderAll();
    });
    $("classSelect").addEventListener("change", e => { state.classChoice = e.target.value; renderAll(); });
    $("contextSelect").addEventListener("change", e => { state.context = e.target.value; renderAll(); });
    ["stayAds", "movingAds", "stealth", "bigMag"].forEach(id => $(id).addEventListener("change", renderAll));
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
      source: { ...state.source }
    }),
    snapshot(query = {}) {
      const keep = { category: state.category, weaponId: state.weaponId, selectionMode: state.selectionMode, distance: state.distance };
      try {
        if (query.category != null) state.category = query.category;
        if (query.mode != null) state.selectionMode = query.mode;
        if (query.distance != null) state.distance = Math.max(1, Math.min(300, Math.round(Number(query.distance))));
        if (query.mode === "auto") resolveAutoWeapon();
        else if (query.weaponId != null) state.weaponId = query.weaponId;

        const ranked = rankWeapons(state.category, state.distance);
        const roster = rosterWeapon();
        const raw = rawForRoster(roster);
        const strategy = activeStrategy();
        let build = null;
        try {
          const r = raw && state.attachments && state.ammo ? optimize(raw, state.distance, strategy) : null;
          if (r) build = {
            points: r.points,
            exhaustive: !!r.exhaustive,
            picks: r.picks.map(p => ({ slot: p.slot, id: p.id, name: p.name ?? null, pts: pointCost(p) })),
            combat: r.combat ? { ...r.combat } : null
          };
        } catch (err) { build = { error: String(err && err.message || err) }; }
        return {
          query: { ...query },
          distance: state.distance,
          weaponId: state.weaponId,
          weaponName: roster?.name ?? null,
          weaponClass: roster?.cls ?? null,
          rankedCount: ranked.length,
          top: ranked.slice(0, 5).map(x => ({
            id: x.roster.id, name: x.roster.name, cls: x.roster.cls,
            triggerTtk: x.combat?.triggerTtk ?? null, mechTtk: x.combat?.ttk ?? null,
            btk: x.combat?.btk ?? null, damage: x.combat?.damage ?? null,
            beamIndex: x.beamIndex ?? null, laserScore: x.laserScore ?? null,
            metaCost: x.metaCost ?? null, velocity: x.velocity ?? null, offPace: !!x.offPace
          })),
          build
        };
      } finally {
        state.category = keep.category; state.weaponId = keep.weaponId;
        state.selectionMode = keep.selectionMode; state.distance = keep.distance;
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
