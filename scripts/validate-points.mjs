import { readFile } from "node:fs/promises";
import { auditPointData } from "./point-audit.mjs";
const attachments = JSON.parse(await readFile(new URL("../data/attachments.json", import.meta.url), "utf8"));
const ammo = JSON.parse(await readFile(new URL("../data/ammo.json", import.meta.url), "utf8"));
const report = auditPointData(attachments, ammo);
for (const w of report.warnings) console.warn(`POINT WARNING: ${w}`);
if (!report.ok) {
  console.error("POINT AUDIT FAILED");
  for (const e of report.errors) console.error(`- ${e}`);
  process.exit(1);
}
console.log("POINT/SCHEMA AUDIT PASSED");
