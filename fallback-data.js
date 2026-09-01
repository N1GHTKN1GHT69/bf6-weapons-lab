window.BF6_FALLBACK = {
  weapons: [
    {id:"m433",name:"M433",cls:"Assault Rifle",cal:"5.56×45mm NATO",rpm:830.769,mag:31,tacRld:2.384,emptyRld:2.967,bulletVel:630,recoilV:0.793,recoilVar:41.4,adsTime:250,fireMode:"auto",damageSource:"Fallback sample — live source unavailable",dmg:[{r:0,d:26.05},{r:21,d:26.05},{r:21,d:20.67},{r:75,d:20.67}]},
    {id:"b36a4",name:"B36A4",cls:"Assault Rifle",cal:"5.56×45mm NATO",rpm:719.999,mag:31,tacRld:2.384,emptyRld:2.95,bulletVel:740,recoilV:0.726,recoilVar:28,adsTime:250,fireMode:"auto",damageSource:"Fallback sample — live source unavailable",dmg:[{r:0,d:26.05},{r:21,d:26.05},{r:21,d:20.67},{r:75,d:20.67}]},
    {id:"ak4d",name:"AK4D",cls:"Assault Rifle",cal:"7.62×51mm NATO",rpm:514.285,mag:21,tacRld:2.467,emptyRld:3.3,bulletVel:680,recoilV:0.852,recoilVar:20,adsTime:270,fireMode:"auto",damageSource:"Fallback sample — live source unavailable",dmg:[{r:0,d:35.22},{r:21,d:35.22},{r:21,d:26.05},{r:75,d:26.05}]},
    {id:"l115",name:"L115",cls:"Sniper Rifle",cal:"—",rpm:50,mag:5,tacRld:3.0,emptyRld:4.0,bulletVel:900,recoilV:1.2,recoilVar:8,adsTime:430,fireMode:"bolt",damageSource:"Fallback sample — live source unavailable",dmg:[{r:0,d:100},{r:100,d:100}]}
  ],
  attachments: {
    SIGHTS:[{id:"iron",name:"Iron Sights",sway:-1,pts:5},{id:"std_optic",name:"Standard Optic",noEffect:true,pts:10},{id:"var_low",name:"Variable Low",noEffect:true,pts:20},{id:"var_high",name:"Variable High",noEffect:true,pts:25}],
    MUZZLES:[{id:"none",name:"None",pts:0},{id:"dp_brake",name:"Double-Port Brake",adsRecoilTierMod:1,pts:10},{id:"comp_brake",name:"Compensated Brake",adsRecoilTierMod:1,adsRecoilDecayMult:1.1,pts:20},{id:"std_supp",name:"Standard Suppressor",suppressor:true,hipSpreadTierMod:1,pts:20}],
    BARRELS:[{id:"none",name:"None",pts:0,velMult:1},{id:"basic",name:"Basic",adsTimeTierMod:1,pts:10,velMult:1},{id:"short",name:"Short",adsTimeTierMod:1,hipSpreadTierMod:-1,pts:15,velMult:.8,velTierMod:-1},{id:"extended",name:"Extended",pts:5,velMult:1.25,velTierMod:1},{id:"light",name:"Light",adsTimeTierMod:1,movingAdsSpreadTierMod:1,pts:20,velMult:1}],
    GRIPS:[{id:"none",name:"None",pts:0},{id:"fold_vert",name:"Folding Vertical",adsRecoilTierMod:2,movingAdsSpreadTierMod:-1,pts:10},{id:"ribbed_stubby",name:"Ribbed Stubby",adsRecoilTierMod:2,adsTimeTierMod:1,pts:30},{id:"classic_vert",name:"Classic Vertical",adsRecoilTierMod:5,movingAdsSpreadTierMod:-1,pts:35},{id:"bipod",name:"Bipod",pts:10,noEffect:true}],
    LASERS:[{id:"none",name:"None",pts:0},{id:"50mw_violet",name:"50 MW Violet",movingAdsSpreadTierMod:1,pts:10},{id:"5mw_red",name:"5 MW Red",hipSpreadTierMod:-1,pts:10}],
    LIGHTS:[{id:"none",name:"None",pts:0},{id:"range_finder",name:"Range Finder",pts:15,noEffect:true},{id:"flashlight",name:"Flashlight",pts:10}],
    ERGOS:[{id:"none",name:"None",pts:0},{id:"mag_flare",name:"Magwell Flare",pts:10,noEffect:true},{id:"mag_catch",name:"Improved Mag Catch",pts:5,reloadSpeedMult:1.063},{id:"ads_bolt",name:"DLC Bolt",pts:30,noEffect:true},{id:"buffer",name:"Aftermarket Buffer",pts:5,visualRecoil:-1}],
    WEAPON_ATTS:{
      m433:{muzzle:["dp_brake","comp_brake","std_supp"],barrel:["basic","extended","short","light"],barrelDef:"basic",grip:["fold_vert","ribbed_stubby","classic_vert","bipod"],laser:["50mw_violet","5mw_red"],light:["flashlight"]},
      b36a4:{muzzle:["dp_brake","comp_brake","std_supp"],barrel:["basic","extended","light"],barrelDef:"basic",grip:["fold_vert","classic_vert","bipod"],laser:["50mw_violet","5mw_red"],light:["flashlight"]},
      ak4d:{muzzle:["dp_brake","comp_brake","std_supp"],barrel:["basic","extended","light"],barrelDef:"basic",grip:["fold_vert","classic_vert","bipod"],laser:["50mw_violet"],light:["flashlight"]},
      l115:{muzzle:["none"],barrel:["basic","extended"],barrelDef:"basic",grip:["bipod"],laser:[],light:[]}
    },
    WEAPON_ERGO:{m433:{avail:["mag_flare"]},b36a4:{avail:["buffer"]},ak4d:{avail:["buffer"]},l115:{avail:["mag_catch","ads_bolt"]}},
    WEAPON_MAG:{
      m433:{def:"30_rnd",mags:{"30_rnd":{name:"30 Rnd",pts:5,mag:30,adsTimeTierShift:0,sprintRecoveryTierShift:-1,adsMoveSpeedTierShift:0,reloadSpeedTier:0},"30_fast":{name:"30 Fast",pts:10,mag:30,adsTimeTierShift:0,sprintRecoveryTierShift:0,adsMoveSpeedTierShift:0,reloadSpeedTier:1}}},
      b36a4:{def:"30_rnd",mags:{"20_fast":{name:"20 Fast",pts:5,mag:20,adsTimeTierShift:-1,sprintRecoveryTierShift:-1,adsMoveSpeedTierShift:-2,reloadSpeedTier:1},"30_rnd":{name:"30 Rnd",pts:5,mag:30,adsTimeTierShift:0,sprintRecoveryTierShift:-1,adsMoveSpeedTierShift:0,reloadSpeedTier:0},"36_rnd":{name:"36 Rnd",pts:15,mag:36,adsTimeTierShift:0,sprintRecoveryTierShift:0,adsMoveSpeedTierShift:1,reloadSpeedTier:0}}},
      ak4d:{def:"20_rnd",mags:{"15_fast":{name:"15 Fast",pts:10,mag:15,adsTimeTierShift:-1,adsMoveSpeedTierShift:0,sprintRecoveryTierShift:0,reloadSpeedTier:1},"20_rnd":{name:"20 Rnd",pts:5,mag:20,adsTimeTierShift:0,sprintRecoveryTierShift:-1,adsMoveSpeedTierShift:0,reloadSpeedTier:0},"30_rnd":{name:"30 Rnd",pts:40,mag:30,adsTimeTierShift:0,adsMoveSpeedTierShift:1,sprintRecoveryTierShift:0,reloadSpeedTier:0}}},
      l115:{def:"5_rnd",mags:{"5_rnd":{name:"5 Rnd",pts:5,mag:5,adsTimeTierShift:0,sprintRecoveryTierShift:-1,adsMoveSpeedTierShift:0,reloadSpeedTier:0},"7_fast":{name:"7 Fast",pts:20,mag:7,adsTimeTierShift:0,sprintRecoveryTierShift:1,adsMoveSpeedTierShift:1,reloadSpeedTier:1}}}
    }
  },
  ammo:{
    AMMO:[{id:"standard",name:"Standard"},{id:"penetration",name:"Penetration",adsRecoilTierMod:-1},{id:"lightweight",name:"Lightweight",adsMoveSpeedTierShift:-1},{id:"long_range",name:"Long-Range"},{id:"hollow_pt",name:"Hollow Point"}],
    WEAPON_AMMO:{
      m433:{def:"standard",ammo:{standard:5,penetration:5,lightweight:10,hollow_pt:15}},
      b36a4:{def:"standard",ammo:{standard:5,penetration:5,lightweight:10,hollow_pt:15}},
      ak4d:{def:"standard",ammo:{standard:5,penetration:5,lightweight:10,hollow_pt:20}},
      l115:{def:"standard",ammo:{standard:5,penetration:5,long_range:10}}
    }
  }
};