#!/usr/bin/env node
/**
 * MUTATION TESTING — does the gate suite actually catch a wrong number?
 *
 * Every gate in this repository passes. That is evidence the code is consistent with
 * itself; it is not evidence the gates would notice if something broke. This harness
 * settles that empirically: it introduces one controlled fault at a time, runs the
 * gates, and records which gate (if any) caught it.
 *
 * A mutation that SURVIVES every gate is a real hole in the test suite, and is reported
 * as such rather than explained away.
 *
 * SAFETY - this file edits tracked source files, so it is built to make leaving a
 * mutation behind as close to impossible as it can be:
 *
 *   1. It REFUSES to start unless the working tree is clean.
 *   2. Each target file's exact bytes are held in memory before mutation and written
 *      back in a `finally`, so a thrown error still restores.
 *   3. After restoring, the file's SHA-256 is compared with the original. A mismatch
 *      is a hard abort with a loud instruction to run `git checkout --`.
 *   4. SIGINT/SIGTERM restore before exiting.
 *   5. At the end, the working tree must be clean again except for this run's report.
 *      If it is not, the run fails no matter how the mutations went.
 *
 * GATE ORDER - gates run cheapest-first and stop at the first one that fails. A caught
 * mutation is caught; paying 120s for the exhaustive optimizer to re-confirm what a
 * 70ms gate already found would mean running far fewer mutations overall. The full
 * suite IS run for any mutation nothing cheaper catches, so an "escaped" verdict is
 * always backed by the complete suite.
 *
 * Usage:
 *   node scripts/mutation-test.mjs                 run all mutations
 *   node scripts/mutation-test.mjs --only <id,id>  run a subset
 *   node scripts/mutation-test.mjs --list          list mutations and exit
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const sha = b => createHash('sha256').update(b).digest('hex');
const argv = process.argv.slice(2);
const argValue = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };

// ---------------------------------------------------------------------------
// GATES, cheapest first. Cost figures are measured on this machine and are only
// used for ordering.
// ---------------------------------------------------------------------------
const GATES = [
  ['audit-source-integrity', ['scripts/audit-source-integrity.mjs']],
  ['audit-redsec-model-integrity', ['scripts/audit-redsec-model-integrity.mjs']],
  ['audit-ranking-policy-pin', ['scripts/audit-ranking-policy-pin.mjs']],
  ['audit-provenance-consistency', ['scripts/audit-provenance-consistency.mjs']],
  ['audit-cache-recompute', ['scripts/audit-cache-recompute.mjs']],
  ['audit-ballistic-ttk', ['scripts/audit-ballistic-ttk.mjs']],
  ['audit-priority-wiring', ['scripts/audit-priority-wiring.mjs']],
  ['audit-redsec-armor', ['scripts/audit-redsec-armor.mjs']],
  ['audit-source-reconciliation', ['scripts/audit-source-reconciliation.mjs']],
  ['audit-attachment-names', ['scripts/audit-attachment-names.mjs', '--check']],
  ['audit-state-collisions', ['scripts/audit-state-collisions.mjs']],
  ['audit-freshness-watchers', ['scripts/audit-freshness-watchers.mjs']],
  ['audit-source-overlay', ['scripts/audit-source-overlay.mjs']],
  ['audit-source-data', ['scripts/audit-source-data.mjs']],
  ['audit-current-patch-coverage', ['scripts/audit-current-patch-coverage.mjs']],
  ['audit-roster-sets', ['scripts/audit-roster-sets.mjs']],
  ['audit-global', ['scripts/audit-global.mjs']],
  ['audit-manual-weapon', ['scripts/audit-manual-weapon.mjs']],
  ['audit-range-optics', ['scripts/audit-range-optics.mjs']],
  ['audit-laserbeam-meta', ['scripts/audit-laserbeam-meta.mjs']],
  ['audit-optimizer-legality', ['scripts/audit-optimizer-legality.mjs']],
  ['audit-freshness', ['scripts/audit-freshness.mjs']],
  ['audit-patch-reconciliation', ['scripts/audit-patch-reconciliation.mjs']],
  ['build-source-overlay--check', ['scripts/build-source-overlay.mjs', '--check']],
  ['audit-advanced-options', ['scripts/audit-advanced-options.mjs']],
  ['audit-engine-crosscheck', ['scripts/audit-engine-crosscheck.mjs']],
  ['validate-combat-cache', ['scripts/validate-combat-cache.mjs', 'data/combat-cache.json', 'data/source-manifest.json']],
  ['audit-name-honesty', ['scripts/audit-name-honesty.mjs']],
  ['audit-field-impact', ['scripts/audit-field-impact.mjs']],
  ['audit-eligibility-consistency', ['scripts/audit-eligibility-consistency.mjs']],
  ['audit-mode-isolation', ['scripts/audit-mode-isolation.mjs']],
  ['audit-cache-identity', ['scripts/audit-cache-identity.mjs']],
  ['audit-invariants', ['scripts/audit-invariants.mjs']],
  ['audit-meta-sweep', ['scripts/audit-meta-sweep.mjs']],
  ['audit-beam-sensitivity', ['scripts/audit-beam-sensitivity.mjs']],
  ['audit-state-space', ['scripts/audit-state-space.mjs', '--quick']],
  ['audit-optimizer-exhaustive', ['scripts/audit-optimizer-exhaustive.mjs', '--full']]
];

/**
 * EFFECTIVENESS PROBE — is the mutation observable at all?
 *
 * Reporting "no gate caught it" is only meaningful if the mutation changed something.
 * A mutation that alters a value nothing reads is INERT, and calling that a gate gap
 * would be a false accusation against the test suite. This measures two signatures:
 *
 *   CACHED     what a user sees right now, through the exhaustive cache.
 *   ON-DEMAND  what the engine computes with the cache bypassed - the path a cache
 *              REBUILD would follow.
 *
 * The distinction produces a third verdict beyond caught/escaped: LATENT. The
 * BASE_WEIGHTS mutation is the worked example - it moves nothing today because the
 * cache short-circuits the optimizer, but it would silently change every recommended
 * build on the next Combat Engine run. "Invisible now, effective after a rebuild" is
 * the most dangerous shape a change can have, and it deserves its own name.
 */
const PROBE = `
import { bootLab } from './scripts/lab-harness.mjs';
const { diag, window: win } = await bootLab();
const roster = (win.BF6_CURRENT?.roster ?? []).filter(w => w.cls !== 'Secondary');
const cached = [];
// multiplayer/plates2 is included deliberately even though the UI cannot select it:
// it is the query that would EXPOSE a REDSEC armour rule leaking into Multiplayer.
// Without it, a leak mutation looks inert when it is merely unreachable through the UI.
for (const [gm, ta] of [['multiplayer','unarmored'],['multiplayer','plates2'],['redsec','unarmored'],['redsec','plates2']]) {
  for (const priority of ['balanced','fastest']) {
    for (const d of [1, 10, 25, 50, 100, 200, 300]) {
      const s = diag.snapshot({ gameMode: gm, targetArmor: ta, category: '__all__', distance: d, priority, mode: 'auto', topN: 5 });
      cached.push([gm, ta, priority, d, s.top?.map(t => [t.id, t.btk, t.triggerTtk, t.beamIndex]), s.build?.points, s.build?.picks?.map(p => p.id)]);
    }
  }
}
const onDemand = [];
for (const w of roster) {
  for (const d of [10, 50, 200]) {
    const b = diag.optimizer.dpBuild(w.id, d);
    onDemand.push([w.id, d, b?.points ?? null, b?.picks?.map(p => p.slot + '=' + p.id) ?? null, b?.score ?? null]);
    const raw = diag.rawWeapon(w.id);
    if (raw) onDemand.push([w.id, 'raw', raw.rpm, raw.bulletVel, raw.recoilV, raw.spreadMax]);
  }
}
process.stdout.write(JSON.stringify({ cached, onDemand }));
`;

function probeSignatures() {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', PROBE], { encoding: 'utf8', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout) return { error: `probe failed: ${(r.stderr || '').split('\n').filter(Boolean).slice(-2).join(' | ')}` };
  try {
    const o = JSON.parse(r.stdout);
    return { cached: sha(JSON.stringify(o.cached)), onDemand: sha(JSON.stringify(o.onDemand)) };
  } catch (e) { return { error: `probe output unparseable: ${String(e.message)}` }; }
}

// ---------------------------------------------------------------------------
// MUTATION HELPERS
// ---------------------------------------------------------------------------
/** Replace the first occurrence of `find` with `replace`; throw if absent. */
function patch(file, find, replace) {
  const src = readFileSync(file, 'utf8');
  if (!src.includes(find)) throw new Error(`mutation anchor not found in ${file}: ${String(find).slice(0, 90)}`);
  writeFileSync(file, src.replace(find, replace));
}
/** Mutate a JSON file through a callback. */
function patchJson(file, fn) {
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  const out = fn(doc) ?? doc;
  // Match each file's committed indentation so the diff is the value, not the format.
  const indent = readFileSync(file, 'utf8').startsWith('{\n  ') ? 2 : 1;
  writeFileSync(file, JSON.stringify(out, null, indent) + '\n');
}
const weaponIn = (doc, id) => doc.find(w => w.id === id);

// ---------------------------------------------------------------------------
// THE MUTATIONS
//
// `expect` names the gate I predict will catch it. It is recorded and compared, but
// the verdict is decided by what ACTUALLY fired - a mutation caught by an unexpected
// gate is still caught, and a wrong prediction is itself worth knowing.
//
// `expectSurvive: true` marks an INVERSE test: a change that must NOT be treated as a
// combat change. For those, "no gate fired" is the passing outcome.
// ---------------------------------------------------------------------------
const MUTATIONS = [
  // ---- source data ----
  {
    id: 'weapons-recoil', files: ['data/weapons.json'], category: 'source data',
    description: 'change L110 recoil.ads.amount by +10% in the pristine upstream mirror',
    expect: 'audit-source-overlay',
    apply: () => patchJson('data/weapons.json', d => { weaponIn(d, 'l110').recoil.ads.amount *= 1.1; })
  },
  {
    id: 'weapons-damage', files: ['data/weapons.json'], category: 'source data',
    description: 'change M433 first damage tier from 26.05 to 30',
    expect: 'validate-combat-cache',
    apply: () => patchJson('data/weapons.json', d => { weaponIn(d, 'm433').dmg[0].d = 30; })
  },
  {
    id: 'weapons-velocity', files: ['data/weapons.json'], category: 'source data',
    description: 'change B36A4 bulletVel 740 -> 800',
    expect: 'audit-ballistic-ttk',
    apply: () => patchJson('data/weapons.json', d => { weaponIn(d, 'b36a4').bulletVel = 800; })
  },
  {
    id: 'weapons-rpm', files: ['data/weapons.json'], category: 'source data',
    description: 'change KORD 6P67 rpm 899.999 -> 950',
    expect: 'audit-source-reconciliation',
    apply: () => patchJson('data/weapons.json', d => { weaponIn(d, 'kord6p67').rpm = 950; })
  },
  {
    id: 'weapons-recoilv-desync', files: ['data/weapons.json'], category: 'source data',
    description: 'break the recoilV = amount * mult^exp invariant on M250 without touching its inputs',
    expect: 'audit-source-overlay',
    apply: () => patchJson('data/weapons.json', d => { weaponIn(d, 'm250').recoilV *= 1.05; })
  },

  // ---- the overlay mechanism ----
  {
    id: 'overlay-vssm-double', files: ['data/source-overlays.json'], category: 'overlay',
    description: 'THE VSSM DOUBLE TRANSFORM: overlay writes vssm.rpm = 799.999 (the full-auto rate) into the base record',
    expect: 'audit-source-overlay',
    apply: () => patchJson('data/source-overlays.json', d => {
      d.overlays[0].changes.push({ weaponId: 'vssm', path: 'rpm', from: 449.999, to: 799.999, sourceStat: 'RoF', evidence: 'INGEST_NO_ARCHIVE_ROW', affectsCombat: true, derived: null });
    })
  },
  {
    id: 'overlay-handentered', files: ['data/source-overlays.json'], category: 'overlay',
    description: 'hand-enter a value: change EF88 bulletVel target from the source 724 to 750',
    expect: 'audit-source-overlay',
    apply: () => patchJson('data/source-overlays.json', d => {
      d.overlays[0].changes.find(c => c.weaponId === 'ef88' && c.path === 'bulletVel').to = 750;
    })
  },
  {
    id: 'overlay-stale-from', files: ['data/source-overlays.json'], category: 'overlay',
    description: 'overlay expects a baseline value the mirror no longer holds (from 664 -> 665 on l115)',
    expect: 'audit-source-overlay',
    apply: () => patchJson('data/source-overlays.json', d => {
      d.overlays[0].changes.find(c => c.weaponId === 'l115' && c.path === 'bulletVel').from = 665;
    })
  },
  {
    id: 'overlay-order-reversed', files: ['data/source-overlays.json'], category: 'overlay',
    description: 'an OLDER overlay ordered AFTER the newer one, reverting a current value to its stale predecessor',
    expect: 'audit-source-overlay',
    apply: () => patchJson('data/source-overlays.json', d => {
      d.overlays.push({
        id: 'stale-1.3.3.0', order: 2, enabled: true, gameVersion: '1.3.3.0',
        publisherOfRecord: 'sym.gg', carrier: 'stale', sourceArtifact: 'data/sources/sheetonmyface-bf6-workbook.json',
        confidence: 'source-verified-current', changeCount: 1, weapons: ['l115'],
        changes: [{ weaponId: 'l115', path: 'bulletVel', from: 742, to: 664, sourceStat: 'velocity', evidence: 'INGEST_PATCH_DELTA', affectsCombat: true, derived: null }],
        excluded: []
      });
    })
  },
  {
    id: 'overlay-derived-desync', files: ['data/source-overlays.json'], category: 'overlay',
    description: 'derived recoilV in the overlay no longer reproduces from its declared rule',
    expect: 'audit-source-overlay',
    apply: () => patchJson('data/source-overlays.json', d => {
      d.overlays[0].changes.find(c => c.weaponId === 'ef88' && c.path === 'recoilV').to = 0.8;
    })
  },
  {
    id: 'overlay-disabled', files: ['data/source-overlays.json'], category: 'overlay',
    description: 'silently disable the whole 1.4.2.0 overlay, reverting every ingested value',
    expect: 'audit-source-overlay',
    apply: () => patchJson('data/source-overlays.json', d => { d.overlays[0].enabled = false; })
  },

  // ---- the frozen capture ----
  {
    id: 'capture-tampered', files: ['data/sources/sheetonmyface-bf6-workbook.json'], category: 'source capture',
    description: 'tamper with the frozen source capture (EF88 velocity 724 -> 730) without re-deriving',
    expect: 'audit-source-overlay',
    apply: () => patchJson('data/sources/sheetonmyface-bf6-workbook.json', d => { d.values['1.4.2.0']['EF88'].velocity = 730; })
  },
  {
    id: 'watch-state-drift', files: ['data/sources/workbook-watch-state.json'], category: 'source capture',
    description: 'watch-state fingerprint no longer matches the committed capture',
    expect: 'audit-freshness-watchers',
    apply: () => patchJson('data/sources/workbook-watch-state.json', d => { d.combatFingerprint = '0'.repeat(64); })
  },

  // ---- attachments / legality ----
  {
    id: 'attachment-over-budget', files: ['data/attachments.json'], category: 'attachments',
    description: 'raise a common grip cost so cached winning builds exceed the 100-point budget',
    expect: 'validate-combat-cache',
    apply: () => patchJson('data/attachments.json', d => {
      d.GRIPS.find(g => g.id === 'lp_stubby').pts = 95;
    })
  },
  {
    id: 'attachment-illegal-slot', files: ['data/attachments.json'], category: 'attachments',
    description: 'grant the VSSM a muzzle it has no compatibility for',
    expect: 'audit-optimizer-legality',
    apply: () => patchJson('data/attachments.json', d => { d.WEAPON_ATTS.vssm.muzzle = ['std_supp']; })
  },
  {
    id: 'attachment-assumed-admitted', files: ['data/attachments.json'], category: 'attachments',
    description: 'flip a wholly-assumed attachment to verified so speculative mechanics enter ranking',
    expect: 'audit-optimizer-legality',
    apply: () => patchJson('data/attachments.json', d => {
      const target = Object.values(d).filter(Array.isArray).flat().find(o => o && o.assumed === true);
      if (!target) throw new Error('no wholly-assumed attachment found to flip');
      delete target.assumed;
    })
  },

  // ---- REDSEC / mode isolation ----
  {
    id: 'redsec-armor-multiplier', files: ['data/redsec-model.json'], category: 'redsec',
    // Targets the automatic-primary chest multiplier EXPLICITLY. An earlier version
    // searched for any key matching /mult/i, which matched
    // spilloverResolutionTest.multiplierApplied - a documentation fixture - and produced
    // a genuinely inert mutation that was then wrongly reported as a gate gap. Naming
    // the field is the only way to be sure the test exercises what it claims to.
    description: 'change the REDSEC automatic-primary armour chest multiplier from 0.84 to 1.05',
    expect: 'audit-redsec-model-integrity',
    apply: () => patchJson('data/redsec-model.json', d => {
      const m = d.damageVsArmor?.chestMultipliers?.automaticPrimary;
      if (!m || m.value !== 0.84) throw new Error(`expected automaticPrimary chest multiplier 0.84, found ${m?.value}`);
      m.value = 1.05;
    })
  },
  {
    id: 'redsec-armor-hp', files: ['data/redsec-model.json'], category: 'redsec',
    description: 'change the REDSEC armour pool from 80 HP to 100 HP, breaking plates x hpPerPlate',
    expect: 'audit-redsec-model-integrity',
    apply: () => patchJson('data/redsec-model.json', d => { d.armor.battleRoyale.totalHp = 100; })
  },
  {
    id: 'redsec-leak-into-mp', files: ['app.js'], category: 'redsec',
    // Targets armorPool() specifically. An earlier version patched the first
    // `state.gameMode === "redsec"` in the file, which is a display flag - the mutation
    // was INERT and its "escape" was a false accusation against the gate suite. This
    // one removes the mode guard on the armour pool itself, so Multiplayer genuinely
    // receives an 80 HP armour layer.
    description: 'leak the REDSEC armour pool into Multiplayer by removing the mode guard in armorPool()',
    expect: 'audit-mode-isolation',
    apply: () => patch('app.js',
      'if (state.gameMode !== "redsec" || armorState === "unarmored") return null;',
      'if (armorState === "unarmored") return null;')
  },
  {
    id: 'redsec-leak-both-guards', files: ['app.js'], category: 'redsec',
    // Multiplayer is protected from REDSEC armour maths TWICE: the scenario setters
    // force targetArmor back to "unarmored" whenever the mode is not REDSEC, and
    // armorPool() independently refuses outside REDSEC. Removing either one alone is
    // provably inert - which is what defence in depth is supposed to look like, and is
    // reported as a positive finding rather than a gate gap. This removes BOTH, so the
    // leak is real, and demonstrates the gates catch it once it can actually happen.
    description: 'remove BOTH Multiplayer armour guards at once, so REDSEC armour genuinely reaches Multiplayer',
    expect: 'audit-mode-isolation',
    apply: () => {
      patch('app.js',
        'if (state.gameMode !== "redsec" || armorState === "unarmored") return null;',
        'if (armorState === "unarmored") return null;');
      const src = readFileSync('app.js', 'utf8');
      const guard = 'if (state.gameMode !== "redsec") state.targetArmor = "unarmored";';
      const count = src.split(guard).length - 1;
      if (count < 2) throw new Error(`expected at least 2 scenario-level armour guards, found ${count}`);
      writeFileSync('app.js', src.split(guard).join('/* guard removed by mutation test */'));
    }
  },

  // ---- ranking model ----
  {
    id: 'ranking-weight', files: ['app.js'], category: 'ranking',
    description: 'change the medium-range recoil weight in BASE_WEIGHTS from 5.5 to 8.0',
    expect: 'audit-laserbeam-meta',
    apply: () => patch('app.js', 'medium: { ads:3.5, move:4.0, recoil:5.5', 'medium: { ads:3.5, move:4.0, recoil:8.0')
  },

  // ---- provenance / freshness claims ----
  {
    id: 'freshness-false-promote', files: ['data/freshness-status.json'], category: 'provenance',
    description: 'promote verified combat version to the live version with no ledger support',
    expect: 'audit-patch-reconciliation',
    apply: () => patchJson('data/freshness-status.json', d => {
      d.verified.gameVersion = '1.4.2.5'; d.verified.reconciledThrough = '1.4.2.5'; d.verified.blockedAt = null;
    })
  },
  {
    id: 'manifest-hash-drift', files: ['data/source-manifest.json'], category: 'provenance',
    description: 'alter the recorded source hash without any source change',
    expect: 'validate-combat-cache',
    apply: () => patchJson('data/source-manifest.json', d => { d.sha256['weapons.json'] = 'f'.repeat(64); })
  },
  {
    id: 'ledger-false-bridge', files: ['data/patch-delta-ledger.json'], category: 'provenance',
    description: 'falsely declare 1.4.2.0 to carry no numeric weapon-stat change, bridging over a patch that did',
    expect: 'audit-source-data',
    apply: () => patchJson('data/patch-delta-ledger.json', d => {
      d.patches.find(p => p.version === '1.4.2.0').numericWeaponStatDelta = false;
    })
  },

  // ---- generated artifacts ----
  {
    id: 'cache-handedited-ttk', files: ['data/combat-cache.json'], category: 'generated cache',
    description: 'hand-edit a cached TTK value so the cache disagrees with the engine',
    expect: 'audit-cache-identity',
    apply: () => {
      const f = 'data/combat-cache.json';
      const doc = JSON.parse(readFileSync(f, 'utf8'));
      doc.weapons.m433.best['25'].ttk = 111;
      writeFileSync(f, JSON.stringify(doc));
    }
  },
  {
    id: 'cache-wrong-source-commit', files: ['data/combat-cache.json'], category: 'generated cache',
    description: 'cache internally valid but stamped with a different upstream commit',
    expect: 'audit-cache-identity',
    apply: () => {
      const f = 'data/combat-cache.json';
      const doc = JSON.parse(readFileSync(f, 'utf8'));
      doc.source.commit = 'deadbeef' + '0'.repeat(32);
      writeFileSync(f, JSON.stringify(doc));
    }
  },

  // ---- INVERSE TESTS: these must NOT be treated as combat changes ----
  {
    id: 'naming-only-change', files: ['data/attachment-name-audit.json'], category: 'inverse',
    expectSurvive: true,
    description: 'INVERSE: change a display-only attachment name field; no combat gate may fire',
    expect: '(none - display only)',
    apply: () => patchJson('data/attachment-name-audit.json', d => {
      const r = d.attachments.find(a => a.verificationStatus === 'SOURCE_CORROBORATED');
      r.notes = (r.notes ?? '') + ' [mutation-test display-only edit]';
    })
  },
  {
    id: 'report-timestamp-only', files: ['reports/overnight/meta-sweep.json'], category: 'inverse',
    expectSurvive: true,
    description: 'INVERSE: bump a generated report timestamp; no combat gate may fire',
    expect: '(none - timestamp only)',
    apply: () => patchJson('reports/overnight/meta-sweep.json', d => { d.generatedAt = '2000-01-01T00:00:00.000Z'; })
  }
];

// ---------------------------------------------------------------------------
// HARNESS
// ---------------------------------------------------------------------------
if (argv.includes('--list')) {
  for (const m of MUTATIONS) console.log(`${m.id.padEnd(28)} ${m.category.padEnd(16)} ${m.description}`);
  process.exit(0);
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();

/**
 * Files the gates themselves rewrite on every run (they stamp a fresh generatedAt).
 * Requiring these to be pristine would make the harness unrunnable, so they are
 * excluded from the cleanliness rule - and restored with `git checkout` at the end so
 * the run leaves nothing behind either way. Everything ELSE must be clean before and
 * after; that is the rule that actually protects source and data.
 */
const GENERATED = [
  /^reports\//,
  /^data\/source-verification\.json$/,
  /^data\/current-patch-coverage\.json$/,
  /^data\/[a-z]+-audit-runtime\.json$/
];
const isGenerated = p => GENERATED.some(re => re.test(p));
/**
 * Modified/deleted TRACKED files that are not generated artifacts.
 *
 * Untracked files (`??`) are deliberately not counted: a mutation only ever edits an
 * existing tracked file, so an untracked file cannot be a mutation left behind, and
 * counting them would make the harness refuse to run while it is itself uncommitted.
 */
const dirtySourceFiles = () => git('status', '--porcelain')
  .split('\n').filter(Boolean)
  .filter(l => !l.startsWith('??'))
  .map(l => l.trim())
  .filter(l => !isGenerated(l.replace(/^\S+\s+/, '')));

const startDirty = dirtySourceFiles();
if (startDirty.length) {
  console.error('REFUSING TO RUN: source or data files are modified.\n  ' + startDirty.join('\n  '));
  console.error('\nMutation testing edits tracked files. It only runs from a clean tree so that\nanything left behind is unambiguous. Generated reports are exempt; these are not.');
  process.exit(2);
}

/** Exact bytes of every file a mutation touches, so restoration is byte-perfect. */
function snapshot(files) {
  return files.map(f => ({ file: f, buf: readFileSync(f), hash: sha(readFileSync(f)) }));
}
function restore(snap) {
  for (const s of snap) {
    writeFileSync(s.file, s.buf);
    const now = sha(readFileSync(s.file));
    if (now !== s.hash) {
      console.error(`\nFATAL: could not restore ${s.file} (hash ${now} != ${s.hash}).`);
      console.error(`Run:  git checkout -- ${s.file}`);
      process.exit(3);
    }
  }
}

let active = null;
const emergency = () => { if (active) { try { restore(active); } catch {} } };
process.on('SIGINT', () => { emergency(); process.exit(130); });
process.on('SIGTERM', () => { emergency(); process.exit(143); });
process.on('uncaughtException', e => { emergency(); console.error(e); process.exit(1); });

function runGate([name, args]) {
  const r = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: 600000 });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  return { name, failed: r.status !== 0, status: r.status, tail: output.split('\n').filter(Boolean).slice(-4).join(' | ').slice(0, 400) };
}

const only = argValue('--only')?.split(',').map(s => s.trim());
const selected = only ? MUTATIONS.filter(m => only.includes(m.id)) : MUTATIONS;

const results = [];
console.log(`mutation testing — ${selected.length} mutations, ${GATES.length} gates, cheapest-first with early stop`);
process.stderr.write('measuring the clean baseline signature ... ');
const CLEAN = probeSignatures();
if (CLEAN.error) { console.error(`\nFATAL: could not measure the clean baseline (${CLEAN.error}). Every effectiveness verdict would be meaningless.`); process.exit(4); }
process.stderr.write('ok\n');
console.log(`baseline: cached ${CLEAN.cached.slice(0, 12)}  on-demand ${CLEAN.onDemand.slice(0, 12)}\n`);

for (const m of selected) {
  const snap = snapshot(m.files);
  active = snap;
  const t0 = Date.now();
  let applyError = null;
  const gatesRun = [];
  let caughtBy = null;
  let effect = null;

  try {
    try { m.apply(); }
    catch (e) { applyError = String(e.message || e); }

    if (!applyError) {
      // Measure observability BEFORE the gates, so an escape can be told apart from a
      // mutation that changed nothing anyone reads.
      effect = probeSignatures();
      for (const g of GATES) {
        const r = runGate(g);
        gatesRun.push(r.name);
        if (r.failed) { caughtBy = r; break; }
      }
    }
  } finally {
    restore(snap);
    active = null;
  }

  const changedCached = effect && !effect.error && effect.cached !== CLEAN.cached;
  const changedOnDemand = effect && !effect.error && effect.onDemand !== CLEAN.onDemand;
  const observable = changedCached || changedOnDemand;

  const verdict = applyError ? 'ERROR'
    : m.expectSurvive ? (caughtBy ? 'FAIL' : 'PASS')
    : caughtBy ? 'CAUGHT'
    // Nothing caught it. Whether that is a gap depends on whether it does anything.
    : changedCached ? 'ESCAPED'
    : changedOnDemand ? 'LATENT'
    : 'INERT';

  results.push({
    id: m.id, category: m.category, description: m.description, files: m.files,
    expectedGate: m.expect, expectSurvive: !!m.expectSurvive,
    actualGate: caughtBy?.name ?? null, actualGateOutput: caughtBy?.tail ?? null,
    gatesRun: gatesRun.length, gatesRunNames: gatesRun,
    predictionCorrect: caughtBy ? caughtBy.name === m.expect : m.expectSurvive === true,
    observable, changedCachedResults: !!changedCached, changedOnDemandResults: !!changedOnDemand,
    probeError: effect?.error ?? null,
    verdict, applyError, ms: Date.now() - t0
  });

  const mark = { CAUGHT: 'ok  ', PASS: 'ok  ', INERT: 'inert', ESCAPED: 'GAP ', LATENT: 'LATENT', FAIL: 'FAIL', ERROR: 'ERR ' }[verdict] ?? '?   ';
  const eff = applyError ? '' : ` [cached ${changedCached ? 'moved' : 'same'}, on-demand ${changedOnDemand ? 'moved' : 'same'}]`;
  console.log(`${mark.padEnd(6)} ${m.id.padEnd(28)} ${verdict.padEnd(8)} by ${String(caughtBy?.name ?? '-').padEnd(30)}${eff} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  if (applyError) console.log(`     apply error: ${applyError}`);
}

// The tree MUST be clean again. This is checked independently of every per-file
// restore above, because "each file matched its hash" and "git sees no change" are
// different claims and only the second one is what actually ships.
const strayEdits = dirtySourceFiles();
if (strayEdits.length) {
  console.error('\nFATAL: source or data files are modified after the run:\n  ' + strayEdits.join('\n  '));
  console.error('Run: git checkout -- .');
  process.exit(3);
}
// Gates rewrote the generated artifacts (with mutated inputs, in some cases). Put them
// back so the run leaves the repository exactly as it found it.
try { git('checkout', '--', 'reports', 'data'); } catch { /* nothing to restore */ }

const caught = results.filter(r => r.verdict === 'CAUGHT').length;
const escaped = results.filter(r => r.verdict === 'ESCAPED');
const latent = results.filter(r => r.verdict === 'LATENT');
const inert = results.filter(r => r.verdict === 'INERT');
const inverseOk = results.filter(r => r.expectSurvive && r.verdict === 'PASS').length;
const inverseBad = results.filter(r => r.expectSurvive && r.verdict === 'FAIL');
const errors = results.filter(r => r.verdict === 'ERROR');

const report = {
  generatedAt: new Date().toISOString(),
  method: 'One controlled fault at a time, applied to a clean tree, gates run cheapest-first with early stop on the first failure. A mutation nothing catches has been run against the COMPLETE suite.',
  gateCount: GATES.length,
  gateOrder: GATES.map(g => g[0]),
  mutations: selected.length,
  verdicts: {
    CAUGHT: 'a gate failed on it',
    ESCAPED: 'nothing caught it AND it changes what users see now - a real gap',
    LATENT: 'nothing caught it and it changes nothing today, but it WOULD change results after a cache rebuild - the most dangerous shape, because the history stays green until long after the cause',
    INERT: 'nothing caught it because it changes nothing observable at all - not a gate gap',
    PASS: 'inverse test: a non-combat change correctly triggered no combat gate',
    FAIL: 'inverse test: a non-combat change wrongly triggered a combat gate'
  },
  baselineSignature: { cached: CLEAN.cached, onDemand: CLEAN.onDemand },
  summary: {
    caught, escaped: escaped.length, latent: latent.length, inert: inert.length,
    inversePassed: inverseOk, inverseFailed: inverseBad.length, applyErrors: errors.length,
    predictionAccuracy: `${results.filter(r => r.predictionCorrect).length}/${results.length}`
  },
  escapedMutations: escaped.map(r => ({ id: r.id, description: r.description, category: r.category })),
  latentMutations: latent.map(r => ({ id: r.id, description: r.description, category: r.category })),
  inertMutations: inert.map(r => ({ id: r.id, description: r.description, category: r.category })),
  results
};
await mkdir('reports/validation', { recursive: true });
await writeFile('reports/validation/mutation-test.json', JSON.stringify(report, null, 1));

console.log(`\n${'='.repeat(78)}`);
console.log(`caught ${caught}   escaped ${escaped.length}   latent ${latent.length}   inert ${inert.length}   inverse ${inverseOk}/${inverseOk + inverseBad.length}   errors ${errors.length}`);
console.log(`gate prediction accuracy: ${report.summary.predictionAccuracy}`);
if (escaped.length) {
  console.log('\nESCAPED — nothing caught these AND they change what users see now:');
  for (const r of escaped) console.log(`  ${r.id.padEnd(28)} ${r.description}`);
}
if (latent.length) {
  console.log('\nLATENT — nothing caught these; they change nothing today but WOULD after a cache rebuild:');
  for (const r of latent) console.log(`  ${r.id.padEnd(28)} ${r.description}`);
}
if (inert.length) {
  console.log('\nINERT — nothing caught these because they change nothing observable. NOT gate gaps:');
  for (const r of inert) console.log(`  ${r.id.padEnd(28)} ${r.description}`);
}
if (inverseBad.length) {
  console.log('\nINVERSE TEST FAILURES — a non-combat change triggered a combat gate:');
  for (const r of inverseBad) console.log(`  ${r.id.padEnd(28)} caught by ${r.actualGate}`);
}
console.log('\nwrote reports/validation/mutation-test.json');
console.log('working tree verified clean; no mutation left behind.');

// Escapes are findings to act on, not build failures - this harness is a measurement
// tool. Inverse-test failures and apply errors ARE defects in the harness or the repo.
process.exitCode = (inverseBad.length || errors.length) ? 1 : 0;
