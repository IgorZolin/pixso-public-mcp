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
const MAX_MS = Number(process.env.PIXSO_WAIT_MS || 60000); // hard cap; big files take a while
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

// A coop text frame like {"type":"Error","message":"{…\"err\":{\"desc\":…}}"} -> short reason, else null.
function serverError(text) {
  let j; try { j = JSON.parse(text); } catch { return null; }
  if (j?.type !== "Error") return null;
  let inner; try { inner = JSON.parse(j.message); } catch { return String(j.message || "unknown error"); }
  return [inner?.err?.desc, inner?.message].filter(Boolean).join(" — ") || "unknown error";
}

// Pull the document snapshot over the coop websocket. Event-driven: resolves
// QUIET_MS after the last zstd payload (so slow loads still arrive), with a MAX_MS
// hard cap. Returns ALL decompressed payloads in arrival order: the document is
// usually one FIC_DOCUMENT message, but big files / component replies / live edits
// can arrive as further node messages — the decoder merges them.
export function pullDocument(fileKey, token, { maxMs = MAX_MS, quietMs = QUIET_MS } = {}) {
  return new Promise((resolve, reject) => {
    const connId = crypto.randomUUID();
    const connParam = Buffer.from(token, "utf8").toString("base64");
    const url = `${WS}/ws/coop?file_key=${encodeURIComponent(fileKey)}&conn_id=${connId}&conn_param=${connParam}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";

    const parts = []; let done = false, quiet = null, nMsg = 0, bytes = 0, zfail = 0;
    const t0 = Date.now();
    const sent = { v: false };
    const sendInit = () => {
      if (sent.v) return;
      sent.v = true;
      const json = `{"is_initial":true,"is_reconnect":false,"access":"LoadAll","check_schema_version":${CHECK_SCHEMA},"schema_version":"${SCHEMA}"}`;
      dbg("send FileInit (framed)", json);
      ws.send(frameFileInit(json));
    };
    let why = null;
    const finish = (err) => {
      if (done) return; done = true;
      clearTimeout(quiet); clearTimeout(hard);
      try { ws.close(); } catch {}
      if (err) return reject(err);
      if (!parts.length) return reject(new Error(why || `timed out after ${Math.round((Date.now() - t0) / 1000)}s waiting for the document (${nMsg} frames, ${bytes} bytes received${zfail ? `, ${zfail} undecodable zstd frames` : ""}). Big files can take longer: raise PIXSO_WAIT_MS (ms) and the client's MCP timeout.`));
      resolve(parts);
    };
    const hard = setTimeout(() => { dbg("hard cap", maxMs + "ms", "parts=" + parts.length); finish(); }, maxMs);

    ws.addEventListener("open", () => { dbg("ws open"); sendInit(); }); // send immediately, don't wait for a handshake frame
    ws.addEventListener("message", (ev) => {
      nMsg++;
      if (typeof ev.data === "string") {
        dbg(`msg#${nMsg} string ${ev.data.length}b`, ev.data.slice(0, 2000));
        const err = serverError(ev.data);
        if (err && !parts.length) return finish(new Error(`Pixso server rejected the document request: ${err}`));
        if (!sent.v) sendInit();
        return;
      }
      const buf = Buffer.from(ev.data);
      bytes += buf.length;
      const i = buf.indexOf(ZSTD_MAGIC);
      dbg(`msg#${nMsg} binary ${buf.length}b zstd@${i}`);
      if (i >= 0) {
        try {
          const out = zstdDecompressSync(buf.subarray(i));
          dbg(`  zstd -> ${out.length}b`);
          parts.push(out);
          clearTimeout(quiet);
          quiet = setTimeout(() => finish(), quietMs); // settle after the last payload
        } catch (e) { zfail++; dbg("  zstd fail", e.message); /* partial/continuation frame */ }
      }
      if (!sent.v) sendInit();
    });
    ws.addEventListener("error", (e) => { dbg("ws error", e?.message || e); finish(new Error("ws error: " + (e?.message || e))); });
    ws.addEventListener("close", (e) => {
      dbg("ws close", e?.code, e?.reason);
      if (!parts.length) why = `socket closed by server before the document arrived (code ${e?.code}${e?.reason ? ", " + e.reason : ""}, ${nMsg} frames received)`;
      finish(); // server closed: done either way
    });
  });
}

// Accept a bare file_key or a full design URL (…/app/design/<key>?…).
export function fileKeyOf(input) {
  const s = String(input).trim();
  const m = s.match(/\/design\/([^/?#]+)/);
  return m ? m[1] : s;
}

// Pull page-id out of a design URL (…?page-id=27:1 or url-encoded 27%3A1).
// Returns a node id string (sessionID:localID) or null. A page is a CANVAS node,
// and selectTree matches by id, so this id scopes a fetch to one page.
export function pageIdOf(input) {
  const m = String(input).match(/[?&]page-id=([^&#]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

// item-id = the layer selected in the Pixso UI when the link was copied.
export function itemIdOf(input) {
  const m = String(input).match(/[?&]item-id=([^&#]+)/i);
  return m ? decodeURIComponent(m[1]) : null;
}

export async function fetchDocument(input) {
  const fileKey = fileKeyOf(input);
  const access = await getAccess(fileKey);
  if (!(access.public_access || access.tourist_access)) {
    throw new Error("file is not publicly accessible (no public_access / tourist_access)");
  }
  const parts = await pullDocument(fileKey, access.token);
  return { access, doc: packParts(parts), parts: parts.length };
}

// Several payloads -> one buffer: "PXDOCS\0" + u32 count + (u32 len + bytes)*.
// A single payload is stored as-is (plain kiwi document, as before).
const PACK = Buffer.from("PXDOCS\0", "latin1");
export function packParts(parts) {
  if (parts.length === 1) return parts[0];
  const head = Buffer.alloc(4); head.writeUInt32LE(parts.length);
  return Buffer.concat([PACK, head, ...parts.flatMap((p) => { const l = Buffer.alloc(4); l.writeUInt32LE(p.length); return [l, p]; })]);
}
export function unpackParts(buf) {
  buf = Buffer.from(buf);
  if (!buf.subarray(0, PACK.length).equals(PACK)) return [buf];
  const out = []; let p = PACK.length;
  const n = buf.readUInt32LE(p); p += 4;
  for (let i = 0; i < n; i++) { const l = buf.readUInt32LE(p); p += 4; out.push(buf.subarray(p, p + l)); p += l; }
  return out;
}

// CLI
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fileKey = process.argv[2];
  const out = process.argv[3] || "doc.bin";
  if (!fileKey) { console.error("usage: node pixso-fetch.mjs <file_key> [outfile]"); process.exit(2); }
  try {
    const { access, doc, parts } = await fetchDocument(fileKey);
    writeFileSync(out, doc);
    console.log(JSON.stringify({
      file_key: fileKey,
      name: access.name,
      public_access: access.public_access,
      tourist_access: access.tourist_access,
      permission: access.permission ?? access.real_level,
      document_bytes: doc.length,
      payloads: parts,
      saved_to: out,
    }, null, 2));
  } catch (e) {
    console.error("ERROR:", e.message);
    process.exit(1);
  }
}
