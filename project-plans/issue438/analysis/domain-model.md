# LSP Integration — Domain Model

## Plan Reference
- **Plan ID**: PLAN-20250212-LSP
- **Issue**: #438
- **Specification**: [overview.md](../overview.md)
- **Requirements**: [requirements.md](../requirements.md)

---

## 1. Entity Relationships

### 1.1 Core Entities

```
LspServiceClient (core, 1 per session)
  │
  ├── owns → BunSubprocess (1, child process running packages/lsp)
  │            ├── stdin/stdout → JSON-RPC MessageConnection (diagnostics channel)
  │            └── fd3/fd4 → MCP Transport (navigation tools channel)
  │
  └── state: alive | dead | never-started

Orchestrator (lsp, 1 per service process)
  │
  ├── manages → LspClient[] (0..N, one per server-id + workspace-root pair)
  │               ├── owns → LanguageServerProcess (1, the actual LSP binary)
  │               ├── tracks → OpenFileVersionMap (file → version counter)
  │               └── collects → DiagnosticMap (file → Diagnostic[])
  │
  ├── uses → ServerRegistry (1, immutable lookup table)
  │            └── contains → ServerConfig[] (built-in + user-custom)
  │
  ├── uses → LanguageMap (1, immutable lookup table)
  │            └── maps → extension → languageId
  │
  └── state: initializing | ready | shutting-down

LspClient (lsp, 1 per server-id + workspace-root)
  │
  ├── owns → vscode-jsonrpc MessageConnection (to language server)
  ├── tracks → DiagnosticMap (file → Diagnostic[])
  ├── tracks → OpenFileVersionMap (file → version)
  └── state: starting | active | broken

ServerConfig (lsp, immutable data)
  ├── id: string (e.g., "typescript", "gopls")
  ├── extensions: string[] (e.g., [".ts", ".tsx"])
  ├── command: string
  ├── args: string[]
  ├── env: Record<string, string>
  ├── workspaceRootMarkers: string[] (e.g., ["package.json"])
  └── initializationOptions: Record<string, unknown>

Diagnostic (shared type, immutable value object)
  ├── file: string (relative to workspace root)
  ├── line: number (1-based)
  ├── character: number (1-based)
  ├── severity: 'error' | 'warning' | 'info' | 'hint'
  ├── message: string (XML-escaped)
  ├── code?: string | number
  └── source?: string

ServerStatus (shared type, immutable value object)
  ├── id: string
  ├── status: 'active' | 'starting' | 'broken' | 'disabled' | 'unavailable'
  ├── language: string
  └── serverPid?: number
```

### 1.2 Entity Relationship Diagram

```
┌──────────────────────────────────┐
│            Config                │
│  (packages/core/src/config/)     │
│                                  │
│  lsp: LspConfig | false          │
│  lspServiceClient?: LspService.. │
├──────────────────────────────────┤
│  getLspServiceClient()           │
│  getLspConfig()                  │
└──────────┬───────────────────────┘
           │ owns
           ▼
┌──────────────────────────────────┐       ┌─────────────────────────┐
│       LspServiceClient           │       │  Direct MCP SDK Client  │
│  (packages/core/src/lsp/)        │       │  (for LSP nav tools)    │
│                                  │       │                         │
│  subprocess: ChildProcess        │       │  Client.connect(        │
│  rpcConnection: MessageConnection│       │    fdTransport(fd3/fd4))│
│  alive: boolean                  │       │  Bypasses McpClient-    │
│                                  │       │  Manager entirely       │
├──────────────────────────────────┤       └─────────────────────────┘
│  start(config, workspaceRoot)    │                  │
│  checkFile(filePath, text?)      │                  │
│  getAllDiagnostics()             │                  │
│  status()                        │                  │
│  shutdown()                      │                  │
│  isAlive()                       │                  │
│  getMcpTransportStreams()         │                  │
└──────────┬───────────────────────┘                  │
           │ spawns                                    │
           ▼                                           ▼
┌────────────────────────────────────────────────────────────────────┐
│                    LSP Service Process (Bun)                       │
│                    packages/lsp/src/main.ts                        │
│                                                                    │
│  ┌──────────────────┐  ┌──────────────────┐                       │
│  │ RpcChannel        │  │ McpChannel        │                       │
│  │ (stdin/stdout)    │  │ (fd3/fd4)         │                       │
│  │                   │  │                   │                       │
│  │ lsp/checkFile     │  │ lsp_goto_defn     │                       │
│  │ lsp/diagnostics   │  │ lsp_find_refs     │                       │
│  │ lsp/status        │  │ lsp_hover         │                       │
│  │ lsp/shutdown      │  │ lsp_doc_symbols   │                       │
│  └─────────┬─────────┘  │ lsp_ws_symbols    │                       │
│            │             │ lsp_diagnostics   │                       │
│            │             └─────────┬─────────┘                       │
│            └─────────┬─────────────┘                                 │
│                      ▼                                               │
│         ┌──────────────────────┐                                     │
│         │    Orchestrator       │                                     │
│         │                      │                                     │
│         │  clients: Map<key,   │                                     │
│         │    LspClient>        │                                     │
│         │  brokenServers: Set  │                                     │
│         │  workspaceRoot: str  │                                     │
│         └──────────┬───────────┘                                     │
│                    │ manages                                         │
│         ┌─────────┬┴─────────┐                                       │
│         ▼         ▼          ▼                                       │
│    ┌─────────┐ ┌─────────┐ ┌─────────┐                              │
│    │LspClient│ │LspClient│ │LspClient│                              │
│    │tsserver │ │eslint   │ │gopls    │                              │
│    └────┬────┘ └────┬────┘ └────┬────┘                              │
│         │           │           │                                    │
│    ┌────▼────┐ ┌────▼────┐ ┌────▼────┐                              │
│    │tsserver │ │eslint-  │ │gopls    │ (actual OS processes)        │
│    │process  │ │lsp proc │ │process  │                              │
│    └─────────┘ └─────────┘ └─────────┘                              │
└────────────────────────────────────────────────────────────────────┘
```

---

## 2. State Transitions

### 2.1 LspServiceClient States

```
                     start() succeeds
 ┌─────────────┐  ──────────────────────►  ┌──────────┐
 │never-started │                           │  alive    │
 └──────┬───────┘                           └────┬─────┘
        │                                        │
        │ start() fails (Bun not found,          │ subprocess dies
        │ package missing, spawn error)          │ (crash, signal, exit)
        │                                        │
        ▼                                        ▼
 ┌─────────────┐                           ┌──────────┐
 │    dead      │◄──────────────────────── │   dead    │
 │ (permanent)  │   shutdown() called       │(permanent)│
 └──────────────┘                           └───────────┘
```

**Key invariants:**
- Once `dead`, never transitions back. No auto-restart. (REQ-LIFE-080, REQ-GRACE-045)
- `isAlive()` returns `true` only in `alive` state. (REQ-GRACE-040)
- `checkFile()` returns `[]` immediately when not alive. (REQ-GRACE-040)

### 2.2 LspClient (Individual Server) States

```
                    initialize handshake completes
 ┌──────────┐  ────────────────────────────────►  ┌──────────┐
 │ starting  │                                     │  active   │
 └─────┬─────┘                                     └────┬─────┘
       │                                                 │
       │ initialize fails / process crashes              │ process crashes
       │                                                 │
       ▼                                                 ▼
 ┌──────────┐                                     ┌──────────┐
 │  broken   │◄─────────────────────────────────── │  broken   │
 │(permanent)│   no restart for session             │(permanent)│
 └───────────┘                                     └───────────┘
```

**Additional states (from ServerRegistry, not LspClient):**
- `disabled`: User set `servers.<id>.enabled: false`. Never started. (REQ-CFG-030)
- `unavailable`: Binary not found on system. Never started. (REQ-STATUS-020)

### 2.3 Diagnostic Collection State Machine

```
                                    file mutation
                                    (edit/write/patch)
                                         │
                                         ▼
                              ┌─────────────────────┐
                              │  Determine language  │
                              │  from file extension │
                              └──────────┬──────────┘
                                         │
                            ┌────────────▼────────────┐
                     yes ◄──│  Any servers available?  │──► no
                            └──────────────────────────┘     │
                              │                               │ return []
                              ▼                               │ (REQ-GRACE-010)
                    ┌───────────────────┐                     │
                    │ Start servers if  │                     │
                    │ not running (lazy)│                     │
                    │ (REQ-LIFE-010)    │                     │
                    └────────┬──────────┘                     │
                             │                                │
                    ┌────────▼──────────┐                     │
                    │ Send didOpen/     │                     │
                    │ didChange to all  │                     │
                    │ applicable servers│                     │
                    │ IN PARALLEL       │                     │
                    │ (REQ-TIME-040)    │                     │
                    └────────┬──────────┘                     │
                             │                                │
                    ┌────────▼──────────┐                     │
                    │ Wait for publish  │                     │
                    │ Diagnostics with  │                     │
                    │ debounce (150ms)  │                     │
                    │ + timeout         │                     │
                    │ (REQ-TIME-010/050)│                     │
                    └────────┬──────────┘                     │
                             │                                │
              ┌──────────────┼──────────────┐                 │
              ▼              ▼              ▼                 │
         ┌─────────┐  ┌──────────┐  ┌────────────┐           │
         │ Got all  │  │ Partial  │  │  Timeout   │           │
         │ results  │  │ results  │  │ (no data)  │           │
         └────┬─────┘  └────┬─────┘  └─────┬──────┘          │
              │              │              │                  │
              └──────────────┼──────────────┘                  │
                             ▼                                 │
                    ┌────────────────────┐                     │
                    │ Merge + Deduplicate│                     │
                    │ (REQ-FMT-070)     │                     │
                    │ Filter by severity │                     │
                    │ (REQ-FMT-060/065) │                     │
                    │ Convert 0→1 based  │                     │
                    │ (REQ-FMT-080)     │                     │
                    └────────┬───────────┘                     │
                             │                                 │
                             ▼                                 │
                    Return Diagnostic[] ◄──────────────────────┘
```

### 2.4 Session Lifecycle

```
Session Start
     │
     ▼
Config.initialize()
     │
     ├── Check: lsp config !== false && lsp package exists && Bun in PATH
     │     │
     │     ├── All checks pass → LspServiceClient.start()
     │     │     │
     │     │     ├── Spawn Bun subprocess
     │     │     ├── Create JSON-RPC connection on stdin/stdout
     │     │     ├── Register MCP nav server on fd3/fd4 (if navigationTools !== false)
     │     │     └── LspServiceClient state = alive
     │     │
     │     └── Any check fails → log debug, state = dead (permanent)
     │                             (REQ-GRACE-020/030/045)
     │
     ├── [LLM edits .ts file]
     │     │
     │     ├── edit.ts: write succeeds
     │     ├── edit.ts: lspServiceClient.checkFile("/project/src/foo.ts")
     │     │     │
     │     │     └── Orchestrator: lazy start tsserver + eslint
     │     │           ├── Detect workspace root (nearest package.json)
     │     │           ├── Spawn tsserver, initialize handshake
     │     │           ├── Spawn eslint-lsp, initialize handshake
     │     │           ├── didOpen foo.ts to both
     │     │           ├── Wait for publishDiagnostics (parallel, debounce)
     │     │           ├── Merge, deduplicate, filter
     │     │           └── Return Diagnostic[]
     │     │
     │     └── edit.ts: format diagnostics, append to llmContent
     │
     ├── [LLM edits .go file]
     │     │
     │     └── Same flow, lazy starts gopls
     │
     ├── [tsserver crashes]
     │     │
     │     ├── LspClient marks tsserver as broken (REQ-LIFE-070)
     │     ├── Future .ts edits → no diagnostics from tsserver
     │     └── eslint still works for .ts files
     │
     └── Session End
           │
           ├── LspServiceClient.shutdown()
           │     ├── Send lsp/shutdown to service
           │     ├── Wait briefly for graceful exit
           │     └── Kill subprocess
           │
           └── Cleanup diagnostic/file tracking maps (REQ-LIFE-060)
```

---

## 3. Business Rules

### 3.1 Diagnostic Collection Rules

| Rule | Requirement | Description |
|------|-------------|-------------|
| BR-1 | REQ-DIAG-020 | File write MUST succeed before diagnostic collection begins. Success message comes first. |
| BR-2 | REQ-DIAG-030 | Edit tool: single-file diagnostics only (edited file). |
| BR-3 | REQ-DIAG-040 | Write tool: multi-file diagnostics (written file + affected files). |
| BR-4 | REQ-FMT-060 | Default severity filter: error only (LSP severity 1). |
| BR-5 | REQ-FMT-050 | Per-file cap: 20 diagnostics (configurable). |
| BR-6 | REQ-DIAG-060 | Other-file cap: 5 files (configurable). |
| BR-7 | REQ-DIAG-070 | Total diagnostic lines cap: 50 across all files. |
| BR-8 | REQ-FMT-068 | Filter order: severity → per-file cap → total line cap. Overflow lines don't count toward total. |
| BR-9 | REQ-FMT-070 | Deduplicate: same file + range + message from multiple servers. |
| BR-10 | REQ-SCOPE-010 | Binary files are ignored. |
| BR-11 | REQ-SCOPE-020 | Deletions/renames don't trigger diagnostics. |
| BR-12 | REQ-SCOPE-030 | Only formatted strings stored in llmContent, not raw objects. |
| BR-13 | REQ-GRACE-050 | Every LSP call from mutation tools is wrapped in try/catch. Never fails the edit. |
| BR-14 | REQ-TIME-040 | Multiple servers for one file: parallel collection, not sequential. |
| BR-15 | REQ-TIME-050 | 150ms debounce on publishDiagnostics before returning. |
| BR-16 | REQ-FMT-090 | File ordering: edited file first, then alphabetical. |
| BR-17 | REQ-DIAG-015/017 | Apply-patch: single-file scope per modified file. Content-only writes trigger diagnostics. |
| BR-35 | REQ-KNOWN-030 | Multi-server known-files: file in set while ANY server has non-empty diags. Removed only when ALL servers have empty diags or shut down. |
| BR-36 | REQ-DIAG-045 | Other-file diagnostics for write tool selected from known-files set (files with non-empty publishDiagnostics). |
| BR-37 | REQ-GRACE-055 | On LSP failure during mutation: no user-visible error text in output, just normal success. |
| BR-38 | REQ-FMT-065/066 | Configurable includeSeverities replaces default; maxDiagnosticsPerFile applies to total after severity filter. |
| BR-39 | REQ-FMT-067 | Severity filter consistent across mutation tools, checkFile, and diagnostics responses. |

### 3.2 Server Lifecycle Rules

| Rule | Requirement | Description |
|------|-------------|-------------|
| BR-18 | REQ-LIFE-010 | Lazy startup: servers start on first file touch, not at session start. |
| BR-19 | REQ-LIFE-020 | No servers started at session startup. |
| BR-20 | REQ-LIFE-070 | Crashed server → broken status, no restart for session. |
| BR-21 | REQ-LIFE-080 | Crashed service process → all LSP dead, no restart. |
| BR-22 | REQ-LIFE-030 | Workspace root detected by nearest project marker file. |
| BR-23 | REQ-ARCH-090 | Single orchestrator shared between RPC and MCP channels. No duplicate servers. |
| BR-24 | REQ-LIFE-060 | Cleanup on: server shutdown, service exit, session end. |

### 3.3 Configuration Rules

| Rule | Requirement | Description |
|------|-------------|-------------|
| BR-25 | REQ-CFG-010 | `lsp: false` → everything disabled. |
| BR-26 | REQ-CFG-015 | `lsp` absent → enabled by default (if runtime available). |
| BR-27 | REQ-CFG-020 | `lsp: { ... }` → enabled. No `enabled` boolean inside. |
| BR-28 | REQ-CFG-030 | Individual servers disableable: `servers.<id>.enabled: false`. |
| BR-29 | REQ-CFG-070 | `navigationTools: false` → no MCP tools, but diagnostics still work. |
| BR-30 | REQ-CFG-080 | Custom server command/env: only from user config files, never LLM-settable. |
| BR-40 | REQ-CFG-055 | Configurable `firstTouchTimeout` for cold-start server initialization. |
| BR-41 | REQ-STATUS-045 | Status output: servers ordered deterministically by server ID, ascending alphabetical. |
| BR-42 | REQ-STATUS-050 | `lsp: false` → `/lsp status` still available, reports "LSP disabled by configuration." |
| BR-43 | REQ-STATUS-025 | Status includes ALL known and configured servers (built-in + user-defined custom). |
| BR-44 | REQ-STATUS-035 | Status unavailable message includes specific failure reason. |

### 3.4 Boundary Enforcement Rules

| Rule | Requirement | Description |
|------|-------------|-------------|
| BR-31 | REQ-BOUNDARY-010 | Orchestrator rejects files outside workspace root. |
| BR-32 | REQ-BOUNDARY-020 | No servers started for external files. |
| BR-33 | REQ-BOUNDARY-030 | Paths normalized before boundary check. |
| BR-34 | REQ-NAV-030 | Navigation tools enforce workspace boundary on all file params. |

---

## 4. Edge Cases

### 4.1 Server Availability Edge Cases

| # | Scenario | Expected Behavior | Requirements |
|---|----------|-------------------|--------------|
| EC-1 | Bun not installed | LSP silently disabled, all edits work normally | REQ-GRACE-020 |
| EC-2 | LSP package not installed | LSP silently disabled | REQ-GRACE-030 |
| EC-3 | Server binary not found (e.g., gopls not installed) | Server marked `unavailable`, no diagnostics for that language | REQ-STATUS-020, REQ-GRACE-010 |
| EC-4 | Server crashes during initialization | Server marked `broken`, no restart | REQ-LIFE-070 |
| EC-5 | Server crashes after working | Same: broken, no restart | REQ-LIFE-070 |
| EC-6 | Service process crashes | All LSP dead, permanent | REQ-LIFE-080 |
| EC-7 | Multiple servers for one extension (ts + eslint) | Both started, diagnostics collected in parallel | REQ-LANG-040, REQ-TIME-040 |
| EC-8 | One of multiple servers crashes (eslint crashes, ts survives) | Eslint broken, ts continues providing diagnostics | REQ-LIFE-070, REQ-LIFE-090 |
| EC-9 | All servers for a language are broken | No diagnostics, no error | REQ-LIFE-090 |

### 4.2 Timing Edge Cases

| # | Scenario | Expected Behavior | Requirements |
|---|----------|-------------------|--------------|
| EC-10 | First file touch (cold start) | Extended timeout (10s default) | REQ-TIME-030, REQ-TIME-090 |
| EC-11 | Server responds after timeout | Response ignored, edit already returned | REQ-TIME-020, REQ-TIME-060 |
| EC-12 | Server sends rapid diagnostic updates | 150ms debounce collects final state | REQ-TIME-050 |
| EC-13 | Partial results (one server responds, one times out) | Return partial results | REQ-TIME-085 |
| EC-14 | Abort signal during diagnostic collection | Collection terminated, edit succeeds | REQ-TIME-080 |
| EC-15 | Simultaneous edits to same file | Each edit gets its own diagnostic snapshot | REQ-TIME-060 |

### 4.3 Diagnostic Formatting Edge Cases

| # | Scenario | Expected Behavior | Requirements |
|---|----------|-------------------|--------------|
| EC-16 | Diagnostic message contains `<`, `>`, `&` | XML-escaped to `&lt;`, `&gt;`, `&amp;` | REQ-FMT-040 |
| EC-17 | 25 errors in one file (exceeds 20 cap) | Show 20 + `... and 5 more` | REQ-FMT-050, REQ-FMT-055 |
| EC-18 | 100 errors across 10 files (write tool) | Cap at 50 total lines, 5 other files | REQ-DIAG-060, REQ-DIAG-070 |
| EC-19 | Edited file has 50 errors | No other-file diagnostics shown (total cap reached) | REQ-DIAG-070 |
| EC-20 | Duplicate diagnostics from tsserver + eslint | Deduplicated by file+range+message | REQ-FMT-070 |
| EC-21 | Same error, different sources | Kept (different message or range) | REQ-FMT-070 |
| EC-22 | Diagnostic at line 0, col 0 (LSP 0-based) | Displayed as line 1, col 1 | REQ-FMT-080 |
| EC-23 | No diagnostic code | Format without `(code)` suffix | REQ-FMT-010 |
| EC-24 | Warnings present but includeSeverities only has 'error' | Warnings excluded | REQ-FMT-060 |
| EC-25 | includeSeverities: ['error', 'warning'] | Both shown, cap applies to total | REQ-FMT-065, REQ-FMT-066 |

### 4.4 Workspace Boundary Edge Cases

| # | Scenario | Expected Behavior | Requirements |
|---|----------|-------------------|--------------|
| EC-26 | File path is in node_modules | Rejected by boundary check | REQ-BOUNDARY-010 |
| EC-27 | File path is symlink pointing outside workspace | Resolved and rejected | REQ-BOUNDARY-030 |
| EC-28 | File path uses `../` to escape workspace | Normalized and rejected | REQ-BOUNDARY-030 |
| EC-29 | Navigation tool called with external file | Tool refuses to operate | REQ-NAV-030 |

### 4.5 Configuration Edge Cases

| # | Scenario | Expected Behavior | Requirements |
|---|----------|-------------------|--------------|
| EC-30 | `lsp: false` | All LSP disabled, no startup, no diagnostics, no MCP tools | REQ-CFG-010 |
| EC-31 | `lsp` key absent | LSP enabled by default | REQ-CFG-015 |
| EC-32 | `lsp: {}` | LSP enabled with all defaults | REQ-CFG-020 |
| EC-33 | Custom server with invalid command | Server marked unavailable | REQ-STATUS-020 |
| EC-34 | `navigationTools: false` | No MCP tools, diagnostics still work | REQ-CFG-070 |
| EC-35 | `/lsp status` when LSP unavailable | Shows "LSP unavailable: <reason>" with specific cause | REQ-STATUS-030, REQ-STATUS-035 |
| EC-40 | `/lsp status` when `lsp: false` | Shows "LSP disabled by configuration" | REQ-STATUS-050 |
| EC-41 | `/lsp status` shows servers in random order | MUST be alphabetical by server ID | REQ-STATUS-045 |
| EC-42 | Multi-server known-files: tsserver clears diags but eslint still has them | File stays in known-files set | REQ-KNOWN-030 |
| EC-43 | All servers clear diags for a file | File removed from known-files set | REQ-KNOWN-030 |
| EC-44 | LSP checkFile throws exception during edit | No error text in output, normal success | REQ-GRACE-055 |
| EC-45 | `firstTouchTimeout` configured to 15000ms | Cold start waits up to 15s | REQ-CFG-055 |

### 4.6 File Type Edge Cases

| # | Scenario | Expected Behavior | Requirements |
|---|----------|-------------------|--------------|
| EC-36 | Binary file written | LSP subsystem ignores it | REQ-SCOPE-010 |
| EC-37 | File deleted by apply-patch | No diagnostic collection | REQ-SCOPE-020, REQ-SCOPE-025 |
| EC-38 | File renamed by apply-patch | No diagnostic collection | REQ-SCOPE-020, REQ-SCOPE-025 |
| EC-39 | Unknown file extension | No server available, no diagnostics | REQ-GRACE-010 |

---

## 5. Error Scenarios

### 5.1 Fatal Errors (Service-Level)

| Error | Detection | Recovery | Impact |
|-------|-----------|----------|--------|
| Bun not in PATH | `spawn` fails with ENOENT | Set state=dead permanently, log debug | No LSP for session |
| LSP package missing | Path resolution fails | Set state=dead permanently, log debug | No LSP for session |
| Service process segfaults | `exit` event with signal | Set state=dead permanently | No LSP for session |
| Service process OOM killed | `exit` event with signal 9 | Set state=dead permanently | No LSP for session |

### 5.2 Recoverable Errors (Server-Level)

| Error | Detection | Recovery | Impact |
|-------|-----------|----------|--------|
| Server binary not found | `Bun.which()` returns null | Mark server unavailable | No diagnostics for that language |
| Server crashes during init | `exit` event before `initialized` | Mark server broken | No diagnostics from that server |
| Server hangs during init | First-touch timeout expires | Return empty diagnostics | Diagnostics available on next edit |
| Server crashes mid-session | `exit` event | Mark server broken | No more diagnostics from that server |
| Server returns malformed diagnostics | JSON-RPC parse error | Ignore, return empty | Missing diagnostics for that response |

### 5.3 Non-Errors (Graceful Degradation)

| Scenario | Behavior |
|----------|----------|
| No LSP server for language | Edit succeeds, no diagnostics appended (REQ-GRACE-010) |
| Diagnostic timeout | Edit succeeds, no diagnostics appended (REQ-TIME-020) |
| LSP service dead | Edit succeeds, checkFile returns [] (REQ-GRACE-040) |
| Partial results from multiple servers | Available subset returned (REQ-TIME-085) |

---

## 6. Data Flow Invariants

1. **Write-before-diagnose**: File mutation MUST complete and succeed before diagnostic collection begins. (REQ-DIAG-020)
2. **Diagnostics are supplemental**: The tool result always includes the success message. Diagnostics are appended, never replace the success message.
3. **String-only persistence**: Only formatted diagnostic strings appear in `llmContent`. No raw `Diagnostic` objects in metadata or session history. (REQ-SCOPE-030)
4. **Deterministic ordering**: Files sorted: edited first, then alphabetical. Diagnostics within a file sorted by line ascending. (REQ-FMT-030, REQ-FMT-090)
5. **Idempotent boundary check**: Workspace boundary enforcement is applied at the orchestrator layer regardless of caller. Both RPC and MCP channels pass through the same check. (REQ-BOUNDARY-010)
6. **Single orchestrator**: Both the diagnostic RPC channel and the MCP navigation channel share one orchestrator instance and one set of language server processes. (REQ-ARCH-040, REQ-ARCH-090)

---

## 7. Additional Business Rules (Architecture, Packaging, Navigation, Observability)

### 7.1 Architecture Rules

| Rule | Requirement | Description |
|------|-------------|-------------|
| BR-45 | REQ-ARCH-020 | JSON-RPC over stdin/stdout for internal diagnostic channel. |
| BR-46 | REQ-ARCH-030 | MCP over extra file descriptors (fd3/fd4) for navigation tool channel. |
| BR-47 | REQ-ARCH-050 | No Bun-specific APIs in core package. All Bun code in packages/lsp. |
| BR-48 | REQ-ARCH-060 | Only vscode-jsonrpc added as new core dependency (pure JS, zero native modules). |
| BR-49 | REQ-ARCH-070 | Internal JSON-RPC methods: lsp/checkFile, lsp/diagnostics, lsp/status, lsp/shutdown. |
| BR-50 | REQ-ARCH-080 | lsp/diagnostics returns file keys in deterministic ascending alphabetical order. |

### 7.2 Navigation Rules

| Rule | Requirement | Description |
|------|-------------|-------------|
| BR-51 | REQ-NAV-020 | Navigation tools exposed as standard MCP server alongside other MCP tools. |
| BR-52 | REQ-NAV-040 | File paths normalized before workspace boundary check or LSP server forwarding. |
| BR-53 | REQ-NAV-050 | `navigationTools: false` hides MCP navigation tools while keeping diagnostics active. |
| BR-54 | REQ-NAV-055 | MCP navigation tools registered only after LSP service starts successfully. If start fails, no tools registered. |
| BR-55 | REQ-NAV-060 | lsp_diagnostics tool returns all known-file diagnostics with relative paths and alphabetical file ordering. |

### 7.3 Packaging Rules

| Rule | Requirement | Description |
|------|-------------|-------------|
| BR-56 | REQ-PKG-020 | packages/lsp has its own eslint.config.cjs, tsconfig.json, and CI steps (following packages/ui precedent). |
| BR-57 | REQ-PKG-025 | CI runs lint, typecheck, and test for packages/lsp as separate steps. |
| BR-58 | REQ-PKG-030 | max-lines lint rule of 800 per file in packages/lsp. Server registry must be decomposed. |
| BR-59 | REQ-PKG-040 | Strict TS rules: no-unsafe-assignment, no-unsafe-member-access, no-unsafe-return. |
| BR-60 | REQ-PKG-050 | Shared types (Diagnostic, ServerStatus, LspConfig) duplicated in both packages to avoid cross-boundary build complexity. |
| BR-61 | REQ-PKG-060 | Root eslint.config.js adds packages/lsp/** to ignore list. LSP linting by its own config. |

### 7.4 Configuration Additional Rules

| Rule | Requirement | Description |
|------|-------------|-------------|
| BR-62 | REQ-CFG-040 | Custom servers: users define command, args, extensions, env, initializationOptions. |
| BR-63 | REQ-CFG-050 | `diagnosticTimeout` configurable (default 3000ms). |
| BR-64 | REQ-CFG-060 | `includeSeverities` configurable, replaces default error-only filter. |

### 7.5 Multi-Language Rules

| Rule | Requirement | Description |
|------|-------------|-------------|
| BR-65 | REQ-LANG-020 | Built-in server configs for: TypeScript (tsserver), ESLint, Go (gopls), Python (pyright), Rust (rust-analyzer). |
| BR-66 | REQ-LANG-030 | User-provided custom server configs used to start/manage specified LSP server for configured extensions. |

### 7.6 Observability Rules

| Rule | Requirement | Description |
|------|-------------|-------------|
| BR-67 | REQ-OBS-020 | Logged metrics: startup success/failure, crash counts, diagnostic latency, timeout rates, diagnostics per file. |
| BR-68 | REQ-OBS-030 | No LSP metrics or diagnostic data sent to remote telemetry. Local debug logs only. |

### 7.7 Timing Additional Rules

| Rule | Requirement | Description |
|------|-------------|-------------|
| BR-69 | REQ-TIME-015 | Multi-server diagnostic timeout bounds overall mutation latency (parallel, not additive). |
| BR-70 | REQ-TIME-070 | During cold-start, if initialization doesn't complete within firstTouchTimeout, mutation returns without diagnostics. |

### 7.8 Lifecycle Additional Rules

| Rule | Requirement | Description |
|------|-------------|-------------|
| BR-71 | REQ-LIFE-040 | All running LSP servers shut down when session ends. |
| BR-72 | REQ-LIFE-050 | Shutdown: send lsp/shutdown, wait briefly for graceful exit, then kill subprocess. |

### 7.9 Known-Files Additional Rules

| Rule | Requirement | Description |
|------|-------------|-------------|
| BR-73 | REQ-KNOWN-020 | File removed from known-files set when diagnostics become empty OR tracking server shuts down OR session ends. |

### 7.10 Format Additional Rules

| Rule | Requirement | Description |
|------|-------------|-------------|
| BR-74 | REQ-FMT-020 | Each file's diagnostics wrapped in `<diagnostics file="relpath">` XML-like tag with relative path. |

### 7.11 Diagnostic Feedback Additional Rules

| Rule | Requirement | Description |
|------|-------------|-------------|
| BR-75 | REQ-DIAG-017 | Apply-patch: collect diagnostics per modified file (single-file scope). Skip if only renames/deletes. |
| BR-76 | REQ-DIAG-050 | Write tool multi-file display: written file's diagnostics first ("in this file"), then others ("in other files"). |

### 7.12 Exclusions (Non-Goals)

| Rule | Requirement | Description |
|------|-------------|-------------|
| BR-77 | REQ-EXCL-020 | No auto-apply of LSP code actions. LLM receives diagnostics and decides how to fix. |
| BR-78 | REQ-EXCL-030 | No LSP-based formatting. Existing formatter infrastructure used. |
| BR-79 | REQ-EXCL-040 | No real-time/watch-mode diagnostics. Collection only after explicit file mutations. |
| BR-80 | REQ-EXCL-050 | No diagnostic rendering in TUI/IDE companion. Diagnostics for LLM consumption only via tool responses. |

### 7.13 Status Additional Rules

| Rule | Requirement | Description |
|------|-------------|-------------|
| BR-81 | REQ-STATUS-040 | `/lsp status` available regardless of `navigationTools: false`. Status visibility independent of nav tools. |

### 7.14 Research-Derived Concurrency & Safety Rules

| Rule | Source | Description |
|------|--------|-------------|
| BR-82 | Research Bug 1 | **Single-flight server startup**: Concurrent checkFile calls for the same server+workspace MUST deduplicate startup via `startupPromises` map. Only one `startServer()` call per clientKey at a time; concurrent callers await the same promise. |
| BR-83 | Research Bug 2 | **Diagnostic freshness epoch (server-authoritative)**: The Orchestrator maintains a monotonic `diagnosticEpoch` counter incremented on every `checkFile` call. Each LspClient also maintains its own `diagEpoch` incremented on every `publishDiagnostics`. The epoch is SERVER-AUTHORITATIVE: `LspServiceClient.getDiagnosticEpoch()` is an async RPC call (`lsp/getDiagnosticEpoch`) to the orchestrator — there is NO local epoch mirror in LspServiceClient. This eliminates divergence on error/abort paths where checkFile returns [] but the server-side epoch may or may not have incremented. The write tool captures `await getDiagnosticEpoch()` before checkFile, then calls `getAllDiagnosticsAfter(afterEpoch, waitMs)` which waits for the epoch to advance before snapshotting. `checkFile` returns `Diagnostic[]` — the freshness token is a separate mechanism. |
| BR-84 | Research Bug 3 | **Deadline-aware debounce**: The debounce timer in `waitForDiagnostics` MUST be clamped to `Math.min(150, deadline - now)` so it never pushes completion past the configured timeout. Late diagnostics still get a bounded settle chance. |
| BR-85 | Research Bug 4 | **Per-client operation queue**: Each LspClient is accessed through a `ClientOpQueue`. Writes (touchFile/didOpen/didChange) chain sequentially; reads (navigation) wait for prior writes but do not extend the chain. Different clients remain fully parallel. |
| BR-86 | Research Bug 5 | **First-touch one-shot semantics**: `firstTouchServers.delete(clientKey)` MUST execute in a `finally` block — cleared on success, timeout, AND non-crash error. Prevents permanent `firstTouchTimeout` inflation after a single failed attempt. |
| BR-87 | Research Bug 6 | **Segment-safe workspace boundary check**: `isWithinWorkspace` MUST verify `normalizedPath.charAt(normalizedRoot.length) === path.sep` after the `startsWith` check. Plain `startsWith("/workspace")` incorrectly matches `/workspace2/evil.ts`. |
| BR-88 | Research DD-1 | **Startup ready handshake**: Bun process sends `lsp/ready` JSON-RPC notification on stdout after setup completes. LspServiceClient waits for this notification (10s timeout) before setting `alive=true` and sending requests. |
| BR-89 | Research DD-2 | **Config passing via LSP_BOOTSTRAP**: Single `LSP_BOOTSTRAP` env var containing `{ workspaceRoot: string, config: LspConfig }` replaces separate `LSP_WORKSPACE_ROOT` + `LSP_CONFIG` env vars. Bun process parses and validates on startup. |
| BR-90 | Research DD-3 | **File content in checkFile**: `lsp/checkFile` request includes optional `text` field. When present, LSP service uses it as authoritative content for `didOpen`/`didChange` instead of reading from disk, avoiding write-then-read race conditions. |
| BR-91 | Research Source 4 | **Direct MCP Client for navigation**: LSP navigation tools use `@modelcontextprotocol/sdk` `Client` directly with a custom `Transport` wrapping fd3/fd4 streams. McpClientManager is NOT refactored; navigation uses `Client.connect(transport)` directly. |
| BR-92 | Research Source 5 | **Type duplication drift guard**: CI script compares `packages/core/src/lsp/types.ts` and `packages/lsp/src/types.ts`, failing the build if they have diverged. One contract test sends a message with all fields across the JSON-RPC boundary. |

### 7.15 Research-Derived Edge Cases

| # | Scenario | Expected Behavior | Source |
|---|----------|-------------------|--------|
| EC-46 | Two checkFile calls 50ms apart for same server | Only one server process started; second call awaits same startup promise | Research Bug 1 |
| EC-47 | Diagnostics arrive at T=timeout-100ms | Debounce clamped to min(150, 100) = 100ms; resolves at T=timeout, not T=timeout+50ms | Research Bug 3 |
| EC-48 | gotoDefinition during active checkFile on same client | Navigation read waits for prior touchFile write via ClientOpQueue | Research Bug 4 |
| EC-49 | First-touch timeout, then second checkFile | Second call uses `diagnosticTimeout` (not `firstTouchTimeout`); flag was cleared in `finally` | Research Bug 5 |
| EC-50 | checkFile with path `/workspace2/evil.ts` where root is `/workspace` | Rejected by segment-safe boundary check (startsWith matches but no path separator at boundary) | Research Bug 6 |
| EC-51 | checkFile with path `/workspace-backup/file.ts` where root is `/workspace` | Rejected by segment-safe boundary check | Research Bug 6 |
| EC-52 | LSP service takes 12s to start (no lsp/ready within 10s) | LspServiceClient marks service as dead, alive stays false | Research DD-1 |

---

## 8. Requirement Coverage Matrix

Every REQ-* ID from requirements.md is traceable to a specific domain model section.

| Requirement Area | REQ IDs | Domain Model Section |
|-----------------|---------|---------------------|
| Diagnostic Feedback | REQ-DIAG-010, 015, 017, 020, 030, 040, 045, 050, 060, 070 | §3.1 (BR-1 through BR-3, BR-6, BR-7, BR-17, BR-36), §7.11 (BR-75, BR-76), §4.3 |
| Diagnostic Format | REQ-FMT-010, 020, 030, 040, 050, 055, 060, 065, 066, 067, 068, 070, 080, 090 | §3.1 (BR-4 through BR-9, BR-16, BR-38, BR-39), §7.10 (BR-74), §4.3 |
| Timing | REQ-TIME-010, 015, 020, 030, 040, 050, 060, 070, 080, 085, 090 | §3.1 (BR-14, BR-15), §7.7 (BR-69, BR-70), §4.2 |
| Scope | REQ-SCOPE-010, 020, 025, 030 | §3.1 (BR-10 through BR-12), §4.6 |
| Known Files | REQ-KNOWN-010, 020, 030 | §1.1 (DiagnosticMap), §3.1 (BR-35), §7.9 (BR-73), §4.5 (EC-42, EC-43) |
| Navigation | REQ-NAV-010, 020, 030, 040, 050, 055, 060 | §1.2, §3.4 (BR-34), §7.2 (BR-51 through BR-55) |
| Lifecycle | REQ-LIFE-010, 020, 030, 040, 050, 060, 070, 080, 090 | §2.1, §2.2, §2.4, §3.2, §7.8 (BR-71, BR-72) |
| Architecture | REQ-ARCH-010, 020, 030, 040, 050, 060, 070, 080, 090 | §1.1, §1.2, §6, §7.1 (BR-45 through BR-50) |
| Graceful Degradation | REQ-GRACE-010, 020, 030, 040, 045, 050, 055 | §3.1 (BR-13, BR-37), §4.1, §5 |
| Configuration | REQ-CFG-010, 015, 020, 030, 040, 050, 055, 060, 070, 080 | §3.3 (BR-25 through BR-30, BR-40), §7.4 (BR-62 through BR-64), §4.5 |
| Multi-Language | REQ-LANG-010, 020, 030, 040 | §1.1 (ServerConfig, LanguageMap), §7.5 (BR-65, BR-66) |
| Boundary | REQ-BOUNDARY-010, 020, 030 | §3.4 (BR-31 through BR-33), §4.4 |
| Status | REQ-STATUS-010, 020, 025, 030, 035, 040, 045, 050 | §3.3 (BR-41 through BR-44), §7.13 (BR-81), §4.5 (EC-35, EC-40, EC-41) |
| Observability | REQ-OBS-010, 020, 030 | §5, §7.6 (BR-67, BR-68) |
| Packaging | REQ-PKG-010, 020, 025, 030, 040, 050, 060 | §7.3 (BR-56 through BR-61) |
| Exclusions | REQ-EXCL-010, 020, 030, 040, 050 | §7.12 (BR-77 through BR-80). REQ-EXCL-010 is implicit (no completion tool exists). |
