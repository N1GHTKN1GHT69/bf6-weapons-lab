import { mkdir, writeFile } from "node:fs/promises";
import { auditPointData } from "./point-audit.mjs";

const sources = {
  "weapons.json":"https://raw.githubusercontent.com/raymdl/BF6-Weapon-Analyzer/refs/heads/main/data/weapons.json",
  "attachments.json":"https://raw.githubusercontent.com/raymdl/BF6-Weapon-Analyzer/refs/heads/main/data/attachments.json",
  "ammo.json":"https://raw.githubusercontent.com/raymdl/BF6-Weapon-Analyzer/refs/heads/main/data/ammo.json"
};

await mkdir(new URL("../data/", import.meta.url), {recursive:true});
const downloaded = {};
for (const [name,url] of Object.entries(sources)) {
  const r = await fetch(url, {headers:{"user-agent":"bf6-build-lab-sync"}});
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
  const text = await r.text();
  downloaded[name] = {text, json:JSON.parse(text)};
}

const pointAudit = auditPointData(downloaded["attachments.json"].json, downloaded["ammo.json"].json);
if (!pointAudit.ok) {
  throw new Error(`Refusing to publish source data: point audit failed:\n${pointAudit.errors.join("\n")}`);
}

for (const [name,{text}] of Object.entries(downloaded)) {
  await writeFile(new URL(`../data/${name}`, import.meta.url), text);
  console.log(`synced ${name}`);
}
console.log("Pick-100 point audit: PASS");
