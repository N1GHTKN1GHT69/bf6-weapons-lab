# Source pipeline runbook

How a weapon number gets from a publisher into production, and how to repeat it when
the next BF6 patch lands. Written so a session with no memory of this work can execute
it from a cold start.

Every command runs from the repository root. Node 22+ (CI uses 22; 24 also works).
There is no `package.json` and no dependencies to install.

---

## 1. The one idea that makes the rest make sense

`data/weapons.json` is a **byte-identical mirror** of the upstream simulator feed
(`raymdl/BF6-Weapon-Analyzer`). Three things depend on that identity:

- `data/source-manifest.json` records its SHA-256
- `scripts/audit-cache-identity.mjs` checks the built cache against it
- the Combat Engine workflow **re-syncs it from upstream on every run**

So a newer published value **cannot** be hand-edited into that file. The edit would
break the manifest hash and be silently reverted on the next run. This has to be said
plainly because it is the single most likely mistake.

Newer values therefore live in **`data/source-overlays.json`**, applied on load by
`source-overlay.js` — one shared module used by *both* the browser optimizer
(`app.js` → `loadData`) and the exhaustive cache builder (via
`scripts/source-overlay.mjs`), so they can never disagree.

    effective dataset  =  pristine upstream mirror  +  ordered versioned overlays

The historical baseline is never destroyed, and every effective value is reproducible.

**Fail-closed:** each overlay change declares the baseline value it expects to replace
(`from`). If the mirror no longer holds that value — upstream finally shipped its own
update — the change is *not applied* and an error is recorded.
`scripts/audit-source-overlay.mjs` fails the build on any such error.

---

## 2. Where the numbers come from

| Source | What it gives | Status |
| --- | --- | --- |
| `raymdl/BF6-Weapon-Analyzer` | the full weapon/attachment/ammo schema, pinned | the baseline mirror |
| **sym.gg** | the recoil/spread/ballistics primitives | the publisher of record |
| **SheetOnMyFace workbook** | the public *carrier* of Sym's newest dump | where 1.4.2.0 actually came from |
| EA official changelogs | qualitative patch notes, rarely numbers | the ledger's evidence |

The workbook is the part people get wrong. sym.gg's **own public site** still stops at
1.3.3.0. Its 1.4.2.0 data reached the public through a Google Sheet
(`1_jVZuDofvDzwdK6IjhnLGUWCP7UXI2MKpC06EVbYD_Q`, "Battlefield 6 Interactive Weapon
Guide" by SheetOnMyFace). It carries two Sym tabs:

- `Sym.gg Data` — the live dump, every row tagged with one game version
- `Sym.gg Data Archive` — the superseded dumps (1.3.3.0 / 1.3.1.0 / 1.2.2.0)

Having the old versions **in the same workbook** is what makes it usable as evidence:
the patch delta can be derived from one internally-consistent source instead of by
differencing two publishers with different rounding and naming conventions.

---

## 3. Ingesting a new source version — the whole loop

### 3.1 Capture (freeze the source)

```bash
node scripts/capture-sheetonmyface.mjs
```

Writes `data/sources/sheetonmyface-bf6-workbook.json`: every stat × every version ×
every weapon, plus retrieval timestamp, every endpoint URL, and the SHA-256 of each
raw CSV response. Nothing is ingested. `--verify` compares without writing.

If the source is unreachable it exits cleanly and writes nothing. **Do not claim a
fresh retrieval you did not get** — work from the committed capture and say so.

### 3.2 Derive (mechanically)

```bash
node scripts/build-source-overlay.mjs
```

Reads the capture and the mirror, writes `data/source-overlays.json` plus
`reports/patch-delta/sym-1420-delta.json|.csv`. Nothing in it is hand-entered. The
only hand-authored content is:

- the **field map** — `scripts/sym-field-map.mjs`, shared with the watcher
- the **exclusions** — stated with reasons, inside `build-source-overlay.mjs`

It prints three things worth reading every time:

1. **historical provenance** — our mirror vs the workbook's archived rows for the
   baseline version. Currently **3630 / 3630 exact, 0 conflicts**. If this ever fails,
   stop: either the workbook's version labelling is wrong or our mirror drifted, and
   ingesting anything before understanding which would be guessing.
2. **sheet-internal delta** — the workbook against itself, old version vs new, all 128
   stats. Currently 6707/6708 identical; the one change is `L115 velocity 664 → 742`.
3. **mirror delta** — what actually has to be ingested, bucketed by verdict.

`--check` re-derives and fails if the committed overlay differs. This runs in CI.

### 3.3 Gate

```bash
node scripts/audit-source-overlay.mjs
node scripts/audit-freshness-watchers.mjs
```

The overlay gate re-derives every claim rather than trusting the document: every `from`
must still match the mirror; every non-derived `to` must be byte-equal to the frozen
capture; every derived value must recompute from its declared rule; the schema
invariants must hold for all 62 weapons; and the VSSM two-state model must be intact
(§5).

### 3.4 Rebuild the cache

Push. The **BF6 Combat Engine** workflow fires on `data/source-overlays.json` and runs
a 62-job matrix (~25 min), then commits the merged cache.

To rebuild locally instead (~35 s per weapon, ~40 min total):

```bash
git clone --depth 1 https://github.com/raymdl/BF6-Weapon-Analyzer /tmp/upstream
node scripts/build-combat-cache.mjs /tmp/upstream data --weapon ef88 \
     --cache /tmp/shards/ef88.json --audit /tmp/shards/ef88-audit.json
```

Local shards have been verified byte-identical to CI's output, so this is a legitimate
independent check, not an approximation.

### 3.5 Measure the impact

```bash
git worktree add ../bf6-before <pre-change-commit>
node scripts/compare-meta-impact.mjs --before ../bf6-before
```

Boots the real app on both sides and diffs raw stats, all 300 cached distances, and
**14,400 ranking cases per side** (1–300m exhaustive × 3 modes × 2 priorities × 8
scopes). Do not sample 10/25/50/100m — the real flips live in narrow bands
(the L115 one is 101–120m and nothing else).

`scripts/lab-harness.mjs` reads `source-overlay.js` optionally so it can boot an older
checkout; that is what makes the two-sided comparison possible.

### 3.6 Reconcile the patch ledger

Add the patch to `data/patch-delta-ledger.json` with a **deterministic check per
change**. Check types available:

| type | proves |
| --- | --- |
| `weaponPresent` / `attachmentPresent` / `attachmentCompat` | a record exists |
| `overlayRule` | an explicit rule token exists in `app.js` |
| `sourceOverlay` | the named overlay exists, is enabled, and covers the named weapons |
| `mechanicRemoved` | the named attachments carry none of the named modifier fields |
| `notModelled` | outside the combat model by design, with the reason |
| `valuesUnpublished` | **blocks** — EA changed a number and published none |

Also set **`numericWeaponStatDelta`** per patch. This is the *bridge* that lets values
attested at an older version be called current for the live game. `false` requires the
official changelog to have been **fetched and read in full**, with every weapon-affecting
line classified. It is never inferred from silence.

```bash
node scripts/reconcile-patches.mjs --write   # updates data/freshness-status.json
node scripts/audit-source-data.mjs           # recomputes coverage from field provenance
```

### 3.7 Full local gate run

```bash
node --check app.js && node --check source-overlay.js
for f in scripts/*.mjs; do node --check "$f"; done
# then every gate listed in .github/workflows/quality-gates.yml
```

30 gates. All must pass before pushing.

---

## 4. The two version axes — never merge them

- **COMBAT VERIFIED** (`verified.gameVersion`) stops at the first patch with an
  unresolved blocking change. One unavailable weapon holds it back.
- **DATA / numerical source** (`numericalSource.gameVersion`) is where the numbers on
  screen actually come from.

They are currently **1.4.1.5** and **1.4.2.0** respectively, on a live **1.4.2.5** game,
and the chip says all three: `LIVE 1.4.2.5 • DATA 1.4.2.0 • COMBAT 1.4.1.5`.

Two coverage percentages exist for the same reason and are also never merged:

- `knownPatchDeltaCoveragePercent` — share of result-affecting fields with no
  outstanding published delta. Says nothing about whether the number is current.
- `currentNumericalVerificationPercent` — share whose value is attested by a
  version-stating source **and matches ours** **and** is bridged to live.

Carrying an old value forward on the absence of a delta does **not** count as current.

---

## 5. VSSM — read this before touching its RPM

The workbook publishes three rates. The VSSM is the **only** weapon in the roster where
they differ, because it is the only one with a fire-mode conversion:

| stat | value | what it is |
| --- | --- | --- |
| `RoF` | 799.999 | the **full-auto** rate |
| `BurstRoF` | 799.999 | — |
| `SingleRoF` | 449.999 | the **semi-auto** rate |

`data/weapons.json` stores **449.999** (SingleRoF, the base semi-auto state), and the
attachment `full_auto_vssm` ("Folding Stock", 40 pts, `setsFireModeAuto`) carries
**`autoRpm: 799.999`** (RoF, the converted state). Both states are already represented,
each exactly once.

Writing `RoF` into the base record would make the semi-auto base fire at the full-auto
rate **and** leave the conversion in place — the transform applied twice.

`scripts/audit-source-overlay.mjs` makes that impossible with four assertions, and the
exclusion reason is stored in the overlay so a later pass cannot "fix" it back.
Negative-tested: adding a `vssm.rpm` change fires three of them.

---

## 6. Watching for the next patch

Two watchers, because one is structurally blind.

```bash
node scripts/watch-sym-source.mjs        # sym.gg's own patch-notes chunk
node scripts/watch-source-workbook.mjs   # the workbook carrying Sym's newest dump
```

Both run hourly in `.github/workflows/freshness-watch.yml`, both `continue-on-error`,
and both exit non-zero **only on the good-news case** so CI can annotate.

The workbook watcher fetches one ~50 KB tab and fingerprints only the 66 stats that can
reach a combat number, canonicalised to 9 significant digits. Verified offline by
`scripts/audit-freshness-watchers.mjs`:

- 1e-13 float noise, unmodelled-stat edits, and reordering → **no** fingerprint change
- a 0.069% move (the smallest real delta this source has produced) → **detected**
- every path the overlay writes is reachable from the watched field map → **no blind spot**

Nothing is ingested automatically. A watcher firing means: re-run §3.

---

## 7. Rules that are not negotiable

- Never hand-edit `data/weapons.json`. Use an overlay.
- Never hand-edit generated cache values.
- Never ingest a value the workbook rounds more coarsely than the mirror already holds
  it (830.769 vs 830.7692307692307) — that loses precision. The 1e-5 threshold in
  `build-source-overlay.mjs` separates rounding from real change; every real delta this
  source has produced is above 0.9%.
- Never promote a version because the number is newer. Promotion is earned in the
  ledger, per change, with a deterministic check.
- Never use community tier lists, popularity, creator opinion or subjective rankings as
  data. Corroboration from another *numerical* publisher is welcome; ranking input is not.
- If evidence is insufficient, preserve the last known-good behaviour and label the
  uncertainty accurately. Fail closed.
