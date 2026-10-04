# Changelog

All notable changes to this project are documented here. Format based on
[Keep a Changelog](https://keepachangelog.com/); versioning is [SemVer](https://semver.org/).

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
