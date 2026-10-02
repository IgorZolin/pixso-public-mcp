#!/usr/bin/env node
// Pull the Pixso document model out of a saved .har (DevTools export).
// The coop websocket frames live in entry._webSocketMessages[].data (base64).
//   node pixso-har.mjs pixso_net.har [out.bin]
import { readFileSync, writeFileSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";

const ZSTD = Buffer.from("28b52ffd", "hex");

export function docFromHar(harPath) {
  const har = JSON.parse(readFileSync(harPath, "utf8"));
  const payloads = [];
  for (const e of har.log.entries) {
    if (!/\/ws\/coop/.test(e.request?.url || "")) continue;
    for (const m of e._webSocketMessages || []) {
      if (m.type !== "receive") continue;
      const buf = Buffer.from(m.data, "base64");
      const i = buf.indexOf(ZSTD);
      if (i < 0) continue;
      try { payloads.push(zstdDecompressSync(buf.subarray(i))); } catch {}
    }
  }
  if (!payloads.length) throw new Error("no decodable coop document frame in HAR");
  payloads.sort((a, b) => b.length - a.length); // largest = document
  return payloads[0];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const doc = docFromHar(process.argv[2]);
  const out = process.argv[3] || "doc.bin";
  writeFileSync(out, doc);
  console.log(`document ${doc.length} bytes -> ${out}`);
}
