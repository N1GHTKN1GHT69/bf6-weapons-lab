(() => {
  "use strict";

  const REMOTE = {
    weapons: "https://raw.githubusercontent.com/raymdl/BF6-Weapon-Analyzer/refs/heads/main/data/weapons.json",
    attachments: "https://raw.githubusercontent.com/raymdl/BF6-Weapon-Analyzer/refs/heads/main/data/attachments.json",
    ammo: "https://raw.githubusercontent.com/raymdl/BF6-Weapon-Analyzer/refs/heads/main/data/ammo.json"
  };

  const state = {
    data: null,
    range: "medium",
    weaponId: null,
    classChoice: "auto",
    context: "mixed",
    usingFallback: false,
    pointAudit: null
  };

  const $ = (id) => document.getElementById(id);
  const catalogKeys = { muzzle:"MUZZLES", barrel:"BARRELS", grip:"GRIPS", laser:"LASERS", light:"LIGHTS", ergo:"ERGOS", sight:"SIGHTS" };
  const slotLabels = { sight:"Optic", muzzle:"Muzzle", barrel:"Barrel", grip:"Underbarrel", laser:"Laser", light:"Accessory", ergo:"Ergonomics", mag:"Magazine", ammo:"Ammo" };
  const PICK_100_LIMIT = 100;
  const REQUIRED_SLOTS = new Set(["sight","barrel","mag","ammo"]);

  function isValidPointCost(v, allowZero=true) {
    return Number.isInteger(v) && v >= (allowZero ? 0 : 5) && v <= PICK_100_LIMIT && v % 5 === 0;
  }

  function pointCost(opt, allowZero=true) {
    const v = Number(opt?.pts);
    return isValidPointCost(v, allowZero) ? v : null;
  }

  function auditPointData(data) {
    const errors = [];
    const catalogs = ["SIGHTS","MUZZLES","BARRELS","GRIPS","LASERS","LIGHTS","ERGOS"];
    for (const key of catalogs) {
      const arr = data?.attachments?.[key];
      if (!Array.isArray(arr)) { errors.push("Missing " + key + " point catalog"); continue; }
      for (const item of arr) {
        if (!isValidPointCost(Number(item.pts), true)) errors.push(key + "/" + (item.id || item.name) + ": invalid points " + item.pts);
      }
    }
    for (const [weaponId, magData] of Object.entries(data?.attachments?.WEAPON_MAG || {})) {
      for (const [magId, mag] of Object.entries(magData?.mags || {})) {
        if (!isValidPointCost(Number(mag.pts), false)) errors.push(weaponId + "/mag/" + magId + ": invalid points " + mag.pts);
      }
    }
    for (const [weaponId, ammoData] of Object.entries(data?.ammo?.WEAPON_AMMO || {})) {
      for (const [ammoId, pts] of Object.entries(ammoData?.ammo || {})) {
        if (!isValidPointCost(Number(pts), false)) errors.push(weaponId + "/ammo/" + ammoId + ": invalid points " + pts);
      }
    }
    if ((data?.attachments?.SIGHTS || []).some(x => Number(x.pts) <= 0)) errors.push("0-point optic found in mandatory optic category");
    return {ok:errors.length===0, errors};
  }

  function auditBuildPoints(picks) {
    const errors = [];
    let total = 0;
    const seen = new Set();
    for (const opt of picks || []) {
      const allowZero = !REQUIRED_SLOTS.has(opt.slot);
      const pts = pointCost(opt, allowZero);
      if (pts === null) errors.push(opt.slot + "/" + opt.id + ": missing or invalid point cost");
      else total += pts;
      seen.add(opt.slot);
    }
    for (const slot of REQUIRED_SLOTS) if (!seen.has(slot)) errors.push("missing mandatory " + slot + " selection");
    if (total > PICK_100_LIMIT) errors.push("build exceeds Pick 100: " + total + "/100");
    return {ok:errors.length===0,total,errors};
  }

  // Functional mechanics that a purely numerical simulator can miss.
  const behavior = {
    range_finder: {
      title:"Range Finder",
      description:"Displays target distance. Valuable when distance judgment affects hold, zero or shot selection.",
      scores:{short:-2, medium:3, long:13}
    },
    mag_flare: {
      title:"Magwell Flare",
      description:"Allows reload behavior while maintaining the sight picture / ADS flow.",
      scores:{short:7, medium:9, long:7},
      pref:"stayAds", bonus:5
    },
    ads_bolt: {
      title:"DLC Bolt",
      description:"Sniper utility: maintain ADS / sight picture while cycling or reloading instead of breaking aim.",
      scores:{short:2, medium:12, long:18},
      pref:"stayAds", bonus:10
    },
    buffer: {
      title:"Aftermarket Buffer",
      description:"Reduces visual recoil/sight disruption even when underlying bullet behavior is unchanged.",
      scores:{short:4, medium:8, long:10}
    },
    bipod: {
      title:"Bipod",
      description:"Positional stability utility. Not captured well by generic always-moving stat models.",
      scores:{short:-3, medium:4, long:12}
    },
    mag_catch: {
      title:"Improved Mag Catch",
      description:"Faster reload utility.",
      scores:{short:8, medium:6, long:3}
    },
    std_supp: {title:"Standard Suppressor",description:"Reduces spotting signature; more valuable when stealth is prioritized.",scores:{short:2,medium:2,long:2},pref:"stealth",bonus:12},
    long_supp: {title:"Long Suppressor",description:"Suppression plus recoil/recovery tradeoffs.",scores:{short:1,medium:3,long:3},pref:"stealth",bonus:12},
    light_supp: {title:"Lightened Suppressor",description:"Suppression-focused behavior.",scores:{short:2,medium:2,long:2},pref:"stealth",bonus:12},
    cqb_supp: {title:"CQB Suppressor",description:"Close-range suppression utility.",scores:{short:5,medium:2,long:0},pref:"stealth",bonus:12}
  };

  const weights = {
    short:  {ads:6.0, move:3.0, recoil:2.0, recoilVar:1.4, velocity:.4, hip:5.5, reload:4.0, capacity:.12, visual:2.5, sprint:4.5},
    medium: {ads:3.5, move:4.0, recoil:5.5, recoilVar:4.0, velocity:2.5, hip:1.2, reload:2.5, capacity:.16, visual:3.5, sprint:2.0},
    long:   {ads:1.5, move:4.5, recoil:6.0, recoilVar:6.0, velocity:6.5, hip:0.0, reload:1.5, capacity:.10, visual:4.5, sprint:.8}
  };

  async function fetchJson(url, timeoutMs=6000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(url, {cache:"no-store", signal:ctrl.signal});
      if (!r.ok) throw new Error(`${r.status}`);
      return await r.json();
    } finally { clearTimeout(timer); }
  }

  async function loadData() {
    try {
      const [weapons, attachments, ammo] = await Promise.all([
        fetchJson("./data/weapons.json").catch(() => fetchJson(REMOTE.weapons)),
        fetchJson("./data/attachments.json").catch(() => fetchJson(REMOTE.attachments)),
        fetchJson("./data/ammo.json").catch(() => fetchJson(REMOTE.ammo))
      ]);
      const candidate = {weapons, attachments, ammo};
      const audit = auditPointData(candidate);
      if (!audit.ok) throw new Error("Pick-100 data audit failed: " + audit.errors.join("; "));
      state.data = candidate;
      state.pointAudit = audit;
      $("sourceStatus").textContent = "LIVE DATA • POINT AUDIT PASS";
      state.usingFallback = false;
    } catch (err) {
      state.data = window.BF6_FALLBACK;
      state.pointAudit = auditPointData(state.data);
      state.usingFallback = true;
      $("sourceStatus").textContent = "OFFLINE SAMPLE • NOT META-VALIDATED";
    }
  }

  function optionFromCatalog(slot, id) {
    const arr = state.data.attachments[catalogKeys[slot]] || [];
    return arr.find(x => x.id === id);
  }

  function defaultNone(slot) {
    return optionFromCatalog(slot,"none") || {id:"none",name:"None",pts:0};
  }

  function buildOptions(weapon) {
    const a = state.data.attachments;
    const wa = a.WEAPON_ATTS?.[weapon.id] || {};
    const options = {};

    options.sight = (a.SIGHTS || []).map(x => ({...x, slot:"sight"}));
    if (!options.sight.length) throw new Error(weapon.id + ": no validated optic point choices");

    // Barrel is a mandatory paid Pick-100 category. Never inject a fake 0-point None barrel.
    const barrelIds = Array.isArray(wa.barrel) ? wa.barrel : [];
    options.barrel = barrelIds.map(id => optionFromCatalog("barrel",id)).filter(Boolean).map(x => ({...x,slot:"barrel"}));
    if (!options.barrel.length) throw new Error(weapon.id + ": no validated barrel point choices");

    // These categories are optional, so a true 0-point None choice is valid.
    for (const slot of ["muzzle","grip","laser","light"]) {
      const ids = Array.isArray(wa[slot]) ? wa[slot] : [];
      const list = ids.map(id => optionFromCatalog(slot,id)).filter(Boolean).map(x => ({...x,slot}));
      if (!list.some(x=>x.id==="none")) list.unshift({...defaultNone(slot),slot});
      options[slot] = list;
    }

    // The current analyzer defines Range Finder but does not map its compatibility per weapon.
    // Treat it as an inferred long-range accessory for Sniper/DMR only, and disclose that fact in UI.
    if (["Sniper Rifle","DMR"].includes(weapon.cls)) {
      const rf = optionFromCatalog("light","range_finder");
      if (rf && !options.light.some(x=>x.id==="range_finder")) {
        options.light.push({...rf,slot:"light",compatibilityInferred:true});
      }
    }

    const ergoIds = a.WEAPON_ERGO?.[weapon.id]?.avail || [];
    options.ergo = [{...defaultNone("ergo"),slot:"ergo"}]
      .concat(ergoIds.map(id => optionFromCatalog("ergo",id)).filter(Boolean).map(x=>({...x,slot:"ergo"})))
      .filter((x,i,arr)=>arr.findIndex(y=>y.id===x.id)===i);

    const magData = a.WEAPON_MAG?.[weapon.id];
    if (!magData?.mags || !Object.keys(magData.mags).length) throw new Error(weapon.id + ": missing weapon-specific magazine point table");
    options.mag = Object.entries(magData.mags).map(([id,x]) => ({id,...x,slot:"mag"}));

    const ammoRoot = state.data.ammo || {};
    const ammoCat = ammoRoot.AMMO || [];
    const ammoData = ammoRoot.WEAPON_AMMO?.[weapon.id];
    if (ammoData?.ammo) {
      options.ammo = Object.entries(ammoData.ammo).map(([id,pts]) => {
        const def = ammoCat.find(x=>x.id===id) || {id,name:id};
        return {...def, id, pts, slot:"ammo"};
      });
    } else {
      throw new Error(weapon.id + ": missing weapon-specific ammunition point table");
    }

    for (const [slot,list] of Object.entries(options)) {
      for (const opt of list) {
        const pts = pointCost(opt, !REQUIRED_SLOTS.has(slot));
        if (pts === null) throw new Error(weapon.id + "/" + slot + "/" + opt.id + ": invalid or unknown point cost");
      }
    }
    return options;
  }

  function pref(id) { return !!$(id)?.checked; }

  function numericScore(opt, profile, weapon) {
    const w = weights[profile];
    let s = 0;

    s += (opt.adsTimeTierMod || 0) * w.ads;
    s += (-(opt.adsTimeTierShift || 0)) * w.ads;
    s += (opt.movingAdsSpreadTierMod || 0) * w.move;
    s += (-(opt.adsMoveSpeedTierShift || 0)) * (pref("movingAds") ? w.move*1.7 : w.move*.55);
    s += (opt.adsRecoilTierMod || 0) * w.recoil;
    s += (opt.adsRecoilVariationTierMod || 0) * w.recoilVar;
    s += ((opt.adsRecoilDecayMult || 1) - 1) * 15 * w.recoil;
    s += (opt.velTierMod || 0) * w.velocity;
    s += ((opt.velMult || 1) - 1) * 10 * w.velocity;
    s += (-(opt.hipSpreadTierMod || 0)) * w.hip;
    s += ((opt.reloadSpeedMult || 1) - 1) * 35 * w.reload;
    s += (opt.reloadSpeedTier || 0) * w.reload;
    s += (-(opt.sprintRecoveryTierShift || 0)) * w.sprint;
    s += (-(opt.visualRecoil || 0)) * w.visual;

    if (opt.mag) {
      const base = weapon.mag || opt.mag;
      const extra = opt.mag - base;
      s += extra * (pref("bigMag") ? w.capacity*3.2 : w.capacity);
      if (opt.mag < base && profile==="short") s -= (base-opt.mag) * .10;
    }

    if (opt.suppressor && pref("stealth")) s += 13;
    if (opt.laserVisible && pref("stealth")) s -= 8;

    const b = behavior[opt.id];
    if (b) {
      s += b.scores?.[profile] || 0;
      if (b.pref && pref(b.pref)) s += b.bonus || 0;
    }

    // Class-aware functional emphasis.
    if (opt.id === "ads_bolt" && weapon.cls !== "Sniper Rifle") s -= 100;
    if (opt.id === "range_finder" && profile !== "long") s -= 3;

    return s;
  }

  function applySightContext(opt, profile, weapon) {
    let s = 0;
    if (opt.id==="iron") s += profile==="short" ? 7 : -4;
    if (opt.id==="std_optic") s += profile==="short" ? 7 : profile==="medium" ? 9 : 4;
    if (opt.id==="var_low") s += profile==="medium" ? 9 : profile==="long" ? 8 : 2;
    if (opt.id==="var_high") s += profile==="long" ? 13 : -2;
    if (opt.id==="thermal") s += profile==="medium" ? 5 : profile==="long" ? 7 : 1;
    if (opt.id==="therm_hyb") s += profile==="long" ? 8 : 2;
    if (weapon.cls==="Sniper Rifle" && profile==="long" && ["var_high","therm_hyb"].includes(opt.id)) s += 6;
    return s;
  }

  function scoreOption(opt, profile, weapon) {
    return numericScore(opt, profile, weapon) + (opt.slot==="sight" ? applySightContext(opt,profile,weapon) : 0);
  }

  // Multiple-choice knapsack: exactly one choice from each attachment slot, <= 100 points.
  function optimize(weapon, profile) {
    const options = buildOptions(weapon);
    const slots = ["sight","muzzle","barrel","grip","laser","light","ergo","mag","ammo"];
    let dp = Array(PICK_100_LIMIT + 1).fill(null);
    dp[0] = {score:0, picks:[]};

    for (const slot of slots) {
      const next = Array(PICK_100_LIMIT + 1).fill(null);
      for (let used=0; used<=PICK_100_LIMIT; used++) {
        const cur = dp[used];
        if (!cur) continue;
        for (const opt of (options[slot] || [{id:"none",name:"None",pts:0,slot}])) {
          const pts = pointCost(opt, !REQUIRED_SLOTS.has(slot));
          if (pts === null) continue;
          const total = used + pts;
          if (total > PICK_100_LIMIT) continue;
          const sc = cur.score + scoreOption(opt,profile,weapon);
          if (!next[total] || sc > next[total].score) {
            next[total] = {score:sc,picks:cur.picks.concat([{...opt,slot,score:scoreOption(opt,profile,weapon)}])};
          }
        }
      }
      dp = next;
    }

    const viable = dp.map((x,points)=>x ? {...x,points} : null).filter(Boolean);
    let best = viable.sort((a,b)=>b.score-a.score || b.points-a.points)[0];
    if (!best) return {score:0,picks:[],points:0};

    const pointAudit = auditBuildPoints(best.picks);
    if (!pointAudit.ok) throw new Error(weapon.id + ": invalid optimized build: " + pointAudit.errors.join("; "));
    best.points = pointAudit.total;
    best.pointAudit = pointAudit;
    return best;
  }


  function sumProfileScore(obj, profile, context) {
    if (!obj?.score) return 0;
    return Number(obj.score[profile] || 0) + Number(obj.score[context] || 0);
  }

  function chooseClass(weapon) {
    const db = window.BF6_LOADOUT_DATA?.classes || {};
    if (state.classChoice !== "auto" && db[state.classChoice]) {
      return {id:state.classChoice, data:db[state.classChoice], score:null, manual:true};
    }

    let best = null;
    for (const [id,c] of Object.entries(db)) {
      let score = Number(c.rangeBias?.[state.range] || 0) + Number(c.contextBias?.[state.context] || 0);
      if (weapon.cls === c.signatureCategory) score += 42;

      // Open-weapons logic: non-signature pairings are allowed, but they do not earn the class proficiency.
      if (id==="assault" && state.context==="objective") score += 5;
      if (id==="engineer" && state.context==="vehicles") score += 10;
      if (id==="support" && state.context==="objective") score += 5;
      if (id==="recon" && state.range==="long") score += 6;
      if (id==="recon" && pref("stealth")) score += 6;

      if (!best || score > best.score) best = {id,data:c,score,manual:false};
    }
    return best;
  }

  function chooseTraining(classRec) {
    return [...(classRec.data.paths || [])]
      .map(x=>({...x,_score:sumProfileScore(x,state.range,state.context)}))
      .sort((a,b)=>b._score-a._score)[0];
  }

  function chooseGadgets(classRec) {
    const list = [...(classRec.data.gadgets || [])]
      .map(x=>({...x,_score:sumProfileScore(x,state.range,state.context)}))
      .sort((a,b)=>b._score-a._score);

    const out = [];
    for (const g of list) {
      if (out.length >= 2) break;
      if (classRec.data.rules?.maxLauncherGadgets===1 && g.group==="launcher" && out.some(x=>x.group==="launcher")) continue;
      out.push(g);
    }
    return out;
  }

  function chooseThrowable(classRec) {
    return [...(classRec.data.throwables || [])]
      .map(x=>({...x,_score:sumProfileScore(x,state.range,state.context)}))
      .sort((a,b)=>b._score-a._score)[0];
  }

  function sidearmCandidates() {
    const live = (state.data.weapons || []).filter(w => /secondary|sidearm/i.test(String(w.cls||"")));
    return live.length ? live : (window.BF6_LOADOUT_DATA?.fallbackSecondaries || []);
  }

  function baseDamageAtZero(w) {
    const d = Array.isArray(w.dmg) ? w.dmg : [];
    return d.length ? Number(d[0].d || 0) : 0;
  }

  function chooseSecondary(primary) {
    const roles = window.BF6_LOADOUT_DATA?.secondaryRoles || {};
    let best = null;

    for (const w of sidearmCandidates()) {
      const named = roles[w.name] || {};
      let s = Number(named[state.range] || 0);
      if (state.range==="long") s += Number(named.complementLong || 0);
      if (state.range==="short") s += Number(named.complementShort || 0);

      // Small numeric tie-breaker from available live data.
      s += Math.min(7, Number(w.mag || 0) * .12);
      s += Math.min(6, Number(w.rpm || 0) / 180);
      s += Math.min(5, Number(w.bulletVel || 0) / 150);
      s += Math.min(5, baseDamageAtZero(w) / 10);
      s -= Math.max(0, (Number(w.adsTime || 180)-180)/50);
      s -= Math.max(0, (Number(w.tacRld || 1.7)-1.7)*1.4);

      if (!best || s > best.score) best = {weapon:w,score:s,role:named};
    }
    return best;
  }

  function secondaryProfileFor(primary) {
    if (state.range==="long") return "short";
    if (state.range==="short") return "medium";
    return "short";
  }

  function renderCompleteLoadout(primary) {
    const classRec = chooseClass(primary);
    if (!classRec) return;
    const path = chooseTraining(classRec);
    const gadgets = chooseGadgets(classRec);
    const throwable = chooseThrowable(classRec);
    const secondaryRec = chooseSecondary(primary);
    const c = classRec.data;

    $("className").textContent = c.name;
    $("classFit").textContent = classRec.manual ? "MANUAL CLASS" : "AUTO BEST FIT";
    $("classTitle").textContent = `${c.name} complete loadout`;
    $("classWhy").textContent = `${c.role} ${primary.cls===c.signatureCategory ? "Signature-weapon proficiency is active: "+c.weaponBenefit : "This primary does not receive this class's signature-weapon bonus."}`;
    $("trainingPath").textContent = path?.name || "—";
    $("trainingWhy").textContent = path?.why || "—";
    $("signatureGadget").textContent = c.signatureGadget;
    $("signatureTrait").textContent = c.signatureTrait;
    $("gadget1").textContent = gadgets[0]?.name || "—";
    $("gadget1Why").textContent = gadgets[0]?.why || "—";
    $("gadget2").textContent = gadgets[1]?.name || "—";
    $("gadget2Why").textContent = gadgets[1]?.why || "—";
    $("throwable").textContent = throwable?.name || "—";
    $("throwableWhy").textContent = throwable?.why || "—";

    if (secondaryRec?.weapon) {
      const sw = secondaryRec.weapon;
      $("secondaryName").textContent = sw.name;
      const complement = state.range==="long"
        ? "Selected to cover the close-range hole left by a long-range primary."
        : state.range==="short"
          ? "Selected to add a more capable ranged backup to a close-range primary."
          : "Selected as the strongest general-purpose backup for this profile.";
      $("secondaryWhy").textContent = `${secondaryRec.role?.why || complement} ${complement}`;

      const hasSecondaryPointData = !!(
        state.data.attachments?.WEAPON_ATTS?.[sw.id] &&
        state.data.attachments?.WEAPON_MAG?.[sw.id]?.mags &&
        state.data.ammo?.WEAPON_AMMO?.[sw.id]?.ammo
      );
      $("secondaryBuildTitle").textContent = `${sw.name} — ${secondaryProfileFor(primary).toUpperCase()} backup build`;
      if (hasSecondaryPointData) {
        const secResult = optimize(sw, secondaryProfileFor(primary));
        if ($("secondaryPoints")) $("secondaryPoints").textContent = secResult.pointAudit?.ok && !state.usingFallback ? `${secResult.points}/100 • POINTS VERIFIED` : "POINT DATA NOT PRODUCTION-VERIFIED";
        $("secondaryAttachmentList").innerHTML = secResult.picks
          .filter(x=>x.id!=="none")
          .map(opt => `
            <div class="att-row">
              <div class="att-slot">${slotLabels[opt.slot] || opt.slot}</div>
              <div><div class="att-name">${escapeHtml(opt.name || opt.id)}</div><div class="att-note">${escapeHtml(formatAttNote(opt))}</div></div>
              <div class="att-pts">${Number(opt.pts)}p</div>
            </div>`).join("") || `<div class="why"><strong>Base sidearm setup</strong><span>No paid attachment was selected.</span></div>`;
      } else {
        if ($("secondaryPoints")) $("secondaryPoints").textContent = "ATTACHMENT POINT DATA UNAVAILABLE";
        $("secondaryAttachmentList").innerHTML = `<div class="why"><strong>No fabricated secondary build</strong><span>The sidearm is recommended for role coverage, but this source does not provide its exact weapon-specific Pick-100 attachment costs. The site will not guess them.</span></div>`;
      }
    }
  }

  function formatAttNote(opt) {
    const parts = [];
    const b = behavior[opt.id];
    if (b) parts.push(b.description);
    if (opt.compatibilityInferred) parts.push("Compatibility inferred from class; verify in game.");
    if (opt.adsRecoilTierMod) parts.push(`recoil +${opt.adsRecoilTierMod} tier`);
    if (opt.movingAdsSpreadTierMod) parts.push(`moving ADS ${opt.movingAdsSpreadTierMod>0?"+":""}${opt.movingAdsSpreadTierMod} tier`);
    if (opt.velMult && opt.velMult !== 1) parts.push(`${Math.round((opt.velMult-1)*100)}% velocity`);
    if (opt.mag) parts.push(`${opt.mag} rounds`);
    if (opt.reloadSpeedTier) parts.push(`reload +${opt.reloadSpeedTier} tier`);
    if (opt.suppressor) parts.push("suppressed");
    if (!parts.length) parts.push("utility / neutral-stat selection");
    return parts.join(" • ");
  }

  function render(weapon, result) {
    $("weaponName").textContent = weapon.name;
    $("buildProfile").textContent = `${state.range.toUpperCase()} RANGE`;
    $("pointsUsed").textContent = result.points;
    $("pointsMeter").style.width = `${Math.min(PICK_100_LIMIT,result.points)}%`;
    if ($("pointAuditBadge")) {
      $("pointAuditBadge").textContent = result.pointAudit?.ok && !state.usingFallback ? "POINTS VERIFIED • VALID PICK-100 BUILD" : "POINTS NOT PRODUCTION-VERIFIED";
      $("pointAuditBadge").classList.toggle("bad", !(result.pointAudit?.ok && !state.usingFallback));
    }

    // Convert raw additive score to a readable fit number, not a fake probability.
    const fit = Math.max(55, Math.min(99, Math.round(72 + result.score/8)));
    $("buildScore").textContent = fit;

    $("attachmentList").innerHTML = result.picks.map(opt => `
      <div class="att-row">
        <div class="att-slot">${slotLabels[opt.slot] || opt.slot}</div>
        <div>
          <div class="att-name">${escapeHtml(opt.name || opt.id)}</div>
          <div class="att-note">${escapeHtml(formatAttNote(opt))}</div>
        </div>
        <div class="att-pts">${Number(opt.pts)}p</div>
      </div>`).join("");

    renderWhy(weapon,result);
    renderStats(weapon);
    renderUtilities(result);
    renderCompleteLoadout(weapon);

    const inferred = result.picks.some(x=>x.compatibilityInferred);
    const sourceVersion = detectVersion(weapon.damageSource || "");
    const warnings = [];
    if (state.usingFallback) warnings.push("Live source data could not be reached. The bundled sample is UI-only and must not be treated as a current meta build.");
    if (!result.pointAudit?.ok) warnings.push("This build failed the Pick-100 point audit and should not be used.");
    if (inferred) warnings.push("Range Finder compatibility is not mapped per weapon by the current source dataset. This build uses a class-level inference and should be checked in game.");
    if (sourceVersion) warnings.push(`Weapon damage provenance reports game-data version ${sourceVersion}. Treat recommendations as version-dependent.`);
    if (warnings.length) {
      $("warningCard").classList.remove("hidden");
      $("warningCard").innerHTML = `<strong>DATA CHECK:</strong> ${warnings.map(escapeHtml).join(" ")}`;
    } else {
      $("warningCard").classList.add("hidden");
    }
  }

  function renderWhy(weapon,result) {
    const top = [...result.picks].sort((a,b)=>b.score-a.score).slice(0,5);
    const profileText = {
      short:"Fast handling, hipfire, sprint recovery and reload speed receive the most weight.",
      medium:"Recoil control, moving accuracy and usable handling are balanced.",
      long:"Velocity, recoil consistency, sight-picture utility and positional stability dominate."
    }[state.range];
    const items = [
      {title:`${state.range[0].toUpperCase()+state.range.slice(1)}-range profile`,text:profileText},
      ...top.filter(x=>x.score>1).map(x=>({title:x.name,text:formatAttNote(x)}))
    ];
    $("whyList").innerHTML = items.slice(0,6).map(x=>`<div class="why"><strong>${escapeHtml(x.title)}</strong><span>${escapeHtml(x.text)}</span></div>`).join("");
  }

  function renderStats(w) {
    const stats = [
      ["Class",w.cls || "—"],
      ["RPM",w.rpm ? Math.round(w.rpm) : "—"],
      ["Velocity",w.bulletVel ? `${Math.round(w.bulletVel)} m/s` : "—"],
      ["ADS",w.adsTime ? `${Math.round(w.adsTime)} ms` : "—"],
      ["Magazine",w.mag || "—"],
      ["Tac reload",w.tacRld ? `${Number(w.tacRld).toFixed(2)} s` : "—"],
      ["Vert recoil",w.recoilV ? Number(w.recoilV).toFixed(3) : "—"],
      ["Recoil var.",w.recoilVar ?? "—"],
      ["Fire mode",w.fireMode || "—"]
    ];
    $("weaponStats").innerHTML = stats.map(([k,v])=>`<div class="stat"><span>${escapeHtml(k)}</span><strong>${escapeHtml(String(v))}</strong></div>`).join("");
  }

  function renderUtilities(result) {
    const hits = result.picks.filter(x=>behavior[x.id] || x.suppressor);
    if (!hits.length) {
      $("utilityList").innerHTML = `<div class="utility"><span class="dot"></span><div><strong>No special utility mechanic selected</strong><p>The optimizer spent the budget on numerical performance for this profile.</p></div></div>`;
      return;
    }
    $("utilityList").innerHTML = hits.map(x=>{
      const b = behavior[x.id] || {title:x.name,description:"Suppression / signature reduction behavior."};
      return `<div class="utility"><span class="dot"></span><div><strong>${escapeHtml(b.title)}</strong><p>${escapeHtml(b.description)}${x.compatibilityInferred?" Compatibility is currently inferred.":""}</p></div></div>`;
    }).join("");
  }

  function detectVersion(text) {
    const m = String(text).match(/\b\d+\.\d+\.\d+\.\d+\b/);
    return m ? m[0] : null;
  }

  function escapeHtml(v) {
    return String(v).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  }

  function populateWeapons() {
    const sel = $("weaponSelect");
    const weapons = [...state.data.weapons].sort((a,b)=>(a.cls||"").localeCompare(b.cls||"") || a.name.localeCompare(b.name));
    const groups = new Map();
    weapons.forEach(w => {
      const cls = w.cls || "Other";
      if (!groups.has(cls)) groups.set(cls,[]);
      groups.get(cls).push(w);
    });
    sel.innerHTML = "";
    for (const [cls,list] of groups) {
      const g = document.createElement("optgroup");
      g.label = cls;
      list.forEach(w => {
        const o = document.createElement("option");
        o.value = w.id;o.textContent=w.name;g.appendChild(o);
      });
      sel.appendChild(g);
    }
    state.weaponId = weapons[0]?.id || null;
    sel.value = state.weaponId;
  }

  function currentWeapon() { return state.data.weapons.find(w=>w.id===state.weaponId) || state.data.weapons[0]; }

  function run() {
    const weapon = currentWeapon();
    if (!weapon) return;
    const result = optimize(weapon,state.range);
    render(weapon,result);
  }

  function bind() {
    $("weaponSelect").addEventListener("change",e=>{state.weaponId=e.target.value;run();});
    $("classSelect").addEventListener("change",e=>{state.classChoice=e.target.value;run();});
    $("contextSelect").addEventListener("change",e=>{state.context=e.target.value;run();});
    $("rangePicker").addEventListener("click",e=>{
      const b=e.target.closest("button[data-range]"); if(!b)return;
      state.range=b.dataset.range;
      [...$("rangePicker").querySelectorAll("button")].forEach(x=>x.classList.toggle("active",x===b));
      // Useful defaults, still user-overridable.
      $("movingAds").checked = state.range==="medium";
      run();
    });
    ["stayAds","movingAds","stealth","bigMag"].forEach(id=>$(id).addEventListener("change",run));
    $("optimizeBtn").addEventListener("click",run);
  }

  async function init() {
    await loadData();
    populateWeapons();
    bind();
    // Prefer a recognizable default if present.
    const preferred = state.data.weapons.find(w=>w.id==="b36a4") || state.data.weapons[0];
    if (preferred) { state.weaponId=preferred.id; $("weaponSelect").value=preferred.id; }
    $("movingAds").checked = true;
    run();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(()=>{});
  }

  init();
})();