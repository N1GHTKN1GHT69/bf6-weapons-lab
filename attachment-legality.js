/**
 * BF6 Weapons Lab — authoritative attachment legality + source sanitization.
 *
 * ONE implementation, used by BOTH optimization paths:
 *
 *   - the browser on-demand optimizer   (app.js buildOptions)
 *   - the exhaustive cache builder      (scripts/build-combat-cache.mjs, via
 *                                        scripts/verified-source-sanitizer.mjs)
 *
 * They previously disagreed. The cache builder distinguished a WHOLLY assumed
 * option (`assumed: true`) from a PARTIALLY assumed one (`assumedFields`), and
 * for the partial case stripped only the named unverified fields while keeping
 * the option and its verified mechanics. app.js treated any `assumedFields` as
 * whole-option assumption and dropped the option outright.
 *
 * The consequence was not a tainted cache — the cache never used an assumed
 * value, because they are stripped before simulation. It was an over-strict live
 * path: 13 partially-assumed records were invisible to the on-demand optimizer,
 * and M250, whose only two barrels are both partially assumed, had no legal
 * barrel at all and threw whenever the cache was unavailable.
 *
 * The rule, stated once:
 *
 *   1. `assumed: true`      -> the whole option is speculative. EXCLUDE it.
 *   2. `assumedFields`      -> only those named fields are unverified. STRIP
 *                              those fields, KEEP the option and every verified
 *                              field on it.
 *   3. otherwise            -> use as-is.
 *
 * Nothing is invented and no unverified number ever reaches a calculation:
 * a stripped field is absent, so downstream code falls back to its own defined
 * default exactly as it does for an attachment that never had that field.
 */
(function (root) {
  "use strict";

  var POLICY_VERSION = "attachment-legality-v1";

  /** Field names a record marks as unverified. Accepts array or object form. */
  function assumedFieldNames(value) {
    if (!value || typeof value !== "object") return [];
    var f = value.assumedFields;
    if (Array.isArray(f)) return f.map(String);
    if (f && typeof f === "object") return Object.keys(f);
    return [];
  }

  /** True when the ENTIRE option is speculative and must not be offered. */
  function isWhollyAssumed(value) {
    return !!(value && typeof value === "object" && value.assumed === true);
  }

  /** True when a record carries any partial-assumption marker, at any depth. */
  function hasPartialAssumptionMarker(value) {
    if (Array.isArray(value)) return value.some(hasPartialAssumptionMarker);
    if (!value || typeof value !== "object") return false;
    if (assumedFieldNames(value).length) return true;
    return Object.values(value).some(hasPartialAssumptionMarker);
  }

  /**
   * Recursively remove every field a record names as assumed, and the marker
   * itself. Verified siblings are preserved.
   */
  function stripPartialAssumptions(value, stats) {
    stats = stats || { strippedFields: 0, touchedRecords: 0 };
    if (Array.isArray(value)) {
      return value.map(function (v) { return stripPartialAssumptions(v, stats); });
    }
    if (!value || typeof value !== "object") return value;

    var names = assumedFieldNames(value);
    var assumed = new Set(names);
    if (assumed.size) stats.touchedRecords++;

    var out = {};
    Object.keys(value).forEach(function (k) {
      if (k === "assumedFields") return;
      if (assumed.has(k)) { stats.strippedFields++; return; }
      out[k] = stripPartialAssumptions(value[k], stats);
    });
    return out;
  }

  /**
   * The single legality decision for one attachment option.
   *
   * Returns the option to offer (sanitized when partially assumed), or null when
   * it must not be offered at all. `pointCost` is injected so each caller keeps
   * its own point-cost accessor while sharing this decision.
   */
  function legalOption(option, pointCost, stats) {
    if (!option || typeof option !== "object") return null;
    if (isWhollyAssumed(option)) return null;
    var pts = typeof pointCost === "function" ? pointCost(option) : option.pts;
    if (pts === null || pts === undefined || !isFinite(Number(pts))) return null;
    if (!assumedFieldNames(option).length) return option;
    return stripPartialAssumptions(option, stats);
  }

  root.BF6_ATTACHMENT_LEGALITY = {
    POLICY_VERSION: POLICY_VERSION,
    assumedFieldNames: assumedFieldNames,
    isWhollyAssumed: isWhollyAssumed,
    hasPartialAssumptionMarker: hasPartialAssumptionMarker,
    stripPartialAssumptions: stripPartialAssumptions,
    legalOption: legalOption
  };
})(typeof window !== "undefined" ? window : globalThis);
