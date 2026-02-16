# Pseudocode: Orchestrator (packages/lsp/src/service/orchestrator.ts)

## Plan Reference
- **Plan ID**: PLAN-20250212-LSP
- **Requirements**: REQ-LIFE-010, REQ-LIFE-020, REQ-LIFE-030, REQ-LIFE-060, REQ-LIFE-070, REQ-LIFE-090, REQ-ARCH-040, REQ-ARCH-080, REQ-ARCH-090, REQ-BOUNDARY-010, REQ-BOUNDARY-020, REQ-BOUNDARY-030, REQ-TIME-010, REQ-TIME-015, REQ-TIME-030, REQ-TIME-040, REQ-TIME-060, REQ-TIME-080, REQ-TIME-085, REQ-TIME-090, REQ-LANG-040, REQ-FMT-065, REQ-FMT-070, REQ-KNOWN-010, REQ-KNOWN-020, REQ-KNOWN-030, REQ-STATUS-025, REQ-STATUS-045

---

## Interface Contracts

### INPUTS this component receives:

```typescript
interface OrchestratorConfig {
  workspaceRoot: string;
  diagnosticTimeout: number;     // default 3000ms
  firstTouchTimeout: number;     // default 10000ms
  maxDiagnosticsPerFile: number; // default 20
  maxProjectDiagnosticsFiles: number; // default 5
  includeSeverities: Severity[]; // default ['error']
  servers: Record<string, UserServerConfig>;
}

interface CheckFileRequest {
  filePath: string;  // absolute path
  text?: string;     // [RESEARCH — Design Decision 3] optional file content, authoritative if present
}
```

### OUTPUTS this component produces:

```typescript
interface OrchestratorOutput {
  checkFile(filePath: string, text?: string, signal?: AbortSignal): Promise<Diagnostic[]>;
  // [HIGH #2 FIX] getAllDiagnostics is synchronous — it reads from the in-memory
  // knownFileDiagSources map. No I/O, no async. The async variant is getAllDiagnosticsAfter.
  getAllDiagnostics(): Record<string, Diagnostic[]>;
  // [RESEARCH FIX — Bug 2] Epoch-based freshness for write tool multi-file flow
  getDiagnosticEpoch(): number;
  getAllDiagnosticsAfter(afterEpoch: number, waitMs?: number): Promise<Record<string, Diagnostic[]>>;
  getStatus(): ServerStatus[];
  shutdown(): Promise<void>;
  // Navigation methods (delegated from MCP channel)
  gotoDefinition(file: string, line: number, character: number): Promise<Location[]>;
  findReferences(file: string, line: number, character: number): Promise<Location[]>;
  hover(file: string, line: number, character: number): Promise<HoverResult | null>;
  documentSymbols(file: string): Promise<DocumentSymbol[]>;
  workspaceSymbols(query: string): Promise<SymbolInformation[]>;
}
```

### DEPENDENCIES this component requires:

```typescript
interface Dependencies {
  serverRegistry: ServerRegistry;        // Lookup table of server configs
  languageMap: LanguageMap;              // Extension → languageId
  diagnosticsFormatter: DiagnosticsFormatter; // Format/filter/dedupe diagnostics
  lspClientFactory: (config: ServerConfig, workspaceRoot: string, onDiagnostics: callback) => LspClient;
    // [HIGH 7] Factory must accept onDiagnostics callback that the client will call
    // on every publishDiagnostics notification. Orchestrator passes this.updateKnownFiles.bind(this).
}
```

---

## Pseudocode

```
01: CLASS Orchestrator
02:   PRIVATE clients: Map<string, LspClient> = new Map()  // key: serverId:workspaceRoot
03:   PRIVATE brokenServers: Set<string> = new Set()        // key: serverId:workspaceRoot
04:   PRIVATE firstTouchServers: Set<string> = new Set()    // servers in first-touch init
05:   // REQ-KNOWN-030: Multi-server known-files tracking
06:   // Key: relative file path. Value: Set of composite keys (serverId:workspaceRoot) that hold
07:   // non-empty diagnostics for it. A file is "known" (eligible for multi-file diagnostic output)
08:   // if its Set is non-empty. A file is removed from this map ONLY when ALL servers' diagnostics
09:   // are empty.
010:   PRIVATE knownFileDiagSources: Map<string, Set<string>> = new Map()
011:   // [RESEARCH FIX — Bug 1: Concurrent server startup race] Single-flight guard
012:   // Prevents two concurrent checkFile calls from starting the same server twice.
013:   PRIVATE startupPromises: Map<string, Promise<LspClient>> = new Map()
014:   // [RESEARCH FIX — Bug 4: Shared orchestrator interleaving] Per-client operation queue
015:   // Ensures writes (didOpen/didChange) complete before reads (navigation) on same client.
016:   PRIVATE opQueues: Map<string, ClientOpQueue> = new Map()
017:   PRIVATE readonly config: OrchestratorConfig
018:   PRIVATE readonly serverRegistry: ServerRegistry
019:   PRIVATE readonly languageMap: LanguageMap
020:   PRIVATE readonly logger: DebugLogger
021:   // [RESEARCH FIX — Bug 2] Orchestrator-level monotonic epoch counter.
022:   // Incremented on every checkFile call. Used by getAllDiagnosticsAfter to
023:   // wait for diagnostic propagation after a checkFile before snapshotting.
024:   PRIVATE diagnosticEpoch: number = 0
025:   // [HIGH #1 FIX] Factory injected via constructor for DI/testing
026:   PRIVATE readonly lspClientFactory: (config: ServerConfig, workspaceRoot: string, onDiagnostics: callback) => LspClient
027:
028:   CONSTRUCTOR(config, serverRegistry, languageMap, lspClientFactory)
029:     SET this.config = config
030:     SET this.serverRegistry = serverRegistry
031:     SET this.languageMap = languageMap
032:     SET this.logger = new DebugLogger('llxprt:lsp:orchestrator')
033:     SET this.lspClientFactory = lspClientFactory
034:
035:   METHOD async checkFile(filePath: string, text?: string, signal?: AbortSignal): Promise<Diagnostic[]>
036:     VALIDATE filePath is within workspaceRoot
037:     IF NOT within workspace
038:       LOG debug "File outside workspace boundary: ${filePath}"
039:       RETURN []
040:
041:     // REQ-TIME-080: If signal is already aborted, return immediately with empty diagnostics
042:     IF signal?.aborted THEN RETURN []
043:     NORMALIZE filePath to absolute, resolve symlinks
044:     DETERMINE extension from filePath
045:     LOOKUP applicableServers from serverRegistry.getServersForExtension(extension)
046:
047:     IF applicableServers is empty
048:       LOG debug "No LSP servers configured for extension: ${extension}"
049:       RETURN []
050:
051:     FILTER out disabled servers (config.servers[id]?.enabled === false)
052:     FILTER out broken servers (brokenServers.has(serverId:workspaceRoot))
053:
054:     IF filtered list is empty
055:       RETURN []
056:
057:     COLLECT diagnostics from all applicable servers IN PARALLEL:
058:       CONST diagnosticPromises = applicableServers.map(serverConfig => {
059:         // [HIGH 11 FIX] Compute workspace root PER-SERVER, not once for all servers.
060:         // Different servers may need different roots (e.g., tsserver → nearest package.json,
061:         // gopls → nearest go.mod). Each server config declares its own rootMarkers.
062:         CONST workspaceRootForServer = findNearestProjectRoot(filePath, [serverConfig])
063:         RETURN this.collectFromServer(serverConfig, filePath, workspaceRootForServer, text, signal)
064:       })
065:       CONST results = await Promise.allSettled(diagnosticPromises)
066:
067:     MERGE all successful results into single Diagnostic[]
068:     DEDUPLICATE by (file, range.start, range.end, message)
069:     FILTER by configured severities
070:     SORT by line number ascending
071:     // [RESEARCH FIX — Bug 2] Increment orchestrator-level epoch on every checkFile
072:     this.diagnosticEpoch++
073:     RETURN filtered diagnostics
074:
075:   PRIVATE METHOD async collectFromServer(
076:     serverConfig: ServerConfig,
077:     filePath: string,
078:     workspaceRoot: string,
079:     text?: string,
080:     signal?: AbortSignal
081:   ): Promise<Diagnostic[]>
082:     CONST clientKey = `${serverConfig.id}:${workspaceRoot}`
083:
084:     IF brokenServers.has(clientKey)
085:       RETURN []
086:
087:     // [RESEARCH FIX — Bug 1] Use single-flight guard instead of direct startServer
088:     LET client = await this.getOrStartClient(serverConfig, workspaceRoot)
089:     IF client is null
090:       RETURN []
091:
092:     // [RESEARCH FIX — Bug 5] First-touch is one-shot: clear in finally, not only on success
093:     CONST wasFirstTouch = firstTouchServers.has(clientKey)
094:     DETERMINE timeout:
095:       IF wasFirstTouch
096:         timeout = config.firstTouchTimeout
097:       ELSE
098:         timeout = config.diagnosticTimeout
099:
100:     // [RESEARCH FIX — Bug 4] Route through per-client operation queue (write priority)
101:     CONST queue = this.getOrCreateOpQueue(clientKey)
102:     TRY
103:       CONST diagnostics = await queue.enqueueWrite(() => client.touchFile(filePath, timeout, text, signal))
104:       RETURN diagnostics
105:     CATCH error
106:       IF error is server crash
107:         LOG debug "Server ${serverConfig.id} crashed: ${error.message}"
108:         brokenServers.add(clientKey)
109:         clients.delete(clientKey)
110:       ELSE
111:         LOG debug "Diagnostic collection error: ${error.message}"
112:       RETURN []
113:     FINALLY
114:       // [RESEARCH FIX — Bug 5] One-shot semantics: always clear first-touch flag
115:       IF wasFirstTouch
116:         firstTouchServers.delete(clientKey)
117:
118:   PRIVATE METHOD async startServer(
119:     serverConfig: ServerConfig,
120:     workspaceRoot: string
121:   ): Promise<LspClient>
122:     VALIDATE server binary is available
123:     IF NOT available
124:       THROW new Error("Server binary not found: ${serverConfig.command}")
125:
126:     // [HIGH #1 FIX] Use injected factory instead of direct construction for DI/testing
127:     CREATE client = this.lspClientFactory(serverConfig, workspaceRoot, this.updateKnownFiles.bind(this))
128:     AWAIT client.initialize()
129:     SETUP client crash listener:
130:       ON crash: brokenServers.add(clientKey), clients.delete(clientKey)
131:     RETURN client
132:
133:   // --- [RESEARCH FIX — Bug 1: Single-flight server startup guard] ---
134:
135:   PRIVATE METHOD async getOrStartClient(
136:     serverConfig: ServerConfig,
137:     workspaceRoot: string
138:   ): Promise<LspClient | null>
139:     CONST clientKey = `${serverConfig.id}:${workspaceRoot}`
140:
141:     IF brokenServers.has(clientKey) RETURN null
142:
143:     CONST existing = clients.get(clientKey)
144:     IF existing RETURN existing
145:
146:     // Check for in-flight startup — deduplicate concurrent calls
147:     CONST inFlight = startupPromises.get(clientKey)
148:     IF inFlight
149:       TRY RETURN await inFlight CATCH RETURN null
150:
151:     // No in-flight startup — initiate one
152:     CONST p = (async () => {
153:       TRY
154:         CONST client = await this.startServer(serverConfig, workspaceRoot)
155:         clients.set(clientKey, client)
156:         firstTouchServers.add(clientKey)
157:         RETURN client
158:       CATCH error
159:         LOG debug "Failed to start ${serverConfig.id}: ${error.message}"
160:         brokenServers.add(clientKey)
161:         THROW error
162:       FINALLY
163:         startupPromises.delete(clientKey)
164:     })()
165:
166:     startupPromises.set(clientKey, p)
167:     TRY RETURN await p CATCH RETURN null
168:
169:   // --- [RESEARCH FIX — Bug 4: Per-client operation queue] ---
170:   // NOTE: Operations enqueued on a ClientOpQueue MUST NOT call other enqueued
171:   // operations on the same queue (no recursive enqueue). Doing so would deadlock
172:   // because the inner enqueue waits for the outer to complete.
173:   // Integration tests exercise concurrent operations to catch accidental recursive enqueue during development.
174:
175:   CLASS ClientOpQueue
176:     PRIVATE tail = Promise.resolve()
177:     // Deadlock prevention: operations enqueued on ClientOpQueue must not synchronously
178:     // enqueue additional operations on the same queue. The queue is safe for concurrent
179:     // async callers — writes serialize via promise chaining, reads gate on the latest write.
180:     // Recursive enqueue would deadlock because the inner enqueue waits for the outer to
181:     // complete. This is a code-review concern, not a runtime guard — the `executing` flag
182:     // was removed because it incorrectly threw on legitimate concurrent async callers from
183:     // different contexts (e.g., two checkFile calls arriving near-simultaneously).
184:
185:     METHOD enqueueWrite<T>(op: () => Promise<T>): Promise<T>
186:       CONST run = this.tail.then(op, op)
187:       // Tail continues even if op rejects — error is propagated to caller via `run`
188:       this.tail = run.then(() => undefined, () => undefined)
189:       RETURN run  // Caller observes success or error from op
190:
191:     METHOD enqueueRead<T>(op: () => Promise<T>): Promise<T>
192:       // [MEDIUM 4] Reads wait for prior writes to complete via tail snapshot, but
193:       // do NOT extend the chain. Multiple reads can run concurrently — this is
194:       // intentional, reads don't need mutual exclusion from each other.
195:       CONST gate = this.tail
196:       RETURN gate.then(op, op)
197:
198:   PRIVATE METHOD getOrCreateOpQueue(clientKey: string): ClientOpQueue
199:     IF NOT opQueues.has(clientKey)
200:       opQueues.set(clientKey, new ClientOpQueue())
201:     RETURN opQueues.get(clientKey)
202:
203:   // --- Known-files tracking (REQ-KNOWN-030) ---
204:   // Key dimension: serverId:workspaceRoot (composite key, same as clientKey)
205:   // This ensures multiple workspaces sharing a serverId are tracked independently.
206:
207:   // [HIGH #5 FIX] updateKnownFiles accepts workspaceRoot parameter for explicit normalization.
208:   // The onDiagnostics callback from LspClient provides the workspace root so the orchestrator
209:   // can convert absolute file paths to workspace-relative paths deterministically.
210:   PRIVATE METHOD updateKnownFiles(sourceKey: string, file: string, diagnostics: Diagnostic[], workspaceRoot: string)
211:     // sourceKey is serverId:workspaceRoot — called whenever publishDiagnostics is received
212:     // CONTRACT: LspClient passes ABSOLUTE file paths in the onDiagnostics callback.
213:     // Orchestrator normalizes to workspace-relative paths before storing in knownFileDiagSources.
214:     CONST relPath = path.relative(workspaceRoot, file)
215:     IF diagnostics is non-empty
216:       IF knownFileDiagSources.has(relPath)
217:         knownFileDiagSources.get(relPath).add(sourceKey)
218:       ELSE
219:         knownFileDiagSources.set(relPath, new Set([sourceKey]))
220:     ELSE
221:       // This server reports empty diagnostics for this file
222:       IF knownFileDiagSources.has(relPath)
223:         knownFileDiagSources.get(relPath).delete(sourceKey)
224:         IF knownFileDiagSources.get(relPath).size === 0
225:           // ALL servers now report empty → remove from known set (REQ-KNOWN-020)
226:           knownFileDiagSources.delete(relPath)
227:
228:   PRIVATE METHOD onServerShutdown(sourceKey: string)
229:     // sourceKey is serverId:workspaceRoot — remove from all known-file tracking entries
230:     FOR EACH [file, sourceSet] IN knownFileDiagSources
231:       sourceSet.delete(sourceKey)
232:       IF sourceSet.size === 0
233:         knownFileDiagSources.delete(file)
234:
235:   // [HIGH #2 FIX] getAllDiagnostics is synchronous — reads from in-memory map only.
236:   // No I/O needed. The async variant for freshness-awaited snapshots is getAllDiagnosticsAfter.
237:   METHOD getAllDiagnostics(): Record<string, Diagnostic[]>
238:     // REQ-KNOWN-030: Use knownFileDiagSources to determine which files to include
239:     CONST allDiagnostics: Record<string, Diagnostic[]> = {}
240:     CONST knownFiles = Array.from(knownFileDiagSources.keys())
241:     FOR EACH relPath IN knownFiles
242:       CONST sourceKeys = knownFileDiagSources.get(relPath)
243:       FOR EACH sourceKey IN sourceKeys
244:         CONST client = clients.get(sourceKey)
245:         IF client is null THEN CONTINUE
246:         CONST clientDiags = client.getCurrentDiagnostics()
247:         CONST fileDiags = clientDiags.get(relPath) ?? []
248:         IF fileDiags is empty THEN CONTINUE
249:         IF allDiagnostics[relPath] exists
250:           MERGE and DEDUPLICATE (REQ-FMT-070)
251:         ELSE
252:           allDiagnostics[relPath] = fileDiags
253:     SORT file keys alphabetically (REQ-ARCH-080)
254:     FILTER each file's diagnostics by configured severities (REQ-FMT-065)
255:     RETURN allDiagnostics
256:
257:   // [HIGH 5 FIX] getStatus iterates the actual clients map (keyed by detected workspace
258:   // root) rather than constructing keys from config.workspaceRoot, which would miss clients
259:   // started for subdirectory workspace roots.
260:   // [MEDIUM 3] Also reports servers NOT yet started by checking the registry.
261:   METHOD getStatus(): ServerStatus[]
262:     CONST statuses: ServerStatus[] = []
263:     // Collect all active/broken client statuses from actual client keys
264:     CONST reportedServerIds: Set<string> = new Set()
265:     FOR EACH [clientKey, client] IN this.clients
266:       CONST [serverId, wsRoot] = parseClientKey(clientKey)  // split on first ':'
267:       reportedServerIds.add(serverId)
268:       IF client.isInitializing()
269:         ADD { id: serverId, status: 'starting', language, serverPid: client.getPid(), workspaceRoot: wsRoot }
270:       ELSE IF client.isAlive()
271:         ADD { id: serverId, status: 'active', language, serverPid: client.getPid(), workspaceRoot: wsRoot }
272:       ELSE
273:         ADD { id: serverId, status: 'dead', language, workspaceRoot: wsRoot }
274:     FOR EACH clientKey IN this.brokenServers
275:       CONST [serverId, wsRoot] = parseClientKey(clientKey)
276:       reportedServerIds.add(serverId)
277:       ADD { id: serverId, status: 'broken', language, workspaceRoot: wsRoot }
278:     // Report servers from registry that were never started
279:     FOR EACH serverConfig IN serverRegistry.getAllServers()
280:       IF reportedServerIds.has(serverConfig.id) THEN CONTINUE
281:       IF config.servers[serverConfig.id]?.enabled === false
282:         ADD { id: serverConfig.id, status: 'disabled', language }
283:       ELSE
284:         ADD { id: serverConfig.id, status: 'unavailable', language }
285:     SORT statuses alphabetically by id (REQ-STATUS-045)
286:     RETURN statuses
287:
288:   METHOD async shutdown(): Promise<void>
289:     LOG debug "Shutting down orchestrator"
290:     CONST shutdownPromises = Array.from(clients.values()).map(client =>
291:       client.shutdown().catch(e => LOG debug "Client shutdown error: ${e.message}")
292:     )
293:     AWAIT Promise.allSettled(shutdownPromises)
294:     clients.clear()
295:     brokenServers.clear()
296:     firstTouchServers.clear()
297:     startupPromises.clear()    // [RESEARCH FIX — Bug 1]
298:     opQueues.clear()           // [RESEARCH FIX — Bug 4]
299:     LOG debug "Orchestrator shutdown complete"
300:
301:   // --- [RESEARCH FIX — Bug 2: checkFile→getAllDiagnostics freshness gap] ---
302:
303:   METHOD getDiagnosticEpoch(): number
304:     RETURN this.diagnosticEpoch
305:
306:   // [HIGH #4 FIX] afterEpoch is the epoch captured by the caller BEFORE checkFile.
307:   // getAllDiagnosticsAfter waits until orchestrator epoch > afterEpoch, confirming
308:   // the triggering checkFile completed and its diagnostics have been processed.
309:   // This ties freshness to the specific checkFile call rather than reading epoch at
310:   // snapshot time, eliminating the window where a stale snapshot could be returned.
311:   METHOD async getAllDiagnosticsAfter(
312:     afterEpoch: number,       // epoch value captured by caller BEFORE checkFile
313:     waitMs: number = 250
314:   ): Promise<Record<string, Diagnostic[]>>
315:     // Wait until the orchestrator epoch has advanced past afterEpoch.
316:     // This ensures the checkFile that incremented the epoch has completed
317:     // and cross-file diagnostic propagation has had time to settle.
318:
319:     // Edge case: no active clients → return immediately.
320:     // Epoch is already >= afterEpoch since no work happened; no need to wait.
321:     IF this.clients.size === 0
322:       RETURN this.getAllDiagnostics()
323:
324:     IF this.diagnosticEpoch <= afterEpoch
325:       // Wait for propagation: poll or use per-client epoch waiters
326:       CONST waitPromises: Promise<boolean>[] = []
327:       FOR EACH [clientKey, client] IN this.clients
328:         // Edge case: skip broken/dead clients — don't wait forever for a client
329:         // that will never produce diagnostics.
330:         IF NOT client.isAlive() THEN CONTINUE
331:         waitPromises.push(client.waitForDiagnosticEpoch(client.getDiagnosticEpoch() + 1, waitMs))
332:       // Edge case: if waitMs expires before all clients reach target epoch,
333:       // Promise.allSettled returns whatever is available (best-effort, per REQ-TIME-060).
334:       // waitForDiagnosticEpoch resolves false on timeout, so no hanging.
335:       AWAIT Promise.allSettled(waitPromises)
336:     RETURN this.getAllDiagnostics()
337:
338:   // --- [RESEARCH — Design Decision 3: File content in checkFile] ---
339:   // The checkFile RPC request may include optional `text` field with current file content.
340:   // When text is provided, touchFile uses it as the authoritative source for didOpen/didChange
341:   // instead of reading the file from disk. This avoids race conditions between the write and
342:   // the LSP server's disk read.
343:
344:   // --- Navigation methods (delegated to appropriate LspClient) ---
345:
346:   METHOD async gotoDefinition(file, line, character): Promise<Location[]>
347:     VALIDATE file is within workspace boundary
348:     CONST { client, clientKey } = this.findClientForFile(file)
349:     IF client is null RETURN []
350:     // [RESEARCH FIX — Bug 4] Route through operation queue (read priority)
351:     CONST queue = this.getOrCreateOpQueue(clientKey)
352:     RETURN await queue.enqueueRead(() => client.gotoDefinition(file, line - 1, character - 1))
353:
354:   METHOD async findReferences(file, line, character): Promise<Location[]>
355:     VALIDATE file is within workspace boundary
356:     CONST { client, clientKey } = this.findClientForFile(file)
357:     IF client is null RETURN []
358:     CONST queue = this.getOrCreateOpQueue(clientKey)
359:     RETURN await queue.enqueueRead(() => client.findReferences(file, line - 1, character - 1))
360:
361:   METHOD async hover(file, line, character): Promise<HoverResult | null>
362:     VALIDATE file is within workspace boundary
363:     CONST { client, clientKey } = this.findClientForFile(file)
364:     IF client is null RETURN null
365:     CONST queue = this.getOrCreateOpQueue(clientKey)
366:     RETURN await queue.enqueueRead(() => client.hover(file, line - 1, character - 1))
367:
368:   METHOD async documentSymbols(file): Promise<DocumentSymbol[]>
369:     VALIDATE file is within workspace boundary
370:     CONST { client, clientKey } = this.findClientForFile(file)
371:     IF client is null RETURN []
372:     CONST queue = this.getOrCreateOpQueue(clientKey)
373:     RETURN await queue.enqueueRead(() => client.documentSymbols(file))
374:
375:   METHOD async workspaceSymbols(query): Promise<SymbolInformation[]>
376:     COLLECT from ALL active clients in parallel
377:     // [RESEARCH FIX — Bug 4] Each client access routed through its queue (read)
378:     FOR EACH { clientKey, client } IN active clients
379:       CONST queue = this.getOrCreateOpQueue(clientKey)
380:       queue.enqueueRead(() => client.workspaceSymbols(query))
381:     MERGE results, deduplicate by name+location
382:     RETURN merged
383:
384:   // [HIGH 6 FIX] Fully specified algorithm for finding the right client for a file
385:   PRIVATE METHOD findClientForFile(file: string): { client: LspClient | null, clientKey: string | null }
386:     DETERMINE extension from file
387:     CONST applicableServerConfigs = serverRegistry.getServersForExtension(extension)
388:     FOR EACH serverConfig IN applicableServerConfigs
389:       // Compute the workspace root this server would use for this file
390:       CONST wsRoot = findNearestProjectRoot(file, [serverConfig])
391:       CONST candidateKey = `${serverConfig.id}:${wsRoot}`
392:       CONST client = clients.get(candidateKey)
393:       IF client is not null AND client.isAlive()
394:         RETURN { client, clientKey: candidateKey }
395:     // No alive client found for any applicable server
396:     RETURN { client: null, clientKey: null }
397:
398:   PRIVATE METHOD isWithinWorkspace(filePath: string): boolean
399:     NORMALIZE filePath (resolve .., symlinks) → normalizedPath
400:     NORMALIZE config.workspaceRoot → normalizedRoot
401:     // [RESEARCH FIX — Bug 6: startsWith path traversal vulnerability]
402:     // Plain startsWith("/workspace") matches "/workspace2/evil.ts" — WRONG.
403:     // Must verify a path-separator boundary after the root prefix.
404:     IF normalizedPath === normalizedRoot THEN RETURN true
405:     IF NOT normalizedPath.startsWith(normalizedRoot) THEN RETURN false
406:     RETURN normalizedPath.charAt(normalizedRoot.length) === path.sep
407:     // [MEDIUM 2] NOTE: On case-insensitive filesystems (macOS default), both paths
408:     // should ideally be compared case-insensitively. path.resolve() does NOT normalize
409:     // case. This is a known limitation for MVP. Full solution would use fs.realpathSync()
410:     // which resolves symlinks AND normalizes case on macOS HFS+/APFS.
411:
412:   PRIVATE METHOD findNearestProjectRoot(
413:     filePath: string,
414:     serverConfigs: ServerConfig[]
415:   ): string
416:     COLLECT all workspace root markers from serverConfigs
417:     WALK up from filePath directory
418:     FOR EACH directory level
419:       CHECK if any marker file exists
420:       IF found RETURN that directory
421:     FALLBACK to config.workspaceRoot
422:
423:   // [MEDIUM 5] NOTE: Transient startup failures (e.g., timeout, binary not found) mark
424:   // the server as broken for the session. This is intentional conservative behavior per
425:   // REQ-LIFE-070 — a server that fails once is unlikely to succeed if retried immediately.
426:   // Future enhancement could add retry with exponential backoff for transient errors
427:   // (e.g., port conflicts), but for MVP the permanent-broken behavior is correct.
428:
429: END CLASS
```


---

## Integration Points

| Line | Call | Details |
|------|------|---------|
| 036 | `isWithinWorkspace(filePath)` | Boundary check. Must normalize and resolve symlinks before comparison. Defense-in-depth: applied regardless of caller. |
| 045 | `serverRegistry.getServersForExtension(ext)` | Returns `ServerConfig[]` of all servers that handle this extension. May return multiple (e.g., tsserver + eslint for `.ts`). |
| 057-065 | Per-server workspace root + parallel collection | [HIGH 11 FIX] Workspace root is computed per-server inside the loop — different servers may use different project markers (package.json vs go.mod). Then `Promise.allSettled` collects in parallel (REQ-TIME-040). |
| 088 | `this.getOrStartClient(serverConfig, workspaceRoot)` | [RESEARCH FIX — Bug 1] Single-flight guard — deduplicates concurrent startup calls for the same server+workspace. |
| 103 | `queue.enqueueWrite(() => client.touchFile(...))` | [RESEARCH FIX — Bug 4] Routes touchFile through per-client operation queue to prevent interleaving with navigation reads. |
| 127 | `this.lspClientFactory(serverConfig, workspaceRoot, this.updateKnownFiles.bind(this))` | [HIGH #1 FIX] Uses injected factory instead of direct construction. Client receives onDiagnostics callback. When publishDiagnostics fires, client calls back to orchestrator for known-files tracking. |
| 128 | `client.initialize()` | LSP initialize/initialized handshake. Async, may take seconds on cold start. |
| 135 | `getOrStartClient(serverConfig, workspaceRoot)` | [RESEARCH FIX — Bug 1] Single-flight guard with startupPromises map for concurrent deduplication. |
| 175 | `ClientOpQueue` | [RESEARCH FIX — Bug 4] Per-client operation queue with write/read priority. Writes chain sequentially; reads wait for prior writes but run concurrently. Deadlock prevention is a code-review concern (no recursive enqueue on same queue). |
| 237 | `getAllDiagnostics()` | [HIGH #2 FIX] Synchronous — reads from in-memory `knownFileDiagSources` map. Uses knownFileDiagSources to determine which files to include, keyed by serverId:workspaceRoot. |
| 246 | `client.getCurrentDiagnostics()` | Returns the client's cached diagnostic map (from publishDiagnostics notifications). |
| 261-286 | `getStatus()` | [HIGH 5 FIX] Iterates actual `clients` map and `brokenServers` set (keyed by detected workspace root). [MEDIUM 3] Also reports never-started servers from registry as disabled/unavailable. |
| 288-299 | `client.shutdown()` | Graceful LSP shutdown/exit sequence for each client. `allSettled` ensures all shutdown attempts complete. |
| 303-336 | `getDiagnosticEpoch()` / `getAllDiagnosticsAfter(afterEpoch, waitMs)` | [RESEARCH FIX — Bug 2] Epoch-aware snapshot — getDiagnosticEpoch returns orchestrator's monotonic epoch; getAllDiagnosticsAfter waits for epoch to advance past afterEpoch before snapshotting global diagnostics. [HIGH #4 FIX] afterEpoch is captured BEFORE checkFile by caller. |
| 352 | `client.gotoDefinition(file, line, char)` | LSP `textDocument/definition` request. Converts 1-based to 0-based before calling. Routed through opQueue.enqueueRead(). |
| 385-396 | `findClientForFile(file)` | [HIGH 6 FIX] Fully specified: iterates applicable server configs, computes per-server workspace root, looks up client by key, returns first alive client. |

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Collect diagnostics SEQUENTIALLY (server1 then server2)
[OK]    DO: Collect from ALL servers in PARALLEL using Promise.allSettled (REQ-TIME-040, REQ-TIME-015)

[ERROR] DO NOT: Auto-restart broken servers
[OK]    DO: Mark as broken permanently for the session (REQ-LIFE-070)

[ERROR] DO NOT: Start servers at construction time
[OK]    DO: Start lazily on first file touch (REQ-LIFE-010, REQ-LIFE-020)

[ERROR] DO NOT: Allow files outside workspace root
[OK]    DO: Check boundary at orchestrator layer, reject silently (REQ-BOUNDARY-010)

[ERROR] DO NOT: Create separate orchestrator instances for RPC and MCP channels
[OK]    DO: Share ONE orchestrator instance across both channels (REQ-ARCH-040, REQ-ARCH-090)

[ERROR] DO NOT: Swallow server crash events silently
[OK]    DO: Log at debug level, mark as broken, remove from active clients

[ERROR] DO NOT: Use sequential timeouts (3s × N servers)
[OK]    DO: Use parallel collection with a single timeout bounding all servers

[ERROR] DO NOT: Compute workspace root once for all servers
[OK]    DO: Compute per-server — different servers have different root markers (package.json vs go.mod)

[ERROR] DO NOT: Construct getStatus keys from config.workspaceRoot
[OK]    DO: Iterate actual clients map entries which use detected workspace roots

[ERROR] DO NOT: Enqueue operations recursively on the same ClientOpQueue (would deadlock)
[OK]    DO: Ensure operations never synchronously enqueue on the same queue (code-review concern, not runtime guard)
```
