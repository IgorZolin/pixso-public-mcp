#!/usr/bin/env node
// Minimal read-only MCP server for PUBLIC Pixso files. Zero dependencies:
// raw JSON-RPC 2.0 over stdio (newline-delimited). Node >= 22.15.
//
// Add to an MCP client (e.g. Claude Code):
//   claude mcp add pixso node /abs/path/to/pixso-mcp.mjs
//
// file_key may be a bare key or a full design URL; a URL's ?item-id= (selected
// layer) or ?page-id= scopes tree/text/svg unless `node` is given.

import { readFileSync } from "node:fs";
import { fetchDocument, getAccess, fileKeyOf, pageIdOf, itemIdOf } from "./pixso-fetch.mjs";
import { decodeDocument, summarize, selectTree, findNodes, textNodes, newStats, pagesOf, tokensOf, componentsOf, flowsOf, collapseRepeats } from "./pixso-kiwi.mjs";
import { documentSVG, iconize } from "./pixso-svg.mjs";
import { documentHTML } from "./pixso-html.mjs";

const VERSION = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;
const CACHE_MS = Number(process.env.PIXSO_CACHE_MS || 5 * 60_000);       // re-fetch a file after this
const MAX_CHARS = Number(process.env.PIXSO_MAX_RESPONSE || 400_000);      // ~100k tokens; bigger = useless to an LLM

// file_key -> {at, p: Promise<{access, doc, nodes}>}. One fetch+decode per file per CACHE_MS;
// concurrent calls share the in-flight promise. ponytail: unbounded map, add LRU if many files.
const cache = new Map();
function load(input) {
  const key = fileKeyOf(input);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.p;
  const p = fetchDocument(key).then(({ access, doc }) => ({ access, doc, nodes: decodeDocument(doc) }));
  cache.set(key, { at: Date.now(), p });
  p.catch(() => cache.delete(key)); // never cache failures
  return p;
}

const scope = (file_key, node) => node || itemIdOf(file_key) || pageIdOf(file_key) || null;
const MAX_NODES = Number(process.env.PIXSO_MAX_NODES || 20_000); // tree size guard before serializing
const int = (description) => ({ type: "integer", description });
const tidy = ({ missing, ...s }) => (missing?.length ? { ...s, missing } : s);
const UNRESOLVED = (n) => `${n} component instance(s) have no master in this file (library not loaded); only their own text overrides/properties are shown — see stats.missing`;
const FILE = { type: "string", description: "file key or full design URL (…/app/design/<key>?page-id=…&item-id=…)" };
const NODE = { type: "string", description: "optional node id (from pixso_find / URL item-id, incl. instance children like I1:2;3:4) or exact name; defaults to the URL's item-id, then page-id" };

const tools = {
  pixso_file_info: {
    description: "Metadata for a public Pixso file (name, public_access, permission). Fast: does not download the document.",
    inputSchema: { type: "object", properties: { file_key: FILE }, required: ["file_key"] },
    async run({ file_key }) {
      const a = await getAccess(fileKeyOf(file_key));
      return { name: a.name, public_access: a.public_access, tourist_access: a.tourist_access, permission: a.permission ?? a.real_level, folder_id: a.folder_id, team_id: a.team_id };
    },
  },
  pixso_pages: {
    description: "Table of contents of a public Pixso file: pages with their top-level frames {id, name, type, w, h, section?}. Start here on a big file, then pass a frame id as `node` to the other tools.",
    inputSchema: { type: "object", properties: { file_key: FILE, limit: int("max frames listed per page (default 200)") }, required: ["file_key"] },
    async run({ file_key, limit = 200 }) {
      const { access, nodes } = await load(file_key);
      const pages = pagesOf(nodes).map((p) => p.frames.length > limit ? { ...p, frames: p.frames.slice(0, limit), truncated: true } : p);
      return { name: access.name, pages };
    },
  },
  pixso_tree: {
    description: "Nested layer tree (page -> frame -> children, ordered) with CSS-ready properties: id, type, name, x/y/w/h, rotation, fills (solid hex, gradients with angle, images), strokes (align, dash, per-side widths), cornerRadius (or [tl,tr,br,bl]), effects, opacity, clipsContent; text: text, fontFamily/fontWeight/italic/fontSize, lineHeight, letterSpacing, textAlign, textResize, runs (mixed styling); autoLayout {mode, gap, padding, justify, align, wrap, width/height hug|fixed} and child layoutGrow/alignSelf/position. Vectors carry `svg` (exact outline); small vector-only groups/instances (icons) are collapsed into one `svg`. Component INSTANCEs are expanded from their master (`component` = master name). Hidden layers skipped. Use `node` for one subtree and `depth` to cap nesting (deeper levels become childCount).",
    inputSchema: { type: "object", properties: { file_key: FILE, node: NODE, depth: int("optional max nesting depth below the selected node (0 = node only)"), include_hidden: { type: "boolean", description: "also return hidden (visible=false) layers" }, icons: { type: "boolean", description: "collapse small vector-only groups/instances into one `svg` (default true)" }, repeats: { type: "boolean", description: "collapse runs of 5+ look-alike siblings (lists, tables) into the first 3 + a REPEAT node with the others' texts (default true)" } }, required: ["file_key"] },
    async run({ file_key, node, depth, include_hidden, icons, repeats }) {
      const { nodes } = await load(file_key);
      const sel = scope(file_key, node), stats = newStats();
      const tree = selectTree(nodes, sel, { depth, hidden: include_hidden, stats, maxNodes: MAX_NODES });
      if (icons !== false) iconize(tree);
      if (repeats !== false) collapseRepeats(tree);
      if (sel && !tree.length) throw new Error(`node "${sel}" not found (use pixso_find to get an id)`);
      return { tree, stats: tidy(stats) };
    },
  },
  pixso_text: {
    description: "All visible text of a page/frame/node in layer order, as a flat list [{id, text, path}] (path = names of enclosing layers/components). Instances are expanded. Cheapest way to read a screen's copy.",
    inputSchema: { type: "object", properties: { file_key: FILE, node: NODE }, required: ["file_key"] },
    async run({ file_key, node }) {
      const { nodes } = await load(file_key);
      const sel = scope(file_key, node), stats = newStats();
      const texts = textNodes(nodes, sel, { stats });
      if (sel && !texts.length && !stats.nodes) throw new Error(`node "${sel}" not found (use pixso_find to get an id)`);
      return { count: texts.length, ...(stats.unresolved && { warning: UNRESOLVED(stats.unresolved), missing: stats.missing }), texts };
    },
  },
  pixso_tokens: {
    description: "Design tokens used in a page/frame/node (instances expanded), with usage counts: colors (with roles fill/text/stroke), text styles (font, weight, size, line height, letter spacing, colors, sample text), fonts, radii, shadows, blurs, auto-layout gaps and paddings, stroke widths, gradients. Use it to define CSS variables / a theme before building components.",
    inputSchema: { type: "object", properties: { file_key: FILE, node: NODE }, required: ["file_key"] },
    async run({ file_key, node }) {
      const { nodes } = await load(file_key);
      const sel = scope(file_key, node), stats = newStats();
      const tokens = tokensOf(nodes, sel, { stats });
      if (sel && !stats.nodes) throw new Error(`node "${sel}" not found (use pixso_find to get an id)`);
      return { ...tokens, ...(stats.unresolved && { warning: UNRESOLVED(stats.unresolved) }) };
    },
  },
  pixso_components: {
    description: "Components used in a page/frame/node (nested ones included), grouped by component set: name, count, instance ids, variant values used (e.g. State: [Default, Hover]) and component property values shown (texts, booleans, swapped components). Use it to map the design onto existing UI-kit components instead of rebuilding them; `unresolved` lists instances whose master is not in the file.",
    inputSchema: { type: "object", properties: { file_key: FILE, node: NODE }, required: ["file_key"] },
    async run({ file_key, node }) {
      const { nodes } = await load(file_key);
      const sel = scope(file_key, node), stats = newStats();
      const res = componentsOf(nodes, sel, { stats });
      if (sel && !stats.nodes) throw new Error(`node "${sel}" not found (use pixso_find to get an id)`);
      return { count: res.components.length, ...res };
    },
  },
  pixso_flows: {
    description: "Prototype map of a page/frame (or the whole file): every interaction {from {id, name, frame}, on (click/hover/…), action (navigate/overlay/swap/back/url/scroll_to/…), to {id, name}, url, transition}, plus flow starting points. Use it for routing, links, modals and hover states.",
    inputSchema: { type: "object", properties: { file_key: FILE, node: NODE, limit: int("max links (default 300)") }, required: ["file_key"] },
    async run({ file_key, node, limit = 300 }) {
      const { nodes } = await load(file_key);
      const sel = scope(file_key, node), stats = newStats();
      const res = flowsOf(nodes, sel, { stats });
      if (sel && !stats.nodes) throw new Error(`node "${sel}" not found (use pixso_find to get an id)`);
      return { ...res, links: res.links.slice(0, limit), ...(res.links.length > limit && { truncated: true }) };
    },
  },
  pixso_find: {
    description: "Find nodes whose NAME or TEXT contains `query` (case-insensitive), instances included. Returns {id, type, name, text?, frame} — frame is the top-level frame it sits in. Use the id with pixso_tree / pixso_text / pixso_svg.",
    inputSchema: { type: "object", properties: { file_key: FILE, query: { type: "string", description: "substring of layer name or text content" }, limit: int("max results (default 50)") }, required: ["file_key", "query"] },
    async run({ file_key, query, limit = 50 }) {
      const { nodes } = await load(file_key);
      const all = findNodes(nodes, query);
      return { count: all.length, matches: all.slice(0, limit), ...(all.length > limit && { truncated: true }) };
    },
  },
  pixso_html: {
    description: "HTML + CSS starting point for a frame/node (one self-contained document): auto layout -> flexbox (gap, padding, justify/align, hug/fill), other layers -> absolute positioning; fills/gradients, borders, radii, shadows, blur, rotation, clipping, full text styling (incl. mixed runs), icons as inline SVG, images as grey placeholders. Elements carry data-pixso-id; identical styles share a class. Refactor it into your components rather than shipping it as is.",
    inputSchema: { type: "object", properties: { file_key: FILE, node: NODE, fonts: { type: "boolean", description: "add a Google Fonts <link> for the used families (default true)" }, repeats: { type: "boolean", description: "collapse long lists to 3 items + an HTML comment with the rest's texts (default true)" } }, required: ["file_key"] },
    async run({ file_key, node, fonts, repeats }) {
      const { nodes } = await load(file_key);
      const stats = newStats();
      const { html, stats: st } = documentHTML(nodes, scope(file_key, node), { fonts: fonts !== false, repeats: repeats !== false, stats, maxNodes: MAX_NODES });
      return { stats: tidy({ ...st, instances: stats.instances, unresolvedInstances: stats.unresolved, missing: stats.missing }), ...(stats.unresolved && { warning: UNRESOLVED(stats.unresolved) }), html };
    },
  },
  pixso_svg: {
    description: "Preview SVG of a page/frame/node (instances expanded), drawn from the document data: vector/icon outlines and text glyph outlines are exact; fills, gradients, strokes, radii, shadows/blur, clipping and rotation are reconstructed; images are grey placeholders. Also the way to export an icon: pass its node id. `stats` says what was exact (glyphTexts, paths) vs approximated (vectorsAsBoxes, imagePlaceholders, unresolvedInstances).",
    inputSchema: { type: "object", properties: { file_key: FILE, node: NODE }, required: ["file_key"] },
    async run({ file_key, node }) {
      const { nodes } = await load(file_key);
      const { svg, stats } = documentSVG(nodes, scope(file_key, node));
      return { stats: tidy(stats), ...(stats.unresolvedInstances && { warning: UNRESOLVED(stats.unresolvedInstances) }), svg };
    },
  },
  pixso_list_nodes: {
    description: "Flat, paged list of raw layers (instances NOT expanded): type, name, id, parent, bounds, fills, text… Filter by `type` (e.g. TEXT, FRAME, INSTANCE). Prefer pixso_tree/pixso_text for reading a screen.",
    inputSchema: { type: "object", properties: { file_key: FILE, type: { type: "string", description: "optional node type filter, e.g. TEXT" }, offset: int("start index (default 0)"), limit: int("page size (default 300)") }, required: ["file_key"] },
    async run({ file_key, type, offset = 0, limit = 300 }) {
      const { nodes } = await load(file_key);
      const want = type && String(type).toUpperCase();
      const all = want ? nodes.filter((n) => n.type === want) : nodes;
      const page = summarize(all.slice(offset, offset + limit));
      return { total: all.length, offset, count: page.length, ...(offset + limit < all.length && { next_offset: offset + limit }), nodes: page };
    },
  },
  pixso_raw_model: {
    description: "Decompressed binary document model (kiwi), base64, in byte slices. For clients that decode it themselves. Page with offset/next_offset.",
    inputSchema: { type: "object", properties: { file_key: FILE, offset: int("byte offset (default 0)"), length: int("slice size in bytes (default 200000)") }, required: ["file_key"] },
    async run({ file_key, offset = 0, length = 200_000 }) {
      const { doc } = await load(file_key);
      const end = Math.min(doc.length, offset + length);
      return { total_bytes: doc.length, offset, ...(end < doc.length && { next_offset: end }), base64: Buffer.from(doc.subarray(offset, end)).toString("base64") };
    },
  },
};

const HINT = {
  pixso_tree: "pass `node` (an id from pixso_find) and/or `depth`, or use pixso_text for just the copy",
  pixso_html: "pass `node` for a smaller frame",
  pixso_tokens: "pass `node`",
  pixso_components: "pass `node`",
  pixso_pages: "lower `limit`",
  pixso_flows: "pass `node` or lower `limit`",
  pixso_svg: "pass `node` for a single frame",
  pixso_list_nodes: "lower `limit` or filter by `type`",
  pixso_raw_model: "lower `length`",
  pixso_find: "use a more specific query or lower `limit`",
  pixso_text: "pass a narrower `node`",
};

async function callTool(name, args) {
  const t = tools[name];
  if (!t) return toolError(`unknown tool: ${name}`);
  try {
    const text = JSON.stringify(await t.run(args || {}));
    if (text.length > MAX_CHARS) return toolError(`response too large: ${text.length} chars (limit ${MAX_CHARS}, PIXSO_MAX_RESPONSE). Narrow it: ${HINT[name] || "pass `node`"}.`);
    return { content: [{ type: "text", text }] };
  } catch (e) {
    return toolError(e?.message || String(e));
  }
}
// Tool failures are results with isError (the model sees them); the process keeps running.
const toolError = (message) => ({ content: [{ type: "text", text: `Error: ${message}` }], isError: true });

// Sent in `initialize`; MCP clients pass it to the model as server guidance.
const INSTRUCTIONS = `Read-only access to PUBLIC Pixso design files. Every tool takes file_key: a key or a full design URL (…/app/design/<key>?page-id=…&item-id=…); without \`node\`, the URL's item-id (selected layer) or page-id scopes the result.
Workflow for implementing a design:
1. pixso_pages — table of contents (pages, top-level frames with ids and sizes).
2. pixso_find — locate a frame/layer by name or by visible text.
3. pixso_tokens(node) — colors, typography, spacing, radii, shadows, named styles and variables -> define the theme / CSS variables first.
4. pixso_components(node) — which UI-kit components (and variants/props) the screen uses -> reuse yours instead of rebuilding.
5. pixso_html(node) — HTML+CSS starting point (flexbox from auto layout, icons inline); pixso_tree(node, depth) — exact properties of any part; pixso_text(node) — just the copy.
6. pixso_flows(node) — navigation/interactions; pixso_svg(node) — look at the design or export an icon.
Long lists are collapsed to 3 items + a REPEAT node with the other items' texts. The document is downloaded once and cached; big files exceed response limits — always pass \`node\` (and \`depth\` for large frames).`;

// --- JSON-RPC 2.0 over stdio ---
function send(msg) {
  try { process.stdout.write(JSON.stringify(msg) + "\n"); }
  catch (e) { console.error("[pixso] write failed:", e.message); }
}
// Client closed our stdout: nothing more can be said, exit cleanly instead of an unhandled 'error'.
process.stdout.on("error", (e) => { console.error("[pixso] stdout:", e.code || e.message); if (e.code === "EPIPE") process.exit(0); });
process.on("uncaughtException", (e) => console.error("[pixso] uncaught:", e?.stack || e));
process.on("unhandledRejection", (e) => console.error("[pixso] unhandled rejection:", e?.stack || e));

async function handle(req) {
  const { method, params } = req;
  if (method === "initialize")
    return { protocolVersion: params?.protocolVersion || "2024-11-05", serverInfo: { name: "pixso", version: VERSION }, capabilities: { tools: {} }, instructions: INSTRUCTIONS };
  if (method === "ping") return {};
  if (method?.startsWith("notifications/")) return undefined; // no reply
  if (method === "tools/list")
    return { tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) };
  if (method === "tools/call") return callTool(params?.name, params?.arguments);
  throw { code: -32601, message: `unknown method: ${method}` };
}

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let req;
    try { req = JSON.parse(line); } catch { continue; }
    // each request handled independently: a slow fetch doesn't block ping/list
    handle(req).then(
      (result) => { if (result !== undefined && req.id !== undefined) send({ jsonrpc: "2.0", id: req.id, result }); },
      (e) => { if (req.id !== undefined) send({ jsonrpc: "2.0", id: req.id, error: e?.code ? e : { code: -32000, message: e?.message || String(e) } }); },
    );
  }
});
