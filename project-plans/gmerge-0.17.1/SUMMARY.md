# Sync Summary: gemini-cli v0.17.1

**Branch**: `gmerge/0.17.1`
**Upstream Range**: `v0.16.0..v0.17.1`
**LLxprt Version**: 0.9.0 (unchanged)
**Total Upstream Commits**: 45
**Date Range**: 2025-11-13 to 2025-11-22

## Decision Summary

| Decision    | Count | Percentage |
|-------------|-------|------------|
| PICK        | 7     | 16%        |
| SKIP        | 31    | 69%        |
| REIMPLEMENT | 7     | 16%        |

## What's in This Sync

### Major upstream event: Gemini 3 Launch

The dominant commit is `86828bb5` — 79 files, 3147 insertions. Most is Gemini-specific (model routing, Pro quota, flash fallback, Banner, experiments). LLxprt extracts only the universally useful pieces: ModelNotFoundError, Antigravity editor/IDE support, model resolution helpers, previewFeatures setting, and 404 error classification.

### Key PICKs

- **MCP rework** (`8c78fe4f`) — Replaces `mcpToTool()` with direct MCP SDK calls, fixes `$defs`/`$ref` schema handling. Important MCP improvement.
- **Folder trust improvements** — Exit on failed trust save (`d683e1c0`), check trust before /add dir (`9786c4dc`), /permissions modification (`472e775a`)
- **NO_COLOR scrollbar fix** (`78a28bfc`) — LLxprt has the same bug (NoColorTheme sets colors to empty strings)
- **setupGithubCommand patch** (`cc0eadff`) — GitHub setup improvements

### Key REIMPLEMENTs

- **Show profile name on change** (`ab11b2c2`) — Upstream shows model via router; LLxprt reimplements as profile-name-on-change in chat history (more useful for multi-provider)
- **Right-click paste** (`8877c852`) — Adds clipboardy dep and mouse handler to InputPrompt for paste in alternate buffer mode
- **Terminal mode cleanup** (`ba88707b`) — Broader than upstream: test mocks + comprehensive exit cleanup (bracketed paste, focus reporting, cursor visibility) to fix known arrow-key issue
- **Extension multi-uninstall** (`7d33baab`) — Loop + error collection over LLxprt's standalone `uninstallExtension()` function
- **Gemini 3 extracts** (`86828bb5`) — Carefully scoped extraction of 7 useful sub-changes from the 79-file commit
- **Extension test coverage** (`638dd2f6`) — New tests for LLxprt's standalone function architecture (disable, enable, link, list)
- **Test quality refactoring** (LLxprt-originated) — Adopt `it.each` table-driven patterns from upstream's testing approach

### High-Risk Items

1. **8c78fe4f (MCP rework) PICK** — Significant refactor of mcp-client.ts. Must preserve LLxprt's DebugLogger calls.
2. **86828bb5 (Gemini 3 extracts) REIMPLEMENT** — Surgical extraction from a massive commit. File-by-file plan required.
3. **ba88707b (terminal cleanup) REIMPLEMENT** — Touches exit paths. Must not regress normal shutdown.

### What's Skipped and Why

- **11 release/version-bump commits** — Pure automation
- **4 mouse/selection/paste warning commits** — LLxprt uses `/mouse off` instead of selection mode; warning infrastructure doesn't exist
- **Google auth (ADC metadata server)** — Multi-provider auth
- **Experiments/flag infrastructure** — Google-specific
- **ClearcutLogger / telemetry** — Removed from LLxprt
- **chatCompressionService** — Doesn't exist (LLxprt has own compression in GeminiChat)
- **modelRouterService** — Gemini-specific routing
- **v0.17.1 hotfix** — Changes useAlternateBuffer default to false; LLxprt keeps true (with screen reader guard)
- **Glob version** — Already at ^12.0.0
- **Tips/phrases** — Not interested
- **Upstream docs** — Changelogs, deprecation notices diverge
