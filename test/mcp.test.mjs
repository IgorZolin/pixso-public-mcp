// The MCP server end to end over stdio, against the fake Pixso server.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { schemaPath } from "../pixso-kiwi.mjs";
import { fakePixso } from "./fake-pixso.mjs";

test("MCP: link parsing, join edits, not-found reason, fresh, flat, file_info", { skip: !existsSync(schemaPath()) }, async () => {
  const log = [], server = await fakePixso(log), { port } = server.address();
  const proc = spawn(process.execPath, [new URL("../pixso-mcp.mjs", import.meta.url).pathname], {
    env: { ...process.env, PIXSO_API: `http://127.0.0.1:${port}`, PIXSO_WS: `ws://127.0.0.1:${port}` }, stdio: ["pipe", "pipe", "inherit"] });
  let buf = "", id = 0; const waiting = new Map();
  proc.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); waiting.get(m.id)?.(m); } });
  const rpc = (method, params) => new Promise((r) => { const n = ++id; waiting.set(n, r); proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: n, method, params }) + "\n"); });
  const call = async (name, args) => { const r = (await rpc("tools/call", { name, arguments: args })).result; return { error: r.isError ? r.content[0].text : null, data: r.isError ? null : JSON.parse(r.content[0].text) }; };
  try {
    const init = (await rpc("initialize", {})).result;
    assert.match(init.instructions, /pixso_pages/);
    const { tools } = (await rpc("tools/list")).result;
    assert.equal(tools.length, 12);
    assert.ok(tools.find((t) => t.name === "pixso_tree").inputSchema.properties.fresh, "doc tools accept `fresh`");

    const url = "https://pixso.corp.example/app/design/Dzl3x3YIwVWviKChJqfkCA?item-id=3312%3A169453";
    const t = await call("pixso_tree", { file_key: url });
    assert.equal(t.error, null);
    assert.deepEqual([t.data.tree[0].id, t.data.tree[0].name], ["3312:169453", "icon/signature"], "node from the live edits, scoped by item-id");

    const missing = await call("pixso_text", { file_key: url, node: "3999:1" });
    assert.match(missing.error, /editing session 3999, but the newest session in the loaded document is 3312/);

    const flat = await call("pixso_tree", { file_key: url, node: "0:1", flat: true });
    assert.deepEqual(flat.data.nodes.map((n) => [n.id, n.parent ?? null, n.depth]), [["0:1", null, 0], ["3302:1", "0:1", 1], ["3312:169453", "3302:1", 2]]);

    const info = await call("pixso_file_info", { file_key: url });
    assert.deepEqual([info.data.loaded.nodes, info.data.loaded.newestSession, info.data.loaded.joined, info.data.loaded.liveChanges], [4, 3312, true, 1]);

    const downloads = () => log.filter((l) => l === "FileInit").length;
    assert.equal(downloads(), 1, "cached across calls");
    await call("pixso_pages", { file_key: url, fresh: true });
    assert.equal(downloads(), 2, "fresh re-downloads");
  } finally { proc.kill(); server.close(); }
});
