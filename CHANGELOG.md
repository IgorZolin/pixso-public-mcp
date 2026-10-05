# Changelog

All notable changes to this project are documented here. Format based on
[Keep a Changelog](https://keepachangelog.com/); versioning is [SemVer](https://semver.org/).

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
