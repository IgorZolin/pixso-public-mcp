#!/usr/bin/env node
// Read a PUBLIC Pixso design file anonymously and dump its raw document model.
// Chain: /access (tourist token) -> wss /ws/coop -> FileInit{LoadAll} -> FIC_DOCUMENT
// -> JOIN_START (like the web client) -> edits newer than the saved checkpoint.
// Zero dependencies: Node's global fetch, global WebSocket and node:zlib zstd (Node >= 22.15).
//
//   node pixso-fetch.mjs <file_key|url> [outfile]
//   node pixso-fetch.mjs https://pixso.net/app/design/TFw4cRpnHSqbHWloz60eLA doc.bin
//
// Only works for files whose /access reports public_access / tourist_access.

import * as zlib from "node:zlib";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { encodeMsg } from "./pixso-kiwi.mjs";

if (typeof zlib.zstdDecompressSync !== "function" || typeof WebSocket !== "function")
  throw new Error(`pixso-public-mcp needs Node.js >= 22.15 (built-in zstd + WebSocket); this is ${process.version}. Point the MCP command at a newer node binary.`);

const SCHEMA = process.env.PIXSO_SCHEMA || "v10.01";
const MAX_MS = Number(process.env.PIXSO_WAIT_MS || 60000);   // hard cap; big files take a while
const QUIET_MS = Number(process.env.PIXSO_QUIET_MS || 1200);  // settle after the last document payload
const JOIN_WAIT_MS = Number(process.env.PIXSO_JOIN_WAIT_MS || 5000); // wait for the join reply
const JOIN = process.env.PIXSO_JOIN !== "0";
// check_schema_version:false by default — our SCHEMA constant can lag the server's
// current version, and with the check on the server rejects FileInit (= no frames).
const CHECK_SCHEMA = process.env.PIXSO_CHECK_SCHEMA === "1";
const DEBUG = process.env.PIXSO_DEBUG === "1";
const dbg = (...a) => { if (DEBUG) console.error("[pixso]", ...a); };

const ZSTD_MAGIC = Buffer.from("28b52ffd", "hex");

// ---------- links ----------
const KEY = /^[A-Za-z0-9_-]{16,40}$/;
// Accept a bare file key or any Pixso link (…/app/design/<key>?…, /file/, /proto/,
// self-hosted hosts, ?file_key=…).
export function fileKeyOf(input) {
  const s = String(input).trim();
  if (!/^[a-z]+:\/\/|\//i.test(s) && !s.includes("?")) return s;
  let u; try { u = new URL(/^[a-z]+:\/\//i.test(s) ? s : "https://x/" + s.replace(/^\/+/, "")); } catch { return s; }
  const q = u.searchParams.get("file_key") || u.searchParams.get("fileKey"); if (q) return q;
  const segs = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const i = segs.findIndex((p) => /^(design|file|files|proto|prototype|board|whiteboard|editor|dev|inspect)$/i.test(p));
  if (i >= 0 && segs[i + 1]) return segs[i + 1];
  return segs.reverse().find((p) => KEY.test(p)) || s;
}
const param = (input, ...names) => {
  for (const n of names) { const m = String(input).match(new RegExp(`[?&#]${n}=([^&#]+)`, "i")); if (m) return decodeURIComponent(m[1]).replace(/-/g, (c, i, str) => (/^\d+-\d+$/.test(str) ? ":" : c)); }
  return null;
};
// page-id: a page (CANVAS node id "s:l"); item-id / node-id: the layer selected when the link was copied
export const pageIdOf = (input) => param(input, "page-id", "pageId");
export const itemIdOf = (input) => param(input, "item-id", "itemId", "node-id");

// API / websocket origin: env wins; else a self-hosted link's own host; else pixso.net.
export function endpointsOf(input) {
  let host = null;
  try {
    const s = String(input).trim();
    const url = /^https?:\/\//i.test(s) ? s : /^[\w-]+(\.[\w-]+)+(:\d+)?\//.test(s) ? "https://" + s : null; // scheme-less links too
    if (url) host = new URL(url).host;
  } catch {}
  const own = host && !/(^|\.)pixso\.(net|cn)$/i.test(host);
  return {
    api: process.env.PIXSO_API || (own ? `https://${host}` : "https://api.pixso.net"),
    ws: process.env.PIXSO_WS || (own ? `wss://${host}` : "wss://api.pixso.net"),
  };
}

export async function getAccess(fileKey, api = endpointsOf(fileKey).api) {
  const url = `${api}/api/pix/file/${encodeURIComponent(fileKey)}/access`;
  let r, text;
  try { r = await fetch(url, { headers: { Accept: "application/json" } }); text = await r.text(); }
  catch (e) { throw new Error(`cannot reach ${api} (${e.cause?.code || e.message}). Check network / PIXSO_API.`); }
  let j;
  try { j = JSON.parse(text); }
  catch { throw new Error(`access: non-JSON from ${api} (HTTP ${r.status}). Wrong host or blocked? Body: ${text.slice(0, 120)}`); }
  if (j.code !== 200 && j.code !== 0) throw new Error(`access failed for file key "${fileKey}": code=${j.code} msg=${j.msg}`);
  return j.data;
}

// ---------- coop protocol ----------
// The coop "FileInit" command is a framed binary message, NOT raw text:
//   01 05 0e  "FileInit"\0  0f  <json>\0  12 00 00 00
// Text frames close with 1003; a bare "FileInit{...}" fails to decode. Byte-verified vs browser.
function frameFileInit(json) {
  return Buffer.concat([Buffer.from([0x01, 0x05, 0x0e]), Buffer.from("FileInit\0", "latin1"), Buffer.from([0x0f]),
    Buffer.from(json + "\0", "utf8"), Buffer.from([0x12, 0x00, 0x00, 0x00])]);
}

// A coop text frame like {"type":"Error","message":"{…\"err\":{\"desc\":…}}"} -> short reason, else null.
function serverError(text) {
  let j; try { j = JSON.parse(text); } catch { return null; }
  if (j?.type !== "Error") return null;
  let inner; try { inner = JSON.parse(j.message); } catch { return String(j.message || "unknown error"); }
  return [inner?.err?.desc, inner?.message].filter(Boolean).join(" — ") || "unknown error";
}

// PixsoMsgType values of schema v10.01 (kiwi writes `type` first, `sessionID` second).
const MSG = { JOIN_START: 1, NODE_CHANGES: 2, USER_CHANGES: 3, JOIN_END: 4, JOIN_START_SKIP_RELOAD: 8, SCENE_GRAPH_REPLY: 13, FIC_DOCUMENT: 14, PIX_DOCUMENT: 16, COMPONENT_REPLY: 20 };
const NODE_MSGS = new Set([MSG.NODE_CHANGES, MSG.SCENE_GRAPH_REPLY, MSG.FIC_DOCUMENT, MSG.PIX_DOCUMENT, MSG.COMPONENT_REPLY]);
const MSG_NAME = Object.fromEntries(Object.entries(MSG).map(([k, v]) => [v, k]));
export function msgHead(p) {
  let i = 0; const vu = () => { let r = 0, s = 0, c; do { c = p[i++]; r |= (c & 0x7f) << s; s += 7; } while (c & 0x80 && i < p.length); return r >>> 0; };
  const out = {};
  for (let n = 0; n < 2 && i < p.length; n++) {
    const f = vu();
    if (f === 1) out.type = vu(); else if (f === 2) { const z = vu(); out.sessionID = (z >>> 1) ^ -(z & 1); } else break;
  }
  return out;
}

// JOIN_START as the web client sends it for an anonymous viewer ("Гость"), in the
// same envelope the server used for the document (ZSTD -> NONE). Joining makes the
// server send edits that are newer than the stored checkpoint.
const G0 = { sessionID: 0, localID: 0 };
export function joinFrame(prefix, sid) {
  const msg = { type: "JOIN_START", sessionID: sid, ackID: 0, userInfos: [{
    sessionID: sid, name: "Гость", imageURL: "",
    viewport: { canvasSpaceBounds: { x: 0, y: 0, w: 1440, h: 900 }, pixelPreview: false, pixelDensity: -1, canvasGuid: { sessionID: 0, localID: 1 } },
    mouse: { cursor: "DEFAULT", canvasSpaceLocation: { x: NaN, y: NaN }, canvasSpaceSelectionBox: { x: 0, y: 0, w: 0, h: 0 }, canvasGuid: G0 },
    selection: [], observing: [], deviceName: "editor", recentClicks: [], scrollPositions: [], userID: "0",
    lastTriggeredHotspot: G0, lastTriggeredPrototypeInteractionID: G0, triggeredOverlaysData: [], spotlight: { sessionID: 0 }, lastTriggeredFlowStartPointId: G0 }] };
  const head = Buffer.from(prefix), z = head.indexOf("ZSTD");
  if (z >= 0) head.write("NONE", z, "latin1");
  return Buffer.concat([head, encodeMsg(msg)]);
}

// Pull the document over the coop websocket. Keeps every node-bearing payload
// (FIC_DOCUMENT, NODE_CHANGES, COMPONENT_REPLY, …) in arrival order — the decoder
// merges them. Finishes when the join is acknowledged (JOIN_START_SKIP_RELOAD /
// JOIN_END), after QUIET_MS without new document data, or at MAX_MS. Cursor and
// presence traffic from people editing the file is ignored.
export function pullDocument(fileKey, token, { ws: wsBase = endpointsOf(fileKey).ws, maxMs = MAX_MS, quietMs = QUIET_MS, join = JOIN } = {}) {
  return new Promise((resolve, reject) => {
    const connId = crypto.randomUUID();
    const connParam = Buffer.from(token, "utf8").toString("base64");
    const url = `${wsBase}/ws/coop?file_key=${encodeURIComponent(fileKey)}&conn_id=${connId}&conn_param=${connParam}`;
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";

    const parts = [], meta = { sessionID: null, joined: false, changes: 0, joinReply: null };
    let done = false, quiet = null, nMsg = 0, bytes = 0, zfail = 0, why = null;
    const t0 = Date.now();
    const settle = (ms) => { clearTimeout(quiet); quiet = setTimeout(() => finish(), ms); };
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
      if (!parts.length) return reject(new Error(why || `timed out after ${Math.round((Date.now() - t0) / 1000)}s waiting for the document (${nMsg} frames, ${bytes} bytes received${zfail ? `, ${zfail} undecodable zstd frames` : ""}). Big files can take longer: raise PIXSO_WAIT_MS (ms) and the client's MCP timeout.`));
      parts.meta = meta;
      resolve(parts);
    };
    const hard = setTimeout(() => { dbg("hard cap", maxMs + "ms", "parts=" + parts.length); finish(); }, maxMs);

    ws.addEventListener("open", () => { dbg("ws open"); sendInit(); });
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
      if (i < 0) { dbg(`msg#${nMsg} binary ${buf.length}b (uncompressed)`); if (!sent.v) sendInit(); return; }
      let out;
      try { out = zlib.zstdDecompressSync(buf.subarray(i)); } catch (e) { zfail++; dbg("  zstd fail", e.message); return; }
      const h = msgHead(out);
      dbg(`msg#${nMsg} ${MSG_NAME[h.type] || "type " + h.type} ${buf.length}b -> ${out.length}b session=${h.sessionID}`);
      if (h.type === undefined || NODE_MSGS.has(h.type)) {
        parts.push(out);
        if (h.type === MSG.NODE_CHANGES || h.type === MSG.COMPONENT_REPLY) meta.changes++;
        settle(meta.joined && !meta.joinReply ? JOIN_WAIT_MS : quietMs);
      }
      if ((h.type === MSG.FIC_DOCUMENT || h.type === MSG.PIX_DOCUMENT) && meta.sessionID == null) {
        meta.sessionID = h.sessionID;
        if (join && h.sessionID != null) {
          try { ws.send(joinFrame(buf.subarray(0, i), h.sessionID)); meta.joined = true; dbg("send JOIN_START session", h.sessionID); settle(JOIN_WAIT_MS); }
          catch (e) { dbg("join failed", e.message); }
        }
      }
      if (meta.joined && (h.type === MSG.JOIN_START_SKIP_RELOAD || h.type === MSG.JOIN_END)) { meta.joinReply = MSG_NAME[h.type]; settle(300); } // trailing changes
    });
    ws.addEventListener("error", (e) => { dbg("ws error", e?.message || e); finish(parts.length ? undefined : new Error("ws error: " + (e?.message || e))); });
    ws.addEventListener("close", (e) => {
      dbg("ws close", e?.code, e?.reason);
      if (!parts.length) why = `socket closed by server before the document arrived (code ${e?.code}${e?.reason ? ", " + e.reason : ""}, ${nMsg} frames received)`;
      finish();
    });
  });
}

export async function fetchDocument(input) {
  const fileKey = fileKeyOf(input), ep = endpointsOf(input);
  const access = await getAccess(fileKey, ep.api);
  if (!(access.public_access || access.tourist_access)) {
    throw new Error("file is not publicly accessible (no public_access / tourist_access)");
  }
  const parts = await pullDocument(fileKey, access.token, { ws: ep.ws });
  return { access, doc: packParts(parts), parts: parts.length, meta: { ...parts.meta, api: ep.api } };
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
  const input = process.argv[2];
  const out = process.argv[3] || "doc.bin";
  if (!input) { console.error("usage: node pixso-fetch.mjs <file_key|url> [outfile]"); process.exit(2); }
  try {
    const { access, doc, parts, meta } = await fetchDocument(input);
    writeFileSync(out, doc);
    console.log(JSON.stringify({
      file_key: fileKeyOf(input), name: access.name, public_access: access.public_access, tourist_access: access.tourist_access,
      permission: access.permission ?? access.real_level, modified: access.modify_at || access.updated_at,
      document_bytes: doc.length, payloads: parts, joined: meta.joined, join_reply: meta.joinReply, live_changes: meta.changes,
      api: meta.api, saved_to: out,
    }, null, 2));
  } catch (e) {
    console.error("ERROR:", e.message);
    process.exit(1);
  }
}
