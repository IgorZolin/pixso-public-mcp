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
import { pathToFileURL } from "node:url";

const API = process.env.PIXSO_API || "https://api.pixso.net";
const WS = process.env.PIXSO_WS || "wss://api.pixso.net";
const SCHEMA = process.env.PIXSO_SCHEMA || "v10.01";
const MAX_MS = Number(process.env.PIXSO_WAIT_MS || 20000); // hard cap
const QUIET_MS = Number(process.env.PIXSO_QUIET_MS || 1200); // settle after last growth
// check_schema_version:false by default — our SCHEMA constant can lag the server's
// current version, and with the check on the server rejects FileInit (= no frames).
const CHECK_SCHEMA = process.env.PIXSO_CHECK_SCHEMA === "1";
const DEBUG = process.env.PIXSO_DEBUG === "1";
const dbg = (...a) => { if (DEBUG) console.error("[pixso]", ...a); };

const ZSTD_MAGIC = Buffer.from("28b52ffd", "hex");

export async function getAccess(fileKey) {
  const url = `${API}/api/pix/file/${encodeURIComponent(fileKey)}/access`;
  let r, text;
  try { r = await fetch(url, { headers: { Accept: "application/json" } }); text = await r.text(); }
  catch (e) { throw new Error(`cannot reach ${API} (${e.message}). Check network / PIXSO_API.`); }
  let j;
  try { j = JSON.parse(text); }
  catch { throw new Error(`access: non-JSON from ${API} (HTTP ${r.status}). Wrong host or blocked? Body: ${text.slice(0, 120)}`); }
  if (j.code !== 200 && j.code !== 0) throw new Error(`access failed: code=${j.code} msg=${j.msg}`);
  return j.data;
}

// The coop "FileInit" command is a framed binary message, NOT raw text:
//   01 05 0e  "FileInit"\0  0f  <json>\0  12 00 00 00
// (tag-prefixed, null-terminated strings). Raw text is rejected: text frames
// close with 1003, and a bare "FileInit{...}" binary frame fails to decode
// ("COOP ERROR / data decode failed"). Byte-verified against browser captures.
function frameFileInit(json) {
  return Buffer.concat([
    Buffer.from([0x01, 0x05, 0x0e]),
    Buffer.from("FileInit\0", "latin1"),
    Buffer.from([0x0f]),
    Buffer.from(json + "\0", "utf8"),
    Buffer.from([0x12, 0x00, 0x00, 0x00]),
  ]);
}

// Pull the document snapshot over the coop websocket. Event-driven: resolves
// QUIET_MS after the largest payload stops growing (so slow loads still arrive),
// with a MAX_MS hard cap. Returns the largest decompressed payload (the document).
export function pullDocument(fileKey, token, { maxMs = MAX_MS, quietMs = QUIET_MS } = {}) {
  return new Promise((resolve, reject) => {
    const connId = crypto.randomUUID();
    const connParam = Buffer.from(token, "utf8").toString("base64");
    const url = `${WS}/ws/coop?file_key=${encodeURIComponent(fileKey)}&conn_id=${connId}&conn_param=${connParam}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";

    let best = null, done = false, quiet = null, nMsg = 0;
    const sent = { v: false };
    const sendInit = () => {
      if (sent.v) return;
      sent.v = true;
      const json = `{"is_initial":true,"is_reconnect":false,"access":"LoadAll","check_schema_version":${CHECK_SCHEMA},"schema_version":"${SCHEMA}"}`;
      dbg("send FileInit (framed)", json);
      ws.send(frameFileInit(json));
    };
    const finish = (err) => {
      if (done) return; done = true;
      clearTimeout(quiet); clearTimeout(hard);
      try { ws.close(); } catch {}
      if (err) return reject(err);
      if (!best) return reject(new Error("no document frame received (file may not be public, token expired, or wrong host)"));
      resolve(best);
    };
    const hard = setTimeout(() => { dbg("hard cap", maxMs + "ms", "best=" + (best?.length ?? "none")); finish(); }, maxMs);

    ws.addEventListener("open", () => { dbg("ws open"); sendInit(); }); // send immediately, don't wait for a handshake frame
    ws.addEventListener("message", (ev) => {
      nMsg++;
      if (typeof ev.data === "string") { dbg(`msg#${nMsg} string ${ev.data.length}b`, ev.data.slice(0, 2000)); if (!sent.v) sendInit(); return; }
      const buf = Buffer.from(ev.data);
      const i = buf.indexOf(ZSTD_MAGIC);
      dbg(`msg#${nMsg} binary ${buf.length}b zstd@${i}`);
      if (i >= 0) {
        try {
          const out = zstdDecompressSync(buf.subarray(i));
          dbg(`  zstd -> ${out.length}b`);
          if (!best || out.length > best.length) {
            best = out;                              // new largest = the document
            clearTimeout(quiet);
            quiet = setTimeout(() => finish(), quietMs); // settle, then resolve
          }
        } catch (e) { dbg("  zstd fail", e.message); /* partial/continuation frame */ }
      }
      if (!sent.v) sendInit();
    });
    ws.addEventListener("error", (e) => { dbg("ws error", e?.message || e); finish(new Error("ws error: " + (e?.message || e))); });
    ws.addEventListener("close", (e) => { dbg("ws close", e?.code, e?.reason); if (best) finish(); }); // server closed after sending
  });
}

// Accept a bare file_key or a full design URL (…/app/design/<key>?…).
export function fileKeyOf(input) {
  const s = String(input).trim();
  const m = s.match(/\/design\/([^/?#]+)/);
  return m ? m[1] : s;
}

export async function fetchDocument(input) {
  const fileKey = fileKeyOf(input);
  const access = await getAccess(fileKey);
  if (!(access.public_access || access.tourist_access)) {
    throw new Error("file is not publicly accessible (no public_access / tourist_access)");
  }
  const doc = await pullDocument(fileKey, access.token);
  return { access, doc };
}

// CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
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
