/**
 * BF6 Weapons Lab — headless execution harness.
 *
 * Every existing local gate reads app.js as TEXT and pattern-matches it. That
 * proves a function is present; it cannot prove the function computes the right
 * number. This harness boots the real app.js inside a Node vm with the smallest
 * possible DOM/fetch shim so audits can call the production combat, armour,
 * optimizer and ranking code paths and compare their ACTUAL OUTPUT against
 * independent reference implementations.
 *
 * It shims only what app.js actually touches (4 document methods, fetch,
 * navigator, setTimeout). No engine behaviour is stubbed or replaced.
 */
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

/** Permissive DOM node: records nothing, tolerates every call app.js makes. */
function makeEl(id = '') {
  const el = {
    id,
    dataset: {},
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    children: [],
    value: '',
    checked: false,
    disabled: false,
    hidden: false,
    textContent: '',
    innerHTML: '',
    className: '',
    addEventListener() {},
    removeEventListener() {},
    appendChild(c) { el.children.push(c); return c; },
    append() {},
    remove() {},
    setAttribute() {},
    getAttribute: () => null,
    removeAttribute() {},
    closest: () => null,
    focus() {},
    scrollIntoView() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    insertAdjacentHTML() {}
  };
  return el;
}

export async function bootLab(root = process.cwd()) {
  const read = p => readFile(path.join(root, p), 'utf8');
  // Same script set, same order, as index.html.
  const [legalitySrc, rosterSrc, classSrc, appSrc] = await Promise.all([
    read('attachment-legality.js'), read('roster-data.js'), read('class-data.js'), read('app.js')
  ]);

  const els = new Map();
  const document = {
    getElementById(id) {
      if (!els.has(id)) els.set(id, makeEl(id));
      return els.get(id);
    },
    querySelector(sel) {
      if (!els.has('sel:' + sel)) els.set('sel:' + sel, makeEl(sel));
      return els.get('sel:' + sel);
    },
    querySelectorAll: () => [],
    activeElement: null,
    createElement: tag => makeEl(tag),
    addEventListener() {},
    body: makeEl('body')
  };

  const fetched = [];
  // Local files only. Remote URLs reject, exactly as they would offline, so the
  // harness measures the shipped data snapshot rather than live upstream.
  const fetchShim = async (url) => {
    fetched.push(String(url));
    const u = String(url);
    if (/^https?:/i.test(u)) throw new Error('offline harness: remote fetch blocked');
    const rel = u.replace(/^\.\//, '').split('?')[0];
    let text;
    try { text = readFileSync(path.join(root, rel), 'utf8'); }
    catch { return { ok: false, status: 404, json: async () => { throw new Error('404'); } }; }
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  };

  const win = {};
  const sandbox = {
    window: win, document, fetch: fetchShim,
    navigator: { userAgent: 'bf6-lab-harness' }, // no serviceWorker key: app.js guards on `in`
    location: { href: 'http://localhost/', search: '' },
    setTimeout, clearTimeout, setInterval, clearInterval,
    AbortController, console, Math, JSON, Date, URL,
    requestAnimationFrame: fn => setTimeout(fn, 0)
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);

  vm.runInContext(legalitySrc, sandbox, { filename: 'attachment-legality.js' });
  vm.runInContext(rosterSrc, sandbox, { filename: 'roster-data.js' });
  vm.runInContext(classSrc, sandbox, { filename: 'class-data.js' });
  vm.runInContext(appSrc, sandbox, { filename: 'app.js' });

  const diag = win.BF6_LAB_DIAG;
  if (!diag) throw new Error('app.js did not expose window.BF6_LAB_DIAG');

  // init() is async; wait for the data loads to settle.
  const deadline = Date.now() + 20000;
  while (!diag.ready() && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 25));
  }
  if (!diag.ready()) throw new Error('harness timed out waiting for data load');

  return { diag, window: win, fetched, env: diag.env() };
}
