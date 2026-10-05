// Schema-driven kiwi decoder for Pixso documents. Exact and complete:
// uses the real kiwi schema (pixso.binary) extracted from the app, so every
// PixsoNode field decodes by its true type. No heuristics.
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { parseSchema } from "./kiwi-schema.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// Pixso's own compiled kiwi schema. Not bundled (it's Pixso's file) — fetch it once
// with `npm run schema` or set PIXSO_SCHEMA to its path.
export const schemaPath = () => process.env.PIXSO_SCHEMA || join(HERE, "pixso.binary");
let SCHEMA;
function schema() {
  if (!SCHEMA) {
    let buf;
    try { buf = readFileSync(schemaPath()); }
    catch { throw new Error(`kiwi schema not found at ${schemaPath()}. Run \`npm run schema\` (downloads pixso.binary from pixso.net) or set PIXSO_SCHEMA.`); }
    const { defs } = parseSchema(buf);
    SCHEMA = { defs, byName: new Map(defs.map((d, i) => [d.name, i])) };
  }
  return SCHEMA;
}
// def references are stored off-by-one in this schema build
const refDef = (defs, type) => defs[type + 1];

function reader(b) {
  let p = 0;
  const u8 = () => b[p++];
  const varuint = () => { let s = 0, r = 0, c; do { c = b[p++]; r |= (c & 0x7f) << s; s += 7; } while (c & 0x80); return r >>> 0; };
  const varint = () => { const u = varuint(); return (u >>> 1) ^ -(u & 1); };
  const varfloat = () => {
    if (b[p] === 0) { p++; return 0; }
    const rotl1 = ((b[p] << 24) | (b[p + 3] << 16) | (b[p + 2] << 8) | b[p + 1]) >>> 0;
    p += 4;
    const bits = ((rotl1 >>> 1) | (rotl1 << 31)) >>> 0;
    const dv = new DataView(new ArrayBuffer(4)); dv.setUint32(0, bits); return dv.getFloat32(0);
  };
  const cstr = () => { const st = p; while (b[p] !== 0) p++; const s = b.subarray(st, p).toString("utf8"); p++; return s; };
  return { u8, varuint, varint, varfloat, cstr, get p() { return p; }, get len() { return b.length; } };
}

// decode one value of a (type, isArray) against the schema
function decodeValue(r, defs, type, isArray) {
  if (isArray) { const n = r.varuint(); const out = []; for (let i = 0; i < n; i++) out.push(decodeValue(r, defs, type, false)); return out; }
  if (type < 0) {
    switch (type) {
      case -1: return !!r.u8();          // bool
      case -2: return r.u8();            // byte
      case -3: return r.varint();        // int
      case -4: return r.varuint();       // uint
      case -5: return r.varfloat();      // float
      case -6: return r.cstr();          // string
      default: throw new Error("bad primitive " + type);
    }
  }
  const d = refDef(defs, type);
  if (d.kind === 0) { const v = r.varuint(); const f = d.fields.find(x => x.value === v); return f ? f.name : v; } // enum
  if (d.kind === 1) { const o = {}; for (const f of d.fields) o[f.name] = decodeValue(r, defs, f.type, f.isArray); return o; } // struct
  return decodeMessage(r, defs, d); // message
}

function decodeMessage(r, defs, def) {
  const o = {};
  for (;;) {
    const id = r.varuint();
    if (id === 0) break;
    const f = def.fields.find(x => x.value === id);
    if (!f) throw new Error(`unknown field id ${id} in ${def.name} @${r.p}`);
    o[f.name] = decodeValue(r, defs, f.type, f.isArray);
  }
  return o;
}

// Decode a decompressed coop document (PixsoMsg) -> raw node list.
export function decodeDocument(docBuf) {
  const { defs, byName } = schema();
  const r = reader(Buffer.from(docBuf));
  const msg = decodeMessage(r, defs, defs[byName.get("PixsoMsg")]);
  return msg.pixsoNodes || [];
}

const hex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
const r3 = (n) => Math.round(n * 1000) / 1000;
// #rrggbb, or #rrggbbaa when alpha < 255
const colorHex = (c) => c ? "#" + hex(c.r) + hex(c.g) + hex(c.b) + (c.a < 255 ? hex(c.a) : "") : null;

// A paint -> hex string (solid) or object (gradient/image). Skips hidden paints.
function paintView(p) {
  if (p.visible === false) return null;
  const t = p.type || "SOLID";
  if (t === "SOLID") {
    const h = colorHex(p.color);
    return p.opacity != null && p.opacity < 1 ? { color: h, opacity: r3(p.opacity) } : h;
  }
  if (t.startsWith("GRADIENT")) {
    return { type: t, stops: (p.stops || []).map(s => ({ color: colorHex(s.color), at: Math.round((s.position || 0) * 1000) / 1000 })), ...(p.opacity != null && p.opacity < 1 && { opacity: r3(p.opacity) }) };
  }
  return { type: t }; // IMAGE / VIDEO / PATTERN / ...
}
const paintsView = (paints) => (paints || []).map(paintView).filter(v => v != null);

// effects -> shadows & blurs
function effectsView(effects) {
  return (effects || []).filter(e => e.visible !== false).map(e => {
    const o = { type: e.type };
    if (e.type && e.type.includes("SHADOW")) {
      if (e.color) o.color = colorHex(e.color);
      if (e.offset) o.x = e.offset.x, o.y = e.offset.y;
      if (e.radius) o.blur = e.radius;
      if (e.spread) o.spread = e.spread;
    } else if (e.type && e.type.includes("BLUR")) {
      if (e.radius) o.blur = e.radius;
    }
    if (e.opacity != null && e.opacity !== 1) o.opacity = r3(e.opacity);
    return o;
  });
}

// guid -> "sessionID:localID"
const gk = (g) => g ? `${g.sessionID || 0}:${g.localID || 0}` : null;

// A compact, agent-friendly view of each node.
export function summarize(nodes) {
  return nodes.map((n) => {
    const t = n.transform, s = n.size;
    const o = { name: n.name, type: n.type };
    const id = gk(n.guid); if (id) o.id = id;
    if (t) o.x = Math.round(t.m02 * 100) / 100, o.y = Math.round(t.m12 * 100) / 100;
    if (s) o.w = Math.round(s.x * 100) / 100, o.h = Math.round(s.y * 100) / 100;
    const fills = paintsView(n.fillPaints); if (fills.length) o.fills = fills;
    const strokes = paintsView(n.strokePaints); if (strokes.length) o.strokes = strokes;
    if (n.strokeWeight) o.strokeWeight = n.strokeWeight;
    if (n.cornerRadius) o.cornerRadius = n.cornerRadius;
    const effects = effectsView(n.effects); if (effects.length) o.effects = effects;
    if (n.backgroundColor) o.background = colorHex(n.backgroundColor);
    if (n.opacity != null && n.opacity !== 1) o.opacity = r3(n.opacity);
    if (n.textData?.characters) o.text = n.textData.characters;
    if (n.fontSize) o.fontSize = n.fontSize;
    if (n.fontName) o.fontName = n.fontName.family || n.fontName;
    if (n.stackMode && n.stackMode !== "NONE") {
      o.autoLayout = { mode: n.stackMode, gap: n.stackSpacing, padding: [n.stackPaddingTop, n.stackPaddingRight, n.stackPaddingBottom, n.stackPaddingLeft] };
    }
    if (n.parentIndex) o.parent = n.parentIndex; // GUID + position for tree
    if (n.visible === false) o.visible = false;
    return o;
  });
}

// Nest nodes into a tree using parentIndex (guid of parent + fractional position).
export function buildTree(rawNodes) {
  const sum = summarize(rawNodes);
  const byId = new Map();
  rawNodes.forEach((n, i) => { const id = gk(n.guid); sum[i].children = []; if (id) byId.set(id, { s: sum[i], pos: n.parentIndex?.position ?? "" }); delete sum[i].parent; });
  const roots = [];
  rawNodes.forEach((n, i) => {
    const pid = gk(n.parentIndex?.guid);
    const parent = pid && pid !== gk(n.guid) ? byId.get(pid) : null;
    (parent ? parent.s.children : roots).push(byId.get(gk(n.guid)) || { s: sum[i], pos: "" });
  });
  const finish = (entry) => { const s = entry.s; s.children.sort((a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : 0)); s.children = s.children.map(finish); if (!s.children.length) delete s.children; return s; };
  return roots.sort((a, b) => (a.pos < b.pos ? -1 : a.pos > b.pos ? 1 : 0)).map(finish);
}

// Return the subtree(s) whose node matches `sel` (by id "s:l" or by name,
// case-insensitive). Lets an agent pull just one frame instead of the whole doc.
export function selectTree(rawNodes, sel) {
  const want = String(sel).toLowerCase();
  const out = [];
  const walk = (ns) => { for (const n of ns) { if (n.id === sel || (n.name || "").toLowerCase() === want) out.push(n); else if (n.children) walk(n.children); } };
  walk(buildTree(rawNodes));
  return out;
}

// Flat discovery list: {id, type, name} for nodes whose name contains `query`.
export function findNodes(rawNodes, query) {
  const q = String(query).toLowerCase();
  return summarize(rawNodes)
    .filter((n) => (n.name || "").toLowerCase().includes(q))
    .map((n) => ({ id: n.id, type: n.type, name: n.name }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const nodes = decodeDocument(readFileSync(process.argv[2] || "doc.bin"));
  const mode = process.argv[3] || "tree";
  let out;
  if (mode === "flat") out = summarize(nodes);
  else if (mode === "find") out = findNodes(nodes, process.argv[4] || "");
  else if (mode === "node") out = selectTree(nodes, process.argv[4] || "");
  else out = buildTree(nodes);
  console.log(JSON.stringify(out, null, 1));
}
