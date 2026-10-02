#!/usr/bin/env node
// Read a PUBLIC Pixso design file anonymously and dump its raw document model.
// Chain: /access (tourist token) -> wss /ws/coop -> FileInit{LoadAll} -> zstd frames.
// Zero dependencies: uses Node's global fetch, global WebSocket, and node:zlib zstd.
// Node >= 22.15 (built-in zstd + WebSocket).
//
//   node pixso-fetch.mjs <file_key> [outfile]
//   node pixso-fetch.mjs TFw4cRpnHSqbHWloz60eLA doc.bin
//
// Only works for files whose /access reports public_access / tourist_access.
// Needs real network to api.pixso.net (run on a normal machine, not a locked-down shell).

import { zstdDecompressSync } from "node:zlib";
import { writeFileSync } from "node:fs";

const API = process.env.PIXSO_API || "https://api.pixso.net";
const WS = process.env.PIXSO_WS || "wss://api.pixso.net";
const SCHEMA = process.env.PIXSO_SCHEMA || "v10.01";
const WAIT_MS = Number(process.env.PIXSO_WAIT_MS || 8000);

const ZSTD_MAGIC = Buffer.from("28b52ffd", "hex");

export async function getAccess(fileKey) {
  const r = await fetch(`${API}/api/pix/file/${encodeURIComponent(fileKey)}/access`, {
    headers: { Accept: "application/json" },
  });
  const j = await r.json();
  if (j.code !== 200 && j.code !== 0) throw new Error(`access failed: code=${j.code} msg=${j.msg}`);
  return j.data;
}

// Pull the document snapshot over the coop websocket. Returns the largest
// decompressed payload seen (the editor-channel document model).
export function pullDocument(fileKey, token, { waitMs = WAIT_MS } = {}) {
  return new Promise((resolve, reject) => {
    const connId = crypto.randomUUID();
    const connParam = Buffer.from(token, "utf8").toString("base64");
    const url = `${WS}/ws/coop?file_key=${encodeURIComponent(fileKey)}&conn_id=${connId}&conn_param=${connParam}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";

    const payloads = []; // {raw, decompressed}
    let sent = false;
    const sendInit = () => {
      if (sent) return;
      sent = true;
      ws.send(`FileInit{"is_initial":true,"is_reconnect":false,"access":"LoadAll","check_schema_version":true,"schema_version":"${SCHEMA}"}`);
    };

    ws.addEventListener("open", () => {});
    ws.addEventListener("message", (ev) => {
      if (typeof ev.data === "string") { if (!sent) sendInit(); return; } // handshake text
      const buf = Buffer.from(ev.data);
      const i = buf.indexOf(ZSTD_MAGIC);
      if (i >= 0) {
        try {
          const out = zstdDecompressSync(buf.subarray(i));
          payloads.push({ rawLen: buf.length, decompressed: out });
        } catch { /* partial/continuation frame; ignore */ }
      }
      if (!sent) sendInit();
    });
    ws.addEventListener("error", (e) => reject(new Error("ws error: " + (e?.message || e))));

    const finish = () => {
      try { ws.close(); } catch {}
      if (!payloads.length) return reject(new Error("no document frame received (file may not be public, or token expired)"));
      // largest decompressed payload = the document model; smaller ones are presence
      payloads.sort((a, b) => b.decompressed.length - a.decompressed.length);
      resolve(payloads[0].decompressed);
    };
    setTimeout(finish, waitMs);
  });
}

export async function fetchDocument(fileKey) {
  const access = await getAccess(fileKey);
  if (!(access.public_access || access.tourist_access)) {
    throw new Error("file is not publicly accessible (no public_access / tourist_access)");
  }
  const doc = await pullDocument(fileKey, access.token);
  return { access, doc };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const fileKey = process.argv[2];
  const out = process.argv[3] || "doc.bin";
  if (!fileKey) { console.error("usage: node pixso-fetch.mjs <file_key> [outfile]"); process.exit(2); }
  try {
    const { access, doc } = await fetchDocument(fileKey);
    writeFileSync(out, doc);
    console.log(JSON.stringify({
      file_key: fileKey,
      name: access.name,
      public_access: access.public_access,
      tourist_access: access.tourist_access,
      permission: access.permission ?? access.real_level,
      document_bytes: doc.length,
      saved_to: out,
    }, null, 2));
  } catch (e) {
    console.error("ERROR:", e.message);
    process.exit(1);
  }
}
