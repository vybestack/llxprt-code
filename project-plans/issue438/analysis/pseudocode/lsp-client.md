# Pseudocode: LspClient (packages/lsp/src/service/lsp-client.ts)

## Plan Reference
- **Plan ID**: PLAN-20250212-LSP
- **Requirements**: REQ-LIFE-010, REQ-LIFE-030, REQ-LIFE-070, REQ-TIME-050, REQ-TIME-060, REQ-TIME-070, REQ-TIME-080, REQ-TIME-090, REQ-FMT-080, REQ-KNOWN-010, REQ-KNOWN-020

---

## Interface Contracts

### INPUTS this component receives:

```typescript
interface LspClientConfig {
  serverConfig: ServerConfig;   // from ServerRegistry
  workspaceRoot: string;        // detected nearest project root
}
```

### OUTPUTS this component produces:

```typescript
interface LspClientOutput {
  initialize(): Promise<void>;
  touchFile(filePath: string, timeoutMs: number, text?: string, signal?: AbortSignal): Promise<Diagnostic[]>;
  getCurrentDiagnostics(): Map<string, Diagnostic[]>;
  gotoDefinition(file: string, line: number, char: number): Promise<Location[]>;
  findReferences(file: string, line: number, char: number): Promise<Location[]>;
  hover(file: string, line: number, char: number): Promise<HoverResult | null>;
  documentSymbols(file: string): Promise<DocumentSymbol[]>;
  workspaceSymbols(query: string): Promise<SymbolInformation[]>;
  shutdown(): Promise<void>;
  isInitializing(): boolean;
  isAlive(): boolean;
  getPid(): number | undefined;
  onCrash(callback: () => void): void;
  getDiagnosticEpoch(): number;
  waitForDiagnosticEpoch(target: number, timeoutMs: number): Promise<boolean>;
}
```

### DEPENDENCIES this component requires:

```typescript
interface Dependencies {
  spawn: typeof Bun.spawn;                    // Bun process spawning
  jsonrpc: typeof import('vscode-jsonrpc');     // JSON-RPC for LSP protocol
  diagnosticsFormatter: DiagnosticsFormatter;   // Diagnostic normalization
  onDiagnostics: (sourceKey: string, filePath: string, diagnostics: Diagnostic[], workspaceRoot: string) => void;
    // Callback from orchestrator — called on every publishDiagnostics notification.
    // Orchestrator passes this.updateKnownFiles.bind(this) when creating the client.
    // [HIGH #5 FIX] Callback receives workspaceRoot so orchestrator can normalize
    // absolute file paths to workspace-relative paths deterministically.
    // CONTRACT: filePath is ABSOLUTE. Orchestrator normalizes to workspace-relative
    // paths using path.relative(workspaceRoot, filePath) before storing in knownFileDiagSources.
}
```

---

## Pseudocode

```
01: CLASS LspClient
02:   PRIVATE serverProcess: BunSubprocess | null = null
03:   PRIVATE connection: MessageConnection | null = null
04:   PRIVATE diagnosticMap: Map<string, LspDiagnostic[]> = new Map()
05:   PRIVATE openFiles: Map<string, number> = new Map()  // filePath → version
06:   PRIVATE initializing: boolean = true
07:   PRIVATE dead: boolean = false
08:   PRIVATE crashCallbacks: Array<() => void> = []
09:   PRIVATE readonly serverConfig: ServerConfig
010:   PRIVATE readonly workspaceRoot: string
011:   PRIVATE readonly logger: DebugLogger
012:   PRIVATE diagnosticResolvers: Map<string, DiagnosticResolver[]> = new Map()
013:   // [RESEARCH FIX — Bug 2: Diagnostic epoch counter for freshness tracking]
014:   PRIVATE diagEpoch: number = 0
015:   PRIVATE epochWaiters: Array<{ target: number, resolve: (value: boolean) => void }> = []
016:   PRIVATE readonly onDiagnosticsCallback: (sourceKey: string, filePath: string, diagnostics: Diagnostic[], workspaceRoot: string) => void
017:
018:   // [HIGH 4 FIX] Resolver stores resolve AND reject. The debounce timer is managed
019:   // entirely by the waitForDiagnostics closure, NOT stored in the resolver.
020:   INTERFACE DiagnosticResolver {
021:     resolve: (diagnostics: Diagnostic[]) => void
022:     reject: (error: Error) => void
023:     filePath: string
024:   }
025:
026:   CONSTRUCTOR(serverConfig: ServerConfig, workspaceRoot: string, onDiagnostics: callback)
027:     SET this.serverConfig = serverConfig
028:     SET this.workspaceRoot = workspaceRoot
029:     SET this.logger = new DebugLogger('llxprt:lsp:client:' + serverConfig.id)
030:     SET this.onDiagnosticsCallback = onDiagnostics
031:
032:   METHOD async initialize(): Promise<void>
033:     LOG debug "Initializing ${serverConfig.id} at ${workspaceRoot}"
034:
035:     SPAWN serverProcess = Bun.spawn([serverConfig.command, ...serverConfig.args], {
036:       stdin: 'pipe',
037:       stdout: 'pipe',
038:       stderr: 'pipe',
039:       cwd: workspaceRoot,
040:       env: { ...process.env, ...serverConfig.env }
041:     })
042:
043:     CREATE connection = createMessageConnection(
044:       new StreamMessageReader(serverProcess.stdout),
045:       new StreamMessageWriter(serverProcess.stdin)
046:     )
047:
048:     REGISTER notification handler for 'textDocument/publishDiagnostics':
049:       ON notification(params):
050:         CONST uri = params.uri
051:         CONST filePath = uriToFilePath(uri)
052:         SET diagnosticMap.set(filePath, params.diagnostics)
053:         IF params.diagnostics.length === 0
054:           diagnosticMap.delete(filePath)  // REQ-KNOWN-020
055:         // [HIGH 7] Notify orchestrator of diagnostic update for known-files tracking
        // CONTRACT: LspClient passes ABSOLUTE file paths in the onDiagnostics callback.
        // Orchestrator's updateKnownFiles normalizes to workspace-relative paths before
        // storing in knownFileDiagSources.
056:         CONST normalized = params.diagnostics.map(d => normalizeDiagnostic(d, filePath))
057:         CONST sourceKey = `${serverConfig.id}:${workspaceRoot}`
058:         this.onDiagnosticsCallback(sourceKey, filePath, normalized, this.workspaceRoot)
059:         // Resolve any pending diagnostic waiters for this file (with debounce)
060:         RESOLVE pending resolvers for filePath via triggerResolvers(filePath)
061:         // [RESEARCH FIX — Bug 2] Increment diagnostic epoch on every publish
062:         this.diagEpoch++
063:         // Resolve any epoch waiters whose target has been reached
064:         FOR EACH waiter IN epochWaiters WHERE waiter.target <= this.diagEpoch
065:           waiter.resolve(true)
066:         REMOVE resolved waiters from epochWaiters
067:
068:     LISTEN serverProcess exit event:
069:       ON exit:
070:         LOG debug "${serverConfig.id} exited"
071:         SET this.connection = null
072:         SET this.dead = true
073:         NOTIFY all crashCallbacks
074:         // [HIGH 4 FIX] REJECT all pending diagnostic resolvers with crash error
075:         FOR EACH [filePath, resolvers] IN diagnosticResolvers
076:           FOR EACH resolver IN resolvers
077:             resolver.reject(new Error('Server crashed'))
078:         diagnosticResolvers.clear()
079:         // [MEDIUM 1] Resolve all epoch waiters with false on crash
080:         FOR EACH waiter IN epochWaiters
081:           waiter.resolve(false)
082:         epochWaiters.length = 0
083:
084:     connection.listen()
085:
086:     SEND initialize request:
087:       CONST initResult = await connection.sendRequest('initialize', {
088:         processId: process.pid,
089:         rootUri: filePathToUri(workspaceRoot),
090:         capabilities: {
091:           textDocument: {
092:             publishDiagnostics: { relatedInformation: false },
093:             definition: { dynamicRegistration: false },
094:             references: { dynamicRegistration: false },
095:             hover: { contentFormat: ['plaintext'] },
096:             documentSymbol: { dynamicRegistration: false },
097:           },
098:           workspace: {
099:             workspaceFolders: true,
100:             symbol: { dynamicRegistration: false },
101:           }
102:         },
103:         initializationOptions: serverConfig.initializationOptions ?? {}
104:       })
105:
106:     STORE server capabilities from initResult
107:
108:     SEND initialized notification:
109:       connection.sendNotification('initialized', {})
110:
111:     SET this.initializing = false
112:     LOG debug "${serverConfig.id} initialized successfully"
113:
114:   METHOD async touchFile(filePath: string, timeoutMs: number, text?: string, signal?: AbortSignal): Promise<Diagnostic[]>
115:     IF this.connection is null
116:       RETURN []
117:
118:     CONST uri = filePathToUri(filePath)
119:     // [RESEARCH — Design Decision 3] Use provided text if available; fall back to disk read
120:     CONST fileContent = text ?? await readFile(filePath, 'utf-8')
121:
122:     IF openFiles.has(filePath)
123:       CONST version = openFiles.get(filePath) + 1
124:       openFiles.set(filePath, version)
125:       SEND textDocument/didChange notification:
126:         connection.sendNotification('textDocument/didChange', {
127:           textDocument: { uri, version },
128:           contentChanges: [{ text: fileContent }]  // full content sync
129:         })
130:     ELSE
131:       CONST version = 1
132:       openFiles.set(filePath, version)
133:       CONST languageId = getLanguageId(filePath)
134:       SEND textDocument/didOpen notification:
135:         connection.sendNotification('textDocument/didOpen', {
136:           textDocument: { uri, version, languageId, text: fileContent }
137:         })
138:
139:     RETURN await this.waitForDiagnostics(filePath, timeoutMs, signal)
140:
141:   // Semantics: waits for at least one publishDiagnostics notification for the file,
142:   // then debounces. If no notification arrives before timeout, returns empty array.
143:   // A timeout-only return with no notification is distinguishable from a
144:   // notification-then-debounce return by whether diagnostics are empty.
145:   METHOD async waitForDiagnostics(filePath: string, timeoutMs: number, signal?: AbortSignal): Promise<Diagnostic[]>
146:     // [HIGH 4 FIX] Wrapping promise catches rejections from server crash and returns []
143:     TRY
144:       RETURN await this._waitForDiagnosticsInner(filePath, timeoutMs, signal)
145:     CATCH error
146:       LOG debug "waitForDiagnostics rejected: ${error.message}"
147:       RETURN []
148:
149:   PRIVATE METHOD _waitForDiagnosticsInner(filePath: string, timeoutMs: number, signal?: AbortSignal): Promise<Diagnostic[]>
150:     RETURN new Promise((resolve, reject) => {
151:       // [HIGH 3 FIX] Debounce timer is managed entirely within this closure,
152:       // NOT stored in the resolver. The resolver only stores { resolve, reject, filePath }.
153:       LET debounceTimer: NodeJS.Timeout | null = null
154:       LET timeoutTimer: NodeJS.Timeout
155:       LET settled: boolean = false
156:       // [RESEARCH FIX — Bug 3] Track absolute deadline for debounce clamping
157:       CONST deadline = Date.now() + timeoutMs
158:       LET sawDiagnosticAfterSubscribe: boolean = false
159:
160:       CONST finish = () => {
161:         IF settled RETURN
162:         settled = true
163:         CLEAR timeoutTimer
164:         IF debounceTimer CLEAR debounceTimer
165:         CONST rawDiags = diagnosticMap.get(filePath) ?? []
166:         CONST normalized = rawDiags.map(d => normalizeDiagnostic(d, filePath))
167:         REMOVE this resolver from diagnosticResolvers
168:         resolve(normalized)
169:       }
170:
171:       CONST onDiagnosticReceived = () => {
172:         sawDiagnosticAfterSubscribe = true
173:         IF debounceTimer is not null
174:           CLEAR debounceTimer
175:         // [RESEARCH FIX — Bug 3] Clamp debounce to remaining time before deadline
176:         CONST remaining = Math.max(0, deadline - Date.now())
177:         CONST delay = Math.min(150, remaining)
178:         // When remaining <= 0, delay is 0 — debounce effectively skipped (immediate resolve).
179:         // This is intentional: past the deadline, return whatever diagnostics we have now.
180:         debounceTimer = setTimeout(finish, delay)
181:       }
182:
183:       CONST onReject = (error: Error) => {
184:         IF settled RETURN
185:         settled = true
186:         CLEAR timeoutTimer
187:         IF debounceTimer CLEAR debounceTimer
188:         reject(error)
189:       }
190:
191:       REGISTER resolver for this filePath:
192:         IF NOT diagnosticResolvers.has(filePath) THEN diagnosticResolvers.set(filePath, [])
193:         CONST resolver = { resolve: onDiagnosticReceived, reject: onReject, filePath }
194:         diagnosticResolvers.get(filePath)!.push(resolver)
195:
195a:     // REQ-TIME-080: If signal is aborted, resolve immediately with current diagnostics
195b:     IF signal
195c:       IF signal.aborted THEN finish(); RETURN
195d:       // { once: true } prevents listener accumulation across repeated calls — the listener
195d1:      // auto-removes after firing once, so no explicit removeEventListener is needed.
195d2:      // NOTE: { once: true } listeners are GC'd when the AbortSignal is GC'd. Since
195d3:      // AbortSignal lifetime is bounded by the request/timeout, this is acceptable.
195d4:      // No manual removeEventListener needed.
195d5:      signal.addEventListener('abort', () => finish(), { once: true })
195e:
196:       timeoutTimer = setTimeout(() => {
197:         // [RESEARCH FIX — Bug 3] If a debounce was in progress when timeout fires,
198:         // resolve immediately with latest data instead of waiting past deadline
199:         IF sawDiagnosticAfterSubscribe AND debounceTimer
200:           CLEAR debounceTimer
201:         finish()
202:       }, timeoutMs)
203:     })
204:
205:   // [HIGH 7] triggerResolvers: called from publishDiagnostics handler to invoke
206:   // each resolver's resolve callback (which triggers debounce in the closure)
207:   PRIVATE METHOD triggerResolvers(filePath: string): void
208:     CONST resolvers = diagnosticResolvers.get(filePath)
209:     IF resolvers is undefined RETURN
210:     FOR EACH resolver IN resolvers
211:       resolver.resolve([])  // argument unused — finish() reads from diagnosticMap
212:
213:   PRIVATE METHOD normalizeDiagnostic(lspDiag: LspDiagnostic, filePath: string): Diagnostic
214:     RETURN {
215:       file: path.relative(workspaceRoot, filePath),
216:       line: lspDiag.range.start.line + 1,        // 0-based → 1-based
217:       character: lspDiag.range.start.character + 1, // 0-based → 1-based
218:       severity: mapSeverity(lspDiag.severity),    // 1→error, 2→warning, etc.
219:       message: escapeXml(lspDiag.message),
220:       code: extractCode(lspDiag.code),
221:       source: lspDiag.source
222:     }
223:
224:   METHOD getCurrentDiagnostics(): Map<string, Diagnostic[]>
225:     CONST result = new Map<string, Diagnostic[]>()
226:     FOR EACH [filePath, lspDiags] IN diagnosticMap
227:       CONST normalized = lspDiags.map(d => normalizeDiagnostic(d, filePath))
228:       result.set(path.relative(workspaceRoot, filePath), normalized)
229:     RETURN result
230:
231:   // --- Navigation methods ---
232:
233:   METHOD async gotoDefinition(file, line, char): Promise<Location[]>
234:     IF connection is null RETURN []
235:     CONST result = await connection.sendRequest('textDocument/definition', {
236:       textDocument: { uri: filePathToUri(file) },
237:       position: { line, character: char }
238:     })
239:     RETURN normalizeLocationResult(result)
240:
241:   METHOD async findReferences(file, line, char): Promise<Location[]>
242:     IF connection is null RETURN []
243:     CONST result = await connection.sendRequest('textDocument/references', {
244:       textDocument: { uri: filePathToUri(file) },
245:       position: { line, character: char },
246:       context: { includeDeclaration: true }
247:     })
248:     RETURN normalizeLocationResult(result)
249:
250:   METHOD async hover(file, line, char): Promise<HoverResult | null>
251:     IF connection is null RETURN null
252:     CONST result = await connection.sendRequest('textDocument/hover', {
253:       textDocument: { uri: filePathToUri(file) },
254:       position: { line, character: char }
255:     })
256:     IF result is null RETURN null
257:     RETURN { contents: extractHoverContents(result.contents), range: result.range }
258:
259:   METHOD async documentSymbols(file): Promise<DocumentSymbol[]>
260:     IF connection is null RETURN []
261:     RETURN await connection.sendRequest('textDocument/documentSymbol', {
262:       textDocument: { uri: filePathToUri(file) }
263:     })
264:
265:   METHOD async workspaceSymbols(query: string): Promise<SymbolInformation[]>
266:     IF connection is null RETURN []
267:     RETURN await connection.sendRequest('workspace/symbol', {
268:       query
269:     })
270:
271:   METHOD async shutdown(): Promise<void>
272:     // NOTE: Language servers are spawned with detached: false (default) so they belong
272a:   // to the Bun service's process group. When the Bun service is killed via process-group
272b:   // from Node.js (process.kill(-pid, signal) in LspServiceClient), all language servers
272c:   // are also terminated. Individual server shutdown here uses direct serverProcess.kill()
272d:   // which is correct for graceful single-server shutdown within the Bun process.
273:     TRY
274:       IF connection is not null
275:         await connection.sendRequest('shutdown')
276:         connection.sendNotification('exit')
277:       IF serverProcess is not null
278:         serverProcess.kill()
278:     CATCH error
279:       LOG debug "Shutdown error: ${error.message}"
280:     FINALLY
281:       connection = null
282:       SET this.dead = true
283:       diagnosticMap.clear()
284:       openFiles.clear()
285:       // [HIGH 4] Reject all pending diagnostic resolvers on shutdown
286:       FOR EACH [fp, resolvers] IN diagnosticResolvers
287:         FOR EACH resolver IN resolvers
288:           resolver.reject(new Error('Client shutting down'))
289:       diagnosticResolvers.clear()
290:       // [MEDIUM 1] Resolve all epoch waiters with false on shutdown
291:       FOR EACH waiter IN epochWaiters
292:         waiter.resolve(false)
293:       epochWaiters.length = 0
294:
295:   METHOD isInitializing(): boolean
296:     RETURN this.initializing
297:
298:   METHOD isAlive(): boolean
299:     RETURN NOT this.dead AND this.connection is not null
300:
301:   METHOD getPid(): number | undefined
302:     RETURN serverProcess?.pid
303:
304:   METHOD onCrash(callback: () => void): void
305:     crashCallbacks.push(callback)
306:
307:   // --- [RESEARCH FIX — Bug 2: Diagnostic epoch API for freshness tracking] ---
308:
309:   METHOD getDiagnosticEpoch(): number
310:     RETURN this.diagEpoch
311:
312:   METHOD async waitForDiagnosticEpoch(target: number, timeoutMs: number): Promise<boolean>
313:     IF this.diagEpoch >= target RETURN true
314:     RETURN new Promise((resolve) => {
315:       LET timer: NodeJS.Timeout
316:       CONST waiter = { target, resolve: (value: boolean) => { clearTimeout(timer); resolve(value) } }
317:       timer = setTimeout(() => {
318:         // Remove this waiter from the array before resolving false (cleanup)
319:         CONST idx = epochWaiters.indexOf(waiter)
320:         IF idx >= 0 THEN epochWaiters.splice(idx, 1)
321:         resolve(false)
322:       }, timeoutMs)
323:       epochWaiters.push(waiter)
324:     })
324:
325: END CLASS
```

---

## Integration Points

| Line | Call | Details |
|------|------|---------|
| 035-041 | `Bun.spawn(...)` | Spawns the actual LSP server binary. Must use Bun APIs since this runs in the Bun package. |
| 043-046 | `createMessageConnection(reader, writer)` | Creates JSON-RPC connection to the language server. Standard vscode-jsonrpc pattern. |
| 048-066 | `publishDiagnostics` handler | Core notification from LSP server. Updates diagnosticMap, notifies orchestrator via onDiagnostics callback, triggers pending resolvers with debounce, increments diagnostic epoch. |
| 087-104 | `initialize` request | LSP protocol handshake. Capabilities must match what we use (diagnostics, definition, references, hover, symbols). |
| 126-129 | `textDocument/didChange` | Full content sync (not incremental). Simpler and sufficient for our use case. |
| 134-137 | `textDocument/didOpen` | First time opening a file in a server. Must include languageId. |
| 180 | `setTimeout(finish, delay)` | Debounce timer clamped to remaining deadline. Servers often send multiple publishDiagnostics in quick succession. Wait for them to settle. |
| 216-217 | 0→1 based conversion | LSP protocol uses 0-based lines/chars. Our Diagnostic type uses 1-based. Conversion happens here. |
| 219 | `escapeXml(message)` | Sanitize `<`, `>`, `&` in diagnostic messages. From diagnostics utility. |
| 265-269 | `workspaceSymbols(query)` | LSP `workspace/symbol` request. Returns symbols matching query across workspace. |
| 274-275 | `shutdown` / `exit` | LSP protocol shutdown sequence. shutdown is a request (expects response), exit is a notification (no response). |

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Use incremental text sync (complex, error-prone)
[OK]    DO: Use full document sync (simpler, sufficient for edit-then-diagnose pattern)

[ERROR] DO NOT: Resolve diagnostic waiters immediately on first publishDiagnostics
[OK]    DO: Apply 150ms debounce — servers send multiple rapid updates (REQ-TIME-050)

[ERROR] DO NOT: Keep files in diagnosticMap when diagnostics become empty
[OK]    DO: Remove entries with empty diagnostics to maintain known-files set correctly (REQ-KNOWN-020)

[ERROR] DO NOT: Return 0-based line/character numbers
[OK]    DO: Convert to 1-based in normalizeDiagnostic (REQ-FMT-080)

[ERROR] DO NOT: Restart the server process after crash
[OK]    DO: Notify crash callbacks, let orchestrator mark as broken (REQ-LIFE-070)

[ERROR] DO NOT: Block indefinitely waiting for diagnostics
[OK]    DO: Always use timeout, resolve with whatever is available (REQ-TIME-010, REQ-TIME-060)

[ERROR] DO NOT: Store the debounce timer in the DiagnosticResolver
[OK]    DO: Let the waitForDiagnostics closure manage its own debounce timer. The resolver only stores { resolve, reject, filePath }.

[ERROR] DO NOT: Leave epoch waiters dangling on shutdown/crash
[OK]    DO: Resolve all epoch waiters with false on shutdown or process exit (prevents memory leaks and hanging promises)
```
