#!/usr/bin/env node
// Minimal read-only MCP server for PUBLIC Pixso files. Zero dependencies:
// raw JSON-RPC 2.0 over stdio (no SDK needed for 3 read tools). Node >= 22.15.
//
// Add to an MCP client (e.g. Claude Code):
//   claude mcp add pixso node /abs/path/to/pixso-mcp.mjs
//
// Tools:
//   pixso_file_info(file_key)  -> access metadata (name, public flags, permission)
//   pixso_list_nodes(file_key) -> ordered node names, fonts, counts, engine
//   pixso_raw_model(file_key)  -> base64 of the decompressed TLV model (for deeper tools)

import { fetchDocument, pageIdOf } from "./pixso-fetch.mjs";
import { decodeDocument, summarize, buildTree, selectTree, findNodes } from "./pixso-kiwi.mjs";
import { documentSVG } from "./pixso-svg.mjs";

const tools = {
  pixso_file_info: {
    description: "Metadata for a public Pixso file (name, public_access, permission). file_key is the id in /app/design/<file_key>.",
    inputSchema: { type: "object", properties: { file_key: { type: "string" } }, required: ["file_key"] },
    async run({ file_key }) {
      const { access } = await fetchDocument(file_key);
      const { name, public_access, tourist_access, permission, real_level, folder_id, team_id } = access;
      return { name, public_access, tourist_access, permission: permission ?? real_level, folder_id, team_id };
    },
  },
  pixso_list_nodes: {
    description: "Full node tree of a public Pixso file, decoded via the real kiwi schema: per node type, name, position {x,y}, size {w,h}, fills/strokes (hex), strokeWeight, cornerRadius, opacity, text, fontSize/fontName, auto-layout, and parent (guid) for hierarchy.",
    inputSchema: { type: "object", properties: { file_key: { type: "string" } }, required: ["file_key"] },
    async run({ file_key }) {
      const { doc } = await fetchDocument(file_key);
      const nodes = summarize(decodeDocument(doc));
      return { nodeCount: nodes.length, nodes };
    },
  },
  pixso_tree: {
    description: "Nested layer tree of a public Pixso file (page -> frame -> children, ordered), each node with id, type, name, bounds, fills/strokes, text, fontSize, auto-layout. Best for reconstructing UI. Pass `node` (any node's name or id from pixso_find — a frame, group, rectangle, text, etc.) to get ONLY that subtree — use it for big files instead of the whole document. If file_key is a full URL with ?page-id=…, that page's subtree is returned automatically unless `node` overrides it.",
    inputSchema: { type: "object", properties: { file_key: { type: "string" }, node: { type: "string", description: "optional node name or id (s:l) to return just that subtree — any type, not only frames" } }, required: ["file_key"] },
    async run({ file_key, node }) {
      const { doc } = await fetchDocument(file_key);
      const nodes = decodeDocument(doc);
      const sel = node || pageIdOf(file_key);
      return sel ? { tree: selectTree(nodes, sel) } : { tree: buildTree(nodes) };
    },
  },
  pixso_find: {
    description: "Find nodes by name in a public Pixso file (any type — frame, rectangle, text, group…) — returns a lightweight list of {id, type, name}. Use it to locate the node you want, then call pixso_tree with its id/name to pull only that subtree.",
    inputSchema: { type: "object", properties: { file_key: { type: "string" }, query: { type: "string", description: "substring of the node/frame name (case-insensitive)" } }, required: ["file_key", "query"] },
    async run({ file_key, query }) {
      const { doc } = await fetchDocument(file_key);
      const matches = findNodes(decodeDocument(doc), query);
      return { count: matches.length, matches };
    },
  },
  pixso_svg: {
    description: "Reconstructed preview SVG of a public Pixso file (or one node via `node`). Approximate render from the decoded data (rects, ellipses, text, fills incl. gradients, strokes, radius, drop-shadows) — a visual reference, not Pixso's official vector export. VECTOR/icon paths are drawn as boxes.",
    inputSchema: { type: "object", properties: { file_key: { type: "string" }, node: { type: "string", description: "optional node name or id to render just that subtree" } }, required: ["file_key"] },
    async run({ file_key, node }) {
      const { doc } = await fetchDocument(file_key);
      return { svg: documentSVG(decodeDocument(doc), node || pageIdOf(file_key)) };
    },
  },
  pixso_raw_model: {
    description: "Decompressed binary document model of a public Pixso file, base64-encoded. For clients that will parse the TLV themselves.",
    inputSchema: { type: "object", properties: { file_key: { type: "string" } }, required: ["file_key"] },
    async run({ file_key }) {
      const { doc } = await fetchDocument(file_key);
      return { bytes: doc.length, base64: Buffer.from(doc).toString("base64") };
    },
  },
};

// --- JSON-RPC 2.0 over stdio (newline-delimited) ---
const send = (msg) => process.stdout.write(JSON.stringify(msg) + "\n");

async function handle(req) {
  const { id, method, params } = req;
  if (method === "initialize")
    return { protocolVersion: "2024-11-05", serverInfo: { name: "pixso", version: "0.1.0" }, capabilities: { tools: {} } };
  if (method === "notifications/initialized") return undefined; // no reply
  if (method === "tools/list")
    return { tools: Object.entries(tools).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) };
  if (method === "tools/call") {
    const t = tools[params?.name];
    if (!t) throw { code: -32601, message: `unknown tool: ${params?.name}` };
    const result = await t.run(params.arguments || {});
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }
  throw { code: -32601, message: `unknown method: ${method}` };
}

let buf = "";
process.stdin.on("data", async (chunk) => {
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let req;
    try { req = JSON.parse(line); } catch { continue; }
    try {
      const result = await handle(req);
      if (result !== undefined && req.id !== undefined) send({ jsonrpc: "2.0", id: req.id, result });
    } catch (e) {
      if (req.id !== undefined) send({ jsonrpc: "2.0", id: req.id, error: e.code ? e : { code: -32000, message: e.message } });
    }
  }
});
