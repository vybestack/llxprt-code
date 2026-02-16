# Pseudocode: LspServiceClient (packages/core/src/lsp/lsp-service-client.ts)

## Plan Reference
- **Plan ID**: PLAN-20250212-LSP
- **Requirements**: REQ-ARCH-010, REQ-ARCH-020, REQ-ARCH-040, REQ-ARCH-050, REQ-ARCH-060, REQ-GRACE-020, REQ-GRACE-030, REQ-GRACE-040, REQ-GRACE-045, REQ-GRACE-050, REQ-GRACE-055, REQ-LIFE-040, REQ-LIFE-050, REQ-LIFE-080, REQ-SCOPE-030, REQ-STATUS-035, REQ-TIME-080

---

## Interface Contracts

### INPUTS this component receives:

```typescript
interface LspServiceClientInput {
  config: LspConfig;          // from Config.getLspConfig()
  workspaceRoot: string;      // absolute path to project root
  lspPackagePath: string;     // resolved path to packages/lsp/src/main.ts
}
```

### OUTPUTS this component produces:

```typescript
interface LspServiceClientOutput {
  checkFile(filePath: string, text?: string, signal?: AbortSignal): Promise<Diagnostic[]>;
  getAllDiagnostics(): Promise<Record<string, Diagnostic[]>>;
  // [RESEARCH FIX — Bug 2] Epoch-based freshness for write tool multi-file flow
  // Epoch is SERVER-AUTHORITATIVE: getDiagnosticEpoch() makes an RPC call to lsp/getDiagnosticEpoch
  // on the orchestrator. There is NO local epoch mirror — this eliminates divergence between
  // the client-side and server-side epoch on error/abort paths.
  getDiagnosticEpoch(): Promise<number>;
  getAllDiagnosticsAfter(afterEpoch: number, waitMs?: number): Promise<Record<string, Diagnostic[]>>;
  getUnavailableReason(): string | undefined;
  status(): Promise<ServerStatus[]>;
  isAlive(): boolean;
}
```

### DEPENDENCIES this component requires (NEVER stubbed):

```typescript
interface Dependencies {
  childProcess: typeof import('node:child_process');  // Node.js child_process.spawn
  jsonrpc: typeof import('vscode-jsonrpc');            // JSON-RPC message connection
  path: typeof import('node:path');                    // Path resolution
  fs: typeof import('node:fs');                        // File existence checks
  which: (cmd: string) => string | null;               // Check for bun binary
}
```

---

## Pseudocode

```
01: CLASS LspServiceClient
02:   PRIVATE subprocess: ChildProcess | null = null
03:   PRIVATE rpcConnection: MessageConnection | null = null
04:   PRIVATE alive: boolean = false
05:   PRIVATE readonly config: LspConfig
06:   PRIVATE readonly workspaceRoot: string
07:   PRIVATE readonly logger: DebugLogger
08:   // REQ-STATUS-035: Reason why the service couldn't start
09:   PRIVATE unavailableReason: string | undefined = undefined
010:
011:   CONSTRUCTOR(config: LspConfig, workspaceRoot: string)
012:     SET this.config = config
013:     SET this.workspaceRoot = workspaceRoot
014:     SET this.logger = new DebugLogger('llxprt:lsp:service-client')
015:
016:   METHOD async start(): Promise<void>
017:     LOG debug "Attempting to start LSP service"
018:     TRY
019:       VALIDATE bun is in PATH using which('bun')
020:       IF bun not found
021:         LOG debug "Bun not found in PATH, LSP disabled"
022:         this.unavailableReason = 'Bun not found in PATH'
023:         RETURN (alive stays false)
024:
025:       RESOLVE lspMainPath = path to packages/lsp/src/main.ts
026:       VALIDATE lspMainPath exists using fs.accessSync
027:       IF not exists
028:         LOG debug "LSP package not found at ${lspMainPath}, LSP disabled"
029:         this.unavailableReason = 'LSP package not installed'
030:         RETURN (alive stays false)
031:
032:       // [RESEARCH — Design Decision 2] Pass config via LSP_BOOTSTRAP env var
033:       CONST bootstrap = JSON.stringify({ workspaceRoot: this.workspaceRoot, config: this.config })
034:       SPAWN subprocess = child_process.spawn('bun', ['run', lspMainPath], {
035:         stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
036:         cwd: this.workspaceRoot,
037:         env: { ...process.env, LSP_BOOTSTRAP: bootstrap },
038:         detached: true  // Give subprocess its own process group so we can kill the entire group
039:       })
040:
041:       CREATE rpcConnection from subprocess.stdin and subprocess.stdout
042:         USING createMessageConnection(
043:           new StreamMessageReader(subprocess.stdout),
044:           new StreamMessageWriter(subprocess.stdin)
045:         )
046:
047:       LISTEN subprocess 'exit' event
048:         ON exit: SET this.alive = false
049:                  SET this.rpcConnection = null
050:                  LOG debug "LSP service process exited"
051:
052:       LISTEN subprocess 'error' event
053:         ON error: SET this.alive = false
054:                   LOG debug "LSP service process error: ${error.message}"
055:
056:       START rpcConnection.listen()
057:
058:       // [RESEARCH — Design Decision 1: Startup handshake]
059:       // Wait for the Bun process to send lsp/ready notification before declaring alive.
060:       // The service sends {"jsonrpc":"2.0","method":"lsp/ready","params":{}} after setup.
061:       AWAIT waitForReadySignal(rpcConnection, timeoutMs = 10000):
062:         RETURN new Promise((resolve, reject) => {
063:           // [MEDIUM 4 FIX] Prevent double-settle: both timeout and notification paths
064:           // check this flag before acting. Prevents race between timer and notification.
065:           LET settled: boolean = false
066:           LET notificationDisposable: Disposable | null = null
067:           CONST timer = setTimeout(() => {
068:             IF settled THEN RETURN
069:             settled = true
070:             // [HIGH 10 FIX] On timeout, perform full cleanup — not just reject:
071:             // 1. Remove the notification listener so it doesn't fire after rejection
072:             IF notificationDisposable THEN notificationDisposable.dispose()
073:             // 2. Close the JSON-RPC connection
074:             IF this.rpcConnection THEN this.rpcConnection.dispose()
075:             this.rpcConnection = null
076:             // 3. Kill the subprocess via process group (negative PID)
077:             IF this.subprocess AND this.subprocess.pid
078:               TRY process.kill(-this.subprocess.pid, 'SIGTERM')
079:               CATCH (e) IF e.code !== 'ESRCH' THROW e  // ignore if process already dead
080:             // 4. Set state to dead
081:             this.alive = false
082:             reject(new Error("LSP service ready timeout"))
083:           }, 10000)
084:           notificationDisposable = rpcConnection.onNotification('lsp/ready', () => {
085:             IF settled THEN RETURN
086:             settled = true
087:             clearTimeout(timer)
088:             resolve()
089:           })
090:         })
091:
092:       SET this.alive = true
093:       LOG debug "LSP service started successfully"
094:
095:     CATCH error
096:       LOG debug "Failed to start LSP service: ${error.message}"
097:       SET this.alive = false
098:       IF NOT this.unavailableReason
099:         this.unavailableReason = 'Service startup failed: ' + error.message
100:       CLEANUP any partially created subprocess
101:
102:   METHOD async checkFile(filePath: string, text?: string, signal?: AbortSignal): Promise<Diagnostic[]>
103:     IF NOT this.alive OR this.rpcConnection is null
104:       RETURN []
105:     // REQ-TIME-080: If signal is already aborted, return immediately
106:     IF signal?.aborted THEN RETURN []
107:     TRY
108:       // [RESEARCH — Design Decision 3] Include optional file content in request
109:       // [HIGH #14 FIX] AbortSignal translated to JSON-RPC CancellationToken:
110:       IF signal provided:
111:         LET tokenSource = new CancellationTokenSource()
112:         CONST onAbort = () => tokenSource.cancel()
113:         signal.addEventListener('abort', onAbort)
114:         TRY
115:           LET response = AWAIT this.rpcConnection.sendRequest('lsp/checkFile', { filePath, text }, tokenSource.token)
116:           RETURN response as Diagnostic[]
117:         FINALLY
118:           signal.removeEventListener('abort', onAbort)
119:       ELSE:
120:         LET response = AWAIT this.rpcConnection.sendRequest('lsp/checkFile', { filePath, text })
121:         RETURN response as Diagnostic[]
122:     CATCH error
118:       LOG debug "checkFile failed: ${error.message}"
119:       RETURN []
120:
121:   METHOD async getAllDiagnostics(): Promise<Record<string, Diagnostic[]>>
122:     IF NOT this.alive OR this.rpcConnection is null
123:       RETURN {}
124:     TRY
125:       SEND RPC request 'lsp/diagnostics' with params {}
126:       RECEIVE result: Record<string, Diagnostic[]>
127:       RETURN result
128:     CATCH error
129:       LOG debug "getAllDiagnostics failed: ${error.message}"
130:       RETURN {}
131:
132:   METHOD async status(): Promise<ServerStatus[]>
133:     IF NOT this.alive OR this.rpcConnection is null
134:       RETURN []
135:     TRY
136:       SEND RPC request 'lsp/status' with params {}
137:       RECEIVE result: ServerStatus[]
138:       RETURN result
139:     CATCH error
140:       LOG debug "status failed: ${error.message}"
141:       RETURN []
142:
143:   METHOD isAlive(): boolean
144:     RETURN this.alive
145:
146:   // [RESEARCH FIX — Bug 2] Epoch-based freshness API for write tool multi-file flow
147:   // Epoch is SERVER-AUTHORITATIVE: no local mirror. This RPC call fetches the current
148:   // orchestrator-side epoch, eliminating divergence on error/abort paths.
149:   METHOD async getDiagnosticEpoch(): Promise<number>
150:     IF NOT this.alive OR this.rpcConnection is null
151:       RETURN 0
152:     TRY
153:       SEND RPC request 'lsp/getDiagnosticEpoch' with params {}
154:       RECEIVE result: number
155:       RETURN result
156:     CATCH error
157:       LOG debug "getDiagnosticEpoch failed: ${error.message}"
158:       RETURN 0
159:
160:   METHOD async getAllDiagnosticsAfter(afterEpoch: number, waitMs?: number): Promise<Record<string, Diagnostic[]>>
161:     IF NOT this.alive OR this.rpcConnection is null
162:       RETURN {}
163:     TRY
164:       SEND RPC request 'lsp/diagnosticsAfter' with params { afterEpoch, waitMs: waitMs ?? 250 }
165:       RECEIVE result: Record<string, Diagnostic[]>
166:       RETURN result
167:     CATCH error
168:       LOG debug "getAllDiagnosticsAfter failed: ${error.message}"
169:       RETURN {}
170:
171:   // REQ-STATUS-035: Expose the reason why LSP is unavailable
172:   METHOD getUnavailableReason(): string | undefined
173:     RETURN this.unavailableReason
174:
175:   METHOD async shutdown(): Promise<void>
176:     IF NOT this.alive
177:       RETURN
178:     TRY
179:       LOG debug "Shutting down LSP service"
180:       CONST shutdownRequest = this.rpcConnection?.sendRequest('lsp/shutdown', {})
181:       IF shutdownRequest
182:         LET timeoutHandle: NodeJS.Timeout | null = null
183:         CONST timeoutPromise = new Promise<void>((resolve) => {
184:           timeoutHandle = setTimeout(() => resolve(), 5000)
185:         })
186:         AWAIT Promise.race([
187:           shutdownRequest.then(() => undefined).catch(() => undefined),
188:           timeoutPromise
189:         ])
190:         IF timeoutHandle THEN clearTimeout(timeoutHandle)
191:     CATCH error
192:       LOG debug "Graceful shutdown failed: ${error.message}"
193:     FINALLY
185:       IF this.subprocess is not null AND this.subprocess.pid
186:         // Negative PID sends signal to entire process group, ensuring child LSP server
187:         // processes (tsserver, gopls, etc.) spawned by the Bun service are also terminated.
188:         TRY process.kill(-this.subprocess.pid, 'SIGTERM')
189:         CATCH (e) IF e.code !== 'ESRCH' THROW e  // ignore if process already dead
190:         CONST killTimer = setTimeout(() => {
191:           IF this.subprocess?.pid
192:             TRY process.kill(-this.subprocess.pid, 'SIGKILL')
193:             CATCH (e) IF e.code !== 'ESRCH' THROW e  // ignore if process already dead
194:         }, 2000)
195:         // Wait for process exit, then clear the SIGKILL timer
196:         AWAIT waitForExit(this.subprocess).catch(() => {})
197:         clearTimeout(killTimer)
198:       SET this.alive = false
199:       SET this.rpcConnection = null
200:       SET this.subprocess = null
201:
202:   METHOD getMcpTransportStreams(): { readable: Readable, writable: Writable } | null
203:     IF NOT this.alive OR this.subprocess is null
204:       RETURN null
205:     RETURN {
206:       readable: this.subprocess.stdio[3],
207:       writable: this.subprocess.stdio[4]
208:     }
209:
210: END CLASS
```


---

## Integration Points

| Line | Call | Details |
|------|------|---------|
| 019 | `which('bun')` | Must check system PATH for bun binary. Uses a simple which implementation or `child_process.execSync('which bun')`. Failure = silent disable. |
| 026 | `fs.accessSync(lspMainPath)` | Checks that the LSP package entry point exists. Path resolved relative to core package location. |
| 034-039 | `child_process.spawn('bun', ...)` | Spawns the Bun subprocess. stdio array must have exactly 5 elements for stdin, stdout, stderr, fd3, fd4. `cwd` must be workspace root. `detached: true` gives subprocess its own process group for clean group-kill at shutdown. |
| 041-045 | `createMessageConnection(reader, writer)` | From `vscode-jsonrpc`. Creates a JSON-RPC message connection on the subprocess's stdin/stdout. Reader on subprocess stdout (our input), writer on subprocess stdin (our output). |
| 056 | `rpcConnection.listen()` | Starts listening for messages on the JSON-RPC connection. Must be called before any requests. |
| 061-090 | `waitForReadySignal(rpcConnection, 10000)` | [HIGH 10 FIX] Waits for lsp/ready notification. On timeout: removes listener, closes RPC connection, kills subprocess via process group (`process.kill(-pid, 'SIGTERM')`), sets state to dead — then rejects. |
| 109-116 | `rpcConnection.sendRequest('lsp/checkFile', ...)` | [HIGH #14 FIX] JSON-RPC request to the LSP service. Returns `Diagnostic[]`. AbortSignal translated to CancellationToken: creates CancellationTokenSource, wires abort listener, passes token to sendRequest. |
| 125 | `rpcConnection.sendRequest('lsp/diagnostics', ...)` | JSON-RPC request returning all diagnostics. |
| 136 | `rpcConnection.sendRequest('lsp/status', ...)` | JSON-RPC request returning server status. |
| 180 | `rpcConnection.sendRequest('lsp/shutdown', ...)` | JSON-RPC request to initiate graceful shutdown. |
| 185-197 | `process.kill(-subprocess.pid, 'SIGTERM')` | Sends SIGTERM to the entire process group (negative PID). Fallback `process.kill(-pid, 'SIGKILL')` after 2s timeout. Requires `detached: true` at spawn and `subprocess.pid` guard. |
| 202-208 | `getMcpTransportStreams()` | Provides fd3/fd4 streams for direct MCP SDK Client registration of navigation tools. fd3 is readable (from subprocess), fd4 is writable (to subprocess). Bypasses McpClientManager. |

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Auto-restart the subprocess after crash
[OK]    DO: Set alive=false permanently, return empty results (REQ-LIFE-080, REQ-GRACE-045)

[ERROR] DO NOT: Throw errors from checkFile/getAllDiagnostics
[OK]    DO: Catch all errors, return [] or {} (REQ-GRACE-050)

[ERROR] DO NOT: Use Bun APIs in this file (this is in packages/core, Node.js)
[OK]    DO: Use only Node.js child_process, vscode-jsonrpc (REQ-ARCH-050)

[ERROR] DO NOT: Store raw Diagnostic objects in session/metadata
[OK]    DO: Return Diagnostic[] to caller, let caller format strings (REQ-SCOPE-030)

[ERROR] DO NOT: Block on startup indefinitely — use bounded startup handshake timeout (10s) for ready signal
[OK]    DO: Wait for lsp/ready notification with its own bounded startup timeout (10s), distinct from diagnostic first-touch timeout; if not received, cleanup resources and mark service as permanently dead

[ERROR] DO NOT: Leave listeners dangling on ready-wait timeout
[OK]    DO: On timeout, dispose notification listener, close RPC connection, kill subprocess, mark dead — then reject

[ERROR] DO NOT: Write non-JSON-RPC content to the Bun process stdout (it is the RPC channel)
[OK]    DO: Bun process stderr is for debug logs; stdout is exclusively for JSON-RPC protocol messages

[WARN]  NOTE: If LSP_BOOTSTRAP exceeds ~128KB, consider writing config to a temp file and passing the path instead

[ERROR] DO NOT: Use HTTP/WebSocket for the RPC connection
[OK]    DO: Use stdio-based JSON-RPC (stdin/stdout pipes) (REQ-ARCH-020)

[ERROR] DO NOT: Create multiple subprocess instances
[OK]    DO: One Bun subprocess, two channels (stdin/stdout + fd3/fd4) (REQ-ARCH-040)
```
