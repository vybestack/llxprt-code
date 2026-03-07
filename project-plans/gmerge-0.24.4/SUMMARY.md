# gmerge-0.24.4 Summary

## Overview

Sync LLxprt Code with upstream gemini-cli from **v0.23.0** to **v0.24.4**.

- **Branch**: `gmerge/0.24.4`
- **Upstream range**: `v0.23.0..v0.24.4`
- **Total upstream commits**: 118
- **Decisions**: PICK ~31 · SKIP ~48 · REIMPLEMENT ~29 · NO_OP ~10

## Note on version numbers

The user requested "0.24.3" but no such upstream tag exists. Targeting **v0.24.4** as the nearest available stable tag. There is also no "v0.23.1" — the user's concern about "missed 0.23.1 fixes" likely refers to post-release patches included in the v0.24.0→v0.24.4 range (e.g., `def09778` terminal fix, `687ca40b` race condition fix).

## Prior work reference

The gmerge/0.24.5 branch (previous session) completed Phase A cherry-picks (22/34 PICK commits landed, 8 reclassified during execution). Phases B-E (REIMPLEMENT) were not completed. This new branch starts fresh from main with the benefit of lessons learned from that attempt.

## Key Changes in This Range

### New Feature Systems
1. **Agent Skills** (11 commits) — Complete skill discovery, activation, management CLI. Self-contained, cherry-pickable with branding changes.
2. **MessageBus DI Migration** (3 commits) — Service locator → dependency injection. Touches 50+ files. Must REIMPLEMENT.
3. **Tool Scheduler Refactoring** (2 commits) — Extract types, ToolExecutor. Must REIMPLEMENT (parallel batching divergence).

### Security Improvements
4. **Env sanitization** — Unified secrets/env redaction
5. **Folder trust defaults** — Untrusted by default
6. **Shell policy unification** — Granular allowlisting
7. **Security documentation** — Hooks security docs

### Bug Fixes
8. **Race condition** (`687ca40b`) — `void` → `await` on scheduleToolCalls
9. **Terminal hang** (`3997c7ff`) — Browser exit without login
10. **EIO crash** (`0a216b28`) — readStdin cleanup
11. **WriteTodo** (`a61fb058`) — Constructor bug
12. **/copy crash** (`2da911e4`) — Windows /dev/tty skip
13. **MCP unhandled rejection** (`8a0190ca`) — mcp-client-manager

### Hooks System (10 commits → REIMPLEMENT)
Folder trust, security warnings, dedup, tool input modification, stop/block, context injection, visual indicators, settings.

### Extensions (5 commits → REIMPLEMENT)
Install/uninstall, update notifications, settings info, missing settings alert, command fallback.

### Skipped Categories
- Release/version bumps (12 commits)
- CI/GitHub workflows (7 commits)
- Google telemetry/ClearcutLogger (2 commits)
- SmartEdit removal (already removed in LLxprt, 3 commits)
- FlashFallback/model availability (not in LLxprt, 3 commits)
- Holiday theme (not in LLxprt)
- Remote agents/A2A (deferred to separate issue, 3 commits)

## High-Risk Items

1. **MessageBus DI** (3 REIMPLEMENT commits, ~57 files) — Largest mechanical change
2. **Console→coreEvents migration** (1 REIMPLEMENT commit, 66 files) — Most files touched
3. **Hooks system** (10 REIMPLEMENT commits) — LLxprt's hooks heavily diverged
4. **Skills cherry-picks** (11 PICK) — Mostly clean but long dependency chain

## Execution-Time Lessons from gmerge/0.24.5

During the previous attempt, several PICK commits were reclassified:
- `b0d5c4c0` (dynamic policy) → REIMPLEMENT (7 conflict files)
- `b6b0727e` (schema non-fatal) → REIMPLEMENT (7 conflicts)
- `5f286147` (MCP resources limit) → SKIP (McpStatus.tsx doesn't exist)
- `873d10df` (terse image paths) → REIMPLEMENT (conflicts)
- `18fef0db` (shell redirection) → REIMPLEMENT (12 conflicts)
- `0f3555a4` (/dir add) → REIMPLEMENT (modify/delete)
- `8f0324d8` (paste fix) → REIMPLEMENT (13 conflicts)
- `d2849fda` (keyboard modes) → REIMPLEMENT (depends on paste infra)
- `dc6dda5c` (SDK logging) → SKIP (loggingContentGenerator diverged)
- `30f5c4af` (powershell mock) → SKIP (shell area diverged)

These reclassifications are pre-applied in this audit's CHERRIES.md.
