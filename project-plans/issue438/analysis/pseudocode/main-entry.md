# Pseudocode: Main Entry Point (packages/lsp/src/main.ts)

## Plan Reference
- **Plan ID**: PLAN-20250212-LSP
- **Requirements**: REQ-ARCH-010, REQ-ARCH-040, REQ-LIFE-040, REQ-LIFE-060

---

## Interface Contracts

### INPUTS this component receives:

```typescript
// Environment variables:
// - LSP_BOOTSTRAP: string (JSON: { workspaceRoot: string, config: LspConfig })
//   Set by LspServiceClient when spawning. Contains both workspace root and config.
// Process streams:
// - stdin/stdout: JSON-RPC diagnostic channel (EXCLUSIVELY for JSON-RPC protocol messages)
// - fd3/fd4: MCP navigation tool channel
// - stderr: Debug logging (ALL debug/error output goes here, NEVER stdout)
```

### OUTPUTS this component produces:

```typescript
// No direct outputs — sets up channels that produce outputs via IPC
```

### DEPENDENCIES this component requires:

```typescript
interface Dependencies {
  Orchestrator: typeof import('./service/orchestrator');
  ServerRegistry: typeof import('./service/server-registry');
  LanguageMap: typeof import('./service/language-map');
  createRpcChannel: typeof import('./channels/rpc-channel');
  createMcpChannel: typeof import('./channels/mcp-channel');
}
```

---

## Pseudocode

```
01: // --- Entry Point ---
02:
03: CONST logger = new DebugLogger('llxprt:lsp:main')
04:
05: async FUNCTION main(): Promise<void>
06:   logger.log("LSP service starting")
07:
08:   // --- Parse configuration ---
09:   // [RESEARCH — Design Decision 2] Single LSP_BOOTSTRAP env var replaces
10:   // separate LSP_WORKSPACE_ROOT + LSP_CONFIG vars.
11:   // Format: JSON { workspaceRoot: string, config: LspConfig }
12:
13:   CONST bootstrapRaw = process.env.LSP_BOOTSTRAP
14:   IF bootstrapRaw is undefined
15:     logger.log("ERROR: LSP_BOOTSTRAP not set")
16:     process.exit(1)
17:
18:   LET workspaceRoot: string
19:   LET config: LspConfig = DEFAULT_LSP_CONFIG
20:   TRY
21:     CONST bootstrap = JSON.parse(bootstrapRaw)
22:     // [RESEARCH FIX — #9] Validate LSP_BOOTSTRAP schema after parse
23:     IF typeof bootstrap.workspaceRoot !== 'string' OR bootstrap.workspaceRoot.length === 0
24:       WRITE "ERROR: LSP_BOOTSTRAP.workspaceRoot must be a non-empty string" TO stderr
25:       process.exit(1)
26:     IF bootstrap.config !== undefined AND (typeof bootstrap.config !== 'object' OR bootstrap.config === null)
27:       WRITE "ERROR: LSP_BOOTSTRAP.config must be an object if present" TO stderr
28:       process.exit(1)
29:     workspaceRoot = bootstrap.workspaceRoot
30:     IF bootstrap.config THEN config = bootstrap.config
31:   CATCH error
32:     WRITE "ERROR: Failed to parse LSP_BOOTSTRAP: ${error.message}" TO stderr
33:     process.exit(1)
34:
35:   // --- [HIGH 8] Validate optional config fields with runtime guards ---
36:   IF config.diagnosticTimeout !== undefined
37:     IF typeof config.diagnosticTimeout !== 'number' OR config.diagnosticTimeout <= 0
38:       WRITE "ERROR: LSP_BOOTSTRAP.config.diagnosticTimeout must be a positive number" TO stderr
39:       process.exit(1)
40:   IF config.firstTouchTimeout !== undefined
41:     IF typeof config.firstTouchTimeout !== 'number' OR config.firstTouchTimeout <= 0
42:       WRITE "ERROR: LSP_BOOTSTRAP.config.firstTouchTimeout must be a positive number" TO stderr
43:       process.exit(1)
44:   IF config.includeSeverities !== undefined
45:     IF NOT Array.isArray(config.includeSeverities)
46:       WRITE "ERROR: LSP_BOOTSTRAP.config.includeSeverities must be an array" TO stderr
47:       process.exit(1)
48:     CONST validSeverities = ['error', 'warning', 'info', 'hint']
49:     FOR EACH sev IN config.includeSeverities
50:       IF typeof sev !== 'string' OR NOT validSeverities.includes(sev)
51:         WRITE "ERROR: LSP_BOOTSTRAP.config.includeSeverities contains invalid value: ${sev}" TO stderr
52:         process.exit(1)
53:   IF config.servers !== undefined
54:     IF typeof config.servers !== 'object' OR config.servers === null OR Array.isArray(config.servers)
55:       WRITE "ERROR: LSP_BOOTSTRAP.config.servers must be an object" TO stderr
56:       process.exit(1)
57:     FOR EACH [serverId, serverDef] IN Object.entries(config.servers)
58:       IF serverDef.enabled !== false
59:         IF typeof serverDef.command !== 'string' OR serverDef.command.length === 0
60:           WRITE "ERROR: LSP_BOOTSTRAP.config.servers.${serverId}.command must be a non-empty string" TO stderr
61:           process.exit(1)
62:
63:   // --- Create shared components ---
64:
65:   CONST serverRegistry = new ServerRegistry(config.servers ?? {})
66:   CONST languageMap = new LanguageMap()
67:
68:   CONST orchestrator = new Orchestrator({
69:     workspaceRoot,
70:     diagnosticTimeout: config.diagnosticTimeout ?? 3000,
71:     firstTouchTimeout: config.firstTouchTimeout ?? 10000,
72:     maxDiagnosticsPerFile: config.maxDiagnosticsPerFile ?? 20,
73:     maxProjectDiagnosticsFiles: config.maxProjectDiagnosticsFiles ?? 5,
74:     includeSeverities: config.includeSeverities ?? ['error'],
75:     servers: config.servers ?? {}
76:   }, serverRegistry, languageMap, lspClientFactory)
77:
78:   // --- Set up JSON-RPC channel on stdin/stdout ---
79:
80:   CONST rpcConnection = createRpcChannel(
81:     orchestrator,
82:     process.stdin,
83:     process.stdout
84:   )
85:
86:   // --- Set up MCP channel on fd3/fd4 (if navigation tools enabled) ---
87:
88:   LET mcpServer: McpServer | null = null
89:   IF config.navigationTools !== false
90:     TRY
91:       // [BLOCKER 1 FIX] Use /dev/fd/N paths — this is what the Bun spike test
92:       // validated works. Empty string paths do NOT work.
93:       CONST fd3Read = fs.createReadStream('/dev/fd/3', { fd: 3 })
94:       CONST fd4Write = fs.createWriteStream('/dev/fd/4', { fd: 4 })
95:       mcpServer = await createMcpChannel(
96:         orchestrator,
97:         workspaceRoot,
98:         fd3Read,
99:         fd4Write
100:      )
101:      logger.log("MCP navigation channel active on fd3/fd4")
102:    CATCH error
103:      logger.log("WARNING: Failed to set up MCP channel: ${error.message}")
104:      // MCP channel failure is non-fatal — diagnostics still work
105:
106:  // --- Handle process signals ---
107:
108:  REGISTER signal handler for SIGTERM:
109:    ON SIGTERM:
110:      logger.log("Received SIGTERM, shutting down")
111:      await orchestrator.shutdown()
112:      IF mcpServer is not null
113:        await mcpServer.close()
114:      rpcConnection.dispose()
115:      process.exit(0)
116:
117:  REGISTER signal handler for SIGINT:
118:    ON SIGINT:
119:      logger.log("Received SIGINT, shutting down")
120:      await orchestrator.shutdown()
121:      IF mcpServer is not null
122:        await mcpServer.close()
123:      rpcConnection.dispose()
124:      process.exit(0)
125:
126:  // --- Handle uncaught errors ---
127:
128:  process.on('uncaughtException', (error) => {
129:    logger.log("Uncaught exception: ${error.message}")
130:    // Don't exit — try to stay alive for diagnostics
131:  })
132:
133:  process.on('unhandledRejection', (reason) => {
134:    logger.log("Unhandled rejection: ${reason}")
135:    // Don't exit — try to stay alive for diagnostics
136:  })
137:
138:  // [RESEARCH — Design Decision 1: Startup handshake]
139:  // Send lsp/ready notification to signal the core process that setup is complete.
140:  // LspServiceClient waits for this before sending any requests.
141:  rpcConnection.sendNotification('lsp/ready', {})
142:  logger.log("LSP service ready — lsp/ready notification sent")
143:
144: // --- Run ---
145:
146: main().catch(error => {
147:   console.error("LSP service fatal error:", error)
148:   process.exit(1)
149: })
```

---

## Integration Points

| Line | Call | Details |
|------|------|---------|
| 08-16 | `process.env.LSP_BOOTSTRAP` | [RESEARCH DD-2] Single JSON env var containing `{ workspaceRoot: string, config: LspConfig }`. Set by LspServiceClient when spawning the Bun subprocess. Required — process exits if missing or invalid. |
| 35-61 | Config validation | [HIGH 8] Runtime guards for optional config fields: `diagnosticTimeout`, `firstTouchTimeout`, `includeSeverities`, and `servers` entries. Clear error messages to stderr on invalid values. |
| 65 | `new ServerRegistry(config.servers)` | Creates the server registry with user overrides. Built-in servers are always available. |
| 68-76 | `new Orchestrator(..., lspClientFactory)` | Single shared orchestrator instance with explicit `lspClientFactory` dependency injection. Both channels use this same instance (REQ-ARCH-040). |
| 80-84 | `createRpcChannel(orchestrator, stdin, stdout)` | Sets up JSON-RPC diagnostic channel. Must be created before MCP channel to ensure diagnostics are available. |
| 93-100 | `createMcpChannel(orchestrator, ...)` | Sets up MCP navigation tool channel on fd3/fd4. Optional — failure is non-fatal. Only created if `navigationTools !== false`. Uses `/dev/fd/3` and `/dev/fd/4` paths per validated spike test pattern. |
| 108-124 | Signal handlers | Graceful shutdown on SIGTERM/SIGINT. Orchestrator shutdown closes all language server connections. |

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Create multiple orchestrator instances
[OK]    DO: One orchestrator shared between RPC and MCP channels (REQ-ARCH-040)

[ERROR] DO NOT: Use stdout for console.log or debug output (it's the RPC channel)
[OK]    DO: Use stderr for all logging output

[ERROR] DO NOT: Exit on MCP channel setup failure (it's optional)
[OK]    DO: Log warning, continue with RPC channel only

[ERROR] DO NOT: Exit on uncaught exceptions (try to stay alive)
[OK]    DO: Log the error, let individual server crashes be handled by orchestrator

[ERROR] DO NOT: Parse workspace root from a separate env var or config file
[OK]    DO: Use LSP_BOOTSTRAP environment variable (JSON with workspaceRoot + config) set by the spawner

[ERROR] DO NOT: Write non-JSON-RPC content to stdout (it is the RPC channel)
[OK]    DO: ALL debug/error output goes to stderr, never stdout — stdout is exclusively for JSON-RPC protocol messages

[ERROR] DO NOT: Use fs.createReadStream('', { fd }) with empty path
[OK]    DO: Use fs.createReadStream('/dev/fd/3', { fd: 3 }) — validated by Bun spike test
```
