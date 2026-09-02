#!/usr/bin/env node
// Local static file server for development and visual QA only.
// Not part of the deployed application; the production site is static hosting.
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, normalize, join } from 'node:path';

const ROOT = process.cwd();
const PORT = Number(process.env.PORT || 8181);
const SNAPSHOT_DIR = process.env.BF6_SNAPSHOT_DIR || ROOT;
await mkdir(SNAPSHOT_DIR, { recursive: true });
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json'
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    // Dev-only sink so the browser QA/baseline harness can persist large
    // engine snapshots to disk. Never used by the application itself.
    if (req.method === 'POST' && url.pathname === '/__snapshot') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const name = (url.searchParams.get('name') || 'snapshot').replace(/[^a-zA-Z0-9._-]/g, '');
      await writeFile(join(SNAPSHOT_DIR, `${name}.json`), Buffer.concat(chunks));
      res.writeHead(200, { 'content-type': 'text/plain' }).end('saved');
      return;
    }
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const safe = normalize(rel);
    const file = join(ROOT, safe);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
}).listen(PORT, () => console.log(`BF6 Weapons Lab dev server: http://localhost:${PORT}`));
