# Changelog

All notable changes to this project are documented here. Format based on
[Keep a Changelog](https://keepachangelog.com/); versioning is [SemVer](https://semver.org/).

## [0.5.0] — 2026-10-27

From design data to code: overview, theme, components, HTML and navigation.

### Added
- **`pixso_html(node)`** — HTML + CSS scaffold of a frame: auto layout → flexbox (gap,
  padding, justify/align, wrap, hug/fill children), other layers → absolute positioning;
  backgrounds/gradients, borders (inside/outside/per side/dashed), radii, shadows, blur,
  backdrop blur, rotation, clipping/scrolling, full text styling with mixed runs, icons
  as inline SVG, image placeholders, CSS custom properties for colors bound to variables
  or named styles, `data-pixso-id` / `data-component` / `data-action`. Same base name +
  same style → one class. Verified visually against `pixso_svg`.
- **`pixso_tokens(node)`** — palette with roles and style/variable names, text styles
  with samples, fonts and weights, radii, shadows, blurs, gaps, paddings, stroke widths,
  gradients, and the variables used with their values per mode.
- **`pixso_components(node)`** — component inventory grouped by set: count, instance
  ids, variant values, component-property values; unresolved masters.
- **`pixso_flows(node)`** — prototype map (click/hover/… → navigate/overlay/swap/back/
  url/scroll_to, target frame, transition) and flow starting points. Nodes carry
  `interactions`, `scroll`, `fixedOnScroll`.
- **`pixso_pages`** — table of contents: pages and top-level frames (sections listed).
- **Named styles and variables** on nodes: `fillStyle`, `textStyle`, `strokeStyle`,
  `effectStyle`; paints bound to a variable get `var`; bound numbers in `vars`.
- **Long lists collapse** in `pixso_tree` / `pixso_html`: 5+ look-alike siblings → first
  3 + a `REPEAT` node with the remaining items' texts (a 300-row screen: 1.68M → 68k chars).
- MCP `instructions` in `initialize`: the recommended tool workflow for the agent.
- CLI modes `pages`, `tokens`, `components`, `flows`; `pixso-html.mjs` CLI.

### Fixed
- An INSTANCE now inherits its master's own properties (fills, radius, auto layout,
  effects, interactions…) for fields it does not set itself — instance roots rendered
  without their background before.

### Changed
- Tree walks ~3× faster and lighter (lazy instance-child ids, early exits when an
  instance has no overrides, shared ancestor stack): on a 60k-node document with ~300k
  expanded nodes, whole-file search 1.0s → 0.35s, heap 142 → 79 MB.

## [0.4.0] — 2026-10-26

Fixes from a real-world review on a large component-based file.

### Added
- **Component instances are expanded.** `INSTANCE` children are built from the master
  `SYMBOL` (incl. library masters copied into the file) with `symbolOverrides` by
  `guidPath`, nested instances, instance swaps, component properties (text / boolean
  visibility / instance swap, defaults from the master or variant set) and
  `derivedSymbolData` sizes. Instances carry `component` (master name); their children
  get ids like `I<instance>;<node>` and can be passed as `node`. Override paths are
  matched by both `overrideKey` and `guid`; `componentPropRef` by enum or numeric field.
- If an instance's master is not in the file, its own text (overrides, component
  property values, derived data) is still returned as pseudo-children, the node gets
  `unresolvedMaster`, and `stats.missing` lists master ids / `componentKey` / library.
- **Vectors and icons.** Geometry blobs are decoded: every vector (and boolean op,
  star, line, polygon, arc) gets `svg` — its exact outline, ready to inline. Small
  vector-only groups/instances (≤ `PIXSO_ICON_MAX`, default 96px) collapse into one
  `svg` in `pixso_tree` (`icons: false` to keep layers).
- **Text styling**: `fontFamily`, `fontWeight` (from font metadata or style name),
  `italic`, `fontSize` (falls back to glyph size when the node has none), `lineHeight`
  (px / % / measured), `letterSpacing` (px / em), `textAlign`, `verticalAlign`,
  `textResize`, `textDecoration`, `textCase`, `paragraphSpacing`, `truncate`, links,
  and `runs` for mixed styles.
- **Layout & box**: auto layout in flexbox terms (`justify`, `align`, `wrap`, `rowGap`,
  hug/fixed `width`/`height`; child `layoutGrow`, `alignSelf`, `position`),
  `constraints`, `min`/`max`, `rotation`, per-corner `cornerRadius`, `cornerSmoothing`,
  `strokeAlign`, `dash`, per-side `borderWeights`, `strokeCap`/`strokeJoin`,
  `blendMode`, `mask`, `clipsContent`; gradients get handle positions and CSS `angle`;
  image fills report `scaleMode`, `hash`, `imageSize`.
- **`pixso_svg` is much closer to the design**: exact vector outlines and text drawn
  from the document's glyph outlines (no fonts needed), rotation/flip via matrix,
  gradient direction, multiple fills, inside/outside strokes, per-side borders,
  per-corner radii, frame clipping, layer blur, blend modes, image placeholders.
  `stats` reports `glyphTexts`, `paths`, `imagePlaceholders`, `masksSkipped`.
- **`pixso_text(node?)`** — all visible text of a page/frame in layer order with a
  readable `path`.
- `pixso_find` matches **text content** as well as names, searches inside instances,
  returns the enclosing top-level `frame`, and has `limit`.
- `pixso_tree`: `depth` (deeper levels become `childCount`), `include_hidden`; hidden
  layers are skipped by default; returns `stats`.
- `pixso_svg` returns `stats` (rendered, texts, instances, unresolvedInstances,
  hiddenSkipped, vectorsAsBoxes) and a `warning` when instances could not be resolved.
- `pixso_list_nodes`: `type` filter and `offset`/`limit` paging. `pixso_raw_model`:
  byte slices with `offset`/`length`.
- All zstd payloads of the coop stream are kept (not just the largest) and merged by
  guid on decode (`phase: REMOVED` honoured) — documents or component data that arrive
  in several messages are no longer dropped. Multi-payload `doc.bin` files use a small
  `PXDOCS` container; single-payload files are unchanged.
- A URL's `item-id` (layer selected in Pixso) scopes tree/text/svg; it takes precedence
  over `page-id`.
- Document cache per file (`PIXSO_CACHE_MS`, default 5 min): one download per file
  instead of one per call; concurrent calls share it.
- `npm test` (node:test) for instance expansion.

### Fixed
- **Server crashed on big responses** (`EPIPE`, unhandled `'error'`, process exit; client
  then reported "not connected"). Responses are now compact JSON capped by
  `PIXSO_MAX_RESPONSE` (default 400k chars) — oversize returns an error that says how to
  narrow it; `pixso_tree` also stops early above `PIXSO_MAX_NODES` (default 20000)
  instead of building a huge tree. Tool failures are returned as `isError` results; stdout errors and
  uncaught exceptions no longer kill the process.
- Misleading `no document frame received (file may not be public…)`: fetch errors now
  say what happened — server rejection (with its reason), socket closed (code/reason),
  or timeout (seconds, frames and bytes received). Default wait raised 20s → 60s.
- `pixso_svg` on a page (size-less `CANVAS`) produced a `0×0` viewBox.
- `pixso_file_info` no longer downloads the whole document.

### Changed
- Node keys are CSS-oriented: `fontName` → `fontFamily` (+ `fontWeight`, `italic`);
  `autoLayout.mode` is lower-case and alignment/sizing are included.
- Tool responses are compact (no pretty-print indentation) — about half the tokens.
- `opencode.example.jsonc`: `timeout` 120000.
- `initialize` echoes the client's protocol version; `ping` supported; server version
  read from `package.json`.

## [0.3.0] — 2026-10-15

### Added
- **Auto-scope by `page-id`.** When `file_key` is a full design URL containing
  `?page-id=<s:l>` (e.g. `…/design/<key>?page-id=27:1`, url-encoded `27%3A1` too),
  `pixso_tree` and `pixso_svg` now return just that page's subtree automatically.
  An explicit `node` argument still overrides it. New `pageIdOf()` export.
  (A page is a `CANVAS` node and `selectTree` already matched by id, so this just
  wires the URL's page-id through as the default scope.)

## [0.2.2] — 2026-10-05

### Fixed
- **Live fetch returned no document (`no document frame received`).** The coop
  `FileInit` command was sent as raw text / a bare `FileInit{…}` binary frame. The
  server rejects text frames (close `1003`) and fails to decode a bare payload
  (`COOP ERROR / data decode failed`). It is a framed binary message —
  `01 05 0e "FileInit"\0 0f <json>\0 12 00 00 00` (tag-prefixed, null-terminated
  strings) — now built by `frameFileInit()`, byte-verified against browser captures.
- `check_schema_version` now defaults to `false` (opt back in with
  `PIXSO_CHECK_SCHEMA=1`) so a lagging `PIXSO_SCHEMA` constant can't block the load.

### Added
- `PIXSO_DEBUG=1` prints the websocket handshake to stderr (frames, sizes, zstd
  offsets, server errors) for diagnosing fetch failures.

## [0.2.1] — 2026-10-05

### Fixed
- **Windows: CLI did nothing.** The `node pixso-*.mjs …` entry points used a
  POSIX-only main-module check (`import.meta.url === "file://" + argv[1]`) that never
  matched on Windows, so the scripts exited silently. Now cross-platform via
  `pathToFileURL`. (The MCP server itself was unaffected.)
- Clearer `/access` errors: non-JSON / blocked / wrong-host responses now report the
  HTTP status and a body snippet instead of a cryptic `Unexpected token` parse error.

### Changed
- Websocket fetch is event-driven: resolves shortly after the document arrives (handles
  slow ~10s+ loads) with a hard cap, instead of a fixed 8s wait. Tunable via
  `PIXSO_WAIT_MS` / `PIXSO_QUIET_MS`. `opencode.example.jsonc` sets `timeout: 30000`.

## [0.2.0] — 2026-10-04

### Added
- **`pixso_find(file_key, query)`** — locate nodes by name; returns a lightweight
  `{id, type, name}` list (any node type, not just frames).
- **Subtree scoping** — `pixso_tree(file_key, node)` returns only the subtree for a
  given node **name or id**, so big files don't have to be dumped whole.
- **`pixso_svg(file_key, node?)`** — reconstructed preview SVG from the decoded data
  (rects, ellipses, text, solid/gradient fills, strokes, corner radius, drop-shadows,
  opacity). Approximate visual reference, not Pixso's official vector export.
- Each node now carries an **`id`** (`sessionID:localID`) for addressing.
- Accept a **full design URL** anywhere a `file_key` is expected.
- New module `pixso-svg.mjs`; CLI modes `find` / `node` for `pixso-kiwi.mjs`.

### Changed
- `pixso_tree` / `pixso_find` work on any node type (frame, group, rectangle, text…),
  clarified in tool descriptions and README (EN/RU).

## [0.1.0] — 2026-10-02

### Added
- Read-only MCP server for **public** Pixso files, anonymous (no login / seat / relay),
  zero runtime dependencies (Node ≥ 22.15).
- Decode pipeline: `/access` guest token → `ws/coop` → zstd → kiwi, using Pixso's real
  schema (`pixso.binary`, fetched at install, not bundled).
- Tools: `pixso_file_info`, `pixso_list_nodes`, `pixso_tree`, `pixso_raw_model`.
- Per-node decode: type, name, position, size, fills/strokes (hex), strokeWeight,
  cornerRadius, opacity, effects (shadow/blur), background, text, fontSize/fontName,
  auto-layout; nested tree via `parentIndex`.
- CLI (`pixso-fetch.mjs`, `pixso-kiwi.mjs`) and `.har` input (`pixso-har.mjs`).
- Configurable host (`PIXSO_API` / `PIXSO_WS` / `PIXSO_SCHEMA_URL`) for self-hosted Pixso.
