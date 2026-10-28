// End-to-end coop fetch against a fake Pixso server (test/fake-pixso.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { decodeDocument, schemaPath } from "../pixso-kiwi.mjs";
import { fetchDocument, fileKeyOf } from "../pixso-fetch.mjs";
import { fakePixso } from "./fake-pixso.mjs";

test("coop fetch joins the session and merges edits newer than the checkpoint", { skip: !existsSync(schemaPath()) }, async () => {
  const log = [], server = await fakePixso(log), { port } = server.address();
  process.env.PIXSO_API = `http://127.0.0.1:${port}`; process.env.PIXSO_WS = `ws://127.0.0.1:${port}`;
  try {
    const url = `https://pixso.example.ru/app/design/Dzl3x3YIwVWviKChJqfkCA?item-id=3312%3A169453`;
    assert.equal(fileKeyOf(url), "Dzl3x3YIwVWviKChJqfkCA");
    const { doc, parts, meta } = await fetchDocument(url);
    assert.deepEqual(log, ["GET /api/pix/file/Dzl3x3YIwVWviKChJqfkCA/access", "WS /ws/coop", "FileInit", "JOIN_START session=3301 user=Гость"]);
    assert.equal(parts, 2, "document + node changes; presence and join acks are not kept");
    assert.deepEqual([meta.sessionID, meta.joined, meta.changes, meta.joinReply], [3301, true, 1, "JOIN_START_SKIP_RELOAD"]);
    const nodes = decodeDocument(doc), byId = (s, l) => nodes.find((n) => n.guid?.sessionID === s && n.guid?.localID === l);
    assert.equal(byId(3312, 169453)?.name, "icon/signature", "node from the newer session is present");
    assert.equal(byId(3302, 1).name, "Карточка v2", "partial change merged into the existing node");
    assert.equal(byId(3302, 1).type, "FRAME", "untouched fields kept");
  } finally { delete process.env.PIXSO_API; delete process.env.PIXSO_WS; server.close(); }
});
