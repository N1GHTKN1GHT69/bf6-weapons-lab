# Sidearm TTK audit

Game baseline: **BF6 1.4.2.5**  
Audit date: **2026-09-01**

This gate covers all seven current sidearms at every integer distance from 1–300 m. TTK is mechanical chest TTK from first damaging hit to lethal hit against 100 HP; projectile flight time is excluded.

The audit also protects two integration bugs found during the re-audit:

- Upstream labels these weapons `Sidearm`, while the Build Lab roster calls the slot `Secondary`.
- The old fallback data had stale RPMs for all seven guns and used the wrong M357 id (`m357` instead of `m357trait`).

Current audited RPMs:

- P18: 399.999
- ES 5.7: 449.999
- M45A1: 327.272
- M44: 163.636
- GGH-22: 359.999
- M357 TRAIT: 224.999
- VZ.61: 818.181

The VZ.61 full current stepped curve is audited rather than left as an interpolation/unknown.

Run against a checkout of `raymdl/BF6-Weapon-Analyzer`:

```bash
node scripts/audit-sidearm.mjs .upstream/bf6-analyzer data data/sidearm-audit.json
```

Any damage/RPM/fire-mode drift fails the gate.

- Integration regression in v1.6 fixed the live Analyzer `Sidearm` class path to use the correct 60-point sidearm attachment budget (the roster label is `Secondary`).
