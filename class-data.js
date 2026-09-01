window.BF6_LOADOUT_DATA = {
  classes: {
    assault: {
      name:"Assault",
      signatureCategory:"Assault Rifle",
      signatureGadget:"AJ-03 Stim — Adrenaline Injector",
      signatureTrait:"Mission Focused — faster objective progression and shorter combat-state recovery for quicker squad redeploys.",
      weaponBenefit:"Assault Rifles: mitigates movement penalties and improves sprint-to-fire handling.",
      role:"Frontline objective pressure and infantry fighting.",
      rangeBias:{short:9,medium:16,long:2},
      contextBias:{infantry:9,objective:18,mixed:9,vehicles:2},
      paths:[
        {name:"Breacher",score:{short:15,medium:9,long:1,infantry:12,objective:13,mixed:8,vehicles:2},why:"Extra grenades and aggressive launcher/weapon handling make it the direct-entry path."},
        {name:"Frontliner",score:{short:9,medium:13,long:5,infantry:8,objective:17,mixed:12,vehicles:3},why:"Mobility, faster recovery and squad-forward pressure fit sustained objective play."}
      ],
      gadgets:[
        {id:"weapon_sling",name:"Weapon Sling — Extra Primary",group:"weapon",score:{short:10,medium:8,long:13,infantry:10,objective:7,mixed:12,vehicles:2},why:"Trades a gadget slot for a Carbine, DMR or Shotgun to cover the range your primary cannot."},
        {id:"tarantula_alx",name:"Tarantula ALX — Assault Ladder",group:"utility",score:{short:5,medium:6,long:4,infantry:6,objective:10,mixed:7,vehicles:1},why:"Creates vertical routes, bridges and unexpected attack angles."},
        {id:"x95_bre",name:"X95 BRE — Breaching Projectile Launcher",group:"launcher",score:{short:13,medium:8,long:1,infantry:11,objective:15,mixed:8,vehicles:1},why:"Breaches destructible cover and blinds defenders on the far side."},
        {id:"m320_he",name:"M320A1 HE — High-Explosive Launcher",group:"launcher",score:{short:9,medium:12,long:5,infantry:14,objective:13,mixed:10,vehicles:4},why:"Direct explosive damage for infantry, rooms, cover and light structural work."},
        {id:"m320_thrm",name:"M320A1 THRM — Thermobaric Launcher",group:"launcher",score:{short:10,medium:11,long:4,infantry:11,objective:16,mixed:10,vehicles:3},why:"Area denial, burn and disruption around objectives and chokepoints."},
        {id:"qlink6",name:"QLink 6 — Deploy Beacon",group:"utility",score:{short:6,medium:10,long:9,infantry:5,objective:20,mixed:14,vehicles:2},why:"Forward squad spawn pressure. High value when holding or attacking objectives."},
        {id:"ss26",name:"SS26 — Incendiary-Round Shotgun",group:"weapon",score:{short:14,medium:7,long:0,infantry:12,objective:13,mixed:7,vehicles:0},why:"Close-range burn and area denial when the primary is not suited to tight spaces."}
      ],
      throwables:[
        {name:"M67 Frag Grenade",score:{short:9,medium:8,long:4,infantry:10,objective:11,mixed:9,vehicles:1},why:"General-purpose lethal for cover and rooms."},
        {name:"MK 141 Mod 0 Stun Grenade",score:{short:14,medium:9,long:2,infantry:11,objective:14,mixed:9,vehicles:0},why:"Slows/disrupts enemies before an aggressive entry."},
        {name:"M84 Flash Grenade",score:{short:13,medium:9,long:2,infantry:11,objective:14,mixed:9,vehicles:0},why:"Strong entry throwable for rooms, corners and defended objectives."}
      ]
    },
    engineer: {
      name:"Engineer",
      signatureCategory:"SMG",
      signatureGadget:"HOFF-1500 — Repair Tool",
      signatureTrait:"Mechanized Infantry — explosive resistance near friendly vehicles and vehicle-denial utility after crews exit.",
      weaponBenefit:"SMGs: improved hip-fire control, making close-range pre-fire and transitions more forgiving.",
      role:"Close-range fighting, vehicle destruction and vehicle sustainment.",
      rangeBias:{short:16,medium:7,long:0},
      contextBias:{infantry:6,objective:7,mixed:12,vehicles:24},
      paths:[
        {name:"Anti-Armor",score:{short:6,medium:9,long:8,infantry:1,objective:5,mixed:12,vehicles:24},why:"Extra rockets, faster launcher reloads and longer vehicle repair lockout."},
        {name:"Combat Engineer",score:{short:11,medium:8,long:3,infantry:8,objective:10,mixed:13,vehicles:14},why:"Improves gadget/vehicle sustainment and is the more flexible mixed-role engineer path."}
      ],
      gadgets:[
        {id:"mbt_law",name:"MBT-LAW — Auto-Guided Launcher",group:"launcher",score:{short:4,medium:10,long:10,infantry:1,objective:5,mixed:13,vehicles:20},why:"Easy top-down anti-vehicle launcher; strong when you need reliable vehicle pressure."},
        {id:"slm93a",name:"SLM-93A Spire — Air-Defense Launcher",group:"launcher",score:{short:1,medium:8,long:12,infantry:0,objective:3,mixed:10,vehicles:20},why:"Dedicated anti-air lock-on option."},
        {id:"rpg7",name:"RPG-7V2 — Unguided Rocket Launcher",group:"launcher",score:{short:10,medium:13,long:7,infantry:9,objective:10,mixed:15,vehicles:18},why:"Free-fire launcher with good structure, infantry and vehicle flexibility."},
        {id:"mas148",name:"MAS 148 Glaive — Long-Range Launcher",group:"launcher",score:{short:0,medium:8,long:15,infantry:2,objective:5,mixed:12,vehicles:21},why:"Long-range guided anti-vehicle pressure, especially with Recon designation."},
        {id:"m136",name:"M136 AT — Aim-Guided Launcher",group:"launcher",score:{short:3,medium:12,long:14,infantry:1,objective:5,mixed:13,vehicles:22},why:"Manual guidance rewards accuracy and weak-point hits."},
        {id:"igla",name:"9K38 IGLA — Active-Locking Air Defense",group:"launcher",score:{short:0,medium:8,long:13,infantry:0,objective:3,mixed:10,vehicles:22},why:"Anti-air choice with active tracking behavior."},
        {id:"eod",name:"EOD Bot",group:"utility",score:{short:5,medium:8,long:10,infantry:4,objective:12,mixed:11,vehicles:13},why:"Remote repair, objective interaction, scouting and gadget destruction."},
        {id:"vehicle_crate",name:"Vehicle Supply Crate",group:"utility",score:{short:1,medium:5,long:5,infantry:0,objective:4,mixed:9,vehicles:18},why:"Keeps allied vehicles supplied and reduces their ammunition downtime."},
        {id:"m15",name:"M15 Anti-Vehicle Mine",group:"mine",score:{short:4,medium:8,long:8,infantry:0,objective:7,mixed:12,vehicles:19},why:"Persistent route denial against ground vehicles."},
        {id:"ptkm",name:"PTKM-1R Acoustic-Sensor AV Mine",group:"mine",score:{short:3,medium:8,long:9,infantry:0,objective:7,mixed:12,vehicles:20},why:"Top-attack anti-vehicle mine for predictable vehicle lanes."},
        {id:"slam",name:"M4A1 SLAM — Trip-Sensor AV Mine",group:"mine",score:{short:4,medium:8,long:8,infantry:0,objective:8,mixed:12,vehicles:20},why:"Flexible mine placement including walls and vehicle approach lanes."}
      ],
      throwables:[
        {name:"M67 Frag Grenade",score:{short:8,medium:7,long:3,infantry:9,objective:9,mixed:7,vehicles:0},why:"General anti-infantry lethal."},
        {name:"SCG-24 Anti-Tank Grenade",score:{short:4,medium:7,long:4,infantry:1,objective:5,mixed:11,vehicles:20},why:"Vehicle finisher that complements a launcher."},
        {name:"V40 Mini Frag Grenade",score:{short:12,medium:9,long:6,infantry:12,objective:10,mixed:9,vehicles:1},why:"Light grenade with extra throw distance and a smaller blast area."}
      ],
      rules:{maxLauncherGadgets:1}
    },
    support: {
      name:"Support",
      signatureCategory:"LMG",
      signatureGadget:"Goliath 90L — Supply Bag",
      signatureTrait:"Field Sustainment / First Aid — can distribute health support and is the only class that can revive any teammate, not just squadmates.",
      weaponBenefit:"LMGs: no sprint-speed penalty while carrying the signature weapon, improving repositioning with heavy weapons.",
      role:"Revive, resupply, suppression, cover and defensive control.",
      rangeBias:{short:7,medium:12,long:12},
      contextBias:{infantry:10,objective:18,mixed:15,vehicles:8},
      paths:[
        {name:"Combat Medic",score:{short:10,medium:12,long:6,infantry:10,objective:20,mixed:15,vehicles:4},why:"Faster drag/revive and stronger team sustainment."},
        {name:"Fire Support",score:{short:4,medium:12,long:16,infantry:11,objective:14,mixed:13,vehicles:8},why:"Mounted/bipod fire, suppression and defensive gadget durability."}
      ],
      gadgets:[
        {id:"powerpulse",name:"PowerPulse — Defibrillator",group:"support",score:{short:9,medium:11,long:6,infantry:10,objective:20,mixed:15,vehicles:2},why:"Instant teammate revive; highest value in objective modes and dense team fights."},
        {id:"goliath_compact",name:"Goliath Compact — Supply Pouch",group:"support",score:{short:10,medium:12,long:9,infantry:11,objective:14,mixed:14,vehicles:2},why:"Quick health plus primary/secondary ammo restock."},
        {id:"maxguard",name:"MaxGuard 900 — Deployable Cover",group:"defense",score:{short:6,medium:11,long:14,infantry:9,objective:16,mixed:12,vehicles:4},why:"Creates cover and a stable mounting point for LMG/bipod fire."},
        {id:"gpdis",name:"GPDIS — Grenade Intercept System",group:"defense",score:{short:6,medium:11,long:9,infantry:10,objective:18,mixed:13,vehicles:2},why:"Protects positions from grenades and slower incoming projectiles."},
        {id:"mpaps",name:"MP-APS — Missile Intercept System",group:"defense",score:{short:2,medium:8,long:11,infantry:3,objective:12,mixed:12,vehicles:18},why:"Intercepts missiles, mortar rounds and other larger incoming projectiles."},
        {id:"smoke_launcher",name:"M320A1 SMK — Smoke Grenade Launcher",group:"launcher",score:{short:8,medium:12,long:10,infantry:9,objective:20,mixed:15,vehicles:6},why:"Breaks lines of sight and spotting; enables pushes and safer revives."},
        {id:"incendiary_airburst",name:"SICH G1 WP — Incendiary Airburst Launcher",group:"launcher",score:{short:7,medium:12,long:11,infantry:11,objective:16,mixed:12,vehicles:4},why:"Area denial over and behind cover."},
        {id:"mortar",name:"LWCMS — Portable Mortar",group:"launcher",score:{short:0,medium:9,long:16,infantry:10,objective:15,mixed:12,vehicles:5},why:"Long-range area denial against objectives, buildings and fixed positions."}
      ],
      throwables:[
        {name:"M67 Frag Grenade",score:{short:8,medium:7,long:3,infantry:9,objective:9,mixed:7,vehicles:0},why:"General-purpose lethal."},
        {name:"M18 Smoke Grenade",score:{short:9,medium:12,long:8,infantry:8,objective:20,mixed:14,vehicles:5},why:"Breaks sightlines, clears spotting and covers revives/pushes."},
        {name:"AN/M14 Incendiary Grenade",score:{short:10,medium:10,long:4,infantry:10,objective:16,mixed:10,vehicles:1},why:"Area denial and damage-over-time around doors, rooms and objectives."}
      ]
    },
    recon: {
      name:"Recon",
      signatureCategory:"Sniper Rifle",
      signatureGadget:"T-UGS — Motion Sensor",
      signatureTrait:"Passive Spotting — spots enemies while aiming at them under the required movement/zoom conditions.",
      weaponBenefit:"Sniper Rifles: faster rechambering, reduced scope sway and improved breath control.",
      role:"Intelligence, precision fire, stealth and disruption.",
      rangeBias:{short:3,medium:10,long:22},
      contextBias:{infantry:8,objective:10,mixed:12,vehicles:9},
      paths:[
        {name:"Sniper",score:{short:1,medium:11,long:22,infantry:10,objective:10,mixed:12,vehicles:4},why:"Improved spotting and sniper headshot utility amplify long-range precision."},
        {name:"Spec Ops",score:{short:13,medium:12,long:7,infantry:10,objective:13,mixed:13,vehicles:10},why:"Stealth, gadget awareness and lower-profile infiltration fit aggressive Recon."}
      ],
      gadgets:[
        {id:"ltlm",name:"LTLM II — Laser Designator",group:"intel",score:{short:1,medium:10,long:18,infantry:6,objective:9,mixed:14,vehicles:20},why:"Long-range spotting and vehicle designation; strong Engineer/vehicle synergy."},
        {id:"m18a1",name:"M18A1 Anti-Personnel Mine",group:"mine",score:{short:10,medium:10,long:8,infantry:11,objective:14,mixed:10,vehicles:0},why:"Flank warning and infantry area denial."},
        {id:"xfgm",name:"XFGM-6D — Recon Drone",group:"intel",score:{short:3,medium:12,long:16,infantry:11,objective:16,mixed:15,vehicles:10},why:"Remote thermal spotting and gadget disruption."},
        {id:"dummy",name:"Field Dummy No.25 — Sniper Decoy",group:"intel",score:{short:1,medium:8,long:15,infantry:9,objective:8,mixed:10,vehicles:0},why:"Counter-sniper deception and position reveal when enemies shoot it."},
        {id:"c4",name:"C-4 Explosives",group:"explosive",score:{short:14,medium:8,long:1,infantry:8,objective:13,mixed:12,vehicles:17},why:"Aggressive Spec Ops destruction against vehicles, structures and objectives."},
        {id:"trcrv2",name:"TRCRV2 — Tracer Dart",group:"intel",score:{short:5,medium:11,long:12,infantry:5,objective:8,mixed:14,vehicles:18},why:"Tracks/disrupts enemy tech and helps allied anti-vehicle lock-ons."},
        {id:"hti_mk2",name:"Armament Containment System",group:"ew",score:{short:6,medium:11,long:9,infantry:7,objective:15,mixed:13,vehicles:8},why:"Electronic disruption against clusters of enemy gadgets."},
        {id:"handheld_jammer",name:"Handheld Jammer",group:"ew",score:{short:9,medium:12,long:7,infantry:9,objective:15,mixed:13,vehicles:7},why:"Season 3 electronic-warfare utility for disabling nearby enemy equipment."}
      ],
      throwables:[
        {name:"M67 Frag Grenade",score:{short:8,medium:7,long:3,infantry:9,objective:9,mixed:7,vehicles:0},why:"General-purpose lethal."},
        {name:"MTN-55 Proximity Detector",score:{short:9,medium:13,long:11,infantry:11,objective:16,mixed:14,vehicles:0},why:"Thrown local intel for rooms, objectives and elevated positions."},
        {name:"Steel Wing Throwing Knife",score:{short:13,medium:8,long:2,infantry:11,objective:8,mixed:8,vehicles:0},why:"Silent lethal; headshots kill and body hits delay health regeneration."}
      ]
    }
  },

  fallbackSecondaries:[
    {id:"p18",name:"P18",cls:"Secondary",rpm:420,mag:17,bulletVel:375,adsTime:170,tacRld:1.6,fireMode:"semi"},
    {id:"es57",name:"ES 5.7",cls:"Secondary",rpm:500,mag:20,bulletVel:600,adsTime:170,tacRld:1.7,fireMode:"semi"},
    {id:"m45a1",name:"M45A1",cls:"Secondary",rpm:360,mag:8,bulletVel:300,adsTime:180,tacRld:1.55,fireMode:"semi"},
    {id:"m44",name:"M44",cls:"Secondary",rpm:150,mag:6,bulletVel:450,adsTime:230,tacRld:2.5,fireMode:"revolver"},
    {id:"ggh22",name:"GGH-22",cls:"Secondary",rpm:400,mag:13,bulletVel:390,adsTime:180,tacRld:1.7,fireMode:"semi"},
    {id:"m357",name:"M357 TRAIT",cls:"Secondary",rpm:190,mag:8,bulletVel:430,adsTime:220,tacRld:2.35,fireMode:"revolver"},
    {id:"vz61",name:"vz. 61",cls:"Secondary",rpm:850,mag:20,bulletVel:300,adsTime:170,tacRld:1.85,fireMode:"auto"}
  ],

  secondaryRoles:{
    "vz. 61": {short:22,medium:9,long:-3,complementLong:24,why:"Full-auto machine pistol is the emergency close-range answer for a slow long-range primary."},
    "M44": {short:2,medium:8,long:17,complementShort:21,why:"Hand cannon with the best ranged sidearm potential; good complement to a close-range primary."},
    "M357 TRAIT": {short:4,medium:10,long:15,complementShort:18,why:"High per-shot revolver damage with more capacity than the M44."},
    "ES 5.7": {short:9,medium:17,long:12,complementShort:13,complementLong:9,why:"High-capacity, high-velocity balanced sidearm."},
    "P18": {short:13,medium:15,long:7,complementLong:11,why:"Reliable all-purpose backup."},
    "GGH-22": {short:9,medium:13,long:11,complementShort:11,why:"Balanced semi-auto with stronger ranged behavior."},
    "M45A1": {short:12,medium:10,long:5,complementLong:10,why:"Hard-hitting .45 sidearm for finishing close threats."}
  }
};