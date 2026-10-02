# pixso-public-mcp

Unofficial, read-only [MCP](https://modelcontextprotocol.io) server that decodes
**public** [Pixso](https://pixso.net) design files into structured data for AI coding
agents (Claude Code, Cursor, OpenCode, …), so an agent can understand a design and
implement it as HTML/React/etc.

- **No login, no paid seat, no third-party relay** — reads files that the owner has
  shared publicly, over Pixso's own anonymous guest flow.
- **Zero runtime dependencies** — Node ≥ 22.15 built-ins only (`fetch`, `WebSocket`,
  `zlib` zstd).
- **Exact decode** — parses Pixso's real document format (kiwi) with the app's own
  schema, not heuristics.

> Not affiliated with or endorsed by Pixso. "Pixso" is a trademark of its owner.
> Works only for files the owner made public (`public_access` / `tourist_access`).
> See **[Legal](#legal)**.

## What you get

For each node: `type, name, x, y, w, h, fills, strokes, strokeWeight, cornerRadius,
opacity, effects (shadows/blur), background, text, fontSize, fontName, auto-layout,`
and a nested parent→child **tree**.

```jsonc
// pixso_tree (excerpt)
{ "type": "FRAME", "name": "WRAP", "w": 400, "h": 300, "fills": ["#ffffff"],
  "autoLayout": { "mode": "VERTICAL", "gap": 8, "padding": [16,16,16,16] },
  "children": [
    { "type": "RECTANGLE", "name": "BOX", "x": 16, "y": 16, "w": 200, "h": 100,
      "fills": ["#112233"], "strokes": ["#445566"], "strokeWeight": 4, "cornerRadius": 12,
      "effects": [{ "type": "DROP_SHADOW", "color": "#00000040", "x": 4, "y": 4, "blur": 10, "spread": 2 }] }
  ] }
```

## Install

```bash
git clone <this-repo> && cd pixso-public-mcp
npm install           # also fetches Pixso's schema (pixso.binary) via postinstall
# or fetch the schema manually:  npm run schema
```

Node 22.15+ required (built-in zstd + WebSocket).

## Use as an MCP server

```bash
# Claude Code
claude mcp add pixso node /abs/path/to/pixso-mcp.mjs
```

Tools (all take `file_key` — the id in `pixso.net/app/design/<file_key>`):

| tool | returns |
|------|---------|
| `pixso_file_info` | name, public flags, permission |
| `pixso_list_nodes` | flat list of decoded nodes |
| `pixso_tree` | nested layer tree (best for rebuilding UI) |
| `pixso_raw_model` | base64 of the decompressed document |

## Use from the CLI

```bash
# live (needs internet; anonymous)
node pixso-fetch.mjs <file_key> doc.bin
node pixso-kiwi.mjs doc.bin tree        # or: flat

# from a DevTools .har of the open public file (no token handling at all)
node pixso-har.mjs capture.har doc.bin
node pixso-kiwi.mjs doc.bin tree
```

## How it works

1. `GET api.pixso.net/api/pix/file/<key>/access` → anonymous guest token (only for public files).
2. `wss://api.pixso.net/ws/coop …` + `FileInit{LoadAll}` → the document streams back.
3. Frames are `zstd`-compressed **kiwi** (Figma's binary format). Decompress with Node's `zlib`.
4. Parse Pixso's compiled kiwi schema (`pixso.binary`) and decode the document
   (`PixsoMsg → PixsoNode[]`), then nest by `parentIndex`.

## Limitations

- Public files only. Login-only / corporate files are not accessible this way (use
  Pixso's enterprise Open API with admin credentials for those).
- Pinned to schema `v10.01`. If Pixso bumps it, re-run `npm run schema`.
- Not surfaced yet: gradient angle, image-fill asset URLs, layout constraints,
  per-character text styling.

## Legal

This tool reads **only** design files their owner has explicitly made public, using
Pixso's own public guest endpoint — the same data an anonymous browser receives.

- It bundles **no Pixso code or assets**. `pixso.binary` (Pixso's schema) is fetched
  from Pixso at install time and is **git-ignored**, not redistributed here.
- All decoding code is original (an independent reimplementation of the open
  [kiwi](https://github.com/evanw/kiwi) wire format).
- MIT-licensed (this project's code only).

Using it may still be subject to Pixso's Terms of Service (e.g. clauses on automated
access or reverse engineering). You are responsible for your own use. Provided
"as is", without warranty. Do not use it to access files you are not authorized to view.
