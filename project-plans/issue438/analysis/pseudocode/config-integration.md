# Pseudocode: Config Integration (packages/core/src/config/config.ts + types)

## Plan Reference
- **Plan ID**: PLAN-20250212-LSP
- **Requirements**: REQ-CFG-010, REQ-CFG-015, REQ-CFG-020, REQ-CFG-030, REQ-CFG-040, REQ-CFG-050, REQ-CFG-060, REQ-CFG-070, REQ-CFG-080, REQ-PKG-050, REQ-ARCH-060

---

## Interface Contracts

### INPUTS this component receives:

```typescript
// From user configuration files (settings.json):
// "lsp": false | LspConfig | undefined
```

### OUTPUTS this component produces:

```typescript
// New methods on Config class:
interface ConfigLspExtensions {
  getLspConfig(): LspConfig | undefined;
  getLspServiceClient(): LspServiceClient | undefined;
}

// New types (duplicated in packages/core/src/lsp/types.ts):
interface LspConfig {
  diagnosticTimeout?: number;
  firstTouchTimeout?: number;
  maxDiagnosticsPerFile?: number;
  maxProjectDiagnosticsFiles?: number;
  includeSeverities?: Array<'error' | 'warning' | 'info'>;
  navigationTools?: boolean;
  servers?: Record<string, LspServerConfig>;
}

interface LspServerConfig {
  enabled?: boolean;
  command?: string;
  args?: string[];
  extensions?: string[];
  env?: Record<string, string>;
  initializationOptions?: Record<string, unknown>;
}
```

### DEPENDENCIES this component requires:

```typescript
interface Dependencies {
  LspServiceClient: typeof import('../lsp/lsp-service-client');
  // vscode-jsonrpc added to package.json dependencies
}
```

---

## Pseudocode

```
01: // === File: packages/core/src/lsp/types.ts (NEW FILE) ===
02:
03: EXPORT interface Diagnostic {
04:   file: string
05:   line: number       // 1-based
06:   character: number  // 1-based
07:   severity: 'error' | 'warning' | 'info' | 'hint'
08:   message: string    // XML-escaped
09:   code?: string | number
10:   source?: string
11: }
12:
13: EXPORT interface ServerStatus {
14:   id: string
15:   status: 'active' | 'starting' | 'broken' | 'disabled' | 'unavailable'
16:   language: string
17:   serverPid?: number
18: }
19:
20: EXPORT interface LspConfig {
21:   diagnosticTimeout?: number
22:   firstTouchTimeout?: number
23:   maxDiagnosticsPerFile?: number
24:   maxProjectDiagnosticsFiles?: number
25:   includeSeverities?: Array<'error' | 'warning' | 'info'>
26:   navigationTools?: boolean
27:   servers?: Record<string, LspServerConfig>
28: }
29:
30: EXPORT interface LspServerConfig {
31:   enabled?: boolean
32:   command?: string
33:   args?: string[]
34:   extensions?: string[]
35:   env?: Record<string, string>
36:   initializationOptions?: Record<string, unknown>
37: }
38:
39: // === File: packages/core/src/config/config.ts (MODIFICATIONS) ===
40:
41: // --- Add import ---
42: IMPORT { LspServiceClient } from '../lsp/lsp-service-client.js'
43: IMPORT type { LspConfig } from '../lsp/types.js'
44:
45: // --- Add to ConfigOptions interface (~line 400) ---
46: PROPERTY lsp?: LspConfig | false
47:
48: // --- Add private fields to Config class (~line 439) ---
49: PRIVATE lspServiceClient?: LspServiceClient
50: PRIVATE readonly lspConfig?: LspConfig | false
51:
52: // --- Add to constructor (~line 500) ---
53: SET this.lspConfig = options.lsp
54:
55: // --- Add to initialize() method (~line 855, after MCP client manager setup) ---
56:
57: // Start LSP service if enabled
58: IF this.lspConfig !== false
59:   CONST lspEnabled = this.lspConfig !== false
60:   IF lspEnabled
61:     TRY
62:       CONST client = new LspServiceClient(
63:         this.lspConfig ?? {},  // undefined → default config
64:         this.getWorkspaceRoot()
65:       )
66:       await client.start()
67:       IF client.isAlive()
68:         this.lspServiceClient = client
69:         LOG debug "LSP service started"
70:
71:         // Register MCP navigation tools if enabled
 72:         IF (this.lspConfig?.navigationTools ?? true) !== false
 73:           CONST mcpStreams = client.getMcpTransportStreams()
 74:           IF mcpStreams is not null
 75:             // [RESEARCH — Source 4] Direct MCP SDK Client, NOT McpClientManager
 76:             await this.registerLspNavTools(mcpStreams)
77:       ELSE
78:         LOG debug "LSP service started but not alive"
79:     CATCH error
80:       LOG debug "LSP service startup failed: ${error.message}"
81:       // Non-fatal — edit/write tools work without LSP
82:
83: // --- Add accessor methods (~line 1170, near getMcpClientManager) ---
84:
85: METHOD getLspConfig(): LspConfig | undefined
86:   IF this.lspConfig === false
87:     RETURN undefined
88:   RETURN this.lspConfig ?? {}  // undefined means default config
89:
90: METHOD getLspServiceClient(): LspServiceClient | undefined
91:   RETURN this.lspServiceClient
92:
93: // --- Add to cleanup/shutdown (~wherever session cleanup happens) ---
94:
95: IF this.lspServiceClient is defined
96:   await this.lspServiceClient.shutdown()
97:   this.lspServiceClient = undefined
98:
99: // --- Private method: Register LSP Navigation Tools ---
 100:
 101: PRIVATE METHOD async registerLspNavTools(
 102:   streams: { readable: Readable, writable: Writable }
 103: ): Promise<void>
 104:   // [RESEARCH — Source 4] Create direct MCP SDK Client with custom Transport
 105:   // This bypasses McpClientManager entirely — no refactoring needed.
 106:   CONST transport = new FdTransport(streams.readable, streams.writable)
 107:   CONST mcpClient = new Client({ name: 'lsp-nav', version: '1.0' })
 108:   await mcpClient.connect(transport)
 109:   // Discover tools and register them in the ToolRegistry
 110:   CONST tools = await mcpClient.listTools()
 111:   FOR EACH tool IN tools
 112:     this.getToolRegistry().register(tool.name, tool)
 113:   this.lspMcpClient = mcpClient  // Store reference for shutdown
114:
```

---

## Integration Points

| Line | Call | Details |
|------|------|---------|
| 42-43 | Import statements | New imports in config.ts. `LspServiceClient` is a new class in `packages/core/src/lsp/`. |
| 46 | `lsp?: LspConfig \| false` | Added to ConfigOptions. `false` disables, object enables, `undefined` means default (enabled). (REQ-CFG-010, REQ-CFG-015, REQ-CFG-020) |
| 58-59 | `this.lspConfig !== false` | Check: if explicitly set to false, skip. If undefined or object, proceed. (REQ-CFG-010, REQ-CFG-015) |
| 62-64 | `new LspServiceClient(config, workspaceRoot)` | Creates the thin client. Constructor does not start the service — `start()` does. |
| 66 | `client.start()` | Attempts to spawn the Bun subprocess. May fail silently (Bun not found, package missing). |
| 67-68 | `client.isAlive()` | After start(), check if the subprocess is actually running. |
| 72 | `navigationTools ?? true` | Default is true. Only skip MCP registration if explicitly false. (REQ-CFG-070) |
| 76 | `this.registerLspNavTools(mcpStreams)` | Creates direct MCP SDK Client with custom FdTransport on fd3/fd4, discovers and registers LSP navigation tools in ToolRegistry. Bypasses McpClientManager. |
| 86-88 | `getLspConfig()` | Returns undefined if LSP is false (disabled). Returns `{}` if undefined (default enabled). Tools use this to get configurable limits. |
| 90-91 | `getLspServiceClient()` | Returns undefined if LSP never started or disabled. Tools check this before attempting diagnostic collection. |
| 95-97 | Shutdown | Graceful cleanup on session end. Sends shutdown to LSP service, kills subprocess. |

### Existing Code Context (config.ts)

The Config class already has patterns for optional services:
- `private mcpClientManager?: McpClientManager` (~line 439)
- `getMcpClientManager(): McpClientManager | undefined` (~line 1169)
- MCP client manager initialization in `initialize()` (~line 844)

The LSP service client follows the exact same pattern.

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Add an `enabled` boolean inside LspConfig
[OK]    DO: `lsp: false` disables, `lsp: { ... }` enables. Presence = enabled (REQ-CFG-020)

[ERROR] DO NOT: Use Bun APIs in config.ts (it's in packages/core, Node.js)
[OK]    DO: LspServiceClient handles Bun detection internally (REQ-ARCH-050)

[ERROR] DO NOT: Make LSP startup failure fatal
[OK]    DO: Catch errors, log debug, continue without LSP (REQ-GRACE-020/030/045)

[ERROR] DO NOT: Allow LLM to modify LSP server configurations via tool calls
[OK]    DO: LSP config only from user config files (REQ-CFG-080)

[ERROR] DO NOT: Import vscode-languageserver-types into core
[OK]    DO: Only import vscode-jsonrpc (pure JS, zero native modules) (REQ-ARCH-060)

[ERROR] DO NOT: Share types via cross-package imports between core and lsp
[OK]    DO: Duplicate small type definitions in both packages (REQ-PKG-050)
```
