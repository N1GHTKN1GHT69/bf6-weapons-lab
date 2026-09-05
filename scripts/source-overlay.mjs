/**
 * Node-side view of the ONE authoritative source-overlay applier.
 *
 * The implementation lives in ../source-overlay.js so that the browser optimizer
 * and the exhaustive cache builder cannot drift apart. This module is a thin
 * re-export; it deliberately contains no policy of its own. Same pattern as
 * scripts/verified-source-sanitizer.mjs.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import path from 'node:path';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, '..', 'source-overlay.js'), 'utf8');
const sandbox = { globalThis: {} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'source-overlay.js' });

const api = sandbox.BF6_SOURCE_OVERLAY;
if (!api) throw new Error('source-overlay.js did not expose BF6_SOURCE_OVERLAY');

export const OVERLAY_MODEL_VERSION = api.OVERLAY_MODEL_VERSION;
export const readPath = api.readPath;
export const writePath = api.writePath;
export const applyOverlays = api.applyOverlays;

export const OVERLAY_FILE = 'data/source-overlays.json';

/**
 * Content hash of a text file, LINE-ENDING NORMALISED.
 *
 * .gitattributes declares every tracked text file eol=lf, but a Windows checkout
 * predating that declaration still holds CRLF in the working tree, so a raw byte
 * hash of the same committed content differs between this machine and CI. The
 * existing data/source-manifest.json hashes are LF (generated on Linux), so LF is
 * the project's established convention and the one used here - otherwise the
 * overlay's baseline check would fail on exactly one of the two platforms.
 */
export function contentSha256(text) {
  return createHash('sha256').update(String(text).replace(/\r\n/g, '\n')).digest('hex');
}

/** Load the overlay document, or null when the project carries none yet. */
export function loadOverlayDoc(file = OVERLAY_FILE) {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { return null; }
}

/**
 * The EFFECTIVE weapon dataset: the pristine upstream mirror with the versioned
 * overlays applied. This is what the app ships and what the cache is built from,
 * so every audit that claims to check "the numbers" must read it through here
 * rather than reading the mirror directly - otherwise an audit could pass against
 * values the product never shows.
 *
 * Throws on overlay conflict. An audit running against values we cannot account
 * for would be worse than no audit.
 */
export function loadEffectiveWeapons(upstreamWeaponsPath, overlayFile = OVERLAY_FILE) {
  const baseline = JSON.parse(readFileSync(upstreamWeaponsPath, 'utf8'));
  const doc = loadOverlayDoc(overlayFile);
  if (!doc) return baseline;
  const result = applyOverlays(baseline, doc);
  if (result.errors.length) {
    throw new Error('source overlay conflicts:\n  ' + result.errors.join('\n  '));
  }
  return result.weapons;
}
