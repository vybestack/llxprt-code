# Pseudocode: HighDensityStrategy.optimize()

**Requirement Coverage**: REQ-HD-005.1 through REQ-HD-005.11, REQ-HD-006.1 through REQ-HD-006.5, REQ-HD-007.1 through REQ-HD-007.6, REQ-HD-013.5, REQ-HD-013.6, REQ-HD-013.7

---

## Interface Contracts

### INPUTS
```typescript
// optimize() receives:
history: readonly IContent[]       // raw history array from HistoryService
config: DensityConfig              // settings from ephemerals

interface DensityConfig {
  readonly readWritePruning: boolean;
  readonly fileDedupe: boolean;
  readonly recencyPruning: boolean;
  readonly recencyRetention: number;
  readonly workspaceRoot: string;
}
```

### OUTPUTS
```typescript
// optimize() returns:
interface DensityResult {
  removals: readonly number[];                     // indices to remove entirely
  replacements: ReadonlyMap<number, IContent>;     // indices to replace
  metadata: DensityResultMetadata;
}

// INVARIANTS on output:
// - No index appears in both removals and replacements
// - All indices are in [0, history.length)
// - No duplicate indices in removals
```

### DEPENDENCIES
```typescript
// Node.js built-in:
import * as path from 'node:path';

// Internal types from IContent.ts:
import { IContent, ToolCallBlock, ToolResponseBlock, TextBlock } from '../../services/history/IContent.js';

// Error types from compression/types.ts:
import { DensityResult, DensityConfig, DensityResultMetadata } from './types.js';
```

---

## Constants

```
 10: CONST READ_TOOLS = ['read_file', 'read_line_range', 'read_many_files', 'ast_read_file']
 11: CONST WRITE_TOOLS = ['write_file', 'ast_edit', 'replace', 'insert_at_line', 'delete_line_range']
 12: CONST GLOB_CHARS = ['*', '?', '**']
 13: CONST PRUNED_POINTER = '[Result pruned — re-run tool to retrieve]'
 14: CONST FILE_INCLUSION_OPEN_REGEX = /^--- (.+) ---$/m
 15: CONST FILE_INCLUSION_CLOSE = '--- End of content ---'
```

---

## Pseudocode: optimize() Entry Point

```
 20: METHOD optimize(history: READONLY ARRAY OF IContent, config: DensityConfig): DensityResult
 21:   LET removals: Set<number> = NEW Set()
 22:   LET replacements: Map<number, IContent> = NEW Map()
 23:   LET metadata: DensityResultMetadata = {
 24:     readWritePairsPruned: 0,
 25:     fileDeduplicationsPruned: 0,
 26:     recencyPruned: 0,
 27:   }
 28:
 29:   // Phase 1: READ→WRITE pair pruning
 30:   IF config.readWritePruning
 31:     LET rwResult = this.pruneReadWritePairs(history, config)
 32:     MERGE rwResult.removals INTO removals
 33:     MERGE rwResult.replacements INTO replacements (check no overlap with removals)
 34:     metadata.readWritePairsPruned = rwResult.prunedCount
 35:
 36:   // Phase 2: Duplicate @ file inclusion dedup
 37:   IF config.fileDedupe
 38:     LET ddResult = this.deduplicateFileInclusions(history, config, removals)
 39:     MERGE ddResult.replacements INTO replacements (skip entries already in removals)
 40:     metadata.fileDeduplicationsPruned = ddResult.prunedCount
 41:
 42:   // Phase 3: Tool result recency pruning
 43:   IF config.recencyPruning
 44:     LET rpResult = this.pruneByRecency(history, config, removals)
 45:     MERGE rpResult.replacements INTO replacements (skip entries already in removals)
 46:     metadata.recencyPruned = rpResult.prunedCount
 47:
 48:   // Build final result — convert sets/maps to readonly forms
 49:   RETURN {
 50:     removals: Array.from(removals),
 51:     replacements: replacements AS ReadonlyMap,
 52:     metadata,
 53:   }
```

---

## Pseudocode: pruneReadWritePairs()

```
 60: PRIVATE METHOD pruneReadWritePairs(
 61:   history: READONLY ARRAY OF IContent,
 62:   config: DensityConfig
 63: ): { removals: Set<number>, replacements: Map<number, IContent>, prunedCount: number }
 64:
 65:   LET removals: Set<number> = NEW Set()
 66:   LET replacements: Map<number, IContent> = NEW Map()
 67:   LET prunedCount = 0
 68:
 69:   // === STEP 1: Build write map — latest write index per file path ===
 70:   LET latestWrite: Map<string, number> = NEW Map()
 71:
 72:   FOR index FROM history.length - 1 DOWNTO 0
 73:     LET entry = history[index]
 74:     IF entry.speaker !== 'ai'
 75:       CONTINUE
 76:
 77:     FOR EACH block IN entry.blocks
 78:       IF block.type !== 'tool_call'
 79:         CONTINUE
 80:       IF NOT WRITE_TOOLS.includes(block.name)
 81:         CONTINUE
 82:
 83:       LET filePath = extractFilePath(block.parameters)
 84:       IF filePath IS undefined
 85:         CONTINUE   // malformed params — skip, don't throw (REQ-HD-013.5)
 86:
 87:       LET resolved = resolvePath(filePath, config.workspaceRoot)
 88:       IF NOT latestWrite.has(resolved)
 89:         latestWrite.set(resolved, index)
 90:         // Only store LATEST write (first found walking in reverse)
 91:
 92:   // === STEP 2: Build tool call → history index mapping ===
 93:   // Maps callId to { aiIndex, toolIndex } for linking tool_call ↔ tool_response
 94:   LET callMap: Map<string, { aiIndex: number, toolCallBlock: ToolCallBlock }> = NEW Map()
 95:
 96:   FOR index FROM 0 TO history.length - 1
 97:     LET entry = history[index]
 98:     IF entry.speaker === 'ai'
 99:       FOR EACH block IN entry.blocks
100:         IF block.type === 'tool_call'
101:           callMap.set(block.id, { aiIndex: index, toolCallBlock: block })
102:
103:   // === STEP 3: Identify stale read tool calls ===
104:   LET staleCallIds: Set<string> = NEW Set()
105:   // Track which AI entries have stale calls and which have non-stale calls
106:   LET aiEntryStaleBlocks: Map<number, Set<string>> = NEW Map()     // aiIndex → set of stale callIds
107:   LET aiEntryTotalToolCalls: Map<number, number> = NEW Map()       // aiIndex → total tool_call count
108:
109:   FOR index FROM 0 TO history.length - 1
110:     LET entry = history[index]
111:     IF entry.speaker !== 'ai'
112:       CONTINUE
113:
114:     LET toolCallBlocks = entry.blocks.filter(b => b.type === 'tool_call')
115:     aiEntryTotalToolCalls.set(index, toolCallBlocks.length)
116:
117:     FOR EACH block IN toolCallBlocks
118:       IF NOT READ_TOOLS.includes(block.name)
119:         CONTINUE
120:
121:       // Handle read_many_files specially
122:       IF block.name === 'read_many_files'
123:         LET canPrune = this.canPruneReadManyFiles(block.parameters, config.workspaceRoot, latestWrite, index)
124:         IF NOT canPrune
125:           CONTINUE
126:
127:       // Handle single-file read tools
128:       ELSE
129:         LET filePath = extractFilePath(block.parameters)
130:         IF filePath IS undefined
131:           CONTINUE    // malformed params — skip (REQ-HD-013.5)
132:
133:         LET resolved = resolvePath(filePath, config.workspaceRoot)
134:         LET writeIndex = latestWrite.get(resolved)
135:
136:         IF writeIndex IS undefined OR writeIndex <= index
137:           CONTINUE    // no subsequent write — read is NOT stale
138:
139:       // This read is stale
140:       staleCallIds.add(block.id)
141:       IF NOT aiEntryStaleBlocks.has(index)
142:         aiEntryStaleBlocks.set(index, NEW Set())
143:       aiEntryStaleBlocks.get(index).add(block.id)
144:
145:   // === STEP 4: Apply removals/replacements ===
146:
147:   // 4a: Process AI entries with stale tool calls
148:   FOR EACH [aiIndex, staleCalls] IN aiEntryStaleBlocks
149:     LET totalCalls = aiEntryTotalToolCalls.get(aiIndex)
150:
151:     IF staleCalls.size === totalCalls
152:       // ALL tool calls in this entry are stale — check for non-tool-call blocks
153:       LET nonToolCallBlocks = history[aiIndex].blocks.filter(b => b.type !== 'tool_call')
154:       IF nonToolCallBlocks.length === 0 OR nonToolCallBlocks.every(b => isEmptyTextBlock(b))
155:         // Entire AI entry can be removed
156:         removals.add(aiIndex)
157:       ELSE
158:         // AI entry has non-tool-call content — replace with filtered version
159:         LET filteredBlocks = history[aiIndex].blocks.filter(b =>
160:           b.type !== 'tool_call' OR NOT staleCalls.has(b.id)
161:         )
162:         replacements.set(aiIndex, {
163:           ...history[aiIndex],
164:           blocks: filteredBlocks,
165:         })
166:     ELSE
167:       // SOME tool calls stale, others not — replace with filtered version (block-level granularity)
168:       LET filteredBlocks = history[aiIndex].blocks.filter(b =>
169:         b.type !== 'tool_call' OR NOT staleCalls.has(b.id)
170:       )
171:       replacements.set(aiIndex, {
172:         ...history[aiIndex],
173:         blocks: filteredBlocks,
174:       })
175:
176:   // 4b: Process tool entries — remove tool_response blocks for stale callIds
177:   FOR index FROM 0 TO history.length - 1
178:     LET entry = history[index]
179:     IF entry.speaker !== 'tool'
180:       CONTINUE
181:     IF removals.has(index)
182:       CONTINUE   // already scheduled for removal by another phase
183:
184:     LET responseBlocks = entry.blocks.filter(b => b.type === 'tool_response')
185:     LET staleResponses = responseBlocks.filter(b => staleCallIds.has(b.callId))
186:
187:     IF staleResponses.length === 0
188:       CONTINUE   // no stale responses in this entry
189:
190:     IF staleResponses.length === responseBlocks.length AND
191:        entry.blocks.every(b => b.type === 'tool_response')
192:       // ALL responses in this entry are stale and entry has only response blocks
193:       removals.add(index)
194:       prunedCount = prunedCount + staleResponses.length
195:     ELSE
196:       // SOME responses stale — replace with filtered version
197:       LET filteredBlocks = entry.blocks.filter(b =>
198:         b.type !== 'tool_response' OR NOT staleCallIds.has(b.callId)
199:       )
200:       IF filteredBlocks.length === 0
201:         removals.add(index)
202:       ELSE
203:         replacements.set(index, {
204:           ...entry,
205:           blocks: filteredBlocks,
206:         })
207:       prunedCount = prunedCount + staleResponses.length
208:
209:   RETURN { removals, replacements, prunedCount }
```

---

## Pseudocode: canPruneReadManyFiles()

```
215: PRIVATE METHOD canPruneReadManyFiles(
216:   params: unknown,
217:   workspaceRoot: string,
218:   latestWrite: Map<string, number>,
219:   readIndex: number
220: ): boolean
221:
222:   IF typeof params !== 'object' OR params IS null
223:     RETURN false
224:
225:   LET p = params AS Record<string, unknown>
226:   LET paths = p.paths
227:   IF NOT Array.isArray(paths)
228:     RETURN false
229:
230:   LET hasGlob = false
231:   LET allConcreteHaveWrite = true
232:   LET hasAnyConcrete = false
233:
234:   FOR EACH filePath IN paths
235:     IF typeof filePath !== 'string'
236:       CONTINUE
237:
238:     IF filePath includes '*' OR filePath includes '?' OR filePath includes '**'
239:       hasGlob = true
240:       CONTINUE
241:
242:     // Concrete path
243:     hasAnyConcrete = true
244:     LET resolved = resolvePath(filePath, workspaceRoot)
245:     LET writeIndex = latestWrite.get(resolved)
246:     IF writeIndex IS undefined OR writeIndex <= readIndex
247:       allConcreteHaveWrite = false
248:       BREAK   // at least one concrete path has no subsequent write
249:
250:   // Removable only if: no glob entries AND all concrete paths have subsequent writes
251:   IF hasGlob
252:     RETURN false
253:   IF NOT hasAnyConcrete
254:     RETURN false   // empty paths array or all non-string — not removable
255:   RETURN allConcreteHaveWrite
```

---

## Pseudocode: extractFilePath() Helper

```
260: FUNCTION extractFilePath(params: unknown): string | undefined
261:   IF typeof params !== 'object' OR params IS null
262:     RETURN undefined
263:   LET p = params AS Record<string, unknown>
264:   LET candidate = p.file_path ?? p.absolute_path ?? p.path
265:   IF typeof candidate === 'string' AND candidate.length > 0
266:     RETURN candidate
267:   RETURN undefined
```

---

## Pseudocode: resolvePath() Helper

```
270: FUNCTION resolvePath(filePath: string, workspaceRoot: string): string
271:   IF path.isAbsolute(filePath)
272:     RETURN path.resolve(filePath)
273:   RETURN path.resolve(workspaceRoot, filePath)
```

---

## Pseudocode: deduplicateFileInclusions()

```
280: PRIVATE METHOD deduplicateFileInclusions(
281:   history: READONLY ARRAY OF IContent,
282:   config: DensityConfig,
283:   existingRemovals: Set<number>
284: ): { replacements: Map<number, IContent>, prunedCount: number }
285:
286:   LET replacements: Map<number, IContent> = NEW Map()
287:   LET prunedCount = 0
288:
289:   // === STEP 1: Scan human messages for @ file inclusions ===
290:   // Build map: normalized file path → list of { messageIndex, blockIndex, startOffset, endOffset }
291:   LET inclusions: Map<string, Array<{
292:     messageIndex: number,
293:     blockIndex: number,
294:     startOffset: number,     // character offset in text block where inclusion starts
295:     endOffset: number,       // character offset where inclusion ends (after closing delimiter)
296:   }>> = NEW Map()
297:
298:   FOR index FROM 0 TO history.length - 1
299:     LET entry = history[index]
300:     IF entry.speaker !== 'human'
301:       CONTINUE
302:     IF existingRemovals.has(index)
303:       CONTINUE   // already marked for removal — skip
304:
305:     FOR blockIndex FROM 0 TO entry.blocks.length - 1
306:       LET block = entry.blocks[blockIndex]
307:       IF block.type !== 'text'
308:         CONTINUE
309:
310:       // Scan the text for inclusion patterns
311:       LET text = block.text
312:       LET matches = findAllInclusions(text)
313:
314:       FOR EACH match IN matches
315:         LET resolvedPath = resolvePath(match.filePath, config.workspaceRoot)
316:         IF NOT inclusions.has(resolvedPath)
317:           inclusions.set(resolvedPath, [])
318:         inclusions.get(resolvedPath).push({
319:           messageIndex: index,
320:           blockIndex,
321:           startOffset: match.startOffset,
322:           endOffset: match.endOffset,
323:         })
324:
325:   // === STEP 2: For each file with multiple inclusions, strip all but the latest ===
326:   FOR EACH [filePath, entries] IN inclusions
327:     IF entries.length <= 1
328:       CONTINUE   // only one inclusion — nothing to dedup
329:
330:     // Sort by messageIndex descending, then by startOffset descending
331:     // The LAST entry in the sorted list is the most recent — preserve it
332:     entries.sort((a, b) =>
333:       b.messageIndex - a.messageIndex OR b.startOffset - a.startOffset
334:     )
335:
336:     // entries[0] is the latest — preserve. Strip entries[1..n]
337:     FOR i FROM 1 TO entries.length - 1
338:       LET stale = entries[i]
339:
340:       // Build replacement for this message's text block
341:       // Remove the inclusion content from startOffset to endOffset
342:       LET originalEntry = replacements.get(stale.messageIndex) ?? history[stale.messageIndex]
343:       LET originalBlock = originalEntry.blocks[stale.blockIndex] AS TextBlock
344:       LET newText = originalBlock.text.substring(0, stale.startOffset)
345:                   + originalBlock.text.substring(stale.endOffset)
346:
347:       // Trim excessive whitespace left by removal
348:       newText = newText.replace(/\n{3,}/g, '\n\n')
349:
350:       LET newBlocks = [...originalEntry.blocks]
351:       newBlocks[stale.blockIndex] = { type: 'text', text: newText }
352:
353:       replacements.set(stale.messageIndex, {
354:         ...originalEntry,
355:         blocks: newBlocks,
356:       })
357:       prunedCount = prunedCount + 1
358:
359:   RETURN { replacements, prunedCount }
```

---

## Pseudocode: findAllInclusions() Helper

```
365: FUNCTION findAllInclusions(text: string): Array<{
366:   filePath: string,
367:   startOffset: number,
368:   endOffset: number,
369: }>
370:   LET results = []
371:   LET openPattern = /^--- (.+) ---$/gm
372:   LET match
373:
374:   WHILE (match = openPattern.exec(text)) IS NOT null
375:     LET filePath = match[1].trim()
376:     LET startOffset = match.index
377:
378:     // Find the closing delimiter after this opening
379:     LET closeIndex = text.indexOf(FILE_INCLUSION_CLOSE, startOffset + match[0].length)
380:     IF closeIndex === -1
381:       CONTINUE   // no closing delimiter — fail-safe, skip (REQ-HD-006.5)
382:
383:     LET endOffset = closeIndex + FILE_INCLUSION_CLOSE.length
384:     // Include trailing newline if present
385:     IF text[endOffset] === '\n'
386:       endOffset = endOffset + 1
387:
388:     results.push({ filePath, startOffset, endOffset })
389:
390:     // Advance regex past this inclusion to avoid nested matches
391:     openPattern.lastIndex = endOffset
392:
393:   RETURN results
```

---

## Pseudocode: pruneByRecency()

```
400: PRIVATE METHOD pruneByRecency(
401:   history: READONLY ARRAY OF IContent,
402:   config: DensityConfig,
403:   existingRemovals: Set<number>
404: ): { replacements: Map<number, IContent>, prunedCount: number }
405:
406:   LET replacements: Map<number, IContent> = NEW Map()
407:   LET prunedCount = 0
408:   LET retention = Math.max(1, config.recencyRetention)   // at least 1 (REQ-HD-013.6)
409:
410:   // === STEP 1: Count tool responses per tool name, walking in reverse ===
411:   LET toolCounts: Map<string, number> = NEW Map()
412:   // Track which entries need replacement (index → list of blocks to replace)
413:   LET entriesToPrune: Array<{ index: number, blockIndex: number }> = []
414:
415:   FOR index FROM history.length - 1 DOWNTO 0
416:     LET entry = history[index]
417:     IF entry.speaker !== 'tool'
418:       CONTINUE
419:     IF existingRemovals.has(index)
420:       CONTINUE
421:
422:     FOR blockIndex FROM entry.blocks.length - 1 DOWNTO 0
423:       LET block = entry.blocks[blockIndex]
424:       IF block.type !== 'tool_response'
425:         CONTINUE
426:
427:       LET toolName = block.toolName
428:       LET currentCount = toolCounts.get(toolName) ?? 0
429:       currentCount = currentCount + 1
430:       toolCounts.set(toolName, currentCount)
431:
432:       IF currentCount > retention
433:         // This is an old result — mark for pruning
434:         entriesToPrune.push({ index, blockIndex })
435:
436:   // === STEP 2: Build replacements ===
437:   // Group by entry index for batch replacement
438:   LET grouped: Map<number, Set<number>> = NEW Map()   // index → set of blockIndices to prune
439:
440:   FOR EACH { index, blockIndex } IN entriesToPrune
441:     IF NOT grouped.has(index)
442:       grouped.set(index, NEW Set())
443:     grouped.get(index).add(blockIndex)
444:
445:   FOR EACH [entryIndex, blockIndices] IN grouped
446:     LET entry = replacements.get(entryIndex) ?? history[entryIndex]
447:     LET newBlocks = entry.blocks.map((block, bi) =>
448:       IF blockIndices.has(bi) AND block.type === 'tool_response'
449:         // Replace the result with a pointer string
450:         RETURN {
451:           ...block,
452:           result: PRUNED_POINTER,
453:         }
454:       ELSE
455:         RETURN block
456:     )
457:
458:     replacements.set(entryIndex, {
459:       ...entry,
460:       blocks: newBlocks,
461:     })
462:     prunedCount = prunedCount + blockIndices.size
463:
464:   RETURN { replacements, prunedCount }
```

---

## Pseudocode: isEmptyTextBlock() Helper

```
470: FUNCTION isEmptyTextBlock(block: ContentBlock): boolean
471:   RETURN block.type === 'text' AND (NOT block.text OR block.text.trim() === '')
```

---

## Integration Points

```
Line 10-11: READ_TOOLS and WRITE_TOOLS constants
  - These must match the actual tool names registered in the tool system.
  - Verify against packages/core/src/tools/ registrations.
  - If new file-operation tools are added later, these lists need updating.

Line 83-85: extractFilePath uses ToolCallBlock.parameters (typed as unknown)
  - IContent.ts line 122: parameters: unknown
  - We must cast carefully — no guarantee of structure.
  - REQ-HD-013.5: skip on unrecognizable params, never throw.

Line 87: resolvePath uses config.workspaceRoot
  - The workspace root comes from runtimeContext.config.getWorkspaceRoot()
  - Passed through DensityConfig by the orchestrator.

Line 122-125: canPruneReadManyFiles handles the read_many_files special case
  - The paths parameter is specific to read_many_files tool schema.
  - Must check for glob characters per REQ-HD-005.9.

Line 148-174: Block-level granularity (REQ-HD-005.8)
  - An AI entry may have tool_call, text, and thinking blocks mixed.
  - We only remove stale tool_call blocks, preserving all others.
  - If all blocks would be removed, use removal instead of replacement.

Line 302-303: existingRemovals passed to dedup/recency phases
  - Later phases skip entries already marked for removal by earlier phases.
  - This prevents conflict (BR-CONFLICT-004: removal wins over modification).

Line 342: Chained replacements
  - When building a replacement, check if there's already a pending
    replacement from the same phase (multiple inclusions in same message).
  - Use: replacements.get(index) ?? history[index] as base.

Line 408: retention clamped to minimum 1
  - REQ-HD-013.6: recencyRetention < 1 treated as 1.
  - Math.max(1, config.recencyRetention) enforces this.
```

---

## Anti-Pattern Warnings

```
[ERROR] DO NOT: Mutate the history array or its entries inside optimize()
        WHY: optimize() receives readonly IContent[]. It MUST NOT modify any
             entry in place. All changes go into removals/replacements.
[OK]    DO: Build new IContent objects for replacements using spread.

[ERROR] DO NOT: Use path.normalize() instead of path.resolve()
        WHY: normalize() doesn't resolve relative paths against a base.
             'foo/bar.ts' and '/workspace/foo/bar.ts' would not match.
[OK]    DO: Use path.resolve(workspaceRoot, filePath) for relative paths.

[ERROR] DO NOT: Throw on malformed tool parameters
        WHY: REQ-HD-013.5 — strategy skips unrecognizable params, does not throw.
             History may contain third-party tool calls with arbitrary params.
[OK]    DO: Return undefined from extractFilePath, continue in the loop.

[ERROR] DO NOT: Assume tool_call and tool_response are in adjacent entries
        WHY: There may be intervening AI text blocks, thinking blocks, or
             other content between a tool_call and its response.
[OK]    DO: Use callId matching to link tool_call ↔ tool_response regardless
        of position.

[ERROR] DO NOT: Case-fold file paths before comparison
        WHY: REQ-HD-005.5 — compare paths exactly as returned by path.resolve().
             APFS and ext4 may be case-sensitive.
[OK]    DO: Compare resolved paths directly without toLowerCase().

[ERROR] DO NOT: Use Array indices computed against curated history
        WHY: optimize() receives raw history. getCurated() filters out empty AI
             messages. Indices from curated view would be wrong when applied to
             raw array.
[OK]    DO: Use indices from getRawHistory() consistently.

[ERROR] DO NOT: Create new IContent entries without preserving metadata
        WHY: Each history entry may have metadata (timestamp, model, usage, etc.).
             Replacements must spread the original entry to preserve metadata.
[OK]    DO: Use { ...originalEntry, blocks: newBlocks } for replacements.

[ERROR] DO NOT: Allow a single index to appear in BOTH removals and replacements
        WHY: applyDensityResult() will throw on this invariant violation.
             The merge logic at lines 33, 39, 45 must check and resolve.
[OK]    DO: When merging phase results, if an index is in removals, skip adding
        it to replacements. Removal is the more aggressive operation.
```
