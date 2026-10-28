// Schema-driven kiwi decoder for Pixso documents. Exact and complete:
// uses the real kiwi schema (pixso.binary) extracted from the app, so every
// PixsoNode field decodes by its true type. No heuristics.
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { parseSchema } from "./kiwi-schema.mjs";
import { unpackParts } from "./pixso-fetch.mjs";

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

// ---------- encoder (mirror of the decoder) ----------
// Used to send coop messages (JOIN_START) the way the web client does.
function writer() {
  const out = [];
  const u8 = (v) => out.push(v & 0xff);
  const varuint = (v) => { v >>>= 0; do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; out.push(b); } while (v); };
  const varint = (v) => varuint((v << 1) ^ (v >> 31));
  const varfloat = (f) => {
    const dv = new DataView(new ArrayBuffer(4)); dv.setFloat32(0, f); const bits = dv.getUint32(0);
    const rotl1 = ((bits << 1) | (bits >>> 31)) >>> 0;
    if ((rotl1 >>> 24) === 0) { out.push(0); return; }       // exponent 0 -> zero
    out.push(rotl1 >>> 24, rotl1 & 0xff, (rotl1 >>> 8) & 0xff, (rotl1 >>> 16) & 0xff);
  };
  const cstr = (s) => { out.push(...Buffer.from(String(s), "utf8"), 0); };
  return { u8, varuint, varint, varfloat, cstr, bytes: () => Buffer.from(out) };
}
function encodeValue(w, defs, type, isArray, v) {
  if (isArray) { w.varuint(v.length); for (const x of v) encodeValue(w, defs, type, false, x); return; }
  if (type < 0) {
    switch (type) {
      case -1: return w.u8(v ? 1 : 0);
      case -2: return w.u8(v);
      case -3: return w.varint(v | 0);
      case -4: return w.varuint(v);
      case -5: return w.varfloat(v);
      case -6: return w.cstr(v);
    }
  }
  const d = refDef(defs, type);
  if (d.kind === 0) { const f = d.fields.find((x) => x.name === v || x.value === v); return w.varuint(f ? f.value : v); }
  if (d.kind === 1) { for (const f of d.fields) encodeValue(w, defs, f.type, f.isArray, v[f.name]); return; }
  for (const f of d.fields) if (v[f.name] !== undefined) { w.varuint(f.value); encodeValue(w, defs, f.type, f.isArray, v[f.name]); }
  w.varuint(0);
}
// PixsoMsg object -> kiwi bytes
export function encodeMsg(msg) {
  const { defs, byName } = schema(), w = writer();
  encodeValue(w, defs, byName.get("PixsoMsg") - 1, false, msg);
  return w.bytes();
}

// One decompressed coop payload -> full PixsoMsg {type, pixsoNodes, blobs, …}.
export function decodeMsg(buf) {
  const { defs, byName } = schema();
  const msg = decodeMessage(reader(Buffer.from(buf)), defs, defs[byName.get("PixsoMsg")]);
  if (msg.blobs?.length) { const cache = new Map(); for (const n of msg.pixsoNodes || []) resolveBlobs(n, msg.blobs, cache); }
  return msg;
}

// ---------- geometry blobs ----------
// Vector outlines (fillGeometry / strokeGeometry / strokePaddingPath) and text glyphs
// point into the message's `blobs` by index. A path blob is a command stream:
// u8 cmd (0 close, 1 move, 2 line, 3 quad, 4 cubic) + float32 LE x,y pairs.
const fmt = (v, k) => String(Math.round(v * k) / k);
export function blobPath(bytes, digits = 2) {
  const b = Buffer.from(bytes), k = 10 ** digits, ARGS = [0, 1, 1, 2, 3], OP = "ZMLQC";
  let p = 0, d = "", x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  while (p < b.length) {
    const c = b[p++];
    if (c > 4 || p + ARGS[c] * 8 > b.length) return null; // not a path blob
    d += OP[c];
    for (let i = 0; i < ARGS[c]; i++) {
      const x = b.readFloatLE(p), y = b.readFloatLE(p + 4); p += 8;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      d += (i ? " " : "") + fmt(x, k) + " " + fmt(y, k);
    }
  }
  return d ? { d, box: [x0, y0, x1, y1] } : null;
}

// Vector network (editable form of a VECTOR, kept when no outline geometry is stored):
// u32 vertexCount, segmentCount, regionCount;
// vertex {u32 style, f32 x, f32 y}; segment {u32 style, u32 start, f32 tx, f32 ty, u32 end, f32 tx, f32 ty}
// (tangents relative to their vertex); region {u32 style<<1 | nonzero, u32 loopCount,
// loops: u32 n + n segment indices}. Coordinates are in vectorData.normalizedSize space.
export function vectorNetwork(bytes) {
  const b = Buffer.from(bytes);
  if (b.length < 12) return null;
  const nv = b.readUInt32LE(0), ns = b.readUInt32LE(4), nr = b.readUInt32LE(8);
  let p = 12;
  if (p + nv * 12 + ns * 28 > b.length) return null;
  const verts = [], segs = [], regions = [];
  for (let i = 0; i < nv; i++, p += 12) verts.push([b.readFloatLE(p + 4), b.readFloatLE(p + 8)]);
  for (let i = 0; i < ns; i++, p += 28) {
    const sg = { a: b.readUInt32LE(p + 4), ta: [b.readFloatLE(p + 8), b.readFloatLE(p + 12)], b: b.readUInt32LE(p + 16), tb: [b.readFloatLE(p + 20), b.readFloatLE(p + 24)] };
    if (sg.a >= nv || sg.b >= nv) return null;
    segs.push(sg);
  }
  try {
    for (let i = 0; i < nr; i++) {
      const head = b.readUInt32LE(p), nl = b.readUInt32LE(p + 4); p += 8;
      const loops = [];
      for (let j = 0; j < nl; j++) {
        const n = b.readUInt32LE(p); p += 4;
        const idx = []; for (let k = 0; k < n; k++, p += 4) idx.push(b.readUInt32LE(p));
        if (idx.some((x) => x >= ns)) throw 0;
        loops.push(idx);
      }
      regions.push({ rule: head & 1 ? "nonzero" : "evenodd", loops });
    }
  } catch { regions.length = 0; } // unknown region layout: keep the strokes
  return { verts, segs, regions };
}

// network -> SVG path strings: closed region loops (fill) and chained segments (stroke)
function networkPaths(net, sx, sy) {
  const P = (v) => fmt(v[0] * sx, 100) + " " + fmt(v[1] * sy, 100);
  const seg = (sg, fwd) => {
    const [from, to, tf, tt] = fwd ? [sg.a, sg.b, sg.ta, sg.tb] : [sg.b, sg.a, sg.tb, sg.ta];
    const A = net.verts[from], B = net.verts[to];
    if (!tf[0] && !tf[1] && !tt[0] && !tt[1]) return "L" + P(B);
    return "C" + P([A[0] + tf[0], A[1] + tf[1]]) + " " + P([B[0] + tt[0], B[1] + tt[1]]) + " " + P(B);
  };
  const fills = net.regions.map((r) => ({ rule: r.rule, d: r.loops.map((loop) => {
    const s0 = net.segs[loop[0]], s1 = net.segs[loop[1] ?? loop[0]];
    let cur = loop.length > 1 && (s0.a === s1.a || s0.a === s1.b) ? s0.b : s0.a, d = "M" + P(net.verts[cur]);
    for (const i of loop) { const sg = net.segs[i], fwd = sg.a === cur; d += seg(sg, fwd); cur = fwd ? sg.b : sg.a; }
    return d + "Z";
  }).join("") }));
  let stroke = "", cur = -1, start = -1;
  for (const sg of net.segs) {
    const fwd = sg.a === cur || sg.b !== cur;
    if (sg.a !== cur && sg.b !== cur) { if (cur === start && stroke) stroke += "Z"; start = sg.a; stroke += "M" + P(net.verts[sg.a]); }
    stroke += seg(sg, fwd); cur = fwd ? sg.b : sg.a;
  }
  if (cur === start && stroke && net.segs.length > 1) stroke += "Z";
  return { fills, stroke };
}
const pathBox = (d) => { const n = d.match(/-?\d+(\.\d+)?(e-?\d+)?/g)?.map(Number) || [0, 0]; const xs = n.filter((_, i) => i % 2 === 0), ys = n.filter((_, i) => i % 2); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]; };

const GEOMETRY = ["fillGeometry", "strokeGeometry", "strokePaddingPath"];
function resolveBlobs(n, blobs, cache) {
  const get = (i, digits) => {
    const key = i + "/" + digits;
    if (!cache.has(key)) cache.set(key, blobs[i]?.bytes ? blobPath(blobs[i].bytes, digits) : null);
    return cache.get(key);
  };
  for (const f of GEOMETRY) if (n[f]) n[f] = n[f].map((g) => ({ ...g, path: get(g.blobIndex, 2) }));
  const vb = n.vectorData?.vectorNetworkBlob;
  if (vb != null && blobs[vb]?.bytes) {
    const key = "net/" + vb;
    if (!cache.has(key)) cache.set(key, vectorNetwork(blobs[vb].bytes));
    n.vectorData = { ...n.vectorData, network: cache.get(key) };
  }
  if (n.textData?.glyphs) n.textData.glyphs = n.textData.glyphs.map((g) => ({ ...g, path: get(g.blobIndex, 3) })); // em units
  for (const x of n.derivedSymbolData || []) resolveBlobs(x, blobs, cache);
  for (const x of n.symbolData?.symbolOverrides || []) resolveBlobs(x, blobs, cache);
}

// Decoded document -> raw node list. A packed multi-payload document (see
// pixso-fetch packParts) is merged by guid in arrival order: later messages update
// fields of earlier nodes, phase=REMOVED deletes; payloads that are not node
// messages are skipped.
export function decodeDocument(docBuf) {
  const parts = unpackParts(docBuf);
  if (parts.length === 1) return decodeMsg(parts[0]).pixsoNodes || [];
  const byId = new Map(), anon = [];
  for (const p of parts) {
    let msg; try { msg = decodeMsg(p); } catch { continue; }
    for (const n of msg.pixsoNodes || []) {
      const id = gk(n.guid);
      if (!id) { anon.push(n); continue; }
      if (n.phase === "REMOVED") { byId.delete(id); continue; }
      const cur = byId.get(id); if (cur) Object.assign(cur, n); else byId.set(id, n);
    }
  }
  return [...byId.values(), ...anon];
}

const hex = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
const r2 = (n) => Math.round(n * 100) / 100;
const r3 = (n) => Math.round(n * 1000) / 1000;
// #rrggbb, or #rrggbbaa when alpha < 255
const colorHex = (c) => c ? "#" + hex(c.r) + hex(c.g) + hex(c.b) + (c.a < 255 ? hex(c.a) : "") : null;
const lower = (s) => s && String(s).toLowerCase();

// 2x3 affine helpers (Pixso Matrix: x' = m00 x + m01 y + m02, y' = m10 x + m11 y + m12)
function invert(t) {
  const det = t.m00 * t.m11 - t.m01 * t.m10; if (!det) return null;
  return { m00: t.m11 / det, m01: -t.m01 / det, m10: -t.m10 / det, m11: t.m00 / det,
    m02: (t.m01 * t.m12 - t.m11 * t.m02) / det, m12: (t.m10 * t.m02 - t.m00 * t.m12) / det };
}
const apply = (t, x, y) => [t.m00 * x + t.m01 * y + t.m02, t.m10 * x + t.m11 * y + t.m12];

// A paint -> hex string (solid) or object (gradient/image). Skips hidden paints.
// Gradients: from/to = handle positions in the node's unit box (0..1); angle = CSS degrees.
function paintView(p, size, m) {
  if (p.visible === false) return null;
  const t = p.type || "SOLID";
  const op = p.opacity != null && p.opacity < 1 ? r3(p.opacity) : null;
  const v = m && varName(m, p.colorVar?.value?.alias);
  if (t === "SOLID") { const h = colorHex(p.color); return op != null || v ? { color: h, ...(op != null && { opacity: op }), ...(v && { var: v }) } : h; }
  if (t.startsWith("GRADIENT")) {
    const o = { type: t, stops: (p.stops || []).map((s) => ({ color: colorHex(s.color), at: r3(s.position || 0) })) };
    const inv = p.transform && invert(p.transform);
    if (inv) {
      const [fx, fy] = apply(inv, 0, 0.5), [tx, ty] = apply(inv, 1, 0.5);
      o.from = [r3(fx), r3(fy)]; o.to = [r3(tx), r3(ty)];
      if (t === "GRADIENT_LINEAR") { const w = size?.x || 1, h = size?.y || 1; o.angle = r2((Math.atan2((tx - fx) * w, -(ty - fy) * h) * 180 / Math.PI + 360) % 360); }
    }
    if (op != null) o.opacity = op;
    return o;
  }
  if (t === "IMAGE") {
    const o = { type: "IMAGE", scaleMode: lower(p.imageScaleMode) || "fill" };
    if (p.image?.hash?.length) o.hash = Buffer.from(p.image.hash).toString("hex");
    if (p.originalImageWidth) o.imageSize = [p.originalImageWidth, p.originalImageHeight];
    if (op != null) o.opacity = op;
    return o;
  }
  return { type: t }; // EMOJI / VIDEO / PATTERN / ...
}
const paintsView = (paints, size, m) => (paints || []).map((p) => paintView(p, size, m)).filter((v) => v != null);

// ---------- named styles & variables ----------
// Styles are nodes with styleType (FILL/TEXT/EFFECT/…) referenced by inherit*StyleID;
// variables are VARIABLE nodes referenced by AssetID {guid | assetRef.key}.
function varNode(m, asset) { return asset && (m.vars.get(gk(asset.guid)) || (asset.assetRef?.key && m.vars.get("key:" + asset.assetRef.key))); }
function varName(m, asset) { return varNode(m, asset)?.name || null; }
const styleName = (m, g) => (g && m?.styles.get(gk(g))?.name) || null;
const VAR_FIELD = { CORNER_RADIUS: "cornerRadius", STROKE_WEIGHT: "strokeWeight", STACK_SPACING: "gap", STACK_COUNTER_SPACING: "rowGap",
  STACK_PADDING_LEFT: "paddingLeft", STACK_PADDING_TOP: "paddingTop", STACK_PADDING_RIGHT: "paddingRight", STACK_PADDING_BOTTOM: "paddingBottom",
  WIDTH: "w", HEIGHT: "h", MIN_WIDTH: "minWidth", MAX_WIDTH: "maxWidth", MIN_HEIGHT: "minHeight", MAX_HEIGHT: "maxHeight", OPACITY: "opacity", VISIBLE: "visible",
  FONT_FAMILY: "fontFamily", FONT_STYLE: "fontWeight", FONT_SIZE: "fontSize", LETTER_SPACING: "letterSpacing", LINE_HEIGHT: "lineHeight",
  PARAGRAPH_SPACING: "paragraphSpacing", PARAGRAPH_INDENT: "paragraphIndent", TEXT_DATA: "text",
  RECTANGLE_TOP_LEFT_CORNER_RADIUS: "radiusTopLeft", RECTANGLE_TOP_RIGHT_CORNER_RADIUS: "radiusTopRight",
  RECTANGLE_BOTTOM_LEFT_CORNER_RADIUS: "radiusBottomLeft", RECTANGLE_BOTTOM_RIGHT_CORNER_RADIUS: "radiusBottomRight",
  BORDER_TOP_WEIGHT: "borderTop", BORDER_BOTTOM_WEIGHT: "borderBottom", BORDER_LEFT_WEIGHT: "borderLeft", BORDER_RIGHT_WEIGHT: "borderRight" };
function boundVars(m, map) { // variableConsumptionMap -> {field: variable name}
  const out = {};
  for (const e of map?.entries || []) {
    const name = varName(m, e.variableData?.value?.alias), f = VAR_FIELD[e.variableField];
    if (name && f) out[f] = name;
  }
  return Object.keys(out).length ? out : null;
}
// A variable's value per mode: {modeName: value}, aliases shown as "→ other/name".
export function variableValues(m, v) {
  const set = m.sets.get(gk(v.variableSetID?.guid)), modes = new Map((set?.variableSetModes || []).map((md) => [gk(md.id), md.name]));
  const out = {};
  for (const e of v.variableDataValues?.entries || []) {
    const val = e.variableData?.value || {};
    const shown = val.colorValue ? colorHex(val.colorValue) : val.floatValue ?? val.textValue ?? val.boolValue ?? (val.alias ? "→ " + (varName(m, val.alias) || "?") : undefined);
    if (shown !== undefined) out[modes.get(gk(e.modeID)) || gk(e.modeID)] = shown;
  }
  return { name: v.name, ...(set?.name && { collection: set.name }), ...(v.variableResolvedType && { type: lower(v.variableResolvedType) }), values: out };
}
const solidOf = (v) => !v ? null : typeof v === "string" ? v : v.color || v.stops?.[0]?.color || null; // best single color

// effects -> shadows & blurs
function effectsView(effects) {
  return (effects || []).filter((e) => e.visible !== false).map((e) => {
    const o = { type: e.type };
    if (e.type && e.type.includes("SHADOW")) {
      if (e.color) o.color = colorHex(e.color);
      if (e.offset) o.x = e.offset.x, o.y = e.offset.y;
      if (e.radius) o.blur = e.radius;
      if (e.spread) o.spread = e.spread;
    } else if (e.radius) o.blur = e.radius;
    if (e.opacity != null && e.opacity !== 1) o.opacity = r3(e.opacity);
    return o;
  });
}

// ---------- text ----------
const WEIGHTS = [[/thin|hairline/i, 100], [/(extra|ultra)\s*-?light/i, 200], [/light/i, 300], [/medium/i, 500],
  [/(semi|demi)\s*-?bold/i, 600], [/(extra|ultra)\s*-?bold/i, 800], [/black|heavy/i, 900], [/bold/i, 700]];
function fontView(fn, meta) {
  if (!fn) return {};
  const o = { fontFamily: fn.family };
  const m = meta?.find((x) => x.key?.family === fn.family && x.key?.style === fn.style);
  const w = m?.fontWeight || WEIGHTS.find(([re]) => re.test(fn.style || ""))?.[1] || 400;
  if (w !== 400) o.fontWeight = w;
  if (m?.fontStyle === "ITALIC" || /italic|oblique/i.test(fn.style || "")) o.italic = true;
  return o;
}
// Number{value, units} -> px number | "N%" ; RAW line height = font's natural ("normal")
const pxOrPct = (v) => !v || v.value == null ? null : v.units === "PERCENT" ? `${r2(v.value)}%` : r2(v.value);
const lineHeightOf = (v, baselines) => !v ? null : v.units === "RAW" ? (baselines?.[0]?.lineHeight ? r2(baselines[0].lineHeight) : "normal") : pxOrPct(v);
const letterSpacingOf = (v) => !v || !v.value ? null : v.units === "PERCENT" ? `${r3(v.value / 100)}em` : r2(v.value);

function styleView(st, meta, size, m) { // one entry of textData.styleOverrideTable
  const o = {};
  const ts = styleName(m, st.inheritTextStyleID); if (ts) o.textStyle = ts;
  const fsn = styleName(m, st.inheritFillStyleID); if (fsn) o.fillStyle = fsn;
  if (st.fontName) Object.assign(o, fontView(st.fontName, meta));
  if (st.fontSize) o.fontSize = r2(st.fontSize);
  const f = paintsView(st.fillPaints, size, m); if (f.length) o.fills = f;
  if (st.textDecoration && st.textDecoration !== "NONE") o.textDecoration = lower(st.textDecoration);
  const ls = letterSpacingOf(st.letterSpacing); if (ls != null) o.letterSpacing = ls;
  const lh = st.lineHeight && pxOrPct(st.lineHeight); if (lh != null && st.lineHeight.units !== "RAW") o.lineHeight = lh;
  if (st.textCase && st.textCase !== "ORIGINAL") o.textCase = lower(st.textCase);
  if (st.hyperlink?.url) o.link = st.hyperlink.url;
  return o;
}

function textView(n, o, m) {
  const td = n.textData, chars = td?.characters;
  if (chars == null) return;
  o.text = chars;
  Object.assign(o, fontView(n.fontName, td.fontMetaData));
  const fs = n.fontSize ?? td.glyphs?.[0]?.fontSize; if (fs) o.fontSize = r2(fs);
  const lh = lineHeightOf(n.lineHeight, td.baselines); if (lh != null) o.lineHeight = lh;
  const ls = letterSpacingOf(n.letterSpacing); if (ls != null) o.letterSpacing = ls;
  if (n.textAlignHorizontal && n.textAlignHorizontal !== "LEFT") o.textAlign = lower(n.textAlignHorizontal);
  if (n.textAlignVertical && n.textAlignVertical !== "TOP") o.verticalAlign = lower(n.textAlignVertical);
  if (n.textAutoResize) o.textResize = { WIDTH_AND_HEIGHT: "hug", HEIGHT: "fixed-width", NONE: "fixed" }[n.textAutoResize];
  if (n.textCase && n.textCase !== "ORIGINAL") o.textCase = lower(n.textCase);
  if (n.textDecoration && n.textDecoration !== "NONE") o.textDecoration = lower(n.textDecoration);
  if (n.paragraphSpacing) o.paragraphSpacing = r2(n.paragraphSpacing);
  if (n.textTruncation === "ENDING") o.truncate = n.maxLines || true;
  if (td.baselines?.length > 1) o.lines = td.baselines.length;
  if (n.hyperlink?.url) o.link = n.hyperlink.url;
  // mixed styling -> runs [{text, ...style}]
  const ids = td.characterStyleIDs;
  if (ids?.some((i) => i)) {
    const table = new Map((td.styleOverrideTable || []).map((st) => [st.styleID, st]));
    const runs = [], idAt = (i) => ids[i] ?? 0; let start = 0;
    for (let i = 1; i <= chars.length; i++) {
      if (i < chars.length && idAt(i) === idAt(start)) continue;
      const st = table.get(idAt(start));
      runs.push({ text: chars.slice(start, i), ...(st ? styleView(st, td.fontMetaData, n.size, m) : {}) });
      start = i;
    }
    if (runs.length > 1) o.runs = runs;
  }
}

// ---------- layout ----------
const ALIGN = { MIN: "start", CENTER: "center", MAX: "end", SPACE_EVENLY: "space-between", STRETCH: "stretch" };
function layoutView(n, o) {
  if (n.stackMode && n.stackMode !== "NONE") {
    const al = { mode: lower(n.stackMode) };
    if (n.stackSpacing) al.gap = r2(n.stackSpacing);
    const pt = n.stackPaddingTop ?? n.stackVerticalPadding ?? n.stackPadding ?? 0, pb = n.stackPaddingBottom ?? n.stackVerticalPadding ?? n.stackPadding ?? 0;
    const pl = n.stackPaddingLeft ?? n.stackHorizontalPadding ?? n.stackPadding ?? 0, pr = n.stackPaddingRight ?? n.stackHorizontalPadding ?? n.stackPadding ?? 0;
    if (pt || pr || pb || pl) al.padding = [pt, pr, pb, pl];
    const j = ALIGN[n.stackPrimaryAlignItems || n.stackJustify]; if (j && j !== "start") al.justify = j;
    const c = ALIGN[n.stackCounterAlignItems || n.stackCounterAlign]; if (c && c !== "start") al.align = c;
    if (n.stackWrap === "WRAP") { al.wrap = true; if (n.stackCounterSpacing) al.rowGap = r2(n.stackCounterSpacing); }
    const hug = (v) => (v === "RESIZE_TO_FIT" ? "hug" : "fixed");
    const horiz = n.stackMode === "HORIZONTAL";
    al.width = hug(horiz ? n.stackPrimarySizing : n.stackCounterSizing);
    al.height = hug(horiz ? n.stackCounterSizing : n.stackPrimarySizing);
    if (n.autoLayoutItemReverseDraw) al.reverseZ = true;
    o.autoLayout = al;
  }
  // as a child of an auto-layout parent (CSS flex terms)
  if (n.stackChildPrimarySizing === "RESIZE_TO_FIT") o.layoutGrow = 1;
  if (n.stackChildCounterSizing === "RESIZE_TO_FIT") o.alignSelf = "stretch";
  if (n.autoLayoutAbsolutePos) o.position = "absolute";
  const h = n.horizontalConstraint, v = n.verticalConstraint;
  if ((h && h !== "MIN") || (v && v !== "MIN")) o.constraints = { h: lower(h || "MIN"), v: lower(v || "MIN") };
  if (n.minSize) o.min = [r2(n.minSize.x), r2(n.minSize.y)];
  if (n.maxSize) o.max = [r2(n.maxSize.x), r2(n.maxSize.y)];
}

// ---------- vectors ----------
const VECTORISH = new Set(["VECTOR", "BOOLEAN_OPERATION", "STAR", "LINE", "REGULAR_POLYGON"]);
const RULE = { ODD: "evenodd", INVERSE_ODD: "evenodd" };
// Filled outlines of a node: fill geometry painted with its fill, stroke outline with its stroke.
function pathsOf(n, fills, strokes) {
  const out = [];
  const fill = fills[0], stroke = strokes[0];
  if (fill) for (const g of n.fillGeometry || []) if (g.path) out.push({ d: g.path.d, box: g.path.box, paint: fill, rule: RULE[g.windingRule] });
  const sg = n.strokeGeometry?.length ? n.strokeGeometry : n.strokePaddingPath;
  if (stroke) for (const g of sg || []) if (g.path) out.push({ d: g.path.d, box: g.path.box, paint: stroke, rule: RULE[g.windingRule] });
  // no stored outline: build it from the vector network (fills by region, strokes as SVG strokes)
  const net = n.vectorData?.network;
  if (!out.length && net?.segs.length) {
    const ns = n.vectorData.normalizedSize, sx = ns?.x ? (n.size?.x ?? ns.x) / ns.x : 1, sy = ns?.y ? (n.size?.y ?? ns.y) / ns.y : 1;
    const { fills: regions, stroke: sd } = networkPaths(net, sx, sy);
    if (fill) for (const r of regions) out.push({ d: r.d, box: pathBox(r.d), paint: fill, rule: r.rule === "evenodd" ? "evenodd" : undefined });
    if (fill && !regions.length && sd.includes("Z")) out.push({ d: sd, box: pathBox(sd), paint: fill }); // closed outline, no regions
    if (stroke && sd) {
      const w = n.strokeWeight || 1, b = pathBox(sd);
      out.push({ d: sd, box: [b[0] - w / 2, b[1] - w / 2, b[2] + w / 2, b[3] + w / 2], paint: stroke, stroke: { width: w, cap: lower(n.strokeCap), join: lower(n.strokeJoin) } });
    }
  }
  return out;
}
const CAP = { round: "round", square: "square" }, JOIN = { round: "round", bevel: "bevel" };
// one path entry -> SVG paint attributes (filled outline, or a real stroke for network paths)
export function pathAttrs(p, color, opacity) {
  const op = opacity != null ? ` ${p.stroke ? "stroke" : "fill"}-opacity="${opacity}"` : "";
  if (!p.stroke) return ` fill="${color}"${op}${p.rule ? ` fill-rule="${p.rule}"` : ""}`;
  return ` fill="none" stroke="${color}" stroke-width="${p.stroke.width}"${CAP[p.stroke.cap] ? ` stroke-linecap="${CAP[p.stroke.cap]}"` : ""}${JOIN[p.stroke.join] ? ` stroke-linejoin="${JOIN[p.stroke.join]}"` : ""}${op}`;
}
// Standalone <svg> for one vector node (local coordinates), ready to inline.
function vectorSVG(paths, w, h) {
  let x0 = 0, y0 = 0, x1 = w || 0, y1 = h || 0;
  for (const p of paths) { x0 = Math.min(x0, p.box[0]); y0 = Math.min(y0, p.box[1]); x1 = Math.max(x1, p.box[2]); y1 = Math.max(y1, p.box[3]); }
  const vb = [x0, y0, x1 - x0, y1 - y0].map(r2);
  const body = paths.map((p) => `<path d="${p.d}"${pathAttrs(p, solidOf(p.paint) || "currentColor", typeof p.paint === "object" ? p.paint.opacity : undefined)}/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(" ")}" width="${vb[2]}" height="${vb[3]}">${body}</svg>`;
}

// ---------- prototype ----------
const EVENT = { ON_CLICK: "click", ON_DOUBLECLICK: "dblclick", ON_HOVER: "hover", MOUSE_IN: "mouseenter", MOUSE_OUT: "mouseleave",
  MOUSE_DOWN: "mousedown", MOUSE_UP: "mouseup", ON_PRESS: "press", AFTER_TIMEOUT: "timeout", DRAG: "drag", ON_KEY_DOWN: "keydown" };
// prototypeInteractions -> [{on, action, to?:{id,name}, url?, transition?, delayMs?}]
function interactionsOf(n, m) {
  const out = [];
  const one = (on, a, ev) => {
    const ct = a.connectionType;
    const action = ct === "URL" ? "url" : ct === "BACK" ? "back" : ct === "CLOSE" ? "close" : ct === "SCROLLTO" ? "scroll_to"
      : ct === "SETSHOWHIDE" ? (lower(a.showHide) || "toggle") : ct === "SET_VARIABLE" ? "set_variable" : ct === "CONDITIONAL" ? "conditional"
      : lower(a.navigationType) || (a.transitionNodeID ? "navigate" : lower(ct) || "none");
    const o = { on, action };
    const tid = gk(a.transitionNodeID);
    if (tid) { const t = m?.byId.get(tid); o.to = { id: tid, ...(t?.name && { name: t.name }) }; }
    if (a.connectionURL) o.url = a.connectionURL;
    if (a.transitionType && a.transitionType !== "INSTANT_TRANSITION") o.transition = lower(a.transitionType);
    if (ev?.transitionTimeout) o.afterMs = Math.round(ev.transitionTimeout * 1000);
    if (ev?.delayMs) o.delayMs = ev.delayMs;
    out.push(o);
  };
  for (const it of n.prototypeInteractions || []) {
    if (it.isDeleted) continue;
    const on = EVENT[it.event?.interactionType] || lower(it.event?.interactionType) || "click";
    for (const a of it.actions || []) {
      if (a.conditionalActions?.length) for (const c of a.conditionalActions) for (const x of c.actions || []) one(on, x, it.event);
      else one(on, a, it.event);
    }
  }
  if (!out.length && n.transitionNodeID) one(EVENT[n.interactionType] || "click", { transitionNodeID: n.transitionNodeID, navigationType: n.navigationType, transitionType: n.transitionType });
  return out;
}

// guid -> "sessionID:localID"
const gk = (g) => g ? `${g.sessionID || 0}:${g.localID || 0}` : null;
const hidden = (o, k, v) => Object.defineProperty(o, k, { value: v, enumerable: false, writable: true, configurable: true });

// Compact, agent-friendly view of one (effective) node. CSS-ish keys.
// Non-enumerable _m / _paths / _glyphs feed the SVG renderer without bloating JSON.
function view(n, m) {
  const t = n.transform, s = n.size;
  const o = { name: n.name, type: n.type };
  const id = gk(n.guid); if (id) o.id = id;
  if (t) {
    o.x = r2(t.m02), o.y = r2(t.m12);
    const rot = Math.atan2(t.m10, t.m00) * 180 / Math.PI;
    if (Math.abs(rot) > 0.01) o.rotation = r2(rot); // CSS degrees, around (x, y) = rotated top-left
    hidden(o, "_m", t);
  }
  if (s) o.w = r2(s.x), o.h = r2(s.y);
  const fills = paintsView(n.fillPaints, s, m); if (fills.length) o.fills = fills;
  const strokes = paintsView(n.strokePaints, s, m);
  if (strokes.length) {
    o.strokes = strokes;
    if (n.strokeWeight) o.strokeWeight = r2(n.strokeWeight);
    if (n.borderStrokeWeightsIndependent) o.borderWeights = [n.borderTopWeight || 0, n.borderRightWeight || 0, n.borderBottomWeight || 0, n.borderLeftWeight || 0];
    if (n.strokeAlign) o.strokeAlign = lower(n.strokeAlign);
    if (n.dashPattern?.length) o.dash = n.dashPattern.map(r2);
    if (VECTORISH.has(n.type)) { if (n.strokeCap && n.strokeCap !== "NONE") o.strokeCap = lower(n.strokeCap); if (n.strokeJoin && n.strokeJoin !== "MITER") o.strokeJoin = lower(n.strokeJoin); }
  }
  if (n.rectangleCornerRadiiIndependent) {
    const c = [n.rectangleTopLeftCornerRadius || 0, n.rectangleTopRightCornerRadius || 0, n.rectangleBottomRightCornerRadius || 0, n.rectangleBottomLeftCornerRadius || 0];
    if (c.some(Boolean)) o.cornerRadius = c.map(r2);
  } else if (n.cornerRadius) o.cornerRadius = r2(n.cornerRadius);
  if (n.cornerSmoothing) o.cornerSmoothing = r2(n.cornerSmoothing);
  const effects = effectsView(n.effects); if (effects.length) o.effects = effects;
  if (n.backgroundColor) o.background = colorHex(n.backgroundColor);
  if (n.opacity != null && n.opacity !== 1) o.opacity = r3(n.opacity);
  if (n.blendMode && n.blendMode !== "NORMAL" && n.blendMode !== "PASS_THROUGH") o.blendMode = lower(n.blendMode);
  if (n.mask) o.mask = lower(n.maskType) || true;
  if ((n.type === "FRAME" || n.type === "SYMBOL" || n.type === "INSTANCE") && !n.frameMaskDisabled) o.clipsContent = true;
  if (n.type === "TEXT") textView(n, o, m);
  if (m) {
    for (const [k, f] of [["fillStyle", "inheritFillStyleID"], ["strokeStyle", "inheritStrokeStyleID"], ["textStyle", "inheritTextStyleID"], ["effectStyle", "inheritEffectStyleID"]]) {
      const name = styleName(m, n[f]); if (name) o[k] = name;
    }
    const bv = boundVars(m, n.variableConsumptionMap); if (bv) o.vars = bv;
  }
  const ia = interactionsOf(n, m); if (ia.length) o.interactions = ia;
  if (n.scrollDirection && n.scrollDirection !== "NONE") o.scroll = lower(n.scrollDirection);
  if (n.scrollBehavior === "FIXED_WHEN_CHILD_OF_SCROLLING_FRAME") o.fixedOnScroll = true;
  layoutView(n, o);
  const paths = pathsOf(n, fills, strokes);
  if (paths.length) {
    hidden(o, "_paths", paths);
    if (VECTORISH.has(n.type) || (n.type === "ELLIPSE" && n.arcData)) o.svg = vectorSVG(paths, s?.x, s?.y);
  }
  if (n.type === "TEXT" && n.textData?.glyphs?.length) {
    const table = new Map((n.textData.styleOverrideTable || []).map((st) => [st.styleID, st]));
    hidden(o, "_glyphs", n.textData.glyphs.filter((g) => g.path).map((g) => ({
      d: g.path.d, x: g.position?.x || 0, y: g.position?.y || 0, size: g.fontSize || o.fontSize || 14,
      paint: solidOf(paintsView(table.get(g.styleID)?.fillPaints, s)[0]) || null,
    })));
  }
  if (n.visible === false) o.visible = false;
  return o;
}

// Flat list of raw (un-expanded) nodes, parent as "s:l".
export function summarize(nodes) {
  return nodes.map((n) => { const o = view(n); const p = gk(n.parentIndex?.guid); if (p && p !== o.id) o.parent = p; return o; });
}

// ---------- document model: id index + ordered children ----------
// variables / collections are definitions (looked up by id), never drawn. Style
// definition nodes live in the internal canvas, which the search/text/token walks skip.
const isDefinition = (n) => n.type === "VARIABLE" || n.type === "VARIABLE_SET";
const MODELS = new WeakMap();
export function model(raw) {
  if (!Array.isArray(raw)) return raw; // already a model
  let m = MODELS.get(raw); if (m) return m;
  const byId = new Map(), kids = new Map(), roots = [];
  for (const n of raw) { const id = gk(n.guid); if (id) byId.set(id, n); }
  for (const n of raw) {
    const id = gk(n.guid), pid = gk(n.parentIndex?.guid);
    if (isDefinition(n)) continue;
    if (pid && pid !== id && byId.has(pid)) { let a = kids.get(pid); if (!a) kids.set(pid, a = []); a.push(n); }
    else roots.push(n);
  }
  const pos = (n) => n.parentIndex?.position ?? "";
  const cmp = (a, b) => (pos(a) < pos(b) ? -1 : pos(a) > pos(b) ? 1 : 0);
  for (const a of kids.values()) a.sort(cmp);
  roots.sort(cmp);
  const styles = new Map(), vars = new Map(), sets = new Map();
  for (const n of raw) {
    const id = gk(n.guid);
    if (n.styleType && n.styleType !== "NONE") styles.set(id, n);
    if (n.type === "VARIABLE") { vars.set(id, n); if (n.key) vars.set("key:" + n.key, n); }
    if (n.type === "VARIABLE_SET") sets.set(id, n);
  }
  m = { raw, byId, kids, roots, styles, vars, sets };
  MODELS.set(raw, m);
  return m;
}

// ---------- component instances ----------
// Pixso stores an INSTANCE without children: they live under its master SYMBOL
// (symbolData.symbolID; library masters are copied into an internalOnly canvas).
// Per-instance changes are symbolOverrides / derivedSymbolData entries addressed by
// guidPath (path of master-node keys through nested instances), plus component
// properties (componentPropDef on the master/set, componentPropAssignment on the
// instance, componentPropRef on the bound master node).
//
// A path segment is a master node's overrideKey (stable key of library copies) or its
// guid. Both spellings of each path are tracked and looked up, so overrides match
// whichever convention the file uses.
const pathKey = (gp) => gp?.guids?.length ? gp.guids.map(gk).join("/") : null;
const seg = (n) => gk(n.overrideKey) || gk(n.guid);
const SKIP = new Set(["guid", "guidPath", "parentIndex", "overrideKey", "phase"]);

function mergeFields(into, src) {
  for (const k in src) {
    if (SKIP.has(k)) continue;
    if (k === "componentPropAssignment" && Array.isArray(into[k])) {
      const byDef = new Map(into[k].map((a) => [gk(a.defID), a]));
      for (const a of src[k]) byDef.set(gk(a.defID), a);
      into[k] = [...byDef.values()];
    } else if (k === "symbolData" && into[k]) {
      // an override's symbolData adds nested overrides; it must not drop symbolID
      into[k] = { ...into[k], ...src[k], symbolID: src[k].symbolID || into[k].symbolID,
        symbolOverrides: [...(into[k].symbolOverrides || []), ...(src[k].symbolOverrides || [])] };
    } else into[k] = src[k];
  }
  return into;
}

const masterIdOf = (n) => gk(n.overriddenSymbolID) || gk(n.symbolData?.symbolID);

// componentPropRef names the bound field either by enum or by a number (enum index or
// PixsoNode field id: visible=10, textData=67, overriddenSymbolID=88).
const PROP_FIELD = { 0: "VISIBLE", 1: "TEXT_DATA", 2: "OVERRIDDEN_SYMBOL_ID", 10: "VISIBLE", 67: "TEXT_DATA", 88: "OVERRIDDEN_SYMBOL_ID" };
const propField = (ref) => ref.componentPropNodeField ?? PROP_FIELD[ref.nodeField];

// One level of instance context: overrides/derived keyed by path relative to `base`.
function level(m, inst, master, base, gbase, parent) {
  const ov = new Map(), der = new Map(), props = new Map();
  for (const o of inst.symbolData?.symbolOverrides || []) { const k = pathKey(o.guidPath); if (k) ov.set(k, mergeFields(ov.get(k) || {}, o)); }
  for (const d of inst.derivedSymbolData || []) { const k = pathKey(d.guidPath); if (k) der.set(k, d); }
  const set = master && m.byId.get(gk(master.parentIndex?.guid));
  for (const src of [set?.isStateGroup ? set : null, master]) // variant props live on the set
    for (const d of src?.componentPropDef || []) if (!d.isDeleted && d.initialValue) props.set(gk(d.id), d.initialValue);
  for (const a of inst.componentPropAssignment || []) if (a.value) props.set(gk(a.defID), a.value);
  const chain = new Set(parent?.chain); if (master) chain.add(gk(master.guid));
  return { ov, der, props, base, gbase, parent, chain };
}

// Entries of `map` for a node at path/gpath in level l (either path spelling).
function at(l, mapName, path, gpath) {
  const map = l[mapName];
  if (!map.size) return null;
  return (path.startsWith(l.base) && map.get(path.slice(l.base.length))) ||
         (gpath.startsWith(l.gbase) && map.get(gpath.slice(l.gbase.length))) || null;
}

// Master node `c` at instance path -> effective raw node (overrides, props, layout).
function effective(c, path, gpath, ctx) {
  const levels = []; let any = !!c.componentPropRef;
  for (let l = ctx; l; l = l.parent) { levels.push(l); if (l.ov.size || l.der.size) any = true; } // inner..outer
  if (!any) return c; // nothing can change this node
  const merged = {};
  for (const l of levels) { const o = at(l, "ov", path, gpath); if (o) mergeFields(merged, o); } // outer applied last = wins
  for (const ref of c.componentPropRef || []) {
    if (ref.isDeleted) continue;
    const v = ctx.props.get(gk(ref.defID)); if (!v) continue;
    const f = propField(ref);
    if (f === "TEXT_DATA" && v.textValue) merged.textData = v.textValue;
    else if (f === "VISIBLE" && v.boolValue != null) merged.visible = v.boolValue;
    else if (f === "OVERRIDDEN_SYMBOL_ID" && v.guidValue) merged.overriddenSymbolID = v.guidValue;
  }
  for (let i = levels.length - 1; i >= 0; i--) { // outermost instance has the final layout
    const d = at(levels[i], "der", path, gpath);
    if (!d) continue;
    for (const f of ["size", "transform", ...GEOMETRY]) if (d[f]) merged[f] = d[f];
    if (d.textData?.glyphs) merged.textData = { ...(merged.textData || c.textData), glyphs: d.textData.glyphs, baselines: d.textData.baselines };
    break;
  }
  // text replaced but no new glyph layout: drop the master's glyphs (they spell the old text)
  if (merged.textData && merged.textData !== c.textData && merged.textData.characters !== c.textData?.characters && !merged.textData.glyphs?.length)
    merged.textData = { ...merged.textData, glyphs: undefined, baselines: undefined };
  return Object.keys(merged).length ? mergeFields({ ...c }, merged) : c;
}

// Effective node. Ids of instance children ("I<instance>;<seg>;…") are built lazily:
// most walks only need the id of the nodes they report.
class Eff {
  constructor(raw, path, gpath, ctx, top, id) { this.raw = raw; this.path = path; this.gpath = gpath; this.ctx = ctx; this.top = top; this._id = id; }
  get id() { return this._id ?? (this._id = `I${this.top};${this.path.replaceAll("/", ";")}`); }
}
const childEff = (c, e, ctx, base, gbase, top) => {
  const path = base + seg(c), gpath = gbase + gk(c.guid);
  return new Eff(effective(c, path, gpath, ctx), path, gpath, ctx, top);
};

// Master not in the file: still surface what the instance itself carries — text from
// component-property values, overrides and derived data — as flat pseudo-children.
function orphanChildren(r, e, ctx, top) {
  const byPath = new Map();
  for (const [k, d] of ctx.der) byPath.set(k, mergeFields({}, d));
  for (const [k, o] of ctx.ov) byPath.set(k, mergeFields(byPath.get(k) || {}, o));
  const out = [], seen = new Set();
  for (const [k, n] of byPath) {
    const t = n.textData?.characters; if (!t || n.visible === false) continue;
    seen.add(t);
    const path = (e.ctx ? e.path + "/" : "") + k;
    const o = new Eff({ ...n, type: n.type || "TEXT", name: n.name || "" }, path, path, null, top); o.orphan = true; out.push(o);
  }
  for (const [def, v] of ctx.props) {
    const t = v.textValue?.characters; if (!t || seen.has(t)) continue;
    const o = new Eff({ type: "TEXT", name: "(component property)", textData: v.textValue }, "", "", null, top, `I${top};prop-${def}`); o.orphan = true; out.push(o);
  }
  return out;
}

// Effective children of an effective node {raw, id, path, gpath, ctx, top}.
function childrenOf(m, e, stats) {
  const kids = kidsOf(m, e, stats);
  for (const k of kids) if (k.raw.type === "INSTANCE") k.raw = withMaster(m, k.raw);
  return kids;
}
function kidsOf(m, e, stats) {
  const r = e.raw;
  if (e.orphan) return [];
  if (r.type === "INSTANCE") {
    stats.instances++;
    const mid = masterIdOf(r), master = mid && m.byId.get(mid);
    const top = e.top || e.id;
    const base = e.ctx ? e.path + "/" : "", gbase = e.ctx ? e.gpath + "/" : "";
    if (!master || e.ctx?.chain.has(mid)) {
      stats.unresolved++;
      if (stats.missing && stats.missing.length < 10 && !stats.missing.some((x) => x.master === mid))
        stats.missing.push({ instance: e.id, master: mid, ...(r.componentKey && { componentKey: r.componentKey }), ...(r.sourceLibraryKey && { library: r.sourceLibraryKey }) });
      return orphanChildren(r, e, level(m, r, null, base, gbase, e.ctx), top);
    }
    const ctx = level(m, r, master, base, gbase, e.ctx);
    return (m.kids.get(mid) || []).map((c) => childEff(c, e, ctx, base, gbase, top));
  }
  const kids = m.kids.get(gk(r.guid)) || [];
  if (!e.ctx) return kids.map(rootEff);
  return kids.map((c) => childEff(c, e, e.ctx, e.path + "/", e.gpath + "/", e.top));
}

function componentName(m, r) {
  const master = m.byId.get(masterIdOf(r)); if (!master) return null;
  const set = m.byId.get(gk(master.parentIndex?.guid));
  return set?.isStateGroup ? `${set.name}/${master.name}` : master.name;
}

// missing: up to 10 unresolved masters {instance, master, componentKey?, library?}
const newStats = () => ({ nodes: 0, instances: 0, unresolved: 0, hidden: 0, missing: [] });

// An INSTANCE inherits the master's own properties (fills, radius, auto layout, …) for
// fields it does not set itself; a field present on the instance (even an empty list)
// is its override.
const NOT_INHERITED = new Set(["guid", "parentIndex", "name", "type", "transform", "visible", "phase", "symbolData", "overriddenSymbolID",
  "componentPropDef", "componentPropAssignment", "componentPropRef", "isStateGroup", "overrideKey", "derivedSymbolData", "guidPath",
  "internalOnly", "componentKey", "sourceLibraryKey", "symbolDescription", "isPublishable", "publishID", "sharedSymbolVersion"]);
const INHERITED = new WeakMap();
function withMaster(m, r) {
  if (r?.type !== "INSTANCE") return r;
  if (INHERITED.has(r)) return INHERITED.get(r);
  const master = m.byId.get(masterIdOf(r));
  let out = r;
  if (master) {
    const add = {};
    for (const k in master) if (!NOT_INHERITED.has(k) && r[k] === undefined) add[k] = master[k];
    if (Object.keys(add).length) out = { ...add, ...r };
  }
  INHERITED.set(r, out);
  return out;
}
const rootEff = (n) => new Eff(n, "", "", null, null, gk(n.guid));

// Depth-first walk of the effective tree. visit(e, depth, ancestors) -> false skips children.
// `ancestors` is a shared stack: read it during visit, copy it if you keep it.
function walk(m, e, opts, stats, visit, depth = 0, anc = []) {
  stats.nodes++;
  if (visit(e, depth, anc) === false) return;
  anc.push(e);
  for (const k of childrenOf(m, e, stats)) {
    if (k.raw.visible === false && !opts.hidden) { stats.hidden++; continue; }
    walk(m, k, opts, stats, visit, depth + 1, anc);
  }
  anc.pop();
}

function toNode(m, e, opts, stats, depth) {
  if (++stats.nodes > (opts.maxNodes ?? Infinity))
    throw new Error(`subtree has more than ${opts.maxNodes} nodes. Narrow it: pass a deeper \`node\`, a smaller \`depth\`, or use pixso_text`);
  const o = view(e.raw, m); o.id = e.id;
  if (e.raw.type === "INSTANCE") { const c = componentName(m, e.raw); if (c) o.component = c; else o.unresolvedMaster = masterIdOf(e.raw); }
  const kids = childrenOf(m, e, stats).filter((k) => k.raw.visible !== false || opts.hidden || (stats.hidden++, false));
  if (kids.length && e.raw.type === "BOOLEAN_OPERATION" && o.svg) { o.operands = kids.length; return o; } // svg is the result
  if (kids.length) {
    if (opts.depth != null && depth >= opts.depth) o.childCount = kids.length;
    else o.children = kids.map((k) => toNode(m, k, opts, stats, depth + 1));
  }
  return o;
}

// Resolve a selector (plain id, instance-child id "I…;…", or exact name) to effective nodes.
function resolve(m, sel, opts) {
  if (sel == null || sel === "") return m.roots.map(rootEff);
  const direct = m.byId.get(String(sel));
  if (direct) { const e = rootEff(direct); e.raw = withMaster(m, direct); return [e]; }
  const parts = /^I(\d+:\d+)((?:;[^;]+)+)$/.exec(String(sel));
  if (parts && m.byId.get(parts[1])) { // "I<instance>;<seg>;<seg>…": follow the path
    let e = rootEff(m.byId.get(parts[1]));
    for (const s of parts[2].slice(1).split(";")) {
      e = childrenOf(m, e, newStats()).find((k) => k.id.split(";").pop() === s || k.id.endsWith(";prop-" + s));
      if (!e) break;
    }
    if (e) return [e];
  }
  const want = String(sel).toLowerCase(), out = [], stats = newStats();
  for (const r of m.roots) walk(m, rootEff(r), { hidden: true }, stats, (e) => {
    if (e.id === sel || (e.raw.name || "").toLowerCase() === want) { out.push(e); return false; }
  });
  return out;
}

// Nested layer tree (instances expanded). opts: {depth, hidden, stats}
export function buildTree(raw, opts = {}) { return selectTree(raw, null, opts); }
export function selectTree(raw, sel, opts = {}) {
  const m = model(raw), stats = opts.stats || newStats();
  return resolve(m, sel, opts).map((e) => toNode(m, e, opts, stats, 0));
}

const isInternal = (e) => e.raw.type === "CANVAS" && (e.raw.internalOnly || e.raw.name === "Internal Only Canvas");
const pathOf = (m, anc) => anc.slice(1).filter((a) => a.raw.type !== "CANVAS").map((a) => a.raw.type === "INSTANCE" ? (componentName(m, a.raw) || a.raw.name) : a.raw.name).filter(Boolean).join(" / ");

// Find nodes whose name OR text contains `query` (instances expanded; library-master
// copies skipped). Returns {id, type, name, text?, frame} — frame = top-level frame.
export function findNodes(raw, query, opts = {}) {
  const m = model(raw), q = String(query).toLowerCase(), stats = opts.stats || newStats(), out = [];
  for (const r of m.roots) walk(m, rootEff(r), opts, stats, (e, depth, anc) => {
    if (isInternal(e)) return false;
    const name = e.raw.name || "", text = e.raw.textData?.characters || "";
    if (name.toLowerCase().includes(q) || text.toLowerCase().includes(q)) {
      const o = { id: e.id, type: e.raw.type, name };
      if (text) o.text = text.length > 120 ? text.slice(0, 120) + "…" : text;
      const f = anc.find((a) => a.raw.type !== "DOCUMENT" && a.raw.type !== "CANVAS");
      if (f) o.frame = { id: f.id, name: f.raw.name };
      out.push(o);
    }
  });
  return out;
}

// Visible text of a subtree in reading (layer) order: [{id, text, path}].
export function textNodes(raw, sel, opts = {}) {
  const m = model(raw), stats = opts.stats || newStats(), out = [];
  for (const e of resolve(m, sel, opts)) walk(m, e, opts, stats, (x, d, anc) => {
    if (isInternal(x)) return false;
    const t = x.raw.textData?.characters;
    if (x.raw.type === "TEXT" && t && t.trim()) out.push({ id: x.id, text: t, path: pathOf(m, anc) });
  });
  return out;
}

// Table of contents: pages (CANVAS, internal library canvas skipped) with their
// top-level frames; SECTION contents are listed with `section`.
export function pagesOf(raw) {
  const m = model(raw), canvases = [];
  const collect = (n) => n.type === "CANVAS" ? canvases.push(n) : n.type === "DOCUMENT" && (m.kids.get(gk(n.guid)) || []).forEach(collect);
  m.roots.forEach(collect);
  return canvases.filter((c) => !(c.internalOnly || c.name === "Internal Only Canvas")).map((c) => {
    const frames = [];
    const add = (n, section) => {
      if (n.visible === false) return;
      if (n.type === "SECTION") { for (const k of m.kids.get(gk(n.guid)) || []) add(k, n.name); return; }
      const f = { id: gk(n.guid), name: n.name, type: n.type };
      if (n.size) f.w = r2(n.size.x), f.h = r2(n.size.y);
      if (section) f.section = section;
      frames.push(f);
    };
    for (const k of m.kids.get(gk(c.guid)) || []) add(k);
    return { id: gk(c.guid), name: c.name, frameCount: frames.length, frames };
  });
}

// Design tokens of a subtree (instances expanded, hidden skipped), with usage counts:
// colors by role, gradients, text styles, fonts, radii, shadows/blurs, spacing, strokes.
export function tokensOf(raw, sel, opts = {}) {
  const m = model(raw), stats = opts.stats || newStats();
  const bag = () => new Map();
  const colors = bag(), gradients = bag(), text = bag(), radii = bag(), shadows = bag(), blurs = bag(), gaps = bag(), paddings = bag(), strokes = bag();
  const fonts = new Map();
  const bump = (map, key, init) => { const e = map.get(key) || map.set(key, { ...init(), count: 0 }).get(key); e.count++; return e; };
  const usedVars = new Set();
  const named = (e, name) => { if (name) { e.names = e.names || []; if (!e.names.includes(name)) e.names.push(name); } };
  const color = (p, role, style) => {
    if (!p) return;
    if (typeof p === "string" || p.color) {
      const c = typeof p === "string" ? p : p.color; const e = bump(colors, c, () => ({ color: c, roles: {} })); e.roles[role] = (e.roles[role] || 0) + 1;
      named(e, p.var); named(e, style); if (p.var) usedVars.add(p.var);
    }
    else if (p.type?.startsWith("GRADIENT")) bump(gradients, JSON.stringify([p.type, p.angle, p.stops]), () => ({ type: p.type, ...(p.angle != null && { angle: p.angle }), stops: p.stops }));
  };
  const textStyle = (v, sample, fill) => {
    const st = { fontFamily: v.fontFamily, fontWeight: v.fontWeight || 400, fontSize: v.fontSize };
    for (const k of ["italic", "lineHeight", "letterSpacing", "textCase", "textDecoration"]) if (v[k] != null) st[k] = v[k];
    const e = bump(text, JSON.stringify(st), () => ({ ...st, colors: {}, sample: sample.slice(0, 40) }));
    named(e, v.textStyle);
    if (fill) e.colors[fill] = (e.colors[fill] || 0) + 1;
    if (st.fontFamily) { const w = fonts.get(st.fontFamily) || fonts.set(st.fontFamily, new Set()).get(st.fontFamily); w.add(st.fontWeight); }
  };
  for (const e of resolve(m, sel ?? null, opts)) walk(m, e, opts, stats, (x) => {
    if (isInternal(x)) return false;
    const v = view(x.raw, m);
    const isText = v.type === "TEXT";
    for (const f of v.fills || []) color(f, isText ? "text" : "fill", v.fillStyle);
    if (v.background) color(v.background, "fill");
    for (const f of v.strokes || []) color(f, "stroke", v.strokeStyle);
    for (const name of Object.values(v.vars || {})) usedVars.add(name);
    if (v.strokes && v.strokeWeight) bump(strokes, v.strokeWeight, () => ({ width: v.strokeWeight }));
    if (v.cornerRadius) bump(radii, JSON.stringify(v.cornerRadius), () => ({ radius: v.cornerRadius }));
    for (const fx of v.effects || []) {
      if (fx.type?.includes("SHADOW")) bump(shadows, JSON.stringify(fx), () => ({ ...fx }));
      else if (fx.blur) bump(blurs, JSON.stringify(fx), () => ({ ...fx }));
    }
    if (v.autoLayout) {
      if (v.autoLayout.gap) bump(gaps, v.autoLayout.gap, () => ({ gap: v.autoLayout.gap }));
      if (v.autoLayout.padding) bump(paddings, v.autoLayout.padding.join(" "), () => ({ padding: v.autoLayout.padding }));
    }
    if (isText && v.text?.trim()) {
      const fill = solidOf(v.fills?.[0]);
      if (v.runs) for (const r of v.runs) { textStyle({ ...v, ...r }, r.text, solidOf(r.fills?.[0]) || fill); for (const f of r.fills || []) color(f, "text", r.fillStyle); }
      else textStyle(v, v.text, fill);
    }
  });
  const list = (map, sort = (a, b) => b.count - a.count) => [...map.values()].sort(sort);
  const out = {
    colors: list(colors),
    textStyles: list(text, (a, b) => (b.fontSize || 0) - (a.fontSize || 0) || b.count - a.count).map((t) => ({ ...t, colors: Object.keys(t.colors).sort((a, b) => t.colors[b] - t.colors[a]) })),
    fonts: [...fonts].map(([family, w]) => ({ family, weights: [...w].sort((a, b) => a - b) })),
    radii: list(radii), shadows: list(shadows), blurs: list(blurs), gaps: list(gaps), paddings: list(paddings), strokeWidths: list(strokes), gradients: list(gradients),
    variables: [...m.vars.entries()].filter(([k, v]) => !k.startsWith("key:") && usedVars.has(v.name)).map(([, v]) => variableValues(m, v)),
  };
  for (const k in out) if (!out[k].length) delete out[k];
  return out;
}

// Components used in a subtree (nested ones included), grouped by component set:
// {component, id, count, instances[≤10], variants {prop: [values]}, props {name: [values]}}.
// Variant values come from master names like "State=Hover, Size=M"; property values are
// what each instance shows (assignment or default): text, boolean, or swapped component.
const propName = (n) => String(n || "").replace(/#\d+:\d+$/, "");
export function componentsOf(raw, sel, opts = {}) {
  const m = model(raw), stats = opts.stats || newStats(), groups = new Map(), missing = new Map();
  const add = (set, k, v) => { const a = set[k] || (set[k] = []); if (!a.some((x) => x === v) && a.length < 20) a.push(v); };
  for (const e of resolve(m, sel ?? null, opts)) walk(m, e, opts, stats, (x) => {
    if (isInternal(x)) return false;
    const r = x.raw;
    if (r.type !== "INSTANCE") return;
    const mid = masterIdOf(r), master = mid && m.byId.get(mid);
    if (!master) { const g = missing.get(mid) || missing.set(mid, { master: mid, ...(r.componentKey && { componentKey: r.componentKey }), count: 0, instances: [] }).get(mid); g.count++; if (g.instances.length < 10) g.instances.push(x.id); return; }
    const set = m.byId.get(gk(master.parentIndex?.guid));
    const owner = set?.isStateGroup ? set : master;
    const key = gk(owner.guid);
    const g = groups.get(key) || groups.set(key, { component: owner.name, id: key, count: 0, instances: [], variants: {}, props: {} }).get(key);
    g.count++; if (g.instances.length < 10) g.instances.push(x.id);
    if (owner === set) for (const part of String(master.name).split(",")) { const [k, v] = part.split("=").map((t) => t?.trim()); if (k && v != null) add(g.variants, k, v); }
    const values = new Map();
    for (const d of [...(owner === set ? set.componentPropDef || [] : []), ...(master.componentPropDef || [])]) if (!d.isDeleted) values.set(gk(d.id), { def: d, v: d.initialValue });
    for (const a of r.componentPropAssignment || []) { const it = values.get(gk(a.defID)); if (it && a.value) it.v = a.value; }
    for (const { def, v } of values.values()) {
      if (!v) continue;
      const shown = v.textValue ? v.textValue.characters : v.boolValue != null ? v.boolValue : v.guidValue ? (m.byId.get(gk(v.guidValue))?.name ?? gk(v.guidValue)) : undefined;
      if (shown !== undefined) add(g.props, propName(def.name), shown);
    }
  });
  const out = [...groups.values()].sort((a, b) => b.count - a.count).map((g) => {
    if (!Object.keys(g.variants).length) delete g.variants;
    if (!Object.keys(g.props).length) delete g.props;
    return g;
  });
  return { components: out, ...(missing.size && { unresolved: [...missing.values()] }) };
}

// Prototype map of a subtree: every interaction as {from:{id,name,frame}, on, action, to, …},
// plus flow starting points of the pages involved.
export function flowsOf(raw, sel, opts = {}) {
  const m = model(raw), stats = opts.stats || newStats(), links = [], starts = [];
  for (const e of resolve(m, sel ?? null, opts)) walk(m, e, opts, stats, (x, d, anc) => {
    if (isInternal(x)) return false;
    const r = x.raw;
    if (r.type === "CANVAS") {
      const sid = gk(r.prototypeStartNodeID); if (sid) starts.push({ page: r.name, id: sid, name: m.byId.get(sid)?.name });
    }
    if (r.prototypeStartPt?.name) starts.push({ id: x.id, name: r.name, flow: r.prototypeStartPt.name });
    const ia = interactionsOf(r, m); if (!ia.length) return;
    const f = anc.find((a) => a.raw.type !== "DOCUMENT" && a.raw.type !== "CANVAS");
    for (const i of ia) links.push({ from: { id: x.id, name: r.name || r.textData?.characters?.slice(0, 40) || "", ...(f && { frame: f.raw.name }) }, ...i });
  });
  return { ...(starts.length && { starts }), count: links.length, links };
}

// Collapse runs of look-alike siblings (same component, or same layer structure) in a
// materialized tree: keep the first `keep`, replace the rest with one
// {type: "REPEAT", repeated, ids: [first, last], items: [texts of each hidden item]} node,
// so a 300-row list costs 3 rows + its data. Mutates and returns the tree.
// signature: the node's type + component (set, not variant), then layer types two levels down —
// rows whose cells hold different variants/components still count as one list
const sigOf = (n, d = 2, top = true) => n.type + (top && n.component ? ":" + n.component.split("/")[0] : "") +
  (d && n.children ? "[" + n.children.map((c) => sigOf(c, d - 1, false)).join(",") + "]" : "");
const textsIn = (n, out = []) => { if (n.text?.trim()) out.push(n.text); for (const c of n.children || []) textsIn(c, out); return out; };
export function collapseRepeats(nodes, { keep = 3, min = 5 } = {}) {
  for (const n of nodes) {
    if (!n.children?.length) continue;
    const out = [];
    for (let i = 0; i < n.children.length;) {
      const sig = sigOf(n.children[i]);
      let j = i + 1; while (j < n.children.length && sigOf(n.children[j]) === sig) j++;
      const run = n.children.slice(i, j);
      if (run.length >= min) {
        const rest = run.slice(keep);
        out.push(...run.slice(0, keep), { type: "REPEAT", repeated: rest.length, like: run[0].id, ids: [rest[0].id, rest.at(-1).id],
          items: rest.slice(0, 200).map((r) => textsIn(r).join(" | ")).filter(Boolean), ...(rest.length > 200 && { itemsTruncated: true }) });
      } else out.push(...run);
      i = j;
    }
    n.children = out;
    collapseRepeats(out.filter((c) => c.type !== "REPEAT"), { keep, min });
  }
  return nodes;
}

export { newStats };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const nodes = decodeDocument(readFileSync(process.argv[2] || "doc.bin"));
  const mode = process.argv[3] || "tree", arg = process.argv[4];
  let out;
  if (mode === "flat") out = summarize(nodes);
  else if (mode === "find") out = findNodes(nodes, arg || "");
  else if (mode === "node") out = selectTree(nodes, arg || "");
  else if (mode === "text") out = textNodes(nodes, arg);
  else if (mode === "pages") out = pagesOf(nodes);
  else if (mode === "tokens") out = tokensOf(nodes, arg);
  else if (mode === "components") out = componentsOf(nodes, arg);
  else if (mode === "flows") out = flowsOf(nodes, arg);
  else out = buildTree(nodes);
  console.log(JSON.stringify(out, null, 1));
}
