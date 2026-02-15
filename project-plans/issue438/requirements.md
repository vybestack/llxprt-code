# LSP Integration — Requirements (EARS Format)

## Issue Reference

- **Issue**: #438 — Support LSP Servers
- **Related**: [overview.md](./overview.md), [technical-overview.md](./technical-overview.md)

## About This Document

Requirements are expressed using the **EARS** (Easy Approach to Requirements Syntax) templates:

| Template | Pattern |
|----------|---------|
| Ubiquitous | The \<system\> shall \<action\>. |
| Event-driven | **When** \<trigger\>, the \<system\> shall \<action\>. |
| State-driven | **While** \<state\>, the \<system\> shall \<action\>. |
| Unwanted behaviour | **If** \<unwanted condition\>, **then** the \<system\> shall \<action\>. |
| Optional feature | **Where** \<feature is included\>, the \<system\> shall \<action\>. |
| Complex | **While** \<state\>, **when** \<trigger\>, the \<system\> shall \<action\>. |

Each requirement has a unique ID of the form `REQ-<area>-<number>`.

---

## 1 — Diagnostic Feedback After File Mutations

### 1.1 Single-File Diagnostics (Edit / Apply-Patch Tools)

**REQ-DIAG-010**
**When** the LLM uses the edit tool to modify a file and an LSP server is available for that file's language, the system shall append any error-level diagnostics detected by the LSP server to the edit tool's `llmContent` response, after the success message.

**REQ-DIAG-015**
**When** the LLM uses the apply-patch tool to modify file content and an LSP server is available for the affected file's language, the system shall append error-level diagnostics to the tool's `llmContent` response, using the same formatting and limits as the edit tool.

**REQ-DIAG-017**
**When** apply-patch writes file content, the system shall collect diagnostics for each modified file using single-file scope. **If** apply-patch only renames or deletes files without writing content, **then** the system shall not collect diagnostics.

**REQ-DIAG-020**
**When** a mutation tool (edit, write-file, or apply-patch) modifies a file, the system shall complete the file write and return a clear success confirmation before collecting or appending any diagnostics, so that diagnostics cannot be misinterpreted as a mutation failure.

**REQ-DIAG-030**
**When** the edit or apply-patch tool modifies a file, the system shall report diagnostics only for the edited file (single-file scope).

### 1.2 Multi-File Diagnostics (Write Tool)

**REQ-DIAG-040**
**When** the LLM uses the write-file tool to write a file and an LSP server is available for that file's language, the system shall append error-level diagnostics for the written file and for other affected files to the tool's `llmContent` response.

**REQ-DIAG-045**
**When** the write-file tool includes diagnostics for other affected files, the system shall select those files from the known-files set (files with non-empty current diagnostics from `publishDiagnostics` notifications).

**REQ-DIAG-050**
**When** the write-file tool produces multi-file diagnostics, the system shall display the written file's diagnostics first, labelled "LSP errors detected in this file," followed by other files' diagnostics, labelled "LSP errors detected in other files."

**REQ-DIAG-060**
**When** the write-file tool produces multi-file diagnostics, the system shall cap other-file diagnostics at a maximum of 5 files (configurable via `maxProjectDiagnosticsFiles`).

**REQ-DIAG-070**
**When** the write-file tool produces multi-file diagnostics, the system shall cap total diagnostic lines across all files at 50, stopping the inclusion of further files once the cap is reached.

### 1.3 Diagnostic Output Format

**REQ-FMT-010**
The system shall format each diagnostic line as: `SEVERITY [line:col] message (code)`.

**REQ-FMT-020**
The system shall wrap each file's diagnostics in a `<diagnostics file="relpath">` XML-like tag, where the file path is relative to the workspace root.

**REQ-FMT-030**
The system shall order diagnostics within a file by line number ascending.

**REQ-FMT-040**
The system shall escape `<`, `>`, and `&` characters in diagnostic message text to `&lt;`, `&gt;`, and `&amp;` respectively.

**REQ-FMT-050**
The system shall cap displayed diagnostics at a maximum of 20 error-level diagnostics per file (configurable via `maxDiagnosticsPerFile`).

**REQ-FMT-055**
**If** diagnostics for a file exceed `maxDiagnosticsPerFile`, **then** the system shall append an overflow count line (e.g., `... and 7 more`).

**REQ-FMT-060**
The system shall include only error-level diagnostics (LSP severity 1) by default.

**REQ-FMT-065**
**Where** `includeSeverities` is configured, the system shall include exactly the configured severity levels in diagnostic output, replacing the default error-only filter.

**REQ-FMT-066**
**Where** `includeSeverities` is configured, the system shall apply `maxDiagnosticsPerFile` to the total displayed diagnostics after severity filtering.

**REQ-FMT-067**
**Where** `includeSeverities` is configured, the system shall apply the configured severity filter consistently across mutation-tool diagnostic output, `lsp/checkFile` responses, and `lsp/diagnostics` responses.

**REQ-FMT-068**
**When** applying severity filters and diagnostic limits, the system shall apply them in the following order: severity filtering first, then per-file cap (`maxDiagnosticsPerFile`), then total multi-file line cap. Overflow suffix lines (e.g., `... and N more`) shall not count toward the total multi-file line cap.

**REQ-FMT-070**
**When** multiple LSP servers produce diagnostics for the same file, the system shall deduplicate diagnostics that share the same file, range, and message.

**REQ-FMT-080**
The system shall convert LSP 0-based line and character positions to 1-based for display.

**REQ-FMT-090**
**When** displaying multi-file diagnostics, the system shall order files deterministically: the edited/written file first, then other files sorted alphabetically by path.

### 1.4 Diagnostic Timing

**REQ-TIME-010**
**When** collecting diagnostics after a file mutation, the system shall await LSP server responses with a bounded timeout (default 3000 ms, configurable via `diagnosticTimeout`).

**REQ-TIME-015**
**When** collecting diagnostics from multiple applicable servers for one file, the system shall apply the diagnostic timeout in a way that bounds overall mutation response latency (i.e., parallel collection, not additive sequential timeouts).

**REQ-TIME-020**
**If** the LSP server does not respond within the configured timeout, **then** the system shall return the edit/write success response without diagnostics and without an error or timeout message.

**REQ-TIME-030**
**When** an LSP server is started for the first time (cold start), the system shall use an extended first-touch timeout (default 10000 ms, configurable via `firstTouchTimeout`) to allow for server initialization.

**REQ-TIME-040**
**When** collecting diagnostics from multiple LSP servers for a single file (e.g., tsserver and eslint for `.ts` files), the system shall collect diagnostics from all servers in parallel, not sequentially.

**REQ-TIME-050**
**When** awaiting diagnostics from an LSP server, the system shall apply a 150 ms debounce period to allow rapid successive diagnostic updates from the server to settle before returning results.

**REQ-TIME-060**
**When** diagnostics are returned after a file mutation, the system shall treat them as a best-effort snapshot at the point the timeout expires or the server responds, whichever comes first. Partial or stale results are acceptable.

**REQ-TIME-070**
**While** a language server is cold-starting, **when** a first-touch file mutation occurs, the system shall allow the mutation response to be returned without diagnostics if server initialization does not complete within the first-touch timeout.

**REQ-TIME-080**
**When** awaiting diagnostics for a file mutation, the system shall honour request cancellation or abort signals and shall terminate diagnostic collection without failing the mutation operation.

**REQ-TIME-085**
**If** diagnostics from only a subset of applicable LSP servers are available before the timeout expires, **then** the system shall return the available subset and shall not fail the mutation operation.

**REQ-TIME-090**
**While** a language server is in first-touch initialization, **when** collecting diagnostics, the system shall apply `firstTouchTimeout` for that server. Once a server has completed initialization, the system shall apply `diagnosticTimeout` for subsequent diagnostic collections.

### 1.5 Scope Restrictions

**REQ-SCOPE-010**
The system shall collect diagnostics only for text/code files. Binary file writes shall be ignored by the LSP subsystem.

**REQ-SCOPE-020**
The system shall not collect diagnostics for file deletion or rename operations. Only file content writes shall trigger diagnostic collection.

**REQ-SCOPE-025**
**If** an apply-patch operation only deletes or renames files without writing file content, **then** the system shall not trigger diagnostic collection and shall not start any LSP servers for that operation.

**REQ-SCOPE-030**
The system shall store only the formatted diagnostic string in `llmContent`. Raw LSP diagnostic objects shall not be stored in session message metadata or history.

### 1.6 Known-Files Set

**REQ-KNOWN-010**
The system shall define "known files" as the set of all files for which active LSP server(s) currently hold non-empty diagnostics, as received via `textDocument/publishDiagnostics` notifications. This set determines which other files are included in multi-file diagnostic output.

**REQ-KNOWN-020**
**When** a file's current diagnostics become empty, or **when** the tracking server shuts down or the session ends, the system shall remove that file from the known-files set.

**REQ-KNOWN-030**
**When** multiple LSP servers track the same file (e.g., tsserver and eslint for a `.ts` file), the known-files set shall include that file if any active server holds non-empty diagnostics for it. The file shall be removed from the set only when all servers' diagnostics for it are empty or all tracking servers have shut down.

---

## 2 — LSP Navigation Tools (MCP)

**REQ-NAV-010**
**Where** LSP is enabled and navigation tools are not disabled (`navigationTools` is not `false`), the system shall expose the following tools to the LLM via MCP: `lsp_goto_definition`, `lsp_find_references`, `lsp_hover`, `lsp_document_symbols`, `lsp_workspace_symbols`, and `lsp_diagnostics`.

**REQ-NAV-020**
The system shall expose LSP navigation tools as a standard MCP server, so that they appear in the LLM's tool list alongside other MCP tools.

**REQ-NAV-030**
The system shall enforce workspace boundary checks on all navigation tool file path parameters, refusing to operate on files outside the workspace root.

**REQ-NAV-040**
The system shall normalize file paths passed to navigation tools before checking workspace boundaries or forwarding them to LSP servers.

**REQ-NAV-050**
**Where** `lsp.navigationTools` is set to `false`, the system shall hide LSP navigation tools from the LLM while preserving diagnostic feedback functionality.

**REQ-NAV-055**
The system shall register LSP navigation tools in the LLM's MCP tool list only after the LSP service process has started successfully. **If** the LSP service fails to start, **then** navigation tools shall not be registered.

**REQ-NAV-060**
**When** the LLM invokes the `lsp_diagnostics` tool, the system shall return current diagnostics for all known files, using workspace-relative paths and deterministic alphabetical file ordering.

---

## 3 — Server Lifecycle

### 3.1 Lazy Startup

**REQ-LIFE-010**
**When** the first file of a given language is touched (edited or written), the system shall start the appropriate LSP server(s) if not already running.

**REQ-LIFE-020**
The system shall not start any LSP servers at session startup. Servers shall be started on demand based on file extensions.

**REQ-LIFE-030**
**When** starting an LSP server, the system shall detect the workspace root by locating the nearest relevant project marker file (e.g., `package.json` for TypeScript, `go.mod` for Go, `Cargo.toml` for Rust).

### 3.2 Shutdown

**REQ-LIFE-040**
**When** the LLxprt session ends, the system shall shut down all running LSP servers.

**REQ-LIFE-050**
**When** shutting down the LSP service, the system shall send an `lsp/shutdown` request, wait briefly for graceful exit, then kill the subprocess.

**REQ-LIFE-060**
The system shall clean up diagnostic and file tracking maps to prevent memory leaks. Cleanup shall be triggered on: individual language server shutdown, LSP service process exit, and LLxprt session end.

### 3.3 Crash Handling

**REQ-LIFE-070**
**If** an individual LSP server crashes, **then** the system shall mark it as `broken` and shall not restart it for the remainder of the session.

**REQ-LIFE-080**
**If** the LSP service process itself dies (the Bun subprocess, not an individual language server), **then** the system shall not restart it. All LSP functionality shall degrade gracefully to "no diagnostics" for the rest of the session.

**REQ-LIFE-090**
**While** an LSP server is marked as `broken`, **when** the LLM edits a file of that server's language, the system shall proceed without diagnostics and without error.

---

## 4 — Process Isolation & Architecture

**REQ-ARCH-010**
The system shall run the LSP subsystem in a separate Bun-native child process, isolated from the main LLxprt agent process (Node.js).

**REQ-ARCH-020**
The system shall use JSON-RPC over stdin/stdout for the internal diagnostic channel between the agent process and the LSP service process.

**REQ-ARCH-030**
The system shall use MCP over extra file descriptors (fd3/fd4) for the navigation tool channel between the agent process and the LSP service process.

**REQ-ARCH-040**
The system shall share a single LSP orchestrator instance and a single set of language server connections between the diagnostic channel and the navigation tool channel within the LSP service process.

**REQ-ARCH-050**
The system shall not use any Bun-specific APIs in the core package (`packages/core/`). All Bun-specific code shall reside in `packages/lsp/`.

**REQ-ARCH-060**
The system shall add only `vscode-jsonrpc` as a new dependency to the core package. This dependency shall be pure JavaScript with zero native modules.

**REQ-ARCH-070**
The system shall expose the following internal JSON-RPC methods over the stdin/stdout channel between core and the LSP service: `lsp/checkFile`, `lsp/diagnostics`, `lsp/status`, and `lsp/shutdown`.

**REQ-ARCH-080**
**When** returning results from the `lsp/diagnostics` method, the system shall order file keys deterministically in ascending alphabetical path order.

**REQ-ARCH-090**
**While** both the internal diagnostic channel and the MCP navigation channel are active, the system shall reuse a single orchestrator and shall not spawn duplicate language-server processes for the same server and workspace root pair.

---

## 5 — Graceful Degradation

**REQ-GRACE-010**
**If** no LSP server is available for a file's language, **then** the system shall let the edit/write tool behave exactly as it does without LSP — no error, no degradation, no diagnostics appended.

**REQ-GRACE-020**
**If** the Bun runtime is not available on the system (not installed or not in PATH), **then** the system shall silently disable all LSP functionality with no user-visible error, emitting only a debug-level log message.

**REQ-GRACE-030**
**If** the `@vybestack/llxprt-code-lsp` package is not installed, **then** the system shall silently disable all LSP functionality with no user-visible error.

**REQ-GRACE-040**
**If** the LSP service is unavailable or has crashed, **then** `LspServiceClient.isAlive()` shall return `false`, and all subsequent `checkFile()` calls shall return an empty array immediately.

**REQ-GRACE-045**
**If** LSP service startup fails (because Bun is unavailable, the LSP package is missing, or the subprocess fails to spawn), **then** the system shall keep LSP permanently disabled for the remainder of the session and shall not retry startup.

**REQ-GRACE-050**
The system shall wrap every call from mutation tools (edit, write-file, apply-patch) to the LSP service in a try/catch block. A crashing, hanging, or error-returning LSP service shall never cause a mutation tool invocation to fail.

**REQ-GRACE-055**
**If** any LSP interaction fails during a file mutation (crash, timeout, error, or unavailability), **then** the system shall return the normal mutation success response with no user-visible LSP error or timeout text.

---

## 6 — Configuration

**REQ-CFG-010**
The system shall support disabling LSP entirely via `"lsp": false` in user configuration, which shall prevent starting any LSP servers, appending any diagnostics, and exposing any navigation tools.

**REQ-CFG-015**
The system shall support zero-configuration LSP operation: **when** the `lsp` configuration key is absent, the system shall treat LSP as enabled by default, subject to runtime and package availability.

**REQ-CFG-020**
The system shall treat the presence of an `"lsp": { ... }` object in configuration as enabling LSP. There shall be no separate `enabled` boolean within the object.

**REQ-CFG-030**
**Where** LSP is enabled, the system shall allow disabling individual LSP servers via `"lsp": { "servers": { "<serverId>": { "enabled": false } } }`.

**REQ-CFG-040**
**Where** LSP is enabled, the system shall allow users to define custom LSP server configurations specifying command, arguments, file extensions, environment variables, and initialization options.

**REQ-CFG-050**
**Where** LSP is enabled, the system shall allow users to configure the diagnostic wait timeout via `diagnosticTimeout`.

**REQ-CFG-055**
**Where** LSP is enabled, the system shall allow users to configure the cold-start first-touch timeout via `firstTouchTimeout`.

**REQ-CFG-060**
**Where** LSP is enabled, the system shall allow users to configure included diagnostic severity levels via `includeSeverities`.

**REQ-CFG-070**
**Where** LSP is enabled, the system shall allow users to disable navigation tools independently of diagnostic feedback via `"lsp": { "navigationTools": false }`.

**REQ-CFG-080**
The system shall only allow custom server `command` and `env` settings via user configuration files, never via LLM-accessible tool calls.

---

## 7 — Multi-Language Support

**REQ-LANG-010**
The system shall provide an extensible language mapping and server registry architecture that supports any language for which an LSP server exists, through built-in or user-defined server configurations, using file extension–to–LSP language ID mapping.

**REQ-LANG-020**
The system shall provide built-in server configurations for at least: TypeScript (`tsserver`), ESLint, Go (`gopls`), Python (`pyright`), and Rust (`rust-analyzer`) in the initial implementation. Additional built-in languages (e.g., Java, C/C++) may be added incrementally.

**REQ-LANG-030**
**Where** a custom server configuration is provided by the user, the system shall use that configuration to start and manage the specified LSP server for the configured file extensions.

**REQ-LANG-040**
**When** multiple LSP servers apply to a single file extension (e.g., tsserver + eslint for `.ts`), the system shall start all applicable servers and collect diagnostics from each in parallel.

---

## 8 — Workspace Boundary Enforcement

**REQ-BOUNDARY-010**
The system shall enforce workspace boundary checks at the LSP service (orchestrator) layer, rejecting any files outside the workspace root regardless of what the caller passes.

**REQ-BOUNDARY-020**
The system shall not start LSP servers for files outside the workspace root, including system paths or other external directories.

**REQ-BOUNDARY-030**
The system shall normalize file paths before checking workspace boundaries.

---

## 9 — Status Visibility

**REQ-STATUS-010**
The system shall expose LSP server status via a slash command (e.g., `/lsp status`).

**REQ-STATUS-020**
**When** the user invokes `/lsp status`, the system shall report each known server with one of the following statuses: `active`, `starting`, `broken`, `disabled`, or `unavailable`.

**REQ-STATUS-025**
**When** reporting `/lsp status`, the system shall include all known and configured servers tracked by the LSP service (built-in and user-defined custom), each shown with one of the defined statuses.

**REQ-STATUS-030**
**If** the LSP service itself is unavailable (Bun not installed, LSP package not present), **then** `/lsp status` shall display a single line: `LSP unavailable: <reason>`.

**REQ-STATUS-035**
**If** `/lsp status` reports LSP as unavailable, **then** the reason shall reflect the specific startup failure cause (e.g., "Bun not found in PATH," "LSP package not installed," or "service startup failed").

**REQ-STATUS-040**
The `/lsp status` command shall remain available regardless of whether navigation tools are disabled via `lsp.navigationTools: false`. Status visibility is independent of navigation tool exposure.

**REQ-STATUS-045**
**When** the user invokes `/lsp status`, the system shall order reported servers deterministically by server ID in ascending alphabetical order.

**REQ-STATUS-050**
**If** `lsp` is configured as `false`, **then** the system shall keep `/lsp status` available and shall report that LSP is disabled by configuration.

---

## 10 — Observability

**REQ-OBS-010**
The system shall log LSP operational metrics via the existing `DebugLogger` infrastructure at debug log level, visible only when the user enables debug logging.

**REQ-OBS-020**
The system shall log server startup success/failure counts, crash counts, diagnostic collection latency, diagnostic timeout rates, and diagnostic counts per file.

**REQ-OBS-030**
The system shall not send any LSP metrics or diagnostic data to any remote telemetry service.

---

## 11 — Code Quality & Packaging

**REQ-PKG-010**
The `packages/lsp/` package shall not be included in the root npm `workspaces` array, following the `packages/ui/` precedent.

**REQ-PKG-020**
The `packages/lsp/` package shall have its own `eslint.config.cjs`, `tsconfig.json`, and CI steps, following the `packages/ui/` precedent.

**REQ-PKG-025**
The CI pipeline shall run at minimum lint, typecheck, and test for `packages/lsp/` as separate steps.

**REQ-PKG-030**
The `packages/lsp/` package shall enforce a max-lines lint rule of 800 lines per file. The server registry shall be decomposed to stay within this limit.

**REQ-PKG-040**
The `packages/lsp/` package shall enforce strict TypeScript rules including `no-unsafe-assignment`, `no-unsafe-member-access`, and `no-unsafe-return` to force typing of LSP server responses.

**REQ-PKG-050**
The system shall duplicate the shared types (`Diagnostic`, `ServerStatus`, `LspConfig`) in both `packages/lsp/src/types.ts` and `packages/core/src/lsp/types.ts` to avoid cross-boundary build complexity between the Bun-native package and the Node.js core package.

**REQ-PKG-060**
The root `eslint.config.js` shall add `packages/lsp/**` to its ignore list. Linting for the LSP package shall be enforced by its own local ESLint configuration.

---

## 12 — Non-Goals (Explicit Exclusions)

**REQ-EXCL-010**
The system shall not integrate LSP code completion or autocomplete capabilities.

**REQ-EXCL-020**
The system shall not automatically apply LSP code actions or auto-fixes. The LLM shall receive diagnostics and decide how to fix them.

**REQ-EXCL-030**
The system shall not provide LSP-based formatting. Existing formatter infrastructure shall be used.

**REQ-EXCL-040**
The system shall not implement real-time or watch-mode diagnostic polling. Diagnostics shall only be collected after explicit file mutations.

**REQ-EXCL-050**
The system shall not render diagnostics in the TUI or IDE companion. Diagnostics are for the LLM's consumption only, appended to tool responses.


---

## 13 — Research-Driven Requirements

### 13.1 Startup Protocol

**REQ-START-010**
**When** the LSP service process (Bun) completes initialization, the system shall send an `lsp/ready` JSON-RPC notification on stdout before accepting any requests.

**REQ-START-020**
**When** the LspServiceClient spawns the LSP service process, the system shall wait for the `lsp/ready` notification with a bounded timeout (default 10000 ms, configurable via `firstTouchTimeout`). **If** the notification is not received within the timeout, **then** the system shall mark the service as permanently dead.

**REQ-START-030**
The system shall pass LSP configuration and workspace root to the LSP service process via a single `LSP_BOOTSTRAP` environment variable containing a JSON object with `workspaceRoot` (string) and `config` (LspConfig) fields.

**REQ-START-040**
**When** the LSP service process receives `LSP_BOOTSTRAP`, the system shall validate that `workspaceRoot` is a non-empty string and that `config` (if present) is a valid object. **If** validation fails, **then** the service shall write an error to stderr and exit with code 1.

### 13.2 Concurrency Safety

**REQ-CONC-010**
**When** multiple concurrent requests trigger startup of the same LSP server (same server ID and workspace root), the system shall use a single-flight guard to ensure only one server process is spawned, with subsequent requests awaiting the same startup promise.

**REQ-CONC-020**
**When** the orchestrator receives concurrent diagnostic collection and navigation requests for the same LSP client, the system shall serialize write operations (didOpen/didChange) and allow read operations (definition/references/hover) to proceed after prior writes complete, using per-client operation queuing.

### 13.3 Timing Robustness

**REQ-TIMING-010**
**When** awaiting diagnostics with a debounce period, the system shall clamp the debounce delay to the lesser of the configured debounce period (150 ms) and the remaining time until the overall deadline, ensuring the debounce never causes the response to exceed the configured timeout.

**REQ-TIMING-020**
**When** a server's first-touch diagnostic collection completes (whether by success, timeout, or non-crash error), the system shall clear the first-touch state for that server, ensuring subsequent collections use the normal diagnostic timeout. First-touch shall be a one-shot opportunity.

### 13.4 File Content Handling

**REQ-CONTENT-010**
**When** the `lsp/checkFile` request includes a `text` field, the system shall use the provided text as the authoritative file content for `textDocument/didOpen` or `textDocument/didChange` notifications to the LSP server, rather than reading from disk.

**REQ-CONTENT-020**
**If** the `lsp/checkFile` request does not include a `text` field, **then** the system shall read file content from disk as a fallback.

### 13.5 Path Boundary Safety

**REQ-PATH-010**
**When** checking whether a file path is within the workspace root, the system shall use a segment-safe boundary check that verifies the character immediately after the workspace root prefix is a path separator, preventing prefix-collision attacks (e.g., `/workspace2/` matching `/workspace`).

### 13.6 Navigation Tool Registration

**REQ-NAVR-010**
**When** registering LSP navigation tools, the system shall create an MCP SDK Client directly with a custom Transport wrapping the fd3/fd4 streams of the LSP service subprocess, bypassing McpClientManager. Tool discovery and registration in the ToolRegistry shall follow the same pattern as other MCP tool registration.

### 13.7 Type Safety Across Process Boundary

**REQ-DRIFT-010**
The CI pipeline shall include a check that the shared type definitions in `packages/core/src/lsp/types.ts` and `packages/lsp/src/types.ts` are identical, failing the build if they diverge.

**REQ-DRIFT-020**
The E2E test suite shall include a contract test that sends a fully-populated Diagnostic object through the JSON-RPC boundary and verifies deep equality on deserialization, catching field additions, removals, or type changes.
