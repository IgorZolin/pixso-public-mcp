// Reconstruct a preview SVG from a decoded Pixso tree (buildTree/selectTree output).
// NOT Pixso's official vector export — an approximate render from the structured data,
// useful as a visual reference. VECTOR nodes (icon paths) are drawn as bounding boxes.
import { decodeDocument, buildTree, selectTree } from "./pixso-kiwi.mjs";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let gradSeq = 0;

// a fill entry -> {paint:"<css or url(#id)>", defs:"<svg defs or ''>"}
function fill(f, defs) {
  if (!f) return "none";
  if (typeof f === "string") return f;                 // solid hex
  if (f.type && f.type.startsWith("GRADIENT")) {
    const id = "g" + gradSeq++;
    const stops = (f.stops || []).map((s) => `<stop offset="${(s.at ?? 0) * 100}%" stop-color="${s.color}"/>`).join("");
    const grad = f.type === "GRADIENT_RADIAL"
      ? `<radialGradient id="${id}">${stops}</radialGradient>`
      : `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient>`;
    defs.push(grad);
    return `url(#${id})`;
  }
  if (f.color) return f.color;                          // {color, opacity}
  return "none";
}

function shape(n, defs) {
  const w = n.w || 0, h = n.h || 0;
  const f = fill(n.fills && n.fills[0], defs);
  const stroke = n.strokes && n.strokes[0];
  const sAttr = stroke ? ` stroke="${typeof stroke === "string" ? stroke : stroke.color}" stroke-width="${n.strokeWeight || 1}"` : "";
  const filter = n.effects?.some((e) => e.type?.includes("SHADOW"))
    ? (() => { const e = n.effects.find((x) => x.type.includes("SHADOW")); const id = "f" + gradSeq++;
        defs.push(`<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${e.x || 0}" dy="${e.y || 0}" stdDeviation="${(e.blur || 0) / 2}" flood-color="${e.color || "#000"}"/></filter>`);
        return ` filter="url(#${id})"`; })()
    : "";

  if (n.type === "ELLIPSE")
    return `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${f}"${sAttr}${filter}/>`;
  if (n.type === "TEXT") {
    const fs = n.fontSize || 14;
    const t = `<text x="0" y="${fs}" font-family="${esc(n.fontName || "sans-serif")}" font-size="${fs}" fill="${typeof f === "string" && f !== "none" ? f : "#000"}">${esc(n.text || "")}</text>`;
    return t;
  }
  // FRAME / RECTANGLE / CANVAS / GROUP / VECTOR → rectangle (bg). CANVAS/GROUP w/o size skip.
  if (!w && !h) return "";
  const bg = n.background || f;
  const rx = n.cornerRadius ? ` rx="${n.cornerRadius}"` : "";
  return `<rect width="${w}" height="${h}"${rx} fill="${bg || "none"}"${sAttr}${filter}/>`;
}

function render(n, defs) {
  const op = n.opacity != null && n.opacity !== 1 ? ` opacity="${n.opacity}"` : "";
  const inner = shape(n, defs) + (n.children || []).map((c) => render(c, defs)).join("");
  return `<g transform="translate(${n.x || 0},${n.y || 0})"${op}>${inner}</g>`;
}

export function toSVG(roots) {
  const defs = [];
  // viewBox = bounding box of the roots
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of roots) { const x = r.x || 0, y = r.y || 0; minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x + (r.w || 0)); maxY = Math.max(maxY, y + (r.h || 0)); }
  if (!isFinite(minX)) { minX = minY = 0; maxX = maxY = 1; }
  const W = maxX - minX, H = maxY - minY;
  const body = roots.map((r) => render(r, defs)).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${W} ${H}" width="${W}" height="${H}">` +
    (defs.length ? `<defs>${defs.join("")}</defs>` : "") + body + "</svg>";
}

export function documentSVG(rawNodes, node) {
  return toSVG(node ? selectTree(rawNodes, node) : buildTree(rawNodes));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const nodes = decodeDocument(readFileSync(process.argv[2] || "doc.bin"));
  process.stdout.write(documentSVG(nodes, process.argv[3]));
}
