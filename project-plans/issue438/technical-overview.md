# LSP Integration — Technical Specification

## Issue Reference

- **Issue**: #438 — Support LSP Servers
- **Functional Spec**: [overview.md](./overview.md)

## Architectural Decision: Separate Bun-Native Package with JSON-RPC IPC

The LSP subsystem is implemented as a **standalone Bun-native package** (`packages/lsp/`) that runs as a **single child process** of the main LLxprt agent. This process hosts two communication channels:

1. **Internal JSON-RPC** (stdin/stdout) — Used by edit/write tools to get diagnostics after file mutations. Invisible to the LLM.
2. **MCP server** (extra file descriptors fd3/fd4) — Used by the LLM to call navigation tools (go-to-definition, find-references, etc.).

Both channels share a single LSP orchestrator instance and a single set of language server connections. This means a `tsserver` started for diagnostics is the same `tsserver` used for go-to-definition — no duplicate processes, no wasted memory.

This follows the established precedent of `packages/ui/`, which is also a Bun-native package outside the npm workspaces array with its own strict linting, its own tsconfig, and separate CI steps.

### Why a Separate Process

1. **Runtime isolation**: Language servers are notoriously crashy, leaky, and occasionally hang. A separate process means a misbehaving `tsserver` or `gopls` cannot take down the agent.
2. **Bun-native**: The LSP package uses Bun APIs (`Bun.spawn`, `Bun.which`, `Bun.file`) for server detection and spawning. The main agent stays on Node.js. No compatibility shims needed.
3. **Dependency isolation**: `vscode-languageserver-types` stays out of core's dependency tree. `vscode-jsonrpc` is added to core as a thin dependency (pure JS, zero native modules) for the client side of the IPC.
4. **Independent testing**: The LSP service can be tested with fake LSP server fixtures without spinning up the full agent.

### Why JSON-RPC over stdio (not MCP for everything, not HTTP)

- **Already needed**: The LSP package requires `vscode-jsonrpc` to talk to language servers. Reuse it for the service boundary — no protocol invention needed.
- **Not MCP for diagnostics**: MCP solves tool discovery for LLMs. The diagnostic integration is internal plumbing between two processes we control. The methods are fixed and known at compile time. MCP's discovery/schema negotiation is unnecessary overhead for this channel.
- **MCP for navigation tools**: The LLM-facing navigation tools use MCP because that's how LLxprt exposes all LLM-callable tools. LSP nav registration creates a direct MCP SDK `Client` with a custom `Transport` wrapping fd3/fd4 streams, bypassing `McpClientManager`.
- **Not HTTP**: Adds networking complexity, port management, and startup coordination. Stdio and extra file descriptors are simpler and proven.

### Why One Process, Not Two

The diagnostic channel and the MCP navigation channel share the same LSP orchestrator and the same set of running language servers. If they were two processes, each would need its own `tsserver`, `gopls`, etc. — doubling memory usage and losing diagnostic state sharing.

**Multiplexing approach**: The Bun process is spawned with extra file descriptors:

```typescript
spawn('bun', ['run', 'packages/lsp/src/main.ts'], {
  stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe']
  //       stdin  stdout  stderr  fd3     fd4
});
```

- **stdin/stdout (fd0/fd1)**: Internal JSON-RPC for diagnostics. Core's `LspServiceClient` reads/writes here.
- **fd3/fd4**: MCP transport for navigation tools. A direct MCP SDK `Client` reads/writes here via a custom `Transport` implementation that wraps these file descriptors (bypasses `McpClientManager`).
- **stderr (fd2)**: Debug logging output from the LSP service.

On the Bun side:
- `vscode-jsonrpc` `MessageConnection` on `process.stdin` / `process.stdout` — handles the internal diagnostic channel.
- MCP `Server` with a custom `Transport` on `fs.createReadStream(3)` / `fs.createWriteStream(4)` — handles the navigation tool channel.
- Both channels share the same `Orchestrator` singleton.

This is clean, battle-tested IPC (extra file descriptors are used by Node.js IPC, worker threads, and many Unix tools), and avoids any custom multiplexing protocol.

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  LLxprt Agent Process (Node.js)                                      │
│                                                                      │
│  ┌─────────────────────────────────────────┐                         │
│  │ edit.ts / write-file.ts / apply-patch   │                         │
│  │   1. Write file to disk                 │                         │
│  │   2. lspServiceClient.checkFile(path)   │──── stdin/stdout ─────┐ │
│  │   3. Append diagnostics to llmContent   │      (JSON-RPC)       │ │
│  └─────────────────────────────────────────┘                       │ │
│                                                                     │ │
│  ┌─────────────────────────────────────────┐                       │ │
│  │ LspServiceClient (thin wrapper in core) │                       │ │
│  │   - Spawns Bun subprocess once          │                       │ │
│  │   - Holds vscode-jsonrpc connection     │                       │ │
│  │   - NO auto-restart on crash            │                       │ │
│  │   - Shuts down on session end           │                       │ │
│  └─────────────────────────────────────────┘                       │ │
│                                                                     │ │
│  ┌─────────────────────────────────────────┐                       │ │
│  │ McpClientManager (existing)             │                       │ │
│  │   - Connects to LSP nav MCP on fd3/fd4  │──── fd3/fd4 ───────┐ │ │
│  │   - Registers tools in LLM tool list    │      (MCP)          │ │ │
│  └─────────────────────────────────────────┘                     │ │ │
│                                                                   │ │ │
└───────────────────────────────────────────────────────────────────┘ │ │
                                                                      │ │
              One Bun subprocess, two channels                        │ │
                                                                      │ │
┌─────────────────────────────────────────────────────────────────────┘ │
│  packages/lsp — LSP Service (Bun)                              ◄─────┘
│                                                                      │
│  ┌──────────────────────────────────┐                                │
│  │ Internal JSON-RPC (stdin/stdout) │                                │
│  │   lsp/checkFile → diagnostics   │                                │
│  │   lsp/diagnostics → all diags   │                                │
│  │   lsp/status → server info      │                                │
│  │   lsp/shutdown → clean exit     │                                │
│  └──────────────┬───────────────────┘                                │
│                 │                                                     │
│                 ▼                                                     │
│  ┌──────────────────────────────────┐                                │
│  │ LSP Orchestrator (shared)        │◄───────────────────────┐       │
│  │   - Lazy server startup          │                        │       │
│  │   - Routes files to clients      │                        │       │
│  │   - Collects diagnostics         │                        │       │
│  │   - Manages server lifecycle     │                        │       │
│  │   - Workspace boundary checks    │                        │       │
│  └──────────────┬───────────────────┘                        │       │
│                 │                                              │       │
│  ┌──────────────────────────────────┐                        │       │
│  │ MCP Navigation Server (fd3/fd4) │────────────────────────┘       │
│  │   lsp_goto_definition            │                                │
│  │   lsp_find_references            │                                │
│  │   lsp_hover                      │                                │
│  │   lsp_document_symbols           │                                │
│  │   lsp_workspace_symbols          │                                │
│  │   lsp_diagnostics                │                                │
│  └──────────────────────────────────┘                                │
│                                                                      │
│  ┌──────────────────────────────────┐                                │
│  │ Language Server Connections       │                                │
│  │   ├─ tsserver (LSP)              │                                │
│  │   ├─ eslint-lsp (LSP)           │                                │
│  │   ├─ gopls (LSP)                │                                │
│  │   ├─ pyright (LSP)              │                                │
│  │   └─ ... (per-language)          │                                │
│  └──────────────────────────────────┘                                │
└──────────────────────────────────────────────────────────────────────┘
```

## Code Touchpoints in Core

### T1: `packages/core/src/lsp/lsp-service-client.ts` (NEW)

Thin client that manages the Bun subprocess and provides a typed RPC interface.

```typescript
// Conceptual API — not implementation
export class LspServiceClient {
  start(config: LspConfig, workspaceRoot: string): Promise<void>
  checkFile(filePath: string): Promise<Diagnostic[]>
  getAllDiagnostics(): Promise<Record<string, Diagnostic[]>>
  status(): Promise<ServerStatus[]>
  shutdown(): Promise<void>
  isAlive(): boolean
}

export interface Diagnostic {
  file: string           // relative path to workspace root
  line: number           // 1-based
  character: number      // 1-based
  severity: 'error' | 'warning' | 'info' | 'hint'
  message: string        // sanitized (no raw < or >)
  code?: string | number
  source?: string        // e.g., "typescript", "eslint"
}

export interface ServerStatus {
  id: string             // e.g., "typescript", "gopls"
  status: 'active' | 'starting' | 'broken' | 'disabled' | 'unavailable'
  language: string
  serverPid?: number
}
```

**Dependencies added to core**: `vscode-jsonrpc` (pure JS, zero native modules, ~50KB). This is the only new dependency. It is needed because core (Node.js) must speak JSON-RPC to the Bun subprocess. The same library is used inside the LSP package to talk to language servers, so there is no protocol mismatch.

**Startup behavior**: `LspServiceClient.start()` attempts to spawn `bun run <path-to-lsp-main>`. If Bun is not in PATH, or the LSP package is not present, `start()` catches the error, logs at debug level, and sets the client to a permanently-dead state. `isAlive()` returns false, and all subsequent `checkFile()` calls return `[]` immediately.

**No auto-restart**: If the Bun subprocess dies, `isAlive()` returns false and all subsequent calls return empty results. The service is not restarted. This is the conservative policy for initial implementation.

**Cleanup**: On session end, `shutdown()` sends `lsp/shutdown` to the service, waits briefly for graceful exit, then kills the process.

### T2: `packages/core/src/config/config.ts` — Config Extensions

Add LSP configuration and service client lifecycle.

**Config schema additions** (~near line 215 with other optional config fields):

```typescript
lsp?: LspConfig | false;
```

```typescript
export interface LspConfig {
  diagnosticTimeout?: number;           // ms, default: 3000
  firstTouchTimeout?: number;           // ms, default: 10000
  maxDiagnosticsPerFile?: number;       // default: 20
  maxProjectDiagnosticsFiles?: number;  // default: 5
  includeSeverities?: ('error' | 'warning' | 'info')[];  // default: ['error']
  navigationTools?: boolean;            // default: true, false disables MCP nav tools
  servers?: Record<string, LspServerConfig>;
}

export interface LspServerConfig {
  enabled?: boolean;
  command?: string;
  args?: string[];
  extensions?: string[];
  env?: Record<string, string>;
  initializationOptions?: Record<string, unknown>;
}
```

**Configuration semantics**: `"lsp": false` disables everything. `"lsp": { ... }` enables with options. There is no `enabled` boolean inside the object — the presence of the object IS the enabled state. This avoids the confusion of having two ways to disable (`lsp: false` vs `lsp: { enabled: false }`).

**Security note**: Custom server `command` and `env` are only settable via user configuration files, never by the LLM. The LLM can call navigation tools but cannot add/modify/remove LSP server configurations.

**Service client management** (parallel to existing `McpClientManager` pattern):

- `private lspServiceClient?: LspServiceClient` field
- `getLspServiceClient(): LspServiceClient | undefined` accessor
- Startup in the initialization flow (after workspace context is established)
- Shutdown in the cleanup flow

### T3: `packages/core/src/tools/edit.ts` — Diagnostic Integration (Single-File)

After the file write succeeds and the success message is built (~line 641, in the `llmSuccessMessageParts` construction):

```typescript
// After existing success message construction:
const lspClient = this.config.getLspServiceClient();
if (lspClient?.isAlive()) {
  try {
    const diagnostics = await lspClient.checkFile(filePath);
    const errors = diagnostics.filter(d => d.severity === 'error');
    if (errors.length > 0) {
      const maxDiags = this.config.getLspConfig()?.maxDiagnosticsPerFile ?? 20;
      const limited = errors.slice(0, maxDiags);
      const suffix = errors.length > maxDiags
        ? `\n... and ${errors.length - maxDiags} more`
        : '';
      const relPath = path.relative(workspaceRoot, filePath);
      llmSuccessMessageParts.push(
        `\n\nLSP errors detected in this file, please fix:\n<diagnostics file="${relPath}">\n${
          limited.map(d =>
            `${d.severity.toUpperCase()} [${d.line}:${d.character}] ${escapeXml(d.message)}${d.code ? ` (${d.code})` : ''}`
          ).join('\n')
        }${suffix}\n</diagnostics>`
      );
    }
  } catch {
    // LSP failure must not fail the edit — silently continue
  }
}
```

**Key constraints**:
- The `try/catch` is mandatory. A crashing/hanging LSP service must never cause an edit tool failure.
- The `checkFile` call should respect the configured diagnostic timeout and the abort signal.
- The edit tool only reports diagnostics for **the edited file** (matching OpenCode's edit tool behavior).

### T4: `packages/core/src/tools/write-file.ts` — Diagnostic Integration (Multi-File)

Same core pattern as T3, but with multi-file awareness matching OpenCode's write tool (`write.ts` lines 56–73):

```typescript
const lspClient = this.config.getLspServiceClient();
if (lspClient?.isAlive()) {
  try {
    await lspClient.checkFile(filePath);  // touch the written file, wait for diagnostics
    const allDiagnostics = await lspClient.getAllDiagnostics();
    const maxDiags = this.config.getLspConfig()?.maxDiagnosticsPerFile ?? 20;
    const maxOtherFiles = this.config.getLspConfig()?.maxProjectDiagnosticsFiles ?? 5;
    const maxTotalDiagnosticLines = 50;
    const normalizedPath = normalizePath(filePath);

    let otherFileCount = 0;
    let totalDiagnosticLines = 0;
    // Sort: edited file first, then others alphabetically
    const sortedFiles = Object.keys(allDiagnostics).sort((a, b) => {
      if (a === normalizedPath) return -1;
      if (b === normalizedPath) return 1;
      return a.localeCompare(b);
    });

    for (const file of sortedFiles) {
      if (totalDiagnosticLines >= maxTotalDiagnosticLines) break;
      const errors = allDiagnostics[file].filter(d => d.severity === 'error');
      if (errors.length === 0) continue;
      const remaining = maxTotalDiagnosticLines - totalDiagnosticLines;
      const limited = errors.slice(0, Math.min(maxDiags, remaining));
      totalDiagnosticLines += limited.length;
      const suffix = errors.length > limited.length
        ? `\n... and ${errors.length - limited.length} more` : '';

      if (file === normalizedPath) {
        llmSuccessMessageParts.push(
          `\n\nLSP errors detected in this file, please fix:\n<diagnostics file="${file}">\n${
            limited.map(formatDiagnostic).join('\n')
          }${suffix}\n</diagnostics>`
        );
      } else {
        if (otherFileCount >= maxOtherFiles) continue;
        otherFileCount++;
        llmSuccessMessageParts.push(
          `\n\nLSP errors detected in other files:\n<diagnostics file="${file}">\n${
            limited.map(formatDiagnostic).join('\n')
          }${suffix}\n</diagnostics>`
        );
      }
    }
  } catch {
    // LSP failure must not fail the write
  }
}
```

### T5: MCP Navigation Server Registration

The LSP navigation tools are exposed via the existing MCP infrastructure. Core auto-registers an MCP server that connects to the Bun process's fd3/fd4:

```typescript
// Conceptual — auto-registered internal MCP server
// Uses a custom Transport that wraps the fd3/fd4 streams from the spawned Bun process
const lspNavTransport = new FdTransport(bunProcess.stdio[3], bunProcess.stdio[4]);
```

This uses the existing `McpClientManager` → `Transport` path. The `Transport` interface in `@modelcontextprotocol/sdk` is implementable on any stream pair — it does not require `StdioClientTransport` specifically. A thin `FdTransport` wrapper adapts the extra file descriptor streams to the MCP `Transport` interface.

The MCP server is registered only when:
- `lsp` config is not `false`
- `lsp.navigationTools` is not `false`
- The LSP service process started successfully

## packages/lsp Internal Architecture

### Module Structure

```
packages/lsp/
  package.json
  tsconfig.json
  eslint.config.cjs            ← Pedantic, cloned from packages/ui pattern
  src/
    main.ts                    ← Entry point: sets up both channels, instantiates orchestrator
    channels/
      rpc-channel.ts           ← JSON-RPC handler on stdin/stdout
      mcp-channel.ts           ← MCP server on fd3/fd4
    service/
      orchestrator.ts          ← Server lifecycle, routing, lazy startup, workspace boundaries
      lsp-client.ts            ← JSON-RPC connection to a single LSP server
      server-registry.ts       ← Built-in server configs (how to find/spawn each)
      language-map.ts          ← File extension → LSP languageId mapping
      diagnostics.ts           ← Diagnostic collection, deduplication, formatting
    config.ts                  ← Config types shared with core
    types.ts                   ← Shared type definitions
  test/
    fixtures/
      fake-lsp-server.ts       ← Minimal LSP server for testing
    orchestrator.test.ts
    lsp-client.test.ts
    diagnostics.test.ts
```

### Key Components

**`main.ts`** — Entry point. Instantiates the shared `Orchestrator`. Sets up both channels:
1. Creates a `vscode-jsonrpc` `MessageConnection` on `process.stdin`/`process.stdout` for the internal diagnostic channel.
2. Creates an MCP `Server` with a custom `Transport` on fd3/fd4 for the navigation tool channel.
3. Both channels delegate to the same `Orchestrator` instance.

**`channels/rpc-channel.ts`** — Registers JSON-RPC request handlers for `lsp/checkFile`, `lsp/diagnostics`, `lsp/status`, `lsp/shutdown`. Each handler delegates to the orchestrator.

**`channels/mcp-channel.ts`** — Sets up the MCP server with tool definitions for `lsp_goto_definition`, `lsp_find_references`, `lsp_hover`, `lsp_document_symbols`, `lsp_workspace_symbols`, `lsp_diagnostics`. Each tool handler delegates to the orchestrator. Enforces workspace boundary checks on all file path parameters.

**`service/orchestrator.ts`** — Central coordinator. Responsibilities:
- Maintains a map of active LSP clients keyed by server ID + workspace root.
- On `checkFile(path)`: determines file extension → looks up server config → starts server if needed → sends `textDocument/didOpen` or `textDocument/didChange` → waits for `textDocument/publishDiagnostics` (with debounce + timeout) → returns diagnostics.
- Diagnostics are collected in **parallel** across all servers for a given file (e.g., tsserver + eslint for `.ts` files). Not sequential.
- Tracks broken servers (crashed → disabled for session, no restart).
- Handles workspace root detection (find nearest `package.json`, `go.mod`, `Cargo.toml`, etc.).
- Enforces workspace boundary: rejects files outside the workspace root. Files in `node_modules`, system paths, and other external directories are silently ignored.

**`service/lsp-client.ts`** — Manages a single LSP server connection. Responsibilities:
- Spawns the server process (via `Bun.spawn` or `child_process.spawn`).
- Performs the LSP `initialize` / `initialized` handshake.
- Tracks open files and their versions.
- Sends `textDocument/didOpen`, `textDocument/didChange`, `textDocument/didClose`.
- Listens for `textDocument/publishDiagnostics` notifications.
- Exposes `waitForDiagnostics(path, timeoutMs)` that resolves when diagnostics arrive or timeout expires, with a 150ms debounce (servers often send multiple rapid updates; wait for them to settle).
- Handles `shutdown` / `exit` lifecycle.

**`service/server-registry.ts`** — Configuration for built-in LSP servers. Each entry defines:
- Server ID (e.g., `"typescript"`, `"gopls"`, `"pyright"`)
- File extensions it handles
- How to detect if the server binary is available (`Bun.which()`, check `node_modules/.bin/`, etc.)
- Spawn command and arguments
- Initialization options
- Workspace root detection strategy (nearest `package.json`, `go.mod`, etc.)

Reference: OpenCode's `server.ts` defines 36+ servers. Initial implementation should cover the most common: TypeScript (`tsserver`), ESLint, Go (`gopls`), Python (`pyright`), Rust (`rust-analyzer`), and a generic "custom server" escape hatch. More can be added incrementally.

**`service/language-map.ts`** — Pure data mapping file extensions to LSP `languageId` strings. Directly portable from OpenCode's `language.ts` (MIT licensed, pure data).

**`service/diagnostics.ts`** — Diagnostic collection and formatting utilities:
- Normalizes diagnostics from different LSP servers into the common `Diagnostic` format.
- Handles severity mapping (LSP severity 1=Error, 2=Warning, 3=Info, 4=Hint).
- Sanitizes diagnostic messages: escapes `<`, `>`, `&` to `&lt;`, `&gt;`, `&amp;` in message text.
- Converts LSP 0-based line/character to 1-based for display.
- Provides `pretty()` formatting matching OpenCode's format: `SEVERITY [line:col] message (code)`.
- Deduplicates diagnostics from multiple servers for the same file+range+message.

### IPC Protocol: JSON-RPC Methods

The LSP service exposes these methods over its internal JSON-RPC connection (stdin/stdout):

| Method | Params | Returns | Description |
|--------|--------|---------|-------------|
| `lsp/checkFile` | `{ filePath: string }` | `Diagnostic[]` | Touch file in relevant server(s), wait for diagnostics with configured timeout, return error-level results for that file. |
| `lsp/diagnostics` | `{}` | `Record<string, Diagnostic[]>` | Return all current diagnostics for all tracked files. File paths are relative to workspace root. Deterministic ordering: files sorted alphabetically. |
| `lsp/status` | `{}` | `ServerStatus[]` | Return status of all known/configured servers. |
| `lsp/shutdown` | `{}` | `void` | Shut down all LSP servers and prepare for process exit. |


### Diagnostic Collection Flow

```
edit.ts writes file
       │
       ▼
LspServiceClient.checkFile("/project/src/foo.ts")
       │
       ▼  (JSON-RPC over stdin/stdout)
LSP Service: orchestrator.checkFile("/project/src/foo.ts")
       │
       ├─ Normalize path, check workspace boundary → reject if external
       ├─ Determine extension: .ts
       ├─ Look up servers: [typescript, eslint]
       ├─ Start servers if not running (lazy)
       ├─ For each server IN PARALLEL:
       │    ├─ textDocument/didOpen or textDocument/didChange
       │    └─ waitForDiagnostics(path, timeoutMs)
       │         ├─ Listens for publishDiagnostics notification
       │         ├─ 150ms debounce (servers send multiple updates)
       │         └─ Returns on stable diagnostics or timeout
       ├─ Merge diagnostics from all servers
       ├─ Deduplicate (same file + range + message)
       ├─ Filter by severity (errors only by default)
       ├─ Convert to Diagnostic[] with 1-based lines, relative paths, sanitized messages
       └─ Return Diagnostic[]
       │
       ▼  (JSON-RPC response)
LspServiceClient receives Diagnostic[]
       │
       ▼
edit.ts appends formatted diagnostics to llmContent
```

## Package Configuration

### package.json

```json
{
  "name": "@vybestack/llxprt-code-lsp",
  "version": "0.1.0",
  "type": "module",
  "main": "src/main.ts",
  "exports": {
    ".": { "import": "./src/main.ts", "bun": "./src/main.ts" },
    "./types": { "import": "./src/types.ts", "bun": "./src/types.ts" }
  },
  "scripts": {
    "lint": "bunx eslint \"src/**/*.ts\" \"test/**/*.ts\"",
    "test": "bunx vitest run",
    "typecheck": "bunx tsc --noEmit",
    "build": "echo 'LSP package uses bun runtime - no build required'"
  },
  "engines": { "bun": ">=1.2.0" },
  "dependencies": {
    "vscode-jsonrpc": "^8.2.1",
    "vscode-languageserver-types": "^3.17.5",
    "@modelcontextprotocol/sdk": "^1.25.2"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "typescript": "~5.8.0",
    "vitest": "^3.0.0",
    "@eslint/js": "^9.27.0",
    "@typescript-eslint/eslint-plugin": "^8.54.0",
    "@typescript-eslint/parser": "^8.54.0",
    "@vitest/eslint-plugin": "^1.1.0",
    "eslint-plugin-eslint-comments": "^3.2.0",
    "eslint-plugin-sonarjs": "^3.0.0",
    "globals": "^16.0.0"
  }
}
```

**Not in the root `workspaces` array** — follows the `packages/ui` precedent. Root `eslint.config.js` should add `packages/lsp/**` to its ignores list.

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "types": ["bun"],
    "paths": {
      "@vybestack/llxprt-code-core": ["../core/src/index.ts"]
    }
  },
  "include": ["src", "test"]
}
```

### eslint.config.cjs

Cloned from `packages/ui/eslint.config.cjs` with these adjustments:
- Remove React-specific rules (no React in LSP package).
- Add `@typescript-eslint/no-unsafe-assignment: error` (LSP responses from `vscode-jsonrpc` are `any` — force typing).
- Add `@typescript-eslint/no-unsafe-member-access: error`.
- Add `@typescript-eslint/no-unsafe-return: error`.
- Keep all other strict rules: `no-floating-promises`, `strict-boolean-expressions`, `switch-exhaustiveness-check`, `complexity: 15`, `max-lines: 800`, `max-lines-per-function: 80`, sonarjs cognitive-complexity, etc.

The `max-lines: 800` rule is specifically important here — it prevents a repeat of OpenCode's 2047-line `server.ts`. The server registry must be decomposed.

### CI Integration

Following the `packages/ui` pattern, CI runs LSP package checks separately:

```yaml
- name: LSP Package Checks
  run: |
    cd packages/lsp
    bun install
    bun run lint
    bun run typecheck
    bun run test
```

## Shared Types

The `Diagnostic`, `ServerStatus`, and `LspConfig` types are **duplicated** in both packages — defined in `packages/lsp/src/types.ts` and mirrored in `packages/core/src/lsp/types.ts`. The types are small (~30 lines) and stable (they match the JSON-RPC wire format, which we control). Duplication avoids cross-boundary build complexity between a Bun-native package outside npm workspaces and the Node.js core package.

## Reference: OpenCode Implementation Mapping

The following maps OpenCode source files to their equivalents in this design:

| OpenCode File | Lines | This Design | Notes |
|---------------|-------|-------------|-------|
| `src/lsp/index.ts` | 486 | `service/orchestrator.ts` | Rewrite. OpenCode's is coupled to Instance/Bus/Config. Our design is decoupled. Key patterns to preserve: lazy startup, parallel diagnostic collection, broken-server tracking. |
| `src/lsp/client.ts` | 253 | `service/lsp-client.ts` | ~70% design-portable. Replace Bus events, adapt connection setup. Preserve: initialize handshake, didOpen/didChange, publishDiagnostics listener with debounce, waitForDiagnostics. |
| `src/lsp/server.ts` | 2047 | `service/server-registry.ts` | Rewrite. Our package is also Bun-native so same APIs available. Start with ~6 servers (TS, ESLint, Go, Python, Rust, custom), not 36. **Must decompose** — max-lines: 800 enforced. |
| `src/lsp/language.ts` | ~60 | `service/language-map.ts` | 100% reusable. Pure data file. MIT licensed. |
| `src/tool/lsp.ts` | 97 | `channels/mcp-channel.ts` | Rewrite as MCP tool definitions. Same operations (definition, references, hover, symbols). |
| `src/tool/edit.ts` L128-147 | ~20 | `edit.ts` (T3) | Same pattern: touchFile → diagnostics → format → append. Single-file only for edit. |
| `src/tool/write.ts` L55-83 | ~30 | `write-file.ts` (T4) | Same pattern but multi-file. Caps: 20/file, 5 other files. |
| `src/config/config.ts` LSP section | ~50 | `config.ts` (T2) | Similar schema. Simplified: `lsp: false \| LspConfig`, no `enabled` duality. |

## Key Design Constraints

1. **LSP failure must never fail an edit.** Every call from core to the LSP service is wrapped in try/catch with a timeout. If the service is down, slow, or returns garbage, the edit succeeds without diagnostics.

2. **No Bun APIs in core.** The `LspServiceClient` in core uses only Node.js APIs (`child_process.spawn`, `vscode-jsonrpc`). All Bun-specific code lives in `packages/lsp/`.

3. **Diagnostics are strings to the LLM.** Raw LSP diagnostic objects are not stored in session history or message metadata. Only the formatted string (appended to `llmContent`) persists. This prevents session bloat (OpenCode #6310).

4. **Lazy startup, eager shutdown, no restart.** Servers start on first file touch. All servers shut down on session end. Crashed servers and crashed service process are not restarted.

5. **max-lines: 800 enforced by lint.** No 2000-line `server.ts`. The server registry is decomposed per-server or per-language-family.

6. **MCP navigation tools are optional.** Can be disabled via `lsp.navigationTools: false` independently of diagnostic feedback.

7. **Workspace boundary enforcement at the service layer.** The orchestrator rejects files outside the workspace root regardless of what the caller passes. This is a defense-in-depth measure — even if a tool misconstructs a path, the service won't start LSP servers for external directories.

8. **Parallel diagnostic collection.** When a file is served by multiple LSP servers (e.g., `.ts` → tsserver + eslint), diagnostics are collected from all servers in parallel, not sequentially. This avoids the timeout multiplication bug in OpenCode #10965.

## Observability

All operational metrics are logged via the existing `DebugLogger` infrastructure. These are **local debug logs only** — they are not sent to any remote telemetry service. They are visible when the user enables debug logging.

Metrics:
- `lsp:service` — Service start/stop, subprocess lifecycle.
- `lsp:orchestrator` — Server startup success/failure, crash tracking, workspace root detection.
- `lsp:client` — Per-server connection lifecycle, diagnostic collection latency, timeout events.
- `lsp:diagnostics` — Diagnostic counts per file, severity distribution, deduplication stats.
