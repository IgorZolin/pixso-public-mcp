# pixso-public-mcp

**English** · [Русский](README.ru.md)

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

CSS-ready properties per node:

- **box & paint** — `x, y, w, h, rotation`, `fills` (hex, gradients with `angle`/handles,
  images with hash), `strokes` (`strokeWeight`, `strokeAlign`, `dash`, per-side
  `borderWeights`), `cornerRadius` (number or `[tl, tr, br, bl]`), `effects`
  (shadows/blur), `opacity`, `blendMode`, `clipsContent`;
- **text** — `text`, `fontFamily`, `fontWeight`, `italic`, `fontSize`, `lineHeight`,
  `letterSpacing`, `textAlign`, `textResize` (hug / fixed-width / fixed),
  `textDecoration`, `textCase`, and `runs` for mixed styling inside one text;
- **layout** — `autoLayout {mode, gap, padding, justify, align, wrap, width/height:
  hug|fixed}` on containers and `layoutGrow` / `alignSelf` / `position` on children
  (flexbox terms), `constraints`;
- **vectors & icons** — every vector carries `svg`: its exact outline from the
  document's geometry, ready to inline. Small vector-only groups/instances (icons) are
  collapsed into one `svg`;
- **components** — instances are expanded from their master (overrides, text/boolean/
  swap properties, per-instance layout applied), tagged with `component`;
- **design system** — named styles (`fillStyle`, `textStyle`, `strokeStyle`, `effectStyle`)
  and variables (`fills[].var`, `vars: {gap: "space/12"}`) with values per mode;
- **prototype** — `interactions` (click/hover → navigate/overlay/back/url…), `scroll`.

```jsonc
// pixso_tree (excerpt)
{ "type": "FRAME", "name": "card", "w": 360, "h": 120, "fills": ["#ffffff"], "cornerRadius": 12,
  "clipsContent": true,
  "autoLayout": { "mode": "horizontal", "gap": 12, "padding": [16,16,16,16], "align": "center", "width": "fixed", "height": "hug" },
  "children": [
    { "type": "INSTANCE", "name": "Icon 3", "component": "icon/download", "w": 24, "h": 24,
      "iconLayers": 2, "svg": "<svg viewBox=\"0 0 24 24\" …><path d=\"M4 2L20 2L12 16Z\" fill=\"#112233\"/>…</svg>" },
    { "type": "TEXT", "text": "Требуется согласование", "fontFamily": "Inter", "fontWeight": 600,
      "fontSize": 16, "lineHeight": 24, "fills": ["#1d2129"], "layoutGrow": 1 }
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

Tools take `file_key` **or a full design URL** (`pixso.net/app/design/<file_key>`):

| tool | returns |
|------|---------|
| `pixso_file_info` | name, public flags, permission (fast — no document download) |
| `pixso_pages(limit?)` | table of contents: pages and their top-level frames `{id, name, w, h, section}` |
| `pixso_find(query, limit?)` | nodes whose **name or text** contains `query`: `{id, type, name, text, frame}` |
| `pixso_text(node?)` | all visible text of a page/frame in layer order: `{id, text, path}` — cheapest way to read a screen |
| `pixso_tree(node?, depth?, flat?, include_hidden?, icons?, repeats?)` | nested layer tree, instances expanded, icons as `svg`, long lists collapsed; nesting cut at 10 by default (deeper → `childCount`, drill down by id); `flat: true` → flat list with `parent`/`depth` |
| `pixso_html(node?, fonts?, repeats?)` | **HTML + CSS starting point**: flexbox from auto layout, absolute positioning otherwise, full styling, inline SVG icons, CSS variables for named colors, `data-pixso-id` / `data-component` / `data-action` |
| `pixso_tokens(node?)` | design tokens with usage counts: colors (roles, style/variable names), text styles, fonts, radii, shadows, gaps, paddings, gradients, variables per mode |
| `pixso_components(node?)` | components used (incl. nested), grouped by set: count, instance ids, variant values, property values; unresolved masters |
| `pixso_flows(node?, limit?)` | prototype map: `{from, on, action, to, url, transition}` per interaction + flow start points |
| `pixso_svg(node?)` | preview SVG: exact vector and text-glyph outlines, reconstructed fills/strokes/shadows/clipping; also how to export an icon. `stats` says what is exact |
| `pixso_list_nodes(type?, offset?, limit?)` | flat, paged list of raw layers (instances not expanded) |
| `pixso_raw_model(offset?, length?)` | base64 of the decompressed document, in slices |

`node` is an id (from `pixso_find`, or the URL's `item-id`; instance children look like
`I3119:319053;12:34`) or an exact layer name. Without `node`, a URL's `?item-id=` (the selected layer) or
`?page-id=` scopes `pixso_tree` / `pixso_text` / `pixso_svg`.

Typical flow for implementing a screen: `pixso_pages` → `pixso_find` → `pixso_tokens(node)` (theme) →
`pixso_components(node)` (reuse your UI kit) → `pixso_html(node)` / `pixso_tree(node, depth)` →
`pixso_flows` for navigation, `pixso_svg(node)` to look or to export an icon. The server sends this
workflow to the client as MCP `instructions`.

Runs of 5+ look-alike siblings (list rows, table rows, cards) are collapsed to the first 3 plus a
`REPEAT` node `{repeated, like, ids, items}` carrying the other items' texts — a 300-row table costs
3 rows + data.
The downloaded document is cached for 5 minutes, so follow-up calls are instant.

### Settings (environment)

| variable | default | |
|----------|---------|-|
| `PIXSO_WAIT_MS` | `60000` | max wait for the document over the websocket |
| `PIXSO_CACHE_MS` | `300000` | how long a downloaded file is reused |
| `PIXSO_MAX_RESPONSE` | `400000` | max tool response (chars); larger → error asking to narrow with `node`/`depth` |
| `PIXSO_MAX_NODES` | `20000` | max nodes `pixso_tree` builds before asking to narrow |
| `PIXSO_ICON_MAX` | `96` | max icon size (px) collapsed into one `svg` in `pixso_tree` |
| `PIXSO_DEBUG` | — | `1` logs websocket frames to stderr |
| `PIXSO_DEFAULT_DEPTH` | `10` | `pixso_tree` nesting when `depth` is not given |
| `PIXSO_JOIN` | `1` | `0` = don't join the coop session (no edits newer than the saved copy) |
| `PIXSO_API` / `PIXSO_WS` / `PIXSO_SCHEMA_URL` | from the link | self-hosted Pixso; API/WS are taken from the link's host automatically |

Every tool that downloads the document accepts `fresh: true` to bypass the cache.

### Self-hosted / corporate Pixso

Pass the file as a full link — `https://pixso.your-company.ru/app/design/<key>?item-id=…` —
and the server talks to that host (`https://` + `wss://` same origin). Set `PIXSO_API` /
`PIXSO_WS` only if your install uses other hosts. Fetch the schema of that install once:
`PIXSO_SCHEMA_URL=https://pixso.your-company.ru/app/pixso.binary npm run schema`.

## Use from the CLI

```bash
# live (needs internet; anonymous)
node pixso-fetch.mjs <file_key|url> doc.bin
node pixso-kiwi.mjs doc.bin tree          # or: flat | find <q> | node <name|id> | text [node]
                                          #     pages | tokens [node] | components [node] | flows [node]
node pixso-svg.mjs  doc.bin "Checkout" > out.svg
node pixso-html.mjs doc.bin "Checkout" > out.html

# from a DevTools .har of the open public file (no token handling at all)
node pixso-har.mjs capture.har doc.bin
node pixso-kiwi.mjs doc.bin tree
```

## How it works

1. `GET api.pixso.net/api/pix/file/<key>/access` → anonymous guest token (only for public files).
2. `wss://api.pixso.net/ws/coop …` + `FileInit{LoadAll}` → the saved document (`FIC_DOCUMENT`)
   streams back; then a `JOIN_START` (what the web viewer sends) makes the server deliver edits
   newer than the saved copy (`NODE_CHANGES`). For a moment a guest viewer appears in the file,
   as when someone opens the public link.
3. Frames are `zstd`-compressed **kiwi** (Figma's binary format). Decompress with Node's `zlib`.
4. Parse Pixso's compiled kiwi schema (`pixso.binary`) and decode the document
   (`PixsoMsg → PixsoNode[]`), then nest by `parentIndex`.

## Limitations

- Public files only. Login-only / corporate files are not accessible this way (use
  Pixso's enterprise Open API with admin credentials for those).
- Pinned to schema `v10.01`. If Pixso bumps it, re-run `npm run schema`.
- Library vectors without stored outline geometry are rebuilt from their vector network
  (fills by region, strokes as SVG strokes; arrowhead caps are not drawn).
- Instances resolve only when the master is in the file (local components, and
  library components Pixso copies into the file). Otherwise the instance's own text
  (overrides, property values) is still returned, and `stats.missing` / `warning`
  name the missing masters.
- Images: only a hash and size — image bytes are not in the document stream, so
  `pixso_svg` draws grey placeholders.
- `rotation` is in CSS degrees around the node's `x, y` (its rotated top-left corner).
- Text overridden in an instance without a stored glyph layout is drawn with `<text>`
  (no wrapping) in `pixso_svg`; the data in `pixso_tree` is unaffected.
- Masks and boolean-operation children are not composited in `pixso_svg` (the boolean's
  result outline is drawn).
- `pixso_html` is a scaffold: flexbox mirrors auto layout, but non-auto-layout frames are
  absolutely positioned; fonts are linked from Google Fonts by family name.
- Named styles / variables from a library resolve only if Pixso copied their definitions
  into the file.

## Troubleshooting

- **First call times out in the client** — big files take a while to stream; raise the
  client's MCP timeout (OpenCode: `"timeout": 120000`) and/or `PIXSO_WAIT_MS`.
- **`node "…" not found` / "comes from editing session N, but the newest session is M"** — the
  layer is newer than what the server delivered (the designer's edits aren't in the server's copy
  yet). Retry later with `fresh: true`; `pixso_file_info` shows `modified` and the loaded copy's
  newest session.
- **Old Node** — the server exits with "needs Node.js >= 22.15"; point the MCP command at a newer
  `node` (the system Node may be older than the one in your shell).
- **Client rejects deep JSON** (e.g. "max depth 32") — `pixso_tree` cuts nesting at 10 by default;
  use `flat: true` for a flat list.
- **OpenCode: tools gone after reconnecting the server** (`Unknown tool`, empty search)
  — the client's tool catalog didn't refresh; restart the OpenCode session.

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
