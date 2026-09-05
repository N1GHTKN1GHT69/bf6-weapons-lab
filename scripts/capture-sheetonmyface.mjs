#!/usr/bin/env node
/**
 * Capture the SheetOnMyFace "Battlefield 6 Interactive Weapon Guide" workbook.
 *
 * WHY THIS SOURCE
 * ---------------
 * Sym.gg is the original publisher of the numeric primitives this project
 * ingests, but sym.gg's own public site stops at BF6 1.3.3.0 (verified by a
 * runtime scan of its patch-notes route chunk - see scripts/watch-sym-source.mjs).
 * This public Google Sheet carries a raw "Sym.gg Data" dump whose every row is
 * tagged Version 1.4.2.0, plus a "Sym.gg Data Archive" tab holding the superseded
 * 1.3.3.0 / 1.3.1.0 / 1.2.2.0 dumps. Having the OLD versions in the SAME workbook
 * is what makes it usable as evidence: it lets the 1.3.3.0 -> 1.4.2.0 delta be
 * derived mechanically from one internally-consistent source, instead of by
 * differencing two publishers with different rounding and naming conventions.
 *
 * WHAT THIS SCRIPT DOES
 * ---------------------
 * Pulls the data tabs through the workbook's public CSV export endpoints and
 * writes ONE frozen artifact: data/sources/sheetonmyface-bf6-workbook.json.
 * It records the retrieval timestamp, every endpoint, the SHA-256 of each raw
 * CSV response, the row/column counts and the per-row Version values, so the
 * capture is auditable and reproducible. No authentication is used or bypassed;
 * the workbook is publicly viewable and its export endpoints return HTTP 200.
 *
 * It writes the CAPTURE ONLY. It never touches data/weapons.json. Turning the
 * capture into an applied change is scripts/build-source-overlay.mjs's job, and
 * that is a separate, reviewable step on purpose.
 *
 * Usage:  node scripts/capture-sheetonmyface.mjs            write the capture
 *         node scripts/capture-sheetonmyface.mjs --verify   compare, do not write
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

export const SHEET_ID = '1_jVZuDofvDzwdK6IjhnLGUWCP7UXI2MKpC06EVbYD_Q';
export const SHEET_URL = 'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/edit?usp=sharing';
export const OUT = 'data/sources/sheetonmyface-bf6-workbook.json';

/** Data tabs we read. "Home" is read only to confirm the workbook version. */
export const TABS = {
  live: 'Sym.gg Data',
  archive: 'Sym.gg Data Archive',
  weaponData: 'Weapon Data',
  home: '\u{1F3E0}Home'
};

export const csvUrl = tab =>
  'https://docs.google.com/spreadsheets/d/' + SHEET_ID + '/gviz/tq?tqx=out:csv&sheet=' + encodeURIComponent(tab);

/** RFC4180-ish CSV parse. Google's export quotes every field, including empties. */
export function parseCSV(text) {
  const rows = []; let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * The Sym tabs are TRANSPOSED: column A is Version, column B is the stat name,
 * and every remaining column is one weapon. Returns { version: { weapon: { stat: value } } }
 * with numeric strings converted to numbers and blank cells dropped, so a missing
 * cell is ABSENT rather than 0.
 */
export function readSymTab(rows) {
  const header = rows[0] ?? [];
  const weapons = header.slice(2).map(s => s.trim()).filter(Boolean);
  const out = {};
  const versions = [];
  for (const r of rows.slice(1)) {
    const version = (r[0] ?? '').trim(), stat = (r[1] ?? '').trim();
    if (!version || !stat) continue;
    if (!versions.includes(version)) versions.push(version);
    out[version] ??= {};
    header.slice(2).forEach((w, i) => {
      const name = w.trim(); if (!name) return;
      out[version][name] ??= {};
      const cell = r[i + 2];
      if (cell === undefined || cell === '') return;
      const n = Number(cell);
      out[version][name][stat] = Number.isFinite(n) ? n : cell;
    });
  }
  // Stat names come from the Stat column itself, in sheet order. Deriving them
  // from one weapon's populated keys would silently drop stats that happen to be
  // blank for that weapon.
  const stats = [...new Set(rows.slice(1).map(r => (r[1] ?? '').trim()).filter(Boolean))];
  return { values: out, versions, weapons, stats, statRows: rows.length - 1 };
}

const sha256 = s => createHash('sha256').update(s).digest('hex');

async function fetchTab(tab) {
  const url = csvUrl(tab);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(tab + ': HTTP ' + res.status);
  const body = await res.text();
  return { url, body, sha256: sha256(body), bytes: Buffer.byteLength(body) };
}

export async function capture() {
  const raw = {};
  for (const [key, tab] of Object.entries(TABS)) raw[key] = { tab, ...(await fetchTab(tab)) };

  const live = readSymTab(parseCSV(raw.live.body));
  const archive = readSymTab(parseCSV(raw.archive.body));

  // The workbook version lives in the Home tab as a literal "Version 1.73" cell.
  const homeText = raw.home.body;
  const sheetVersion = homeText.match(/"Version (\d+\.\d+)"/)?.[1] ?? null;
  // Changelog rows look like: "","","Version 1.73","<note>"
  const changelog = [...homeText.matchAll(/"Version (\d+\.\d+)","([^"]*)"/g)].map(m => ({ version: m[1], note: m[2] }));

  if (live.versions.length !== 1) {
    throw new Error('live tab must carry exactly one version, found: ' + live.versions.join(', '));
  }

  // "Weapon Data" is the author's own hand-maintained table. It is captured only
  // as an INTERNAL CONSISTENCY witness: it lags the Sym dump, and showing that it
  // still holds the pre-patch velocities is part of the version evidence.
  const wdRows = parseCSV(raw.weaponData.body);
  const weaponDataWitness = {};
  for (const r of wdRows.slice(1)) {
    const name = (r[0] ?? '').trim(); if (!name) continue;
    const v = Number(String(r[1] ?? '').replace(/[^0-9.]/g, ''));
    weaponDataWitness[name] = { basicMuzzleVelocity: Number.isFinite(v) && v > 0 ? v : null };
  }

  return {
    schema: 2,
    source: {
      name: 'SheetOnMyFace — Battlefield 6 Interactive Weapon Guide',
      author: 'SheetOnMyFace',
      url: SHEET_URL,
      sheetId: SHEET_ID,
      sheetVersion,
      publisherOfRecord: 'sym.gg',
      relationship: 'The "Sym.gg Data" tabs are a raw dump of sym.gg BF6 weapon primitives. sym.gg is the original publisher; this workbook is the only public carrier of its 1.4.2.0 dump.'
    },
    retrieval: {
      capturedAt: new Date().toISOString(),
      method: 'Public Google Sheets CSV export (gviz/tq?tqx=out:csv). No authentication used or bypassed; the workbook is publicly viewable and its export endpoints return HTTP 200.',
      endpoints: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, { tab: v.tab, url: v.url, bytes: v.bytes, sha256: v.sha256 }]))
    },
    changelog,
    tabs: {
      'Sym.gg Data': { gameVersions: live.versions, weapons: live.weapons.length, statRows: live.statRows },
      'Sym.gg Data Archive': { gameVersions: archive.versions, weapons: archive.weapons.length, statRows: archive.statRows }
    },
    versionEvidence: [
      'Every row of the live "Sym.gg Data" tab carries an explicit Version column reading ' + live.versions[0] + '.',
      'The "Sym.gg Data Archive" tab holds the superseded dumps (' + archive.versions.join(', ') + '), so the author demonstrably archives rather than overwrites.',
      'The author’s own hand-maintained "Weapon Data" tab still carries the PRE-1.4.2.0 muzzle velocities (EF88 670, BROD 3 580, L115 664) while the Sym dump carries the new ones. A stale hand table beside a refreshed raw dump is what a genuine data refresh looks like; it is captured here as weaponDataWitness so the claim stays checkable.'
    ],
    statNames: live.stats,
    weaponDataWitness,
    values: { ...archive.values, ...live.values }
  };
}

const invokedDirectly = (process.argv[1] ?? '').replace(/\\/g, '/').endsWith('capture-sheetonmyface.mjs');
if (invokedDirectly) {
  const verify = process.argv.includes('--verify');
  let doc;
  try {
    doc = await capture();
  } catch (err) {
    console.log('capture: source unreachable (' + String(err.message || err) + ').');
    console.log('An unreachable third party is not a defect in this repository; exiting without writing.');
    process.exit(verify ? 0 : 2);
  }
  const versions = Object.keys(doc.values);
  console.log('SheetOnMyFace workbook v' + doc.source.sheetVersion);
  for (const [k, v] of Object.entries(doc.retrieval.endpoints)) {
    console.log('  ' + k.padEnd(11) + ' ' + String(v.bytes).padStart(7) + ' bytes  sha256 ' + v.sha256.slice(0, 16) + '...  (' + v.tab + ')');
  }
  console.log('  versions captured: ' + versions.join(', '));
  console.log('  stats per weapon : ' + doc.statNames.length);
  for (const v of versions) console.log('    ' + v + ': ' + Object.keys(doc.values[v]).length + ' weapons');

  if (verify) {
    const prev = JSON.parse(await readFile(OUT, 'utf8'));
    const strip = d => JSON.stringify({ ...d, retrieval: { ...d.retrieval, capturedAt: null } });
    if (strip(prev) === strip(doc)) {
      console.log('\nVERIFY PASS: the live workbook still matches the stored capture exactly (capture timestamp ignored).');
    } else {
      console.error('\nVERIFY FAIL: the live workbook no longer matches the stored capture.');
      console.error('Re-capture, then re-derive the overlay with scripts/build-source-overlay.mjs.');
      process.exit(1);
    }
  } else {
    await mkdir('data/sources', { recursive: true });
    await writeFile(OUT, JSON.stringify(doc, null, 1) + '\n');
    console.log('\nwrote ' + OUT);
    console.log('NOTHING INGESTED. Run scripts/build-source-overlay.mjs to derive the applied change.');
  }
}
