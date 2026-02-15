# Plan: LSP Integration

Plan ID: PLAN-20250212-LSP
Generated: 2025-02-12
Total Phases: 80 (36 implementation + 36 verification + 7 setup + execution tracker)
Requirements: All 128 requirements from requirements.md (REQ-DIAG through REQ-EXCL + REQ-START/CONC/TIMING/CONTENT/PATH/NAVR/DRIFT)

## Critical Reminders

Before implementing ANY phase, ensure you have:

1. Completed preflight verification (Phase 00a)
2. Defined integration contracts for multi-component features (Phase 02.5)
3. Written integration tests BEFORE unit tests (vertical slice strategy)
4. Verified all dependencies and types exist as assumed

## Feature Overview

LSP Integration adds real-time diagnostic feedback to LLxprt's edit/write tools by running Language Server Protocol servers in a separate Bun-native subprocess. After every file mutation, LSP diagnostics (type errors, lint violations) are automatically appended to the tool response so the LLM can self-correct without requiring build/lint commands.

Additionally, LSP navigation tools (go-to-definition, find-references, hover, symbols) are exposed to the LLM via MCP for deeper code understanding.

## Architecture Summary

- **packages/lsp/** — New Bun-native package (follows packages/ui precedent)
  - Runs as a single child process spawned by core
  - Two IPC channels: JSON-RPC on stdin/stdout (diagnostics), MCP on fd3/fd4 (navigation)
  - Manages multiple language server connections (tsserver, eslint, gopls, pyright, rust-analyzer)
  - Single shared Orchestrator instance across both channels

- **packages/core/src/lsp/** — New thin client directory
  - `LspServiceClient` — Spawns Bun subprocess, holds JSON-RPC connection
  - `types.ts` — Shared types (Diagnostic, ServerStatus, LspConfig) duplicated from lsp package

- **packages/core/src/tools/edit.ts** — Modified: appends single-file diagnostics after edits
- **packages/core/src/tools/write-file.ts** — Modified: appends multi-file diagnostics after writes
- **packages/core/src/tools/apply-patch.ts** — Modified: appends single-file diagnostics per modified file
- **packages/core/src/config/config.ts** — Modified: LSP config, service client lifecycle, MCP registration

## Integration Analysis (MANDATORY)

### 1. What existing code will USE this feature?

| File | Function | How |
|------|----------|-----|
| `packages/core/src/tools/edit.ts` | `EditToolInvocation.execute()` | Calls `lspServiceClient.checkFile()` after write, appends diagnostics to `llmContent` |
| `packages/core/src/tools/write-file.ts` | `WriteFileToolInvocation.execute()` | Calls `lspServiceClient.checkFile()` + `getAllDiagnostics()`, appends multi-file diagnostics |
| `packages/core/src/tools/apply-patch.ts` | `ApplyPatchToolInvocation.execute()` | Calls `lspServiceClient.checkFile()` per modified file (single-file scope), skips rename/delete-only ops |
| `packages/core/src/config/config.ts` | `Config.initialize()` | Starts LSP service, registers MCP nav server |
| `packages/core/src/config/config.ts` | `Config` cleanup | Shuts down LSP service on session end |
| `packages/core/src/config/config.ts` | `Config.registerLspNavTools()` | Creates direct MCP SDK Client on fd3/fd4 for LSP nav tools (bypasses McpClientManager) |
| Slash command handler | `/lsp status` | Calls `lspServiceClient.status()`, formats server list |

### 2. What existing code needs to be REPLACED?

No existing code is replaced. This is a new feature with integration points into existing code. The edit, write-file, and apply-patch tools are MODIFIED (not replaced) to append diagnostics.

### 3. How will users ACCESS this feature?

| Access Point | Description |
|-------------|-------------|
| **Automatic** | Diagnostics appear in edit/write/apply-patch tool responses without user action |
| **MCP tools** | LLM can call `lsp_goto_definition`, `lsp_find_references`, `lsp_hover`, `lsp_document_symbols`, `lsp_workspace_symbols`, `lsp_diagnostics` |
| **`/lsp status`** | Slash command shows LSP server status (available even when `lsp: false`) |
| **Configuration** | `settings.json` with `"lsp": false` or `"lsp": { ... }` or absent (enabled by default) |

### 4. What needs to be MIGRATED?

Nothing. This is a new feature. No existing data, configs, or tests need migration.

### 5. Integration Test Requirements

- **Edit tool → LSP service**: Edit a file, verify diagnostics appear in `llmContent`
- **Write tool → LSP service**: Write a file that breaks an importer, verify multi-file diagnostics
- **Apply-patch → LSP service**: Patch modifies files, verify single-file diagnostics per modified file; rename-only patches produce no diagnostics
- **Config → LSP service lifecycle**: Start session, verify LSP service starts, end session, verify cleanup
- **Graceful degradation**: Start session without Bun, verify edit tools work normally with no error text
- **MCP navigation**: Register LSP MCP server, verify tools appear in tool list
- **Crash resilience**: Kill LSP service process, verify subsequent edits still succeed
- **Status command**: `/lsp status` shows servers with alphabetical ordering, works even with `lsp: false`

## Phase Structure

Each component follows strict 3-phase TDD (Stub → TDD → Implementation). Integration TDD runs before unit TDD (vertical slice strategy).

```
Phase 00a: Preflight Verification
Phase 01:  Analysis
Phase 01a: Analysis Verification
Phase 02:  Pseudocode
Phase 02a: Pseudocode Verification
Phase 02.5: Integration Contracts
Phase 03:  Shared Types & Config Schema Stubs
Phase 03a: Shared Types & Config Schema Stubs Verification
Phase 04:  Language Map Stub + Implementation (pure data, no TDD needed)
Phase 04a: Language Map Verification
Phase 05:  Diagnostics Formatting Stub
Phase 05a: Diagnostics Formatting Stub Verification
Phase 06:  Diagnostics Formatting Integration TDD
Phase 06a: Diagnostics Formatting Integration TDD Verification
Phase 07:  Diagnostics Formatting Unit TDD
Phase 07a: Diagnostics Formatting Unit TDD Verification
Phase 08:  Diagnostics Formatting Implementation
Phase 08a: Diagnostics Formatting Implementation Verification
Phase 09:  LSP Client Stub
Phase 09a: LSP Client Stub Verification
Phase 10:  LSP Client Integration TDD
Phase 10a: LSP Client Integration TDD Verification
Phase 11:  LSP Client Unit TDD
Phase 11a: LSP Client Unit TDD Verification
Phase 12:  LSP Client Implementation
Phase 12a: LSP Client Implementation Verification
Phase 13:  Server Registry Stub
Phase 13a: Server Registry Stub Verification
Phase 14:  Server Registry TDD
Phase 14a: Server Registry TDD Verification
Phase 15:  Server Registry Implementation
Phase 15a: Server Registry Implementation Verification
Phase 16:  Orchestrator Stub
Phase 16a: Orchestrator Stub Verification
Phase 17:  Orchestrator Integration TDD
Phase 17a: Orchestrator Integration TDD Verification
Phase 18:  Orchestrator Unit TDD
Phase 18a: Orchestrator Unit TDD Verification
Phase 19:  Orchestrator Implementation
Phase 19a: Orchestrator Implementation Verification
Phase 20:  RPC Channel Stub
Phase 20a: RPC Channel Stub Verification
Phase 21:  RPC Channel TDD
Phase 21a: RPC Channel TDD Verification
Phase 22:  RPC Channel Implementation
Phase 22a: RPC Channel Implementation Verification
Phase 23:  MCP Channel Stub
Phase 23a: MCP Channel Stub Verification
Phase 24:  MCP Channel TDD
Phase 24a: MCP Channel TDD Verification
Phase 25:  MCP Channel Implementation
Phase 25a: MCP Channel Implementation Verification
Phase 26:  Main Entry Point
Phase 26a: Main Entry Point Verification
Phase 27:  LspServiceClient (Core) Stub
Phase 27a: LspServiceClient Stub Verification
Phase 28:  LspServiceClient Integration TDD
Phase 28a: LspServiceClient Integration TDD Verification
Phase 29:  LspServiceClient Unit TDD
Phase 29a: LspServiceClient Unit TDD Verification
Phase 30:  LspServiceClient Implementation
Phase 30a: LspServiceClient Implementation Verification
Phase 31:  Edit Tool & Apply-Patch Integration
Phase 31a: Edit Tool & Apply-Patch Integration Verification
Phase 32:  Write Tool Integration
Phase 32a: Write Tool Integration Verification
Phase 33:  Config Integration & MCP Registration
Phase 33a: Config Integration Verification
Phase 34:  Status Slash Command
Phase 34a: Status Slash Command Verification
Phase 35:  System Integration Wiring
Phase 35a: System Integration Wiring Verification
Phase 36:  E2E Tests
Phase 36a: E2E Tests Verification (FINAL)
```

## Component Dependency Order

```
1.  Shared Types (no deps)                           → P03
2.  Language Map (no deps)                            → P04
3.  Diagnostics Formatting (depends on types)         → P05-P08
4.  LSP Client (depends on types, diagnostics)        → P09-P12
5.  Server Registry (depends on types)                → P13-P15
6.  Orchestrator (depends on client, registry, map)   → P16-P19
7.  RPC Channel (depends on orchestrator)             → P20-P22
8.  MCP Channel (depends on orchestrator)             → P23-P25
9.  Main Entry Point (depends on all lsp components)  → P26
10. LspServiceClient - core (depends on types)        → P27-P30
11. Edit & Apply-Patch Integration (depends on client) → P31
12. Write Tool Integration (depends on client)         → P32
13. Config Integration (depends on LspServiceClient)   → P33
14. Status Slash Command (depends on LspServiceClient) → P34
15. System Integration Wiring (depends on ALL above)   → P35
16. E2E Tests (depends on ALL above)                   → P36
```

---

## Requirement Coverage Matrix

Every requirement from `requirements.md` is mapped to the phase(s) that implement it. No requirement is orphaned.

### 1 — Diagnostic Feedback After File Mutations

| Requirement ID | Requirement Summary | Phase(s) | Status |
|---------------|---------------------|----------|--------|
| REQ-DIAG-010 | Edit tool appends error diagnostics to llmContent | P31 | [ ] |
| REQ-DIAG-015 | Apply-patch tool appends diagnostics like edit tool | P31 | [ ] |
| REQ-DIAG-017 | Apply-patch: single-file scope per modified file; skip rename/delete-only | P31 | [ ] |
| REQ-DIAG-020 | File write succeeds before diagnostics collected | P31, P32 | [ ] |
| REQ-DIAG-030 | Edit/apply-patch: single-file scope only | P31 | [ ] |
| REQ-DIAG-040 | Write tool: multi-file diagnostics (written + affected) | P32 | [ ] |
| REQ-DIAG-045 | Other-file diagnostics from known-files set (publishDiagnostics) | P32, P17-P19 | [ ] |
| REQ-DIAG-050 | Written file first ("in this file"), then others ("in other files") | P32 | [ ] |
| REQ-DIAG-060 | Other-file cap: max 5 files (configurable maxProjectDiagnosticsFiles) | P32 | [ ] |
| REQ-DIAG-070 | Total diagnostic lines cap: 50 across all files | P32 | [ ] |

### 2 — Diagnostic Output Format

| Requirement ID | Requirement Summary | Phase(s) | Status |
|---------------|---------------------|----------|--------|
| REQ-FMT-010 | Format: `SEVERITY [line:col] message (code)` | P05-P08 | [ ] |
| REQ-FMT-020 | Wrap in `<diagnostics file="relpath">` XML tag | P05-P08 | [ ] |
| REQ-FMT-030 | Order diagnostics within file by line ascending | P05-P08 | [ ] |
| REQ-FMT-040 | Escape `<`, `>`, `&` in message text | P05-P08 | [ ] |
| REQ-FMT-050 | Per-file cap: max 20 error diagnostics (configurable) | P05-P08 | [ ] |
| REQ-FMT-055 | Overflow count line: `... and N more` | P05-P08 | [ ] |
| REQ-FMT-060 | Default: error-only (LSP severity 1) | P05-P08 | [ ] |
| REQ-FMT-065 | Configurable includeSeverities replaces default filter | P05-P08 | [ ] |
| REQ-FMT-066 | maxDiagnosticsPerFile applied to total after severity filter | P05-P08 | [ ] |
| REQ-FMT-067 | Severity filter consistent across mutation tools, checkFile, diagnostics | P05-P08, P31, P32, P20-P22 | [ ] |
| REQ-FMT-068 | Cap order: severity → per-file → total; overflow suffix excludes from total | P05-P08, P32 | [ ] |
| REQ-FMT-070 | Deduplicate: same file + range + message from multiple servers | P05-P08 | [ ] |
| REQ-FMT-080 | Convert LSP 0-based to 1-based line/col | P05-P08 | [ ] |
| REQ-FMT-090 | File order: edited file first, then alphabetical | P31, P32 | [ ] |

### 3 — Diagnostic Timing

| Requirement ID | Requirement Summary | Phase(s) | Status |
|---------------|---------------------|----------|--------|
| REQ-TIME-010 | Bounded timeout for diagnostic collection (default 3000ms) | P09-P12, P16-P19 | [ ] |
| REQ-TIME-015 | Parallel collection bounds overall latency (not additive) | P16-P19 | [ ] |
| REQ-TIME-020 | Timeout: return success without diagnostics, no error message | P09-P12, P16-P19, P31, P32 | [ ] |
| REQ-TIME-030 | First-touch extended timeout (default 10000ms, configurable) | P09-P12, P16-P19 | [ ] |
| REQ-TIME-040 | Multiple servers: parallel collection, not sequential | P16-P19 | [ ] |
| REQ-TIME-050 | 150ms debounce on publishDiagnostics before returning | P09-P12 | [ ] |
| REQ-TIME-060 | Best-effort snapshot: partial/stale acceptable | P09-P12, P16-P19 | [ ] |
| REQ-TIME-070 | Cold-starting server: mutation response OK without diagnostics if init not done | P09-P12, P16-P19 | [ ] |
| REQ-TIME-080 | Honour request cancellation/abort signals during diagnostic collection | P09-P12, P16-P19, P27-P30 | [ ] |
| REQ-TIME-085 | Partial results: return available subset if some servers timeout | P16-P19 (TDD: P18) | [ ] |
| REQ-TIME-090 | First-touch → firstTouchTimeout; post-init → diagnosticTimeout | P09-P12, P16-P19 (TDD: P18) | [ ] |

### 4 — Scope Restrictions

| Requirement ID | Requirement Summary | Phase(s) | Status |
|---------------|---------------------|----------|--------|
| REQ-SCOPE-010 | Diagnostics only for text/code files; binary writes ignored | P31, P32 | [ ] |
| REQ-SCOPE-020 | No diagnostics for file deletion/rename; content writes only | P31 | [ ] |
| REQ-SCOPE-025 | Apply-patch rename/delete-only: no diagnostic collection, no server start | P31 | [ ] |
| REQ-SCOPE-030 | Store only formatted string in llmContent, no raw objects in metadata | P31, P32 | [ ] |

### 5 — Known-Files Set

| Requirement ID | Requirement Summary | Phase(s) | Status |
|---------------|---------------------|----------|--------|
| REQ-KNOWN-010 | Known files = files with non-empty publishDiagnostics | P16-P19, P32 | [ ] |
| REQ-KNOWN-020 | Remove from set when diagnostics empty, server shuts down, or session ends | P16-P19 | [ ] |
| REQ-KNOWN-030 | Multi-server: file in known-set if ANY server has non-empty diags; removed only when ALL empty | P16-P19 (TDD: P17, P18) | [ ] |

### 6 — LSP Navigation Tools (MCP)

| Requirement ID | Requirement Summary | Phase(s) | Status |
|---------------|---------------------|----------|--------|
| REQ-NAV-010 | Expose 6 navigation tools via MCP when LSP enabled and nav not disabled | P23-P25 | [ ] |
| REQ-NAV-020 | Navigation tools as standard MCP server in LLM tool list | P23-P25, P33 | [ ] |
| REQ-NAV-030 | Workspace boundary check on all navigation tool file paths | P23-P25 | [ ] |
| REQ-NAV-040 | Normalize file paths before boundary check | P23-P25 | [ ] |
| REQ-NAV-050 | `navigationTools: false` hides MCP tools but preserves diagnostics | P23-P25, P33 | [ ] |
| REQ-NAV-055 | Register MCP tools only after LSP service started successfully | P33 | [ ] |
| REQ-NAV-060 | `lsp_diagnostics` tool: workspace-relative paths, alphabetical order | P23-P25 | [ ] |

### 7 — Server Lifecycle

| Requirement ID | Requirement Summary | Phase(s) | Status |
|---------------|---------------------|----------|--------|
| REQ-LIFE-010 | Lazy startup on first file touch | P16-P19 | [ ] |
| REQ-LIFE-020 | No servers at session startup | P16-P19, P33 | [ ] |
| REQ-LIFE-030 | Workspace root detection by nearest project marker | P16-P19 | [ ] |
| REQ-LIFE-040 | Shut down all servers on session end | P26, P27-P30, P33 | [ ] |
| REQ-LIFE-050 | Shutdown sequence: lsp/shutdown → wait → kill | P27-P30 | [ ] |
| REQ-LIFE-060 | Cleanup diagnostic/file maps on server shutdown, service exit, session end | P16-P19, P27-P30 | [ ] |
| REQ-LIFE-070 | Crashed server → broken, no restart for session | P09-P12, P16-P19 | [ ] |
| REQ-LIFE-080 | Service process dies → all LSP dead, no restart | P27-P30 | [ ] |
| REQ-LIFE-090 | Broken server: edits proceed without diagnostics, no error | P16-P19, P31, P32 | [ ] |

### 8 — Process Isolation & Architecture

| Requirement ID | Requirement Summary | Phase(s) | Status |
|---------------|---------------------|----------|--------|
| REQ-ARCH-010 | LSP subsystem in separate Bun-native child process | P26, P27-P30 | [ ] |
| REQ-ARCH-020 | JSON-RPC over stdin/stdout for diagnostic channel | P20-P22, P27-P30 | [ ] |
| REQ-ARCH-030 | MCP over fd3/fd4 for navigation tools | P23-P25, P27-P30, P33 | [ ] |
| REQ-ARCH-040 | Single orchestrator shared between channels | P26 | [ ] |
| REQ-ARCH-050 | No Bun APIs in core package | P27-P30 | [ ] |
| REQ-ARCH-060 | Only vscode-jsonrpc added to core (pure JS, zero native) | P03, P27-P30 | [ ] |
| REQ-ARCH-070 | Internal JSON-RPC methods: checkFile, diagnostics, status, shutdown | P20-P22 | [ ] |
| REQ-ARCH-080 | lsp/diagnostics returns files in alphabetical order | P20-P22, P16-P19 | [ ] |
| REQ-ARCH-090 | Single orchestrator, no duplicate language-server processes | P16-P19, P26 | [ ] |

### 9 — Graceful Degradation

| Requirement ID | Requirement Summary | Phase(s) | Status |
|---------------|---------------------|----------|--------|
| REQ-GRACE-010 | No LSP server for language → edit works as today, no error | P16-P19, P31, P32 | [ ] |
| REQ-GRACE-020 | Bun not available → silently disable, debug log only | P27-P30 | [ ] |
| REQ-GRACE-030 | LSP package not installed → silently disable | P27-P30 | [ ] |
| REQ-GRACE-040 | Service dead → isAlive()=false, checkFile returns [] | P27-P30 | [ ] |
| REQ-GRACE-045 | Startup failure → permanently disabled, no retry | P27-P30 | [ ] |
| REQ-GRACE-050 | Every LSP call from mutation tools wrapped in try/catch | P31, P32 | [ ] |
| REQ-GRACE-055 | LSP failure: return normal success, no user-visible LSP error text | P31, P32 | [ ] |

### 10 — Configuration

| Requirement ID | Requirement Summary | Phase(s) | Status |
|---------------|---------------------|----------|--------|
| REQ-CFG-010 | `lsp: false` disables everything | P33 | [ ] |
| REQ-CFG-015 | `lsp` absent → enabled by default | P33 | [ ] |
| REQ-CFG-020 | `lsp: { ... }` object presence = enabled | P33 | [ ] |
| REQ-CFG-030 | Disable individual servers: `servers.<id>.enabled: false` | P33, P13-P15 | [ ] |
| REQ-CFG-040 | Custom server configs (command, args, extensions, env, initOptions) | P33, P13-P15 | [ ] |
| REQ-CFG-050 | Configurable `diagnosticTimeout` | P33 | [ ] |
| REQ-CFG-055 | Configurable `firstTouchTimeout` | P33 | [ ] |
| REQ-CFG-060 | Configurable `includeSeverities` | P33 | [ ] |
| REQ-CFG-070 | `navigationTools: false` disables MCP tools, keeps diagnostics | P33 | [ ] |
| REQ-CFG-080 | Custom server command/env only from user config files, never LLM | P33 | [ ] |

### 11 — Multi-Language Support

| Requirement ID | Requirement Summary | Phase(s) | Status |
|---------------|---------------------|----------|--------|
| REQ-LANG-010 | Extensible language mapping and server registry architecture | P04, P13-P15 | [ ] |
| REQ-LANG-020 | Built-in: TypeScript, ESLint, Go, Python, Rust (minimum) | P13-P15 | [ ] |
| REQ-LANG-030 | Custom server configs used to start/manage LSP servers | P13-P15 | [ ] |
| REQ-LANG-040 | Multiple servers per extension: start all, parallel diagnostics | P13-P15, P16-P19 | [ ] |

### 12 — Workspace Boundary Enforcement

| Requirement ID | Requirement Summary | Phase(s) | Status |
|---------------|---------------------|----------|--------|
| REQ-BOUNDARY-010 | Orchestrator rejects files outside workspace root | P16-P19 | [ ] |
| REQ-BOUNDARY-020 | No servers started for external files | P16-P19 | [ ] |
| REQ-BOUNDARY-030 | Normalize paths before boundary check | P16-P19, P23-P25 | [ ] |

### 13 — Status Visibility

| Requirement ID | Requirement Summary | Phase(s) | Status |
|---------------|---------------------|----------|--------|
| REQ-STATUS-010 | `/lsp status` slash command | P34 | [ ] |
| REQ-STATUS-020 | Server statuses: active, starting, broken, disabled, unavailable | P34, P16-P19 | [ ] |
| REQ-STATUS-025 | Report ALL known and configured servers (built-in + custom) | P34, P16-P19 | [ ] |
| REQ-STATUS-030 | Service unavailable → "LSP unavailable: <reason>" | P34 | [ ] |
| REQ-STATUS-035 | Specific failure reason in unavailable message | P34, P27-P30 | [ ] |
| REQ-STATUS-040 | Available regardless of `navigationTools: false` | P34 | [ ] |
| REQ-STATUS-045 | Deterministic alphabetical server ordering by ID | P34, P16-P19 (TDD: P18) | [ ] |
| REQ-STATUS-050 | `lsp: false` → `/lsp status` still available, shows "LSP disabled" | P34 | [ ] |

### 14 — Observability

| Requirement ID | Requirement Summary | Phase(s) | Status |
|---------------|---------------------|----------|--------|
| REQ-OBS-010 | Log via DebugLogger at debug level | P09-P12, P16-P19, P27-P30 | [ ] |
| REQ-OBS-020 | Log: startup success/failure, crashes, latency, timeout rates, diag counts | P09-P12, P16-P19, P27-P30 | [ ] |
| REQ-OBS-030 | No remote telemetry | P09-P12, P16-P19, P27-P30 | [ ] |

### 15 — Code Quality & Packaging

| Requirement ID | Requirement Summary | Phase(s) | Status |
|---------------|---------------------|----------|--------|
| REQ-PKG-010 | packages/lsp NOT in root npm workspaces array | P03 | [ ] |
| REQ-PKG-020 | Own eslint.config.cjs, tsconfig.json, CI steps (packages/ui precedent) | P03 | [ ] |
| REQ-PKG-025 | CI pipeline: lint, typecheck, test for packages/lsp as separate steps | P03, P36 | [ ] |
| REQ-PKG-030 | max-lines: 800 lint rule per file | P03 | [ ] |
| REQ-PKG-040 | Strict TypeScript: no-unsafe-assignment/member-access/return | P03 | [ ] |
| REQ-PKG-050 | Types duplicated in both packages (core + lsp) | P03 | [ ] |
| REQ-PKG-060 | Root eslint ignores packages/lsp/** | P03 | [ ] |

### 16 — Non-Goals (Explicit Exclusions)

| Requirement ID | Requirement Summary | Phase(s) | Status |
|---------------|---------------------|----------|--------|
| REQ-EXCL-010 | No code completion/autocomplete | P36 (verified by omission) | [ ] |
| REQ-EXCL-020 | No auto-apply code actions/fixes | P36 (verified by omission) | [ ] |
| REQ-EXCL-030 | No LSP-based formatting | P36 (verified by omission) | [ ] |
| REQ-EXCL-040 | No real-time/watch-mode polling | P36 (verified by omission) | [ ] |
| REQ-EXCL-050 | No diagnostic UI in TUI/IDE companion | P36 (verified by omission) | [ ] |

### 17 — Startup Protocol (Research-Driven)

| Requirement ID | Requirement Summary | Phase(s) | Status |
|---------------|---------------------|----------|--------|
| REQ-START-010 | LSP service sends lsp/ready notification after init | P26 | [ ] |
| REQ-START-020 | LspServiceClient waits for lsp/ready with bounded timeout | P27-P30 | [ ] |
| REQ-START-030 | Config via single LSP_BOOTSTRAP env var | P26, P27-P30 | [ ] |
| REQ-START-040 | Validate LSP_BOOTSTRAP fields on Bun side | P26 | [ ] |

### 18 — Concurrency Safety (Research-Driven)

| Requirement ID | Requirement Summary | Phase(s) | Status |
|---------------|---------------------|----------|--------|
| REQ-CONC-010 | Single-flight guard for concurrent server startup | P16-P19 | [ ] |
| REQ-CONC-020 | Per-client operation queue for write/read serialization | P16-P19 | [ ] |

### 19 — Timing Robustness (Research-Driven)

| Requirement ID | Requirement Summary | Phase(s) | Status |
|---------------|---------------------|----------|--------|
| REQ-TIMING-010 | Debounce clamped to remaining deadline time | P09-P12 | [ ] |
| REQ-TIMING-020 | First-touch is one-shot, cleared in finally | P16-P19 | [ ] |

### 20 — File Content Handling (Research-Driven)

| Requirement ID | Requirement Summary | Phase(s) | Status |
|---------------|---------------------|----------|--------|
| REQ-CONTENT-010 | checkFile text field used as authoritative content | P09-P12, P16-P19, P20-P22 | [ ] |
| REQ-CONTENT-020 | Absent text field falls back to disk read | P09-P12 | [ ] |

### 21 — Path Boundary Safety (Research-Driven)

| Requirement ID | Requirement Summary | Phase(s) | Status |
|---------------|---------------------|----------|--------|
| REQ-PATH-010 | Segment-safe workspace boundary check | P16-P19 | [ ] |

### 22 — Navigation Registration (Research-Driven)

| Requirement ID | Requirement Summary | Phase(s) | Status |
|---------------|---------------------|----------|--------|
| REQ-NAVR-010 | Direct MCP SDK Client for LSP nav, bypasses McpClientManager | P33 | [ ] |

### 23 — Type Drift Safety (Research-Driven)

| Requirement ID | Requirement Summary | Phase(s) | Status |
|---------------|---------------------|----------|--------|
| REQ-DRIFT-010 | CI check: shared type definitions identical in core and lsp | P03, P36 | [ ] |
| REQ-DRIFT-020 | E2E contract test: full Diagnostic round-trip deep equality | P36 | [ ] |

---

## Requirement Count Summary

| Area | Count | All Covered? |
|------|-------|-------------|
| Diagnostic Feedback (DIAG) | 10 | [OK] |
| Diagnostic Format (FMT) | 14 | [OK] |
| Diagnostic Timing (TIME) | 11 | [OK] |
| Scope Restrictions (SCOPE) | 4 | [OK] |
| Known-Files Set (KNOWN) | 3 | [OK] |
| Navigation Tools (NAV) | 7 | [OK] |
| Server Lifecycle (LIFE) | 9 | [OK] |
| Architecture (ARCH) | 9 | [OK] |
| Graceful Degradation (GRACE) | 7 | [OK] |
| Configuration (CFG) | 10 | [OK] |
| Multi-Language (LANG) | 4 | [OK] |
| Workspace Boundary (BOUNDARY) | 3 | [OK] |
| Status Visibility (STATUS) | 8 | [OK] |
| Observability (OBS) | 3 | [OK] |
| Packaging (PKG) | 7 | [OK] |
| Exclusions (EXCL) | 5 | [OK] |
| Startup Protocol (START) | 4 | [OK] |
| Concurrency Safety (CONC) | 2 | [OK] |
| Timing Robustness (TIMING) | 2 | [OK] |
| File Content Handling (CONTENT) | 2 | [OK] |
| Path Boundary Safety (PATH) | 1 | [OK] |
| Navigation Registration (NAVR) | 1 | [OK] |
| Type Drift Safety (DRIFT) | 2 | [OK] |
| **TOTAL** | **128** | **[OK] All covered** |

## Completion Markers

- [ ] All phases have @plan markers in code
- [ ] All requirements have @requirement markers
- [ ] No phases skipped in sequence
- [ ] No deferred implementation in any file
- [ ] All tests pass (core + lsp)
- [ ] TypeScript compiles in both packages
- [ ] Lint passes in both packages
- [ ] Feature is reachable by users (edit/write/apply-patch/status/navigation)
