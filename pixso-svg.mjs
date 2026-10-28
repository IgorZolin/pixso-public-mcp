// Reconstruct a preview SVG from a decoded Pixso tree (buildTree/selectTree output).
// Not Pixso's official export, but drawn from the real data: vector/icon outlines and
// text glyph outlines come from the document's geometry blobs, so shapes and text are
// exact; fills, gradients, strokes, radii, shadows/blur, clipping and rotation are
// reconstructed. Images are grey placeholders (asset bytes are not in the document).
import { decodeDocument, selectTree, newStats } from "./pixso-kiwi.mjs";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const VECTORISH = new Set(["VECTOR", "BOOLEAN_OPERATION", "STAR", "LINE", "REGULAR_POLYGON"]);
const IMAGE_PLACEHOLDER = "#d9d9d9";

const newCtx = () => ({ defs: [], seq: 0, glyphs: new Map(), st: { rendered: 0, texts: 0, glyphTexts: 0, paths: 0, vectorsAsBoxes: 0, imagePlaceholders: 0, masksSkipped: 0 } });

// paint -> ` fill="…" fill-opacity="…"` (attr = fill | stroke). Gradients become defs.
function paint(p, c, attr = "fill") {
  if (!p) return ` ${attr}="none"`;
  if (typeof p === "string") return ` ${attr}="${p}"`;
  const op = p.opacity != null ? ` ${attr}-opacity="${p.opacity}"` : "";
  if (p.type?.startsWith("GRADIENT")) {
    const id = "g" + c.seq++;
    const stops = (p.stops || []).map((s) => `<stop offset="${r(s.at * 100)}%" stop-color="${s.color}"/>`).join("");
    const [fx, fy] = p.from || [0, 0.5], [tx, ty] = p.to || [1, 0.5];
    c.defs.push(p.type === "GRADIENT_LINEAR"
      ? `<linearGradient id="${id}" x1="${fx}" y1="${fy}" x2="${tx}" y2="${ty}">${stops}</linearGradient>`
      : `<radialGradient id="${id}" cx="${fx}" cy="${fy}" r="${r(Math.hypot(tx - fx, ty - fy)) || 0.5}">${stops}</radialGradient>`);
    return ` ${attr}="url(#${id})"${op}`;
  }
  if (p.type === "IMAGE") { c.st.imagePlaceholders++; return ` ${attr}="${IMAGE_PLACEHOLDER}"${op}`; }
  if (p.color) return ` ${attr}="${p.color}"${op}`;
  return ` ${attr}="none"`;
}
const r = (n) => Math.round(n * 100) / 100;

function filterAttr(n, c) {
  const fx = [];
  for (const e of n.effects || []) {
    if (e.type === "DROP_SHADOW") fx.push(`<feDropShadow dx="${e.x || 0}" dy="${e.y || 0}" stdDeviation="${(e.blur || 0) / 2}" flood-color="${e.color || "#000"}"/>`);
    else if (e.type === "FOREGROUND_BLUR" || e.type === "LAYER_BLUR") fx.push(`<feGaussianBlur stdDeviation="${(e.blur || 0) / 2}"/>`);
  }
  if (!fx.length) return "";
  const id = "f" + c.seq++;
  c.defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">${fx.join("")}</filter>`);
  return ` filter="url(#${id})"`;
}

// Rect outline with per-corner radii [tl, tr, br, bl], inset by `k` (stroke alignment).
function rectShape(w, h, rad, k = 0) {
  const x = k, y = k, W = w - 2 * k, H = h - 2 * k;
  if (W <= 0 || H <= 0) return null;
  if (!Array.isArray(rad)) return { tag: "rect", a: `x="${r(x)}" y="${r(y)}" width="${r(W)}" height="${r(H)}"${rad ? ` rx="${r(Math.max(0, rad - k))}"` : ""}` };
  const [tl, tr, br, bl] = rad.map((v) => Math.max(0, Math.min(v - k, W / 2, H / 2)));
  const d = `M${r(x + tl)} ${r(y)}H${r(x + W - tr)}A${r(tr)} ${r(tr)} 0 0 1 ${r(x + W)} ${r(y + tr)}V${r(y + H - br)}A${r(br)} ${r(br)} 0 0 1 ${r(x + W - br)} ${r(y + H)}H${r(x + bl)}A${r(bl)} ${r(bl)} 0 0 1 ${r(x)} ${r(y + H - bl)}V${r(y + tl)}A${r(tl)} ${r(tl)} 0 0 1 ${r(x + tl)} ${r(y)}Z`;
  return { tag: "path", a: `d="${d}"` };
}

function strokeAttrs(n, c) {
  const s = n.strokes?.[0]; if (!s) return "";
  return paint(s, c, "stroke") + ` stroke-width="${n.strokeWeight || 1}"` + (n.dash ? ` stroke-dasharray="${n.dash.join(" ")}"` : "");
}

function textSVG(n, c) {
  const color = (typeof n.fills?.[0] === "string" ? n.fills[0] : n.fills?.[0]?.color) || "#000";
  if (n._glyphs?.length) { // exact: glyph outlines from the document, shared via <defs>
    c.st.glyphTexts++;
    return n._glyphs.map((g) => {
      let id = c.glyphs.get(g.d);
      if (!id) { id = "gl" + c.glyphs.size; c.glyphs.set(g.d, id); c.defs.push(`<path id="${id}" d="${g.d}"/>`); }
      return `<use href="#${id}" xlink:href="#${id}" transform="translate(${r(g.x)} ${r(g.y)}) scale(${g.size})" fill="${g.paint || color}"/>`;
    }).join("");
  }
  // fallback (text overridden without layout): one <text> line per \n, no wrapping
  const fs = n.fontSize || 14, lh = typeof n.lineHeight === "number" ? n.lineHeight : fs * 1.2, w = n.w || 0;
  const [anchor, x] = n.textAlign === "center" ? ["middle", w / 2] : n.textAlign === "right" ? ["end", w] : ["start", 0];
  const font = ` font-family="${esc(n.fontFamily || "sans-serif")}" font-size="${fs}"${n.fontWeight ? ` font-weight="${n.fontWeight}"` : ""}${n.italic ? ` font-style="italic"` : ""}${typeof n.letterSpacing === "number" ? ` letter-spacing="${n.letterSpacing}"` : ""}`;
  // split runs (or the whole text) into lines of styled segments
  const lines = [[]];
  for (const run of n.runs || [{ text: n.text || "" }]) String(run.text).split("\n").forEach((part, i) => { if (i) lines.push([]); if (part) lines.at(-1).push([part, run]); });
  const seg = ([t, run]) => {
    const c = run.fills?.[0] && (typeof run.fills[0] === "string" ? run.fills[0] : run.fills[0].color);
    const a = `${c ? ` fill="${c}"` : ""}${run.fontWeight ? ` font-weight="${run.fontWeight}"` : ""}${run.fontSize ? ` font-size="${run.fontSize}"` : ""}${run.italic ? ` font-style="italic"` : ""}`;
    return a ? `<tspan${a}>${esc(t)}</tspan>` : esc(t);
  };
  return `<text${font} text-anchor="${anchor}" fill="${color}">` +
    lines.map((l, i) => `<tspan x="${r(x)}" y="${r(lh * i + (lh + fs * 0.7) / 2)}">${l.map(seg).join("")}</tspan>`).join("") + "</text>";
}

function shape(n, c) {
  const w = n.w || 0, h = n.h || 0, filter = filterAttr(n, c);
  if (n.type === "TEXT") { if (n.text) c.st.texts++; return textSVG(n, c); }
  if (n._paths?.length && (VECTORISH.has(n.type) || n.svg)) { // exact outlines
    c.st.paths++;
    return `<g${filter}>` + n._paths.map((p) => p.stroke
      ? `<path d="${p.d}" fill="none"${paint(p.paint, c, "stroke")} stroke-width="${p.stroke.width}"${p.stroke.cap === "round" || p.stroke.cap === "square" ? ` stroke-linecap="${p.stroke.cap}"` : ""}${p.stroke.join === "round" || p.stroke.join === "bevel" ? ` stroke-linejoin="${p.stroke.join}"` : ""}/>`
      : `<path d="${p.d}"${paint(p.paint, c)}${p.rule ? ` fill-rule="${p.rule}"` : ""}/>`).join("") + "</g>";
  }
  if (VECTORISH.has(n.type)) c.st.vectorsAsBoxes++;
  if (!w && !h) return "";
  const sw = n.strokeWeight || 1, k = n.strokes ? (n.strokeAlign === "inside" ? sw / 2 : n.strokeAlign === "outside" ? -sw / 2 : 0) : 0;
  if (n.type === "ELLIPSE") {
    const fills = (n.fills || []).map((f) => `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}"${paint(f, c)}/>`).join("");
    const st = n.strokes ? `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${r(w / 2 - k)}" ry="${r(h / 2 - k)}" fill="none"${strokeAttrs(n, c)}/>` : "";
    return `<g${filter}>${fills}${st}</g>`;
  }
  const base = rectShape(w, h, n.cornerRadius);
  if (!base) return "";
  const fills = [...(n.background ? [n.background] : []), ...(n.fills || [])];
  let out = fills.map((f) => `<${base.tag} ${base.a}${paint(f, c)}/>`).join("");
  if (n.strokes) {
    if (n.borderWeights) { // per-side borders, drawn inside
      const [t, rt, b, l] = n.borderWeights, col = paint(n.strokes[0], c);
      out += [[0, 0, w, t], [w - rt, 0, rt, h], [0, h - b, w, b], [0, 0, l, h]].filter((q) => q[2] > 0 && q[3] > 0)
        .map((q) => `<rect x="${r(q[0])}" y="${r(q[1])}" width="${r(q[2])}" height="${r(q[3])}"${col}/>`).join("");
    } else {
      const so = rectShape(w, h, n.cornerRadius, k);
      if (so) out += `<${so.tag} ${so.a} fill="none"${strokeAttrs(n, c)}/>`;
    }
  }
  return `<g${filter}>${out}</g>`;
}

function transformOf(n) {
  const m = n._m;
  if (m && (n.rotation || m.m00 < 0 || m.m11 < 0 || Math.abs(m.m00 * m.m11 - m.m01 * m.m10 - 1) > 1e-3))
    return `matrix(${[m.m00, m.m10, m.m01, m.m11, m.m02, m.m12].map((v) => Math.round(v * 1e4) / 1e4).join(" ")})`;
  return `translate(${n.x || 0} ${n.y || 0})`;
}

function render(n, c) {
  if (n.mask) { c.st.masksSkipped++; return ""; }
  c.st.rendered++;
  const op = n.opacity != null && n.opacity !== 1 ? ` opacity="${n.opacity}"` : "";
  const blend = n.blendMode ? ` style="mix-blend-mode:${n.blendMode.replace(/_/g, "-")}"` : "";
  let kids = n.type === "BOOLEAN_OPERATION" && n._paths?.length ? "" : (n.children || []).map((k) => render(k, c)).join("");
  if (kids && n.clipsContent && n.w && n.h) {
    const id = "c" + c.seq++, s = rectShape(n.w, n.h, n.cornerRadius);
    c.defs.push(`<clipPath id="${id}"><${s.tag} ${s.a}/></clipPath>`);
    kids = `<g clip-path="url(#${id})">${kids}</g>`;
  }
  return `<g transform="${transformOf(n)}"${op}${blend}>${shape(n, c)}${kids}</g>`;
}

// roots -> standalone SVG string; framed by the roots' bounds (size-less roots by their children)
export function toSVG(roots, c = newCtx()) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const boxes = roots.flatMap((n) => (n.w || n.h) ? [n] : (n.children || []).map((k) => ({ x: (n.x || 0) + (k.x || 0), y: (n.y || 0) + (k.y || 0), w: k.w, h: k.h })));
  for (const b of boxes) { const x = b.x || 0, y = b.y || 0; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + (b.w || 0)); maxY = Math.max(maxY, y + (b.h || 0)); }
  if (!isFinite(minX)) { minX = minY = 0; maxX = maxY = 1; }
  const W = r(maxX - minX) || 1, H = r(maxY - minY) || 1;
  const body = roots.map((n) => render(n, c)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="${r(minX)} ${r(minY)} ${W} ${H}" width="${W}" height="${H}">` +
    (c.defs.length ? `<defs>${c.defs.join("")}</defs>` : "") + body + "</svg>";
}

// Collapse icon-like subtrees (small, only vector/shape layers, no text/images) into
// one standalone `svg` string on the subtree root, replacing its children — the form
// an agent can inline directly. Mutates and returns the tree.
const ICON_MAX = Number(process.env.PIXSO_ICON_MAX || 96);
const CONTAINER = new Set(["FRAME", "GROUP", "INSTANCE", "SYMBOL", "BOOLEAN_OPERATION"]);
function iconLike(n) {
  let vec = 0;
  const ok = (k) => {
    if (k.type === "TEXT" || [...(k.fills || []), ...(k.strokes || [])].some((f) => f?.type === "IMAGE")) return false;
    if (VECTORISH.has(k.type) || k._paths?.length) vec++;
    else if (!CONTAINER.has(k.type) && k.type !== "RECTANGLE" && k.type !== "ELLIPSE") return false;
    return (k.children || []).every(ok);
  };
  return (n.children || []).every(ok) && vec > 0;
}
export function iconize(nodes) {
  for (const n of nodes) {
    if (CONTAINER.has(n.type) && n.children?.length && n.w && n.h && n.w <= ICON_MAX && n.h <= ICON_MAX && iconLike(n)) {
      const { x, y } = n, m = n._m;
      n.x = 0; n.y = 0; n._m = null;            // render in the icon's own coordinates
      const svg = toSVG([n]);
      n.x = x; n.y = y; n._m = m;
      n.iconLayers = n.children.length; delete n.children; n.svg = svg;
    } else if (n.children) iconize(n.children);
  }
  return nodes;
}

// -> {svg, stats}. stats tells an agent how much of the render is exact: texts drawn
// from glyph outlines vs fallback <text>, vector paths vs boxes, image placeholders,
// instances expanded vs unresolved, hidden layers skipped.
export function documentSVG(rawNodes, node) {
  const tree = newStats();
  const roots = selectTree(rawNodes, node || null, { stats: tree });
  if (node && !roots.length) throw new Error(`node "${node}" not found (use pixso_find to get an id)`);
  const c = newCtx();
  const svg = toSVG(roots, c);
  return { svg, stats: { ...c.st, instances: tree.instances, unresolvedInstances: tree.unresolved, hiddenSkipped: tree.hidden, missing: tree.missing } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const nodes = decodeDocument(readFileSync(process.argv[2] || "doc.bin"));
  process.stdout.write(documentSVG(nodes, process.argv[3]).svg);
}
