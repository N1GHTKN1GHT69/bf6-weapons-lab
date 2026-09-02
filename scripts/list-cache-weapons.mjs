#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const upstream=resolve(process.argv[2]||'.upstream/bf6-analyzer');
const weapons=JSON.parse(await readFile(join(upstream,'data/weapons.json'),'utf8'));
const include=weapons.map(w=>({
  weapon_id:w.id,
  weapon_name:w.name,
  class_name:w.cls,
  slug:String(w.id).replace(/[^A-Za-z0-9_.-]/g,'_')
}));
process.stdout.write(JSON.stringify({include}));
