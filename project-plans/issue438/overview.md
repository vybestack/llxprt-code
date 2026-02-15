# LSP Integration — Functional Specification

## Issue Reference

- **Issue**: #438 — Support LSP Servers
- **Label**: Tooling
- **State**: OPEN

## Problem Statement

When the LLM edits or writes a file, it currently receives no immediate feedback about whether the change introduced type errors, lint violations, or other structural problems. The only way to discover these issues is to run the full build/lint pipeline — a slow, coarse-grained process that wastes tokens, time, and user patience.

Language Server Protocol (LSP) servers provide real-time, incremental diagnostics for exactly this purpose. Every major language has one (TypeScript's `tsserver`, Go's `gopls`, Python's `pyright`, Rust's `rust-analyzer`, etc.). IDEs use them to show red squiggles instantly after every keystroke. LLxprt should use them to show the LLM red squiggles instantly after every edit.

## Design Goals

1. **Automatic diagnostic feedback on file mutations**: After any edit, write, or patch tool modifies a file, the LLM automatically receives LSP diagnostics (errors and warnings) as part of the tool response — without the LLM needing to request them.

2. **Navigation tools available to the LLM**: A separate, opt-in set of LSP-powered tools (go-to-definition, find-references, hover, document symbols, workspace symbols) is exposed to the LLM as callable tools via MCP, enabling deeper code understanding when needed.

3. **Multi-language support**: The system supports any language for which an LSP server exists. Built-in support for common languages (TypeScript, ESLint, Go, Python, Rust, Java, C/C++, etc.) with user-extensible configuration for custom servers.

4. **Zero-configuration startup**: For projects using common languages, LSP servers are auto-detected and started lazily (on first relevant file touch). Users should not need to configure anything for the typical case.

5. **Graceful degradation**: If no LSP server is available for a language, or if a server crashes or hangs, the edit/write tools behave exactly as they do today — no error, no degradation, just no diagnostics appended.

6. **Process isolation**: The LSP subsystem runs in a separate process. Crashes, memory leaks, or hangs in language servers do not affect the main LLxprt agent process.

7. **Configurable**: Users can disable LSP entirely, disable individual servers, or add custom server configurations.

## User-Facing Behaviors

### B1: Diagnostic Feedback After Edits

**When** the LLM uses the edit, write-file, or apply-patch tool to modify a file,
**and** an LSP server is available for that file's language,
**then** the tool response includes any error-level diagnostics detected by the LSP server, appended to the tool's `llmContent` string.

The edit itself always succeeds first. Diagnostics are supplemental feedback appended after the success message. The LLM sees the edit confirmation AND the diagnostics in a single response.

Example LLM-visible output after a successful edit that introduces a type error:

```
Successfully modified file: /project/src/utils.ts (1 replacements).

LSP diagnostics after edit:
<diagnostics file="utils.ts">
ERROR [42:5] Type 'string' is not assignable to type 'number'. (ts2322)
ERROR [43:10] Property 'foo' does not exist on type 'Bar'. (ts2339)
</diagnostics>
```

The LLM sees these diagnostics in the same response and can self-correct on the next turn without the user intervening or running a build.

**Output format contract:**
- File paths in `<diagnostics>` tags use **relative paths** (relative to workspace root) for readability.
- Diagnostics within a file are ordered by **line number ascending**.
- Each diagnostic line format: `SEVERITY [line:col] message (code)` — matching OpenCode's `Diagnostic.pretty()` format.
- The `<diagnostics>` tag wraps each file's diagnostics separately.
- Messages are sanitized: `<`, `>`, and `&` in diagnostic text are escaped to `&lt;`, `&gt;`, `&amp;` to avoid breaking the XML-like framing.

**Diagnostic limits:**
- Per-file cap: maximum 20 error-level diagnostics per file. If more exist, a count of remaining errors is appended (e.g., `... and 7 more`). This matches OpenCode's `MAX_DIAGNOSTICS_PER_FILE`.

**Severity filtering:** Only error-level diagnostics (LSP severity 1) are included by default. Warnings (severity 2) and info/hint are omitted unless configured otherwise.

**Timeout behavior:** Diagnostics are awaited with a bounded timeout. If the LSP server does not respond in time, the edit succeeds without diagnostics. No timeout message is shown to the LLM. Diagnostics are best-effort: they represent a snapshot at the point the timeout expires or the server responds, whichever comes first. Stale or partial results are acceptable — the next edit will get fresh diagnostics.

**First-touch behavior:** When an LSP server is started for the first time (cold start), the server initialization may take longer than the normal diagnostic timeout. In this case, the first edit for a new language may return without diagnostics. Subsequent edits will have the server warm and respond within timeout. An extended first-touch timeout (e.g., 10 seconds) may be used to give the server time to initialize.

**Binary/non-text files:** Diagnostic collection only applies to text/code files. Binary file writes are ignored by the LSP subsystem.

### B2: Multi-File Awareness

**When** the LLM writes a file that may cause errors in other open/known files (e.g., changing an interface that is imported elsewhere),
**then** diagnostics from affected files are also included.

This prevents the situation where the LLM edits `types.ts`, sees no errors in that file, but unknowingly breaks 5 importers.

**Multi-file behavior follows OpenCode's write tool pattern:**
- The edited file's diagnostics appear first, labeled "LSP errors detected in this file."
- Other affected files appear after, labeled "LSP errors detected in other files."
- Other-file diagnostics are capped at **5 files** (OpenCode's `MAX_PROJECT_DIAGNOSTICS_FILES`) to prevent context explosion.
- Within each file, the same per-file cap (20 errors) applies.
- **Total diagnostic lines across all files are capped at 50.** If the edited file alone has 50 errors, no other-file diagnostics are shown. This prevents context bloat regardless of how many files are affected.
- Files are ordered deterministically: the edited file first, then other files sorted by file path.

**"Known files"** means: all files for which the LSP server(s) currently have non-empty diagnostics. This is the set returned by the LSP's `textDocument/publishDiagnostics` notifications across all active servers. It does not require explicitly opening or scanning files.

**Edit tool vs write tool behavior:**
- The **edit tool** only reports diagnostics for the edited file (single-file context, matching OpenCode's edit tool behavior).
- The **write tool** reports diagnostics for the written file AND other affected files (multi-file context, matching OpenCode's write tool behavior). Write operations are more likely to affect other files (e.g., creating/rewriting a module that others import).

### B3: LSP Navigation Tools (MCP)

**When** LSP is enabled and navigation tools are not explicitly disabled,
**then** the LLM has access to the following tools via MCP:

| Tool | Description |
|------|-------------|
| `lsp_goto_definition` | Navigate to the definition of a symbol at a given position |
| `lsp_find_references` | Find all references to a symbol at a given position |
| `lsp_hover` | Get type information and documentation for a symbol |
| `lsp_document_symbols` | List all symbols (functions, classes, variables) in a file |
| `lsp_workspace_symbols` | Search for symbols across the entire workspace |
| `lsp_diagnostics` | Retrieve current diagnostics for all known files |

These tools are exposed as a standard MCP server. They appear in the LLM's tool list alongside other MCP tools and can be called directly by the LLM when it needs to understand code structure.

**This is separate from B1.** B1 is automatic — diagnostics are appended to edit/write responses without the LLM requesting them. B3 is explicit — the LLM chooses to call these tools. The B3 MCP tools can be disabled independently of B1 diagnostic feedback.

**Workspace boundary enforcement:** Navigation tools refuse to operate on files outside the workspace root. Paths are normalized and checked before being passed to LSP servers. This prevents the LLM from using LSP to explore `node_modules`, system files, or other external directories.

### B4: Lazy Server Startup

**When** the first file of a given language is touched (edited/written),
**then** the appropriate LSP server(s) are started if not already running.

Servers are not started at session startup. They are started on demand based on file extensions. If the LLM only edits `.ts` files, only the TypeScript LSP server starts. If it later edits a `.go` file, `gopls` starts at that point.

**Workspace root detection:** Each LSP server is scoped to a workspace root, detected by looking for the nearest relevant project file (e.g., `package.json` for TypeScript, `go.mod` for Go, `Cargo.toml` for Rust). In monorepo structures, the root is chosen per-file based on the nearest project marker.

### B5: Configuration

Users can configure LSP behavior in their LLxprt settings:

- **Disable entirely**: `"lsp": false` — no LSP servers are started, no diagnostics appended, no navigation tools available. If the `@vybestack/llxprt-code-lsp` package is not installed, LSP is also implicitly disabled with no error.
- **Configure (enabled by default)**: `"lsp": { ... }` — if `lsp` is an object, LSP is enabled. No separate `enabled` field. Presence of the object implies enabled.
- **Disable specific servers**: `"lsp": { "servers": { "eslint": { "enabled": false } } }` — disables a specific server while leaving others active.
- **Custom servers**: Users can define custom LSP server configurations specifying the command, arguments, file extensions, and environment variables.
- **Timeout tuning**: The diagnostic wait timeout is configurable.
- **Severity filtering**: Users can choose to include warnings in diagnostic output, not just errors.
- **Disable navigation tools**: `"lsp": { "navigationTools": false }` — keeps diagnostic feedback but hides MCP tools from the LLM.

**Configuration precedence is simple:** `"lsp": false` disables everything. `"lsp": { ... }` enables with options. There is no `enabled` boolean inside the object — the presence of the object IS the enabled state.

### B6: Status Visibility

Users can see which LSP servers are running and their status. This is exposed via a slash command (e.g., `/lsp status`).

**Observable statuses per server:**
- `active` — Server is running and responding to requests.
- `starting` — Server is being initialized (first-touch).
- `broken` — Server crashed and will not be restarted this session.
- `disabled` — Server is disabled by configuration.
- `unavailable` — Server binary not found on system (e.g., `gopls` not installed).

If the LSP service itself is unavailable (Bun not installed, LSP package not present), `/lsp status` shows a single line: `LSP unavailable: <reason>` (e.g., "Bun not found in PATH" or "LSP package not installed").

### B7: Session Lifecycle

- LSP servers start lazily on first file touch (B4).
- LSP servers shut down when the LLxprt session ends.
- If an LSP server crashes, it is marked as `broken` and **not restarted** for the remainder of the session. This avoids crash loops. Edits to files of that language proceed without diagnostics.
- If the LSP service process itself dies (not an individual language server, but the whole Bun subprocess), it is also **not restarted**. All LSP functionality degrades gracefully to "no diagnostics" for the rest of the session. This is the conservative policy for initial implementation; automatic restart may be added later if experience shows it's needed.
- Diagnostic and file tracking maps are cleaned up on session end to prevent memory leaks.

### B8: Bun Unavailability

**When** the Bun runtime is not available on the system (not installed or not in PATH),
**or** the `@vybestack/llxprt-code-lsp` package is not present,
**then** LSP is silently disabled. No error is shown. Edit/write tools work exactly as they do today. A debug-level log message is emitted noting that LSP is unavailable.

## Non-Goals (Explicit)

- **Code completion / autocomplete**: LSP servers support this, but we are not integrating it. The LLM generates code; it does not need autocomplete suggestions.
- **Code actions / auto-fix**: LSP servers can suggest fixes. We do not apply them automatically. The LLM receives the diagnostic and decides how to fix it.
- **Formatting**: LSP-based formatting is not in scope. The existing formatter infrastructure handles this.
- **Real-time / watch mode**: Diagnostics are only collected after explicit file mutations (edit/write/patch). We do not continuously poll or watch for changes.
- **User-facing diagnostic UI**: Beyond status visibility (B6), we do not render diagnostics in the TUI or IDE companion. Diagnostics are for the LLM's consumption, appended to tool responses.
- **File deletion/rename diagnostics**: Patch operations that delete or rename files do not trigger diagnostic collection. Only file content writes trigger diagnostics.

## Prior Art: OpenCode

OpenCode (MIT licensed, 100K+ GitHub stars) has a battle-tested LSP implementation that validates this design. Key learnings from their experience:

**What works well:**
- LSP diagnostics after edits significantly reduce multi-turn retry loops.
- Lazy server startup keeps cold-start fast.
- Auto-detection of servers by file extension is ergonomic.
- The concept is universally praised by users.
- The edit tool shows only same-file diagnostics; the write tool shows project-wide diagnostics (capped at 5 other files). We adopt this same split.

**Known issues to avoid:**
- **Sequential diagnostic waits** (OpenCode #10965): OpenCode's `apply_patch` waits for LSP diagnostics file-by-file (3s × N files). We must collect diagnostics in parallel across all servers for a given file.
- **Agent misinterpretation** (OpenCode #9102): LLMs sometimes interpret diagnostics as "the edit failed" and enter retry loops. Our formatting uses clear framing: the success message comes first ("Edit applied successfully"), diagnostics follow separately with explicit "please fix" language and `<diagnostics>` tags, matching OpenCode's approach which has been refined over time.
- **Session bloat** (OpenCode #6310): Storing full diagnostic objects in message metadata inflates session history. We store only the formatted string in `llmContent`. Raw diagnostic objects are not stored in metadata or session history.
- **Memory leaks** (OpenCode #9143): Diagnostic and file maps must be cleaned up. Cleanup triggers: individual server shutdown, session end, and LSP service process exit.
- **External directory spawning** (OpenCode #7227): LSP servers should not be started for files outside the workspace. Workspace boundary checks are enforced at the LSP service layer (not just at the tool entry), ensuring files in `node_modules`, system paths, or other external directories never trigger server startup.

## Success Criteria

1. After an edit that introduces a type error, the LLM sees the error in the tool response and corrects it on the next turn — without the user running a build or lint command.
2. LSP servers start automatically for common languages with no user configuration.
3. A crashed LSP server does not crash or hang the LLxprt agent.
4. Users can disable LSP entirely or per-server.
5. The LLM can use navigation tools to find definitions, references, and symbols when needed.
6. Diagnostic collection completes within the configured timeout; if it doesn't, the edit still succeeds.
7. If Bun is not installed or the LSP package is not present, LLxprt works exactly as it does today with no errors.

## Observability

LSP operational metrics are logged via the existing `DebugLogger` infrastructure (local debug logs, not external telemetry). These are for local troubleshooting, not sent to any remote service.

Metrics to track:
- Server startup success/failure counts per language.
- Server crash counts per language.
- Diagnostic collection latency (time from touchFile to diagnostics returned).
- Diagnostic timeout rates (how often the timeout is hit vs. server responding in time).
- Number of diagnostics returned per file per collection.

These are emitted at debug log level and available when the user enables debug logging.
