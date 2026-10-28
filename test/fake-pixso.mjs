// Fake Pixso server shared by the coop and MCP tests: /access over HTTP and a minimal
// WebSocket coop endpoint (FileInit -> FIC_DOCUMENT; JOIN_START -> NODE_CHANGES newer
// than the checkpoint -> JOIN_START_SKIP_RELOAD). Not a test file by itself.
import http from "node:http";
import crypto from "node:crypto";
import * as zlib from "node:zlib";
import { encodeMsg, decodeMsg } from "../pixso-kiwi.mjs";

const G = (s, l) => ({ sessionID: s, localID: l });
export const PREFIX = (tag) => Buffer.concat([Buffer.from("pixso-kw", "latin1"), Buffer.from([0, 3, 0x19]), Buffer.from(tag, "latin1"), Buffer.from("04000000e50c00000000", "hex")]);
const frameOut = (msg) => Buffer.concat([PREFIX("ZSTD"), zlib.zstdCompressSync(encodeMsg(msg))]);
function wsSend(sock, payload) { // server -> client: unmasked binary frame
  const n = payload.length, head = n < 126 ? Buffer.from([0x82, n]) : n < 65536 ? Buffer.from([0x82, 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x82, 127]), (() => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(n)); return b; })()]);
  sock.write(Buffer.concat([head, payload]));
}
function wsFrames(buf) { // client -> server: masked frames -> payloads (+ rest)
  const out = []; let p = 0;
  while (p + 2 <= buf.length) {
    let len = buf[p + 1] & 127, h = 2;
    if (len === 126) { len = buf.readUInt16BE(p + 2); h = 4; } else if (len === 127) { len = Number(buf.readBigUInt64BE(p + 2)); h = 10; }
    if (p + h + 4 + len > buf.length) break;
    const mask = buf.subarray(p + h, p + h + 4), data = Buffer.from(buf.subarray(p + h + 4, p + h + 4 + len));
    for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
    out.push({ op: buf[p] & 15, data }); p += h + 4 + len;
  }
  return { out, rest: buf.subarray(p) };
}

export function fakePixso(log = []) {
  const doc = { type: "FIC_DOCUMENT", sessionID: 3301, pixsoNodes: [
    { guid: G(0, 0), type: "DOCUMENT", name: "doc", phase: "CREATED" },
    { guid: G(0, 1), type: "CANVAS", name: "Page", phase: "CREATED", parentIndex: { guid: G(0, 0), position: "a" } },
    { guid: G(3302, 1), type: "FRAME", name: "Карточка", phase: "CREATED", parentIndex: { guid: G(0, 1), position: "a" } }] };
  const server = http.createServer((req, res) => {
    log.push("GET " + req.url);
    res.end(JSON.stringify({ code: 200, data: { name: "F", public_access: true, tourist_access: true, token: "tok", modify_at: "2026-10-28T10:00:00Z" } }));
  });
  server.on("upgrade", (req, sock) => {
    log.push("WS " + new URL(req.url, "http://x").pathname);
    const accept = crypto.createHash("sha1").update(req.headers["sec-websocket-key"] + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    sock.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    let buf = Buffer.alloc(0);
    sock.on("data", (d) => {
      const { out, rest } = wsFrames(Buffer.concat([buf, d])); buf = rest;
      for (const f of out) {
        if (f.op === 8) { sock.end(); return; }
        if (f.data.includes(Buffer.from("FileInit"))) {
          log.push("FileInit");
          wsSend(sock, frameOut(doc));
          wsSend(sock, frameOut({ type: "USER_CHANGES", sessionID: 3290, userInfos: [] })); // someone's cursor: ignored
        } else if (f.data.subarray(0, 8).toString() === "pixso-kw" && f.data.includes(Buffer.from("NONE"))) {
          const msg = decodeMsg(f.data.subarray(PREFIX("NONE").length));
          log.push(`${msg.type} session=${msg.sessionID} user=${msg.userInfos?.[0]?.name}`);
          wsSend(sock, frameOut({ type: "JOIN_START", sessionID: msg.sessionID, ackID: 0 }));
          wsSend(sock, frameOut({ type: "NODE_CHANGES", sessionID: 3312, pixsoNodes: [
            { guid: G(3312, 169453), type: "VECTOR", name: "icon/signature", phase: "CREATED", parentIndex: { guid: G(3302, 1), position: "b" } },
            { guid: G(3302, 1), name: "Карточка v2" }] }));
          wsSend(sock, frameOut({ type: "JOIN_START_SKIP_RELOAD", sessionID: msg.sessionID }));
        }
      }
    });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

