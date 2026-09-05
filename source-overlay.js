/**
 * BF6 Weapons Lab — versioned source overlays.
 *
 * WHY THIS EXISTS
 * ---------------
 * data/weapons.json is a BYTE-IDENTICAL mirror of the upstream simulator feed
 * (raymdl/BF6-Weapon-Analyzer). That identity is load-bearing: data/source-manifest.json
 * records its SHA-256, scripts/audit-cache-identity.mjs checks the built cache
 * against it, and the Combat Engine re-syncs it from upstream on every run. So a
 * newer published value can NOT be hand-edited into that file - the edit would
 * break the manifest hash and be silently reverted by the next sync.
 *
 * An overlay is the alternative: the mirror stays pristine, and newer verified
 * values are declared separately, per version, with their provenance attached,
 * then applied deterministically on load by BOTH consumers:
 *
 *   - the browser optimizer          (app.js loadData)
 *   - the exhaustive cache builder   (scripts/build-combat-cache.mjs, via
 *                                     scripts/source-overlay.mjs)
 *
 * The effective dataset is therefore always reproducible as
 *     baseline mirror  +  ordered overlays
 * and the historical baseline is never destroyed.
 *
 * FAIL-CLOSED RULE
 * ----------------
 * Every change declares the baseline value it expects to replace (`from`). If the
 * mirror no longer holds that value - upstream finally shipped its own update, or
 * the overlay was written against a different snapshot - the change is NOT applied
 * and an error is recorded. Overwriting a value we cannot account for would be
 * exactly the silent corruption this file exists to prevent.
 * scripts/audit-source-overlay.mjs fails the build on any such error, so a stale
 * overlay can never reach production.
 *
 * DERIVED CHANGES
 * ---------------
 * Some schema fields are functions of others (`recoilV = amount * mult^exp`) or
 * duplicates of them (`recoilVar` mirrors `recoil.ads.dirVar`). Those are declared
 * as ordinary changes carrying a `derived` rule string. This file applies them as
 * literal writes - it deliberately contains no math - and the audit script
 * independently recomputes each rule and asserts the stored value matches. Keeping
 * the application trivial and the verification independent is what makes a wrong
 * derived value impossible to ship quietly.
 */
(function (root) {
  "use strict";

  var OVERLAY_MODEL_VERSION = "source-overlay-v1";

  /** Read "recoil.ads.amount" or "spread.adsStand[0]" off a weapon record. */
  function readPath(obj, path) {
    var cur = obj;
    var parts = String(path).split(".");
    for (var i = 0; i < parts.length; i++) {
      if (cur === null || cur === undefined) return undefined;
      var m = /^([A-Za-z0-9_]+)\[(\d+)\]$/.exec(parts[i]);
      if (m) {
        cur = cur[m[1]];
        if (!Array.isArray(cur)) return undefined;
        cur = cur[Number(m[2])];
      } else {
        cur = cur[parts[i]];
      }
    }
    return cur;
  }

  /** Write the same path form. Returns false if an intermediate node is missing. */
  function writePath(obj, path, value) {
    var parts = String(path).split(".");
    var cur = obj;
    for (var i = 0; i < parts.length - 1; i++) {
      var m = /^([A-Za-z0-9_]+)\[(\d+)\]$/.exec(parts[i]);
      cur = m ? (cur[m[1]] || [])[Number(m[2])] : cur[parts[i]];
      if (cur === null || cur === undefined) return false;
    }
    var last = parts[parts.length - 1];
    var lm = /^([A-Za-z0-9_]+)\[(\d+)\]$/.exec(last);
    if (lm) {
      var arr = cur[lm[1]];
      if (!Array.isArray(arr)) return false;
      arr[Number(lm[2])] = value;
      return true;
    }
    if (!(last in cur)) return false;
    cur[last] = value;
    return true;
  }

  function sameNumber(a, b) {
    return typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= 1e-12;
  }

  /**
   * Apply an overlay document to a weapons array.
   *
   * Returns { weapons, applied, skipped, errors, versions }. `weapons` is a fresh
   * deep copy - the caller's baseline array is never mutated, so the pristine
   * mirror stays available for before/after comparison.
   */
  function applyOverlays(weapons, doc) {
    var errors = [];
    var applied = [];
    var skipped = [];
    var versions = [];

    if (!Array.isArray(weapons)) return { weapons: [], applied: applied, skipped: skipped, errors: ["weapons is not an array"], versions: versions };
    var out = JSON.parse(JSON.stringify(weapons));
    if (!doc || !Array.isArray(doc.overlays)) return { weapons: out, applied: applied, skipped: skipped, errors: doc ? ["overlay document has no overlays array"] : [], versions: versions };

    var byId = {};
    for (var i = 0; i < out.length; i++) byId[out[i].id] = out[i];

    var ordered = doc.overlays.slice().sort(function (a, b) { return (a.order || 0) - (b.order || 0); });

    for (var o = 0; o < ordered.length; o++) {
      var ov = ordered[o];
      if (ov.enabled === false) { skipped.push({ overlay: ov.id, reason: "disabled" }); continue; }
      versions.push(ov.gameVersion);
      var changes = Array.isArray(ov.changes) ? ov.changes : [];
      for (var c = 0; c < changes.length; c++) {
        var ch = changes[c];
        var w = byId[ch.weaponId];
        if (!w) { errors.push(ov.id + ": unknown weapon " + ch.weaponId); continue; }
        var current = readPath(w, ch.path);
        if (!sameNumber(current, ch.from)) {
          // Baseline moved under us. Do not overwrite a value we cannot account for.
          errors.push(ov.id + " " + ch.weaponId + "." + ch.path + ": baseline is " + current + " but the overlay expects " + ch.from + "; change NOT applied");
          continue;
        }
        if (!writePath(w, ch.path, ch.to)) {
          errors.push(ov.id + " " + ch.weaponId + "." + ch.path + ": path not writable on this record");
          continue;
        }
        applied.push({ overlay: ov.id, gameVersion: ov.gameVersion, weaponId: ch.weaponId, path: ch.path, from: ch.from, to: ch.to, derived: !!ch.derived });
      }
    }

    return { weapons: out, applied: applied, skipped: skipped, errors: errors, versions: versions };
  }

  root.BF6_SOURCE_OVERLAY = {
    OVERLAY_MODEL_VERSION: OVERLAY_MODEL_VERSION,
    readPath: readPath,
    writePath: writePath,
    applyOverlays: applyOverlays
  };
})(typeof window !== "undefined" ? window : globalThis);
