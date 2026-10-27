// Overview / analysis tools on hand-built node lists.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pagesOf } from "../pixso-kiwi.mjs";

const G = (s, l) => ({ sessionID: s, localID: l });
const at = (s, l, pos) => ({ guid: G(s, l), position: pos });
const T = (x, y) => ({ m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y });
export { G, at, T };

test("pagesOf: pages with top-level frames, sections expanded, internal canvas and hidden skipped", () => {
  const nodes = [
    { guid: G(0, 0), type: "DOCUMENT", name: "doc" },
    { guid: G(1, 1), type: "CANVAS", name: "Экраны", parentIndex: at(0, 0, "a") },
    { guid: G(0, 2), type: "CANVAS", name: "Internal Only Canvas", internalOnly: true, parentIndex: at(0, 0, "b") },
    { guid: G(2, 1), type: "FRAME", name: "Карточка", parentIndex: at(1, 1, "a"), size: { x: 1920, y: 1080 } },
    { guid: G(2, 2), type: "SECTION", name: "Согласование", parentIndex: at(1, 1, "b") },
    { guid: G(2, 3), type: "FRAME", name: "Требуется согласование", parentIndex: at(2, 2, "a"), size: { x: 1920, y: 1080 } },
    { guid: G(2, 4), type: "FRAME", name: "hidden", parentIndex: at(1, 1, "c"), visible: false },
  ];
  assert.deepEqual(pagesOf(nodes), [{ id: "1:1", name: "Экраны", frameCount: 2, frames: [
    { id: "2:1", name: "Карточка", type: "FRAME", w: 1920, h: 1080 },
    { id: "2:3", name: "Требуется согласование", type: "FRAME", w: 1920, h: 1080, section: "Согласование" }] }]);
});

import { tokensOf } from "../pixso-kiwi.mjs";
const SOLID = (r, g, b) => ({ type: "SOLID", color: { r, g, b, a: 255 } });

test("tokensOf: colors by role, text styles incl. runs and instance text, radii, spacing", () => {
  const nodes = [
    { guid: G(1, 1), type: "CANVAS", name: "Page" },
    { guid: G(2, 1), type: "FRAME", name: "card", parentIndex: at(1, 1, "a"), fillPaints: [SOLID(255, 255, 255)], cornerRadius: 8,
      stackMode: "VERTICAL", stackSpacing: 12, stackPaddingTop: 16, stackPaddingRight: 16, stackPaddingBottom: 16, stackPaddingLeft: 16 },
    { guid: G(2, 2), type: "TEXT", name: "", parentIndex: at(2, 1, "a"), fontName: { family: "Inter", style: "Bold" }, fontSize: 20,
      fillPaints: [SOLID(29, 33, 41)], textData: { characters: "Карточка проекта" } },
    { guid: G(2, 3), type: "TEXT", name: "", parentIndex: at(2, 1, "b"), fontName: { family: "Inter", style: "Regular" }, fontSize: 14,
      fillPaints: [SOLID(29, 33, 41)], textData: { characters: "Статус: Новый", characterStyleIDs: [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1],
        styleOverrideTable: [{ styleID: 1, fillPaints: [SOLID(255, 0, 0)] }] } },
    { guid: G(2, 4), type: "INSTANCE", name: "btn", parentIndex: at(2, 1, "c"), symbolData: { symbolID: G(3, 1) } },
    { guid: G(3, 1), type: "SYMBOL", name: "Button", parentIndex: at(1, 1, "b"), cornerRadius: 8, fillPaints: [SOLID(22, 93, 255)] },
    { guid: G(3, 2), type: "TEXT", name: "", parentIndex: at(3, 1, "a"), fontName: { family: "Inter", style: "Medium" }, fontSize: 14,
      fillPaints: [SOLID(255, 255, 255)], textData: { characters: "Подписать" } },
  ];
  const t = tokensOf(nodes, "2:1");
  assert.deepEqual(t.colors.map((c) => [c.color, c.count]), [["#ffffff", 2], ["#1d2129", 2], ["#ff0000", 1], ["#165dff", 1]]);
  assert.deepEqual(t.colors[0].roles, { fill: 1, text: 1 });
  assert.deepEqual(t.textStyles.map((s) => [s.fontSize, s.fontWeight, s.sample, s.count]),
    [[20, 700, "Карточка проекта", 1], [14, 400, "Статус: ", 2], [14, 500, "Подписать", 1]], "Regular 14 shared by both runs");
  assert.deepEqual(t.textStyles.find((s) => s.fontWeight === 400).colors.sort(), ["#1d2129", "#ff0000"]);
  assert.deepEqual(t.fonts, [{ family: "Inter", weights: [400, 500, 700] }]);
  assert.deepEqual(t.radii, [{ radius: 8, count: 2 }], "instance inherits the master's radius");
  assert.deepEqual(t.gaps, [{ gap: 12, count: 1 }]);
  assert.deepEqual(t.paddings, [{ padding: [16, 16, 16, 16], count: 1 }]);
});

import { componentsOf } from "../pixso-kiwi.mjs";

test("componentsOf: grouped by set, variant values, property values, nested and unresolved", () => {
  const txt = (s) => ({ characters: s });
  const nodes = [
    { guid: G(1, 1), type: "CANVAS", name: "Page" },
    { guid: G(5, 0), type: "FRAME", name: "Button", parentIndex: at(1, 1, "a"), isStateGroup: true,
      componentPropDef: [{ id: G(9, 1), name: "Label#12:3", type: "TEXT", initialValue: { textValue: txt("Button") } },
                         { id: G(9, 2), name: "Icon", type: "BOOL", initialValue: { boolValue: true } }] },
    { guid: G(5, 1), type: "SYMBOL", name: "Type=Primary, Size=M", parentIndex: at(5, 0, "a") },
    { guid: G(5, 2), type: "SYMBOL", name: "Type=Secondary, Size=M", parentIndex: at(5, 0, "b") },
    { guid: G(5, 3), type: "INSTANCE", name: "icon", parentIndex: at(5, 1, "a"), symbolData: { symbolID: G(6, 1) } },
    { guid: G(6, 1), type: "SYMBOL", name: "icon/sign", parentIndex: at(1, 1, "b") },
    { guid: G(7, 0), type: "FRAME", name: "screen", parentIndex: at(1, 1, "c") },
    { guid: G(7, 1), type: "INSTANCE", name: "Instance 19", parentIndex: at(7, 0, "a"), symbolData: { symbolID: G(5, 1) },
      componentPropAssignment: [{ defID: G(9, 1), value: { textValue: txt("Подписать") } }] },
    { guid: G(7, 2), type: "INSTANCE", name: "Instance 20", parentIndex: at(7, 0, "b"), symbolData: { symbolID: G(5, 2) },
      componentPropAssignment: [{ defID: G(9, 1), value: { textValue: txt("Отклонить") } }, { defID: G(9, 2), value: { boolValue: false } }] },
    { guid: G(7, 3), type: "INSTANCE", name: "lib", parentIndex: at(7, 0, "c"), symbolData: { symbolID: G(99, 1) }, componentKey: "k1" },
  ];
  const { components, unresolved } = componentsOf(nodes, "7:0");
  assert.deepEqual(components[0], { component: "Button", id: "5:0", count: 2, instances: ["7:1", "7:2"],
    variants: { Type: ["Primary", "Secondary"], Size: ["M"] }, props: { Label: ["Подписать", "Отклонить"], Icon: [true, false] } });
  assert.deepEqual(components[1], { component: "icon/sign", id: "6:1", count: 1, instances: ["I7:1;5:3"] }, "nested icon inside the primary button");
  assert.deepEqual(unresolved, [{ master: "99:1", componentKey: "k1", count: 1, instances: ["7:3"] }]);
});

import { selectTree } from "../pixso-kiwi.mjs";
import { documentHTML } from "../pixso-html.mjs";

test("named styles and variables: on nodes, in tokens (with modes), as CSS custom properties", () => {
  const alias = (s, l) => ({ value: { alias: { guid: G(s, l) } }, dataType: "ALIAS" });
  const nodes = [
    { guid: G(0, 0), type: "DOCUMENT", name: "doc" },
    { guid: G(1, 1), type: "CANVAS", name: "Page", parentIndex: at(0, 0, "a") },
    { guid: G(0, 2), type: "CANVAS", name: "Internal Only Canvas", internalOnly: true, parentIndex: at(0, 0, "b") },
    { guid: G(8, 1), type: "RECTANGLE", name: "Text/Primary", styleType: "FILL", parentIndex: at(0, 2, "a"), fillPaints: [SOLID(29, 33, 41)] },
    { guid: G(8, 2), type: "TEXT", name: "Body/M", styleType: "TEXT", parentIndex: at(0, 2, "b") },
    { guid: G(9, 0), type: "VARIABLE_SET", name: "Colors", variableSetModes: [{ id: G(9, 10), name: "Light" }, { id: G(9, 11), name: "Dark" }] },
    { guid: G(9, 1), type: "VARIABLE", name: "brand/primary", variableSetID: { guid: G(9, 0) }, variableResolvedType: "COLOR",
      variableDataValues: { entries: [{ modeID: G(9, 10), variableData: { value: { colorValue: { r: 22, g: 93, b: 255, a: 255 } } } },
                                       { modeID: G(9, 11), variableData: { value: { colorValue: { r: 64, g: 128, b: 255, a: 255 } } } }] } },
    { guid: G(9, 2), type: "VARIABLE", name: "space/12", variableSetID: { guid: G(9, 0) }, variableResolvedType: "FLOAT",
      variableDataValues: { entries: [{ modeID: G(9, 10), variableData: { value: { floatValue: 12 } } }] } },
    { guid: G(2, 1), type: "FRAME", name: "btn", parentIndex: at(1, 1, "a"), size: { x: 120, y: 40 },
      fillPaints: [{ ...SOLID(22, 93, 255), colorVar: alias(9, 1) }], stackMode: "HORIZONTAL", stackSpacing: 12,
      variableConsumptionMap: { entries: [{ variableField: "STACK_SPACING", variableData: alias(9, 2) }] } },
    { guid: G(2, 2), type: "TEXT", name: "", parentIndex: at(2, 1, "a"), fontName: { family: "Inter", style: "Regular" }, fontSize: 14,
      fillPaints: [SOLID(29, 33, 41)], inheritFillStyleID: G(8, 1), inheritTextStyleID: G(8, 2), textData: { characters: "OK" } },
  ];
  const [btn] = selectTree(nodes, "2:1");
  assert.deepEqual(btn.fills, [{ color: "#165dff", var: "brand/primary" }]);
  assert.deepEqual(btn.vars, { gap: "space/12" });
  assert.equal(btn.children[0].fillStyle, "Text/Primary");
  assert.equal(btn.children[0].textStyle, "Body/M");
  assert.equal(selectTree(nodes, null).some((r) => r.type === "VARIABLE" || r.type === "VARIABLE_SET"), false, "definitions not in the tree");

  const t = tokensOf(nodes, "2:1");
  assert.deepEqual(t.colors.find((c) => c.color === "#165dff").names, ["brand/primary"]);
  assert.deepEqual(t.textStyles[0].names, ["Body/M"]);
  assert.deepEqual(t.variables, [
    { name: "brand/primary", collection: "Colors", type: "color", values: { Light: "#165dff", Dark: "#4080ff" } },
    { name: "space/12", collection: "Colors", type: "float", values: { Light: 12 } }]);

  const { html } = documentHTML(nodes, "2:1", { fonts: false });
  assert.match(html, /:root \{ --brand-primary: #165dff; --text-primary: #1d2129; \}/);
  assert.match(html, /background-color: var\(--brand-primary\)/);
  assert.match(html, /color: var\(--text-primary\)/);
});

import { flowsOf } from "../pixso-kiwi.mjs";

test("flows: interactions (incl. inside instances), start points, scroll; HTML hints", () => {
  const act = (to, extra = {}) => ({ transitionNodeID: to, connectionType: "INTERNAL_NODE", navigationType: "NAVIGATE", transitionType: "DISSOLVE", ...extra });
  const nodes = [
    { guid: G(1, 1), type: "CANVAS", name: "Page", prototypeStartNodeID: G(2, 1) },
    { guid: G(2, 1), type: "FRAME", name: "Список", parentIndex: at(1, 1, "a"), size: { x: 400, y: 300 }, scrollDirection: "VERTICAL" },
    { guid: G(2, 2), type: "INSTANCE", name: "btn", parentIndex: at(2, 1, "a"), transform: T(10, 10), size: { x: 100, y: 40 }, symbolData: { symbolID: G(4, 1) } },
    { guid: G(2, 3), type: "TEXT", name: "help", parentIndex: at(2, 1, "b"), transform: T(10, 60), size: { x: 100, y: 20 }, textData: { characters: "Справка" },
      prototypeInteractions: [{ event: { interactionType: "ON_CLICK" }, actions: [{ connectionType: "URL", connectionURL: "https://example.com/help" }] },
                              { event: { interactionType: "ON_HOVER" }, actions: [act(G(3, 2), { navigationType: "OVERLAY", transitionType: "INSTANT_TRANSITION" })] }] },
    { guid: G(3, 1), type: "FRAME", name: "Карточка", parentIndex: at(1, 1, "b"), size: { x: 400, y: 300 } },
    { guid: G(3, 2), type: "FRAME", name: "Подсказка", parentIndex: at(1, 1, "c"), size: { x: 200, y: 80 } },
    { guid: G(4, 1), type: "SYMBOL", name: "Button", parentIndex: at(1, 1, "d"), size: { x: 100, y: 40 },
      prototypeInteractions: [{ event: { interactionType: "ON_CLICK" }, actions: [act(G(3, 1))] }] },
    { guid: G(4, 2), type: "TEXT", name: "label", parentIndex: at(4, 1, "a"), textData: { characters: "Открыть" },
      prototypeInteractions: [{ event: { interactionType: "ON_CLICK" }, actions: [{ connectionType: "BACK" }] }] },
  ];
  const f = flowsOf(nodes, "1:1");
  assert.deepEqual(f.starts, [{ page: "Page", id: "2:1", name: "Список" }]);
  assert.deepEqual(f.links.slice(0, 4), [ // on the screen (the instance inherits its master's click); master definitions follow
    { from: { id: "2:2", name: "btn", frame: "Список" }, on: "click", action: "navigate", to: { id: "3:1", name: "Карточка" }, transition: "dissolve" },
    { from: { id: "I2:2;4:2", name: "label", frame: "Список" }, on: "click", action: "back" },
    { from: { id: "2:3", name: "help", frame: "Список" }, on: "click", action: "url", url: "https://example.com/help" },
    { from: { id: "2:3", name: "help", frame: "Список" }, on: "hover", action: "overlay", to: { id: "3:2", name: "Подсказка" } }]);
  const { html } = documentHTML(nodes, "2:1", { fonts: false });
  assert.match(html, /\.spisok \{[^}]*overflow: hidden auto;/);
  assert.match(html, /data-pixso-id="2:2" data-name="btn" data-component="Button" data-action="click→navigate Карточка"/);
  assert.match(html, /\.button \{[^}]*cursor: pointer;/);
});

import { collapseRepeats } from "../pixso-kiwi.mjs";

test("collapseRepeats: long look-alike runs become 3 items + REPEAT with the rest's texts; short runs stay", () => {
  const nodes = [{ guid: G(1, 1), type: "CANVAS", name: "Page" },
    { guid: G(2, 1), type: "FRAME", name: "Реестр", parentIndex: at(1, 1, "a"), size: { x: 800, y: 9000 }, stackMode: "VERTICAL" },
    { guid: G(2, 2), type: "FRAME", name: "toolbar", parentIndex: at(2, 1, "a") }];
  for (let b = 0; b < 3; b++) nodes.push({ guid: G(3, b), type: "RECTANGLE", name: "btn" + b, parentIndex: at(2, 2, "b" + b) });
  for (let r = 0; r < 300; r++) {
    nodes.push({ guid: G(4, r), type: "FRAME", name: "row " + r, parentIndex: at(2, 1, "r" + String(r).padStart(3, "0")) });
    nodes.push({ guid: G(5, r), type: "TEXT", name: "", parentIndex: at(4, r, "a"), textData: { characters: "Документ " + r } });
    nodes.push({ guid: G(6, r), type: "TEXT", name: "", parentIndex: at(4, r, "b"), textData: { characters: r % 2 ? "Подписан" : "Черновик" } });
  }
  const [list] = collapseRepeats(selectTree(nodes, "2:1"));
  assert.equal(list.children.length, 1 + 3 + 1);
  assert.equal(list.children[0].children.length, 3, "3 toolbar buttons are not a list");
  const rep = list.children[4];
  assert.deepEqual([rep.type, rep.repeated, rep.like, rep.ids], ["REPEAT", 297, "4:0", ["4:3", "4:299"]]);
  assert.equal(rep.items.length, 200); assert.equal(rep.itemsTruncated, true);
  assert.equal(rep.items[0], "Документ 3 | Подписан");
  const { html } = documentHTML(nodes, "2:1", { fonts: false });
  assert.match(html, /<!-- …297 more like data-pixso-id="4:0" \(4:3 … 4:299\); their texts:\n\s+- Документ 3 \| Подписан/);
  assert.equal((html.match(/class="row-/g) || []).length + (html.match(/class="row"/g) || []).length, 3);
});
