// Document packing/merging and URL parsing. The merge test needs Pixso's schema
// (pixso.binary, fetched by `npm install`) and is skipped without it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { packParts, unpackParts, fileKeyOf, pageIdOf, itemIdOf } from "../pixso-fetch.mjs";
import { decodeDocument, schemaPath } from "../pixso-kiwi.mjs";

test("URL parsing", () => {
  const u = "https://pixso.net/app/design/Dzl3x3YIwVWviKChJqfkCA?page-id=3098%3A1&item-id=3098:42893";
  assert.equal(fileKeyOf(u), "Dzl3x3YIwVWviKChJqfkCA");
  assert.equal(pageIdOf(u), "3098:1");
  assert.equal(itemIdOf(u), "3098:42893");
  assert.equal(itemIdOf("Dzl3x3YIwVWviKChJqfkCA"), null);
});

test("pack/unpack round trip; single payload stays raw", () => {
  const a = Buffer.from("one"), b = Buffer.from("second");
  assert.equal(packParts([a]), a);
  assert.deepEqual(unpackParts(packParts([a, b])).map(String), ["one", "second"]);
  assert.deepEqual(unpackParts(a).map(String), ["one"]);
});

const sample = new URL("../samples/rich.bin", import.meta.url);
test("multi-payload document merges nodes by guid", { skip: !existsSync(schemaPath()) || !existsSync(sample) }, () => {
  const doc = readFileSync(sample);
  const one = decodeDocument(doc);
  const merged = decodeDocument(packParts([doc, Buffer.from("not a pixso message"), doc]));
  assert.equal(merged.length, one.length);
});
