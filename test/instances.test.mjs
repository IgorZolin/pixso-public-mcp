// Instance expansion on a hand-built node list (no schema / network needed).
//   node --test
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectTree, textNodes, findNodes } from "../pixso-kiwi.mjs";

const G = (s, l) => ({ sessionID: s, localID: l });
const at = (s, l, pos) => ({ guid: G(s, l), position: pos });
const text = (s) => ({ characters: s });
const size = (x, y) => ({ x, y });

// page 1:1
//   SYMBOL 2:1 "Button"            props: label(TEXT, def 9:1), icon(BOOL, def 9:2)
//     TEXT 2:2 "label"             bound to 9:1
//     RECTANGLE 2:3 "icon"         visibility bound to 9:2
//     INSTANCE 2:4 -> 3:1          nested badge
//   SYMBOL 3:1 "Badge"
//     TEXT 3:2 "badge text" = "new"
//   SYMBOL 4:1 "Badge alt"
//     TEXT 4:2 = "alt"
//   INSTANCE 5:1 -> 2:1            label="Подписать", icon=false, nested badge text overridden,
//                                   derived size for label
//   INSTANCE 5:2 -> 2:1            nested badge swapped to 4:1
const nodes = [
  { guid: G(1, 1), type: "CANVAS", name: "Page" },
  { guid: G(2, 1), type: "SYMBOL", name: "Button", parentIndex: at(1, 1, "a"),
    componentPropDef: [{ id: G(9, 1), name: "label", type: "TEXT", initialValue: { textValue: text("Button") } },
                       { id: G(9, 2), name: "icon", type: "BOOL", initialValue: { boolValue: true } }] },
  { guid: G(2, 2), type: "TEXT", name: "label", parentIndex: at(2, 1, "a"), textData: text("Button"), size: size(10, 10),
    componentPropRef: [{ defID: G(9, 1), componentPropNodeField: "TEXT_DATA" }] },
  { guid: G(2, 3), type: "RECTANGLE", name: "icon", parentIndex: at(2, 1, "b"),
    componentPropRef: [{ defID: G(9, 2), componentPropNodeField: "VISIBLE" }] },
  { guid: G(2, 4), type: "INSTANCE", name: "badge", parentIndex: at(2, 1, "c"), symbolData: { symbolID: G(3, 1) } },
  { guid: G(3, 1), type: "SYMBOL", name: "Badge", parentIndex: at(1, 1, "b") },
  { guid: G(3, 2), type: "TEXT", name: "badge text", parentIndex: at(3, 1, "a"), textData: text("new") },
  { guid: G(4, 1), type: "SYMBOL", name: "Badge alt", parentIndex: at(1, 1, "c") },
  { guid: G(4, 2), type: "TEXT", name: "alt text", parentIndex: at(4, 1, "a"), textData: text("alt") },
  { guid: G(5, 1), type: "INSTANCE", name: "Instance 19", parentIndex: at(1, 1, "d"),
    symbolData: { symbolID: G(2, 1), symbolOverrides: [{ guidPath: { guids: [G(2, 4), G(3, 2)] }, textData: text("3") }] },
    componentPropAssignment: [{ defID: G(9, 1), value: { textValue: text("Подписать") } }, { defID: G(9, 2), value: { boolValue: false } }],
    derivedSymbolData: [{ guidPath: { guids: [G(2, 2)] }, size: size(80, 20) }] },
  { guid: G(5, 2), type: "INSTANCE", name: "Instance 20", parentIndex: at(1, 1, "e"),
    symbolData: { symbolID: G(2, 1), symbolOverrides: [{ guidPath: { guids: [G(2, 4)] }, overriddenSymbolID: G(4, 1) }] } },
  { guid: G(6, 1), type: "INSTANCE", name: "broken", parentIndex: at(1, 1, "f"), symbolData: { symbolID: G(99, 9) } },
];

test("instance children come from the master, with props, overrides and derived layout", () => {
  const stats = { nodes: 0, instances: 0, unresolved: 0, hidden: 0 };
  const [inst] = selectTree(nodes, "5:1", { stats });
  assert.equal(inst.component, "Button");
  const names = inst.children.map((c) => c.name);
  assert.deepEqual(names, ["label", "badge"], "icon hidden by BOOL prop");
  assert.equal(stats.hidden, 1);
  const label = inst.children[0];
  assert.equal(label.text, "Подписать");
  assert.equal(label.id, "I5:1;2:2");
  assert.deepEqual([label.w, label.h], [80, 20], "derivedSymbolData size");
  const badge = inst.children[1];
  assert.equal(badge.component, "Badge");
  assert.equal(badge.children[0].text, "3", "nested override via guidPath");
  assert.equal(badge.children[0].id, "I5:1;2:4;3:2");
});

test("defaults apply when the instance has no overrides; nested swap works", () => {
  const [inst] = selectTree(nodes, "5:2");
  assert.deepEqual(inst.children.map((c) => c.name), ["label", "icon", "badge"]);
  assert.equal(inst.children[0].text, "Button");
  assert.equal(inst.children[2].component, "Badge alt");
  assert.equal(inst.children[2].children[0].text, "alt");
});

test("text, find and selection reach inside instances; unresolved masters are counted", () => {
  const texts = textNodes(nodes, "5:1").map((t) => t.text);
  assert.deepEqual(texts, ["Подписать", "3"]);
  const hit = findNodes(nodes, "подпис");
  assert.equal(hit.length, 1);
  assert.equal(hit[0].id, "I5:1;2:2");
  assert.equal(hit[0].frame.id, "5:1");
  assert.equal(selectTree(nodes, "I5:1;2:4;3:2")[0].text, "3", "instance-child id is selectable");
  const stats = { nodes: 0, instances: 0, unresolved: 0, hidden: 0 };
  selectTree(nodes, "6:1", { stats });
  assert.equal(stats.unresolved, 1);
});

// ---- variations real files may use ----
const lib = [
  { guid: G(1, 1), type: "CANVAS", name: "Page" },
  { guid: G(0, 2), type: "CANVAS", name: "Internal Only Canvas", internalOnly: true },
  // library master copy: nodes carry overrideKey (their id in the library)
  { guid: G(40, 1), type: "SYMBOL", name: "Header", parentIndex: at(0, 2, "a"), overrideKey: G(700, 1) },
  { guid: G(40, 2), type: "TEXT", name: "title", parentIndex: at(40, 1, "a"), overrideKey: G(700, 2), textData: text("Title"), size: size(1, 1),
    componentPropRef: [{ defID: G(9, 9), nodeField: 67 }] },                      // numeric field id instead of enum
  { guid: G(40, 3), type: "TEXT", name: "user", parentIndex: at(40, 1, "b"), overrideKey: G(700, 3), textData: text("User") },
  { guid: G(40, 4), type: "INSTANCE", name: "chip", parentIndex: at(40, 1, "c"), overrideKey: G(700, 4),
    symbolData: { symbolID: G(41, 1) }, derivedSymbolData: [{ guidPath: { guids: [G(701, 2)] }, size: size(5, 5) }] },
  { guid: G(41, 1), type: "SYMBOL", name: "Chip", parentIndex: at(0, 2, "b"), overrideKey: G(701, 1) },
  { guid: G(41, 2), type: "TEXT", name: "chip text", parentIndex: at(41, 1, "a"), overrideKey: G(701, 2), textData: text("chip") },
  // A: overrides addressed by overrideKey; outer derived beats the nested one
  { guid: G(50, 1), type: "INSTANCE", name: "A", parentIndex: at(1, 1, "a"),
    symbolData: { symbolID: G(40, 1), symbolOverrides: [
      { guidPath: { guids: [G(700, 3)] }, textData: text("Иванов М.И.") },
      { guidPath: { guids: [G(700, 4)] }, symbolData: { symbolOverrides: [{ guidPath: { guids: [G(701, 2)] }, textData: text("Требуется согласование") }] } }] },
    componentPropAssignment: [{ defID: G(9, 9), value: { textValue: text("Карточка документа") } }],
    derivedSymbolData: [{ guidPath: { guids: [G(700, 4), G(701, 2)] }, size: size(120, 24) }] },
  // B: same overrides addressed by guid instead
  { guid: G(50, 2), type: "INSTANCE", name: "B", parentIndex: at(1, 1, "b"),
    symbolData: { symbolID: G(40, 1), symbolOverrides: [{ guidPath: { guids: [G(40, 3)] }, textData: text("Петров") }] } },
  // C: master not in the file (library not loaded)
  { guid: G(50, 3), type: "INSTANCE", name: "Instance 19", parentIndex: at(1, 1, "c"), componentKey: "abc123",
    symbolData: { symbolID: G(77, 7), symbolOverrides: [{ guidPath: { guids: [G(800, 1)] }, textData: text("Подписать") }] },
    componentPropAssignment: [{ defID: G(9, 1), value: { textValue: text("Отклонить") } }] },
];

test("library masters: overrideKey paths, numeric nodeField, nested symbolData override, outer derived wins", () => {
  const [a] = selectTree(lib, "50:1");
  const [title, user, chip] = a.children;
  assert.equal(title.text, "Карточка документа");
  assert.equal(user.text, "Иванов М.И.");
  assert.equal(chip.component, "Chip", "nested override must keep symbolID");
  assert.equal(chip.children[0].text, "Требуется согласование");
  assert.deepEqual([chip.children[0].w, chip.children[0].h], [120, 24]);
  assert.equal(chip.children[0].id, "I50:1;700:4;701:2");
});

test("overrides addressed by guid still match nodes that have an overrideKey", () => {
  const [b] = selectTree(lib, "50:2");
  assert.equal(b.children[1].text, "Петров");
});

test("instance without master in file: text surfaces, master is reported", () => {
  const stats = { nodes: 0, instances: 0, unresolved: 0, hidden: 0, missing: [] };
  const [c] = selectTree(lib, "50:3", { stats });
  assert.equal(c.unresolvedMaster, "77:7");
  assert.deepEqual(c.children.map((x) => x.text), ["Подписать", "Отклонить"]);
  assert.deepEqual(stats.missing, [{ instance: "50:3", master: "77:7", componentKey: "abc123" }]);
  assert.deepEqual(textNodes(lib, "50:3").map((t) => t.text), ["Подписать", "Отклонить"]);
  assert.equal(findNodes(lib, "отклон")[0].frame.id, "50:3");
});

test("tree node budget fails fast instead of building a huge response", () => {
  assert.throws(() => selectTree(lib, "1:1", { maxNodes: 3 }), /more than 3 nodes/);
});
