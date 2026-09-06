# BF6 Weapons Lab — false-data checklist

A checklist for hunting **false confidence**, not bugs. A bug makes the app wrong in a way
someone notices. False confidence makes the app wrong in a way that looks right — a number
with a plausible provenance story attached to it that nobody has actually followed end to end.

Use this during the manual fine-tooth-comb audit. For any Lab claim, walk all ten questions.
Stop at the first one you cannot answer from evidence; that is where the confidence is false.

Each question below carries the answer the repository can give **today**, and which tool
gives it. Where the honest answer is "we cannot know", it says so.

---

## The ten questions

### 1. Where did this number originate?

| Field | Origin |
| --- | --- |
| `rpm`, `bulletVel`, recoil and spread primitives | **sym.gg**, published at game version 1.4.2.0, carried by the SheetOnMyFace workbook |
| `dmg` (damage curves) | the pinned upstream mirror `raymdl/BF6-Weapon-Analyzer` @ `fb7a214`. **No current publisher.** |
| shotgun shell profiles, sniper curves and bolt intervals | the project's own class audits — these are *operative*, not cross-checks |
| REDSEC armour rules | EA's REDSEC armor community update, quoted verbatim beside each value |
| BALANCED weights | **product preference.** Not a game fact and never presented as one. |

**Tool:** `node scripts/audit-class-audit-provenance.mjs` — 182 pins, each with origin and consumers.

> **The trap:** "it came from Sym" is true of the ballistics primitives and false of every
> damage curve. Do not let one field's provenance vouch for a neighbouring field's.

---

### 2. Is that source actually the version claimed?

The workbook carries an explicit per-row `Version` column, and the archive tab holds the
superseded dumps. Our mirror agrees with the archived 1.3.3.0 rows on **3630/3630** mapped
comparisons. A second witness: the author's own hand-maintained tab still shows the
*pre*-1.4.2.0 velocities while the Sym dump shows the new ones — which is what a genuine
refresh looks like.

**Tool:** `node scripts/build-source-overlay.mjs --check`, `node scripts/audit-source-integrity.mjs`

> **The trap:** a source that *says* 1.4.2.0 in its title. The Version column and the
> historical cross-check are the evidence; the title is not.

---

### 3. Did we copy it correctly?

Every non-derived overlay value is byte-compared against the frozen capture, and the four
mirrored files are compared against the SHA-256 recorded beside them.

**Tool:** `node scripts/audit-source-overlay.mjs`, `node scripts/audit-source-integrity.mjs`

> **Status:** those manifest hashes went unchecked for the whole life of the project until
> mutation testing exposed it. Three separate one-byte edits survived the entire gate suite.
> Assume any *unverified* hash is decorative until a gate reads it.

---

### 4. Did we transform it?

| Value | Transform |
| --- | --- |
| `recoilV` | `recoil.ads.amount x amountMult ^ amountExp` — exact to <1e-9 on all 62 weapons |
| `unpredictableRecoil` | `recoil x sin(min(90, directionVariation))` |
| `recoilVar`, `recoilDir`, `spreadMax`, `recoilIncAds` | mirrors of nested values, must move together |
| shotgun shell damage | per-pellet x pellets, via the audited ammo profile |
| equipped velocity | base x barrel multiplier — a *derived* display value, not an independent one |

**Tool:** `node scripts/audit-cache-recompute.mjs` — 378,535 values re-derived independently.

> **The trap:** comparing a *base* value against an *equipped* one. This exact mistake made
> four DMRs look like they diverged from source when every base velocity matched exactly.

---

### 5. Was that transform applied once?

The overlay is idempotent by construction: every change declares the baseline it replaces,
so a second application finds the value already moved and refuses. Applying the overlay twice
applies **zero** changes and reports the refusal rather than silently doing nothing.

The VSSM is the worked example of why this matters: `RoF 799.999` is the *full-auto* rate,
`SingleRoF 449.999` is the *semi-auto* rate, the weapon stores the latter and the Folding
Stock attachment carries the former. Writing `RoF` into the base record would apply the
conversion twice.

**Tool:** `node scripts/audit-invariants.mjs`, `node scripts/audit-state-collisions.mjs`

> **Status:** the VSSM is the only weapon in the roster whose published rates disagree —
> which is exactly what made the trap discoverable. The SL9 publishes a burst cadence the
> Lab does not model; if an attachment for it is ever added, its rate goes on the
> **attachment**, never the base record.

---

### 6. Is another table overriding it?

This is the question most likely to produce a false answer, because the honest answer differs
by class:

| Class | Damage | Cadence |
| --- | --- | --- |
| Assault Rifle, Carbine, SMG, LMG, Sidearm | **CONCORDANT** — raw and audit agree | raw RPM operative |
| DMR | **raw operative** — the audit bands are a rounded restatement | raw RPM operative |
| Sniper Rifle | **audit operative** — the audited curve feeds the cache | **audit interval operative** |
| Shotgun | **audit operative** — the ammo profile feeds the cache | audit cadence operative |

**Tool:** `node scripts/audit-class-audit-provenance.mjs`

> **The trap, and it caught this project twice.** A perturbation test that bypasses the cache
> measures the *fallback* path, not production. The earlier conclusion "raw.dmg is shadowed by
> class audits" was drawn that way and is **wrong for most classes** — in production the cache
> is primary and was built from `raw.dmg`. Always ask *which path* a measurement observed.

---

### 7. Does the engine consume what the UI says?

The chip reads `LIVE 1.4.2.5 · DATA 1.4.2.0 · COMBAT 1.4.1.5`. Three different things:
the live game, where the numbers came from, and how far patch reconciliation got. They are
deliberately not merged, because merging them is how a version label becomes a lie.

**Tool:** `node scripts/audit-mode-isolation.mjs`, `node scripts/audit-name-honesty.mjs`,
`node scripts/audit-state-space.mjs`

> **The trap:** a label that is true of *one* weapon presented as true of the roster. Per-weapon
> confidence caps exist for exactly this reason — check `data/source-verification.json`
> `weaponOverrides` before trusting a global chip for a specific weapon.

---

### 8. Is the cache built from the same effective value?

The cache is ~17 MB of generated numbers that the whole product reads. Every row is re-derived
from its own build stats; every cached attachment cost is checked against the **live** catalog;
and the catalog *shape* is fingerprinted by recounting every legal attachment combination and
comparing with the count the cache was built from.

**Tool:** `node scripts/audit-cache-recompute.mjs`

> **Status:** hand-editing a cached TTK survived all 30 gates before this existed. So did
> changing an attachment's cost. A stale cache hides a changed catalog — that single idea
> accounts for most of the holes mutation testing found.

---

### 9. Has the actual game confirmed it?

**For almost everything: no.** This is the honest state.

| | |
| --- | --- |
| Current numerical verification | **51%** (290 of 573 result-affecting fields) |
| Confirmed against the live game | **0 fields** — no in-game measurement is on record |
| What 51% means | attested by a version-stating source **and** matching our value **and** bridged to live |

The real-game audit is what changes this. `BF6-REAL-GAME-AUDIT-PLAN.md` carries 84 tests
ordered by information value.

> **The trap:** reading "source-verified" as "confirmed". It means a publisher printed this
> number at this version and we match it. It does not mean anyone has fired the gun.

---

### 10. Could an unresolved mechanic change the recommendation?

Measured, not assumed:

| Classification | Count | Detail |
| --- | ---: | --- |
| **SENSITIVE** | 1 | REDSEC close-range + spillover — flips the AUTO winner at 3 of 14 probed 2-plate cases |
| **ROBUST** | 4 | the four missing `adsTime` values — swept across their class's credible range, they cannot change a recommendation |
| **UNKNOWN** | 13 | no defensible range exists; deliberately not swept |

**Tool:** `node scripts/audit-uncertainty.mjs`

> **The trap:** inventing a tolerance so a value can be classified. A fabricated ±20% turns a
> guess into a number that looks measured. "UNKNOWN" is the honest classification and it is
> used 13 times.

---

## Fast triage — five commands

```bash
node scripts/audit-source-integrity.mjs          # do the mirrored files match their hashes?
node scripts/audit-cache-recompute.mjs           # does the cache say what the model produces?
node scripts/audit-class-audit-provenance.mjs    # which value is operative, per class?
node scripts/audit-uncertainty.mjs               # can an unresolved value change the answer?
node scripts/mutation-test.mjs                   # would the gates notice if it broke? (~40 min)
```

---

## Known-false-confidence patterns already found here

Each of these was believed, then disproved by measurement. They are listed because the same
shapes will recur.

| Belief | Reality | How it was caught |
| --- | --- | --- |
| "Sym has published nothing newer than 1.3.3.0" | true of sym.gg's *site*, false of Sym's *data* — a 1.4.2.0 dump was public for weeks | watching a second channel |
| "19 fields changed between 1.3.3.0 and 1.4.2.0" | one did. Three of those weapons are not in the archive at all, so their differences were provenance gaps, not patch deltas | comparing the source against *itself* |
| "raw.dmg is shadowed by class audits" | true only on the cache-bypassed path; in production the cache is primary and built from raw.dmg | asking which path the measurement observed |
| "the manifest hashes protect the source files" | nothing read them | mutation testing |
| "the REDSEC gates would catch a changed multiplier" | they check self-consistency, which survives the change intact | mutation testing |
| "damage decreases with distance" | not for snipers — sweet spots rise | 158 false failures from my own invariant |
| "roster ids are catalog ids" | `185ksk` vs `ks18k`, `kts100mk8` vs `kts100` | 202 false anomalies |
| `Number(null)` is not a number | it is `0`, and `Number.isFinite(0)` is `true` | three impossible 0 ms ADS ranges |

The last four are mistakes made *by the auditing tools themselves*. A test that is wrong is
worse than no test, because it produces confident findings. Check the tool before believing
the finding.
