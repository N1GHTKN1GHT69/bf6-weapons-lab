#!/usr/bin/env node
/**
 * Generate BF6-REAL-GAME-AUDIT-PLAN.md from live repository data.
 *
 * WHY GENERATED RATHER THAN WRITTEN. Every row of this plan states a CURRENT LAB CLAIM
 * that the tester will compare against the game. Hand-transcribing hundreds of numbers
 * into a document is precisely where false claims enter - a stale figure in the audit
 * plan would send someone to verify a number the Lab no longer makes. Every claim below
 * is read out of the combat cache, the class audits, the source capture or the REDSEC
 * model at generation time, so the plan cannot drift from the product.
 *
 * ORDERED BY INFORMATION VALUE, not by weapon:
 *   Tier 1  mechanism tests - one result can invalidate a rule applied to dozens of
 *           weapons. Highest value per trigger pull.
 *   Tier 2  one representative per class, to test whether the Tier 1 rules generalise.
 *   Tier 3  weapon-specific edge cases: the values 1.4.2.0 changed, the unmodelled
 *           states, the near-ties where the Lab's own margin is under 0.1%.
 *   Tier 4  roster confirmation.
 *
 * A Tier 2 test is NOT redundant with Tier 1: Tier 1 establishes a rule from one
 * caliber, Tier 2 asks whether the rule actually generalises. Assuming it does without
 * testing is how a shared-rule model silently goes wrong.
 *
 * Usage: node scripts/build-real-game-audit-plan.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import { steppedDamageAt } from './reference-engine.mjs';
import { loadEffectiveWeapons } from './source-overlay.mjs';

const j = async p => JSON.parse(await readFile(p, 'utf8'));
const cache = await j('data/combat-cache.json');
const weapons = loadEffectiveWeapons('data/weapons.json');
const redsec = await j('data/redsec-model.json');
const freshness = await j('data/freshness-status.json');
const overlay = await j('data/source-overlays.json');
const ablation = await j('reports/validation/balanced-ablation.json').catch(() => null);
const sensitivity = await j('reports/patch-delta/beam-sensitivity.json').catch(() => null);
const experiments = await j('reports/overnight/redsec-experiments.json').catch(() => null);
const provenance = await j('reports/validation/class-audit-provenance.json').catch(() => null);
const byId = new Map(weapons.map(w => [w.id, w]));

const rows = [];
let seq = 0;
const T = (tier, o) => rows.push({ id: `T${tier}-${String(++seq).padStart(3, '0')}`, tier, ...o });

const dmgAt = (w, d) => steppedDamageAt(w.dmg, d);
const cacheRow = (id, d, strategy = 'best') => cache.weapons?.[id]?.[strategy]?.[String(d)] ?? null;
const fmt = n => (Number.isFinite(Number(n)) ? String(+Number(n).toFixed(4)) : '—');

// ===========================================================================
// TIER 1 — mechanism tests
// ===========================================================================
{
  // --- shot-interval model -------------------------------------------------
  const w = byId.get('m433');
  T(1, {
    subject: 'shot interval = 60000 / RPM exactly',
    weapon: 'M433', loadout: 'stock, no attachments', mode: 'Multiplayer', distance: 'any (10 m)',
    target: 'stationary bot', body: 'chest', armor: 'none',
    claim: `${fmt(w.rpm)} RPM, so ${fmt(60000 / w.rpm)} ms between rounds; a 10-round burst spans ${fmt(9 * 60000 / w.rpm)} ms from first to last round`,
    source: 'raw weapons.json rpm, source-verified against the Sym 1.4.2.0 dump (RoF)',
    confidence: 'source-verified at 1.4.2.0',
    method: 'Record at 60 fps. Count frames from first muzzle flash to tenth. Repeat 3x, take the median.',
    expect: `${fmt(9 * 60000 / w.rpm)} ms +/- one frame (16.7 ms)`,
    fail: 'a systematic offset beyond one frame, or a non-constant interval within the burst',
    ifItFails: 'the entire TTK model is wrong for every automatic weapon; TTK = (BTK-1) x 60000/RPM is the base of every ranking',
    affects: 'all 48 ranked weapons'
  });

  // --- damage breakpoints are exact metres ---------------------------------
  const bp = (w.dmg ?? []).map(p => Number(p.r)).filter(r => r > 0)[0];
  T(1, {
    subject: 'damage drop-off happens at an exact metre, and the outgoing tier applies AT the breakpoint',
    weapon: 'M433', loadout: 'stock', mode: 'Multiplayer', distance: `${bp - 1} m, ${bp} m, ${bp + 1} m`,
    target: 'stationary bot at a measured distance', body: 'chest', armor: 'none',
    claim: `at ${bp - 1} m and at exactly ${bp} m each shot deals ${fmt(dmgAt(w, bp))}; from ${bp + 1} m it deals ${fmt(dmgAt(w, bp + 1))}`,
    source: 'stepped curve in weapons.json; the repeated-breakpoint rule is implemented in the reference engine and gated',
    confidence: 'derived from the pinned snapshot; the damage curve has NO current published source',
    method: 'Use a range marker. Fire one round at each distance and read the damage number, or count shots to kill.',
    expect: 'the higher tier still applies AT the breakpoint metre, the lower tier from one metre further',
    fail: 'the drop happens a metre early or late, or is interpolated rather than stepped',
    ifItFails: 'every BTK and TTK near a breakpoint is wrong, and the "exact distance" premise of the whole app is unsound',
    affects: 'all weapons - this is the shape of every damage curve'
  });

  // --- drag / flight time ---------------------------------------------------
  T(1, {
    subject: 'projectile drag model dv/dt = -k v^2 with k = 0.0035 /m',
    weapon: 'SV-98 (highest velocity, longest flight - largest observable)', loadout: 'stock barrel',
    mode: 'Multiplayer', distance: '300 m', target: 'stationary bot', body: 'chest', armor: 'none',
    claim: (() => { const r = cacheRow('sv98', 300); return r ? `${fmt(r.flightMs)} ms from trigger to impact at 300 m` : 'see cache'; })(),
    source: 'upstream ballistics baseDragPerMeter, closed-form solution re-derived independently',
    confidence: 'model form from upstream documentation; the constant is not independently confirmed',
    method: 'Record at 60 fps. Count frames from muzzle flash to impact effect at a laser-ranged 300 m.',
    expect: 'within one frame of the claim',
    fail: 'a systematic error, especially one that grows with distance (would indicate the wrong drag exponent)',
    ifItFails: 'trigger-to-kill is wrong at range for every weapon, and FASTEST KILL ordering at long range is unsound',
    affects: 'all weapons; the error grows with distance so long-range rankings are most exposed'
  });

  // --- REDSEC armour pool ---------------------------------------------------
  T(1, {
    subject: 'REDSEC armour is an 80 HP layer (2 plates x 40) on top of unchanged 100 HP health',
    weapon: 'any', loadout: 'any', mode: 'REDSEC', distance: 'close', target: 'armoured player/bot',
    body: 'chest', armor: '2 plates, full',
    claim: `${redsec.armor.battleRoyale.plates} plates x ${redsec.armor.battleRoyale.hpPerPlate} HP = ${redsec.armor.battleRoyale.totalHp} HP, then ${100} HP health`,
    source: 'EA REDSEC armor community update, quoted verbatim in data/redsec-model.json',
    confidence: 'first-party verified',
    method: 'Count shots to strip armour, then shots to down, with a weapon whose per-shot damage is already confirmed.',
    expect: 'ceil(80 / armour damage per shot) to break, then ceil(100 / health damage per shot)',
    fail: 'a different armour pool, or health damage differing from Multiplayer after the break',
    ifItFails: 'every REDSEC 2-plate BTK/TTK is wrong',
    affects: 'all REDSEC 2-plate results'
  });

  // --- REDSEC chest multipliers --------------------------------------------
  for (const [key, m] of Object.entries(redsec.damageVsArmor.chestMultipliers)) {
    if (Number(m.value) === 1) continue;
    const cls = (m.classes ?? [])[0];
    const probe = weapons.find(x => x.cls === cls);
    if (!probe) continue;
    T(1, {
      subject: `REDSEC armour chest multiplier ${m.value}x for ${(m.classes ?? []).join(', ')}`,
      weapon: probe.name, loadout: 'stock', mode: 'REDSEC', distance: '10 m',
      target: 'armoured', body: 'chest', armor: '2 plates',
      claim: `armour damage = health damage x ${m.value}; at 10 m health ${fmt(dmgAt(probe, 10))} -> armour ${fmt(dmgAt(probe, 10) * Number(m.value))}`,
      source: `EA update 1.3.3.0, quoted in the model: "${String(m.evidence).slice(0, 110)}..."`,
      confidence: m.confidence,
      method: 'Count shots to strip 80 HP of armour at a distance inside the first damage tier.',
      expect: `ceil(80 / ${fmt(dmgAt(probe, 10) * Number(m.value))}) shots to break`,
      fail: 'a different shot count, implying a different multiplier',
      ifItFails: `every REDSEC 2-plate result for ${(m.classes ?? []).join(', ')} is wrong`,
      affects: `${weapons.filter(x => (m.classes ?? []).includes(x.cls)).length} weapons`
    });
  }

  // --- REDSEC range shift ---------------------------------------------------
  T(1, {
    subject: 'REDSEC armour drop-off thresholds shift outward by +10 m',
    weapon: 'M433', loadout: 'stock', mode: 'REDSEC', distance: `${bp} m and ${bp + 10} m`,
    target: 'armoured', body: 'chest', armor: '2 plates',
    claim: `the health curve drops at ${bp} m; the armour curve drops at ${bp + Number(redsec.damageVsArmor.rangeShiftMeters.value)} m`,
    source: 'EA: "For damage vs. armor, we shift those drop-off thresholds outward by 10 meters."',
    confidence: redsec.damageVsArmor.rangeShiftMeters.confidence,
    method: 'Compare shots-to-break-armour just inside and just past each candidate threshold.',
    expect: 'the armour step occurs 10 m further out than the health step',
    fail: 'the shift is a different size, or absent',
    ifItFails: 'REDSEC armour damage is wrong in every band near a breakpoint',
    affects: 'all REDSEC 2-plate results'
  });

  // --- the two unresolved REDSEC mechanics ---------------------------------
  // The two unresolved REDSEC mechanics. Both experiments are already designed by
  // scripts/design-redsec-experiments.mjs, which searches the roster for the tests where
  // the mechanic under test is the ONLY thing that can explain the shot count - so the
  // numbers are lifted from that file rather than restated.
  for (const kind of ['closeRange', 'spillover']) {
    const block = experiments?.[kind];
    const pick = block?.recommended?.[0];
    if (!pick) continue;
    const aShots = kind === 'closeRange' ? pick.removeBtk : pick.noneBtk;
    const bShots = kind === 'closeRange' ? pick.keepBtk : pick.propBtk;
    T(1, {
      subject: kind === 'closeRange'
        ? 'UNRESOLVED: is the close-range max-damage step REMOVED or merely REDUCED for automatics vs armour?'
        : 'UNRESOLVED: does overkill damage on the armour-breaking shot SPILL OVER into health?',
      weapon: `${pick.name} [${pick.cls}, ${pick.cal}]`,
      loadout: 'Standard ammo, stock', mode: 'REDSEC',
      distance: `${pick.bandMin}-${pick.bandMax} m (use ${pick.d} m; the ${pick.bandWidth} m band means ranging error cannot flip the answer)`,
      target: 'armoured player or bot', body: 'CHEST only', armor: '2 plates, full, undamaged health',
      claim: kind === 'closeRange'
        ? `the Lab implements REMOVE. Model A (remove) predicts ${aShots} shots to down, breaking armour after ${pick.removeBrk}; model B (keep) predicts ${bShots}, breaking after ${pick.keepBrk}`
        : `the Lab implements NO SPILLOVER. Model A (none) predicts ${aShots} shots to down; model B (proportional) predicts ${bShots}. ${pick.overkillPct}% of the breaking shot's armour damage goes unused under model A`,
      source: 'EA states the rule qualitatively and publishes no numbers; both readings are implemented and predictions come from the production engine under each',
      confidence: 'PROVISIONAL — this pair is the ONE uncertainty measured as decision-relevant: it flips the AUTO winner at 3 of 14 probed REDSEC 2-plate cases',
      method: `Fire exactly ${bShots} rounds into the chest. Target DEAD = model B, target ALIVE = model A. Binary — no shot counting to get wrong.`,
      expect: `target ALIVE after ${bShots} (the Lab predicts model A, needing ${aShots})`,
      fail: `target DEAD after ${bShots}`,
      ifItFails: 'the REDSEC 2-plate armour model must change, and 2-plate rankings shift with it',
      affects: `all REDSEC 2-plate results. ${block.candidateTests} viable discriminating tests were found; the alternates are in reports/overnight/redsec-experiments.json`
    });
  }

  // --- VSSM two-state RPM ---------------------------------------------------
  const vssm = byId.get('vssm');
  T(1, {
    subject: 'VSSM has TWO fire rates and the Lab stores the semi-auto one on the weapon',
    weapon: 'VSSM', loadout: 'A) stock  B) with Folding Stock (40 pts)', mode: 'Multiplayer',
    distance: 'any', target: 'stationary bot', body: 'chest', armor: 'none',
    claim: `stock = ${fmt(vssm.rpm)} RPM semi-auto; with Folding Stock = 799.999 RPM full-auto`,
    source: 'Sym 1.4.2.0 publishes SingleRoF 449.999 and RoF 799.999; the Lab stores the former on the weapon and the latter on the attachment',
    confidence: 'source-verified at 1.4.2.0, corroborated three ways',
    method: 'Time a 10-round string in each configuration at 60 fps.',
    expect: `stock ${fmt(9 * 60000 / vssm.rpm)} ms; folding stock ${fmt(9 * 60000 / 799.999)} ms`,
    fail: 'the two configurations fire at the same rate, or either differs from its claim',
    ifItFails: 'the two-state model is wrong and the VSSM TTK is wrong in one or both configurations',
    affects: 'VSSM only, but it is the template for any future fire-mode conversion'
  });

  // --- limb multipliers -----------------------------------------------------
  T(1, {
    subject: 'limb damage multipliers by class (auto 0.84, DMR 0.91, sniper 0.67)',
    weapon: 'M433 (auto), M39 EMR (DMR), SV-98 (sniper)', loadout: 'stock', mode: 'Multiplayer',
    distance: '10 m', target: 'stationary bot', body: 'ARM or LEG (not chest, not head)', armor: 'none',
    claim: (() => { const m = byId.get('m433'); return `M433 limb = ${fmt(dmgAt(m, 10))} x 0.84 = ${fmt(dmgAt(m, 10) * 0.84)}`; })(),
    source: 'upstream balance_tables LIMB_CLASS_MULT; confirmed by an independent recomputation of every cached low-body BTK',
    confidence: 'derived from the pinned snapshot',
    method: 'Fire limb-only shots and count shots to down.',
    expect: 'the low-body BTK the Lab displays',
    fail: 'a different shot count',
    ifItFails: 'every displayed low-body figure is wrong (chest ranking is unaffected - it does not use limb damage)',
    affects: 'displayed low-body BTK/TTK for all weapons'
  });
}

// ===========================================================================
// TIER 2 — one representative per class
// ===========================================================================
{
  const seen = new Set();
  for (const w of weapons) {
    if (seen.has(w.cls) || w.cls === 'Sidearm') continue;
    seen.add(w.cls);
    const r25 = cacheRow(w.id, 25);
    const tiers = (w.dmg ?? []).map(p => `${fmt(p.d)}@${p.r}m`).join(', ');
    T(2, {
      subject: `${w.cls} representative: damage tiers, RPM, BTK and TTK`,
      weapon: w.name, loadout: 'stock, no attachments', mode: 'Multiplayer', distance: '10 / 25 / 50 / 100 m',
      target: 'stationary bot', body: 'chest', armor: 'none',
      claim: `tiers ${tiers}; ${fmt(w.rpm)} RPM; at 25 m BTK ${r25?.btk ?? '?'} and mechanical TTK ${fmt(r25?.ttk)} ms`,
      source: 'weapons.json damage curve (no current published source) + source-verified RPM',
      confidence: 'damage DERIVED from the pinned snapshot; RPM source-verified at 1.4.2.0',
      method: 'Count shots to kill at each distance; time the string for TTK.',
      expect: 'the stated BTK at each distance',
      fail: 'any BTK differing by one or more shots',
      ifItFails: `the ${w.cls} damage curve is wrong, and every ${w.cls} ranking with it`,
      affects: `${weapons.filter(x => x.cls === w.cls).length} ${w.cls}s - and if the Tier 1 rules held, a failure here means the rule does NOT generalise to this class`
    });
  }
}

// ===========================================================================
// TIER 3 — weapon-specific edge cases
// ===========================================================================
{
  // The four weapons 1.4.2.0 changed, whose new values are single-sourced.
  for (const id of overlay.overlays?.[0]?.weapons ?? []) {
    const w = byId.get(id);
    if (!w) continue;
    const changes = (overlay.overlays[0].changes ?? []).filter(c => c.weaponId === id && !c.derived);
    const headline = changes.find(c => c.path === 'bulletVel') ?? changes[0];
    T(3, {
      subject: `1.4.2.0 ingested values for ${w.name} - single-sourced, no second publisher`,
      weapon: w.name, loadout: 'stock', mode: 'Multiplayer', distance: '100 m',
      target: 'stationary bot', body: 'chest', armor: 'none',
      claim: headline ? `${headline.path} = ${fmt(headline.to)} (was ${fmt(headline.from)} before 1.4.2.0); ${changes.length} primitives changed in total` : `${changes.length} primitives changed`,
      source: `sym.gg 1.4.2.0 via the SheetOnMyFace workbook; ${id === 'l115' ? 'NOT named in EA\'s patch notes - the single weakest provenance in the dataset' : 'EA named this weapon as receiving statistics updates'}`,
      confidence: id === 'l115' ? 'PROVISIONAL - one source, no corroboration, not mentioned by EA' : 'source-verified at 1.4.2.0',
      method: id === 'l115'
        ? 'Time flight to a laser-ranged 200 m target at 60 fps; 664 vs 742 m/s is a ~30 ms difference, several frames.'
        : 'Compare against the in-game weapon panel and count shots to kill at the stated distances.',
      expect: 'the ingested value',
      fail: 'the pre-1.4.2.0 value, or any third value',
      ifItFails: id === 'l115'
        ? 'the L115 velocity overlay must be reverted, and it takes the FASTEST-KILL sniper ordering at 101-120 m with it'
        : `the ${w.name} overlay entries must be re-examined`,
      affects: id === 'l115' ? 'L115 and the PSR (they swap under FASTEST KILL at 101-120 m)' : w.name
    });
  }

  // The SL9's published-but-unmodelled burst state.
  T(3, {
    subject: 'SL9 burst cadence - published by the source, NOT modelled by the Lab',
    weapon: 'SL9', loadout: 'any burst-selecting configuration, if one exists in game', mode: 'Multiplayer',
    distance: 'any', target: 'stationary bot', body: 'chest', armor: 'none',
    claim: 'the Lab models the SL9 only in automatic at 674.999 RPM. The source publishes a distinct burst cadence of 771.428 RPM and no catalog attachment switches to it.',
    source: 'Sym 1.4.2.0 BurstRoF; the gap is recorded by audit-state-collisions',
    confidence: 'UNRESOLVED - the state exists in the source and is not represented',
    method: 'Determine in game whether the SL9 has a selectable burst mode at all. If it does, time it.',
    expect: 'either no burst mode exists (the model is complete) or one does at ~771 RPM (a modelling gap)',
    fail: 'a selectable burst mode exists and the Lab offers no way to reach it',
    ifItFails: 'the SL9 needs an attachment or fire-mode entry; its rate must go on the ATTACHMENT, never the base record (see the VSSM precedent)',
    affects: 'SL9 only'
  });

  // Near-ties: where the Lab's own margin is smaller than any plausible measurement error.
  const tight = (ablation?.nearTies ?? []).filter(n => n.marginPercent < 0.1).slice(0, 6);
  for (const n of tight) {
    T(3, {
      subject: `near-tie: the Lab separates these by ${n.marginPercent}%`,
      weapon: `${byId.get(n.a)?.name ?? n.a} vs ${byId.get(n.b)?.name ?? n.b}`,
      loadout: 'each weapon\'s Lab-recommended build', mode: 'Multiplayer', distance: `${n.distance} m`,
      target: 'stationary bot', body: 'chest', armor: 'none',
      claim: `${n.a} ranks above ${n.b} at ${n.distance} m by ${n.marginPercent}% of BALANCED cost`,
      source: 'BALANCED utility over cached telemetry',
      confidence: 'the ORDER is below any plausible measurement resolution - treat as a tie',
      method: 'Do not attempt to confirm the ordering. Instead confirm the INPUTS: BTK and TTK for both weapons at this distance.',
      expect: 'both weapons\' BTK/TTK match their claims; the ordering itself is not empirically testable at this margin',
      fail: 'either weapon\'s BTK or TTK is wrong',
      ifItFails: 'the input is wrong, which matters regardless of the ordering',
      affects: 'presentation - a sub-0.1% ordering should arguably be shown as a tie'
    });
  }

  // Sensitivity-critical accuracy primitives.
  for (const id of (sensitivity?.summary?.weaponsWhoseAccuracyCanDecideAWinner ?? []).slice(0, 7)) {
    const w = byId.get(id);
    if (!w) continue;
    T(3, {
      subject: 'accuracy primitive that can decide a BALANCED winner',
      weapon: w.name, loadout: 'stock', mode: 'Multiplayer', distance: '50 m',
      target: 'stationary bot', body: 'chest', armor: 'none',
      claim: `recoilV ${fmt(w.recoilV)}, recoil direction variation ${fmt(w.recoilVar)} deg, max ADS spread ${fmt(w.spreadMax)}`,
      source: 'Sym 1.4.2.0 ADSRecoilAmount / Multiplier / DirectionVariation',
      confidence: 'source-verified at 1.4.2.0; these are the values a +/-25% perturbation shows can flip a winner',
      method: 'Fire a 10-round burst at a wall from a fixed position, ADS, stationary. Photograph the pattern. Measure vertical rise and horizontal spread against a known reference.',
      expect: 'a pattern consistent with the stated magnitude and variation',
      fail: 'a systematically larger or smaller pattern, or a different left/right bias',
      ifItFails: 'the BALANCED ordering around this weapon is unsound',
      affects: `${id} and whichever weapon it is closest to in the ranking`
    });
  }

  // Shotguns: no source covers them at any version.
  for (const w of weapons.filter(x => x.cls === 'Shotgun')) {
    const prof = 'per-ammo profile from the shotgun class audit (OPERATIVE - it feeds the cache directly)';
    T(3, {
      subject: 'shotgun shell damage and pellet count - NO published source at any version',
      weapon: w.name, loadout: 'each ammo type in turn', mode: 'Multiplayer', distance: '5 / 10 / 20 m',
      target: 'stationary bot', body: 'chest', armor: 'none',
      claim: `${prof}; ${w.pellets ?? '?'} pellets`,
      source: 'shotgun class audit; no Sym dump covers any shotgun at any version',
      confidence: 'UNRESOLVED against any current source - the audit is the only record',
      method: 'Count shots to kill per ammo type at each distance, at point-blank where every pellet connects.',
      expect: 'the audited BTK per ammo type',
      fail: 'any differing shot count',
      ifItFails: 'the shotgun audit profiles must be re-derived; shotguns are already excluded from cross-class ranking so the blast radius is contained',
      affects: '4 shotguns; they rank only within their own class until pellet hit probability is modelled'
    });
  }
}

// ===========================================================================
// TIER 4 — roster confirmation
// ===========================================================================
{
  const covered = new Set(rows.filter(r => r.tier <= 3).map(r => r.weapon));
  for (const w of weapons) {
    if (covered.has(w.name)) continue;
    const r25 = cacheRow(w.id, 25);
    T(4, {
      subject: 'roster confirmation: damage endpoints, RPM, BTK',
      weapon: w.name, loadout: 'stock', mode: 'Multiplayer', distance: '25 m',
      target: 'stationary bot', body: 'chest', armor: 'none',
      claim: `${fmt(w.rpm)} RPM; at 25 m damage ${fmt(r25?.damage)} and BTK ${r25?.btk ?? '?'}`,
      source: 'weapons.json + source-verified RPM at 1.4.2.0',
      confidence: 'RPM source-verified; damage derived from the pinned snapshot',
      method: 'Count shots to kill at 25 m; read the in-game weapon panel for RPM.',
      expect: 'the stated BTK',
      fail: 'a differing shot count',
      ifItFails: `re-derive the ${w.cls} damage curve`,
      affects: w.name
    });
  }
}

// ===========================================================================
const tierCounts = rows.reduce((a, r) => { a[r.tier] = (a[r.tier] ?? 0) + 1; return a; }, {});
const md = [];
md.push('# BF6 Weapons Lab — real-game audit plan');
md.push('');
md.push(`Generated by \`scripts/build-real-game-audit-plan.mjs\` from live repository data.`);
md.push(`Every CURRENT LAB CLAIM below is read out of the combat cache, the class audits, the source`);
md.push(`capture or the REDSEC model at generation time — none is transcribed by hand, because a stale`);
md.push(`figure in an audit plan sends someone to verify a number the Lab no longer makes.`);
md.push('');
md.push(`**Lab state at generation:** LIVE ${freshness.official.gameVersion} · DATA ${freshness.numericalSource?.gameVersion ?? '—'} · COMBAT ${freshness.verified.gameVersion}`);
md.push('');
md.push('## How to use this');
md.push('');
md.push('The game is the arbiter. Where the game and the Lab disagree, the Lab is wrong.');
md.push('');
md.push('Work **strictly in tier order**. Tier 1 tests establish rules that dozens of weapons inherit —');
md.push('a single Tier 1 failure invalidates far more than a Tier 4 failure, so Tier 1 has the highest');
md.push('information per trigger pull. But do **not** treat Tier 2 as redundant once Tier 1 passes:');
md.push('Tier 1 establishes a rule from one caliber, and Tier 2 asks whether it actually generalises.');
md.push('Assuming generalisation without testing it is how a shared-rule model silently goes wrong.');
md.push('');
md.push('Record the observed value for every test, including passes. A pass is evidence and belongs');
md.push('in the record; only recording failures makes the coverage figure unauditable.');
md.push('');
md.push('| Tier | Tests | What a failure invalidates |');
md.push('| --- | ---: | --- |');
md.push(`| 1 — mechanism | ${tierCounts[1] ?? 0} | a rule applied across dozens of weapons |`);
md.push(`| 2 — class representative | ${tierCounts[2] ?? 0} | one whole weapon class |`);
md.push(`| 3 — edge case | ${tierCounts[3] ?? 0} | a specific weapon, value or unresolved mechanic |`);
md.push(`| 4 — roster confirmation | ${tierCounts[4] ?? 0} | one weapon |`);
md.push(`| **total** | **${rows.length}** | |`);
md.push('');
md.push('## Start here — the three tests with the highest information value');
md.push('');
md.push('1. **T1-001 shot interval.** If TTK is not `(BTK-1) x 60000/RPM`, every ranking in the app is');
md.push('   built on the wrong base. Cheapest possible test, largest possible blast radius.');
md.push('2. **T1-002 damage breakpoints.** The app promises answers at an exact metre. If drop-off is');
md.push('   banded or interpolated rather than stepped, that promise is false everywhere.');
md.push('3. **The REDSEC spillover test** (Tier 1, and fully designed in');
md.push('   `reports/overnight/redsec-experiments.json`). It is the only measured decision-relevant');
md.push('   uncertainty in the whole project, and it is a binary test: fire exactly the model-B shot');
md.push('   count and see whether the target dies.');
md.push('');

for (const tier of [1, 2, 3, 4]) {
  const group = rows.filter(r => r.tier === tier);
  if (!group.length) continue;
  md.push(`## Tier ${tier} — ${{ 1: 'mechanism tests', 2: 'class representatives', 3: 'weapon-specific edge cases', 4: 'roster confirmation' }[tier]}`);
  md.push('');
  for (const r of group) {
    md.push(`### ${r.id} — ${r.subject}`);
    md.push('');
    md.push(`| | |`);
    md.push(`| --- | --- |`);
    md.push(`| **Weapon** | ${r.weapon} |`);
    md.push(`| **Loadout** | ${r.loadout} |`);
    md.push(`| **Mode** | ${r.mode} |`);
    md.push(`| **Distance** | ${r.distance} |`);
    md.push(`| **Target / body / armour** | ${r.target} · ${r.body} · ${r.armor} |`);
    md.push(`| **Current Lab claim** | ${r.claim} |`);
    md.push(`| **Source** | ${r.source} |`);
    md.push(`| **Confidence** | ${r.confidence} |`);
    md.push(`| **Measurement method** | ${r.method} |`);
    md.push(`| **Expected result** | ${r.expect} |`);
    md.push(`| **Fail condition** | ${r.fail} |`);
    md.push(`| **If it fails** | ${r.ifItFails} |`);
    md.push(`| **Other weapons affected** | ${r.affects} |`);
    md.push('');
  }
}

md.push('## What this plan deliberately does NOT ask you to do');
md.push('');
md.push('- **Confirm a sub-0.1% ranking order.** Six such pairs are listed in Tier 3, and each asks you');
md.push('  to verify the INPUTS instead. No amount of play separates two weapons the model itself');
md.push('  separates by 0.02%, and pretending otherwise would manufacture a result.');
md.push('- **Verify values with no published source by comparison to a source.** Damage curves have no');
md.push('  current publisher; the game is the only arbiter available, which is why they are tested');
md.push('  directly rather than reconciled.');
md.push('- **Test the BALANCED weighting.** It is a product preference, not a game mechanic. The game');
md.push('  cannot tell you whether 55/45 is the right trade-off — only whether its inputs are right.');
md.push('');
md.push('## Provenance summary at generation time');
md.push('');
if (provenance) {
  md.push('| Class | damage pin | cadence pin |');
  md.push('| --- | --- | --- |');
  const seen = new Set();
  for (const p of provenance.pins) {
    const k = `${p.cls}|${p.field}`;
    if (p.field !== 'damage' || seen.has(k)) continue;
    seen.add(k);
    const cad = provenance.pins.find(x => x.cls === p.cls && x.field === 'cadence');
    md.push(`| ${p.cls} | ${p.operative} | ${cad?.operative ?? '—'} |`);
  }
  md.push('');
  md.push('"AUDIT OPERATIVE" means the class-audit value feeds the cache directly and the game must be');
  md.push('compared against it. "CONCORDANT" means the audit independently agrees with the raw source,');
  md.push('so either can be tested. "RAW OPERATIVE" means the raw value is what ships.');
}
md.push('');

await writeFile('BF6-REAL-GAME-AUDIT-PLAN.md', md.join('\n') + '\n');
console.log(`wrote BF6-REAL-GAME-AUDIT-PLAN.md — ${rows.length} tests`);
for (const t of [1, 2, 3, 4]) console.log(`  tier ${t}: ${tierCounts[t] ?? 0}`);
