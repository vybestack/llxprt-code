# Pseudocode: useSessionBrowser Hook

## Interface Contracts

```typescript
// INPUTS (props to hook)
interface UseSessionBrowserProps {
  chatsDir: string;
  projectHash: string;
  currentSessionId: string;
  onSelect: (session: SessionSummary) => Promise<PerformResumeResult>;
  onClose: () => void;
}

// OUTPUTS (hook return)
interface UseSessionBrowserReturn {
  // State
  sessions: EnrichedSessionSummary[];
  filteredSessions: EnrichedSessionSummary[];
  searchTerm: string;
  sortOrder: SortOrder;
  selectedIndex: number;
  page: number;
  totalPages: number;
  isSearching: boolean;
  isLoading: boolean;
  isResuming: boolean;
  deleteConfirmIndex: number | null;
  activeConversationConfirm: boolean;
  error: string | null;
  skippedCount: number;
  // Callbacks
  handleKeypress: (input: string, key: KeypressEvent) => void;
}

// INTERNAL TYPE
type PreviewState = 'loading' | 'loaded' | 'none' | 'error';
type SortOrder = 'newest' | 'oldest' | 'size';

interface EnrichedSessionSummary extends SessionSummary {
  firstUserMessage?: string;
  previewState: PreviewState;
  isLocked: boolean;
}

// DEPENDENCIES (real, injected via props or imported)
// - SessionDiscovery.listSessionsDetailed() from core
// - SessionDiscovery.readFirstUserMessage() from core
// - SessionDiscovery.hasContentEvents() from core
// - SessionLockManager.isLocked(chatsDir, sessionId) from core
// - deleteSession() from core sessionManagement
```

## Integration Points

```
Line 25: CALL SessionDiscovery.listSessionsDetailed(chatsDir, projectHash)
         - Returns { sessions, skippedCount }
         - Called on mount and after delete/refresh

Line 45: CALL SessionLockManager.isLocked(chatsDir, sessionId) for each session
         - Checked once during initial load
         - Re-checked at action time (resume, delete)

Line 70: CALL SessionDiscovery.readFirstUserMessage(filePath)
         - Called asynchronously for each visible page session
         - Results discarded if generation counter stale

Line 95: CALL SessionDiscovery.hasContentEvents(filePath)
         - Used to filter out empty sessions during load

Line 115: CALL deleteSession(sessionId, chatsDir, projectHash)
          - Called on delete confirmation (Y key)

Line 135: CALL onSelect(session)
          - Returns Promise<PerformResumeResult>
          - Hook awaits result for error/success handling
```

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Call resumeSession() directly from the hook
[OK] DO: Delegate to onSelect prop which calls performResume externally

[ERROR] DO NOT: Poll lock status periodically
[OK] DO: Check locks once on load, re-check at action time

[ERROR] DO NOT: Filter out unloaded previews during search
[OK] DO: Include unloaded previews; remove when loaded and non-matching

[ERROR] DO NOT: Use UI row index for delete/continue operations
[OK] DO: Use sessionId for all state-mutating operations

[ERROR] DO NOT: Hold onto stale preview results after page change
[OK] DO: Use generation counter to discard stale results
```

## Constants

```
10: CONST PAGE_SIZE = 20
11: CONST SORT_CYCLE: SortOrder[] = ['newest', 'oldest', 'size']
```

## Hook State

```
15: FUNCTION useSessionBrowser(props: UseSessionBrowserProps): UseSessionBrowserReturn
16:   // Core state
17:   LET [sessions, setSessions] = useState<EnrichedSessionSummary[]>([])
18:   LET [searchTerm, setSearchTerm] = useState('')
19:   LET [sortOrder, setSortOrder] = useState<SortOrder>('newest')
20:   LET [selectedIndex, setSelectedIndex] = useState(0)
21:   LET [page, setPage] = useState(0)
22:   LET [isSearching, setIsSearching] = useState(true)  // Starts in search mode
23:   LET [isLoading, setIsLoading] = useState(true)
24:   LET [isResuming, setIsResuming] = useState(false)
25:   LET [deleteConfirmIndex, setDeleteConfirmIndex] = useState<number | null>(null)
26:   LET [activeConversationConfirm, setActiveConversationConfirm] = useState(false)
27:   LET [pendingResumeSession, setPendingResumeSession] = useState<EnrichedSessionSummary | null>(null)
28:   LET [error, setError] = useState<string | null>(null)
29:   LET [skippedCount, setSkippedCount] = useState(0)
30:
31:   // Refs
32:   LET generationRef = useRef(0)
33:   LET previewCacheRef = useRef<Map<string, { text: string | null; state: PreviewState }>>(new Map())
34:   LET selectedSessionIdRef = useRef<string | null>(null)
```

## Derived State

```
40: // Filtering
41: LET filteredSessions = useMemo(() => {
42:   IF searchTerm === '' THEN
43:     RETURN sessions
44:   END IF
45:   LET lowerTerm = searchTerm.toLowerCase()
46:   RETURN sessions.filter(s => {
47:     // Always include sessions with unloaded previews
48:     IF s.previewState === 'loading' THEN RETURN true END IF
49:     // Match against loaded preview text, provider, model
50:     LET fields = [
51:       s.firstUserMessage ?? '',
52:       s.provider ?? '',
53:       s.model ?? ''
54:     ]
55:     RETURN fields.some(f => f.toLowerCase().includes(lowerTerm))
56:   })
57: }, [sessions, searchTerm])
58:
59: // Sorting
60: LET sortedSessions = useMemo(() => {
61:   LET sorted = [...filteredSessions]
62:   SWITCH sortOrder
63:     CASE 'newest': sorted.sort((a, b) => b.lastModified.getTime() - a.lastModified.getTime())
64:     CASE 'oldest': sorted.sort((a, b) => a.lastModified.getTime() - b.lastModified.getTime())
65:     CASE 'size': sorted.sort((a, b) => b.fileSize - a.fileSize)
66:   END SWITCH
67:   RETURN sorted
68: }, [filteredSessions, sortOrder])
69:
70: // Pagination
71: LET totalPages = Math.max(1, Math.ceil(sortedSessions.length / PAGE_SIZE))
72: LET clampedPage = Math.min(page, totalPages - 1)
73: LET pageStart = clampedPage * PAGE_SIZE
74: LET pageEnd = pageStart + PAGE_SIZE
75: LET visibleSessions = sortedSessions.slice(pageStart, pageEnd)
```

## loadSessions

```
80: FUNCTION ASYNC loadSessions()
81:   INCREMENT generationRef.current
82:   LET currentGen = generationRef.current
83:   SET isLoading = true
84:   SET error = null
85:
86:   TRY
87:     LET result = AWAIT SessionDiscovery.listSessionsDetailed(props.chatsDir, props.projectHash)
88:     IF currentGen !== generationRef.current THEN RETURN END IF  // Stale
89:
90:     SET skippedCount = result.skippedCount
91:
92:     // Filter out current session and empty sessions
93:     LET filtered: EnrichedSessionSummary[] = []
94:     FOR EACH session IN result.sessions
95:       IF session.sessionId === props.currentSessionId THEN CONTINUE END IF
96:
97:       LET hasContent = AWAIT SessionDiscovery.hasContentEvents(session.filePath)
98:       IF currentGen !== generationRef.current THEN RETURN END IF  // Stale
99:       IF NOT hasContent THEN CONTINUE END IF
100:
101:      LET locked = AWAIT SessionLockManager.isLocked(props.chatsDir, session.sessionId)
102:      IF currentGen !== generationRef.current THEN RETURN END IF  // Stale
103:
104:      // Check preview cache
105:      LET cached = previewCacheRef.current.get(session.sessionId)
106:      LET enriched: EnrichedSessionSummary = {
107:        ...session,
108:        isLocked: locked,
109:        previewState: cached ? cached.state : 'loading',
110:        firstUserMessage: cached?.text ?? undefined
111:      }
112:      filtered.push(enriched)
113:    END FOR
114:
115:    SET sessions = filtered
116:    SET isLoading = false
117:
118:    // Restore selection by sessionId
119:    IF selectedSessionIdRef.current THEN
120:      LET idx = filtered.findIndex(s => s.sessionId === selectedSessionIdRef.current)
121:      IF idx >= 0 THEN
122:        SET selectedIndex = idx
123:      ELSE
124:        SET selectedIndex = Math.min(selectedIndex, Math.max(0, filtered.length - 1))
125:      END IF
126:    END IF
127:
128:    // Load previews for visible page
129:    CALL loadPreviewsForPage(currentGen)
130:
131:  CATCH loadError
132:    IF currentGen !== generationRef.current THEN RETURN END IF
133:    SET error = "Failed to load sessions: " + loadError.message
134:    SET isLoading = false
135:  END TRY
136: END FUNCTION
```

## loadPreviewsForPage

```
140: FUNCTION ASYNC loadPreviewsForPage(generation: number)
141:   LET start = clampedPage * PAGE_SIZE
142:   LET end = start + PAGE_SIZE
143:   LET pageItems = sortedSessions.slice(start, end)
144:
145:   FOR EACH session IN pageItems
146:     IF previewCacheRef.current.has(session.sessionId) THEN CONTINUE END IF
147:
148:     // Load async — don't await sequentially, use Promise.allSettled pattern
149:   END FOR
150:
151:   LET promises = pageItems
152:     .filter(s => !previewCacheRef.current.has(s.sessionId))
153:     .map(ASYNC session => {
154:       TRY
155:         LET text = AWAIT SessionDiscovery.readFirstUserMessage(session.filePath)
156:         IF generation !== generationRef.current THEN RETURN END IF  // Stale
157:
158:         LET state: PreviewState = text !== null ? 'loaded' : 'none'
159:         previewCacheRef.current.set(session.sessionId, { text, state })
160:
161:         // Update session in state
162:         setSessions(prev => prev.map(s =>
163:           s.sessionId === session.sessionId
164:             ? { ...s, firstUserMessage: text ?? undefined, previewState: state }
165:             : s
166:         ))
167:       CATCH previewError
168:         IF generation !== generationRef.current THEN RETURN END IF
169:         previewCacheRef.current.set(session.sessionId, { text: null, state: 'error' })
170:         setSessions(prev => prev.map(s =>
171:           s.sessionId === session.sessionId
172:             ? { ...s, previewState: 'error' }
173:             : s
174:         ))
175:       END TRY
176:     })
177:
178:   AWAIT Promise.allSettled(promises)
179: END FUNCTION
```

## handleKeypress

```
185: FUNCTION handleKeypress(input: string, key: KeypressEvent)
186:   // Priority 1: isResuming blocks everything
187:   IF isResuming THEN RETURN END IF
188:
189:   // Priority 2: Delete confirmation
190:   IF deleteConfirmIndex !== null THEN
191:     IF key.name === 'y' OR input === 'Y' THEN
192:       CALL executeDelete(deleteConfirmIndex)
193:       RETURN
194:     END IF
195:     IF key.name === 'n' OR input === 'N' OR key.name === 'escape' THEN
196:       SET deleteConfirmIndex = null
197:       RETURN
198:     END IF
199:     RETURN  // Ignore all other keys
200:   END IF
201:
202:   // Priority 3: Active-conversation confirmation
203:   IF activeConversationConfirm THEN
204:     IF key.name === 'y' OR input === 'Y' THEN
205:       SET activeConversationConfirm = false
206:       CALL executeResume(pendingResumeSession!)
207:       RETURN
208:     END IF
209:     IF key.name === 'n' OR input === 'N' OR key.name === 'escape' THEN
210:       SET activeConversationConfirm = false
211:       SET pendingResumeSession = null
212:       RETURN
213:     END IF
214:     RETURN  // Ignore all other keys
215:   END IF
216:
217:   // Priority 4: Escape key precedence
218:   IF key.name === 'escape' THEN
219:     IF searchTerm !== '' THEN
220:       SET searchTerm = ''
221:       SET page = 0
222:       SET selectedIndex = 0
223:       RETURN
224:     END IF
225:     CALL props.onClose()
226:     RETURN
227:   END IF
228:
229:   // Tab toggles mode
230:   IF key.name === 'tab' THEN
231:     SET isSearching = !isSearching
232:     RETURN
233:   END IF
234:
235:   // Enter — resume selected
236:   IF key.name === 'return' THEN
237:     IF sortedSessions.length === 0 THEN RETURN END IF  // No-op if empty
238:     LET session = visibleSessions[selectedIndex]
239:     IF NOT session THEN RETURN END IF
240:     CALL initiateResume(session)
241:     RETURN
242:   END IF
243:
244:   // PgUp / PgDn
245:   IF key.name === 'pageup' THEN
246:     IF clampedPage > 0 THEN
247:       SET page = clampedPage - 1
248:       SET selectedIndex = 0
249:       CALL loadPreviewsForPage(generationRef.current)
250:     END IF
251:     RETURN
252:   END IF
253:   IF key.name === 'pagedown' THEN
254:     IF clampedPage < totalPages - 1 THEN
255:       SET page = clampedPage + 1
256:       SET selectedIndex = 0
257:       CALL loadPreviewsForPage(generationRef.current)
258:     END IF
259:     RETURN
260:   END IF
261:
262:   // Up/Down navigation (works in both modes)
263:   IF key.name === 'up' THEN
264:     IF visibleSessions.length === 0 THEN RETURN END IF
265:     SET selectedIndex = Math.max(0, selectedIndex - 1)
266:     RETURN
267:   END IF
268:   IF key.name === 'down' THEN
269:     IF visibleSessions.length === 0 THEN RETURN END IF
270:     SET selectedIndex = Math.min(visibleSessions.length - 1, selectedIndex + 1)
271:     RETURN
272:   END IF
273:
274:   // Mode-specific keys
275:   IF isSearching THEN
276:     // Search mode: characters append, backspace deletes
277:     IF key.name === 'backspace' THEN
278:       SET searchTerm = searchTerm.slice(0, -1)
279:       SET page = 0
280:       SET selectedIndex = 0
281:       RETURN
282:     END IF
283:     IF key.name === 'delete' THEN RETURN END IF  // No-op in search mode
284:     IF input AND input.length === 1 AND !key.ctrl AND !key.meta THEN
285:       SET searchTerm = searchTerm + input
286:       SET page = 0
287:       SET selectedIndex = 0
288:       RETURN
289:     END IF
290:   ELSE
291:     // Navigation mode
292:     IF key.name === 'delete' THEN
293:       IF visibleSessions.length === 0 THEN RETURN END IF  // No-op if empty
294:       SET deleteConfirmIndex = selectedIndex
295:       RETURN
296:     END IF
297:     IF input === 's' OR input === 'S' THEN
298:       LET currentIdx = SORT_CYCLE.indexOf(sortOrder)
299:       SET sortOrder = SORT_CYCLE[(currentIdx + 1) % SORT_CYCLE.length]
300:       SET page = 0
301:       SET selectedIndex = 0
302:       CALL loadPreviewsForPage(generationRef.current)
303:       RETURN
304:     END IF
305:   END IF
306: END FUNCTION
```

## initiateResume

```
310: FUNCTION ASYNC initiateResume(session: EnrichedSessionSummary)
311:   SET error = null
312:   // Check if active conversation exists (hasActiveConversation comes from props/context)
313:   IF hasActiveConversation THEN
314:     SET pendingResumeSession = session
315:     SET activeConversationConfirm = true
316:     RETURN
317:   END IF
318:   CALL executeResume(session)
319: END FUNCTION
```

## executeResume

```
325: FUNCTION ASYNC executeResume(session: EnrichedSessionSummary)
326:   SET isResuming = true
327:   SET error = null
328:
329:   TRY
330:     LET result = AWAIT props.onSelect(session)
331:     IF result.ok THEN
332:       // Success — parent closes dialog and restores history
333:       // No action needed here; onClose called by parent
334:     ELSE
335:       SET error = result.error
336:       SET isResuming = false
337:       CALL loadSessions()  // Refresh list
338:     END IF
339:   CATCH err
340:     SET error = "Resume failed: " + err.message
341:     SET isResuming = false
342:     CALL loadSessions()  // Refresh list
343:   END TRY
344: END FUNCTION
```

## executeDelete

```
350: FUNCTION ASYNC executeDelete(index: number)
351:   LET session = visibleSessions[index]
352:   IF NOT session THEN
353:     SET deleteConfirmIndex = null
354:     RETURN
355:   END IF
356:
357:   SET deleteConfirmIndex = null
358:   SET error = null
359:   LET targetSessionId = session.sessionId
360:   selectedSessionIdRef.current = targetSessionId
361:
362:   TRY
363:     LET result = AWAIT deleteSession(targetSessionId, props.chatsDir, props.projectHash)
364:     IF NOT result.ok THEN
365:       SET error = result.error
366:       RETURN
367:     END IF
368:     // After successful delete, refresh sessions
369:     CALL loadSessions()
370:   CATCH err
371:     SET error = "Failed to delete session: " + err.message
372:   END TRY
373: END FUNCTION
```

## Effect: Initial Load

```
380: useEffect(() => {
381:   CALL loadSessions()
382: }, [])  // Mount only
```

## Effect: Clamp Selected Index on Filter Change

```
388: useEffect(() => {
389:   IF visibleSessions.length === 0 THEN
390:     SET selectedIndex = 0
391:   ELSE
392:     SET selectedIndex = Math.min(selectedIndex, visibleSessions.length - 1)
393:   END IF
394: }, [visibleSessions.length])
```

## Return Value

```
400: RETURN {
401:   sessions,
402:   filteredSessions: sortedSessions,
403:   searchTerm,
404:   sortOrder,
405:   selectedIndex,
406:   page: clampedPage,
407:   totalPages,
408:   isSearching,
409:   isLoading,
410:   isResuming,
411:   deleteConfirmIndex,
412:   activeConversationConfirm,
413:   error,
414:   skippedCount,
415:   handleKeypress
416: }
417: END FUNCTION
```
