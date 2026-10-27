// HTML/CSS generation from a hand-built frame.
import { test } from "node:test";
import assert from "node:assert/strict";
import { documentHTML } from "../pixso-html.mjs";

const G = (s, l) => ({ sessionID: s, localID: l });
const at = (s, l, pos) => ({ guid: G(s, l), position: pos });
const T = (x, y) => ({ m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y });
const SOLID = (r, g, b, a = 255) => ({ type: "SOLID", color: { r, g, b, a } });
const path = (d, box) => ({ path: { d, box }, windingRule: "NONZERO" });

export const card = [
  { guid: G(1, 1), type: "CANVAS", name: "Page" },
  { guid: G(2, 1), type: "FRAME", name: "Карточка", parentIndex: at(1, 1, "a"), transform: T(0, 0), size: { x: 480, y: 64 },
    fillPaints: [{ type: "GRADIENT_LINEAR", transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }, stops: [{ color: { r: 255, g: 255, b: 255, a: 255 }, position: 0 }, { color: { r: 240, g: 244, b: 255, a: 255 }, position: 1 }] }],
    cornerRadius: 12, effects: [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 25 }, offset: { x: 0, y: 4 }, radius: 16, visible: true }],
    strokePaints: [SOLID(229, 230, 235)], strokeWeight: 1, strokeAlign: "INSIDE",
    stackMode: "HORIZONTAL", stackSpacing: 12, stackPaddingTop: 12, stackPaddingRight: 16, stackPaddingBottom: 12, stackPaddingLeft: 16,
    stackCounterAlignItems: "CENTER", stackPrimarySizing: "FIXED", stackCounterSizing: "FIXED" },
  { guid: G(2, 2), type: "FRAME", name: "icon/doc", parentIndex: at(2, 1, "a"), transform: T(16, 20), size: { x: 24, y: 24 } },
  { guid: G(2, 3), type: "VECTOR", name: "v", parentIndex: at(2, 2, "a"), transform: T(4, 2), size: { x: 16, y: 20 },
    fillPaints: [SOLID(22, 93, 255)], fillGeometry: [path("M0 0L10 0L16 6L16 20L0 20Z", [0, 0, 16, 20])] },
  { guid: G(2, 4), type: "TEXT", name: "title", parentIndex: at(2, 1, "b"), transform: T(52, 20), size: { x: 300, y: 24 },
    stackChildPrimarySizing: "RESIZE_TO_FIT", textAutoResize: "HEIGHT",
    fontName: { family: "Inter", style: "Medium" }, fontSize: 16, lineHeight: { value: 24, units: "PIXELS" }, fillPaints: [SOLID(29, 33, 41)],
    textData: { characters: "Акт № 15 — требуется согласование", characterStyleIDs: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      styleOverrideTable: [{ styleID: 1, fillPaints: [SOLID(255, 125, 0)] }] } },
  { guid: G(2, 5), type: "TEXT", name: "date", parentIndex: at(2, 1, "c"), transform: T(364, 22), size: { x: 100, y: 20 }, textAutoResize: "WIDTH_AND_HEIGHT",
    fontName: { family: "Inter", style: "Regular" }, fontSize: 14, fillPaints: [SOLID(134, 144, 156)], textData: { characters: "12.10.2026" } },
  { guid: G(2, 6), type: "RECTANGLE", name: "badge", parentIndex: at(2, 1, "d"), transform: T(440, 8), size: { x: 8, y: 8 }, cornerRadius: 4,
    fillPaints: [SOLID(245, 63, 63)], stackPositioning: "ABSOLUTE", autoLayoutAbsolutePos: true },
];

test("frame -> flexbox CSS, fill/hug children, absolute child, icon svg, text runs", () => {
  const { html, stats } = documentHTML(card, "2:1", { fonts: false });
  const rule = (cls) => new RegExp(`\\.${cls} \\{ ([^}]*) \\}`).exec(html)?.[1] || "";
  const root = rule("kartochka");
  for (const d of ["display: flex;", "flex-direction: row;", "gap: 12px;", "padding: 12px 16px 12px 16px;", "align-items: center;",
    "width: 480px;", "height: 64px;", "border-radius: 12px;", "background-image: linear-gradient(90deg, #ffffff 0%, #f0f4ff 100%);",
    "border: 1px solid #e5e6eb;", "box-shadow: 0px 4px 16px 0px rgba(0, 0, 0, 0.098);"]) assert.ok(root.includes(d), `root has ${d}\n${root}`);
  const title = rule("title");
  const hasWidth = (r) => /(^|; )width:/.test(r);
  assert.ok(title.includes("flex: 1 1 0;") && !hasWidth(title), "fill container on main axis");
  assert.ok(title.includes("font-weight: 500;") && title.includes("line-height: 24px;") && title.includes("white-space: pre-wrap;"));
  assert.ok(rule("date").includes("white-space: pre;") && !hasWidth(rule("date")), "hug text has no fixed width");
  assert.ok(rule("badge").includes("position: absolute;") && rule("badge").includes("left: 440px;"));
  assert.match(html, /<div class="icon-doc"[^>]*><svg[^>]*viewBox="0 0 24 24"[^]*?M0 0L10 0L16 6L16 20L0 20Z[^]*?<\/svg><\/div>/);
  assert.match(html, /<p class="title"[^>]*>Акт № 15 — <span style="color: #ff7d00">требуется согласование<\/span><\/p>/);
  assert.deepEqual([stats.texts, stats.icons], [2, 1]);
});
