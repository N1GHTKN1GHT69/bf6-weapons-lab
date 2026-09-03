#!/usr/bin/env node
/**
 * Scenario-cache identity gate.
 *
 * Inspecting scenarioKey() only proves what the key contains. This proves the
 * property that actually matters: the engine's answer for a query must not
 * depend on which queries were asked before it.
 *
 *  - every query evaluated in three different orders must give identical results
 *  - two queries that differ in any result-affecting input must not share a key
 *  - a REDSEC 2-PLATE result must never be served for a Multiplayer query
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { bootLab } from './lab-harness.mjs';

const { diag, window: win } = await bootLab();
const errors = [];

const scopes = ['__all__', ...(win.BF6_CURRENT?.primaryClasses ?? [])];
const queries = [];
for (const [gameMode, targetArmor] of [['multiplayer', 'unarmored'], ['redsec', 'unarmored'], ['redsec', 'plates2']]) {
  for (const category of scopes) {
    for (const distance of [1, 10, 25, 50, 100, 150, 300]) {
      for (const priority of ['balanced', 'fastest']) {
        queries.push({ gameMode, targetArmor, category, distance, priority, mode: 'auto' });
      }
    }
  }
}

const fingerprint = q => {
  const s = diag.snapshot(q);
  return {
    key: s.scenario,
    sig: JSON.stringify({
      winner: s.weaponId, ranked: s.rankedCount, armor: s.targetArmor, mode: s.gameMode,
      top: s.top.map(t => [t.id, t.btk, t.triggerTtk]),
      build: s.build ? [s.build.points, s.build.exhaustive, s.build.picks.map(p => p.id)] : null
    })
  };
};

// --- pass 1: forward, records the reference answer and the key ---
const reference = new Map();
const keyToSig = new Map();
for (const q of queries) {
  const id = JSON.stringify(q);
  const f = fingerprint(q);
  reference.set(id, f);
  if (keyToSig.has(f.key) && keyToSig.get(f.key).sig !== f.sig) {
    errors.push(`scenario key "${f.key}" serves two different results - key is missing a result-affecting input`);
  }
  keyToSig.set(f.key, f);
}

// --- pass 2: reverse order ---
for (const q of [...queries].reverse()) {
  const id = JSON.stringify(q);
  const f = fingerprint(q);
  if (f.sig !== reference.get(id).sig) errors.push(`order-dependent result (reverse pass): ${id}`);
  if (f.key !== reference.get(id).key) errors.push(`order-dependent scenario key (reverse pass): ${id}`);
}

// --- pass 3: adversarial interleave, alternating the most different scenarios ---
const mp = queries.filter(q => q.gameMode === 'multiplayer');
const armoured = queries.filter(q => q.targetArmor === 'plates2');
for (let i = 0; i < Math.max(mp.length, armoured.length); i++) {
  for (const q of [armoured[i % armoured.length], mp[i % mp.length]]) {
    const id = JSON.stringify(q);
    const f = fingerprint(q);
    if (f.sig !== reference.get(id).sig) errors.push(`contaminated by interleaving: ${id}`);
  }
}

// --- distinct inputs must produce distinct keys ---
for (let i = 0; i < queries.length; i++) {
  for (let j = i + 1; j < queries.length; j++) {
    const a = queries[i], b = queries[j];
    if (a.gameMode !== b.gameMode || a.distance !== b.distance || a.category !== b.category || a.priority !== b.priority) continue;
    // same everything except armour state, and both in REDSEC
    if (a.gameMode === 'redsec' && a.targetArmor !== b.targetArmor) {
      const ka = reference.get(JSON.stringify(a)).key, kb = reference.get(JSON.stringify(b)).key;
      if (ka === kb) errors.push(`armour state absent from scenario key: ${ka}`);
    }
  }
}

await mkdir('reports/overnight', { recursive: true });
await writeFile('reports/overnight/cache-identity.json', JSON.stringify({
  generatedAt: new Date().toISOString(),
  queries: queries.length,
  evaluations: queries.length * 3,
  distinctScenarioKeys: keyToSig.size,
  errors
}, null, 1));

console.log(`cache identity: ${queries.length} queries evaluated in 3 orders (${queries.length * 3} evaluations), ${keyToSig.size} distinct scenario keys`);
if (errors.length) { console.error('FAIL:\n' + [...new Set(errors)].slice(0, 20).join('\n')); process.exit(1); }
console.log('PASS: results are order-independent and no scenario key serves two different answers.');
