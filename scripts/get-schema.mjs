#!/usr/bin/env node
// Download Pixso's kiwi schema (pixso.binary) next to the package.
// This file is Pixso's, so it is fetched at install time rather than redistributed.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const URL = process.env.PIXSO_SCHEMA_URL || "https://pixso.net/app/pixso.binary";
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "pixso.binary");

const r = await fetch(URL);
if (!r.ok) { console.error(`failed to fetch ${URL}: ${r.status}`); process.exit(1); }
const buf = Buffer.from(await r.arrayBuffer());
if (buf.length < 1000 || buf.subarray(2, 12).toString() !== "schemaInfo") {
  console.error("unexpected schema contents; aborting"); process.exit(1);
}
writeFileSync(out, buf);
console.log(`saved ${out} (${buf.length} bytes)`);
