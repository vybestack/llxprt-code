# Pseudocode: RpcChannel (packages/lsp/src/channels/rpc-channel.ts)

## Plan Reference
- **Plan ID**: PLAN-20250212-LSP
- **Requirements**: REQ-ARCH-020, REQ-ARCH-070, REQ-ARCH-080

---

## Interface Contracts

### INPUTS this component receives:

```typescript
interface RpcChannelInput {
  orchestrator: Orchestrator;
  stdin: ReadableStream;   // process.stdin
  stdout: WritableStream;  // process.stdout
}
```

### OUTPUTS this component produces:

```typescript
// Exposes JSON-RPC methods over stdin/stdout:
// - lsp/checkFile: { filePath: string } → Diagnostic[]
// - lsp/diagnostics: {} → Record<string, Diagnostic[]>
// - lsp/status: {} → ServerStatus[]
// - lsp/shutdown: {} → void
```

### DEPENDENCIES this component requires:

```typescript
interface Dependencies {
  jsonrpc: typeof import('vscode-jsonrpc');  // MessageConnection, RequestType
  orchestrator: Orchestrator;                 // Shared orchestrator instance
}
```

---

## Pseudocode

```
01: // --- JSON-RPC Method Type Definitions ---
02:
03: CONST CheckFileMethod = new RequestType<{ filePath: string }, Diagnostic[], void>('lsp/checkFile')
04: CONST DiagnosticsMethod = new RequestType<{}, Record<string, Diagnostic[]>, void>('lsp/diagnostics')
05: CONST StatusMethod = new RequestType<{}, ServerStatus[], void>('lsp/status')
06: CONST ShutdownMethod = new RequestType<{}, void, void>('lsp/shutdown')
07:
08: // --- RPC Channel Setup ---
09:
10: FUNCTION createRpcChannel(
11:   orchestrator: Orchestrator,
12:   input: ReadableStream,
13:   output: WritableStream
14: ): MessageConnection
15:   CONST reader = new StreamMessageReader(input)
16:   CONST writer = new StreamMessageWriter(output)
17:   CONST connection = createMessageConnection(reader, writer)
18:   CONST logger = new DebugLogger('llxprt:lsp:rpc-channel')
19:
20:   // --- Register request handlers ---
21:
22:   connection.onRequest(CheckFileMethod, async (params) => {
23:     logger.log("checkFile: ${params.filePath}")
24:     TRY
25:       CONST diagnostics = await orchestrator.checkFile(params.filePath)
26:       RETURN diagnostics
27:     CATCH error
28:       logger.log("checkFile error: ${error.message}")
29:       RETURN []
30:   })
31:
32:   connection.onRequest(DiagnosticsMethod, async () => {
33:     logger.log("diagnostics request")
34:     TRY
35:       CONST allDiagnostics = orchestrator.getAllDiagnostics()
36:       // Sort file keys alphabetically for deterministic ordering (REQ-ARCH-080)
37:       CONST sorted: Record<string, Diagnostic[]> = {}
38:       FOR EACH key IN Object.keys(allDiagnostics).sort()
39:         sorted[key] = allDiagnostics[key]
40:       RETURN sorted
41:     CATCH error
42:       logger.log("diagnostics error: ${error.message}")
43:       RETURN {}
44:   })
45:
46:   connection.onRequest(StatusMethod, async () => {
47:     logger.log("status request")
48:     TRY
49:       RETURN orchestrator.getStatus()
50:     CATCH error
51:       logger.log("status error: ${error.message}")
52:       RETURN []
53:   })
54:
55:   connection.onRequest(ShutdownMethod, async () => {
56:     logger.log("shutdown request")
57:     TRY
58:       await orchestrator.shutdown()
59:     CATCH error
60:       logger.log("shutdown error: ${error.message}")
61:     // Process exit is handled by main.ts after shutdown completes
62:   })
63:
64:   connection.listen()
65:   logger.log("RPC channel listening on stdin/stdout")
66:
67:   RETURN connection
68:
```

---

## Integration Points

| Line | Call | Details |
|------|------|---------|
| 15-17 | `createMessageConnection(reader, writer)` | Creates JSON-RPC connection over stdin/stdout. Same library used by LspClient for language server connections. |
| 25 | `orchestrator.checkFile(params.filePath)` | Delegates to shared orchestrator. The orchestrator handles lazy startup, parallel collection, boundary checks. |
| 35 | `orchestrator.getAllDiagnostics()` | Returns all cached diagnostics from all servers. Orchestrator handles merging and deduplication. |
| 38-39 | `Object.keys(allDiagnostics).sort()` | Deterministic alphabetical ordering of file paths (REQ-ARCH-080). |
| 49 | `orchestrator.getStatus()` | Returns status array for all known servers. |
| 58 | `orchestrator.shutdown()` | Shuts down all language servers. After this completes, main.ts handles process exit. |
| 64 | `connection.listen()` | Starts the JSON-RPC message loop. Messages are read from stdin and responses written to stdout. |

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Let exceptions propagate from request handlers (would crash the service)
[OK]    DO: Catch all errors in handlers, return safe defaults ([], {})

[ERROR] DO NOT: Use stdout for logging (it's the JSON-RPC channel)
[OK]    DO: Use stderr for debug logging (or DebugLogger which writes to stderr)

[ERROR] DO NOT: Call process.exit() directly from shutdown handler
[OK]    DO: Let main.ts handle process exit after shutdown completes

[ERROR] DO NOT: Create a new orchestrator instance — must use shared singleton
[OK]    DO: Accept orchestrator as parameter (REQ-ARCH-040)
```
