// Geometry blobs, icons, text styling, gradients and layout in the node view.
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectTree, blobPath } from "../pixso-kiwi.mjs";
import { iconize, toSVG } from "../pixso-svg.mjs";

const G = (s, l) => ({ sessionID: s, localID: l });
const at = (s, l, pos) => ({ guid: G(s, l), position: pos });
const T = (x, y) => ({ m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y });
const path = (d, box) => ({ path: { d, box }, windingRule: "NONZERO" });

test("path blob: commands + float32 pairs -> SVG d and bounds", () => {
  const b = Buffer.alloc(1 + 8 + 1 + 8 + 1 + 24 + 1);
  let p = 0; const pt = (x, y) => { b.writeFloatLE(x, p); b.writeFloatLE(y, p + 4); p += 8; };
  b[p++] = 1; pt(0, 0); b[p++] = 2; pt(10, 0); b[p++] = 4; pt(10, 5); pt(5, 10); pt(0, 10); b[p++] = 0;
  assert.deepEqual(blobPath(b), { d: "M0 0L10 0C10 5 5 10 0 10Z", box: [0, 0, 10, 10] });
  assert.equal(blobPath(Buffer.from([9, 1, 2])), null, "not a path blob");
});

const icon = [
  { guid: G(1, 1), type: "CANVAS", name: "Page" },
  { guid: G(2, 1), type: "FRAME", name: "icon/download", parentIndex: at(1, 1, "a"), transform: T(100, 50), size: { x: 24, y: 24 } },
  { guid: G(2, 2), type: "VECTOR", name: "arrow", parentIndex: at(2, 1, "a"), transform: T(4, 2), size: { x: 16, y: 14 },
    fillPaints: [{ type: "SOLID", color: { r: 17, g: 34, b: 51, a: 255 } }], fillGeometry: [path("M0 0L16 0L8 14Z", [0, 0, 16, 14])] },
  { guid: G(2, 3), type: "VECTOR", name: "bar", parentIndex: at(2, 1, "b"), transform: T(4, 20), size: { x: 16, y: 2 },
    strokePaints: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 255 } }], strokePaddingPath: [path("M0 0L16 0L16 2L0 2Z", [0, 0, 16, 2])] },
];

test("vector node exposes a standalone svg; icon groups collapse to one svg", () => {
  const [page] = selectTree(icon, "1:1");
  const frame = page.children[0];
  assert.match(frame.children[0].svg, /^<svg[^>]*viewBox="0 0 16 14"[^>]*><path d="M0 0L16 0L8 14Z" fill="#112233"\/><\/svg>$/);
  iconize([page]);
  assert.equal(frame.iconLayers, 2);
  assert.equal(frame.children, undefined);
  assert.match(frame.svg, /viewBox="0 0 24 24"/);
  assert.match(frame.svg, /translate\(4 2\)[^]*M0 0L16 0L8 14Z[^]*translate\(4 20\)[^]*fill="#000000"/);
  assert.equal(frame.x, 100, "position kept for layout");
});

test("text: weight from style/metadata, line height, letter spacing, alignment, runs", () => {
  const nodes = [{ guid: G(3, 1), type: "TEXT", name: "", transform: T(0, 0), size: { x: 200, y: 40 },
    fontName: { family: "Roboto", style: "SemiBold Italic" }, fontSize: 16,
    lineHeight: { value: 150, units: "PERCENT" }, letterSpacing: { value: 2, units: "PERCENT" },
    textAlignHorizontal: "CENTER", textAutoResize: "HEIGHT", textDecoration: "UNDERLINE",
    fillPaints: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 255 } }],
    textData: { characters: "Срок: 12.10", characterStyleIDs: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
      styleOverrideTable: [{ styleID: 1, fontName: { family: "Roboto", style: "Bold" }, fillPaints: [{ type: "SOLID", color: { r: 255, g: 0, b: 0, a: 255 } }] }],
      fontMetaData: [{ key: { family: "Roboto", style: "Bold" }, fontWeight: 700 }] } }];
  const [t] = selectTree(nodes, "3:1");
  assert.equal(t.fontWeight, 600);
  assert.equal(t.italic, true);
  assert.equal(t.lineHeight, "150%");
  assert.equal(t.letterSpacing, "0.02em");
  assert.equal(t.textAlign, "center");
  assert.equal(t.textResize, "fixed-width");
  assert.equal(t.textDecoration, "underline");
  assert.deepEqual(t.runs, [{ text: "Срок: " }, { text: "12.10", fontFamily: "Roboto", fontWeight: 700, fills: ["#ff0000"] }]);
  assert.match(toSVG([t]), /font-weight="600"[^]*text-anchor="middle"/, "fallback <text> without glyph layout");
});

test("gradient handles, rotation, per-corner radius, auto layout in flex terms", () => {
  const nodes = [
    { guid: G(4, 1), type: "FRAME", name: "card", transform: { m00: 0, m01: -1, m02: 10, m10: 1, m11: 0, m12: 0 }, size: { x: 100, y: 50 },
      rectangleCornerRadiiIndependent: true, rectangleTopLeftCornerRadius: 8, rectangleTopRightCornerRadius: 8,
      fillPaints: [{ type: "GRADIENT_LINEAR", transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        stops: [{ color: { r: 0, g: 0, b: 0, a: 255 }, position: 0 }, { color: { r: 255, g: 255, b: 255, a: 255 }, position: 1 }] }],
      stackMode: "HORIZONTAL", stackSpacing: 12, stackPaddingTop: 8, stackPaddingBottom: 8, stackPrimaryAlignItems: "SPACE_EVENLY",
      stackCounterAlignItems: "CENTER", stackPrimarySizing: "RESIZE_TO_FIT", stackChildPrimarySizing: "RESIZE_TO_FIT" }];
  const [f] = selectTree(nodes, "4:1");
  assert.deepEqual(f.fills[0].from, [0, 0.5]);
  assert.deepEqual(f.fills[0].to, [1, 0.5]);
  assert.equal(f.fills[0].angle, 90, "left -> right");
  assert.equal(f.rotation, 90);
  assert.deepEqual(f.cornerRadius, [8, 8, 0, 0]);
  assert.deepEqual(f.autoLayout, { mode: "horizontal", gap: 12, padding: [8, 0, 8, 0], justify: "space-between", align: "center", width: "hug", height: "fixed" });
  assert.equal(f.layoutGrow, 1);
  assert.match(toSVG([f]), /matrix\(0 1 -1 0 10 0\)/);
});
