import { mkdir, writeFile } from "node:fs/promises";
import { auditPointData } from "./point-audit.mjs";

const sources = {
  weapons: "https://raw.githubusercontent.com/raymdl/BF6-Weapon-Analyzer/refs/heads/main/data/weapons.json",
  attachments: "https://raw.githubusercontent.com/raymdl/BF6-Weapon-Analyzer/refs/heads/main/data/attachments.json",
  ammo: "https://raw.githubusercontent.com/raymdl/BF6-Weapon-Analyzer/refs/heads/main/data/ammo.json",
  ballistics: "https://raw.githubusercontent.com/raymdl/BF6-Weapon-Analyzer/refs/heads/main/data/ballistics.json"
};
const out = new URL("../data/", import.meta.url);
await mkdir(out, { recursive:true });

async function download(kind) {
  const r = await fetch(sources[kind], { headers:{"user-agent":"bf6-weapons-lab-sync"} });
  if (!r.ok) throw new Error(`${kind}: HTTP ${r.status}`);
  const text = await r.text();
  return { text, json: JSON.parse(text) };
}

// Weapon stats are independent: publish them even if attachment validation has a problem.
try {
  const w = await download("weapons");
  if (!Array.isArray(w.json)) throw new Error("weapons: expected array");
  await writeFile(new URL("weapons.json", out), w.text);
  console.log(`synced weapons.json (${w.json.length} records)`);
} catch (err) {
  console.warn(`weapon sync skipped: ${err.message}`);
}

// Projectile timing is an independent source contract. Keep the previous local
// snapshot if the current upstream ballistics file cannot be validated.
try {
  const b = await download("ballistics");
  if (!(Number(b.json?.baseDragPerMeter) >= 0) || !Array.isArray(b.json?.weaponIds)) throw new Error("ballistics: invalid schema");
  await writeFile(new URL("ballistics.json", out), b.text);
  console.log(`synced ballistics.json (${b.json.weaponIds.length} verified weapon ids)`);
} catch (err) {
  console.warn(`ballistics sync skipped: ${err.message}`);
}

// Attachment and ammo sources are coupled for point-safe builds. Publish them only as a pair after schema/cost audit.
try {
  const [a, m] = await Promise.all([download("attachments"), download("ammo")]);
  const report = auditPointData(a.json, m.json);
  for (const w of report.warnings) console.warn(`POINT WARNING: ${w}`);
  if (!report.ok) {
    console.error("POINT AUDIT FAILED; keeping previous attachment/ammo snapshot if one exists.");
    for (const e of report.errors) console.error(`- ${e}`);
  } else {
    await writeFile(new URL("attachments.json", out), a.text);
    await writeFile(new URL("ammo.json", out), m.text);
    console.log("synced attachments.json + ammo.json • point/schema audit PASS");
  }
} catch (err) {
  console.warn(`attachment/ammo sync skipped: ${err.message}`);
}
