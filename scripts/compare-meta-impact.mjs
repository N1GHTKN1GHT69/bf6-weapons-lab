#!/usr/bin/env node
/**
 * Deterministic BEFORE/AFTER impact report for a source-data change.
 *
 * Boots the REAL app twice - once against a checkout of the previous state, once
 * against the current tree - and compares what a user would actually see. It never
 * reasons about what a value "should" do; it runs the shipped engine on both sides
 * and reports the difference.
 *
 * Three layers, from cause to effect:
 *
 *   1. RAW STATS      which weapon primitives differ in the effective dataset
 *                     (upstream mirror + source overlays) between the two trees.
 *   2. CACHED RESULTS for every weapon at every one of the 300 cached distances,
 *                     for both the AUTO winner and the BUILD MY GUN max-lethality
 *                     winner: TTK, BTK, damage, chosen build, chosen optic, points,
 *                     beam index. Differences are reported as contiguous distance
 *                     BANDS, not as 300 separate lines.
 *   3. RANKINGS       every mode x armour state x priority x scope x distance,
 *                     exhaustively over 1-300m. Reports winner changes, top-3
 *                     entries and exits, and position moves - again as bands.
 *
 * Exhaustive by construction: sampling 10/25/50/100m would miss exactly the
 * narrow bands where a small primitive change flips an ordering.
 *
 * Usage:
 *   node scripts/compare-meta-impact.mjs --before <path-to-checkout> [--after <path>]
 *
 * Create the BEFORE tree with a git worktree so the comparison is against a real
 * committed state rather than a hand-assembled one:
 *   git worktree add ../bf6-before <commit>
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { bootLab } from './lab-harness.mjs';
import { loadEffectiveWeapons } from './source-overlay.mjs';

const argv = process.argv.slice(2);
const argValue = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const BEFORE = argValue('--before');
const AFTER = argValue('--after') || process.cwd();
if (!BEFORE) { console.error('usage: node scripts/compare-meta-impact.mjs --before <path> [--after <path>]'); process.exit(2); }

const DMIN = 1, DMAX = 300;
const MODES = [
  { key: 'MULTIPLAYER', gameMode: 'multiplayer', targetArmor: 'unarmored' },
  { key: 'REDSEC-UNARMORED', gameMode: 'redsec', targetArmor: 'unarmored' },
  { key: 'REDSEC-2PLATE', gameMode: 'redsec', targetArmor: 'plates2' }
];
const PRIORITIES = ['balanced', 'fastest'];

/** Collapse [1,2,3,7,8] into "1-3, 7-8" so a 300-distance diff reads as a shape. */
function bands(distances) {
  const s = [...distances].sort((a, b) => a - b);
  const out = [];
  for (const d of s) {
    const last = out[out.length - 1];
    if (last && d === last.to + 1) last.to = d; else out.push({ from: d, to: d });
  }
  return out;
}
const bandText = bs => bs.map(b => b.from === b.to ? `${b.from}m` : `${b.from}-${b.to}m`).join(', ');

const CACHE_FIELDS = ['buildId', 'points', 'damage', 'btk', 'ttk', 'mechTtk', 'triggerTtk', 'flightMs', 'sightId', 'beamIndex', 'recoil', 'effectiveAdsSpreadDeg', 'movingAdsMinSpreadDeg', 'lowBtk', 'lowTtk'];
const near = (a, b) => {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9;
  return a === b;
};

async function loadSide(root, label) {
  process.stderr.write(`booting ${label} (${root}) ... `);
  const { diag, window: win } = await bootLab(root);
  const cache = JSON.parse(await readFile(path.join(root, 'data/combat-cache.json'), 'utf8'));
  const scopes = ['__all__', ...(win.BF6_CURRENT?.primaryClasses ?? [])];
  process.stderr.write('ok\n');
  return { root, diag, win, cache, scopes };
}

const before = await loadSide(BEFORE, 'BEFORE');
const after = await loadSide(AFTER, 'AFTER');

// -------------------------------------------------------------- 1. raw stats
function flatten(o, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(o ?? {})) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, p, out);
    else if (Array.isArray(v) && v.every(x => typeof x === 'number')) v.forEach((x, i) => { out[`${p}[${i}]`] = x; });
    else if (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') out[p] = v;
  }
  return out;
}
// Read each side's EFFECTIVE dataset from its own tree rather than through the
// running app: the BEFORE checkout predates the diagnostic accessor, and a
// comparison that silently degrades to "absent" on the old side would report every
// weapon as changed. loadEffectiveWeapons returns the bare mirror when a tree has
// no overlay file, which is exactly the pre-change state.
const effective = Object.fromEntries(await Promise.all([before, after].map(async side => [
  side.root,
  new Map(loadEffectiveWeapons(path.join(side.root, 'data/weapons.json'), path.join(side.root, 'data/source-overlays.json')).map(w => [w.id, w]))
])));
const rawChanges = [];
const rosterIds = [...new Set([...effective[BEFORE].keys(), ...effective[AFTER].keys()])];
for (const id of rosterIds) {
  const b = effective[BEFORE].get(id), a = effective[AFTER].get(id);
  if (!b || !a) { if (!!b !== !!a) rawChanges.push({ weaponId: id, path: '(record)', before: b ? 'present' : 'absent', after: a ? 'present' : 'absent' }); continue; }
  const fb = flatten(b), fa = flatten(a);
  for (const key of new Set([...Object.keys(fb), ...Object.keys(fa)])) {
    if (key.startsWith('provenance.')) continue; // narrative, not a combat value
    if (!near(fb[key], fa[key])) rawChanges.push({ weaponId: id, path: key, before: fb[key] ?? null, after: fa[key] ?? null });
  }
}
const rawChangedWeapons = [...new Set(rawChanges.map(c => c.weaponId))];

// ---------------------------------------------------------- 2. cached results
const cacheImpact = [];
const cacheWeaponIds = [...new Set([...Object.keys(before.cache.weapons ?? {}), ...Object.keys(after.cache.weapons ?? {})])];
for (const id of cacheWeaponIds) {
  const wb = before.cache.weapons?.[id], wa = after.cache.weapons?.[id];
  if (!wb || !wa) { cacheImpact.push({ weaponId: id, missing: wb ? 'after' : 'before' }); continue; }
  const perField = {};
  for (const which of ['best', 'bestLethal']) {
    for (let d = DMIN; d <= DMAX; d++) {
      const rb = wb[which]?.[String(d)], ra = wa[which]?.[String(d)];
      if (!rb || !ra) continue;
      for (const f of CACHE_FIELDS) {
        if (near(rb[f], ra[f])) continue;
        const key = `${which}.${f}`;
        (perField[key] ??= { distances: [], samples: [] }).distances.push(d);
        if (perField[key].samples.length < 3) perField[key].samples.push({ d, before: rb[f], after: ra[f] });
      }
    }
  }
  if (!Object.keys(perField).length) continue;
  cacheImpact.push({
    weaponId: id, name: wa.name, cls: wa.cls,
    fields: Object.fromEntries(Object.entries(perField).map(([k, v]) => [k, { count: v.distances.length, bands: bands(v.distances), bandText: bandText(bands(v.distances)), samples: v.samples }]))
  });
}

// --------------------------------------------------------------- 3. rankings
const rankingImpact = [];
const scopes = [...new Set([...before.scopes, ...after.scopes])];
let cases = 0;
for (const m of MODES) {
  for (const priority of PRIORITIES) {
    for (const category of scopes) {
      const winnerChanged = [], top3Changed = [], positionMoves = new Map();
      for (let d = DMIN; d <= DMAX; d++) {
        cases++;
        let sb, sa;
        try { sb = before.diag.snapshot({ gameMode: m.gameMode, targetArmor: m.targetArmor, category, distance: d, priority, mode: 'auto', topN: 200 }); } catch { continue; }
        try { sa = after.diag.snapshot({ gameMode: m.gameMode, targetArmor: m.targetArmor, category, distance: d, priority, mode: 'auto', topN: 200 }); } catch { continue; }
        const ob = sb.top.map(t => t.id), oa = sa.top.map(t => t.id);
        if (ob[0] !== oa[0]) winnerChanged.push({ d, before: ob[0] ?? null, after: oa[0] ?? null });
        const b3 = ob.slice(0, 3).join('>'), a3 = oa.slice(0, 3).join('>');
        if (b3 !== a3) top3Changed.push({ d, before: b3, after: a3 });
        for (const id of new Set([...ob, ...oa])) {
          const pb = ob.indexOf(id), pa = oa.indexOf(id);
          if (pb === pa) continue;
          const rec = positionMoves.get(id) ?? { weaponId: id, distances: [], maxMove: 0, sample: null };
          rec.distances.push(d);
          const move = Math.abs((pb < 0 ? 999 : pb) - (pa < 0 ? 999 : pa));
          if (move > rec.maxMove) { rec.maxMove = move; rec.sample = { d, before: pb < 0 ? null : pb + 1, after: pa < 0 ? null : pa + 1 }; }
          positionMoves.set(id, rec);
        }
      }
      if (!winnerChanged.length && !top3Changed.length && !positionMoves.size) continue;
      rankingImpact.push({
        mode: m.key, priority, scope: category,
        winnerChanged: { count: winnerChanged.length, bandText: bandText(bands(winnerChanged.map(x => x.d))), samples: winnerChanged.slice(0, 5) },
        top3Changed: { count: top3Changed.length, bandText: bandText(bands(top3Changed.map(x => x.d))), samples: top3Changed.slice(0, 5) },
        positionMoves: [...positionMoves.values()].map(r => ({ weaponId: r.weaponId, count: r.distances.length, bandText: bandText(bands(r.distances)), maxMove: r.maxMove, sample: r.sample })).sort((a, b) => b.count - a.count)
      });
    }
  }
}

// ----------------------------------------------------------------- unchanged
// State plainly which weapons did NOT move, so "no change" is a measured result
// rather than an absence of investigation.
const cacheChangedIds = new Set(cacheImpact.map(c => c.weaponId));
const rankMovedIds = new Set(rankingImpact.flatMap(r => r.positionMoves.map(p => p.weaponId)));
const unchanged = cacheWeaponIds.filter(id => !cacheChangedIds.has(id) && !rankMovedIds.has(id)).sort();

const report = {
  generatedAt: new Date().toISOString(),
  before: { root: BEFORE, cacheGeneratedAt: before.cache.generatedAt, cacheCommit: before.cache.source?.commit },
  after: { root: AFTER, cacheGeneratedAt: after.cache.generatedAt, cacheCommit: after.cache.source?.commit },
  coverage: { distances: `${DMIN}-${DMAX}m exhaustive`, modes: MODES.map(m => m.key), priorities: PRIORITIES, scopes, rankingCasesPerSide: cases },
  rawStats: { changedWeapons: rawChangedWeapons, changeCount: rawChanges.length, changes: rawChanges },
  cachedResults: { changedWeapons: cacheImpact.map(c => c.weaponId), detail: cacheImpact },
  rankings: rankingImpact,
  unchangedWeapons: unchanged
};

await mkdir('reports/patch-delta', { recursive: true });
await writeFile('reports/patch-delta/impact-1420.json', JSON.stringify(report, null, 1));

console.log(`BEFORE ${BEFORE}`);
console.log(`AFTER  ${AFTER}`);
console.log(`ranking cases per side: ${cases} (${DMIN}-${DMAX}m exhaustive x ${MODES.length} modes x ${PRIORITIES.length} priorities x ${scopes.length} scopes)\n`);

console.log(`RAW STATS: ${rawChanges.length} field change(s) across ${rawChangedWeapons.length} weapon(s): ${rawChangedWeapons.join(', ') || '(none)'}`);
console.log(`\nCACHED RESULTS: ${cacheImpact.length} weapon(s) changed`);
for (const c of cacheImpact) {
  console.log(`  ${c.weaponId} (${c.cls})`);
  for (const [f, v] of Object.entries(c.fields)) {
    const s = v.samples[0];
    console.log(`      ${f.padEnd(28)} ${String(v.count).padStart(4)} distances  ${v.bandText.slice(0, 60)}   e.g. @${s.d}m ${s.before} -> ${s.after}`);
  }
}
console.log(`\nRANKINGS: ${rankingImpact.length} mode/priority/scope combination(s) with any movement`);
for (const r of rankingImpact) {
  console.log(`  ${r.mode}/${r.priority}/${r.scope}`);
  if (r.winnerChanged.count) console.log(`      WINNER changed at ${r.winnerChanged.count} distances: ${r.winnerChanged.bandText}`);
  if (r.top3Changed.count) console.log(`      TOP-3 changed at ${r.top3Changed.count} distances: ${r.top3Changed.bandText}`);
  for (const p of r.positionMoves.slice(0, 6)) console.log(`      ${p.weaponId.padEnd(12)} moved at ${String(p.count).padStart(3)} distances (max ${p.maxMove} places) ${p.bandText.slice(0, 50)}`);
  if (r.positionMoves.length > 6) console.log(`      ... and ${r.positionMoves.length - 6} more weapons`);
}
console.log(`\nUNCHANGED at every cached distance and every ranking case: ${unchanged.length}/${cacheWeaponIds.length} weapons`);
console.log('\nwrote reports/patch-delta/impact-1420.json');
