/**
 * Node-side view of the ONE authoritative attachment legality policy.
 *
 * The implementation lives in ../attachment-legality.js so that the browser
 * on-demand optimizer and this cache builder cannot drift apart. This module is
 * a thin re-export; it deliberately contains no policy of its own.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, '..', 'attachment-legality.js'), 'utf8');
const sandbox = { globalThis: {} };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'attachment-legality.js' });

const policy = sandbox.BF6_ATTACHMENT_LEGALITY;
if (!policy) throw new Error('attachment-legality.js did not expose BF6_ATTACHMENT_LEGALITY');

export const POLICY_VERSION = policy.POLICY_VERSION;
export const assumedFieldNames = policy.assumedFieldNames;
export const isWhollyAssumed = policy.isWhollyAssumed;
export const stripPartialAssumptions = policy.stripPartialAssumptions;
export const hasPartialAssumptionMarker = policy.hasPartialAssumptionMarker;
export const legalOption = policy.legalOption;
