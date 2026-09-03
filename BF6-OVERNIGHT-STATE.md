# BF6 Weapons Lab — session state

Latest pass: 2026-09-03, current-patch (1.4.2.5) source re-derivation.
Full findings: `BF6-WEAPONS-LAB-PATCH-DELTA-REPORT.md` (this pass) and
`BF6-WEAPONS-LAB-OVERNIGHT-REPORT.md` (prior session — optimizer/ranking/legality).

## Current-patch pass — completed 2026-09-03
- Checked all 3 evidence tiers for the 6 blocking combat deltas between the
  pinned 1.3.3.0 snapshot and live 1.4.2.5. EA notes: qualitative only, fetched
  and confirmed. Upstream simulator: pinned commit `fb7a214` IS current HEAD, no
  newer data exists. Community: only unsourced stat-aggregator numbers for
  Interdictor, not used per policy.
- Built `scripts/audit-current-patch-coverage.mjs` -> `data/current-patch-coverage.json`:
  names exactly which 6 of 62 weapons carry an unresolved, result-affecting delta
  (ef88, brod3, vssm, m2010esr, svk86, interdictor). The other 56 were checked
  against the full ledger and none was found.
- `scripts/audit-source-data.mjs` now computes per-field `currentPatchStatus`
  (6 buckets) instead of a blanket version compare. Result-affecting coverage:
  556/573 (97%), up from an effective 2% under the old blanket metric.
- Trust is now DEPENDENCY-AWARE end to end: `data/source-verification.json` v2
  carries per-weapon overrides; `renderConfidence()` in app.js caps only the
  active weapon's own chip. 56 weapons show no source-data caveat at all.
- **Self-corrected mid-pass**: initially misclassified VSSM barrel-recoil fix as
  "not result-affecting" because no field exists to represent it — wrong
  inference (absence of a field != verified no effect). Re-investigated: no
  barrel in the ENTIRE catalog carries recoil (schema-wide, not VSSM-specific),
  VSSM's grips (where recoil IS modelled) are populated identically to peers.
  Reclassified UNRESOLVED, not resolved. VSSM's displayed status unchanged
  (already PROVISIONAL for other reasons).
- **Zero numeric values changed.** No responsible source (any tier) provided an
  exact replacement number for any of the 6 affected weapons. Meta sweep
  confirmed byte-identical to pre-pass checkpoint across all 1,344 cases.
- 27/27 gates pass. Commits: `fbc237f` (architecture), `e43db88` (correction).
- Baseline preserved: tag `pre-142x-baseline-20260903`, bundle
  `../bf6-weapons-lab-pre-142x-20260903.bundle`.

## Correction pass 2026-09-03 (later) — coverage claim + sensitivity
- **Corrected the 97% claim.** It counted class-audit re-derivation of the SAME
  1.3.3.0 snapshot, and "no published delta", as verified-current. Now two
  separate metrics, never merged:
    KNOWN PATCH-DELTA COVERAGE      97%
    CURRENT NUMERICAL VERIFICATION   1%  (3 of 573)
  Result-affecting buckets: CURRENT_PATCH_VERIFIED 0, VERIFIED_UNCHANGED 3,
  PATCH_RECONCILED_NO_KNOWN_DELTA 553, STALE 4, PROVISIONAL 9, MISSING 4.
  A gate now fails any CURRENT_PATCH_VERIFIED claim lacking live-version evidence.
- **Ledger completeness VERIFIED**: no patch exists between 1.3.3.0 (2026-06-26)
  and 1.4.1.0 (2026-07-16). The four post-baseline entries are the complete set.
- **Content window bounded both sides**: extraction 2026-07-25 (9 days after
  1.4.1.0, so the "1.3.3.0" label is stale metadata) and upstream mirror's last
  data commit 2026-08-13 (one day before 1.4.2.0). Dataset is current through
  1.4.1.5, missing only 1.4.2.0 and 1.4.2.5.
- **Sensitivity worklist built** (scripts/audit-beam-sensitivity.mjs): 2,544
  probes, 53 weapons. Only 5 of 159 weapon x primitive combos can flip a
  BALANCED winner at +/-25%:
    L110 recoilV (score 9), B36A4 recoilV (8), M250 recoilV (7),
    M240L spreadMax (6), KORD 6P67 recoilV (5)
  Artifact: reports/patch-delta/beam-sensitivity.csv
- **Verification attempt on those 5: EXHAUSTED, none achieved.** EA notes carry
  no numbers; upstream mirror not updated past 2026-08-13; sym.gg itself is
  client-side rendered and unreadable; aggregator figures are on an incompatible
  scale with no methodology and were not used. No value changed, none invented.
- 28/28 gates pass. Meta sweep byte-identical. Commit 967bd9c + this pass.

## Open, blocked on external evidence (unchanged by this pass)
1. EF88/BROD3/VSSM base dmg/bulletVel — no numeric source found at any tier.
2. M2010 ESR/SVK-8.6 Match Grade Ammo — `long_range` proven inert (0/600 cached
   rows); base `dmg` curve genuinely unresolved.
3. VSSM barrel recoil — no field exists in schema to represent it; unresolved.
4. Interdictor — no responsible source for exact values.
5. 4 missing `adsTime` values (M16A4, PP-19, RPK-74M, L115) — neutralised in
   ranking (prior session), still unsourced.
6. REDSEC close-range/spillover — deliberately untouched; prior session's
   in-game test plans remain the path to close these.
7. The 5 high-impact recoil/spread values (L110/B36A4/M250/KORD 6P67 recoilV,
   M240L spreadMax) — the only unverified values proven able to flip a BALANCED
   winner. No accessible tier publishes a current number.

## Next task (unchanged in shape, now precise)
In-game verification session covering both: (a) the REDSEC close-range/spillover
tests from the prior session (highest leverage — can move REDSEC 2-plate off
PROVISIONAL), and (b) if a live 1.4.2.5 client is available, the 6 weapons named
above are now an exact, short list for manual stat confirmation.
