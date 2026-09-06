#!/usr/bin/env node
/**
 * Pin every REDSEC model number to the evidence stored beside it.
 *
 * WHY THIS GATE EXISTS. Mutation testing changed a REDSEC armour chest multiplier and
 * the whole 30-gate suite passed. That is not a careless omission - the existing REDSEC
 * gates check the right things and check them well. They verify that the armour
 * arithmetic on screen is SELF-CONSISTENT (ceil(armourHp / armourDamage) equals the
 * stated shots to break) and that armour damage is a real step of the weapon's own
 * health curve times its class multiplier.
 *
 * The trouble is that both properties survive a changed multiplier. Scale 0.84 to 1.05
 * and the armour damage, the shot counts and the provenance check all move together and
 * stay perfectly consistent - with each other, and with the mutated model. Everything
 * agrees; everything is wrong.
 *
 * What breaks that circle is that data/redsec-model.json quotes its own first-party
 * source in prose, next to each number: "damage against armor was reduced from 1x to
 * 0.84x". The prose is not derived from the value, so it is an independent witness. This
 * gate reads the number OUT of the evidence text and requires the encoded value to match.
 *
 * It also checks the arithmetic relations the model states about itself (plates x
 * hpPerPlate = totalHp) and that the multiplier class map covers every weapon class
 * exactly once, so a class cannot silently fall through to the default.
 *
 * Usage: node scripts/audit-redsec-model-integrity.mjs
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const model = JSON.parse(await readFile('data/redsec-model.json', 'utf8'));
const weapons = JSON.parse(await readFile('data/weapons.json', 'utf8'));
const errors = [];
const checks = [];

const check = (name, ok, detail) => {
  checks.push({ name, ok, detail });
  if (!ok) errors.push(`${name}: ${detail}`);
};

// ---- armour pool arithmetic, and the value quoted in its own evidence -------------
for (const [key, a] of Object.entries(model.armor ?? {})) {
  const { plates, hpPerPlate, totalHp, evidence } = a;
  check(`armor.${key}.totalHp arithmetic`,
    Number(plates) * Number(hpPerPlate) === Number(totalHp),
    `${plates} plates x ${hpPerPlate} HP = ${Number(plates) * Number(hpPerPlate)}, but totalHp is ${totalHp}`);

  // EA's quote carries the numbers: "80 HP total (2 plates at 40 HP each)" / "40 HP".
  const quoted = String(evidence ?? '').match(/(\d+)\s*HP/gi)?.map(s => Number(s.match(/\d+/)[0])) ?? [];
  if (quoted.length) {
    check(`armor.${key} matches its evidence`,
      quoted.includes(Number(totalHp)) || quoted.includes(Number(hpPerPlate)),
      `evidence quotes ${quoted.join(', ')} HP but the model encodes totalHp ${totalHp} / hpPerPlate ${hpPerPlate}`);
  }
}

// ---- chest multipliers against the numbers EA published ---------------------------
//
// The evidence is prose, so the number has to be read out of the ARMOUR clause
// specifically. Every reduction sentence has the shape "damage against armor was
// reduced from Ax to Bx", and B is the current value. Taking simply the last multiplier
// in the sentence is wrong and was: the sniper entry ends "...chest damage against
// health remains 1x", which is about HEALTH, and would have flagged a correct 0.67.
for (const [key, m] of Object.entries(model.damageVsArmor?.chestMultipliers ?? {})) {
  const value = Number(m.value);
  const evidence = String(m.evidence ?? '');
  const reduction = evidence.match(/against armor was reduced from\s*([\d.]+)\s*x\s*to\s*([\d.]+)\s*x/i);

  if (reduction) {
    const from = Number(reduction[1]), to = Number(reduction[2]);
    check(`chestMultipliers.${key} matches its evidence`, to === value,
      `model encodes ${value} but its evidence says damage against armor was reduced to ${to}x`);
    check(`chestMultipliers.${key} is a reduction`, to < from,
      `evidence describes a reduction from ${from}x but quotes ${to}x, which is not lower`);
    check(`chestMultipliers.${key} is in range`, value > 0 && value <= 1,
      `armour multipliers reduce damage against armour; ${value} is outside (0, 1]`);
    continue;
  }

  // No reduction sentence. The only legitimate case is the `default` bucket: EA
  // published no override for those classes, so the curve is left unscaled at 1x.
  // That must be STATED in the evidence, not inferred from the absence of a number.
  check(`chestMultipliers.${key} unchanged case is stated`,
    value === 1 && /no armor-chest override is published|left unscaled|excludes/i.test(evidence),
    `carries no "reduced ... to Nx" clause, so it must be an explicitly stated unchanged-1x case; value is ${value}`);
}

// ---- the range shift, quoted in metres -------------------------------------------
{
  const rs = model.damageVsArmor?.rangeShiftMeters;
  const quoted = String(rs?.evidence ?? '').match(/(\d+)\s*met/i);
  check('rangeShiftMeters matches its evidence',
    !quoted || Number(quoted[1]) === Number(rs?.value),
    `model encodes ${rs?.value} m but the evidence says ${quoted?.[1]} m`);
}

// ---- every weapon class must map to exactly one multiplier bucket -----------------
{
  const buckets = Object.entries(model.damageVsArmor?.chestMultipliers ?? {});
  const seen = new Map();
  for (const [key, m] of buckets) for (const cls of m.classes ?? []) {
    if (seen.has(cls)) errors.push(`class "${cls}" is claimed by both ${seen.get(cls)} and ${key}`);
    seen.set(cls, key);
  }
  const rosterClasses = [...new Set(weapons.map(w => w.cls))];
  const unmapped = rosterClasses.filter(c => !seen.has(c));
  check('every weapon class has an armour multiplier',
    unmapped.length === 0,
    `no bucket covers: ${unmapped.join(', ')} - these would silently fall through`);
  checks.push({ name: 'class map', ok: true, detail: [...seen.entries()].map(([c, b]) => `${c}->${b}`).join(', ') });
}

// ---- the close-range rule must stay qualitative -----------------------------------
// EA published no per-calibre armour damage table. If this block ever grows a numeric
// damage value, something was invented.
{
  const r = model.damageVsArmor?.removeFirstCloseRangeStep ?? {};
  const numeric = Object.entries(r).filter(([k, v]) => typeof v === 'number' && !/applied|scope/i.test(k));
  check('close-range rule carries no invented damage number',
    numeric.length === 0,
    `numeric fields present: ${numeric.map(([k, v]) => `${k}=${v}`).join(', ')} - EA published no armour damage values, so any number here would be fabricated`);
  check('close-range rule is still marked partially-verified',
    r.confidence === 'partially-verified',
    `confidence is "${r.confidence}"; EA state the rule qualitatively only, so it must not claim to be verified`);
}

// ---- unresolved mechanics must stay unresolved -------------------------------------
{
  const unresolved = model.unresolved ?? model.open ?? null;
  check('unresolved mechanics are still recorded',
    unresolved != null && Object.keys(unresolved).length > 0,
    'the model no longer records any unresolved mechanic, but EA have published neither the close-range reduction amount nor the armour-break spillover rule');
}

const report = {
  generatedAt: new Date().toISOString(),
  method: 'Each encoded REDSEC value is compared against the number quoted in its own first-party evidence text. The prose is not derived from the value, so it is an independent witness - which is what the existing self-consistency checks cannot be.',
  modelVerifiedAt: model.verifiedAt ?? null,
  checks, errors
};
await mkdir('reports/validation', { recursive: true });
await writeFile('reports/validation/redsec-model-integrity.json', JSON.stringify(report, null, 1));

console.log(`redsec model integrity — ${checks.length} checks against the model's own quoted evidence`);
for (const c of checks) console.log(`  ${c.ok ? 'ok  ' : 'FAIL'} ${c.name}`);
if (errors.length) {
  console.error('\nFAIL:\n  ' + errors.join('\n  '));
  process.exitCode = 1;
} else {
  console.log('\nPASS: every REDSEC number matches the first-party figure quoted beside it.');
}
